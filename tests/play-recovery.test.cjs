const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { NodeSqliteAdapter } = require('./helpers/mobileHarness.cjs');
const { applySqliteMigrations } = require('../dist/infra/sqlite/migrations');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');
const { LedgeredProvider, recoverInterruptedAttempts, OutcomeUnknownReplayError } = require('../dist/application/llm/requestLedger');
const { loadPlayRecovery, savePlayIntentDraft, clearPlayIntentDraft, acknowledgePlayReplay } = require('../dist/application/campaign/playRecovery');

async function setup() {
  const db = new DatabaseSync(':memory:');
  const adapter = new NodeSqliteAdapter(db);
  await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  db.exec("INSERT INTO branches (branch_id,campaign_id,state_version,created_at) VALUES ('b','c',13,'t'),('other','c',13,'t')");
  return { db, adapter, ledger: new SqliteLlmLedgerStore(adapter) };
}

test('play approval rejects an in-flight call and a contradictory campaign binding without clearing the old unknown',async()=>{
  const {db,ledger}=await setup();try {
    const meta={logicalRequestId:'narrator:b:turn-x',requestKind:'narrator',branchId:'b',stateVersion:13,modelProfileFingerprint:'fp'};
    const old=await ledger.beginAttempt({...meta,campaignId:'wrong'},1);
    await ledger.updateAttempt(old.attemptId,{status:'outcome_unknown'});
    await assert.rejects(acknowledgePlayReplay(ledger,'c','b',13,[old.attemptId]),/不属于/);
    const valid=await ledger.beginAttempt({...meta,logicalRequestId:'narrator:b:turn-y',campaignId:'c'},2);
    await ledger.updateAttempt(valid.attemptId,{status:'outcome_unknown'});
    const active=await ledger.beginAttempt({...meta,logicalRequestId:'planner:b:turn-y',requestKind:'planner'},3);
    await ledger.updateAttempt(active.attemptId,{status:'sent'});
    await assert.rejects(acknowledgePlayReplay(ledger,'c','b',13,[valid.attemptId]),/正在发送/);
    assert.equal((await ledger.listAttempts(valid.logicalRequestId))[0].replayApprovedAt,null);
  } finally {db.close()}
});

test('play recovery: durable draft survives reload, permits known-failure edits, and clears by version', async () => {
  const { db, adapter } = await setup();
  assert.equal(await savePlayIntentDraft(adapter,'c','b','original action'),13);
  assert.equal((await loadPlayRecovery(adapter,'c','b')).intent,'original action');
  await savePlayIntentDraft(adapter,'c','b','edited before settlement');
  await clearPlayIntentDraft(adapter,'b',12);
  assert.equal((await loadPlayRecovery(adapter,'c','b')).intent,'edited before settlement');
  await assert.rejects(savePlayIntentDraft(adapter,'wrong-campaign','b','cross campaign'),/分支不存在/);
  assert.equal(await loadPlayRecovery(adapter,'c','other'),null);
  await clearPlayIntentDraft(adapter,'b',13);
  assert.equal(await loadPlayRecovery(adapter,'c','b'),null);
  db.close();
});

test('play recovery: pre-migration staged contract restores its intent and forbids changing the frozen action', async () => {
  const { db, adapter } = await setup();
  db.prepare(`INSERT INTO turns (branch_id,turn_id,status,expected_state_version,action_contract_json,action_contract_hash,created_at)
    VALUES ('b','turn-0014','Resolved',13,?,'hash','t')`).run(JSON.stringify({intent:'frozen persuasion'}));
  assert.deepEqual(await loadPlayRecovery(adapter,'c','b'),{ expectedStateVersion:13,intent:'frozen persuasion',frozen:true,unknownAttemptIds:[] });
  await assert.rejects(savePlayIntentDraft(adapter,'c','b','a different action'),/恢复原先/);
  await savePlayIntentDraft(adapter,'c','b','frozen persuasion');
  db.close();
});

test('play recovery: acknowledged replay keeps unknown usage, dispatches once, and a new interruption blocks again', async () => {
  const { db, adapter, ledger } = await setup();
  const meta = { logicalRequestId:'narrator:b:turn-0014',requestKind:'narrator',branchId:'b',stateVersion:13 };
  const attempt = await ledger.beginAttempt({...meta,modelProfileFingerprint:'fp'},1);
  await ledger.updateAttempt(attempt.attemptId,{status:'sent'});
  await recoverInterruptedAttempts(ledger);
  let calls = 0;
  const provider = new LedgeredProvider({async complete(){ calls++; return {text:'ok'}; }},ledger,{modelProfileFingerprint:'fp'});
  const request = {role:'Narrator',system:'s',user:'u',maxOutputTokens:10,ledger:meta};
  await assert.rejects(provider.complete(request),OutcomeUnknownReplayError);
  assert.equal(calls,0);
  await acknowledgePlayReplay(ledger,'c','b',13,[attempt.attemptId]);
  assert.equal((await loadPlayRecovery(adapter,'c','b')),null);
  await provider.complete(request);
  const history = await ledger.listAttempts(meta.logicalRequestId);
  assert.equal(history[0].status,'outcome_unknown');
  assert.equal(history[0].inputTokens,null);
  assert.ok(history[0].replayApprovedAt > 0);
  assert.equal(history[1].status,'succeeded');
  assert.equal(calls,1);
  const second = await ledger.beginAttempt({...meta,modelProfileFingerprint:'fp'},2);
  await ledger.updateAttempt(second.attemptId,{status:'sent'});
  await recoverInterruptedAttempts(ledger);
  await assert.rejects(provider.complete(request),OutcomeUnknownReplayError);
  assert.equal(calls,1);
  assert.deepEqual((await loadPlayRecovery(adapter,'c','b')).unknownAttemptIds,[second.attemptId]);
  db.close();
});

test('play recovery: approval rejects other branches, campaign, kind, stale version and rolls back the whole acknowledgement', async () => {
  const { db, adapter, ledger } = await setup();
  const a = await ledger.beginAttempt({logicalRequestId:'narrator:b:turn-0014',requestKind:'narrator',branchId:'b',stateVersion:13,modelProfileFingerprint:'fp'},1);
  const foreign = await ledger.beginAttempt({logicalRequestId:'narrator:other:turn-0014',requestKind:'narrator',branchId:'other',stateVersion:13,modelProfileFingerprint:'fp'},2);
  const world = await ledger.beginAttempt({logicalRequestId:'world:b:unit',requestKind:'world_extract',branchId:'b',stateVersion:13,modelProfileFingerprint:'fp'},3);
  await recoverInterruptedAttempts(ledger);
  await assert.rejects(acknowledgePlayReplay(ledger,'wrong','b',13,[a.attemptId]),/分支不存在/);
  await assert.rejects(acknowledgePlayReplay(ledger,'c','b',12,[a.attemptId]),/状态已经更新/);
  await assert.rejects(acknowledgePlayReplay(ledger,'c','b',13,[a.attemptId,foreign.attemptId]),/不属于/);
  assert.equal((await ledger.listAttempts(a.logicalRequestId))[0].replayApprovedAt,null);
  await assert.rejects(acknowledgePlayReplay(ledger,'c','b',13,[world.attemptId]),/不属于/);
  db.close();
});

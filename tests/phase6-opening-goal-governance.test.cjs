'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { suggestOpeningGoals } = require('../dist/application/campaign/openingGoalSuggestions');
const { ReactNativeSqliteAdapter } = require('../dist/infra/sqlite/reactNativeSqliteAdapter');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { RateScheduledProvider } = require('../dist/application/llm/scheduledProvider');
const { GlobalRateScheduler, endpointBucketId } = require('../dist/application/worldBuild/rateScheduler');
const { llmModelProfileFingerprint } = require('../dist/application/llm/profileFingerprint');
const profile = { id:'goals', name:'goals', endpoint:'https://example.invalid/v1', model:'glm-test', keyRef:'unused',
  reasoningTier:'low', contentOutputTokens:1200,
  capabilities:{ supportsJson:true, supportsStreaming:false, reportsUsage:true, contextWindow:32000, maxOutputTokens:8000 } };
const input = { worldTitle:'协议夹具', anchorTitle:'抵达旧桥', locationName:'旧桥', characterNames:['旅人'], playerName:'测试旅人' };
const sha256Hex = async text => createHash('sha256').update(text).digest('hex');
const governance = worldId => ({ worldId, packageRevision:1, packageContentHash:'a'.repeat(64), anchorEventId:'event-arrival',
  profile, sha256Hex, isCurrent:async()=>true });
const response = { text:JSON.stringify({goals:['调查桥头的脚印','询问当地人的来历']}), usage:{inputTokens:100,outputTokens:30,estimated:false} };
const deferred = () => { let resolve; const promise = new Promise(done=>{resolve=done;}); return {promise,resolve}; };
async function fixture(t, complete) {
  const db = new DatabaseSync(':memory:'); t.after(()=>db.close());
  for(const migration of BUILTIN_MIGRATIONS) db.exec(migration.sql);
  const adapter = new ReactNativeSqliteAdapter({ async executeSql(sql,params=[]) {
    let rows=[],rowsAffected=0;
    if(/^(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) db.exec(sql);
    else {const s=db.prepare(sql);if(s.columns().length)rows=s.all(...params);else rowsAffected=s.run(...params).changes;}
    return [{rows:{length:rows.length,item:index=>rows[index]},rowsAffected}];
  }});
  const store = new SqliteLlmLedgerStore(adapter);
  const makeProvider = p => new RateScheduledProvider({complete},
    new GlobalRateScheduler({maxConcurrent:2,endpointBucketId:endpointBucketId(p.endpoint)}))
    .withLedger(store,{modelProfileFingerprint:llmModelProfileFingerprint(p)});
  return {db,store,provider:makeProvider(profile),makeProvider};
}

test('opening suggestions use the kernel, P1 admission and one durable physical attempt; concurrent screens and known cache reuse do not resend', async t=>{
  const entered=deferred(),hold=deferred();let calls=0,request;
  const h=await fixture(t,async r=>{calls++;request=r;entered.resolve();await hold.promise;return response;});
  const g=governance('goal-dedup');
  const first=suggestOpeningGoals(h.provider,input,g);await entered.promise;
  const second=suggestOpeningGoals({complete:r=>h.provider.complete(r)},input,g);hold.resolve();
  const [a,b]=await Promise.all([first,second]);assert.deepEqual(a,b);assert.equal(calls,1);
  assert.equal(request.scheduling.priority,'P1');assert.equal(request.scheduling.worldId,g.worldId);
  assert.equal(request.maxPhysicalRequests,1);assert.equal(request.reasoningTier,'low');
  assert.ok(request.reasoningReserveTokens>0);assert.ok(request.maxOutputTokens>1200);
  assert.ok(request.maxOutputTokens<=profile.capabilities.maxOutputTokens);
  const attempts=await h.store.listAttempts(request.ledger.logicalRequestId);assert.equal(attempts.length,1);
  assert.equal(attempts[0].status,'succeeded');assert.equal(attempts[0].requestKind,'opening_goal');
  assert.equal(attempts[0].worldId,g.worldId);assert.equal(attempts[0].wireOutputTokens,request.maxOutputTokens);
  a[0]='外部修改';assert.deepEqual(await suggestOpeningGoals(h.provider,input,g),b);assert.equal(calls,1);
});

test('opening suggestion unknown survives optional fallback and blocks cold/provider retries without inventing usage',async t=>{
  let calls=0,logical;
  const h=await fixture(t,async r=>{calls++;logical=r.ledger.logicalRequestId;throw new Error('unobservable dispatch');});
  const g=governance('goal-unknown');assert.deepEqual(await suggestOpeningGoals(h.provider,input,g),[]);
  assert.deepEqual(await suggestOpeningGoals(h.provider,input,g),[]);assert.equal(calls,1);
  const a=await h.store.listAttempts(logical);assert.equal(a.length,1);assert.equal(a[0].status,'outcome_unknown');
  assert.equal(a[0].inputTokens,null);assert.equal(a[0].outputTokens,null);assert.equal(a[0].replayApprovedAt,null);
});

test('switching endpoint, model and reasoning budget cannot automatically replay an unknown opening suggestion',async t=>{
  let calls=0,logical;
  const h=await fixture(t,async r=>{calls++;logical=r.ledger.logicalRequestId;throw new Error('unknown remote outcome');});
  const g=governance('goal-unknown-api-switch');
  assert.deepEqual(await suggestOpeningGoals(h.provider,input,g),[]);
  const changed={...profile,endpoint:'https://another.invalid/v1',model:'another-model',reasoningTier:'high',
    contentOutputTokens:600,capabilities:{...profile.capabilities,maxOutputTokens:16000}};
  assert.deepEqual(await suggestOpeningGoals(h.makeProvider(changed),input,{...g,profile:changed}),[]);
  assert.equal(calls,1);
  const attempts=await h.store.listAttempts(logical);
  assert.equal(attempts.length,1);assert.equal(attempts[0].status,'outcome_unknown');
  assert.equal(attempts[0].inputTokens,null);assert.equal(attempts[0].outputTokens,null);
  assert.equal(attempts[0].replayApprovedAt,null);
  assert.equal(h.db.prepare("SELECT COUNT(DISTINCT logical_request_id) AS n FROM llm_request_attempts WHERE request_kind='opening_goal'").get().n,1);
});

test('unknown capabilities, insufficient content budget, invalid hashes, stale project and queued cancellation all stop before dispatch',async()=>{
  let calls=0;const provider={async complete(){calls++;return response;}};
  const base=governance('goal-gates'),cancel=new AbortController();cancel.abort();
  for(const g of [
    {...base,profile:{...profile,capabilities:{...profile.capabilities,contextWindow:undefined}}},
    {...base,profile:{...profile,contentOutputTokens:100}},
    {...base,packageContentHash:'invalid'}, {...base,sha256Hex:async()=> 'invalid'},
    {...base,isCurrent:async()=>false},{...base,queueSignal:cancel.signal},
  ]) assert.deepEqual(await suggestOpeningGoals(provider,input,g),[]);
  assert.equal(calls,0);
});

test('late suggestion completion after project deletion is recorded but cannot restore UI suggestions; frozen anchor and source revisions separate logical requests',async t=>{
  let current=true,calls=0;const requests=[];
  const h=await fixture(t,async r=>{calls++;requests.push(r);current=false;return response;});
  const g={...governance('goal-deletion'),isCurrent:async()=>current};
  assert.deepEqual(await suggestOpeningGoals(h.provider,input,g),[]);assert.equal(calls,1);
  assert.equal((await h.store.listAttempts(requests[0].ledger.logicalRequestId))[0].status,'succeeded');
  assert.deepEqual(await suggestOpeningGoals(h.provider,input,g),[]);assert.equal(calls,1);
  // A distinct frozen published revision/anchor must never consume an old suggestion cache.
  for(const changed of [{packageRevision:2,packageContentHash:'b'.repeat(64)},{anchorEventId:'event-other'}]) {
    const goals=await suggestOpeningGoals(h.provider,input,{...governance('goal-deletion'),...changed});assert.equal(goals.length,2);
  }
  assert.equal(calls,3);assert.equal(new Set(requests.map(r=>r.ledger.logicalRequestId)).size,3);
});

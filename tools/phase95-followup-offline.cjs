// Exact rejected-input replay on a NEW branch in a private COPY of SQLite.
// The only provider is an in-process stub. No HTTP, device, key or original
// archive is written. Refuse to overwrite an existing destination file.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { NodeSqliteAdapter, sha } = require('../tests/helpers/mobileHarness.cjs');
const load = name => require('../dist/' + name);
const { CampaignSession } = load('application/campaign/session');
const { forkBranch } = load('application/branch/fork');
const { extractJsonObject } = load('application/campaignPlan/candidateModel');
const { canonicalJsonOf } = load('application/campaignPlan/hashing');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Provide source snapshot and new private destination SQLite paths.');
assert.notEqual(path.resolve(source), path.resolve(destination));
const sourceHash = digest(source);
fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);

async function main() {
  const db = new DatabaseSync(destination);
  try {
    const adapter = new NodeSqliteAdapter(db);
    const turns = new (load('infra/sqlite/sqliteTurnStore').SqliteTurnStore)(adapter);
    const game = new (load('infra/sqlite/sqliteGameStore').SqliteGameStore)(adapter);
    const worlds = new (load('infra/sqlite/sqliteWorldStore').SqliteWorldStore)(adapter);
    const sources = new (load('infra/sqlite/sqliteSourceStore').SqliteSourceStore)(adapter);
    const catalog = new (load('application/sourceIndex/sourceCatalog').SourceCatalogAdapter)(sources, worlds, sha);
    const publication = new (load('application/segmentPublication/service').SegmentPublicationService)({
      store: new (load('infra/sqlite/sqliteSegmentArtifactStore').SqliteSegmentArtifactStore)(adapter, sha.sha256Hex),
      worldStore: worlds, sourceCatalog: catalog, sha256Hex: sha.sha256Hex,
    });
    const candidate = db.prepare("SELECT * FROM campaign_plan_candidates WHERE validation_errors_json LIKE '%cons-settlement%' ORDER BY created_at LIMIT 1").get();
    assert.ok(candidate);
    const job = db.prepare('SELECT * FROM campaign_plan_jobs WHERE job_id=?').get(candidate.job_id);
    assert.equal(job.base_state_version, 3);
    const immutableTables = ['campaign_plan_candidates', 'campaign_plan_revisions', 'campaign_content_artifacts', 'snapshots', 'turns', 'roll_records'];
    const preserved = new Map(immutableTables.map(table => [table, db.prepare(`SELECT rowid AS audit_rowid,* FROM ${table} ORDER BY rowid`).all()]));
    const model = extractJsonObject(candidate.raw_response_text);
    const repaired = structuredClone(model);
    const crest = repaired.consequences.find(c => c.consequenceId === 'cons-crest-truth');
    const settlement = repaired.consequences.find(c => c.consequenceId === 'cons-settlement');
    const clue = crest.effects.find(e => e.template === 'grant_knowledge');
    assert.ok(clue);
    const stage6 = repaired.stages.find(s => s.nodeId === 'stage-6');
    stage6.completion = { kind: 'all', of: [stage6.completion, { kind: 'knowledge_known', entryId: clue.entryId }] };
    settlement.trigger = { kind: 'node_succeeded', nodeId: 'stage-6' };
    const ending = repaired.endings.find(e => canonicalJsonOf(e.condition).includes('"stage-6"'));
    assert.ok(ending);
    ending.condition = { kind: 'all', of: [ending.condition, { kind: 'committed_event', eventType: 'settlement_secured' }] };
    // The current strict contract also rejects an old information-only method.
    // Make it a preparation with a real consumer rather than fabricating goal
    // completion. Both grades grant one verified route hint; following it is
    // a separate action. This is authored only in the NEW candidate.
    const preparation = repaired.firstSituation.methods.find(m => m.methodId === 'ask-town-about-forest');
    assert.ok(preparation);
    for (const grade of ['success', 'full_success']) preparation.outcomes[grade].effects.push({
      template: 'situation_counter', situationId: 'self', counterId: 'verified_route_hint', delta: 1,
    });
    const follow = repaired.firstSituation.methods[0];
    const preparationGate = { kind: 'counter_at_least', situationId: 'self', counterId: 'verified_route_hint', minimum: 1 };
    follow.requires.condition = follow.requires.condition ? { kind: 'all', of: [follow.requires.condition, preparationGate] } : preparationGate;
    const branchId = 'offline-bug95-001-new-branch';
    await forkBranch({ db: adapter, turnStore: turns, gameStore: game, sourceBranchId: job.branch_id,
      targetBranchId: branchId, campaignId: job.campaign_id, atStateVersion: job.base_state_version,
      forkTurnId: null, createdAt: new Date().toISOString() });
    let planCalls = 0;
    const session = new CampaignSession({ db: adapter, turns, game, worldStore: worlds, sourceStore: sources,
      narratives: new (load('infra/sqlite/sqliteNarrativeStore').SqliteNarrativeStore)(adapter),
      guidance: new (load('infra/sqlite/sqliteGuidanceStore').SqliteGuidanceStore)(adapter),
      segmentContent: publication, hashProvider: sha, random: { nextIntInclusive: (_min, max) => Math.min(4, max) },
    }, { async complete(request) {
      planCalls++;
      assert.ok(planCalls <= 2);
      if (planCalls === 2) {
        assert.match(request.user, /consequence cons-crest-truth：/);
        assert.match(request.user, /consequence cons-settlement：/);
        assert.match(request.user, /成功事件.*没有可达用途/);
      }
      return { text: planCalls === 1 ? candidate.raw_response_text : JSON.stringify(repaired) };
    } }, { endpoint: 'https://example.invalid', model: 'offline-fixture', keyRef: 'unused-offline', reasoningTier: 'low',
      capabilities: { contextWindow: 200000, maxOutputTokens: 64000, supportsJson: true } });
    const before = await turns.getState(branchId);
    assert.equal(await session.runCampaignReplan(job.campaign_id, branchId), 'adopted');
    assert.equal(planCalls, 2);
    const adopted = await turns.getState(branchId);
    assert.equal(adopted.campaignRuntime.planBinding.revision, before.campaignRuntime.planBinding.revision + 1);
    const guidance = await session.ensureDecisionPointGuidance({ campaignId: job.campaign_id, branchId,
      sourceTurnId: 'offline-formal-revision', localOnly: true });
    assert.notEqual(guidance?.steps.find(s => s.methodId === follow.methodId)?.availability, 'available', 'preparation is actually required');
    let step = guidance?.steps.find(s => s.methodId === preparation.methodId && s.availability === 'available');
    assert.ok(step, 'exact repaired revision supplies a usable preparation');
    let authored = repaired.firstSituation.methods.find(m => m.methodId === step.methodId);
    const requests = [];
    session.provider = { async complete(request) {
      requests.push(request.role);
      const value = JSON.parse(request.user);
      if (request.role === 'Planner') return { text: JSON.stringify({ proposalVersion: '2.0', turnId: value.turnId,
        expectedStateVersion: value.expectedStateVersion, actorId: adopted.party.find(p => p.controller === 'player').actorId,
        actionKind: authored.firstStep.actionKind, ...(authored.firstStep.skillId ? { skillId: authored.firstStep.skillId } : {}),
        evidenceIds: authored.evidencePolicy?.kind === 'fixed' ? authored.evidencePolicy.evidenceIds : [],
        difficultyBand: authored.difficultyPolicy?.kind === 'fixed' ? authored.difficultyPolicy.band : 'normal',
        intent: value.playerIntent, candidateRef: step.candidateRef,
      }) };
      assert.equal(request.role, 'Narrator');
      return { text: JSON.stringify({ turnId: value.turnId, outcomeGrade: value.outcomeGrade, text: '行动按既定规则完成，结果已记录。' }) };
    } };
    await session.playTurn({ campaignId: job.campaign_id, branchId, intent: step.firstStepIntent,
      guidanceChoice: { decisionPoint: guidance.decisionPoint, candidateRef: step.candidateRef } });
    const prepared = await turns.getState(branchId);
    assert.equal(prepared.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-3').status, 'active', 'information gathering cannot invent stage completion');
    const ready = await session.ensureDecisionPointGuidance({ campaignId: job.campaign_id, branchId, sourceTurnId: 'offline-prepared', localOnly: true });
    step = ready.steps.find(s => s.methodId === follow.methodId && s.availability === 'available');
    assert.ok(step, 'persisted preparation opens its real consumer');
    authored = follow;
    const turn = await session.playTurn({ campaignId: job.campaign_id, branchId, intent: step.firstStepIntent,
      guidanceChoice: { decisionPoint: ready.decisionPoint, candidateRef: step.candidateRef } });
    assert.ok(await turns.getCommittedTurn(branchId, turn.turnId));
    const after = await turns.getState(branchId);
    assert.equal(after.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-3').status, 'succeeded');

    // Also exercise the repaired actor preparation through the REAL Session
    // boundary on a new J1 fork in this same private copy. Never resume its
    // original turn or copy its unresolved roll into the fork.
    const j1Branch = 'offline-bug95-009-new-branch';
    const j1Campaign = db.prepare('SELECT campaign_id FROM branches WHERE branch_id=?').get('camp-mv3mw9hk-main').campaign_id;
    const oldJ1Contract = JSON.parse(db.prepare('SELECT action_contract_json FROM turns WHERE branch_id=? AND turn_id=?')
      .get('camp-mv3mw9hk-main', 'turn-0071').action_contract_json);
    await forkBranch({ db: adapter, turnStore: turns, gameStore: game, sourceBranchId: 'camp-mv3mw9hk-main',
      targetBranchId: j1Branch, campaignId: j1Campaign, atStateVersion: 70, forkTurnId: null, createdAt: new Date().toISOString() });
    assert.equal(await turns.getStagedTurn(j1Branch, 'turn-0071'), null);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM roll_records WHERE branch_id=? AND turn_id=?').get(j1Branch, 'turn-0071').n, 0);
    const j1State = await turns.getState(j1Branch);
    const j1Content = await session.loadCampaignPlanForState(j1Campaign, j1State);
    const j1Method = j1Content.artifacts.flatMap(a => a.situations).find(s => s.entryId === oldJ1Contract.methodRef.situationId)
      .definition.methods.find(m => m.methodId === oldJ1Contract.methodRef.methodId);
    const j1Guidance = await session.ensureDecisionPointGuidance({ campaignId: j1Campaign, branchId: j1Branch,
      sourceTurnId: 'offline-j1-new-fork', localOnly: true });
    const j1Step = j1Guidance?.steps.find(s => s.candidateRef === `method:${oldJ1Contract.methodRef.situationId}:${j1Method.methodId}`
      && s.availability === 'available');
    assert.ok(j1Step, 'the exact J1 route can prepare its legal adopted participant');
    const j1Requests = [];
    session.provider = { async complete(request) {
      j1Requests.push(request.role);
      const value = JSON.parse(request.user);
      if (request.role === 'Planner') return { text: JSON.stringify({ proposalVersion: '2.0', turnId: value.turnId,
        expectedStateVersion: value.expectedStateVersion, actorId: j1State.party.find(p => p.controller === 'player').actorId,
        actionKind: j1Method.firstStep.actionKind, ...(j1Method.firstStep.skillId ? { skillId: j1Method.firstStep.skillId } : {}),
        evidenceIds: oldJ1Contract.evidenceIds, difficultyBand: oldJ1Contract.difficultyBand,
        intent: value.playerIntent, candidateRef: j1Step.candidateRef,
      }) };
      assert.equal(request.role, 'Narrator');
      return { text: JSON.stringify({ turnId: value.turnId, outcomeGrade: value.outcomeGrade, text: '行动按既定规则完成，结果已记录。' }) };
    } };
    const j1Turn = await session.playTurn({ campaignId: j1Campaign, branchId: j1Branch, intent: j1Step.firstStepIntent,
      guidanceChoice: { decisionPoint: j1Guidance.decisionPoint, candidateRef: j1Step.candidateRef } });
    assert.ok(await turns.getCommittedTurn(j1Branch, j1Turn.turnId));
    const j1After = await turns.getState(j1Branch);
    assert.ok(Object.keys(j1After.actors).length > Object.keys(j1State.actors).length, 'adopted participant persisted before the action');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM interaction_operations WHERE branch_id=? AND status='paused_system'").get(j1Branch).n, 0);
    for (const [table, rows] of preserved) for (const row of rows) {
      const current = db.prepare(`SELECT rowid AS audit_rowid,* FROM ${table} WHERE rowid=?`).get(row.audit_rowid);
      assert.equal(canonicalJsonOf(current), canonicalJsonOf(row), `${table} original row changed`);
    }
    console.log(JSON.stringify({ exactRejectedInput: true, privateDatabaseCopy: true, formalNewRevisionAdopted: true,
      selectedNewRouteCommitted: true, stage3Succeeded: true, originalRowsPreserved: true,
      preparationConsumedByDistinctAction: true,
      exactJ1NewForkRouteCommitted: true, exactJ1NewForkGrade: j1Turn.grade, syntheticJ1Roles: j1Requests,
      syntheticPlanResponses: planCalls, syntheticTurnRoles: requests, realProviderRequests: 0 }));
  } finally {
    db.close();
    assert.equal(digest(source), sourceHash, 'original evidence changed');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

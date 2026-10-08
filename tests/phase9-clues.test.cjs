const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, baseEntries, NOW } = require('./helpers/phase9CampaignFixture.cjs');
const { parseCampaignPlanCandidate } = require('../dist/application/campaignPlan/candidateModel');
const { compileCampaignPlan, campaignClueEntryId } = require('../dist/application/campaignPlan/localCompile');
const { buildPlanningContext } = require('../dist/application/campaignPlan/planningService');
const { validateCampaignPlan } = require('../dist/domain/campaignPlan/planValidation');
const { resolveCampaignContent } = require('../dist/application/campaignPlan/contentResolver');
const { readBoundCampaignArtifacts } = require('../dist/application/campaignPlan/boundArtifacts');
const { canonicalJsonOf, sha256HexOf } = require('../dist/application/campaignPlan/hashing');
const { frozenPlanJob, thawPlanContext } = require('../dist/application/campaignPlan/jobFreeze');
const { forkBranch } = require('../dist/application/branch/fork');
const { SqliteGameStore } = require('../dist/infra/sqlite/sqliteGameStore');
const { runReplanJob, adoptReplanCandidate } = require('../dist/application/campaignPlan/replanService');
const { exportSave, restoreSave } = require('../dist/application/export/saveFile');
const { projectPlayerEntriesAtAnchor } = require('../dist/application/campaign/session');
const profile = { id: 'test', name: 'Test', endpoint: 'https://example.invalid', model: 'test', keyRef: 'k', reasoningTier: 'low',
  capabilities: { contextWindow: 60000, maxOutputTokens: 12000, supportsJson: true } };
const args = { anchorTitle: '开篇', playerName: '旅人', protagonistSkills: ['skill-observation'], openingGoalSuggestions: [] };

function clueModel() {
  const model = candidateModel();
  model.clues = [{ clueId: 'testimony', title: '林凡核实的证词', text: '货箱是在入夜前由陌生车队卸下，林凡愿意指认车辆。',
    sourceEntryIds: ['tpl-lin', 'lore-crates'], provenance: { kind: 'design_fill', sourceFactIds: [], rationale: '基于当前现场创作的战役线索' } }];
  for (const grade of ['success','full_success']) model.firstSituation.methods[1].outcomes[grade].effects.push({ template: 'grant_knowledge', entryId: 'testimony' });
  return model;
}
async function compile(h, model, revision = 1) {
  const { intent } = await h.planStore.getSetup('setup-t');
  const { ctx } = await buildPlanningContext({ worldStore: h.worlds, intent, protagonistSkills: args.protagonistSkills });
  const parsed = parseCampaignPlanCandidate(model, []); assert.ok(parsed);
  const output = compileCampaignPlan({ model: parsed, intent, ctx, planId: 'plan-test', revision, parentRevision: null, createdAt: NOW });
  const validation = validateCampaignPlan(output.plan, { visibleWorldEntryIds: new Set(ctx.visibleEntries.map(e => e.entryId)),
    openingActorIds: ctx.openingActorIds, openingTemplateIds: ctx.openingTemplateIds, protagonistSkills: ctx.protagonistSkills,
    availableFactIds: ctx.availableFactIds }, output.artifact);
  return { ...output, ctx, intent, validation };
}

test('campaign clues: malformed, oversized, duplicate and executable clue envelopes cannot reach the compiler', () => {
  for (const mutate of [m => { m.clues = {}; }, m => { m.clues[0] = null; }, m => { m.clues[0].text = ''; },
    m => { m.clues.push(structuredClone(m.clues[0])); }, m => { m.clues[0].effects = []; },
    m => { m.clues[0].provenance.kind = 'explicit'; }, m => { m.clues[0].sourceEntryIds = [7]; },
    m => { m.clues = Array.from({ length: 9 }, (_, n) => ({ ...m.clues[0], clueId: `clue-${n}` })); }]) {
    const model = clueModel(); mutate(model); const errors = [];
    assert.equal(parseCampaignPlanCandidate(model, errors), null); assert.match(errors.join(' '), /clues/);
  }
});

test('campaign clues: one owned alias compiles across effects, conditions, gates, rewards and deferred consequences', async () => {
  const h = await fixture();
  try {
    const model = clueModel();
    model.stages[0].completion = { kind: 'knowledge_known', entryId: 'testimony' };
    model.firstSituation.methods[0].requires.knowledgeEntryId = 'testimony';
    model.firstSituation.methods[0].requires.condition = { kind: 'knowledge_known', entryId: 'testimony' };
    model.consequences[0].trigger = { kind: 'knowledge_known', entryId: 'testimony' };
    model.consequences[0].effects = [{ template: 'grant_knowledge', entryId: 'testimony' }];
    model.rewards[0].rewards = [{ kind: 'knowledge', targetId: 'testimony' }];
    const output = await compile(h, model);
    assert.deepEqual(output.errors, []); assert.deepEqual(output.validation, []);
    const id = output.artifact.clues[0].entryId;
    assert.match(id, /^camp-clue-[a-f0-9]{24}$/); assert.notEqual(campaignClueEntryId('plan-test', 2, 'testimony'), id);
    assert.equal(output.plan.nodes[0].completion.entryId, id);
    assert.equal(output.artifact.situations[0].definition.methods[0].requires.knowledgeEntryId, id);
    assert.equal(output.artifact.situations[0].definition.methods[0].requires.condition.entryId, id);
    assert.equal(output.artifact.consequenceTemplates[0].triggerCondition.entryId, id);
    assert.equal(output.artifact.consequenceTemplates[0].effectSpecs[0].entryId, id);
    assert.equal(output.artifact.rewardPolicies[0].rewards[0].targetId, id);
    assert.ok(output.artifact.dependencies.worldEntryIds.includes('lore-crates'));
    assert.ok(!output.artifact.dependencies.worldEntryIds.includes(id));
  } finally { h.db.close(); }
});

test('campaign clues: undefined ids, world collisions, unsupported sources and false canon provenance remain invalid', async () => {
  const h = await fixture();
  try {
    for (const mutate of [m => { delete m.clues; }, m => { m.clues[0].clueId = 'lore-crates'; },
      m => { m.clues[0].sourceEntryIds = ['missing-entry']; },
      m => { m.clues[0].provenance = { kind: 'canon_inspired', sourceFactIds: ['not-a-fact'], rationale: '虚假的原著引用来源' }; }]) {
      const model = clueModel(); mutate(model); const output = await compile(h, model);
      assert.ok(output.errors.length || output.validation.length);
    }
    const model = candidateModel(); model.firstSituation.methods[0].requires.knowledgeEntryId = 'camp-clue-000000000000000000000000';
    assert.match((await compile(h, model)).validation.join(' '), /requires unknown knowledge/);
  } finally { h.db.close(); }
});

test('campaign clues: adoption grants no knowledge, the successful method grants it in its commit, and a fork remains unaware', async () => {
  const h = await fixture({ model: clueModel() });
  try {
    const before = await h.turns.getState(h.branchId);
    const artifacts = await readBoundCampaignArtifacts(h.adapter, h.campaignId, before.campaignContentBinding);
    const id = artifacts[0].clues[0].entryId;
    assert.ok(!before.discoveries.some(d => d.entryId === id));
    const merged = resolveCampaignContent(baseEntries(), artifacts);
    assert.equal(merged.find(e => e.entryId === id).visibility, 'discoverable');
    assert.ok(!projectPlayerEntriesAtAnchor(merged, [], 1, new Set()).some(e => e.entryId === id));
    const worldBefore = h.db.prepare('SELECT content_hash FROM world_packages').all();
    await forkBranch({ db: h.adapter, turnStore: h.turns, gameStore: new SqliteGameStore(h.adapter),
      sourceBranchId: h.branchId, targetBranchId: 'clue-sibling', campaignId: h.campaignId, forkTurnId: null, createdAt: NOW });
    const turn = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const after = await h.turns.getState(h.branchId);
    const discovery = after.discoveries.find(d => d.entryId === id);
    assert.equal(discovery.sourceTurnId, turn.turnId); assert.equal(discovery.knownAtStateVersion, after.stateVersion);
    assert.ok(projectPlayerEntriesAtAnchor(merged, [], 1, new Set(after.discoveries.map(d => d.entryId))).some(e => e.entryId === id));
    assert.ok(!(await h.turns.getState('clue-sibling')).discoveries.some(d => d.entryId === id));
    assert.deepEqual(h.db.prepare('SELECT content_hash FROM world_packages').all(), worldBefore);
    assert.deepEqual(await readBoundCampaignArtifacts(h.adapter, h.campaignId, after.campaignContentBinding), artifacts);
  } finally { h.db.close(); }
});

test('campaign clues: a foreign branch dependency is rejected even with recomputed archive and binding hashes', async () => {
  const h = await fixture({ model: clueModel() });
  try {
    const state = await h.turns.getState(h.branchId);
    const artifacts = await readBoundCampaignArtifacts(h.adapter, h.campaignId, state.campaignContentBinding);
    const artifact = structuredClone(artifacts[0]);
    const foreign = 'camp-clue-000000000000000000000000';
    artifact.clues[0].dependencyIds = [foreign]; artifact.dependencies.campaignEntryIds = [foreign];
    const { contentHash, ...body } = artifact; artifact.contentHash = sha256HexOf(canonicalJsonOf(body));
    h.db.prepare('UPDATE campaign_content_artifacts SET artifact_json=?,content_hash=? WHERE artifact_id=?')
      .run(JSON.stringify(artifact), artifact.contentHash, artifact.artifactId);
    await assert.rejects(readBoundCampaignArtifacts(h.adapter, h.campaignId,
      { artifactIds: [artifact.artifactId], contentHash: artifact.contentHash }), /不在当前快照绑定/);
  } finally { h.db.close(); }
});

test('campaign clues: replan reads only verified adopted artifacts, freezes their namespace and consumes committed knowledge', async () => {
  const h = await fixture({ model: clueModel() });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const state = await h.turns.getState(h.branchId);
    const artifacts = await readBoundCampaignArtifacts(h.adapter, h.campaignId, state.campaignContentBinding);
    const id = artifacts[0].clues[0].entryId;
    const model = candidateModel();
    model.stages[0].nodeId = 'verify-evidence'; model.stages[0].next = ['deliver-evidence'];
    model.stages[1].nodeId = 'deliver-evidence'; model.stages[1].dependsOn = ['verify-evidence'];
    model.stages[1].activation = { kind: 'node_succeeded', nodeId: 'verify-evidence' };
    model.endings[0].condition.nodeId = 'deliver-evidence'; model.rewards[0].nodeId = 'verify-evidence';
    model.firstSituation.methods[0].requires.knowledgeEntryId = id;
    const job = await h.planStore.findActiveJob(h.branchId, 'replan'); assert.ok(job);
    let calls = 0;
    const result = await runReplanJob({ db: h.adapter, planStore: h.planStore, worldStore: h.worlds, profile,
      provider: { async complete(request) { calls++; assert.match(request.user, new RegExp(id));
        assert.match(request.user, /"playerKnows":true/); return { text: JSON.stringify(model) }; } } }, job.jobId, args);
    assert.equal(result.status, 'candidate_ready', result.errors.join('; ')); assert.equal(calls, 1);
    const candidate = await h.planStore.latestCandidateForJob(job.jobId);
    assert.ok(candidate.artifact.dependencies.campaignEntryIds.includes(id));
    assert.ok(!candidate.artifact.dependencies.worldEntryIds.includes(id));
    const frozen = JSON.parse(h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get(`campaign-job:${job.jobId}`).payload_json);
    assert.ok(thawPlanContext(frozen).campaignEntryIds.has(id));
    assert.equal((await h.turns.getState(h.branchId)).stateVersion, state.stateVersion);
    assert.equal((await adoptReplanCandidate({ db: h.adapter, planStore: h.planStore, turns: h.turns,
      campaignId: h.campaignId, branchId: h.branchId, candidateId: candidate.candidateId })).outcome, 'adopted');
    const bound = await readBoundCampaignArtifacts(h.adapter, h.campaignId, (await h.turns.getState(h.branchId)).campaignContentBinding);
    assert.ok(resolveCampaignContent(baseEntries(), bound).some(e => e.entryId === id));
  } finally { h.db.close(); }
});

test('campaign clues: save restore retains clue definitions and actor knowledge while old artifact JSON stays untouched', async () => {
  const h = await fixture({ model: clueModel() });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const before = await h.turns.getState(h.branchId);
    const archived = h.db.prepare('SELECT artifact_json,content_hash FROM campaign_content_artifacts').all();
    const save = await exportSave({ db: h.adapter, sha256Hex: async text => sha256HexOf(text), campaignId: h.campaignId, branchId: h.branchId, createdAt: NOW });
    await restoreSave({ db: h.adapter, sha256Hex: async text => sha256HexOf(text), save: save.save,
      newCampaignId: 'clue-import', newBranchId: 'clue-import-main', createdAt: NOW });
    const restored = await h.turns.getState('clue-import-main');
    assert.deepEqual(restored.discoveries, before.discoveries);
    const entries = resolveCampaignContent(baseEntries(), await readBoundCampaignArtifacts(h.adapter, 'clue-import', restored.campaignContentBinding));
    const id = before.discoveries.find(d => d.entryId.startsWith('camp-clue-')).entryId;
    assert.equal(entries.find(e => e.entryId === id).definition.text, clueModel().clues[0].text);
    for (const archive of archived) assert.ok(h.db.prepare('SELECT artifact_json,content_hash FROM campaign_content_artifacts').all().some(a => a.artifact_json === archive.artifact_json && a.content_hash === archive.content_hash));
  } finally { h.db.close(); }
});

test('campaign clues: corrupted bound archives or a wrong campaign are refused before use', async () => {
  const h = await fixture({ model: clueModel() });
  try {
    const state = await h.turns.getState(h.branchId);
    await assert.rejects(readBoundCampaignArtifacts(h.adapter, 'other-campaign', state.campaignContentBinding), /哈希不符/);
    const row = h.db.prepare('SELECT artifact_json FROM campaign_content_artifacts').get(); const artifact = JSON.parse(row.artifact_json);
    artifact.clues[0].definition.text = '篡改后的隐藏知识';
    h.db.prepare('UPDATE campaign_content_artifacts SET artifact_json=?').run(JSON.stringify(artifact));
    await assert.rejects(h.session.getCampaignProgress(h.campaignId, h.branchId), /哈希不符/);
  } finally { h.db.close(); }
});

test('campaign clues: historical plans and freeze roots omit the extension and retain their exact hashes', async () => {
  const h = await fixture();
  try {
    const before = h.db.prepare('SELECT artifact_json,content_hash FROM campaign_content_artifacts').all();
    const output = await compile(h, candidateModel());
    assert.equal(output.artifact.clues, undefined); assert.equal(output.artifact.dependencies.campaignEntryIds, undefined);
    const frozen = frozenPlanJob(output.intent, profile, { system: 's', user: 'u' }, output.ctx);
    assert.equal(frozen.context.campaignEntryIds, undefined); assert.equal(thawPlanContext(JSON.parse(JSON.stringify(frozen))).campaignEntryIds, undefined);
    await h.session.getCampaignProgress(h.campaignId, h.branchId);
    assert.deepEqual(h.db.prepare('SELECT artifact_json,content_hash FROM campaign_content_artifacts').all(), before);
  } finally { h.db.close(); }
});

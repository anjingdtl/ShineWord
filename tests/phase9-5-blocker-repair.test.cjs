const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, baseEntries, SITUATION_ID } = require('./helpers/phase9CampaignFixture.cjs');
const { campaignActorPreparationTemplates, campaignCompletionRewardBlocker } = require('../dist/application/campaignPlan/routeReadiness');
const { buildStructuralRepairGuidance } = require('../dist/application/campaignPlan/generationService');
const { validateLongCampaignConsequenceCausality } = require('../dist/domain/campaignPlan/causalityValidation');

test('BUG-95-009 adopted participants absent from the world scene load before a new selected action and retain its reward', async t => {
  const model = candidateModel();
  const closing = model.firstSituation.methods[1];
  closing.firstStep = { intent: '查看已采用参与者的公开记录', actionKind: 'observe' };
  closing.difficultyPolicy = { kind: 'fixed', band: 'normal' };
  closing.evidencePolicy = { kind: 'fixed', evidenceIds: [] };
  closing.evidenceAllowlist = [];
  for (const grade of ['success', 'full_success']) closing.outcomes[grade].effects.push({
    template: 'relationship_shift', fromActorId: 'pc', toActorId: 'tpl-lin', delta: 1,
  });
  closing.outcomes.severe_failure.effects.push({ template: 'relationship_shift', fromActorId: 'pc', toActorId: 'tpl-lin', delta: -1 });
  model.rewards = [{ policyId: 'closing-reward', nodeId: 'stage-1', description: '合成关系奖励',
    rewards: [{ kind: 'relationship', targetId: 'pc', toActorId: 'tpl-lin', delta: 2 }] }];
  const requests = [];
  const entries = baseEntries().map(e => e.kind === 'scene' ? { ...e, definition: { ...e.definition, actors: [] }, dependencyIds: [] } : e);
  const h = await fixture({ entries, model, includeGuidance: true, onRequest: r => requests.push(r.role) });
  t.after(() => h.db.close());
  const before = await h.turns.getState(h.branchId);
  const snapshotBefore = (await h.adapter.queryOne('SELECT snapshot_json FROM snapshots WHERE branch_id=? AND state_version=?',
    [h.branchId, before.stateVersion])).snapshot_json;
  assert.equal(Object.keys(before.actors).length, 1);
  const guidance = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId, branchId: h.branchId, sourceTurnId: 'opening', localOnly: true });
  const step = guidance.steps.find(s => s.candidateRef === `method:${SITUATION_ID}:ask-lin`);
  assert.equal(step.availability, 'available', 'a verified adopted participant can be prepared at the action boundary');
  assert.deepEqual(await h.turns.getState(h.branchId), before, 'projection never materializes actors');
  const result = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
    intent: step.firstStepIntent, guidanceChoice: { decisionPoint: guidance.decisionPoint, candidateRef: step.candidateRef } });
  const after = await h.turns.getState(h.branchId);
  assert.ok(after.actors['npc-tpl-lin']);
  assert.ok(after.cards.some(c => c.actorId === 'npc-tpl-lin' && c.card.templateId === 'tpl-lin'));
  assert.equal(after.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded');
  assert.equal(after.relationships.find(r => r.fromActorId === 'pc' && r.toActorId === 'npc-tpl-lin').closeness, 3);
  assert.ok(await h.turns.getCommittedTurn(h.branchId, result.turnId));
  assert.deepEqual(requests, ['Narrator'], 'synthetic offline Narrator only; no Planner dispatch');
  const old = (await h.adapter.queryOne('SELECT snapshot_json FROM snapshots WHERE branch_id=? AND state_version=?',
    [h.branchId, before.stateVersion])).snapshot_json;
  assert.equal(old, snapshotBefore, 'the adopted initial snapshot is immutable byte for byte');
  const query = h.adapter.queryOne.bind(h.adapter);
  h.adapter.queryOne = async (sql, args) => sql.includes("status<>'Committed'") ? { turn_id: 'frozen-original' } : query(sql, args);
  assert.equal(await h.session.prepareAdoptedSceneActors({ campaignId: h.campaignId, branchId: h.branchId }), false);
  assert.deepEqual(await h.turns.getState(h.branchId), after, 'pending turns prohibit actor setup');
});

test('BUG-95-009 every grade actor is checked even when the method cannot close a node', async t => {
  const h = await fixture(); t.after(() => h.db.close());
  const state = await h.turns.getState(h.branchId);
  const content = await h.session.loadCampaignPlanForState(h.campaignId, state);
  const method = structuredClone(content.artifacts[0].situations[0].definition.methods[0]);
  for (const grade of ['full_success', 'success', 'failure', 'severe_failure']) {
    const variant = structuredClone(method);
    variant.outcomeTemplates[grade].effects.push({ template: 'relationship_shift', fromActorId: 'pc', toActorId: 'missing-actor', delta: -1 });
    assert.equal(campaignCompletionRewardBlocker({ state, ...content, situationId: SITUATION_ID, method: variant }), 'campaign_method_actor_unavailable');
  }
  assert.equal(campaignCompletionRewardBlocker({ state, ...content, situationId: SITUATION_ID, method }), null);
});

test('BUG-95-009 preparation excludes unbound, offsite, hidden and future participants', async t => {
  const h = await fixture(); t.after(() => h.db.close());
  const state = await h.turns.getState(h.branchId);
  const content = await h.session.loadCampaignPlanForState(h.campaignId, state);
  const entries = baseEntries().filter(e => e.kind !== 'scene');
  const get = (artifacts = content.artifacts, catalog = entries) => campaignActorPreparationTemplates({ state, artifacts, entries: catalog, worldTimeOrder: 1 });
  assert.deepEqual(get().map(e => e.entryId), ['tpl-lin']);
  assert.deepEqual(get(content.artifacts.map(a => ({ ...a, artifactId: 'unbound' }))), []);
  assert.deepEqual(get(content.artifacts.map(a => ({ ...a, situations: a.situations.map(s => ({ ...s, definition: { ...s.definition, locationId: 'offsite' } })) }))), []);
  assert.deepEqual(get(content.artifacts, entries.map(e => ({ ...e, visibility: 'gm' }))), []);
  assert.deepEqual(get(content.artifacts, entries.map(e => e.kind === 'actor_template' ? { ...e, definition: { ...e.definition, recruitment: { validFromOrder: 3 } } } : e)), []);
});

function causalFixture() {
  const nodes = [3, 4, 5, 6].map((n, i) => ({ nodeId: `stage-${n}`, role: 'main',
    statusDependencies: i ? [`stage-${n-1}`] : [], situationRef: i ? null : 'opening',
    completion: { kind: 'committed_event', eventType: `stage_${n}_done` }, activation: null }));
  const plan = { lengthPreference: 'long', nodes, possibleEndings: [], startNodeIds: ['stage-3'] };
  const artifact = { situations: [{ entryId: 'opening', definition: { methods: [{ methodId: 'schedule', outcomeTemplates: {
    success: { effects: ['cons-crest-truth', 'cons-settlement'].map(consequenceId => ({ template: 'schedule_consequence', consequenceId })) },
  } }] } }], consequenceTemplates: [
    { consequenceId: 'cons-crest-truth', triggerCondition: { kind: 'campaign_node_status', nodeId: 'stage-5', status: 'succeeded' },
      effectSpecs: [{ template: 'grant_knowledge', entryId: 'crest-clue' }] },
    { consequenceId: 'cons-settlement', triggerCondition: { kind: 'committed_event', eventType: 'stage_6_done' },
      effectSpecs: [{ template: 'record_event', eventType: 'settlement_secured' }] },
  ] };
  return { plan, artifact };
}

test('BUG-95-001 aggregated exact diagnostics produce all instructions and a strict valid new causal revision', () => {
  const { plan, artifact } = causalFixture();
  const errors = validateLongCampaignConsequenceCausality(plan, artifact);
  assert.equal(errors.length, 3);
  const candidate = { stages: plan.nodes.map((n, i) => ({ nodeId: n.nodeId, role: n.role, dependsOn: n.statusDependencies, activation: i ? {} : null })),
    firstSituation: { methods: [{ outcomes: { success: artifact.situations[0].definition.methods[0].outcomeTemplates.success } }] },
    consequences: artifact.consequenceTemplates.map(c => ({ consequenceId: c.consequenceId, trigger: c.triggerCondition, effects: c.effectSpecs })) };
  const guidance = buildStructuralRepairGuidance([errors.join('; ')], candidate);
  assert.match(guidance, /consequence cons-crest-truth/);
  assert.match(guidance, /consequence cons-settlement/);
  assert.match(guidance, /距排程节点至少两段）：stage-5, stage-6/);
  assert.match(guidance, /knowledge_known.*crest-clue/);
  assert.match(guidance, /committed_event.*settlement_secured/);
  assert.match(guidance, /按新的 trigger 节点重新选择/);
  const next = structuredClone({ plan, artifact });
  next.artifact.consequenceTemplates[1].triggerCondition = { kind: 'campaign_node_status', nodeId: 'stage-6', status: 'succeeded' };
  next.plan.nodes[3].completion = { kind: 'all', of: [next.plan.nodes[3].completion, { kind: 'knowledge_known', entryId: 'crest-clue' }] };
  next.plan.possibleEndings = [{ endingId: 'new-ending', condition: { kind: 'all', of: [
    { kind: 'campaign_node_status', nodeId: 'stage-6', status: 'succeeded' }, { kind: 'committed_event', eventType: 'settlement_secured' },
  ] } }];
  assert.deepEqual(validateLongCampaignConsequenceCausality(next.plan, next.artifact), []);
  const noHardDependency = structuredClone(next); noHardDependency.plan.nodes[2].statusDependencies = [];
  assert.ok(validateLongCampaignConsequenceCausality(noHardDependency.plan, noHardDependency.artifact).some(e => e.includes('two stages')));
  const negated = structuredClone(next); negated.plan.nodes[3].completion.of[1] = { kind: 'not', of: negated.plan.nodes[3].completion.of[1] };
  assert.ok(validateLongCampaignConsequenceCausality(negated.plan, negated.artifact).some(e => e.includes('cons-crest-truth: no later')));
  assert.equal(validateLongCampaignConsequenceCausality(plan, artifact).length, 3, 'old rejected fixture remains rejected');
});

test('A15/A36 fixed content consumes ordinary preparation and a costly failure clue in distinct closing routes', async t => {
  for (const die of [4, 2]) {
    const model = candidateModel();
    const preparation = model.firstSituation.methods[0];
    preparation.difficultyPolicy = { kind: 'fixed', band: 'normal' };
    preparation.evidencePolicy = { kind: 'fixed', evidenceIds: [] };
    preparation.evidenceAllowlist = [];
    preparation.outcomes.failure.effects = [
      { template: 'resource_change', actorId: '__player__', resourceId: 'hp', amount: -1 },
      { template: 'grant_knowledge', entryId: 'lore-crates' },
    ];
    preparation.outcomes.failure.resultFact = '核查受阻并受伤，但货箱标记留下可继续核实的线索。';
    const closing = model.firstSituation.methods[1];
    closing.firstStep = { actionKind: 'observe', intent: '凭已核实的细节或货箱标记确认隐患' };
    closing.requires = { condition: { kind: 'any', of: [
      { kind: 'counter_at_least', situationId: 'self', counterId: 'evidence', minimum: 1 },
      { kind: 'knowledge_known', entryId: 'lore-crates' },
    ] } };
    closing.difficultyPolicy = { kind: 'fixed', band: 'normal' };
    closing.evidencePolicy = { kind: 'fixed', evidenceIds: [] };
    closing.evidenceAllowlist = [];
    const h = await fixture({ model, includeGuidance: true, random: { nextIntInclusive: () => die } });
    t.after(() => h.db.close());
    const choose = async id => {
      const g = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId, branchId: h.branchId, sourceTurnId: 'offline', localOnly: true });
      const s = g.steps.find(s => s.candidateRef === `method:${SITUATION_ID}:${id}`);
      return h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: s.firstStepIntent,
        guidanceChoice: { decisionPoint: g.decisionPoint, candidateRef: s.candidateRef } });
    };
    const before = await h.turns.getState(h.branchId);
    const first = await choose('sweep');
    assert.equal(first.grade, die === 4 ? 'success' : 'failure', 'fixed offline RNG, never a historical roll');
    const prepared = await h.turns.getState(h.branchId);
    assert.equal(prepared.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'active');
    if (die === 4) assert.equal(prepared.situations.find(s => s.situationId === SITUATION_ID).counters.evidence, 1);
    else {
      assert.equal(prepared.actors.pc.resources.hp, before.actors.pc.resources.hp - 1);
      assert.ok(prepared.discoveries.some(d => d.entryId === 'lore-crates'));
    }
    await choose('ask-lin');
    const after = await h.turns.getState(h.branchId);
    assert.equal(after.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded',
      'ordinary counter or failure knowledge is actually consumed by the distinct completion method');
  }
  const guide = buildStructuralRepairGuidance([
    'artifact: current stage stage-1 has no ordinary success producer for a completion route; provide success effects that satisfy completion.',
  ], candidateModel());
  assert.match(guide, /sweep, ask-lin/);
  assert.match(guide, /requires.condition 消费准备事实/);
  assert.match(guide, /不能|不要提高计数/);
});

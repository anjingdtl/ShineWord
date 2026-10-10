const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/phase9CampaignFixture.cjs');
const {
  validateCampaignPlanCausality,
  validateLaterStageCompletionIsolation,
} = require('../dist/domain/campaignPlan/causalityValidation');

function laterStage(template, nodeId, previousId, nextId, completion) {
  return {
    ...structuredClone(template),
    nodeId,
    role: 'main',
    title: nodeId,
    publicObjective: `完成 ${nodeId} 的目标`,
    gmPurpose: `只验证 ${nodeId} 的阶段证据。`,
    activation: { kind: 'campaign_node_status', nodeId: previousId, status: 'succeeded' },
    completion,
    statusDependencies: [previousId],
    nextNodeIds: nextId ? [nextId] : [],
    situationRef: undefined,
    coverage: 'provisional',
  };
}

async function longFixture() {
  const h = await fixture();
  const candidate = await h.planStore.getCandidate('cand-t');
  const plan = structuredClone(candidate.plan);
  const artifact = structuredClone(candidate.artifact);
  plan.lengthPreference = 'long';
  const stage2 = plan.nodes.find(node => node.nodeId === 'stage-2');
  stage2.nextNodeIds = ['stage-3'];
  const stage3 = laterStage(stage2, 'stage-3', 'stage-2', 'stage-4', {
    kind: 'committed_event', eventType: 'long_stage_3_completed',
  });
  const stage4 = laterStage(stage2, 'stage-4', 'stage-3', 'stage-5', {
    kind: 'knowledge_known', entryId: 'consequence-clue',
  });
  const stage5 = laterStage(stage2, 'stage-5', 'stage-4', undefined, {
    kind: 'relationship_at_least', fromActorId: 'pc', toActorId: 'npc-lin', closeness: 3,
  });
  stage2.completion = { kind: 'committed_event', eventType: 'long_stage_2_completed' };
  plan.nodes.push(stage3, stage4, stage5);
  plan.possibleEndings[0].condition = { kind: 'campaign_node_status', nodeId: 'stage-5', status: 'succeeded' };

  for (const situation of artifact.situations) for (const method of situation.definition.methods) {
    for (const outcome of Object.values(method.outcomeTemplates ?? {})) {
      outcome.effects = outcome.effects.filter(effect => effect.template !== 'schedule_consequence');
    }
  }
  const situation = artifact.situations[0];
  const [firstMethod, secondMethod] = situation.definition.methods;
  firstMethod.outcomeTemplates.success.effects.push({ template: 'schedule_consequence', consequenceId: 'consequence-one' });
  secondMethod.outcomeTemplates.success.effects.push({ template: 'schedule_consequence', consequenceId: 'consequence-two' });
  artifact.consequenceTemplates = [
    {
      consequenceId: 'consequence-one', description: '后续线索', visibility: 'public',
      triggerCondition: { kind: 'campaign_node_status', nodeId: 'stage-3', status: 'succeeded' },
      effectSpecs: [{ template: 'grant_knowledge', entryId: 'consequence-clue' }],
    },
    {
      consequenceId: 'consequence-two', description: '后续关系变化', visibility: 'public',
      triggerCondition: { kind: 'campaign_node_status', nodeId: 'stage-4', status: 'succeeded' },
      effectSpecs: [{ template: 'relationship_shift', fromActorId: 'pc', toActorId: 'npc-lin', delta: 3 }],
    },
  ];
  return { h, plan, artifact };
}

test('later main-stage completion cannot reuse the resolved opening situation', async () => {
  const h = await fixture();
  try {
    const candidate = await h.planStore.getCandidate('cand-t');
    const plan = structuredClone(candidate.plan);
    const startSituationId = plan.nodes.find(node => plan.startNodeIds.includes(node.nodeId)).situationRef;
    plan.nodes[1].completion = { kind: 'situation_status', situationId: startSituationId, status: 'resolved' };
    assert.match(validateLaterStageCompletionIsolation(plan).join(' '), /later stage cannot complete from an opening situation resolved\/suppressed marker/);
    plan.nodes[1].completion = { kind: 'committed_event', eventType: 'quest_succeeded' };
    assert.deepEqual(validateLaterStageCompletionIsolation(plan), []);
  } finally { h.db.close(); }
});

test('long plans reject unscheduled, same-action and unconsumed consequence templates', async () => {
  const { h, plan, artifact } = await longFixture();
  try {
    for (const situation of artifact.situations) for (const method of situation.definition.methods) {
      for (const outcome of Object.values(method.outcomeTemplates ?? {})) {
        outcome.effects = outcome.effects.filter(effect => effect.template !== 'schedule_consequence');
      }
    }
    const errors = validateCampaignPlanCausality(plan, artifact).join('\n');
    assert.match(errors, /no ordinary-success method schedules this consequence/);

    const situation = artifact.situations[0];
    situation.definition.methods[0].outcomeTemplates.success.effects.push({ template: 'schedule_consequence', consequenceId: 'consequence-one' });
    situation.definition.methods[1].outcomeTemplates.success.effects.push({ template: 'schedule_consequence', consequenceId: 'consequence-two' });
    artifact.consequenceTemplates[0].effectSpecs = [{ template: 'record_event', eventType: 'orphan_event', summary: '仅记录' }];
    const orphan = validateCampaignPlanCausality(plan, artifact).join('\n');
    assert.match(orphan, /no later stage or ending consumes its authoritative effect/);

    situation.definition.methods[0].outcomeTemplates.success.effects.push(
      { template: 'grant_knowledge', entryId: 'premature-clue' },
    );
    artifact.consequenceTemplates[0].triggerCondition = { kind: 'knowledge_known', entryId: 'premature-clue' };
    const immediate = validateCampaignPlanCausality(plan, artifact).join('\n');
    assert.match(immediate, /the scheduling action already satisfies its trigger/);
  } finally { h.db.close(); }
});

test('a long plan passes when distinct successful actions schedule delayed, consumed consequences', async () => {
  const { h, plan, artifact } = await longFixture();
  try {
    assert.deepEqual(validateCampaignPlanCausality(plan, artifact), []);
  } finally { h.db.close(); }
});

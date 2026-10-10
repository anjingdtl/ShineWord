const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, NOW } = require('./helpers/phase9CampaignFixture.cjs');
const { buildPlanningContext } = require('../dist/application/campaignPlan/planningService');
const { buildPlanRequestMaterials } = require('../dist/application/campaignPlan/generationService');
const { compileCampaignPlan } = require('../dist/application/campaignPlan/localCompile');
const { parseCampaignPlanCandidate } = require('../dist/application/campaignPlan/candidateModel');
const { validateCampaignPlan, validateContentArtifact } = require('../dist/domain/campaignPlan/planValidation');

const planningArgs = { anchorTitle: '开篇', playerName: '旅人', openingGoalSuggestions: [] };

function validationContext(ctx, artifact) {
  return {
    visibleWorldEntryIds: new Set(ctx.visibleEntries.map(entry => entry.entryId)),
    openingActorIds: ctx.openingActorIds,
    openingTemplateIds: ctx.openingTemplateIds,
    artifactSituationIds: new Set(artifact.situations.map(situation => situation.entryId)),
    availableFactIds: ctx.availableFactIds,
    protagonistSkills: ctx.protagonistSkills,
    protagonistSkillRanks: ctx.protagonistSkillRanks,
    presentActorRefs: ctx.presentActorRefs,
  };
}

function compile(h, intent, ctx, model, planId) {
  const parseErrors = [];
  const parsed = parseCampaignPlanCandidate(model, parseErrors);
  assert.ok(parsed, parseErrors.join('; '));
  const compiled = compileCampaignPlan({ model: parsed, intent, ctx, planId, revision: 1, parentRevision: null, createdAt: NOW });
  assert.deepEqual(compiled.errors, []);
  return compiled;
}

test('phase 9 plan prompt gives exact node-ending and deadline-safe examples', async () => {
  const h = await fixture();
  try {
    const { intent } = await h.planStore.getSetup('setup-t');
    const planning = await buildPlanningContext({ worldStore: h.worlds, intent, protagonistSkills: ['skill-observation'] });
    const materials = buildPlanRequestMaterials({ intent, ctx: planning.ctx, visibleEntries: planning.visibleEntries,
      worldTitle: planning.worldTitle, ...planningArgs });
    assert.match(materials.system, /\{"kind":"node_succeeded","nodeId":"stage-2"\}/);
    assert.match(materials.system, /结局硬门槛（逐个 ending 自检）/);
    assert.match(materials.system, /若 stage-4 是 role=main 且接在 stage-3 后/);
    assert.match(materials.system, /严禁把阶段 ID 写入 situationId/);
    assert.match(materials.system, /firstSituation 默认省略 deadlineClockSeconds/);
    assert.match(materials.system, /failure\/severe_failure 不得产生同一证据/);
    assert.match(materials.system, /每一条包含 resolved 的可完成路径/);
    assert.match(materials.system, /事实 ID 与目录条目 ID 是两个独立命名空间/);
    assert.match(materials.system, /把 factId 当 entryId/);
    assert.match(materials.system, /初始计划只能引用锚点章节及之前已进入当前冻结资料的原著事实/);
    assert.match(materials.system, /至少设计两个 trigger 和权威效果各不相同、且能在同一条可达玩家旅程中被排程的持续后果/);
    assert.match(materials.system, /至少经过两次不同的有效玩家决定/);
    assert.match(materials.system, /trigger 的每条成立路径都必须等待该调度点之后至少两段的 required main 阶段成功/);
    assert.match(materials.system, /长篇后果最小串联示例/);
    assert.match(materials.system, /stage-1→stage-2→stage-3→stage-4→stage-5/);
    assert.match(materials.system, /每个后续阶段的 completion 必须证明它自己的公开目标/);
    assert.match(materials.system, /每个 consequence 都要被一个 success\/full_success outcome 的 schedule_consequence 排程/);
    assert.match(materials.system, /允许同一普通成功 outcome 同时排程两项/);
    assert.match(materials.system, /不得分别放在同一场景互斥办法或同一办法互斥成功等级/);
    assert.match(materials.system, /至少有一个非文案效果被其触发后的下游 main 阶段 completion 或结局条件正向引用/);
    assert.match(materials.system, /不得把被关押人物写成酒馆交谈对象/);
    assert.match(materials.user, /唯一允许填写到 stages\/clues\.provenance\.sourceFactIds 的原著事实 ID/);
    assert.match(materials.user, /唯一允许填写到 clues\.sourceEntryIds 的世界目录条目 ID/);
    assert.deepEqual([...planning.ctx.availableFactIds].sort(), planning.ctx.openingFacts.map(fact => fact.factId).sort(),
      'the compiler must accept only source facts actually included in the frozen model input');
    for (const entry of planning.visibleEntries) assert.ok(materials.user.includes(entry.entryId), `catalog id must be explicit: ${entry.entryId}`);
    for (const fact of planning.ctx.openingFacts) assert.ok(materials.user.includes(fact.factId), `fact id must be explicit: ${fact.factId}`);
  } finally { h.db.close(); }
});

test('phase 9 ending references stay strict: stage IDs cannot compile as situation IDs', async () => {
  const h = await fixture();
  try {
    const { intent } = await h.planStore.getSetup('setup-t');
    const { ctx } = await buildPlanningContext({ worldStore: h.worlds, intent, protagonistSkills: ['skill-observation'] });
    const model = candidateModel();
    model.endings[0].condition = { kind: 'situation_resolved', situationId: 'stage-2' };
    const compiled = compile(h, intent, ctx, model, 'bad-ending-situation-ref');
    const errors = validateCampaignPlan(compiled.plan, validationContext(ctx, compiled.artifact), compiled.artifact);
    assert.ok(errors.some(error => error.includes('ending end-safe: situation stage-2 not in world or campaign content.')),
      errors.join('\n'));
  } finally { h.db.close(); }
});

test('phase 9 ending outcomes cannot reuse an identical completion condition', async () => {
  const h = await fixture();
  try {
    const { intent } = await h.planStore.getSetup('setup-t');
    const { ctx } = await buildPlanningContext({ worldStore: h.worlds, intent, protagonistSkills: ['skill-observation'] });
    const duplicate = candidateModel();
    duplicate.endings.push({ ...duplicate.endings[0], endingId: 'end-pyrrhic-copy', title: '同一时刻的另一结局', outcomeKind: 'pyrrhic' });
    const duplicatePlan = compile(h, intent, ctx, duplicate, 'duplicate-ending-condition');
    let errors = validateCampaignPlan(duplicatePlan.plan, validationContext(ctx, duplicatePlan.artifact), duplicatePlan.artifact);
    assert.ok(errors.some(error => error.includes('have identical conditions')), errors.join('\n'));

    const distinct = candidateModel();
    distinct.endings.push({ ...distinct.endings[0], endingId: 'end-costly-proof', title: '代价留下的证据', outcomeKind: 'pyrrhic',
      condition: { kind: 'all', of: [
        { kind: 'node_succeeded', nodeId: 'stage-2' },
        { kind: 'committed_event', eventType: 'verified_costly_choice' },
      ] } });
    const distinctPlan = compile(h, intent, ctx, distinct, 'distinct-ending-condition');
    errors = validateCampaignPlan(distinctPlan.plan, validationContext(ctx, distinctPlan.artifact), distinctPlan.artifact);
    assert.ok(!errors.some(error => error.includes('have identical conditions')), errors.join('\n'));
  } finally { h.db.close(); }
});

test('phase 9 timed completion requires evidence produced by success and absent from failure', async () => {
  const h = await fixture();
  try {
    const { intent } = await h.planStore.getSetup('setup-t');
    const { ctx } = await buildPlanningContext({ worldStore: h.worlds, intent, protagonistSkills: ['skill-observation'] });
    const clean = compile(h, intent, ctx, candidateModel(), 'deadline-success-marker');
    let errors = validateContentArtifact(clean.plan, clean.artifact, validationContext(ctx, clean.artifact));
    assert.ok(!errors.some(error => error.includes('can mistake a pressure deadline for success')), errors.join('\n'));

    const ambiguous = candidateModel();
    ambiguous.firstSituation.methods[1].outcomes.failure.effects.push({
      template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 1,
    });
    const compiledAmbiguous = compile(h, intent, ctx, ambiguous, 'deadline-failure-marker');
    errors = validateContentArtifact(compiledAmbiguous.plan, compiledAmbiguous.artifact,
      validationContext(ctx, compiledAmbiguous.artifact));
    assert.ok(errors.some(error => error.includes('can mistake a pressure deadline for success')), errors.join('\n'));

    const failureOnly = candidateModel();
    for (const method of failureOnly.firstSituation.methods) {
      for (const grade of ['success', 'full_success']) {
        method.outcomes[grade].effects = method.outcomes[grade].effects.filter(effect =>
          !(effect.template === 'situation_counter' && effect.counterId === 'evidence'));
      }
    }
    failureOnly.firstSituation.methods[0].outcomes.failure.effects.push({
      template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 1,
    });
    const compiledFailureOnly = compile(h, intent, ctx, failureOnly, 'deadline-failure-only-marker');
    errors = validateContentArtifact(compiledFailureOnly.plan, compiledFailureOnly.artifact,
      validationContext(ctx, compiledFailureOnly.artifact));
    assert.ok(errors.some(error => error.includes('can mistake a pressure deadline for success')), errors.join('\n'));
  } finally { h.db.close(); }
});

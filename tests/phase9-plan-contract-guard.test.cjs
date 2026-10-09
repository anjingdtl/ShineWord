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
    assert.match(materials.system, /严禁把阶段 ID 写入 situationId/);
    assert.match(materials.system, /firstSituation 默认省略 deadlineClockSeconds/);
    assert.match(materials.system, /failure\/severe_failure 不得产生同一证据/);
    assert.match(materials.system, /每一条包含 resolved 的可完成路径/);
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

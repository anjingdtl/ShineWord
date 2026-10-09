const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, NOW } = require('./helpers/phase9CampaignFixture.cjs');
const { parseCampaignPlanCandidate } = require('../dist/application/campaignPlan/candidateModel');
const { buildPlanningContext } = require('../dist/application/campaignPlan/planningService');
const { compileCampaignPlan } = require('../dist/application/campaignPlan/localCompile');

test('stage provenance: malformed citations cannot be coerced into design supplements', () => {
  for (const change of [m => { delete m.stages[0].provenance; },
    m => { m.stages[0].provenance.kind = 'explicit'; },
    m => { m.stages[0].provenance.sourceFactIds = [123]; },
    m => { m.stages[0].provenance.rationale = {}; }]) {
    const model = candidateModel(); change(model); const errors = [];
    assert.equal(parseCampaignPlanCandidate(model, errors), null);
    assert.match(errors.join(' '), /provenance/);
  }
});

test('stage provenance: all original citations must close locally; honest supplements retain their meaning', async () => {
  const h = await fixture();
  try {
    const { intent } = await h.planStore.getSetup('setup-t');
    const { ctx } = await buildPlanningContext({ worldStore: h.worlds, intent, protagonistSkills: ['skill-observation'] });
    const compile = provenance => {
      const model = candidateModel(); model.stages[0].provenance = provenance;
      const parsed = parseCampaignPlanCandidate(model, []); assert.ok(parsed);
      return compileCampaignPlan({ model: parsed, intent, ctx, planId: 'provenance-test', revision: 1, parentRevision: null, createdAt: NOW });
    };
    const factId = [...ctx.availableFactIds][0]; assert.ok(factId);
    for (const p of [
      { kind: 'canon_inspired', sourceFactIds: [], rationale: '空的原著声明' },
      { kind: 'canon_inspired', sourceFactIds: ['unknown-fact'], rationale: '虚假的原著引用' },
      { kind: 'canon_inspired', sourceFactIds: [factId, 'unknown-fact'], rationale: '部分真实不掩盖虚假引用' },
      { kind: 'design_fill', sourceFactIds: [factId], rationale: '创作补充不能攀附原著引用' },
    ]) assert.match(compile(p).errors.join(' '), /stage.*provenance/);
    const honest = { kind: 'design_fill', sourceFactIds: [], rationale: '新增的调查过程' };
    const output = compile(honest); assert.deepEqual(output.errors, []);
    assert.deepEqual(output.plan.nodes[0].provenance, honest);
    const grounded = compile({ kind: 'canon_inspired', sourceFactIds: [factId], rationale: '沿用已核实的开局事实' });
    assert.deepEqual(grounded.errors, []);
    assert.equal(grounded.plan.nodes[0].provenance.kind, 'canon_inspired');
    assert.deepEqual(grounded.plan.nodes[0].provenance.sourceFactIds, [factId]);
  } finally { h.db.close(); }
});

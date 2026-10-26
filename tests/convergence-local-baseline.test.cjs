/**
 * Local baseline plan (convergence W3, acceptance C-06/C-07).
 *
 * The baseline model must pass the SAME compile + validate pipeline as an
 * LLM candidate on >=3 world-fixture variants (including the 'long'
 * preference's delayed-consequence demands), and after adoption every first-
 * situation method must be L1-ready with explicit fixed policies.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, baseEntries, NOW } = require('./helpers/phase9CampaignFixture.cjs');
const { buildPlanningContext } = require('../dist/application/campaignPlan/planningService');
const { buildLocalBaselineModel, localBaselineCandidateIdentity } = require('../dist/application/campaignPlan/localBaselinePlan');
const { compileAndValidateCandidate } = require('../dist/application/campaignPlan/candidateCompile');
const { frozenPlanJob } = require('../dist/application/campaignPlan/jobFreeze');
const { adoptOpeningPlan } = require('../dist/application/campaignPlan/adoption');
const { isIntactReadyCandidate } = require('../dist/application/campaignPlan/candidateIntegrity');
const { evaluateLocalCompileReadiness } = require('../dist/application/game/localCompileReadiness');
const { canonicalJsonOf, sha256HexOf } = require('../dist/application/campaignPlan/hashing');

const PROFILE = { id: 'default', endpoint: 'https://example.invalid', model: 'test', keyRef: 'k', reasoningTier: 'low',
  capabilities: { contextWindow: 60000, maxOutputTokens: 12000, supportsJson: true } };

function baselineIntent(packageRevision, packageContentHash, lengthPreference) {
  return {
    schemaVersion: 'campaign-intent-1', setupId: `setup-baseline-${lengthPreference}`, intentRevision: 1,
    rawIntent: '查明眼前的局势并推进目标', normalizedIntent: '查明眼前的局势并推进目标', goalMode: 'declared',
    protagonistBinding: { actorId: 'pc', kind: 'original', name: '旅人' },
    openingAnchor: { worldTimeOrder: 1, locationId: '青石巷' },
    companionBindings: [], lengthPreference, userConstraints: [], requestedCanonTargets: [],
    knowledgePolicy: 'anchor_projection',
    sourceCoverageBinding: { worldId: 'w', packageRevision, coverageWorldTimeOrder: 1, packageContentHash },
    createdAt: NOW,
  };
}

async function compileBaselineFor(worlds, lengthPreference, entries) {
  const pkg = await worlds.getWorldPackage('w', (await worlds.getPublishedPackageRevision('w')));
  const intent = baselineIntent(pkg.manifest.revision, pkg.manifest.contentHash, lengthPreference);
  const { ctx } = await buildPlanningContext({ worldStore: worlds, intent, protagonistSkills: ['skill-observation'] });
  const model = buildLocalBaselineModel({ ctx, intent, anchorTitle: '序1 · 开局时刻', worldTitle: '三宝书' });
  const frozen = frozenPlanJob(intent, PROFILE, { system: '', user: '' }, ctx);
  const { compiled, errors } = compileAndValidateCandidate(frozen, model, {
    jobId: 'job-baseline', setupId: intent.setupId, branchId: null, now: () => NOW, committedEvents: [],
  });
  return { intent, ctx, model, compiled, errors };
}

async function adoptBaseline(adapter, planStore, worlds, intent, compiled, model) {
  await planStore.upsertSetup({ setupId: intent.setupId, worldId: 'w', packageRevision: intent.sourceCoverageBinding.packageRevision,
    intent, intentHistory: [intent], currentCandidateId: null, status: 'planning', createdAt: NOW, updatedAt: NOW });
  await planStore.insertJob({
    jobId: `job-${intent.setupId}`, setupId: intent.setupId, campaignId: null, branchId: null, jobKind: 'opening_plan',
    triggerReasons: ['user_requested'], baseStateVersion: null, basePlanId: null, basePlanRevision: null,
    intentHash: sha256HexOf(canonicalJsonOf(intent)), contentManifestHash: null, knowledgePolicyHash: null, triggerEventRefs: [],
    status: 'candidate_ready', leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, attemptCount: 1,
    nextRetryAt: null, physicalRequestBudget: 0, freezeRootId: null, lastError: null, createdAt: NOW, updatedAt: NOW,
  });
  const { rawResponseText, candidateHash } = localBaselineCandidateIdentity(model, compiled.plan, compiled.artifact);
  const candidateId = `cand-${intent.setupId}`;
  await planStore.upsertCandidate({
    candidateId, jobId: `job-${intent.setupId}`, setupId: intent.setupId, attemptGroup: 'a1', attemptNo: 1,
    stage: 'ready', rawResponseRef: 'local-baseline-1', rawResponseText, parseResultJson: JSON.stringify(model),
    validationErrors: [], repairUsed: false, candidateHash,
    plan: compiled.plan, artifact: compiled.artifact, createdAt: NOW, updatedAt: NOW,
  });
  await adapter.execute("UPDATE campaign_setups SET status='proposal_ready', current_candidate_id=? WHERE setup_id=?", [candidateId, intent.setupId]);
  const adopted = await adoptOpeningPlan({
    db: adapter, planStore, setupId: intent.setupId, candidateId,
    create: {
      db: adapter, worldStore: worlds, campaignId: 'c-baseline', title: '本地基线', worldId: 'w',
      packageRevision: intent.sourceCoverageBinding.packageRevision,
      anchor: { worldTimeOrder: 1, locationId: '青石巷' },
      protagonist: { actorId: 'pc', kind: 'original', name: '旅人',
        attributes: { physique: 1, agility: 1, insight: 3, knowledge: 1, willpower: 1, social: 1 },
        initialSkills: ['skill-observation'] },
      companions: [], goal: '查明眼前的局势', createdAt: NOW,
    },
  });
  return { candidateId, adopted };
}

test('C-06 local baseline passes every validator on the default fixture world (short)', async () => {
  const f = await fixture();
  const { errors } = await compileBaselineFor(f.worlds, 'short');
  assert.deepEqual(errors, [], JSON.stringify(errors));
});

test('C-06 local baseline passes on the same world with medium preference and a diplomacy skill (variant B)', async () => {
  const entries = [...baseEntries(),
    { entryId: 'skill-diplomacy', kind: 'skill', revision: 0, provenance: { kind: 'explicit', sourceFactIds: [], rationale: 'f' },
      fieldProvenance: {}, visibility: 'public', dependencyIds: [], definition: { name: '交涉', description: '与人交谈', attribute: 'social', allowUntrained: true, powerTier: 'ordinary', usage: 'social' } }];
  const f = await fixture({ entries });
  const { errors, model } = await compileBaselineFor(f.worlds, 'medium');
  assert.deepEqual(errors, [], JSON.stringify(errors));
  assert.equal(model.firstSituation.methods.length, 3, 'survey + ask + engage');
});

test('C-06 local baseline satisfies the long-preference delayed-consequence causality gate (variant C)', async () => {
  const f = await fixture();
  const { errors, model } = await compileBaselineFor(f.worlds, 'long');
  assert.deepEqual(errors, [], JSON.stringify(errors));
  assert.equal(model.consequences.length, 2);
});

test('C-06 local baseline passes on a clue-bearing scene world (variant D)', async () => {
  const entries = baseEntries().map(entryIn => entryIn.entryId === 'scene-alley'
    ? { ...entryIn, definition: { ...entryIn.definition, clues: ['lore-crates'] } }
    : entryIn);
  const f = await fixture({ entries });
  const { errors } = await compileBaselineFor(f.worlds, 'short');
  assert.deepEqual(errors, [], JSON.stringify(errors));
});

test('C-06/C-07 baseline candidate is intact and every first-situation method is L1-ready after adoption', async () => {
  const f = await fixture();
  const { intent, ctx, compiled, model } = await compileBaselineFor(f.worlds, 'medium');
  const { candidateId, adopted } = await adoptBaseline(f.adapter, f.planStore, f.worlds, intent, compiled, model);
  const candidate = await f.planStore.getCandidate(candidateId);
  assert.ok(isIntactReadyCandidate(candidate), 'adopted local candidate stays integrity-checkable');
  assert.ok(adopted.campaign.branchId);

  const state = await f.turns.getState(adopted.campaign.branchId);
  assert.ok(state, 'branch state exists after adoption');
  // L1 must be judged against the STORED artifacts the branch actually binds
  // (adoption re-keys the artifact id), exactly like the production session.
  const { readBoundCampaignArtifacts } = require('../dist/application/campaignPlan/boundArtifacts');
  const storedArtifacts = await readBoundCampaignArtifacts(f.adapter, 'c-baseline', state.campaignContentBinding);
  const boundArtifact = storedArtifacts.find(a => state.campaignContentBinding.artifactIds.includes(a.artifactId));
  assert.ok(boundArtifact, 'stored artifact resolvable');
  const storedPlan = (await f.planStore.getPlanRevision(compiled.plan.planId, compiled.plan.revision))?.plan ?? compiled.plan;
  const situation = boundArtifact.situations[0];
  for (const method of situation.definition.methods) {
    assert.equal(method.difficultyPolicy?.kind, 'fixed', `${method.methodId} fixed difficulty`);
    assert.equal(method.evidencePolicy?.kind, 'fixed', `${method.methodId} fixed evidence`);
    assert.deepEqual([...(method.evidencePolicy?.evidenceIds ?? [])], [], `${method.methodId} explicit no-evidence`);
    assert.match(method.ruleBindingHash ?? '', /^[a-f0-9]{64}$/);
    const readiness = evaluateLocalCompileReadiness({
      state, plan: storedPlan, artifacts: storedArtifacts,
      situationDefinitions: [{ situationId: situation.entryId, definition: situation.definition }],
      selectedMethods: situation.definition.methods.map(m => ({ situationId: situation.entryId, method: m })),
      selectedMethodRef: { situationId: situation.entryId, methodId: method.methodId },
      candidateRef: `method:${situation.entryId}:${method.methodId}`,
      turnId: 'turn-l1-check', playerIntent: method.firstStep.intent,
      playerCard: state.cards.find(card => card.card.actorId === 'pc').card,
      cards: state.cards.map(row => row.card), entries: [...ctx.visibleEntries],
    });
    assert.equal(readiness.kind, 'ready', `${method.methodId} must be L1-ready, got ${readiness.kind}${readiness.kind === 'refused' ? ':' + readiness.code : ''}`);
  }
});

test('C-06 honest provenance: every stage is design_fill with no fabricated fact citations', async () => {
  const f = await fixture();
  const { model } = await compileBaselineFor(f.worlds, 'short');
  for (const stage of model.stages) {
    assert.equal(stage.provenance.kind, 'design_fill');
    assert.deepEqual(stage.provenance.sourceFactIds ?? [], []);
  }
  assert.match(model.proposal.publicPitch, /本地基线/);
});

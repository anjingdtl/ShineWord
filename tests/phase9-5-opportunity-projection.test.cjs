'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, baseEntries, SITUATION_ID } = require('./helpers/phase9CampaignFixture.cjs');
const { projectNarrativeOpportunities } = require('../dist/application/campaignPlan/opportunityProjection');
const { validateUnconsumedSuccessEventMethods } = require('../dist/domain/campaignPlan/causalityValidation');
const { campaignSituationEntries } = require('../dist/application/campaignPlan/contentResolver');
const { collectAllowedCandidates } = require('../dist/application/guidance/candidates');
const { buildSituationPacket } = require('../dist/application/guidance/packet');
const { assembleTurnGuidance } = require('../dist/application/guidance/validate');
const { campaignMethodEventConsumerBlocker } = require('../dist/application/campaignPlan/routeReadiness');

async function projectionContext(h) {
  const state = await h.turns.getState(h.branchId);
  const summary = await h.session.getSummary(h.campaignId, h.branchId);
  const binding = state.campaignRuntime.planBinding;
  const { plan } = await h.planStore.getPlanRevision(binding.planId, binding.revision);
  const artifacts = await Promise.all((state.campaignContentBinding?.artifactIds ?? plan.contentArtifactRefs)
    .map(id => h.planStore.getArtifact(id)));
  const playerCard = summary.cards.find(card => card.controller === 'player');
  const situations = artifacts.flatMap(artifact => artifact.situations.map(situation => ({
    situationId: situation.entryId, definition: situation.definition,
  })));
  return {
    state,
    plan,
    artifacts,
    situationDefinitions: situations,
    playerCard,
    cards: summary.cards,
    entries: [...baseEntries(), ...artifacts.flatMap(campaignSituationEntries)],
  };
}

test('M2 projection discovers the active public node and preserves all authored routes for its target', async t => {
  const h = await fixture();
  t.after(() => h.db.close());
  const context = await projectionContext(h);
  const before = JSON.stringify(context.state);
  const projection = projectNarrativeOpportunities(context);

  assert.equal(projection.status, 'ready');
  assert.equal(projection.primarySituationId, SITUATION_ID);
  assert.equal(projection.opportunities.length, 1);
  const opportunity = projection.opportunities[0];
  assert.equal(opportunity.nodeId, 'stage-1');
  assert.equal(opportunity.title, '查明隐患');
  assert.equal(opportunity.objective, '弄清青石巷里发生了什么');
  assert.deepEqual(opportunity.routes.map(route => route.methodId), ['sweep', 'ask-lin']);
  assert.equal(opportunity.routes.every(route => route.available), true);
  assert.equal(JSON.stringify(context.state), before, 'projection is read-only');
});

test('M2 projection retains a bound situation artifact across a plan-only replan revision', async t => {
  const h = await fixture();
  t.after(() => h.db.close());
  const context = await projectionContext(h);
  const state = structuredClone(context.state);
  const plan = structuredClone(context.plan);
  plan.revision += 1;
  plan.contentHash = 'replanned-content-hash';
  state.campaignRuntime.planBinding = {
    ...state.campaignRuntime.planBinding,
    revision: plan.revision,
    contentHash: plan.contentHash,
  };

  const projection = projectNarrativeOpportunities({ ...context, state, plan });

  assert.equal(context.artifacts[0].planRevision, plan.revision - 1,
    'the retained authored content belongs to its immutable source revision');
  assert.ok(plan.contentArtifactRefs.includes(context.artifacts[0].artifactId),
    'the new plan revision explicitly retains the artifact reference');
  assert.equal(projection.status, 'ready');
  assert.equal(projection.primarySituationId, SITUATION_ID);
  assert.equal(projection.opportunities[0].routes.length, 2);
});

test('M2 projection retains a bound active-node artifact when replanning changes plan id', async t => {
  const h = await fixture();
  t.after(() => h.db.close());
  const context = await projectionContext(h);
  const state = structuredClone(context.state);
  const plan = structuredClone(context.plan);
  plan.planId = 'plan-replan-with-retained-active-node';
  plan.revision += 1;
  plan.contentHash = 'replanned-content-hash-with-new-id';
  state.campaignRuntime.planBinding = {
    ...state.campaignRuntime.planBinding,
    planId: plan.planId,
    revision: plan.revision,
    contentHash: plan.contentHash,
  };

  const projection = projectNarrativeOpportunities({ ...context, state, plan });

  assert.notEqual(context.artifacts[0].planId, plan.planId,
    'retained authored content keeps the plan id of its immutable source revision');
  assert.ok(plan.contentArtifactRefs.includes(context.artifacts[0].artifactId),
    'the new plan explicitly retains the source artifact');
  assert.equal(projection.status, 'ready');
  assert.equal(projection.primarySituationId, SITUATION_ID);
  assert.equal(projection.opportunities[0].routes.length, 2);
});

test('M2 keeps a completion route visible when blockers hide it from the full guidance list', async t => {
  const h = await fixture();
  t.after(() => h.db.close());
  const context = await projectionContext(h);
  const state = structuredClone(context.state);
  const plan = structuredClone(context.plan);
  const externalSituationId = 'situation-required-by-stage-completion';
  state.situations.push({ ...structuredClone(state.situations[0]), situationId: externalSituationId });
  const completion = plan.nodes.find(node => node.nodeId === 'stage-1').completion;
  completion.of.find(condition => condition.kind === 'situation_status').situationId = externalSituationId;
  const artifacts = structuredClone(context.artifacts);
  const definition = artifacts[0].situations[0].definition;
  const closeRoute = definition.methods.find(method => method.methodId === 'ask-lin');
  closeRoute.requires.knowledgeEntryId = 'lore-crates';
  for (const grade of ['success', 'full_success']) {
    closeRoute.outcomeTemplates[grade].effects.find(effect => effect.template === 'situation_status')
      .situationId = externalSituationId;
  }
  const counterRoutes = [1, 2, 3].map(index => ({
    ...structuredClone(definition.methods.find(method => method.methodId === 'sweep')),
    methodId: `counter-route-${index}`,
    title: `查看现场 ${index}`,
    goal: '从现场获取更多信息',
  }));
  definition.methods = [...counterRoutes, ...definition.methods];
  const situationDefinitions = context.situationDefinitions.map(item => item.situationId === SITUATION_ID
    ? { ...item, definition } : item);

  const projection = projectNarrativeOpportunities({ ...context, state, plan, artifacts, situationDefinitions });
  const closeRef = `method:${SITUATION_ID}:ask-lin`;
  const closeProjection = projection.opportunities[0].routes.find(route => route.candidateRef === closeRef);
  assert.equal(closeProjection.available, false, 'the closure method is visible with its unmet knowledge prerequisite');
  assert.deepEqual(projection.preferredCandidateRef, closeRef,
    'the method that supplies a missing resolved status in the node completion condition outranks counter-only routes');

  const prepared = { branchId: h.branchId, nextState: state, domainEvents: [], lifeEvents: [], extraEvents: [] };
  const summary = await h.session.getSummary(h.campaignId, h.branchId);
  const packet = buildSituationPacket({ prepared, situationDefinitions, playerCard: context.playerCard,
    visibleActorNames: new Map(), cards: summary.cards, entries: context.entries, opportunityProjection: projection });
  const modelSuggestions = counterRoutes.slice(0, 3).map(method => {
    const candidate = packet.allowedCandidates.find(item => item.ref === `method:${SITUATION_ID}:${method.methodId}`);
    assert.ok(candidate);
    return { candidateRef: candidate.ref, title: candidate.title, rationale: candidate.goal,
      tradeoffs: candidate.tradeoffs, firstStepIntent: candidate.firstStepIntent };
  });
  const guidance = assembleTurnGuidance({ prepared, contract: { turnId: 'local' }, grade: 'success',
    llmSteps: modelSuggestions, llmSummary: null, packet, campaignId: h.campaignId, playerActorId: 'pc',
    blockedNames: [], situationDefinitions, playerCard: context.playerCard, visibleActorNames: new Map(),
    contentBindingHash: 'h', knowledgeHash: 'k', contextHash: 'c' });
  assert.equal(guidance.steps.length, 3);
  assert.equal(guidance.steps[0].candidateRef, closeRef);
  assert.equal(guidance.steps[0].availability, 'needs_preparation');
  assert.ok(guidance.steps[0].blockers.some(blocker => blocker.includes('线索')));
});

test('M2 prioritizes an authored event-producing route required by the active stage', async t => {
  const h = await fixture();
  t.after(() => h.db.close());
  const context = await projectionContext(h);
  const plan = structuredClone(context.plan);
  plan.nodes.find(node => node.nodeId === 'stage-1').completion = {
    kind: 'committed_event', eventType: 'stage_work_completed',
  };
  const artifacts = structuredClone(context.artifacts);
  const definition = artifacts[0].situations[0].definition;
  const completionRoute = definition.methods.find(method => method.methodId === 'ask-lin');
  completionRoute.requires.knowledgeEntryId = 'lore-crates';
  for (const grade of ['success', 'full_success']) completionRoute.outcomeTemplates[grade].effects.push({
    template: 'record_event', eventType: 'stage_work_completed', summary: '阶段所需事件',
  });
  const counterRoutes = [1, 2, 3].map(index => ({
    ...structuredClone(definition.methods.find(method => method.methodId === 'sweep')),
    methodId: `event-decoy-${index}`,
    title: `现场行动 ${index}`,
  }));
  definition.methods = [...counterRoutes, ...definition.methods];
  const situationDefinitions = context.situationDefinitions.map(item => item.situationId === SITUATION_ID
    ? { ...item, definition } : item);
  const projection = projectNarrativeOpportunities({ ...context, plan, artifacts, situationDefinitions });
  const completionRef = `method:${SITUATION_ID}:ask-lin`;
  assert.equal(projection.preferredCandidateRef, completionRef);

  const prepared = { branchId: h.branchId, nextState: context.state, domainEvents: [], lifeEvents: [], extraEvents: [] };
  const summary = await h.session.getSummary(h.campaignId, h.branchId);
  const packet = buildSituationPacket({ prepared, situationDefinitions, playerCard: context.playerCard,
    visibleActorNames: new Map(), cards: summary.cards, entries: context.entries, opportunityProjection: projection });
  const modelSuggestions = counterRoutes.map(method => {
    const candidate = packet.allowedCandidates.find(item => item.ref === `method:${SITUATION_ID}:${method.methodId}`);
    assert.ok(candidate);
    return { candidateRef: candidate.ref, title: candidate.title, rationale: candidate.goal,
      tradeoffs: candidate.tradeoffs, firstStepIntent: candidate.firstStepIntent };
  });
  const guidance = assembleTurnGuidance({ prepared, contract: { turnId: 'local-event' }, grade: 'success',
    llmSteps: modelSuggestions, llmSummary: null, packet, campaignId: h.campaignId, playerActorId: 'pc',
    blockedNames: [], situationDefinitions, playerCard: context.playerCard, visibleActorNames: new Map(),
    contentBindingHash: 'h', knowledgeHash: 'k', contextHash: 'c' });
  assert.equal(guidance.steps.length, 3);
  assert.equal(guidance.steps[0].candidateRef, completionRef);
});

test('M2 projection applies the current item, ability, knowledge, relationship, actor, and skill gates', async t => {
  const h = await fixture();
  t.after(() => h.db.close());
  const context = await projectionContext(h);
  const artifacts = structuredClone(context.artifacts);
  const definition = artifacts[0].situations[0].definition;
  const sweep = definition.methods.find(method => method.methodId === 'sweep');
  sweep.requires = {
    ...sweep.requires,
    skillId: 'skill-observation', minRank: 'untrained', itemId: 'item-kit',
    knowledgeEntryId: 'lore-crates', relationshipTo: 'tpl-lin', minCloseness: 2,
    actorAlive: 'tpl-lin', actorAt: { actorId: 'tpl-lin', locationId: context.state.actors.pc.locationId },
  };
  sweep.firstStep.abilityId = 'ability-sweep';

  const situationDefinitions = context.situationDefinitions.map(item => item.situationId === SITUATION_ID
    ? { ...item, definition } : item);
  let projection = projectNarrativeOpportunities({ ...context, artifacts, situationDefinitions });
  let route = projection.opportunities[0].routes.find(item => item.methodId === 'sweep');
  assert.equal(route.available, false);
  assert.ok(route.blockers.some(blocker => blocker.includes('物品')));
  assert.ok(route.blockers.some(blocker => blocker.includes('能力')));
  assert.ok(route.blockers.some(blocker => blocker.includes('线索')));
  assert.ok(route.blockers.some(blocker => blocker.includes('关系')));

  const state = structuredClone(context.state);
  state.itemOwners['item-kit'] = 'pc';
  state.discoveries = [...(state.discoveries ?? []), { entryId: 'lore-crates', actorId: 'pc',
    knownAtStateVersion: state.stateVersion, sourceTurnId: 'fixture', knownVia: 'witnessed' }];
  state.relationships = [...(state.relationships ?? []), { relId: 'pc-lin', fromActorId: 'pc',
    toActorId: 'npc-tpl-lin', closeness: 2, updatedTurnId: 'fixture' }];
  const cards = structuredClone(context.cards);
  const playerCard = cards.find(card => card.actorId === 'pc');
  playerCard.abilities.push('ability-sweep');
  projection = projectNarrativeOpportunities({ ...context, state, cards, playerCard, artifacts, situationDefinitions });
  route = projection.opportunities[0].routes.find(item => item.methodId === 'sweep');
  assert.equal(route.available, true, `all declared prerequisites are now satisfied in the snapshot: ${route.blockers.join('; ')}`);
  assert.deepEqual(route.blockers, []);
});

test('M2 groups identical action gestures without collapsing method identities and offers a legal alternative after failure', async t => {
  const h = await fixture();
  t.after(() => h.db.close());
  const context = await projectionContext(h);
  const artifacts = structuredClone(context.artifacts);
  const methods = artifacts[0].situations[0].definition.methods;
  methods[1].firstStep = structuredClone(methods[0].firstStep);
  methods[1].title = methods[0].title;
  const situationDefinitions = context.situationDefinitions.map(item => item.situationId === SITUATION_ID
    ? { ...item, definition: artifacts[0].situations[0].definition } : item);

  const failed = `method:${SITUATION_ID}:sweep`;
  const projection = projectNarrativeOpportunities({ ...context, artifacts, situationDefinitions, failedMethodRef: failed });
  const opportunity = projection.opportunities[0];
  assert.deepEqual(opportunity.routes.map(route => route.methodId), ['ask-lin', 'sweep']);
  assert.equal(projection.preferredCandidateRef, `method:${SITUATION_ID}:ask-lin`);
  assert.equal(opportunity.routeGroups.length, 1, 'the duplicate visible gesture is grouped');
  assert.deepEqual(new Set(opportunity.routeGroups[0].candidateRefs), new Set([
    `method:${SITUATION_ID}:sweep`, `method:${SITUATION_ID}:ask-lin`,
  ]), 'the group keeps both authored routes and their distinct frozen effects');
  const candidates = collectAllowedCandidates({ situationDefinitions, context: {
    state: context.state,
    playerCard: context.playerCard,
    cardsByName: new Map(context.cards.map(card => [card.actorId, card])),
    entries: context.entries,
    situationStatuses: new Map(context.state.situations.map(item => [item.situationId, item])),
    causalWorldTimeOrder: context.state.causalWorldTimeOrder ?? 0,
  } });
  assert.ok(candidates.some(candidate => candidate.ref.endsWith(':sweep')));
  assert.ok(candidates.some(candidate => candidate.ref.endsWith(':ask-lin')),
    'the player/Narrator candidate list retains each explicit route reference');
});

test('M2 prioritizes the primary node before an unlocked successor and records merge edges', async t => {
  const h = await fixture();
  t.after(() => h.db.close());
  const context = await projectionContext(h);
  const state = structuredClone(context.state);
  const plan = structuredClone(context.plan);
  const artifacts = structuredClone(context.artifacts);
  const next = plan.nodes.find(node => node.nodeId === 'stage-2');
  next.coverage = 'concrete';
  next.situationRef = 'situation-stage-2';
  next.alternativeNodeIds = ['stage-1'];
  state.campaignRuntime.nodeStates.find(node => node.nodeId === 'stage-2').status = 'active';
  state.situations.push({ ...structuredClone(state.situations[0]), situationId: 'situation-stage-2' });
  artifacts[0].situations.push({ entryId: 'situation-stage-2', nodeId: 'stage-2',
    definition: structuredClone(artifacts[0].situations[0].definition) });
  const situationDefinitions = [...context.situationDefinitions, {
    situationId: 'situation-stage-2', definition: artifacts[0].situations.at(-1).definition,
  }];

  const projection = projectNarrativeOpportunities({ ...context, state, plan, artifacts, situationDefinitions });
  assert.deepEqual(projection.opportunities.map(item => item.nodeId), ['stage-1', 'stage-2']);
  assert.deepEqual(projection.opportunities[1].incomingNodeIds, ['stage-1']);
  assert.equal(projection.opportunities[0].priority < projection.opportunities[1].priority, true);
});

test('M2 reports content shortage and natural endings without inventing progress', async t => {
  const h = await fixture();
  t.after(() => h.db.close());
  const context = await projectionContext(h);
  const missing = projectNarrativeOpportunities({ ...context, artifacts: [] });
  assert.equal(missing.status, 'content_gap');
  assert.match(missing.feedback, /没有已准备好的可行动剧情内容/);
  assert.equal(missing.opportunities.length, 0);

  const hiddenPlan = structuredClone(context.plan);
  const activeNode = hiddenPlan.nodes.find(node => node.nodeId === 'stage-1');
  activeNode.visibility = 'gm';
  activeNode.title = 'GM-SECRET-DO-NOT-SHOW';
  const hidden = projectNarrativeOpportunities({ ...context, plan: hiddenPlan });
  assert.equal(hidden.status, 'content_gap');
  assert.equal(JSON.stringify(hidden).includes('GM-SECRET'), false, 'hidden plan text never enters the player projection');

  const endedState = structuredClone(context.state);
  endedState.campaignRuntime.campaignStatus = 'completed';
  endedState.campaignRuntime.ending = { endingId: 'end-safe', title: '巷子重归平静',
    outcomeKind: 'success', atStateVersion: endedState.stateVersion, turnId: 'turn-end' };
  const ended = projectNarrativeOpportunities({ ...context, state: endedState });
  assert.equal(ended.status, 'terminal');
  assert.equal(ended.opportunities.length, 0);
  assert.match(ended.feedback, /巷子重归平静/);
});

test('M2 puts a legal authored alternative first after failure and reports the unprepared successor', async t => {
  const requests = [];
  let narratorSuggestions = [];
  const provider = {
    async complete(request) {
      requests.push(request.role);
      const value = JSON.parse(request.user);
      if (request.role === 'Planner') {
        const talk = String(value.playerIntent).includes('打听');
        return { text: JSON.stringify({
          proposalVersion: '2.0', turnId: value.turnId,
          expectedStateVersion: value.expectedStateVersion, actorId: 'pc',
          actionKind: talk ? 'talk' : 'skill_check',
          ...(talk ? {} : { skillId: 'skill-observation', difficultyBand: 'peak' }),
          evidenceIds: [], intent: value.playerIntent,
          candidateRef: `method:${SITUATION_ID}:${talk ? 'ask-lin' : 'sweep'}`,
        }) };
      }
      const candidates = value.situationPacket?.allowedCandidates ?? [];
      if (narratorSuggestions.length === 0) {
        const failed = candidates.find(candidate => candidate.ref === `method:${SITUATION_ID}:sweep`);
        const alternate = candidates.find(candidate => candidate.ref === `method:${SITUATION_ID}:ask-lin`);
        assert.ok(failed && alternate, 'both the failed and alternate methods reach the Narrator packet');
        narratorSuggestions = [failed.ref, alternate.ref];
        return { text: JSON.stringify({ turnId: value.turnId, outcomeGrade: value.outcomeGrade, text: '受控叙事桩',
          nextSteps: [failed, alternate].map(candidate => ({ candidateRef: candidate.ref, title: candidate.title,
            rationale: candidate.goal, tradeoffs: candidate.tradeoffs, firstStepIntent: candidate.firstStepIntent })) }) };
      }
      return { text: JSON.stringify({ turnId: value.turnId, outcomeGrade: value.outcomeGrade, text: '受控叙事桩' }) };
    },
  };
  const h = await fixture({ provider, random: { nextIntInclusive: () => 6 } });
  t.after(() => h.db.close());

  const failed = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
    intent: '仔细查看青石巷现场，寻找值得注意的细节与线索' });
  assert.equal(failed.grade, 'severe_failure');
  assert.deepEqual(narratorSuggestions, [`method:${SITUATION_ID}:sweep`, `method:${SITUATION_ID}:ask-lin`],
    'the Narrator deliberately suggests the failed path first');
  assert.equal(failed.guidance.steps[0].candidateRef, `method:${SITUATION_ID}:ask-lin`);
  assert.equal(failed.guidance.steps.some(step => step.candidateRef === `method:${SITUATION_ID}:sweep`), true,
    'the failed route remains visible after an alternate, rather than becoming a permanent lockout');

  const merged = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
    intent: '向林凡打听青石巷最近的情况' });
  assert.equal(merged.grade, 'automatic');
  assert.ok(merged.guidance.situationSummary.opportunities.some(text => text.includes('没有已准备好的可行动剧情内容')),
    'the available stage is explicit about missing concrete successor content');
  assert.deepEqual(requests, ['Planner', 'Narrator', 'Planner', 'Narrator'],
    'the projection adds no model request and makes no hidden campaign-plan dispatch');
});

test('M2 keeps distinct route consequences after two authored paths converge on the same stage', async t => {
  const makeModel = () => {
    const model = require('./helpers/phase9CampaignFixture.cjs').candidateModel();
    model.stages[0].completion = { kind: 'committed_event', eventType: 'route_converged' };
    const sweep = model.firstSituation.methods.find(method => method.methodId === 'sweep');
    for (const grade of ['success', 'full_success']) sweep.outcomes[grade].effects.push(
      { template: 'record_event', eventType: 'route_converged', summary: '调查路径完成' },
      { template: 'relationship_shift', fromActorId: 'tpl-lin', toActorId: 'player', delta: 1 },
    );
    const ask = model.firstSituation.methods.find(method => method.methodId === 'ask-lin');
    for (const grade of ['success', 'full_success']) ask.outcomes[grade].effects.push(
      { template: 'record_event', eventType: 'route_converged', summary: '交涉路径完成' },
    );
    return model;
  };
  const makeProvider = route => ({
    async complete(request) {
      const value = JSON.parse(request.user);
      if (request.role === 'Planner') {
        return { text: JSON.stringify({ proposalVersion: '2.0', turnId: value.turnId,
          expectedStateVersion: value.expectedStateVersion, actorId: 'pc',
          actionKind: route === 'sweep' ? 'skill_check' : 'talk',
          ...(route === 'sweep' ? { skillId: 'skill-observation', difficultyBand: 'normal' } : {}),
          evidenceIds: [], intent: value.playerIntent, candidateRef: `method:${SITUATION_ID}:${route}` }) };
      }
      return { text: JSON.stringify({ turnId: value.turnId, outcomeGrade: value.outcomeGrade, text: '受控叙事桩' }) };
    },
  });
  const sweepFixture = await fixture({ model: makeModel(), provider: makeProvider('sweep'), random: { nextIntInclusive: () => 6 } });
  const askFixture = await fixture({ model: makeModel(), provider: makeProvider('ask-lin') });
  t.after(() => { sweepFixture.db.close(); askFixture.db.close(); });

  await sweepFixture.session.playTurn({ campaignId: sweepFixture.campaignId, branchId: sweepFixture.branchId,
    intent: '仔细查看青石巷现场，寻找值得注意的细节与线索' });
  await askFixture.session.playTurn({ campaignId: askFixture.campaignId, branchId: askFixture.branchId,
    intent: '向林凡打听青石巷最近的情况' });
  const sweepContext = await projectionContext(sweepFixture);
  const askContext = await projectionContext(askFixture);
  const sweepState = sweepContext.state;
  const askState = askContext.state;
  const sweepProjection = projectNarrativeOpportunities(sweepContext);
  const askProjection = projectNarrativeOpportunities(askContext);

  for (const state of [sweepState, askState]) {
    assert.equal(state.campaignRuntime.nodeStates.find(node => node.nodeId === 'stage-1').status, 'succeeded');
    assert.equal(state.campaignRuntime.nodeStates.find(node => node.nodeId === 'stage-2').status, 'available');
  }
  assert.equal(sweepState.situations.find(item => item.situationId === SITUATION_ID).status, 'active');
  assert.equal(askState.situations.find(item => item.situationId === SITUATION_ID).status, 'resolved');
  assert.ok(sweepState.relationships.find(item => item.fromActorId === 'npc-tpl-lin' && item.toActorId === 'pc')?.closeness >
    (askState.relationships.find(item => item.fromActorId === 'npc-tpl-lin' && item.toActorId === 'pc')?.closeness ?? 0));
  assert.equal(sweepState.campaignRuntime.deferredConsequences.length, 0);
  assert.equal(askState.campaignRuntime.deferredConsequences.find(item => item.consequenceId === 'lin-favor')?.status, 'discharged');
  assert.equal(sweepProjection.status, 'content_gap');
  assert.equal(askProjection.status, 'content_gap');
  assert.notDeepEqual(sweepState.relationships, askState.relationships,
    'same converged node status does not overwrite route-specific relationship state');
  assert.notDeepEqual(sweepState.campaignRuntime.deferredConsequences, askState.campaignRuntime.deferredConsequences,
    'the projection leaves each branch’s deferred consequences intact');
});

test('M2 blocks event-only success routes without a public consumer before turn journaling', async t => {
  const requests = [];
  const provider = { async complete(request) {
    requests.push(request.role);
    throw new Error('the blocked event-only route must not reach a provider');
  } };
  const h = await fixture({ provider, includeGuidance: true });
  t.after(() => h.db.close());
  const context = await projectionContext(h);
  const originalLoad = h.session.loadCampaignPlanForState.bind(h.session);
  const withOrphanMethod = content => {
    if (!content) return content;
    const artifacts = structuredClone(content.artifacts);
    const authored = artifacts[0].situations.find(situation => situation.entryId === SITUATION_ID);
    const source = authored.definition.methods.find(method => method.methodId === 'sweep');
    const orphan = {
      ...structuredClone(source),
      methodId: 'compile-testimony',
      title: '整理街坊证言',
      goal: '汇总邻里的说法',
      firstStep: { ...source.firstStep, intent: '整理已听到的街坊证言', actionKind: 'observe' },
      successEffects: [],
      onSuccess: [],
      outcomeTemplates: {
        ...source.outcomeTemplates,
        success: { ...source.outcomeTemplates.success, effects: [
          { template: 'record_event', eventType: 'unused_testimony_compiled', summary: 'fixture-only event' },
        ] },
        full_success: { ...source.outcomeTemplates.full_success, effects: [
          { template: 'record_event', eventType: 'unused_testimony_compiled', summary: 'fixture-only event' },
        ] },
      },
    };
    authored.definition.methods.push(orphan);
    return { ...content, artifacts };
  };
  const withOrphan = withOrphanMethod({ plan: context.plan, artifacts: context.artifacts });
  const situationDefinitions = withOrphan.artifacts.flatMap(artifact => artifact.situations.map(situation => ({
    situationId: situation.entryId, definition: situation.definition,
  })));
  const errors = validateUnconsumedSuccessEventMethods(context.plan, withOrphan.artifacts[0]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /public campaign goal|durable state effect/);

  const projection = projectNarrativeOpportunities({
    ...context, artifacts: withOrphan.artifacts, situationDefinitions,
  });
  const orphanRoute = projection.opportunities[0].routes.find(route => route.methodId === 'compile-testimony');
  assert.equal(orphanRoute.available, false);
  assert.match(orphanRoute.blockers.join(' '), /未被后续主线使用/);
  assert.equal(projection.opportunities[0].routes.find(route => route.methodId === 'sweep').available, true,
    'a separate route with a durable counter effect remains available');

  h.session.loadCampaignPlanForState = async (...args) => withOrphanMethod(await originalLoad(...args));
  await assert.rejects(h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
    intent: '整理已听到的街坊证言' }), /未被后续主线使用/);
  assert.deepEqual(requests, [], 'the route is refused before any Planner or Narrator request');
  assert.equal(await h.adapter.queryOne('SELECT operation_id FROM interaction_operations WHERE branch_id=? LIMIT 1', [h.branchId]), null,
    'no interaction operation is opened');
  assert.equal(await h.adapter.queryOne('SELECT turn_id FROM turns WHERE branch_id=? AND status<>\'Committed\' LIMIT 1', [h.branchId]), null,
    'no frozen turn or dice record is created');
});

test('M2 blocks an unused event route when its only other ordinary-success effect is already-known knowledge', async t => {
  const requests = [];
  const provider = { async complete(request) {
    requests.push(request.role);
    throw new Error('the no-effect route must not reach a provider');
  } };
  const h = await fixture({ provider, includeGuidance: true });
  t.after(() => h.db.close());
  const context = await projectionContext(h);
  const state = structuredClone(context.state);
  const playerActorId = state.party.find(member => member.controller === 'player').actorId;
  const alreadyKnownEntryId = 'fixture-known-testimony-clue';
  state.discoveries ??= [];
  state.discoveries.push({ entryId: alreadyKnownEntryId, actorId: playerActorId,
    knownAtStateVersion: state.stateVersion, sourceTurnId: 'fixture-prior-discovery', knownVia: 'told' });

  const artifacts = structuredClone(context.artifacts);
  const authored = artifacts[0].situations.find(situation => situation.entryId === SITUATION_ID);
  const source = authored.definition.methods.find(method => method.methodId === 'sweep');
  authored.definition.methods.push({
    ...structuredClone(source),
    methodId: 'compile-known-testimony',
    title: '整理已知证言',
    goal: '再次汇总已经掌握的说法',
    firstStep: { ...source.firstStep, intent: '再次整理已知街坊证言', actionKind: 'observe' },
    successEffects: [],
    onSuccess: [],
    outcomeTemplates: {
      ...source.outcomeTemplates,
      success: { ...source.outcomeTemplates.success, effects: [
        { template: 'grant_knowledge', entryId: alreadyKnownEntryId },
        { template: 'record_event', eventType: 'unused_testimony_compiled', summary: 'fixture-only event' },
      ] },
      full_success: { ...source.outcomeTemplates.full_success, effects: [
        { template: 'grant_knowledge', entryId: alreadyKnownEntryId },
        { template: 'record_event', eventType: 'unused_testimony_compiled', summary: 'fixture-only event' },
      ] },
    },
  });
  const situationDefinitions = artifacts.flatMap(artifact => artifact.situations.map(situation => ({
    situationId: situation.entryId, definition: situation.definition,
  })));
  const projection = projectNarrativeOpportunities({ ...context, state, artifacts, situationDefinitions });
  const route = projection.opportunities[0].routes.find(item => item.methodId === 'compile-known-testimony');
  assert.equal(route.available, false);
  assert.ok(route.blockerCodes.length > 0);
  assert.match(route.blockers.join(' '), /不会产生新的线索或状态变化/);
  assert.equal(projection.opportunities[0].routes.find(item => item.methodId === 'sweep').available, true);

  h.session.loadCampaignPlanForState = async () => ({ plan: context.plan, artifacts });
  h.turns.getState = async () => structuredClone(state);
  const guidance = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId,
    branchId: h.branchId, sourceTurnId: 'refresh-current', localOnly: true });
  assert.ok(guidance);
  assert.equal(guidance.steps.some(step => step.candidateRef === route.candidateRef), false,
    'hard-blocked methods are omitted from player guidance, including after a refresh');
  await assert.rejects(h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
    intent: '再次整理已知街坊证言' }), /不会产生新的线索或状态变化/);
  assert.deepEqual(requests, [], 'the blocked route is refused before any provider call');
  assert.equal(await h.adapter.queryOne('SELECT operation_id FROM interaction_operations WHERE branch_id=? LIMIT 1', [h.branchId]), null,
    'no interaction operation is opened');
  assert.equal(await h.adapter.queryOne('SELECT turn_id FROM turns WHERE branch_id=? AND status<>\'Committed\' LIMIT 1', [h.branchId]), null,
    'no frozen turn or dice record is created');
});

test('M2 blocks a promise-creation route after its fixed promise already exists', async t => {
  const requests = [];
  const provider = { async complete(request) {
    requests.push(request.role);
    throw new Error('a repeated promise route must not reach a provider');
  } };
  const h = await fixture({ provider, includeGuidance: true });
  t.after(() => h.db.close());
  const context = await projectionContext(h);
  const state = structuredClone(context.state);
  const promiseId = 'fixture-supplies-promise';
  state.situations.find(item => item.situationId === SITUATION_ID).promises = [{
    promiseId, promisorActorId: 'npc-tpl-lin', promiseeActorId: 'pc',
    description: 'fixture promise', status: 'open', createdAtVersion: state.stateVersion,
    sourceTurnId: 'fixture-prior-turn',
  }];

  const artifacts = structuredClone(context.artifacts);
  const authored = artifacts[0].situations.find(situation => situation.entryId === SITUATION_ID);
  const source = authored.definition.methods.find(method => method.methodId === 'sweep');
  const repeatedPromise = {
    ...structuredClone(source),
    methodId: 'ask-for-promised-supplies',
    title: '再次询问补给承诺',
    goal: '再次确认已经作出的承诺',
    firstStep: { ...source.firstStep, intent: '再次询问提尔是否准备好补给', actionKind: 'talk' },
    successEffects: [],
    onSuccess: [],
    outcomeTemplates: {
      ...source.outcomeTemplates,
      success: { ...source.outcomeTemplates.success, effects: [
        { template: 'promise_create', situationId: SITUATION_ID, promiseId,
          promisorActorId: 'npc-tpl-lin', promiseeActorId: 'pc', description: 'fixture promise' },
        { template: 'situation_counter', situationId: SITUATION_ID, counterId: 'supplies', delta: 10 },
        { template: 'relationship_shift', fromActorId: 'npc-tpl-lin', toActorId: 'pc', delta: 2 },
      ] },
      full_success: { ...source.outcomeTemplates.full_success, effects: [
        { template: 'promise_create', situationId: SITUATION_ID, promiseId,
          promisorActorId: 'npc-tpl-lin', promiseeActorId: 'pc', description: 'fixture promise' },
        { template: 'situation_counter', situationId: SITUATION_ID, counterId: 'supplies', delta: 10 },
        { template: 'relationship_shift', fromActorId: 'npc-tpl-lin', toActorId: 'pc', delta: 2 },
      ] },
    },
  };
  authored.definition.methods.push(repeatedPromise);
  const situationDefinitions = artifacts.flatMap(artifact => artifact.situations.map(situation => ({
    situationId: situation.entryId, definition: situation.definition,
  })));
  const projection = projectNarrativeOpportunities({ ...context, state, artifacts, situationDefinitions });
  const route = projection.opportunities[0].routes.find(item => item.methodId === repeatedPromise.methodId);
  assert.equal(route.available, false);
  assert.ok(route.blockerCodes.includes('campaign_method_promise_already_created'));
  assert.match(route.blockers.join(' '), /已经创建了这个承诺/);
  assert.equal(projection.opportunities[0].routes.find(item => item.methodId === 'sweep').available, true,
    'separate progress routes remain available');

  h.session.loadCampaignPlanForState = async () => ({ plan: context.plan, artifacts });
  h.turns.getState = async () => structuredClone(state);
  const guidance = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId,
    branchId: h.branchId, sourceTurnId: 'refresh-after-promise', localOnly: true });
  assert.ok(guidance);
  assert.equal(guidance.steps.some(step => step.candidateRef === route.candidateRef), false,
    'the duplicate promise route is omitted from refreshed guidance');
  await assert.rejects(h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
    intent: repeatedPromise.firstStep.intent }), /已经创建了该承诺/);
  assert.deepEqual(requests, [], 'the repeated route is refused before any provider request');
  assert.equal(await h.adapter.queryOne('SELECT operation_id FROM interaction_operations WHERE branch_id=? LIMIT 1', [h.branchId]), null,
    'no interaction operation is opened');
  assert.equal(await h.adapter.queryOne('SELECT turn_id FROM turns WHERE branch_id=? AND status<>\'Committed\' LIMIT 1', [h.branchId]), null,
    'no frozen turn or dice record is created');
});

test('M2 blocks a promise-fulfillment route after its fixed promise is already resolved', async t => {
  const requests = [];
  const provider = { async complete(request) {
    requests.push(request.role);
    throw new Error('a resolved-promise route must not reach a provider');
  } };
  const h = await fixture({ provider, includeGuidance: true });
  t.after(() => h.db.close());
  const context = await projectionContext(h);
  const state = structuredClone(context.state);
  const promiseId = 'fixture-supplies-promise';
  state.situations.find(item => item.situationId === SITUATION_ID).promises = [{
    promiseId, promisorActorId: 'npc-tpl-lin', promiseeActorId: 'pc',
    description: 'fixture promise', status: 'fulfilled', createdAtVersion: state.stateVersion,
    sourceTurnId: 'fixture-prior-turn', resolvedAtVersion: state.stateVersion,
  }];

  const artifacts = structuredClone(context.artifacts);
  const authored = artifacts[0].situations.find(situation => situation.entryId === SITUATION_ID);
  const source = authored.definition.methods.find(method => method.methodId === 'sweep');
  const fulfilledPromiseRoute = {
    ...structuredClone(source),
    methodId: 'collect-promised-supplies',
    title: '再次领取已履约补给',
    goal: '再次领取已经兑现的补给',
    firstStep: { ...source.firstStep, intent: '再次领取已经兑现的补给', actionKind: 'talk' },
    successEffects: [],
    onSuccess: [],
    outcomeTemplates: {
      ...source.outcomeTemplates,
      success: { ...source.outcomeTemplates.success, effects: [
        { template: 'promise_fulfill', situationId: SITUATION_ID, promiseId },
        { template: 'situation_counter', situationId: SITUATION_ID, counterId: 'supplies', delta: 10 },
        { template: 'relationship_shift', fromActorId: 'npc-tpl-lin', toActorId: 'pc', delta: 2 },
      ] },
      full_success: { ...source.outcomeTemplates.full_success, effects: [
        { template: 'situation_counter', situationId: SITUATION_ID, counterId: 'supplies', delta: 10 },
        { template: 'relationship_shift', fromActorId: 'npc-tpl-lin', toActorId: 'pc', delta: 2 },
      ] },
    },
  };
  authored.definition.methods.push(fulfilledPromiseRoute);
  const situationDefinitions = artifacts.flatMap(artifact => artifact.situations.map(situation => ({
    situationId: situation.entryId, definition: situation.definition,
  })));
  const projection = projectNarrativeOpportunities({ ...context, state, artifacts, situationDefinitions });
  const route = projection.opportunities[0].routes.find(item => item.methodId === fulfilledPromiseRoute.methodId);
  assert.equal(route.available, false);
  assert.ok(route.blockerCodes.includes('campaign_method_promise_already_resolved'));
  assert.match(route.blockers.join(' '), /承诺已经解决/);
  assert.equal(projection.opportunities[0].routes.find(item => item.methodId === 'sweep').available, true,
    'separate progress routes remain available');

  h.session.loadCampaignPlanForState = async () => ({ plan: context.plan, artifacts });
  h.turns.getState = async () => structuredClone(state);
  const guidance = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId,
    branchId: h.branchId, sourceTurnId: 'refresh-after-fulfilled-promise', localOnly: true });
  assert.ok(guidance);
  assert.equal(guidance.steps.some(step => step.candidateRef === route.candidateRef), false,
    'the resolved-promise route is omitted from refreshed guidance');
  await assert.rejects(h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
    intent: fulfilledPromiseRoute.firstStep.intent }), /承诺已经解决/);
  assert.deepEqual(requests, [], 'the repeated route is refused before any provider request');
  assert.equal(await h.adapter.queryOne('SELECT operation_id FROM interaction_operations WHERE branch_id=? LIMIT 1', [h.branchId]), null,
    'no interaction operation is opened');
  assert.equal(await h.adapter.queryOne('SELECT turn_id FROM turns WHERE branch_id=? AND status<>\'Committed\' LIMIT 1', [h.branchId]), null,
    'no frozen turn or dice record is created');
  const validKnowledgeRoute = structuredClone(fulfilledPromiseRoute);
  validKnowledgeRoute.methodId = 'new-clue-with-idempotent-promise';
  validKnowledgeRoute.outcomeTemplates.success.effects.push({ template: 'grant_knowledge', entryId: 'new-clue', actorId: 'pc' });
  validKnowledgeRoute.outcomeTemplates.full_success.effects.push({ template: 'grant_knowledge', entryId: 'new-clue', actorId: 'pc' });
  assert.equal(campaignMethodEventConsumerBlocker({ state, plan: context.plan, artifacts, situationId: SITUATION_ID,
    method: validKnowledgeRoute }), null, 'a new legal clue remains usable with an idempotent old promise transition');
});

test('convergence: graph refuses a stale plan and never projects private active nodes or GM prose', async t => {
  const h = await fixture();
  t.after(() => h.db.close());
  const context = await projectionContext(h);
  const unchanged = JSON.stringify(context);
  const stale = structuredClone(context.plan);
  stale.revision += 1;
  assert.deepEqual(projectNarrativeOpportunities({ ...context, plan: stale }).opportunities, []);
  assert.equal(projectNarrativeOpportunities({ ...context, plan: stale }).status, 'stale_binding');
  const hidden = structuredClone(context.plan);
  hidden.nodes.find(n => n.nodeId === 'stage-1').visibility = 'gm';
  const projection = projectNarrativeOpportunities({ ...context, plan: hidden });
  assert.equal(projection.status, 'content_gap');
  assert.deepEqual(projection.opportunities, []);
  assert.equal(JSON.stringify(projection).includes(hidden.nodes[0].gmPurpose), false);
  assert.equal(JSON.stringify(context), unchanged, 'projection has no mutation or independent progress');
});

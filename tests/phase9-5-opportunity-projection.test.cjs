'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, baseEntries, SITUATION_ID } = require('./helpers/phase9CampaignFixture.cjs');
const { projectNarrativeOpportunities } = require('../dist/application/campaignPlan/opportunityProjection');
const { campaignSituationEntries } = require('../dist/application/campaignPlan/contentResolver');
const { collectAllowedCandidates } = require('../dist/application/guidance/candidates');

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
      return { text: JSON.stringify({ turnId: value.turnId, outcomeGrade: value.outcomeGrade, text: '受控叙事桩' }) };
    },
  };
  const h = await fixture({ provider, random: { nextIntInclusive: () => 6 } });
  t.after(() => h.db.close());

  const failed = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
    intent: '仔细查看青石巷现场，寻找值得注意的细节与线索' });
  assert.equal(failed.grade, 'severe_failure');
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
  assert.equal(askState.campaignRuntime.deferredConsequences.find(item => item.consequenceId === 'lin-favor')?.status, 'triggered');
  assert.equal(sweepProjection.status, 'content_gap');
  assert.equal(askProjection.status, 'content_gap');
  assert.notDeepEqual(sweepState.relationships, askState.relationships,
    'same converged node status does not overwrite route-specific relationship state');
  assert.notDeepEqual(sweepState.campaignRuntime.deferredConsequences, askState.campaignRuntime.deferredConsequences,
    'the projection leaves each branch’s deferred consequences intact');
});

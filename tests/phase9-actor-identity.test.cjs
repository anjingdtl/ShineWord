const test = require('node:test');
const assert = require('node:assert/strict');
const { createActorReferenceResolver } = require('../dist/domain/characters/actorIdentity');
const { snapshotConditionFacts, evaluateCondition } = require('../dist/domain/situations/conditions');
const { resolveMethodActor } = require('../dist/application/guidance/candidates');
const { evaluateReplanTriggers } = require('../dist/application/campaignPlan/replanService');
const { applySituationRuntime } = require('../dist/application/situations/causalProjection');

function factsFor(actors, cards) {
  return snapshotConditionFacts({ actors, cards, itemOwners: {}, playerActorId: 'pc', causalWorldTimeOrder: 1 });
}

test('actor identity: qualification and condition guards bind template aliases to the same actual companion', () => {
  const actors = { 'companion-lin': { lifeStatus: 'active', locationId: 'alley', conditions: [] } };
  const cards = [{ actorId: 'companion-lin', templateId: 'tpl-lin' }];
  for (const ref of ['tpl-lin', 'npc-tpl-lin', 'companion-lin']) {
    assert.equal(resolveMethodActor(ref, { actors }, cards), 'companion-lin');
    assert.deepEqual(evaluateCondition({ kind: 'actor_alive', actorId: ref }, factsFor(actors, cards)),
      { value: true, unknown: false });
  }
});

test('actor identity: ambiguous and absent templates cannot select an arbitrary person or satisfy a negated guard', () => {
  const actors = { one: { lifeStatus: 'dead', conditions: [] }, two: { lifeStatus: 'active', conditions: [] } };
  const cards = [{ actorId: 'one', templateId: 'tpl-lin' }, { actorId: 'two', templateId: 'tpl-lin' }];
  const facts = factsFor(actors, cards);
  assert.equal(resolveMethodActor('tpl-lin', { actors }, cards), null);
  assert.equal(createActorReferenceResolver({ actors, cards })('one'), 'one', 'explicit actual owner still works');
  for (const ref of ['tpl-lin', 'npc-tpl-lin', 'missing']) {
    assert.deepEqual(evaluateCondition({ kind: 'not', of: { kind: 'actor_alive', actorId: ref } }, facts),
      { value: false, unknown: true });
  }
});

test('actor identity: duplicate views of one card stay unique, and legacy materialized owners remain readable', () => {
  const actors = { companion: {}, 'npc-old': {}, 'actor-legacy': {} };
  const card = { actorId: 'companion', templateId: 'tpl-lin' };
  const resolve = createActorReferenceResolver({ actors, cards: [card, card] });
  assert.equal(resolve('tpl-lin'), 'companion');
  assert.equal(resolve('old'), 'npc-old');
  assert.equal(resolve('legacy'), 'actor-legacy');
  assert.equal(resolve('unbound'), 'unbound');
});

test('actor identity: a template ID beginning with npc- keeps its complete catalog identity', () => {
  const actors = { actual: { lifeStatus: 'active', conditions: [] } };
  const cards = [{ actorId: 'actual', templateId: 'npc-lin' }];
  assert.equal(resolveMethodActor('npc-lin', { actors }, cards), 'actual');
  assert.deepEqual(evaluateCondition({ kind: 'actor_alive', actorId: 'npc-lin' }, factsFor(actors, cards)),
    { value: true, unknown: false });
});

test('actor identity: replan fate triggers resolve actual companions with the same qualification aliases', () => {
  const state = { actors: { companion: { lifeStatus: 'dead' } }, cards: [{ actorId: 'companion', card: { actorId: 'companion', templateId: 'tpl-lin' } }] };
  const runtime = { campaignStatus: 'active', primaryNodeId: null, nodeStates: [{ nodeId: 'future', status: 'planned' }], replanReasonCodes: [] };
  for (const actorId of ['tpl-lin', 'npc-tpl-lin', 'companion']) {
    const plan = { nodes: [{ nodeId: 'future', role: 'main', completion: { kind: 'actor_alive', actorId } }] };
    assert.ok(evaluateReplanTriggers({ plan, runtime, state }).includes('critical_actor_fate'), actorId);
  }
  const alive = structuredClone(state); alive.actors.companion.lifeStatus = 'active';
  const plan = { nodes: [{ nodeId: 'future', role: 'main', completion: { kind: 'actor_alive', actorId: 'tpl-lin' } }] };
  assert.ok(!evaluateReplanTriggers({ plan, runtime, state: alive }).includes('critical_actor_fate'));
});

function dueFate(actors, cards, actorId) {
  const situation = { situationId: 's', status: 'active', activatedAtVersion: 1, statusVersion: 1,
    counters: {}, promises: [], processedEventKeys: [], suppressedEventKeys: {} };
  return applySituationRuntime({ nextState: { stateVersion: 2, clockSeconds: 0, causalWorldTimeOrder: 1,
    actors, cards: cards.map(card => ({ actorId: card.actorId, card })), itemOwners: {}, situations: [situation] },
    playerActorId: 'pc', sourceTurnId: 't2', methodOps: [], definitions: [{ situationId: 's', definition: {
      activation: { kind: 'world_time_at_least', order: 0 }, methods: [], pressure: { description: 'future' },
      referenceEvents: [{ eventKey: 'canon-fate', worldTimeOrder: 1, situationId: 's', actorFate: { actorId, lifeStatus: 'dead' } }],
    } }] });
}

test('actor identity: due canon fates bind prefixed aliases to the unique actual companion', () => {
  const actors = { companion: { lifeStatus: 'active', conditions: [] } };
  const cards = [{ actorId: 'companion', templateId: 'tpl-lin' }];
  for (const alias of ['tpl-lin', 'npc-tpl-lin', 'companion']) {
    assert.deepEqual(dueFate(actors, cards, alias).actorFates, [{ actorId: 'companion', lifeStatus: 'dead', eventKey: 'canon-fate' }]);
  }
});

test('actor identity: an ambiguous canon fate never selects the first card, while explicit actor IDs remain valid', () => {
  const actors = { one: { lifeStatus: 'active', conditions: [] }, two: { lifeStatus: 'active', conditions: [] } };
  const cards = [{ actorId: 'one', templateId: 'tpl-lin' }, { actorId: 'two', templateId: 'tpl-lin' }];
  assert.deepEqual(dueFate(actors, cards, 'tpl-lin').actorFates, []);
  assert.deepEqual(dueFate(actors, cards, 'one').actorFates, [{ actorId: 'one', lifeStatus: 'dead', eventKey: 'canon-fate' }]);
});

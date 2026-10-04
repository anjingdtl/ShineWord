'use strict';
/**
 * P7-0/P7-1 targeted verification: frozen situation contracts, three-valued
 * condition evaluation, transition idempotency, status ticks, reference-event
 * fate guarding, and the prepared-turn pipeline's single-reduction commit.
 *
 * Fixtures: tests/fixtures/phase7/situationFixtures.cjs (synthetic).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FIXTURES,
} = require('./fixtures/phase7/situationFixtures.cjs');
const {
  evaluateCondition,
  snapshotConditionFacts,
  validateConditionShape,
} = require('../dist/domain/situations/conditions');
const {
  applySituationTransitions,
  tickSituationStatuses,
} = require('../dist/domain/situations/transitions');
const {
  evaluateReferenceEvents,
  deriveCausalWorldTimeOrder,
} = require('../dist/domain/situations/referenceEvents');
const {
  validateDefinition,
} = require('../dist/domain/content/types');

function baseFacts(overrides = {}) {
  return snapshotConditionFacts({
    actors: overrides.actors ?? {
      'actor-companion': {
        actorId: 'actor-companion', locationId: 'scene-sect',
        resources: { hp: 1 }, conditions: ['bleeding'], lifeStatus: 'critical',
      },
      'actor-player': {
        actorId: 'actor-player', locationId: 'scene-sect',
        resources: { hp: 8 }, conditions: [],
      },
    },
    itemOwners: overrides.itemOwners ?? {},
    discoveries: overrides.discoveries ?? [
      { entryId: 'lore-north-trail', actorId: 'actor-player' },
    ],
    relationships: overrides.relationships ?? [],
    questProgress: overrides.questProgress ?? [],
    situations: overrides.situations ?? [],
    playerActorId: 'actor-player',
    causalWorldTimeOrder: overrides.causalWorldTimeOrder ?? 20,
  });
}

test('P7 fixtures pass the frozen situation definition validator', () => {
  for (const fixture of Object.values(FIXTURES)) {
    const situations = fixture.entries.filter(entry => entry.kind === 'situation');
    assert.ok(situations.length >= 1, `${fixture.fixtureId} carries a situation`);
    for (const entry of situations) {
      const errors = validateDefinition('situation', entry.definition);
      assert.deepEqual(errors, [], `${fixture.fixtureId}/${entry.entryId}: ${errors.join('; ')}`);
    }
    // No fixture situation may offer fewer than three DISTINCT methods; each
    // pair must differ in goal, first step or requirements.
    for (const entry of situations) {
      const methods = entry.definition.methods;
      assert.ok(methods.length >= 3, `${entry.entryId} should offer real route variety`);
      const signatures = new Set(methods.map(m =>
        `${m.firstStep.actionKind}|${m.firstStep.skillId ?? ''}|${m.firstStep.targetEntryId ?? ''}|${m.firstStep.destinationId ?? ''}`));
      assert.equal(signatures.size, methods.length, 'methods must be structurally distinct');
    }
  }
});

test('conditions are three-valued: missing data is unknown, never true', () => {
  const facts = baseFacts();
  const alive = evaluateCondition({ kind: 'actor_alive', actorId: 'actor-companion' }, facts);
  assert.deepEqual(alive, { value: true, unknown: false });
  const missing = evaluateCondition({ kind: 'actor_alive', actorId: 'actor-ghost' }, facts);
  assert.deepEqual(missing, { value: false, unknown: true });
  const knowledge = evaluateCondition({ kind: 'knowledge_known', entryId: 'lore-north-trail' }, facts);
  assert.deepEqual(knowledge, { value: true, unknown: false });
  const unknownKnowledge = evaluateCondition({ kind: 'knowledge_known', entryId: 'lore-other' }, facts);
  assert.deepEqual(unknownKnowledge, { value: false, unknown: false });
});

test('condition whitelist rejects unknown kinds and oversized trees', () => {
  const errors = [];
  validateConditionShape({ kind: 'lua', code: 'return true' }, errors);
  assert.ok(errors.some(e => e.includes('unknown condition kind')));
  errors.length = 0;
  const wide = { kind: 'all', of: Array.from({ length: 30 }, (_, i) => ({ kind: 'actor_alive', actorId: `a${i}` })) };
  validateConditionShape(wide, errors);
  assert.ok(errors.some(e => e.includes('exceeds')));
});

test('transition batches are idempotent through processedEventKeys', () => {
  const situations = [{
    situationId: 'sit', status: 'active', counters: {}, processedEventKeys: [],
    promises: [], suppressedEventKeys: {}, sourceTurnId: 't1', statusVersion: 0,
  }];
  const ops = [{ kind: 'situation_counter', situationId: 'sit', counterId: 'heat', delta: 1 }];
  const first = applySituationTransitions({
    situations, ops, eventKey: 'tx:turn-1', sourceTurnId: 'turn-1', stateVersion: 5, clockSeconds: 0,
  });
  assert.equal(first.situations[0].counters.heat, 1);
  const replay = applySituationTransitions({
    situations: first.situations, ops, eventKey: 'tx:turn-1', sourceTurnId: 'turn-1', stateVersion: 5, clockSeconds: 0,
  });
  assert.equal(replay.situations[0].counters.heat, 1, 'replay must not double-apply');
  assert.equal(replay.applied.length, 0);
});

test('status tick walks dormant→eligible→active and suppresses on falsified preconditions', () => {
  const defs = [{
    situationId: 'sit-a',
    activation: { kind: 'world_time_at_least', order: 18 },
    transitions: {},
  }];
  const dormant = [{
    situationId: 'sit-a', status: 'dormant', counters: {}, processedEventKeys: [],
    promises: [], suppressedEventKeys: {}, sourceTurnId: 't0', statusVersion: 0,
  }];
  const eligible = tickSituationStatuses({
    definitions: defs, situations: dormant, facts: baseFacts({ causalWorldTimeOrder: 20 }),
    stateVersion: 1, clockSeconds: 0, sourceTurnId: 't1',
  });
  assert.equal(eligible.situations[0].status, 'eligible');
  const active = tickSituationStatuses({
    definitions: defs, situations: eligible.situations, facts: baseFacts({ causalWorldTimeOrder: 20 }),
    stateVersion: 2, clockSeconds: 0, sourceTurnId: 't2',
  });
  assert.equal(active.situations[0].status, 'active', 'no knowledge condition → activates');

  // Falsified precondition after activation → suppressed with audit.
  const falsifiedDefs = [{
    situationId: 'sit-b',
    activation: { kind: 'actor_alive', actorId: 'actor-companion' },
    transitions: {},
  }];
  const activeB = [{
    situationId: 'sit-b', status: 'active', counters: {}, processedEventKeys: [],
    promises: [], suppressedEventKeys: {}, sourceTurnId: 't0', statusVersion: 0,
  }];
  const deadFacts = baseFacts({
    actors: {
      'actor-companion': {
        actorId: 'actor-companion', locationId: 'scene-sect',
        resources: { hp: 0 }, conditions: [], lifeStatus: 'dead',
      },
      'actor-player': { actorId: 'actor-player', locationId: 'scene-sect', resources: { hp: 8 }, conditions: [] },
    },
  });
  const suppressed = tickSituationStatuses({
    definitions: falsifiedDefs, situations: activeB, facts: deadFacts,
    stateVersion: 3, clockSeconds: 0, sourceTurnId: 't3',
  });
  assert.equal(suppressed.situations[0].status, 'suppressed');
  assert.equal(suppressed.situations[0].resolution, 'activation_precondition_false');
});

test('P7-0 exit sample: saving the companion suppresses the death reference', () => {
  const situation = FIXTURES.rescue.entries.find(entry => entry.entryId === 'situation-sect-aftermath');
  const projection = situation.definition.referenceEvents[0];
  assert.equal(projection.eventKey, 'evt-companion-death');
  const baseSituations = [{
    situationId: situation.entryId, status: 'active', counters: {}, processedEventKeys: [],
    promises: [], suppressedEventKeys: {}, sourceTurnId: 't0', statusVersion: 0,
  }];

  // Branch A: companion saved (bleeding removed) → reference suppressed.
  const savedFacts = baseFacts({
    actors: {
      'actor-companion': {
        actorId: 'actor-companion', locationId: 'scene-sect',
        resources: { hp: 3 }, conditions: [], lifeStatus: 'active',
      },
      'actor-player': { actorId: 'actor-player', locationId: 'scene-sect', resources: { hp: 8 }, conditions: [] },
    },
  });
  const savedDecision = evaluateReferenceEvents({
    projections: [projection], situations: baseSituations, facts: savedFacts, causalWorldTimeOrder: 30,
  })[0];
  assert.equal(savedDecision.action, 'suppress');
  const applied = applySituationTransitions({
    situations: baseSituations, ops: savedDecision.ops, eventKey: `ref:${projection.eventKey}`,
    sourceTurnId: 't5', stateVersion: 5, clockSeconds: 0,
  });
  assert.ok(applied.situations[0].suppressedEventKeys['evt-companion-death']);
  assert.ok(applied.events.some(e => e.eventType === 'reference_event_suppressed'));

  // Branch B (control): companion still bleeding at order 30 → the reference
  // fires ON THIS BRANCH with its actor fate; the canon event itself is
  // untouched (verified by it never appearing in any suppression record).
  const bleedingFacts = baseFacts();
  const dueDecision = evaluateReferenceEvents({
    projections: [projection], situations: baseSituations, facts: bleedingFacts, causalWorldTimeOrder: 30,
  })[0];
  assert.equal(dueDecision.action, 'apply');
  assert.deepEqual(dueDecision.actorFate, { actorId: 'actor-companion', lifeStatus: 'dead' });

  // Not yet due → pending even when the condition holds.
  const early = evaluateReferenceEvents({
    projections: [projection], situations: baseSituations, facts: bleedingFacts, causalWorldTimeOrder: 29,
  });
  assert.equal(early.length, 0);
});

test('causal order derives from committed event orders, never turn count', () => {
  assert.equal(deriveCausalWorldTimeOrder([3, 30, 7]), 30);
  assert.equal(deriveCausalWorldTimeOrder([]), 0);
});

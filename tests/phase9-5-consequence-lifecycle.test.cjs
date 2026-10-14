/**
 * Phase 9.5 deferred-consequence lifecycle contract (ROOT_CAUSE_AUDIT §2).
 *
 * The protocol declares four statuses — pending / triggered / discharged /
 * cancelled — but only 'pending' and 'triggered' were ever assigned anywhere in
 * src/. These tests pin the two obligations that were missing:
 *
 *   1. A pending consequence whose trigger can never become true is stranded in
 *      'pending' forever, masquerading as future consumable content. It needs a
 *      defined, auditable lifecycle disposition.
 *   2. A consequence whose effects were applied stays 'triggered' forever
 *      instead of reaching 'discharged', so the runtime cannot distinguish
 *      "applied" from "waiting to apply".
 *
 * Both must be decided by the production reducer / adoption path — never by
 * rewriting an old trigger condition, faking a success, or editing history.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { emptyRuntimeForPlan } = require('../dist/domain/campaignPlan/types');
const { conditionPossibilityForNodes, orphanedPendingConsequences, dischargeAppliedConsequences,
  dischargeStrandedConsequences } = require('../dist/domain/campaignPlan/consequenceLifecycle');
const { newlyOrphanedPendingConsequences } = require('../dist/application/campaignPlan/replanService');

const NODES = [
  { nodeId: 'stage-3', status: 'superseded', completedEvidence: [] },
  { nodeId: 'stage-4', status: 'superseded', completedEvidence: [] },
  { nodeId: 'stage-5', status: 'active', completedEvidence: [] },
];

function planWith(nodes) {
  return {
    planId: 'plan-lifecycle', revision: 3, intentHash: 'ih', contentHash: 'ch',
    nodes: nodes.map(n => ({ nodeId: n.nodeId, role: 'main' })),
  };
}

function runtimeWith(consequences) {
  const plan = planWith(NODES);
  const base = emptyRuntimeForPlan({
    branchId: 'branch-lifecycle', plan, intentRevision: 1, stateVersion: 1, playerActorId: 'player-1',
  });
  return {
    ...base,
    nodeStates: NODES.map(n => ({ ...n })),
    deferredConsequences: consequences,
  };
}

function consequence(id, triggerCondition) {
  return {
    consequenceId: id,
    description: `consequence ${id}`,
    triggerCondition,
    sourceEventRefs: [],
    affectedActors: [],
    effectSpecs: [],
    visibility: 'public',
    status: 'pending',
    idempotencyKey: `branch-lifecycle:${id}`,
    createdAtVersion: 1,
    sourceTurnId: 'turn-1',
  };
}

test('P9-5 lifecycle: a pending trigger that can never become true is detected as stranded', () => {
  // stage-3 is superseded, so `stage-3 succeeded` is permanently false.
  const stranded = orphanedPendingConsequences({
    deferredConsequences: [
      consequence('consequence-roland-tacit', { kind: 'campaign_node_status', nodeId: 'stage-3', status: 'succeeded' }),
      consequence('consequence-route-verified', { kind: 'campaign_node_status', nodeId: 'stage-4', status: 'succeeded' }),
    ],
    nodeStates: NODES,
  });
  assert.deepEqual(stranded, ['consequence-roland-tacit', 'consequence-route-verified'],
    'both real-snapshot orphans must be detected, not left masquerading as future content');
});

test('P9-5 lifecycle: a pending trigger that is still reachable is NOT stranded', () => {
  const reachable = orphanedPendingConsequences({
    deferredConsequences: [consequence('still-live', { kind: 'campaign_node_status', nodeId: 'stage-5', status: 'succeeded' })],
    nodeStates: NODES,
  });
  assert.deepEqual(reachable, [], 'a legal route must be preserved, never discharged');
});

test('P9-5 lifecycle: non-node conditions stay possible (unknown is not false)', () => {
  const stillPossible = orphanedPendingConsequences({
    deferredConsequences: [consequence('counter-based', { kind: 'situation_counter_at_least', situationId: 's1', counterId: 'plan_ready', minimum: 20 })],
    nodeStates: NODES,
  });
  assert.deepEqual(stillPossible, [],
    'only a provably impossible trigger is stranded; a counter may still rise');
});

test('P9-5 lifecycle: an applied consequence is discharged, and a stranded one is cancelled', () => {
  // The settlement layer is the only place that knows effects actually ran, so
  // it owns the discharge. Both transitions must be auditable.
  const runtime = runtimeWith([
    { ...consequence('c-applied', { kind: 'campaign_node_status', nodeId: 'stage-5', status: 'succeeded' }),
      status: 'triggered', triggeredAtVersion: 2 },
    consequence('c-stranded', { kind: 'campaign_node_status', nodeId: 'stage-3', status: 'succeeded' }),
  ]);
  const applied = dischargeAppliedConsequences({
    runtime, appliedKeys: new Set(['branch-lifecycle:c-applied']), nextStateVersion: 3,
  });
  assert.deepEqual(applied.consequenceIds, ['c-applied']);
  const appliedRecord = runtime.deferredConsequences.find(c => c.consequenceId === 'c-applied');
  assert.equal(appliedRecord.status, 'discharged', 'an applied consequence is discharged, not left triggered');
  assert.equal(appliedRecord.dischargedAtVersion, 3);
  assert.equal(applied.events[0].eventType, 'campaign_consequence_discharged');

  const stranded = dischargeStrandedConsequences({ runtime, nextStateVersion: 3 });
  assert.deepEqual(stranded.consequenceIds, ['c-stranded']);
  const strandedRecord = runtime.deferredConsequences.find(c => c.consequenceId === 'c-stranded');
  assert.equal(strandedRecord.status, 'cancelled');
  assert.equal(strandedRecord.cancelReason, 'trigger_node_retired');
  assert.equal(stranded.events[0].eventType, 'campaign_consequence_cancelled');
});

test('P9-5 lifecycle: disposing never rewrites the trigger condition or description', () => {
  const original = consequence('c-keep', { kind: 'campaign_node_status', nodeId: 'stage-4', status: 'succeeded' });
  const runtime = runtimeWith([original]);
  const before = JSON.stringify({ c: original.triggerCondition, d: original.description });
  dischargeStrandedConsequences({ runtime, nextStateVersion: 4 });
  const after = runtime.deferredConsequences[0];
  assert.equal(JSON.stringify({ c: after.triggerCondition, d: after.description }), before,
    'history is never edited: only lifecycle status and an explicit reason are added');
});

test('P9-5 lifecycle: replan still refuses to NEWLY orphan a reachable trigger', () => {
  // Guard from the previous round must keep working; the fix adds a disposition
  // for already-stranded records, it must not weaken this rejection.
  const before = [{ nodeId: 'stage-3', status: 'active', completedEvidence: [] }];
  const after = [{ nodeId: 'stage-3', status: 'superseded', completedEvidence: [] }];
  assert.deepEqual(newlyOrphanedPendingConsequences({
    deferredConsequences: [consequence('would-be-stranded', { kind: 'campaign_node_status', nodeId: 'stage-3', status: 'succeeded' })],
    before, after,
  }), ['would-be-stranded'], 'newly orphaning a reachable trigger is still rejected');
});
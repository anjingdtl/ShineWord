/**
 * P8-5 acceptance: observation compilation gates, evidence-derived entity
 * time, applied-only fork replay and the atomic checkpoint transaction
 * (plan §15, gates A19/A22/A23/A24 evidence at unit level).
 */

const test = require('node:test');
const assert = require('node:assert/strict');


const { compileObservations, hasDeterministicKnownChange } = require('../dist/application/memory/storyMemoryObservationCompiler');
const { mergeStoryMemoryPatch } = require('../dist/application/memory/storyMemoryMerger');
const { emptyStoryMemoryState } = require('../dist/application/memory/storyMemoryTypes');
const {
  SqliteStoryMemoryStore,
  forkStoryMemory,
  StoryMemoryCasConflictError,
} = require('../dist/application/memory/storyMemoryRepository');

const evidence = [
  {
    eventId: 'ev-1', turnId: 'turn-1', stateVersion: 1, eventType: 'recordEvent',
    payload: { eventType: 'relationship_changed', actorId: 'actor-player', targetId: 'actor-npc' },
    publicSummary: '玩家与村民的关系发生变化',
  },
  {
    eventId: 'ev-2', turnId: 'turn-2', stateVersion: 2, eventType: 'committed_turn',
    payload: { outcomeGrade: 'success' }, publicSummary: '村民托付承诺',
  },
];

test('A23: deterministic known change with empty observations cannot advance coverage', () => {
  const outcome = compileObservations({
    branchId: 'b',
    evidence,
    rawObservationText: '{"observations": []}',
    knownChangePolicy: { requireKnownChangeCoverage: true },
  });
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.advanceCheckpoint, false);
  assert.ok(outcome.diagnostics.some(d => d.code === 'known_change_missing'));
});

test('A24: a legitimate no_change batch advances explicitly; field clearing needs explicit actions', () => {
  const quiet = [{
    eventId: 'ev-1', turnId: 'turn-1', stateVersion: 1, eventType: 'committed_turn',
    payload: { outcomeGrade: 'success' }, publicSummary: '平静的一回合',
  }];
  const outcome = compileObservations({
    branchId: 'b',
    evidence: quiet,
    rawObservationText: '{"observations": []}',
    knownChangePolicy: { requireKnownChangeCoverage: true },
  });
  assert.equal(outcome.accepted, true, 'no deterministic known change means empty is legitimate');
  assert.equal(outcome.advanceCheckpoint, true);
  assert.equal(outcome.legitimateNoChange, true);
  assert.equal(hasDeterministicKnownChange(quiet), false);
});

test('observations citing evidence outside the batch are rejected with diagnostics', () => {
  const outcome = compileObservations({
    branchId: 'b',
    evidence,
    rawObservationText: JSON.stringify({
      observations: [{
        kind: 'character', action: 'upsert', actorId: 'actor-npc',
        title: '村民', evidenceTurnIds: ['turn-99'],
      }],
    }),
    knownChangePolicy: { requireKnownChangeCoverage: false },
  });
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.acceptedObservations.length, 0);
  assert.equal(outcome.rejected.length, 1);
  assert.ok(outcome.rejected[0].diagnostics.some(d => d.code === 'unknown_evidence_ref'));
});

test('accepted-only: valid observations pass while invalid ones land in rejected with reasons', () => {
  const outcome = compileObservations({
    branchId: 'b',
    evidence,
    rawObservationText: JSON.stringify({
      observations: [
        { kind: 'character', action: 'upsert', actorId: 'actor-npc', evidenceTurnIds: ['turn-1'] },
        { kind: 'character', action: 'upsert', actorId: 'actor-ghost', evidenceTurnIds: ['turn-42'] },
      ],
    }),
    knownChangePolicy: { requireKnownChangeCoverage: false },
  });
  assert.equal(outcome.accepted, true, 'independent valid observations still compile');
  assert.equal(outcome.acceptedObservations.length, 1);
  assert.equal(outcome.acceptedObservations[0].actorId, 'actor-npc');
  assert.equal(outcome.rejected.length, 1, 'the invalid observation is rejected, not silently kept');
  assert.ok(outcome.acceptedSummary.every(line => line.includes('actor-npc') || !line.includes('actor-ghost')));
});

function baseState() {
  return emptyStoryMemoryState('b1', '2026-10-04T00:00:00.000Z');
}

test('A22: entity change time comes from the cited evidence, not the batch end', () => {
  const base = baseState();
  base.throughStateVersion = 0;
  const patch = {
    schemaVersion: 2,
    range: { fromStateVersion: 0, toStateVersion: 8 },
    characterUpdates: [
      // Cites turn-2 (v2): must be stamped v2 even though the batch ends at v8.
      { actorId: 'npc-early', action: 'upsert', currentGoal: '早期目标', evidenceTurnIds: ['turn-2'] },
      // Cites turn-8 (v8): latest evidence.
      { actorId: 'npc-late', action: 'upsert', currentGoal: '最新目标', evidenceTurnIds: ['turn-8'] },
    ],
    relationshipUpdates: [],
    conflictChanges: [],
    threadChanges: [],
    foreshadowingChanges: [],
    completedBeats: [],
  };
  const turnVersions = new Map([
    ['turn-2', 2], ['turn-8', 8],
  ]);
  const merged = mergeStoryMemoryPatch(base, {
    patch, patchId: 'p1', baseFingerprint: base.metadata.fingerprint, turnVersions, now: 'now',
  });
  assert.equal(merged.characters['npc-early'].lastChangedStateVersion, 2);
  assert.equal(merged.characters['npc-late'].lastChangedStateVersion, 8);
});

function openTestDb() {
  return {
    async execute(sql, params = []) { return 1; },
    async queryAll(sql, params = []) { return []; },
  };
}

test('A19: a CAS conflict aborts the whole atomic checkpoint application', async () => {
  // Fake transactional store: the CAS write refuses, so the patch insert must
  // roll back with it — verified by the rollback hook.
  let rolledBack = false;
  let insertedPatch = false;
  const fakeDb = {
    async execute(sql, params = []) {
      if (/UPDATE story_memory_states SET/.test(sql)) {
        return 0; // simulate a concurrent writer having advanced the state
      }
      if (/INSERT INTO story_memory_patches/.test(sql)) insertedPatch = true;
      return 1;
    },
    async queryAll() { return []; },
    async transaction(work) {
      const tx = this;
      try {
        await work(tx);
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    },
  };
  const store = new SqliteStoryMemoryStore(fakeDb);
  const base = baseState();
  base.throughStateVersion = 0;
  base.metadata.fingerprint = 'fp-base';
  await assert.rejects(
    () => store.applyCheckpointAtomically({
      patchRow: {
        patchId: 'p-cas', fromStateVersion: 0, toStateVersion: 2,
        baseFingerprint: 'fp-base',
        patch: {
          schemaVersion: 2, range: { fromStateVersion: 0, toStateVersion: 2 },
          characterUpdates: [], relationshipUpdates: [], conflictChanges: [],
          threadChanges: [], foreshadowingChanges: [], completedBeats: [],
        },
      },
      nextState: { ...base, throughStateVersion: 2 },
    }),
    StoryMemoryCasConflictError,
  );
  assert.equal(rolledBack, true, 'the transaction rolled back');
  assert.equal(insertedPatch, true, 'the patch insert happened inside the rolled-back transaction');
});

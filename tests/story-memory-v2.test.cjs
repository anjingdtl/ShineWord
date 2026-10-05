const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { applySqliteMigrations } = require('../dist/infra/sqlite/migrations');
const { SqliteStoryMemoryStore } = require('../dist/application/memory/storyMemoryRepository');
const { emptyStoryMemoryState } = require('../dist/application/memory/storyMemoryTypes');
const { validateStoryMemoryPatch } = require('../dist/application/memory/storyMemoryValidator');
const { mergeStoryMemoryPatch, PatchFingerprintMismatchError } = require('../dist/application/memory/storyMemoryMerger');
const {
  evaluateMemoryCadence,
  planMemoryCoverage,
  extractMemorySignals,
} = require('../dist/application/memory/storyMemoryPolicy');
const { runStoryMemoryMaintenance, shouldRunMaintenance } = require('../dist/application/memory/storyMemoryMaintenance');
const { resolveModelCapabilities } = require('../dist/application/llm/capabilityResolver');
const { LlmRequestFailure } = require('../dist/application/llm/types');

const MEMORY_CAPABILITIES = resolveModelCapabilities({
  declared: { contextWindowTokens: 128_000, maxOutputTokens: 8_192 },
  reasoningMode: 'always_on',
});
const MEMORY_REASONING_POLICY = {
  tier: 'low', providerDialect: 'generic', model: 'test-memory-model',
};

class NodeSqliteAdapter {
  constructor(db) { this.db = db; }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  async transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = await work(this); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

async function memoryDb() {
  const adapter = new NodeSqliteAdapter(new DatabaseSync(':memory:'));
  await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  return adapter;
}

// ------------------------------------------------------------------ fixtures

function turnRow(version, { turnId = `t-${version}`, summary = `第${version}回合`, grade = 'success', effects = [], narrative = `第${version}回合的叙述。` } = {}) {
  return {
    branchId: 'b1', turnId, stateVersion: version, outcomeGrade: grade,
    publicSummary: summary, narrativeText: narrative, narrativeStatus: 'Committed',
    rollRecord: null, effects, committedAt: new Date().toISOString(),
  };
}

function fakeTurnStore(turns) {
  return { async listCommittedTurns(branchId) { return turns.filter(t => t.branchId === branchId); } };
}

/** Builds a provider whose responses come from a queue; each receives the request. */
function scriptedProvider(responses) {
  const requests = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      const next = queue.shift();
      if (next === undefined) throw new Error('scripted provider exhausted');
      return typeof next === 'function' ? next(request) : { text: JSON.stringify(next), usage: { estimated: true } };
    },
  };
}

function patchFor(range, extra = {}) {
  return {
    schemaVersion: 3,
    range,
    characterUpdates: [],
    relationshipUpdates: [],
    conflictChanges: [],
    threadChanges: [],
    foreshadowingChanges: [],
    completedBeats: [],
    ...extra,
    ...(extra.narrative ? { narrative: { ...extra.narrative,
      evidenceTurnIds: extra.narrative.evidenceTurnIds ?? [`t-${range.toStateVersion}`] } } : {}),
  };
}

function turnVersionsOf(batch) {
  return new Map(batch.map(turn => [turn.turnId, turn.stateVersion]));
}

// ---------------------------------------------------------------- merger unit

function seedState() {
  return emptyStoryMemoryState('b1', '2026-09-30T00:00:00Z');
}

test('merger: first character upsert lands with narrative fields', () => {
  const base = seedState();
  const patch = patchFor({ fromStateVersion: 0, toStateVersion: 4 }, {
    characterUpdates: [{
      actorId: 'actor-1', action: 'upsert',
      stableIdentitySummary: '落魄书生，心高气傲',
      emotionalState: '焦虑', currentGoal: '找到失散的妹妹',
      concerns: ['盘缠将尽'], promises: ['答应妹妹中秋前回家'],
      secretsKnownToPlayer: [], importantExperiences: ['山门遇袭'],
      evidenceTurnIds: ['t-1'],
    }],
    completedBeats: [{ turnId: 't-3', stateVersion: 3, summary: '在山门立誓' }],
  });
  const next = mergeStoryMemoryPatch(base, {
    patch, patchId: 'smp:b1:0-4', baseFingerprint: base.metadata.fingerprint,
    turnVersions: new Map([['t-1', 1], ['t-3', 3]]), now: 'x',
  });
  const character = next.characters['actor-1'];
  assert.equal(character.stableIdentitySummary, '落魄书生，心高气傲');
  assert.equal(character.currentNarrativeState.promises[0], '答应妹妹中秋前回家');
  assert.equal(next.narrative.recentCompletedBeats[0].summary, '在山门立誓');
  assert.equal(next.throughStateVersion, 4);
  assert.equal(next.metadata.status, 'clean');
  assert.equal(next.metadata.lastAppliedPatchId, 'smp:b1:0-4');
});

test('merger: later patch keeps unspecified fields and replaces lists', () => {
  const base = seedState();
  const first = mergeStoryMemoryPatch(base, {
    patch: patchFor({ fromStateVersion: 0, toStateVersion: 4 }, {
      characterUpdates: [{
        actorId: 'a', action: 'upsert', stableIdentitySummary: '旧',
        emotionalState: '平静', currentGoal: '旧目标',
        promises: ['承诺一', '承诺二'], evidenceTurnIds: ['t-1'],
      }],
    }),
    patchId: 'p1', baseFingerprint: base.metadata.fingerprint, turnVersions: new Map(), now: 'x',
  });
  const second = mergeStoryMemoryPatch(first, {
    patch: patchFor({ fromStateVersion: 4, toStateVersion: 8 }, {
      characterUpdates: [{
        actorId: 'a', action: 'upsert', emotionalState: '愤怒',
        promises: ['承诺一'], evidenceTurnIds: ['t-5'],
      }],
    }),
    patchId: 'p2', baseFingerprint: first.metadata.fingerprint, turnVersions: new Map(), now: 'x',
  });
  const character = second.characters.a;
  assert.equal(character.stableIdentitySummary, '旧', 'unspecified fields persist');
  assert.equal(character.currentNarrativeState.emotionalState, '愤怒');
  assert.deepEqual(character.currentNarrativeState.promises, ['承诺一'], 'lists replace wholesale');
});

test('merger: relationship upsert/remove with stable pair id', () => {
  const base = seedState();
  const withRel = mergeStoryMemoryPatch(base, {
    patch: patchFor({ fromStateVersion: 0, toStateVersion: 4 }, {
      relationshipUpdates: [{
        fromActorId: 'player', toActorId: 'npc-1', action: 'upsert',
        relationType: '同盟', currentNarrativeState: '因救命的恩情结盟',
        trustNarrative: '信任但存疑', importantPromises: ['同去南疆'],
        unresolvedTensions: [], publicStatus: 'misunderstood', evidenceTurnIds: ['t-2'],
      }],
    }),
    patchId: 'p1', baseFingerprint: base.metadata.fingerprint, turnVersions: new Map(), now: 'x',
  });
  const relationship = withRel.relationships['rel:player->npc-1'];
  assert.equal(relationship.publicStatus, 'misunderstood');
  const corrected = mergeStoryMemoryPatch(withRel, {
    patch: patchFor({ fromStateVersion: 4, toStateVersion: 8 }, {
      relationshipUpdates: [{
        fromActorId: 'player', toActorId: 'npc-1', action: 'upsert',
        publicStatus: 'public', evidenceTurnIds: ['t-6'],
      }],
    }),
    patchId: 'p2', baseFingerprint: withRel.metadata.fingerprint, turnVersions: new Map(), now: 'x',
  });
  assert.equal(corrected.relationships['rel:player->npc-1'].publicStatus, 'public');
  const removed = mergeStoryMemoryPatch(corrected, {
    patch: patchFor({ fromStateVersion: 8, toStateVersion: 12 }, {
      relationshipUpdates: [{
        fromActorId: 'player', toActorId: 'npc-1', action: 'remove', evidenceTurnIds: ['t-9'],
      }],
    }),
    patchId: 'p3', baseFingerprint: corrected.metadata.fingerprint, turnVersions: new Map(), now: 'x',
  });
  assert.equal(removed.relationships['rel:player->npc-1'], undefined);
});

test('merger: conflict open/resolve and foreshadowing plant/payoff keep stable title ids', () => {
  const base = seedState();
  const opened = mergeStoryMemoryPatch(base, {
    patch: patchFor({ fromStateVersion: 0, toStateVersion: 4 }, {
      conflictChanges: [{ title: '夺剑之争', action: 'open', description: '双方都要古剑', stakes: '门派脸面', evidenceTurnIds: ['t-1'] }],
      foreshadowingChanges: [{ title: '残缺的信', action: 'plant', description: '信中提到北疆', evidenceTurnIds: ['t-2'] }],
    }),
    patchId: 'p1', baseFingerprint: base.metadata.fingerprint, turnVersions: new Map(), now: 'x',
  });
  const conflictId = Object.keys(opened.narrative.activeConflicts)[0];
  const seedId = Object.keys(opened.narrative.foreshadowing)[0];
  const resolved = mergeStoryMemoryPatch(opened, {
    patch: patchFor({ fromStateVersion: 4, toStateVersion: 9 }, {
      conflictChanges: [{ title: '夺剑之争', action: 'resolve', resolution: '比武定归属', evidenceTurnIds: ['t-7'] }],
      foreshadowingChanges: [{ title: '残缺的信', action: 'payoff', payoff: '北疆藏有主线真相', evidenceTurnIds: ['t-8'] }],
    }),
    patchId: 'p2', baseFingerprint: opened.metadata.fingerprint, turnVersions: new Map(), now: 'x',
  });
  assert.equal(resolved.narrative.activeConflicts[conflictId], undefined, 'resolved conflict leaves active set');
  assert.equal(resolved.narrative.recentResolvedThreads[0].threadId, conflictId, 'same id');
  assert.equal(resolved.narrative.recentResolvedThreads[0].resolution, '比武定归属');
  assert.equal(resolved.narrative.foreshadowing[seedId].status, 'paid_off');
  assert.equal(resolved.narrative.foreshadowing[seedId].payoff, '北疆藏有主线真相');
});

test('merger: stale base fingerprint is refused', () => {
  const base = seedState();
  assert.throws(
    () => mergeStoryMemoryPatch(base, {
      patch: patchFor({ fromStateVersion: 0, toStateVersion: 4 }),
      patchId: 'p1', baseFingerprint: 'not-the-current-fingerprint',
      turnVersions: new Map(), now: 'x',
    }),
    error => error instanceof PatchFingerprintMismatchError,
  );
});

// -------------------------------------------------------------- validator

function validationContext(overrides = {}) {
  return {
    allowedActorIds: new Set(['player', 'npc-1', 'npc-2']),
    batchTurnIds: new Set(['t-1', 't-2', 't-3']),
    expectedFromVersion: 0,
    expectedToVersion: 3,
    ...overrides,
  };
}

test('validator: unknown actorId and unknown evidence turn are rejected', () => {
  assert.throws(
    () => validateStoryMemoryPatch(patchFor({ fromStateVersion: 0, toStateVersion: 3 }, {
      characterUpdates: [{ actorId: '老白', action: 'upsert', evidenceTurnIds: ['t-1'] }],
    }), validationContext()),
    /actorId .* is not a known actor/,
  );
  assert.throws(
    () => validateStoryMemoryPatch(patchFor({ fromStateVersion: 0, toStateVersion: 3 }, {
      characterUpdates: [{ actorId: 'player', action: 'upsert', evidenceTurnIds: ['t-999'] }],
    }), validationContext()),
    /cites unknown turnId/,
  );
});

test('validator: wrong range and missing evidence are rejected', () => {
  assert.throws(
    () => validateStoryMemoryPatch(patchFor({ fromStateVersion: 0, toStateVersion: 4 }), validationContext()),
    /range must be exactly 0\.\.3/,
  );
  assert.throws(
    () => validateStoryMemoryPatch(patchFor({ fromStateVersion: 0, toStateVersion: 3 }, {
      characterUpdates: [{ actorId: 'player', action: 'upsert', evidenceTurnIds: [] }],
    }), validationContext()),
    /must cite at least one evidenceTurnId/,
  );
});

test('validator: valid patch passes with normalized fields', () => {
  const patch = validateStoryMemoryPatch(patchFor({ fromStateVersion: 0, toStateVersion: 3 }, {
    characterUpdates: [{
      actorId: 'player', action: 'upsert', emotionalState: '警觉',
      promises: ['守口如瓶', ''], evidenceTurnIds: ['t-2'],
    }],
  }), validationContext());
  assert.deepEqual(patch.characterUpdates[0].promises, ['守口如瓶'], 'blank strings dropped');
});

test('validator: omitted sections mean no changes (real-provider tolerance)', () => {
  const patch = validateStoryMemoryPatch({
    schemaVersion: 3,
    range: { fromStateVersion: 0, toStateVersion: 3 },
    characterUpdates: [{
      actorId: 'player', action: 'upsert', emotionalState: '平静', evidenceTurnIds: ['t-1'],
    }],
    // relationshipUpdates / conflictChanges / threadChanges /
    // foreshadowingChanges / completedBeats all omitted
  }, validationContext());
  assert.deepEqual(patch.relationshipUpdates, []);
  assert.deepEqual(patch.conflictChanges, []);
  assert.deepEqual(patch.completedBeats, []);
  // Wrong types are still errors.
  assert.throws(
    () => validateStoryMemoryPatch({
      schemaVersion: 3,
      range: { fromStateVersion: 0, toStateVersion: 3 },
      characterUpdates: 'nope',
    }, validationContext()),
    /characterUpdates must be an array/,
  );
});

// ----------------------------------------------------------------- policy

test('policy: cadence fires on interval and on meaningful signals, not filler', () => {
  const filler = evaluateMemoryCadence({
    currentStateVersion: 4, memoryThroughVersion: 2, memoryStatus: 'clean', signals: [],
  });
  assert.equal(filler.shouldCheckpoint, false);

  const interval = evaluateMemoryCadence({
    currentStateVersion: 10, memoryThroughVersion: 2, memoryStatus: 'clean', signals: [],
  });
  assert.equal(interval.shouldCheckpoint, true);
  assert.ok(interval.reasons.includes('interval'));

  const meaningful = evaluateMemoryCadence({
    currentStateVersion: 4, memoryThroughVersion: 2, memoryStatus: 'clean',
    signals: [{ kind: 'relationship_change', stateVersion: 3 }],
  });
  assert.equal(meaningful.shouldCheckpoint, true);

  const dirty = evaluateMemoryCadence({
    currentStateVersion: 3, memoryThroughVersion: 2, memoryStatus: 'dirty', signals: [],
  });
  assert.ok(dirty.shouldCheckpoint && dirty.reasons.includes('dirty_rebuild'));
});

test('policy: extractMemorySignals reads committed effects deterministically', () => {
  const signals = extractMemorySignals({
    stateVersion: 5,
    outcomeGrade: 'critical_failure',
    effects: [
      { op: 'recordEvent', eventType: 'relationship_changed', summary: 'x' },
      { op: 'transferItem', itemId: 'i', fromActorId: 'a', toActorId: 'b' },
      { op: 'changeLocation', actorId: 'a', locationId: 'l' },
    ],
  });
  const kinds = new Set(signals.map(signal => signal.kind));
  assert.ok(kinds.has('high_importance'));
  assert.ok(kinds.has('relationship_change'));
  assert.ok(!kinds.has('quest_change'));
});

test('policy: no-stall coverage modes (clean / safe_lag / hard_gap)', () => {
  const clean = planMemoryCoverage({
    currentStateVersion: 8, memoryThroughVersion: 8,
    committedTurns: [turnRow(8)],
  });
  assert.equal(clean.mode, 'clean');

  const lag = planMemoryCoverage({
    currentStateVersion: 11, memoryThroughVersion: 8,
    committedTurns: [turnRow(9), turnRow(10), turnRow(11)],
  });
  assert.equal(lag.mode, 'safe_lag');
  assert.deepEqual(lag.bridgeTurns.map(turn => turn.stateVersion), [9, 10, 11]);

  const gap = planMemoryCoverage({
    currentStateVersion: 11, memoryThroughVersion: 8,
    committedTurns: [turnRow(9), turnRow(11)], // 10 missing
  });
  assert.equal(gap.mode, 'hard_gap');
});

// ------------------------------------------------------------ maintenance e2e

async function maintenanceFixture(turns, responses, options = {}) {
  const adapter = await memoryDb();
  const store = new SqliteStoryMemoryStore(adapter);
  const provider = scriptedProvider(responses);
  const { capabilities, reasoningPolicy, ...maintenanceOptions } = options;
  const result = await runStoryMemoryMaintenance({
    provider,
    store,
    turnStore: fakeTurnStore(turns),
    branchId: 'b1',
    currentStateVersion: options.current ?? turns.length,
    actors: [{ actorId: 'player', name: '主角' }, { actorId: 'npc-1', name: '白山君' }],
    capabilities: capabilities ?? MEMORY_CAPABILITIES,
    reasoningPolicy: reasoningPolicy ?? MEMORY_REASONING_POLICY,
    ...maintenanceOptions,
  });
  const state = await store.getState('b1');
  return { result, state, store, provider, adapter };
}

test('maintenance: first checkpoint folds characters, relationships, promises, secrets', async () => {
  const turns = [turnRow(1), turnRow(2), turnRow(3)];
  const { result, state, store } = await maintenanceFixture(turns, patchFor({ fromStateVersion: 0, toStateVersion: 3 }, {
    characterUpdates: [{
      actorId: 'npc-1', action: 'upsert', stableIdentitySummary: '隐居的前朝遗臣',
      emotionalState: '戒备', currentGoal: '护住旧主遗物',
      secretsKnownToPlayer: ['真实身份是前朝皇子'], evidenceTurnIds: ['t-1'],
    }],
    relationshipUpdates: [{
      fromActorId: 'player', toActorId: 'npc-1', action: 'upsert',
      relationType: '初步信任', currentNarrativeState: '因递伞结缘', evidenceTurnIds: ['t-2'],
    }],
  }));
  assert.equal(result.status, 'clean');
  assert.equal(result.throughStateVersion, 3);
  assert.equal(state.characters['npc-1'].currentNarrativeState.secretsKnownToPlayer[0], '真实身份是前朝皇子');
  assert.ok(state.relationships['rel:player->npc-1']);
  const patches = await store.listPatches('b1');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].status, 'applied');
});

test('maintenance: invalid patch gets one repair round, then clean apply', async () => {
  const turns = [turnRow(1), turnRow(2)];
  const bad = patchFor({ fromStateVersion: 0, toStateVersion: 2 }, {
    characterUpdates: [{ actorId: '白山君', action: 'upsert', evidenceTurnIds: ['t-1'] }],
  });
  const good = patchFor({ fromStateVersion: 0, toStateVersion: 2 }, {
    characterUpdates: [{ actorId: 'npc-1', action: 'upsert', emotionalState: '平静', evidenceTurnIds: ['t-1'] }],
  });
  const { result, state, provider } = await maintenanceFixture(turns, [bad, good]);
  assert.equal(result.status, 'clean');
  assert.ok(state.characters['npc-1']);
  assert.equal(provider.requests.length, 2);
  assert.ok(provider.requests[1].user.includes('rejected'), 'repair round feeds errors back');
  assert.equal(provider.requests[0].requestKind, 'memory_checkpoint');
  assert.equal(provider.requests[0].reasoningTier, 'low');
  assert.equal(provider.requests[0].reasoningReserveTokens, 2_048);
  assert.equal(provider.requests[0].maxOutputTokens, 6_048, 'wire ceiling includes business output and reasoning reserve');
  assert.equal(provider.requests[1].ledger.requestKind, 'memory_repair');
  assert.equal(provider.requests[1].reasoningTier, 'low', 'repair keeps the same user-selected tier');
  assert.equal(provider.requests[1].maxOutputTokens, 5_048, 'repair has its own business output demand');
});

test('maintenance: reasoning_only retries same logical batch/tier with a larger policy reserve', async () => {
  const { result, provider } = await maintenanceFixture([turnRow(1), turnRow(2)], [
    async () => { throw new LlmRequestFailure('reasoning-only', [{
      attempt: 1, durationMs: 12, httpStatus: 200, outcome: 'reasoning_only', completionState: 'reasoning_only',
    }]); },
    patchFor({ fromStateVersion: 0, toStateVersion: 2 }),
  ]);
  assert.equal(result.status, 'clean');
  assert.equal(provider.requests.length, 2);
  assert.equal(provider.requests[0].ledger.logicalRequestId, provider.requests[1].ledger.logicalRequestId);
  assert.equal(provider.requests[0].reasoningTier, 'low');
  assert.equal(provider.requests[1].reasoningTier, 'low');
  assert.equal(provider.requests[0].reasoningReserveTokens, 2_048);
  assert.equal(provider.requests[1].reasoningReserveTokens, 3_072);
  assert.ok(provider.requests[1].maxOutputTokens > provider.requests[0].maxOutputTokens);
});

test('maintenance: max reasoning shrinks a whole-turn batch before sending it', async () => {
  const turns = Array.from({ length: 8 }, (_, index) => turnRow(index + 1, {
    summary: `事件${index + 1}: ${'证据'.repeat(700)}`,
    narrative: `叙述${index + 1}: ${'动作与对话'.repeat(2_000)}`,
  }));
  const capabilities = resolveModelCapabilities({
    declared: { contextWindowTokens: 40_000, maxOutputTokens: 32_768 },
    reasoningMode: 'always_on',
  });
  const provider = scriptedProvider([
    patchFor({ fromStateVersion: 0, toStateVersion: 4 }, { narrative: { currentObjective: '前四回合' } }),
    patchFor({ fromStateVersion: 4, toStateVersion: 8 }, { narrative: { currentObjective: '后四回合' } }),
  ]);
  const adapter = await memoryDb();
  const store = new SqliteStoryMemoryStore(adapter);
  const result = await runStoryMemoryMaintenance({
    provider, store, turnStore: fakeTurnStore(turns), branchId: 'b1', currentStateVersion: 8,
    actors: [{ actorId: 'player', name: '主角' }, { actorId: 'npc-1', name: '白山君' }],
    capabilities,
    reasoningPolicy: { tier: 'max', providerDialect: 'generic', model: 'test-memory-model' },
  });
  assert.equal(result.status, 'clean');
  assert.equal(provider.requests.length, 2);
  assert.equal(provider.requests[0].ledger.logicalRequestId, 'memory:b1:v0-4');
  assert.equal(provider.requests[0].reasoningTier, 'max');
  assert.equal(provider.requests[0].reasoningReserveTokens, 24_576);
  assert.match(provider.requests[0].user, /"toStateVersion":4/);
  assert.doesNotMatch(provider.requests[0].user, /"turnId":"t-8"/);
  assert.equal(provider.requests[1].ledger.logicalRequestId, 'memory:b1:v4-8');
  assert.equal((await store.getState('b1')).throughStateVersion, 8);
});

test('maintenance: repeated failures mark memory failed but never throw (no-stall)', async () => {
  const turns = [turnRow(1), turnRow(2)];
  const { result, state } = await maintenanceFixture(turns, [
    patchFor({ fromStateVersion: 0, toStateVersion: 5 }, { narrative: { currentObjective: 'x' } }),
    patchFor({ fromStateVersion: 0, toStateVersion: 5 }, { narrative: { currentObjective: 'x' } }),
  ]);
  assert.equal(result.status, 'failed');
  assert.equal(state.metadata.status, 'failed');
  assert.equal(state.metadata.dirtyFromStateVersion, 1);
});

test('maintenance: 16 turns split into batches of 8 across one run', async () => {
  const turns = Array.from({ length: 16 }, (_, i) => turnRow(i + 1));
  const { result, state } = await maintenanceFixture(turns, [
    patchFor({ fromStateVersion: 0, toStateVersion: 8 }, { narrative: { currentObjective: '上半' } }),
    patchFor({ fromStateVersion: 8, toStateVersion: 16 }, { narrative: { currentObjective: '下半' } }),
  ], { current: 16 });
  assert.equal(result.status, 'clean');
  assert.equal(result.appliedPatchIds.length, 2);
  assert.equal(state.throughStateVersion, 16);
  assert.equal(state.narrative.currentObjective, '下半');
});

test('maintenance: request cap reports partial coverage instead of clean', async () => {
  const { result, state } = await maintenanceFixture([turnRow(1), turnRow(2)], [
    patchFor({ fromStateVersion: 0, toStateVersion: 1 }),
  ], { maxBatchTurns: 1, maxAttempts: 1 });
  assert.equal(result.status, 'partial');
  assert.equal(result.throughStateVersion, 1);
  assert.equal(state.throughStateVersion, 1);
});

test('maintenance: hard gap fails closed without LLM', async () => {
  const turns = [turnRow(1), turnRow(2), turnRow(4)]; // 3 missing
  const { result } = await maintenanceFixture(turns, [], { current: 4 });
  assert.equal(result.status, 'hard_gap');
});

test('maintenance: shouldRunMaintenance gate (cadence before any LLM)', async () => {
  const adapter = await memoryDb();
  const store = new SqliteStoryMemoryStore(adapter);
  const quiet = await shouldRunMaintenance({
    store, turnStore: fakeTurnStore([turnRow(1), turnRow(2)]), branchId: 'b1', currentStateVersion: 2,
  });
  assert.equal(quiet.should, false);
  const loud = await shouldRunMaintenance({
    store, turnStore: fakeTurnStore([
      turnRow(1), turnRow(2, { effects: [{ op: 'transferItem', itemId: 'i', fromActorId: 'player', toActorId: 'npc-1' }] }),
    ]), branchId: 'b1', currentStateVersion: 2,
  });
  assert.equal(loud.should, true);
});

// ------------------------------------------------------------- fork isolation

test('fork: branch-B inherits patches <= fork version and never the source future', async () => {
  const adapter = await memoryDb();
  const store = new SqliteStoryMemoryStore(adapter);
  const turns = Array.from({ length: 12 }, (_, i) => turnRow(i + 1));
  // Build memory through v12 on b1 in two patches.
  const provider = scriptedProvider([
    patchFor({ fromStateVersion: 0, toStateVersion: 8 }, {
      conflictChanges: [{ title: '主线冲突', action: 'open', description: 'b1前期', evidenceTurnIds: ['t-1'] }],
    }),
    patchFor({ fromStateVersion: 8, toStateVersion: 12 }, {
      characterUpdates: [{ actorId: 'npc-1', action: 'upsert', currentGoal: 'b1后期目标', evidenceTurnIds: ['t-10'] }],
    }),
  ]);
  await runStoryMemoryMaintenance({
    provider, store, turnStore: fakeTurnStore(turns), branchId: 'b1',
    currentStateVersion: 12, actors: [{ actorId: 'player', name: 'p' }, { actorId: 'npc-1', name: 'n' }],
    capabilities: MEMORY_CAPABILITIES, reasoningPolicy: MEMORY_REASONING_POLICY,
  });

  // Fork b1 -> b2 inside a transaction, at v9 (patches <= 9 keep only 0-8).
  await adapter.execute(
    `INSERT INTO worlds (world_id, title, source_sha256, source_bytes, normalize_version,
        chapter_split_version, build_status, created_at, updated_at)
     VALUES ('w1', '测试世界', 'hash', 1, 'v1', 'v1', 'ready', '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z')`,
  );
  await adapter.execute(
    `INSERT INTO campaigns (campaign_id, world_id, title, ruleset_id, ruleset_version,
        world_mapping_version, opening_json, created_at)
     VALUES ('c1', 'w1', '测试战役', 'shineword', '0.3.0', '1', '{}', '2026-09-30T00:00:00Z')`,
  );
  await adapter.execute(
    `INSERT INTO branches (branch_id, campaign_id, parent_branch_id, fork_turn_id, state_version, created_at)
     VALUES ('b1', 'c1', NULL, NULL, 12, '2026-09-30T00:00:00Z')`,
  );
  await adapter.transaction(async tx => {
    const { forkStoryMemory } = require('../dist/application/memory/storyMemoryRepository');
    await tx.execute(
      `INSERT INTO branches (branch_id, campaign_id, parent_branch_id, fork_turn_id, state_version, created_at)
       VALUES ('b2', 'c1', 'b1', NULL, 9, '2026-09-30T00:00:00Z')`,
    );
    await forkStoryMemory(tx, { sourceBranchId: 'b1', targetBranchId: 'b2', forkStateVersion: 9, createdAt: '2026-09-30T00:00:00Z' });
  });

  const b2 = await store.getState('b2');
  assert.ok(b2, 'fork creates a memory state');
  assert.equal(b2.throughStateVersion, 8, 'only the pre-fork patch folds in');
  assert.equal(b2.characters['npc-1'], undefined, 'post-fork character knowledge never crosses');
  assert.ok(Object.keys(b2.narrative.activeConflicts).length === 1, 'pre-fork conflict survives');
  const b2Patches = await store.listPatches('b2');
  assert.equal(b2Patches.length, 1);
  assert.equal(b2Patches[0].toStateVersion, 8);
  // Source branch untouched.
  const b1 = await store.getState('b1');
  assert.equal(b1.throughStateVersion, 12);
});

test('migration 20 creates story memory tables', async () => {
  const adapter = new NodeSqliteAdapter(new DatabaseSync(':memory:'));
  const applied = await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  assert.ok(applied.includes(100));
  const tables = await adapter.queryAll(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('story_memory_states','story_memory_patches')",
  );
  assert.equal(tables.length, 2);
});

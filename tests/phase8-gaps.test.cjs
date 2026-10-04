/**
 * Phase 8 gap regressions (PROTOCOL_BASELINE.md §7, plan §26.3).
 *
 * These six minimal tests were committed RED at P8-0: each one reproduces a
 * confirmed production gap on the P8 baseline. They turn green as their
 * owning package lands (G1/G2 -> P8-1, G3 -> P8-3, G4 -> P8-4, G5/G6 -> P8-5)
 * and must stay green afterwards as current-protocol regressions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function requireModule(relPath, phase) {
  try {
    return require(relPath);
  } catch (error) {
    if (error && (error.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(String(error.message)))) {
      assert.fail(`P8 gap: ${phase} module not yet implemented (${relPath})`);
    }
    throw error;
  }
}

const hashProvider = {
  sha256Hex(input) {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  },
};

async function setupStoryMemoryDb() {
  const db = new DatabaseSync(':memory:');
  const adapter = new NodeSqliteAdapter(db);
  const { applySqliteMigrations } = require('../dist/infra/sqlite/migrations');
  const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
  await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  return db;
}

/** Minimal async adapter over node:sqlite (same semantics as mobile RN adapter). */
class NodeSqliteAdapter {
  constructor(db) { this.db = db; }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  async transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = await work(this);
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function cleanMemoryState(branchId, throughStateVersion) {
  return {
    schemaVersion: 2,
    branchId,
    throughStateVersion,
    characters: {
      'actor-player': {
        actorId: 'actor-player',
        stableIdentitySummary: '主角',
        currentNarrativeState: {
          emotionalState: '坚定',
          currentGoal: '查明真相',
          concerns: [],
          promises: [],
          secretsKnownToPlayer: [],
        },
        importantExperiences: [],
        lastChangedStateVersion: throughStateVersion,
      },
    },
    relationships: {},
    narrative: {
      currentArc: null,
      currentObjective: '查明真相',
      activeConflicts: [],
      openThreads: [],
      foreshadowing: [],
      recentCompletedBeats: [],
      recentResolvedThreads: [],
      archiveDigest: '',
    },
    metadata: {
      status: 'clean',
      dirtyFromStateVersion: null,
      fingerprint: 'fp-future',
      lastAppliedPatchId: null,
      updatedAt: '2026-10-04T00:00:00.000Z',
    },
  };
}

// G1 (B02): 【当前局面】 and unknown labels are silently dropped by the
// string-label collector (candidateCollector.ts:87-119). P8-1 replaces it
// with typed collection: every input part must either land as a candidate
// or be reported as a diagnostic — never vanish.
test('G1: situation parts and unknown labels produce candidates or diagnostics, never silent drops', () => {
  const collector = requireModule('../dist/application/context/turnMaterialCollector', 'P8-1');
  const result = collector.collectTypedCandidates({
    parts: [
      '【当前局面】粮仓起火，火势正在蔓延（压力：正在加剧）',
      '【完全不认识的标签】神秘材料',
      '【世界】边陲镇位于边境',
    ],
    queryText: '粮仓起火',
  });
  const boards = result.candidates.map(item => item.board);
  assert.ok(
    boards.includes('currentState'),
    'the active-situation part must reach the currentState board',
  );
  assert.ok(
    result.diagnostics.length >= 1
      && result.diagnostics.some(item => /完全不认识的标签/.test(item.detail || item.message || '')),
    'unknown labels must be reported as diagnostics',
  );
  assert.ok(boards.includes('worldKnowledge'), 'mapped labels keep their board');
});

// G2 (B03/B04): the production read gate only checks `clean && lag <= 8`
// (session.ts:1166-1175), so a checkpoint whose throughStateVersion is AHEAD
// of the current branch state is treated as usable memory. P8-1 introduces
// discriminating checkpoint eligibility.
test('G2: a checkpoint with future coverage is rejected, not returned as usable body', () => {
  const eligibility = requireModule('../dist/application/memory/storyMemoryEligibility', 'P8-1');
  const verdict = eligibility.evaluateCheckpointEligibility({
    memoryState: cleanMemoryState('branch-a', 20),
    branchId: 'branch-a',
    currentStateVersion: 15,
    committedTurnVersions: [],
  });
  assert.equal(verdict.usable, false, 'future memory must not be usable');
  assert.ok(verdict.code, 'rejection must carry a diagnostic code');
  assert.equal(verdict.checkpoint, undefined, 'rejected verdict must not expose a memory body');
});

// G3 (B06/T01): there is no persisted freeze — lastTurnContexts is a
// debugging field and a corrupted envelope silently degrades into a live-DB
// refreeze. P8-3 adds durable frozen turn materials with explicit failure.
test('G3: a corrupted persisted freeze fails explicitly with zero LLM calls', async () => {
  const { RootFrozenMaterialsStore } = requireModule(
    '../dist/application/context/frozenTurnMaterialsStore',
    'P8-3',
  );
  const db = await setupStoryMemoryDb();
  const store = new RootFrozenMaterialsStore(new NodeSqliteAdapter(db), hashProvider);
  await store.saveRootSnapshot({
    campaignId: 'campaign-a',
    branchId: 'branch-a',
    turnId: 'turn-1',
    logicalRequestId: 'planner:turn-1',
    role: 'planner',
    stage: 'context_bundle',
    attempt: 1,
    payload: {
      stateBaseline: { branchId: 'branch-a', expectedStateVersion: 0 },
      capabilitiesFingerprint: 'cap-1',
      materials: [{ id: 'm1', kind: 'situation', contentHash: 'h1' }],
    },
    createdAt: '2026-10-04T00:00:00.000Z',
  });
  // Corrupt the persisted JSON directly.
  db.prepare(
    'UPDATE frozen_turn_material_roots SET payload_json = ? WHERE turn_id = ?',
  ).run('{not json', 'turn-1');
  await assert.rejects(
    () => store.loadRootSnapshot('branch-a', 'turn-1', 'planner:turn-1'),
    error => /frozen|corrupt|损坏/i.test(String(error && error.message)),
    'corrupted freeze must fail explicitly instead of reading the live DB',
  );
  // The original envelope is preserved for diagnostics, not deleted.
  const raw = await store.rawPayloadJson('branch-a', 'turn-1', 'planner:turn-1');
  assert.equal(raw, '{not json', 'the corrupt envelope is kept, never silently replaced');
});

// G4 (B08/B12-of-plan): authoritative commits have no durable post-processing
// handoff; the commit transaction has no outbox, so an outbox failure cannot
// roll the commit back. P8-4 puts commit + outbox in one transaction.
test('G4: committing a turn writes a handoff outbox row in the same transaction, and outbox failure rolls everything back', async () => {
  const { SqliteTurnStore } = requireModule('../dist/infra/sqlite/sqliteTurnStore', 'P8-4');
  const db = await setupStoryMemoryDb();
  db.prepare(
    'INSERT INTO branches (branch_id, campaign_id, state_version, created_at) VALUES (?, ?, ?, ?)',
  ).run('branch-a', 'campaign-a', 0, '2026-10-04T00:00:00.000Z');
  db.prepare(
    `INSERT INTO actor_states (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('branch-a', 'actor-player', 0, 'start', JSON.stringify({ stamina: 10 }), '[]');
  db.prepare(
    `INSERT INTO snapshots (branch_id, state_version, snapshot_json, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(
    'branch-a',
    0,
    JSON.stringify({
      branchId: 'branch-a',
      stateVersion: 0,
      clockSeconds: 0,
      actors: {
        'actor-player': { actorId: 'actor-player', locationId: 'start', resources: { stamina: 10 }, conditions: [] },
      },
      itemOwners: {},
      abilitiesUsed: {},
    }),
    '2026-10-04T00:00:00.000Z',
  );
  const store = new SqliteTurnStore(new NodeSqliteAdapter(db));
  const contract = {
    protocolVersion: '1.0',
    turnId: 'turn-1',
    expectedStateVersion: 0,
    actorId: 'actor-player',
    actionType: 'observe',
    evidenceIds: [],
    requiresRoll: false,
    intent: '观察四周',
    timeCostMinutes: 5,
    resourcePreconditions: [],
    outcomes: {},
  };
  // With the P8-4 contract the commit must produce exactly one handoff row
  // for the authoritative commit, in the same SQLite transaction.
  await store.commitAtomic({
    branchId: 'branch-a',
    turnId: 'turn-1',
    expectedStateVersion: 0,
    actionContractJson: JSON.stringify(contract),
    actionContractHash: hashProvider.sha256Hex(JSON.stringify(contract)),
    committedTurn: {
      branchId: 'branch-a',
      turnId: 'turn-1',
      previousStateVersion: 0,
      stateVersion: 1,
      outcomeGrade: 'success',
      publicSummary: '观察了四周',
      effects: [],
      committedAt: '2026-10-04T00:00:00.000Z',
    },
    nextState: {
      branchId: 'branch-a',
      stateVersion: 1,
      clockSeconds: 300,
      actors: {
        'actor-player': { actorId: 'actor-player', locationId: 'start', resources: { stamina: 10 }, conditions: [] },
      },
      itemOwners: {},
      abilitiesUsed: {},
    },
  });
  const outboxRows = db.prepare('SELECT COUNT(*) AS n FROM frozen_turn_postprocess_outbox').get();
  assert.equal(outboxRows.n, 1, 'an authoritative commit must leave exactly one handoff row');

  // Fault injection: an outbox write failure must abort the whole commit.
  const db2 = await setupStoryMemoryDb();
  db2.prepare(
    'INSERT INTO branches (branch_id, campaign_id, state_version, created_at) VALUES (?, ?, ?, ?)',
  ).run('branch-a', 'campaign-a', 0, '2026-10-04T00:00:00.000Z');
  db2.prepare(
    `INSERT INTO actor_states (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('branch-a', 'actor-player', 0, 'start', JSON.stringify({ stamina: 10 }), '[]');
  db2.prepare(
    `INSERT INTO snapshots (branch_id, state_version, snapshot_json, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(
    'branch-a',
    0,
    JSON.stringify({
      branchId: 'branch-a',
      stateVersion: 0,
      clockSeconds: 0,
      actors: {
        'actor-player': { actorId: 'actor-player', locationId: 'start', resources: { stamina: 10 }, conditions: [] },
      },
      itemOwners: {},
      abilitiesUsed: {},
    }),
    '2026-10-04T00:00:00.000Z',
  );
  // Drop the outbox table so the in-transaction insert fails.
  db2.exec('DROP TABLE frozen_turn_postprocess_outbox');
  const store2 = new SqliteTurnStore(new NodeSqliteAdapter(db2));
  await assert.rejects(
    () => store2.commitAtomic({
      branchId: 'branch-a',
      turnId: 'turn-2',
      expectedStateVersion: 0,
      actionContractJson: JSON.stringify(contract),
      actionContractHash: hashProvider.sha256Hex(JSON.stringify(contract)),
      committedTurn: {
        branchId: 'branch-a',
        turnId: 'turn-2',
        previousStateVersion: 0,
        stateVersion: 1,
        outcomeGrade: 'success',
        publicSummary: '观察了四周',
        effects: [],
        committedAt: '2026-10-04T00:00:00.000Z',
      },
      nextState: {
        branchId: 'branch-a',
        stateVersion: 1,
        clockSeconds: 300,
        actors: {
          'actor-player': { actorId: 'actor-player', locationId: 'start', resources: { stamina: 10 }, conditions: [] },
        },
        itemOwners: {},
        abilitiesUsed: {},
      },
    }),
    undefined,
    'outbox failure must abort the commit',
  );
  const version = db2.prepare('SELECT state_version AS v FROM branches WHERE branch_id = ?').get('branch-a');
  assert.equal(version.v, 0, 'the whole commit must roll back when the outbox insert fails');
  const turns = db2.prepare('SELECT COUNT(*) AS n FROM turns WHERE turn_id = ?').get('turn-2');
  assert.equal(turns.n, 0, 'no committed turn row may survive a rolled-back commit');
});

// G5 (B09/I09): saveState is a bare UPSERT (storyMemoryRepository.ts:75-100)
// with no fingerprint CAS, so a stale worker can silently overwrite a newer
// checkpoint. P8-5 adds the CAS repository.
test('G5: story memory state writes are CAS-guarded; a stale fingerprint is refused', async () => {
  const { SqliteStoryMemoryStore } = requireModule(
    '../dist/application/memory/storyMemoryRepository',
    'P8-5',
  );
  const db = await setupStoryMemoryDb();
  const store = new SqliteStoryMemoryStore(new NodeSqliteAdapter(db), hashProvider);
  const first = cleanMemoryState('branch-a', 8);
  first.metadata.fingerprint = 'fp-1';
  await store.saveState(first);
  const second = cleanMemoryState('branch-a', 16);
  second.metadata.fingerprint = 'fp-2';
  await store.saveStateCas(second, { expectedFingerprint: 'fp-1' });
  // A stale writer still holding fp-1 must be refused, not clobber fp-2.
  const stale = cleanMemoryState('branch-a', 10);
  stale.metadata.fingerprint = 'fp-stale';
  await assert.rejects(
    () => store.saveStateCas(stale, { expectedFingerprint: 'fp-1' }),
    error => /fingerprint|CAS|stale/i.test(String(error && error.message)),
  );
  const current = await store.getState('branch-a');
  assert.equal(current.throughStateVersion, 16, 'the newer checkpoint must survive');
  assert.equal(current.metadata.fingerprint, 'fp-2');
});

// G6 (T11/A23): there is no observation protocol — a checkpoint that returns
// nothing can still mark the batch applied and advance clean coverage even
// when the batch evidence contains deterministic known changes. P8-5 adds the
// observation compiler with known-change gating.
test('G6: empty observations on a batch with deterministic known changes must not advance clean coverage', () => {
  const { compileObservations, hasDeterministicKnownChange } = requireModule(
    '../dist/application/memory/storyMemoryObservationCompiler',
    'P8-5',
  );
  const evidence = [
    {
      eventId: 'ev-1',
      turnId: 'turn-1',
      stateVersion: 1,
      eventType: 'recordEvent',
      payload: { eventType: 'relationship_changed', actorId: 'actor-player', targetId: 'actor-npc' },
      publicSummary: '玩家与村民的关系发生变化',
    },
    {
      eventId: 'ev-2',
      turnId: 'turn-2',
      stateVersion: 2,
      eventType: 'recordEvent',
      payload: { eventType: 'quest_started', questId: 'quest-barn' },
      publicSummary: '主线任务开始',
    },
  ];
  assert.equal(
    hasDeterministicKnownChange(evidence),
    true,
    'the fixture evidence carries deterministic known changes',
  );
  const outcome = compileObservations({
    branchId: 'branch-a',
    evidence,
    rawObservationText: '{"observations": []}',
    knownChangePolicy: { requireKnownChangeCoverage: true },
  });
  assert.equal(outcome.accepted, false, 'empty observations must not be accepted');
  assert.equal(
    outcome.advanceCheckpoint,
    false,
    'coverage must not advance to clean when key changes are missing',
  );
  assert.ok(outcome.diagnostics.length >= 1, 'the miss must be reported as a diagnostic');
});

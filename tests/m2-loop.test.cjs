const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');

// P8-6: the V1 contract-authoring chain (runLlmTurn) is deleted. This loop
// now runs the current V2 chain — the scripted planner emits the restricted
// proposal and the LOCAL compiler authors the contract.
const { runV2Turn } = require('../dist/application/game/v2Turn');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');
const { SqliteNarrativeStore } = require('../dist/infra/sqlite/sqliteNarrativeStore');

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

class ConstantRandom {
  nextIntInclusive(min, max) { return max; }
}

class FailIfUsedRandom {
  nextIntInclusive() { throw new Error('RNG was incorrectly invoked during recovery'); }
}

const hashProvider = {
  sha256Hex(input) {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  },
};

function setupDb() {
  const db = new DatabaseSync(':memory:');
  // P8-4: current-protocol schema (all builtin migrations) so every
  // authoritative commit can write its post-processing handoff.
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) db.exec(statement);
  }
  db.prepare(
    'INSERT INTO branches (branch_id, campaign_id, state_version, created_at) VALUES (?, ?, ?, ?)',
  ).run('branch-a', 'campaign-a', 0, '2026-09-26T00:00:00.000Z');
  db.prepare(
    `INSERT INTO actor_states
      (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('branch-a', 'actor-player', 0, 'scene', JSON.stringify({ stamina: 10 }), '[]');
  db.prepare(
    `INSERT INTO snapshots
      (branch_id, state_version, snapshot_json, state_hash, created_at)
     VALUES (?, ?, ?, NULL, ?)`,
  ).run(
    'branch-a',
    0,
    JSON.stringify({
      branchId: 'branch-a', stateVersion: 0, clockSeconds: 0,
      actors: {
        'actor-player': { actorId: 'actor-player', locationId: 'scene', resources: { stamina: 10 }, conditions: [] },
      },
      itemOwners: {},
      abilitiesUsed: {},
    }),
    '2026-09-26T00:00:00.000Z',
  );
  return db;
}

function makeCard() {
  return {
    actorId: 'actor-player',
    name: '玩家',
    kind: 'original',
    controller: 'player',
    attributes: { physique: 2, agility: 2, insight: 2, knowledge: 2, willpower: 2, social: 2 },
    skills: { investigation: 'trained' },
    abilities: [],
    preparedAbilities: [],
    resourceMax: { stamina: 10, hp: 10 },
    defense: 10,
    powerTier: 'ordinary',
    rulesetId: 'shineword-core',
    rulesetVersion: '0.4.0',
    worldId: 'w-fixture',
    worldPackageRevision: 1,
    cardRevision: 1,
  };
}

const catalog = {
  investigation: {
    name: '调查', description: '仔细检查线索', attribute: 'insight', allowUntrained: false,
    requirements: [], powerTier: 'ordinary', usage: 'knowledge',
  },
};

const scenes = [{
  sceneId: 'scene', name: '场景', description: '测试地点', locationId: 'scene',
  zones: [{ zoneId: 'z', name: '中央', cover: false, exits: [] }],
  actors: [], visibleItems: [], hazards: [], clues: [],
}];

class ScriptedProvider {
  constructor(options = {}) {
    this.failNarratorFor = options.failNarratorFor ?? null;
    this.failed = false;
    this.calls = [];
  }

  async complete(request) {
    this.calls.push(request.role);
    const payload = JSON.parse(request.user);

    if (request.role === 'Planner') {
      const index = Number(payload.turnId.split('-').pop());
      const risky = index % 3 === 0;
      const proposal = {
        proposalVersion: '2.0',
        turnId: payload.turnId,
        expectedStateVersion: payload.expectedStateVersion,
        actorId: 'actor-player',
        actionKind: risky ? 'skill_check' : 'move',
        ...(risky ? { skillId: 'investigation', difficultyBand: 'normal' } : { destinationId: 'scene' }),
        evidenceIds: ['fixture-fact'],
        intent: `执行 ${payload.turnId}`,
      };
      return { text: JSON.stringify(proposal) };
    }

    if (request.role === 'Narrator') {
      if (payload.turnId === this.failNarratorFor && !this.failed) {
        this.failed = true;
        throw new Error('simulated offline narrator failure');
      }
      return {
        text: JSON.stringify({
          turnId: payload.turnId,
          outcomeGrade: payload.outcomeGrade,
          text: `第 ${payload.turnId} 回合叙事：${payload.outcomeGrade}`,
        }),
      };
    }

    throw new Error(`Unexpected role ${request.role}`);
  }
}

function runInput(store, narratives, provider, turnId, random = new ConstantRandom(), stateVersion = null) {
  const expected = stateVersion ?? Number(turnId.split('-').pop()) - 1;
  return {
    provider,
    store,
    journal: store,
    narratives,
    branchId: 'branch-a',
    turnId,
    playerIntent: `玩家意图 ${turnId}`,
    hashProvider,
    random,
    actingCard: makeCard(),
    cards: [makeCard()],
    catalog,
    abilities: new Map(),
    scenes,
    resolveRollSpec() {
      return { attribute: 2, skillRank: 'trained', difficulty: 4 };
    },
    reasoningTier: 'low',
    plannerReasoningReserveTokens: null,
    narratorReasoningReserveTokens: null,
    reasoningPolicyVersion: 'reasoning-policy-1',
    plannerWireOutputTokens: 2048,
    narratorWireOutputTokens: 2048,
    now: (() => {
      let n = 0;
      return () => `2026-09-26T00:00:${String(n++).padStart(2, '0')}.000Z`;
    })(),
    voidExpected: expected,
  };
}

test('M2 scripted Planner/Narrator loop completes 30 committed turns', async () => {
  const db = setupDb();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const store = new SqliteTurnStore(adapter);
    const narratives = new SqliteNarrativeStore(adapter);
    const provider = new ScriptedProvider();

    for (let i = 1; i <= 30; i += 1) {
      const turnId = `turn-${String(i).padStart(3, '0')}`;
      const result = await runV2Turn(runInput(store, narratives, provider, turnId));
      assert.equal(result.stateVersion, i);
      assert.equal(result.narrative.status, 'Committed');
      assert.ok(result.requestCount <= 2);
    }

    const state = await store.getState('branch-a');
    assert.equal(state.stateVersion, 30);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM turns WHERE status='Committed'").get().count, 30);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM turn_narratives WHERE status='Committed'").get().count, 30);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM roll_records').get().count, 10);

    const history = await store.listCommittedTurns('branch-a');
    assert.equal(history.length, 30);
    assert.equal(history[0].turnId, 'turn-001');
    assert.equal(history[0].narrativeStatus, 'Committed');
    assert.ok(history[0].narrativeText.includes('turn-001'));
    assert.equal(history[0].rollRecord, null);
    const rolled = history.find(row => row.turnId === 'turn-003');
    assert.ok(rolled.rollRecord);
    assert.equal(rolled.rollRecord.turnId, 'turn-003');
    assert.ok(rolled.rollRecord.rolls.length >= 1);
  } finally {
    db.close();
  }
});

test('offline narrator failure resumes frozen contract and persisted dice without replanning or rerolling', async () => {
  const db = setupDb();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const firstStore = new SqliteTurnStore(adapter);
    const narratives = new SqliteNarrativeStore(adapter);
    const failing = new ScriptedProvider({ failNarratorFor: 'turn-003' });

    await runV2Turn(runInput(firstStore, narratives, failing, 'turn-001'));
    await runV2Turn(runInput(firstStore, narratives, failing, 'turn-002'));

    await assert.rejects(
      runV2Turn(runInput(firstStore, narratives, failing, 'turn-003')),
      /simulated offline narrator failure/,
    );

    assert.equal(
      db.prepare('SELECT status FROM turns WHERE turn_id=?').get('turn-003').status,
      'Resolved',
    );
    const persistedRoll = db.prepare('SELECT rolls_json FROM roll_records WHERE turn_id=?').get('turn-003');
    assert.ok(persistedRoll);

    const restartedStore = new SqliteTurnStore(adapter);
    const recoveryProvider = new ScriptedProvider();
    const recovered = await runV2Turn(
      runInput(
        restartedStore,
        new SqliteNarrativeStore(adapter),
        recoveryProvider,
        'turn-003',
        new FailIfUsedRandom(),
      ),
    );

    assert.equal(recovered.resumed, true);
    assert.deepEqual(recoveryProvider.calls, ['Narrator']);
    assert.equal(recovered.stateVersion, 3);
    assert.equal(
      db.prepare('SELECT rolls_json FROM roll_records WHERE turn_id=?').get('turn-003').rolls_json,
      persistedRoll.rolls_json,
    );
  } finally {
    db.close();
  }
});

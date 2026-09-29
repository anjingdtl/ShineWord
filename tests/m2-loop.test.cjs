const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { runLlmTurn } = require('../dist/application/game/llmTurn');
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
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_core.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '002_narratives.sql'), 'utf8'));
  db.prepare(
    'INSERT INTO branches (branch_id, campaign_id, state_version, created_at) VALUES (?, ?, ?, ?)',
  ).run('branch-a', 'campaign-a', 0, '2026-09-26T00:00:00.000Z');
  db.prepare(
    `INSERT INTO actor_states
      (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('branch-a', 'actor-player', 0, 'start', JSON.stringify({ stamina: 10 }), '[]');
  db.prepare(
    `INSERT INTO snapshots
      (branch_id, state_version, snapshot_json, state_hash, created_at)
     VALUES (?, ?, ?, NULL, ?)`,
  ).run(
    'branch-a',
    0,
    JSON.stringify({ branchId: 'branch-a', stateVersion: 0, clockMinutes: 0 }),
    '2026-09-26T00:00:00.000Z',
  );
  return db;
}

function contract(turnId, stateVersion, risk) {
  const clause = (summary) => ({ achieved: true, publicSummary: summary, effects: [] });
  return {
    protocolVersion: '1.0',
    turnId,
    expectedStateVersion: stateVersion,
    actorId: 'actor-player',
    actionType: risk ? 'investigate' : 'move',
    targetId: 'scene',
    ...(risk ? { skillId: 'investigation', difficultyBand: 'normal' } : {}),
    evidenceIds: ['fixture-fact'],
    requiresRoll: risk,
    intent: `执行 ${turnId}`,
    timeCostMinutes: 1,
    resourcePreconditions: [],
    outcomes: {
      full_success: clause('充分成功'),
      success: clause('成功'),
      failure: { achieved: false, publicSummary: '失败', effects: [] },
      severe_failure: { achieved: false, publicSummary: '严重失败', effects: [] },
    },
  };
}

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
      return {
        text: JSON.stringify(
          contract(payload.turnId, payload.expectedStateVersion, index % 3 === 0),
        ),
      };
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

function runInput(store, narratives, provider, turnId, random = new ConstantRandom()) {
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
    resolveRollSpec() {
      return { attribute: 2, skillRank: 'trained', difficulty: 4 };
    },
    now: (() => {
      let n = 0;
      return () => `2026-09-26T00:00:${String(n++).padStart(2, '0')}.000Z`;
    })(),
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
      const result = await runLlmTurn(runInput(store, narratives, provider, turnId));
      assert.equal(result.stateVersion, i);
      assert.equal(result.narrative.status, 'Committed');
      assert.ok(result.requestCount <= 2);
    }

    const state = await store.getState('branch-a');
    assert.equal(state.stateVersion, 30);
    assert.equal(state.clockMinutes, 30);
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

    await runLlmTurn(runInput(firstStore, narratives, failing, 'turn-001'));
    await runLlmTurn(runInput(firstStore, narratives, failing, 'turn-002'));

    await assert.rejects(
      runLlmTurn(runInput(firstStore, narratives, failing, 'turn-003')),
      /offline narrator failure/,
    );

    assert.equal(
      db.prepare('SELECT status FROM turns WHERE turn_id=?').get('turn-003').status,
      'Resolved',
    );
    const persistedRoll = db.prepare('SELECT rolls_json FROM roll_records WHERE turn_id=?').get('turn-003');
    assert.ok(persistedRoll);

    const restartedStore = new SqliteTurnStore(adapter);
    const recoveryProvider = new ScriptedProvider();
    const recovered = await runLlmTurn(
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

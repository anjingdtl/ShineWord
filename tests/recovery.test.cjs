const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');

const {
  hashActionContract,
  serializeActionContract,
} = require('../dist/domain');
const { resolveOrReuseRoll } = require('../dist/application/turns/resolveOrReuseRoll');
const { commitResolvedTurn } = require('../dist/application/turns/commitTurn');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');

class NodeSqliteAdapter {
  constructor(db) {
    this.db = db;
  }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) {
      this.db.exec(sql);
      return 0;
    }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryOne(sql, params = []) {
    return this.db.prepare(sql).get(...params) ?? null;
  }
  async queryAll(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }
  async transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await work(this);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

class SequenceRandom {
  constructor(values) {
    this.values = values.slice();
  }
  nextIntInclusive() {
    if (this.values.length === 0) throw new Error('Sequence exhausted');
    return this.values.shift();
  }
}

class FailIfUsedRandom {
  nextIntInclusive() {
    throw new Error('RNG must not be called when a persisted roll exists');
  }
}

const shaProvider = {
  sha256Hex(input) {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  },
};

function contract() {
  const outcome = (achieved, publicSummary, effects = []) => ({
    achieved,
    publicSummary,
    effects,
  });
  return {
    protocolVersion: '2.0',
    turnId: 'turn-recovery-001',
    expectedStateVersion: 1,
    actorId: 'actor-player',
    actionType: 'stealth',
    targetId: 'archive',
    skillId: 'stealth',
    difficultyBand: 'challenging',
    evidenceIds: ['scene-rain'],
    requiresRoll: true,
    intent: '潜入藏书阁',
    timeCostMinutes: 5,
    resourcePreconditions: [],
    outcomes: {
      full_success: outcome(true, '完全成功'),
      success: outcome(true, '成功', [
        { op: 'changeLocation', actorId: 'actor-player', locationId: 'archive' },
      ]),
      failure: outcome(false, '失败'),
      severe_failure: outcome(false, '严重失败'),
    },
  };
}

function setup() {
  const db = new DatabaseSync(':memory:');
  // P8-4: current-protocol schema (all builtin migrations) so every
  // authoritative commit can write its post-processing handoff.
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) db.exec(statement);
  }
  db.prepare(
    'INSERT INTO branches (branch_id, campaign_id, state_version, created_at) VALUES (?, ?, ?, ?)',
  ).run('branch-a', 'campaign-1', 1, '2026-09-26T00:00:00.000Z');
  db.prepare(
    `INSERT INTO actor_states
      (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('branch-a', 'actor-player', 1, 'courtyard', '{}', '[]');
  db.prepare(
    `INSERT INTO snapshots
      (branch_id, state_version, snapshot_json, state_hash, created_at)
     VALUES (?, ?, ?, NULL, ?)`,
  ).run(
    'branch-a',
    1,
    JSON.stringify({ branchId: 'branch-a', stateVersion: 1, clockMinutes: 10 }),
    '2026-09-26T00:00:00.000Z',
  );
  return db;
}

test('a persisted roll survives narrator failure and is reused after restart', async () => {
  const db = setup();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const firstStore = new SqliteTurnStore(adapter);
    const c = contract();
    const contractHash = await hashActionContract(c, shaProvider);
    const actionContractJson = serializeActionContract(c);

    const first = await resolveOrReuseRoll({
      journal: firstStore,
      branchId: 'branch-a',
      turnId: c.turnId,
      expectedStateVersion: c.expectedStateVersion,
      actionContractJson,
      actionContractHash: contractHash,
      spec: {
        attribute: 2,
        skillRank: 'trained',
        situationalDiceModifier: 1,
        difficulty: 6,
      },
      random: new SequenceRandom([2, 5, 7]),
      createdAt: '2026-09-26T00:00:01.000Z',
    });

    assert.equal(first.reused, false);
    assert.deepEqual(first.rollRecord.rolls, [2, 5, 7]);
    assert.equal(
      db.prepare('SELECT status FROM turns WHERE branch_id = ? AND turn_id = ?')
        .get('branch-a', c.turnId).status,
      'Resolved',
    );

    // Simulate Narrator failure / process restart: construct a fresh store against the same DB.
    const restartedStore = new SqliteTurnStore(adapter);
    const recovered = await resolveOrReuseRoll({
      journal: restartedStore,
      branchId: 'branch-a',
      turnId: c.turnId,
      expectedStateVersion: c.expectedStateVersion,
      actionContractJson,
      actionContractHash: contractHash,
      spec: {
        attribute: 2,
        skillRank: 'trained',
        situationalDiceModifier: 1,
        difficulty: 6,
      },
      random: new FailIfUsedRandom(),
      createdAt: '2026-09-26T00:10:00.000Z',
    });

    assert.equal(recovered.reused, true);
    assert.deepEqual(recovered.rollRecord.rolls, [2, 5, 7]);
    assert.equal(recovered.rollRecord.createdAt, '2026-09-26T00:00:01.000Z');

    await commitResolvedTurn({
      store: restartedStore,
      branchId: 'branch-a',
      contract: c,
      contractHash,
      outcomeGrade: recovered.rollRecord.grade,
      rollRecord: recovered.rollRecord,
      committedAt: '2026-09-26T00:10:01.000Z',
    });

    const finalState = await restartedStore.getState('branch-a');
    assert.equal(finalState.stateVersion, 2);
    assert.equal(finalState.clockMinutes, 15);
    assert.equal(finalState.actors['actor-player'].locationId, 'archive');
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM roll_records WHERE turn_id = ?')
        .get(c.turnId).count,
      1,
    );
    assert.equal(
      db.prepare('SELECT status FROM turns WHERE branch_id = ? AND turn_id = ?')
        .get('branch-a', c.turnId).status,
      'Committed',
    );
  } finally {
    db.close();
  }
});

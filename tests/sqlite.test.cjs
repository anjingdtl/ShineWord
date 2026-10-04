const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');

const { hashActionContract, resolveRoll } = require('../dist/domain');
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

const shaProvider = {
  sha256Hex(input) {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  },
};

function actionContract(turnId = 'turn-sqlite-001', expectedStateVersion = 12) {
  const outcome = (achieved, publicSummary, effects = []) => ({ achieved, publicSummary, effects });
  return {
    protocolVersion: '1.0',
    turnId,
    expectedStateVersion,
    actorId: 'actor-player',
    actionType: 'stealth',
    targetId: 'location-archive',
    skillId: 'stealth',
    difficultyBand: 'challenging',
    evidenceIds: ['fact-guard', 'scene-rain'],
    requiresRoll: true,
    intent: '趁雨声潜入藏书阁',
    timeCostMinutes: 5,
    resourcePreconditions: [
      { actorId: 'actor-player', resourceId: 'stamina', minimum: 1 },
    ],
    outcomes: {
      full_success: outcome(true, '充分成功'),
      success: outcome(true, '成功进入藏书阁', [
        { op: 'consumeResource', actorId: 'actor-player', resourceId: 'stamina', amount: 1 },
        { op: 'changeLocation', actorId: 'actor-player', locationId: 'location-archive' },
        { op: 'recordEvent', eventType: 'entered_archive', summary: '玩家潜入藏书阁' },
      ]),
      failure: outcome(false, '被发现'),
      severe_failure: outcome(false, '被包围'),
    },
  };
}

function setupDatabase() {
  const db = new DatabaseSync(':memory:');
  // P8-4: current-protocol schema (all builtin migrations) so every
  // authoritative commit can write its post-processing handoff.
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) db.exec(statement);
  }

  db.prepare(`INSERT INTO branches
    (branch_id, campaign_id, parent_branch_id, fork_turn_id, state_version, created_at)
    VALUES (?, ?, NULL, NULL, ?, ?)`)
    .run('branch-a', 'campaign-1', 12, '2026-09-26T00:00:00.000Z');

  db.prepare(`INSERT INTO actor_states
    (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run('branch-a', 'actor-player', 12, 'location-courtyard', JSON.stringify({ stamina: 5 }), '[]');

  db.prepare(`INSERT INTO actor_states
    (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run('branch-a', 'actor-guard', 12, 'location-archive', JSON.stringify({ stamina: 5 }), '[]');

  db.prepare(`INSERT INTO inventory
    (branch_id, item_id, owner_actor_id, state_version)
    VALUES (?, ?, ?, ?)`)
    .run('branch-a', 'item-key', 'actor-guard', 12);

  db.prepare(`INSERT INTO snapshots
    (branch_id, state_version, snapshot_json, state_hash, created_at)
    VALUES (?, ?, ?, NULL, ?)`)
    .run(
      'branch-a',
      12,
      JSON.stringify({ branchId: 'branch-a', stateVersion: 12, clockMinutes: 100 }),
      '2026-09-26T00:00:00.000Z',
    );

  return db;
}

async function buildResolvedTurn(store, turnId = 'turn-sqlite-001', expectedStateVersion = 12) {
  const contract = actionContract(turnId, expectedStateVersion);
  const contractHash = await hashActionContract(contract, shaProvider);
  const rollRecord = resolveRoll({
    turnId: contract.turnId,
    rollIndex: 0,
    contractHash,
    spec: {
      attribute: 2,
      skillRank: 'trained',
      situationalDiceModifier: 1,
      difficulty: 6,
    },
    random: new SequenceRandom([2, 5, 7]),
    createdAt: '2026-09-26T00:00:00.000Z',
  });
  return { contract, contractHash, rollRecord };
}

test('real SQLite transaction persists turn, roll, events and snapshot atomically', async () => {
  const db = setupDatabase();
  try {
    const store = new SqliteTurnStore(new NodeSqliteAdapter(db));
    const { contract, contractHash, rollRecord } = await buildResolvedTurn(store);

    const result = await commitResolvedTurn({
      store,
      branchId: 'branch-a',
      contract,
      contractHash,
      outcomeGrade: rollRecord.grade,
      rollRecord,
      committedAt: '2026-09-26T00:00:01.000Z',
    });

    assert.equal(result.replayed, false);

    const state = await store.getState('branch-a');
    assert.equal(state.stateVersion, 13);
    assert.equal(state.clockMinutes, 105);
    assert.equal(state.actors['actor-player'].locationId, 'location-archive');
    assert.equal(state.actors['actor-player'].resources.stamina, 4);

    const committed = await store.getCommittedTurn('branch-a', contract.turnId);
    assert.equal(committed.stateVersion, 13);
    assert.equal(committed.rollRecord.highest, 7);
    assert.equal(committed.rollRecord.grade, 'success');

    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM roll_records').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM branch_events').get().count, 3);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM snapshots WHERE state_version = 13').get().count,
      1,
    );

    const persisted = db.prepare(
      'SELECT action_contract_json, action_contract_hash, effects_json FROM turns WHERE branch_id = ? AND turn_id = ?',
    ).get('branch-a', contract.turnId);
    assert.equal(persisted.action_contract_hash, contractHash);
    assert.equal(JSON.parse(persisted.action_contract_json).intent, '趁雨声潜入藏书阁');
    assert.equal(JSON.parse(persisted.effects_json).length, 3);
  } finally {
    db.close();
  }
});

test('SQLite replay is idempotent and does not spend resources twice', async () => {
  const db = setupDatabase();
  try {
    const store = new SqliteTurnStore(new NodeSqliteAdapter(db));
    const { contract, contractHash, rollRecord } = await buildResolvedTurn(store);
    const input = {
      store,
      branchId: 'branch-a',
      contract,
      contractHash,
      outcomeGrade: rollRecord.grade,
      rollRecord,
    };

    await commitResolvedTurn(input);
    const replay = await commitResolvedTurn(input);

    assert.equal(replay.replayed, true);
    const state = await store.getState('branch-a');
    assert.equal(state.stateVersion, 13);
    assert.equal(state.actors['actor-player'].resources.stamina, 4);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM turns').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM roll_records').get().count, 1);
  } finally {
    db.close();
  }
});

test('SQLite transaction rolls back stateVersion and state rows when a late write fails', async () => {
  const db = setupDatabase();
  try {
    db.prepare(`INSERT INTO snapshots
      (branch_id, state_version, snapshot_json, state_hash, created_at)
      VALUES (?, ?, ?, NULL, ?)`)
      .run(
        'branch-a',
        13,
        JSON.stringify({ branchId: 'branch-a', stateVersion: 13, clockMinutes: 999 }),
        '2026-09-26T00:00:00.500Z',
      );

    const store = new SqliteTurnStore(new NodeSqliteAdapter(db));
    const { contract, contractHash, rollRecord } = await buildResolvedTurn(store);

    await assert.rejects(
      commitResolvedTurn({
        store,
        branchId: 'branch-a',
        contract,
        contractHash,
        outcomeGrade: rollRecord.grade,
        rollRecord,
      }),
    );

    const branch = db.prepare(
      'SELECT state_version FROM branches WHERE branch_id = ?',
    ).get('branch-a');
    assert.equal(branch.state_version, 12);

    const actor = db.prepare(
      'SELECT location_id, resources_json FROM actor_states WHERE branch_id = ? AND actor_id = ?',
    ).get('branch-a', 'actor-player');
    assert.equal(actor.location_id, 'location-courtyard');
    assert.equal(JSON.parse(actor.resources_json).stamina, 5);

    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM turns').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM roll_records').get().count, 0);
  } finally {
    db.close();
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');

const { executeDeterministicTurn } = require('../dist/application/turns/executeDeterministicTurn');
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

const hashProvider = {
  sha256Hex(input) {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  },
};

function outcome(achieved, publicSummary, effects = []) {
  return { achieved, publicSummary, effects };
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
  ).run('branch-main', 'campaign-demo', 0, '2026-09-26T00:00:00.000Z');
  db.prepare(
    `INSERT INTO actor_states
      (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    'branch-main',
    'actor-player',
    0,
    'gate',
    JSON.stringify({ stamina: 3 }),
    '[]',
  );
  db.prepare(
    `INSERT INTO snapshots
      (branch_id, state_version, snapshot_json, state_hash, created_at)
     VALUES (?, ?, ?, NULL, ?)`,
  ).run(
    'branch-main',
    0,
    JSON.stringify({ branchId: 'branch-main', stateVersion: 0, clockMinutes: 0 }),
    '2026-09-26T00:00:00.000Z',
  );
  return db;
}

test('fixed world completes three deterministic turns without any LLM', async () => {
  const db = setup();
  try {
    const store = new SqliteTurnStore(new NodeSqliteAdapter(db));

    const sneak = {
      protocolVersion: '3.0',
      turnId: 'turn-001',
      expectedStateVersion: 0,
      actorId: 'actor-player',
      actionType: 'stealth',
      targetId: 'archive',
      skillId: 'stealth',
      difficultyBand: 'challenging',
      evidenceIds: ['scene-rain'],
      requiresRoll: true,
      intent: '借雨声潜入藏书阁',
      timeCostMinutes: 5,
      resourcePreconditions: [
        { actorId: 'actor-player', resourceId: 'stamina', minimum: 1 },
      ],
      outcomes: {
        full_success: outcome(true, '无声潜入'),
        success: outcome(true, '潜入成功', [
          { op: 'consumeResource', actorId: 'actor-player', resourceId: 'stamina', amount: 1 },
          { op: 'changeLocation', actorId: 'actor-player', locationId: 'archive' },
        ]),
        failure: outcome(false, '被看守察觉'),
        severe_failure: outcome(false, '被当场截住'),
      },
    };

    await executeDeterministicTurn({
      store,
      journal: store,
      branchId: 'branch-main',
      contract: sneak,
      hashProvider,
      rollSpec: {
        attribute: 2,
        skillRank: 'trained',
        difficulty: 6,
      },
      random: new SequenceRandom([2, 7]),
      rollCreatedAt: '2026-09-26T00:00:01.000Z',
      committedAt: '2026-09-26T00:00:02.000Z',
    });

    const search = {
      protocolVersion: '3.0',
      turnId: 'turn-002',
      expectedStateVersion: 1,
      actorId: 'actor-player',
      actionType: 'search',
      targetId: 'ledger-shelf',
      skillId: 'investigation',
      difficultyBand: 'challenging',
      evidenceIds: ['archive-ledger-rumor'],
      requiresRoll: true,
      intent: '搜查旧账册',
      timeCostMinutes: 10,
      resourcePreconditions: [],
      outcomes: {
        full_success: outcome(true, '找到关键账册', [
          { op: 'applyCondition', actorId: 'actor-player', conditionId: 'found-ledger' },
          { op: 'recordEvent', eventType: 'clue_found', summary: '取得关键账册线索' },
        ]),
        success: outcome(true, '找到部分线索'),
        failure: outcome(false, '未找到有效线索'),
        severe_failure: outcome(false, '触发暗格机关'),
      },
    };

    await executeDeterministicTurn({
      store,
      journal: store,
      branchId: 'branch-main',
      contract: search,
      hashProvider,
      rollSpec: {
        attribute: 3,
        skillRank: 'expert',
        difficulty: 6,
      },
      random: new SequenceRandom([9, 1, 2]),
      rollCreatedAt: '2026-09-26T00:00:03.000Z',
      committedAt: '2026-09-26T00:00:04.000Z',
    });

    const leave = {
      protocolVersion: '3.0',
      turnId: 'turn-003',
      expectedStateVersion: 2,
      actorId: 'actor-player',
      actionType: 'move',
      targetId: 'courtyard',
      evidenceIds: [],
      requiresRoll: false,
      intent: '离开藏书阁返回院中',
      timeCostMinutes: 2,
      resourcePreconditions: [],
      outcomes: {
        full_success: outcome(true, '快速离开'),
        success: outcome(true, '顺利离开', [
          { op: 'changeLocation', actorId: 'actor-player', locationId: 'courtyard' },
        ]),
        failure: outcome(false, '离开受阻'),
        severe_failure: outcome(false, '退路被封'),
      },
    };

    const third = await executeDeterministicTurn({
      store,
      branchId: 'branch-main',
      contract: leave,
      hashProvider,
      committedAt: '2026-09-26T00:00:05.000Z',
    });

    assert.equal(third.rollRecord, undefined);

    const state = await store.getState('branch-main');
    assert.equal(state.stateVersion, 3);
    assert.equal(state.clockMinutes, 17);
    assert.equal(state.actors['actor-player'].resources.stamina, 2);
    assert.equal(state.actors['actor-player'].locationId, 'courtyard');
    assert.deepEqual(state.actors['actor-player'].conditions, ['found-ledger']);

    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM turns').get().count, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM roll_records').get().count, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM snapshots WHERE state_version > 0').get().count, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM branch_events').get().count, 5);
  } finally {
    db.close();
  }
});

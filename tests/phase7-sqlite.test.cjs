'use strict';
/**
 * P7-1 SQLite evidence: migration 32 creates the situation projection and
 * guidance tables; SqliteTurnStore round-trips situation state through the
 * atomic commit; SqliteGuidanceStore persists and reads decision-bound
 * guidance; rewind/fork clones keep situation history intact.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const { applySqliteMigrations } = require('../dist/infra/sqlite/migrations');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');
const { SqliteGuidanceStore } = require('../dist/infra/sqlite/sqliteGuidanceStore');
const { commitResolvedTurn } = require('../dist/application/turns/commitTurn');
const { GUIDANCE_VERSION, decisionPointIdFor } = require('../dist/application/guidance/types');

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

function openDb() {
  const db = new DatabaseSync(':memory:');
  const adapter = new NodeSqliteAdapter(db);
  return { db, adapter };
}

function seedBranch(adapter) {
  adapter.db.exec(`
    INSERT INTO worlds (world_id,title,source_sha256,source_bytes,normalize_version,chapter_split_version,build_status,created_at,updated_at)
      VALUES ('w1','T','h',10,'n','c','ready','now','now');
    INSERT INTO campaigns (campaign_id,world_id,title,ruleset_id,ruleset_version,world_mapping_version,opening_json,created_at)
      VALUES ('c1','w1','T','shineword-core','0.2.0','m','{}','now');
    INSERT INTO branches (branch_id,campaign_id,state_version,created_at) VALUES ('b1','c1',1,'now');
    INSERT INTO snapshots (branch_id,state_version,snapshot_json,state_hash,created_at)
      VALUES ('b1',1,'${JSON.stringify({
    branchId: 'b1', stateVersion: 1, clockSeconds: 0, clockMinutes: 0,
    actors: { 'actor-player': { actorId: 'actor-player', locationId: 'l1', resources: { hp: 8 }, conditions: [] } },
    itemOwners: {},
  }).replace(/'/g, "''")}',NULL,'now');
  `);
}

function situationEntry(status) {
  return {
    situationId: 'sit-a', status, counters: { heat: 1 }, processedEventKeys: ['tick:2'],
    promises: [{
      promiseId: 'p1', promisorActorId: 'actor-player', description: '带话给柴掌柜',
      status: 'open', createdAtVersion: 2, sourceTurnId: 'turn-0002', idempotencyKey: 'sit-a:p1',
    }],
    suppressedEventKeys: { 'evt-x': { reason: 'precondition_false', atStateVersion: 3, sourceTurnId: 'turn-0003' } },
    sourceTurnId: 'turn-0001', statusVersion: 4,
  };
}

test('migration 32 creates branch_situations and branch_decision_guidance', async () => {
  const { db, adapter } = openDb();
  try {
    const applied = await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
    assert.equal(applied[applied.length - 1], 32);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('branch_situations','branch_decision_guidance')").all()
      .map(row => row.name).sort();
    assert.deepEqual(tables, ['branch_decision_guidance', 'branch_situations']);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('turn store round-trips situation state through the atomic commit', async () => {
  const { db, adapter } = openDb();
  try {
    await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
    seedBranch(adapter);
    const store = new SqliteTurnStore(adapter);
    const contract = {
      protocolVersion: '1.0', turnId: 'turn-0002', expectedStateVersion: 1,
      actorId: 'actor-player', actionType: 'observe', evidenceIds: [], requiresRoll: false,
      intent: '观察废院', timeCostMinutes: 5, resourcePreconditions: [],
      outcomes: {
        full_success: { achieved: true, publicSummary: '看清了废院', effects: [] },
        success: { achieved: true, publicSummary: '看清了废院', effects: [] },
        failure: { achieved: false, publicSummary: '没有发现', effects: [] },
        severe_failure: { achieved: false, publicSummary: '没有发现', effects: [] },
      },
    };
    await commitResolvedTurn({
      store,
      branchId: 'b1',
      contract,
      contractHash: 'hash-1',
      outcomeGrade: 'success',
      contractOrigin: 'engine',
      applyAuthoritativeState: nextState => {
        nextState.situations = [situationEntry('active')];
        nextState.causalWorldTimeOrder = 24;
        return [{ eventType: 'situation_activated', payload: { situationId: 'sit-a' } }];
      },
    });
    const state = await store.getState('b1');
    assert.equal(state.stateVersion, 2);
    assert.equal(state.situations.length, 1);
    assert.equal(state.situations[0].status, 'active');
    assert.equal(state.situations[0].promises[0].promiseId, 'p1');
    assert.ok(state.situations[0].suppressedEventKeys['evt-x']);
    assert.equal(state.causalWorldTimeOrder, 24);
    const row = db.prepare('SELECT situation_json FROM branch_situations WHERE branch_id=? AND situation_id=?').get('b1', 'sit-a');
    assert.ok(JSON.parse(row.situation_json).promises[0].idempotencyKey);
    // Snapshot row also carries situations (fork/rewind source).
    const snapshot = db.prepare('SELECT snapshot_json FROM snapshots WHERE branch_id=? AND state_version=2').get('b1');
    assert.ok(JSON.parse(snapshot.snapshot_json).situations);
  } finally {
    db.close();
  }
});

test('guidance store persists decision-bound guidance and reads the latest', async () => {
  const { db, adapter } = openDb();
  try {
    await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
    seedBranch(adapter);
    const store = new SqliteGuidanceStore(adapter);
    const record = {
      guidanceVersion: GUIDANCE_VERSION,
      decisionPoint: {
        campaignId: 'c1', branchId: 'b1', playerActorId: 'actor-player',
        sourceTurnId: 'turn-0002', decisionPointId: decisionPointIdFor('b1', 2),
        stateVersion: 2, contentBindingHash: 'h1', knowledgeHash: 'h2', contextHash: 'h3',
      },
      severity: 'normal',
      situationSummary: { changes: ['止血成功'], opportunities: ['北向踪迹仍新'], pressures: ['岳轻需要静养'] },
      steps: [{
        source: 'local', candidateRef: 'method:situation-sect-aftermath:pursue',
        title: '追赶夺物者', rationale: '踪迹尚新', tradeoffs: '同伴暂无人照料',
        firstStepIntent: '查看院外向北的脚印', actionKind: 'skill_check', availability: 'available',
      }],
      degraded: false,
    };
    await store.save(record);
    const loaded = await store.get('b1', record.decisionPoint.decisionPointId);
    assert.deepEqual(loaded, record);
    const latest = await store.latestForVersion('b1', 5);
    assert.equal(latest.decisionPoint.stateVersion, 2);
    assert.equal((await store.latestForVersion('b1', 1)), null);
    // Cross-branch isolation.
    assert.equal((await store.get('b2', record.decisionPoint.decisionPointId)), null);
  } finally {
    db.close();
  }
});

test('situation rows are replaced (not accumulated) across commits', async () => {
  const { db, adapter } = openDb();
  try {
    await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
    seedBranch(adapter);
    const store = new SqliteTurnStore(adapter);
    const mkContract = turnId => ({
      protocolVersion: '1.0', turnId, expectedStateVersion: Number(turnId.slice(5)) - 1,
      actorId: 'actor-player', actionType: 'observe', evidenceIds: [], requiresRoll: false,
      intent: '观察', timeCostMinutes: 5, resourcePreconditions: [],
      outcomes: {
        full_success: { achieved: true, publicSummary: 'ok', effects: [] },
        success: { achieved: true, publicSummary: 'ok', effects: [] },
        failure: { achieved: false, publicSummary: 'no', effects: [] },
        severe_failure: { achieved: false, publicSummary: 'no', effects: [] },
      },
    });
    await commitResolvedTurn({
      store, branchId: 'b1', contract: mkContract('turn-0002'), contractHash: 'h2',
      outcomeGrade: 'success', contractOrigin: 'engine',
      applyAuthoritativeState: next => { next.situations = [situationEntry('active')]; return []; },
    });
    await commitResolvedTurn({
      store, branchId: 'b1', contract: mkContract('turn-0003'), contractHash: 'h3',
      outcomeGrade: 'success', contractOrigin: 'engine',
      applyAuthoritativeState: next => {
        next.situations = [{ ...situationEntry('resolved') }];
        return [];
      },
    });
    const rows = db.prepare('SELECT situation_id, status FROM branch_situations WHERE branch_id=?').all('b1');
    assert.equal(rows.length, 1, 'projection mirrors the latest snapshot exactly');
    assert.equal(rows[0].status, 'resolved');
    // Snapshots preserve per-version history (rewind restores active).
    const snap3 = JSON.parse(db.prepare('SELECT snapshot_json FROM snapshots WHERE branch_id=? AND state_version=3').get('b1').snapshot_json);
    const snap2 = JSON.parse(db.prepare('SELECT snapshot_json FROM snapshots WHERE branch_id=? AND state_version=2').get('b1').snapshot_json);
    assert.equal(snap3.situations[0].status, 'resolved');
    assert.equal(snap2.situations[0].status, 'active');
  } finally {
    db.close();
  }
});

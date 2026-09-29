const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');

class NodeSqliteAdapter {
  constructor(db) { this.db = db; this.chain = Promise.resolve(); }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params) ?? []; }
  transaction(work) {
    const run = () => {
      this.db.exec('BEGIN IMMEDIATE');
      return work(this).then(v => { this.db.exec('COMMIT'); return v; }, e => { this.db.exec('ROLLBACK'); throw e; });
    };
    const next = this.chain.then(run, run);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }
}

function setupDb() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) db.exec(statement);
  }
  db.prepare("INSERT INTO worlds (world_id, title, source_sha256, source_bytes, normalize_version, chapter_split_version, build_status, created_at, updated_at) VALUES ('w','t',?,1,'n','c','ready','t','t')").run('a'.repeat(64));
  db.prepare("INSERT INTO campaigns (campaign_id, world_id, title, ruleset_id, ruleset_version, world_mapping_version, opening_json, created_at) VALUES ('c','w','t','r','0','1','{}','t')").run();
  db.prepare("INSERT INTO branches (branch_id, campaign_id, state_version, created_at) VALUES ('b','c',0,'t')").run();
  db.prepare("INSERT INTO actor_states (branch_id, actor_id, state_version, location_id, resources_json, conditions_json) VALUES ('b','a',0,'x','{}','[]')").run();
  db.prepare("INSERT INTO snapshots (branch_id, state_version, snapshot_json, state_hash, created_at) VALUES ('b',0,?,NULL,'t')").run(JSON.stringify({
    branchId: 'b', stateVersion: 0, clockMinutes: 0,
    actors: { a: { actorId: 'a', locationId: 'x', resources: {}, conditions: [] } },
    itemOwners: {},
  }));
  return db;
}

test('discardUnrolledTurn: refuses committed turns and turns with persisted rolls', async () => {
  const db = setupDb();
  const adapter = new NodeSqliteAdapter(db);
  const store = new SqliteTurnStore(adapter);

  // Stage an unrolled turn, then discard: allowed.
  await store.stageRollTurn({ branchId: 'b', turnId: 't1', expectedStateVersion: 0, actionContractJson: '{}', actionContractHash: 'h1', createdAt: 't', status: 'AwaitRoll' });
  assert.equal(await store.discardUnrolledTurn('b', 't1'), true);
  assert.equal(await store.getStagedTurn('b', 't1'), null);

  // Discarding a nonexistent staged turn: false, not an error.
  assert.equal(await store.discardUnrolledTurn('b', 'ghost'), false);

  // A staged turn WITH a persisted roll can never be discarded.
  await store.stageRollTurn({ branchId: 'b', turnId: 't2', expectedStateVersion: 0, actionContractJson: '{}', actionContractHash: 'h2', createdAt: 't', status: 'AwaitRoll' });
  db.prepare("INSERT INTO roll_records (branch_id, turn_id, roll_index, ruleset_id, ruleset_version, contract_hash, dice_count, die_sides, rolls_json, highest, difficulty, margin, grade, created_at) VALUES ('b','t2',0,'r','0','h2',1,6,'[3]',3,3,0,'success','t')").run();
  await assert.rejects(
    () => store.discardUnrolledTurn('b', 't2'),
    /persisted roll/,
  );

  // Committed turns are untouchable.
  db.prepare("INSERT INTO turns (branch_id, turn_id, status, expected_state_version, committed_state_version, action_contract_json, action_contract_hash, outcome_grade, public_summary, effects_json, created_at, committed_at) VALUES ('b','t3','Committed',0,1,'{}','h3','success','s','[]','t','t')").run();
  await assert.rejects(
    () => store.discardUnrolledTurn('b', 't3'),
    /committed/,
  );
});

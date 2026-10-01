'use strict';
/**
 * Project deletion regression suite (task §36 A-O): every dependent row dies
 * with its project, nothing else is touched, shared sources survive while
 * another project references them, running builds block, PRAGMA
 * foreign_key_check stays clean, and re-deleting is a safe no-op.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const {
  deleteProject,
  findBlockingRuns,
  ProjectDeletionBlockedError,
} = require('../dist/application/project/projectDeletion');

class Adapter {
  constructor(db) { this.db = db; this.chain = Promise.resolve(); }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  transaction(work) {
    const run = async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try { const value = await work(this); this.db.exec('COMMIT'); return value; }
      catch (error) { this.db.exec('ROLLBACK'); throw error; }
    };
    const pending = this.chain.then(run, run);
    this.chain = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

function setupDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  return db;
}

const NOW = '2026-10-01T00:00:00.000Z';

function insertWorld(db, worldId, { sourceSha = `sha-${worldId}` } = {}) {
  db.prepare(
    `INSERT INTO worlds (world_id, title, source_sha256, source_bytes, normalize_version,
       chapter_split_version, build_status, created_at, updated_at)
     VALUES (?, ?, ?, 100, 'normalize-1', 'chapter-split-1', 'ready', ?, ?)`,
  ).run(worldId, `title-${worldId}`, sourceSha, NOW, NOW);
}

function insertSource(db, sourceId, rawSha) {
  db.prepare(
    `INSERT INTO imported_sources (source_id, raw_sha256, normalized_tree_hash,
       normalize_tree_hash_version, byte_length, code_point_count, encoding,
       normalize_version, chapter_split_version, normalize_shard_scheme,
       split_strategy, file_name, title, status, created_at, updated_at)
     VALUES (?, ?, 'tree', 'normalize-hash-shard-tree-1', 100, 100, 'utf-8',
       'normalize-1', 'chapter-split-1', 'normalize-shard-1', 'standard',
       'novel.txt', NULL, 'active', ?, ?)`,
  ).run(sourceId, rawSha, NOW, NOW);
}

function insertRun(db, runId, worldId, sourceId, status) {
  db.prepare(
    `INSERT INTO world_build_runs (run_id, world_id, source_id, source_snapshot_hash,
       pipeline_version, plan_version, model_fingerprint, phase, status, units_total,
       units_done, units_failed, lease_owner, lease_expires_at, fencing_token, heartbeat_at,
       last_error_code, last_error_message, created_at, updated_at, config_json,
       plan_state_json, scope_json, pause_requested, cancel_requested)
     VALUES (?, ?, ?, 'snap', 'pipeline-unified-1', 'plan-analysis-1', 'ep#m', 'extracting',
       ?, 1, 0, 0, NULL, NULL, 0, NULL, NULL, NULL, ?, ?, NULL, '{}', NULL, 0, 0)`,
  ).run(runId, worldId, sourceId, status, NOW, NOW);
  db.prepare(
    `INSERT INTO world_build_units (unit_id, run_id, kind, source_ranges_json, input_hash,
       config_fingerprint, parent_unit_id, ord, status, attempt, retry_at, result_ref,
       usage_json, error_code, error_message, created_at, updated_at)
     VALUES (?, ?, 'extract_group', '{"ranges":[]}', 'h', 'cf', NULL, 0, 'completed', 1,
       NULL, NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(`${runId}-u1`, runId, NOW, NOW);
}

function insertCampaignGraph(db, worldId, campaignId, branchId) {
  db.prepare(
    `INSERT INTO campaigns (campaign_id, world_id, title, ruleset_id, ruleset_version,
       world_mapping_version, opening_json, created_at)
     VALUES (?, ?, '战役', 'shineword', '1', 'm-1', '{}', ?)`,
  ).run(campaignId, worldId, NOW);
  db.prepare(
    `INSERT INTO branches (branch_id, campaign_id, parent_branch_id, fork_turn_id, state_version, created_at)
     VALUES (?, ?, NULL, NULL, 1, ?)`,
  ).run(branchId, campaignId, NOW);
  db.prepare(
    `INSERT INTO snapshots (branch_id, state_version, snapshot_json, state_hash, created_at)
     VALUES (?, 1, '{}', 'hash', ?)`,
  ).run(branchId, NOW);
  db.prepare(
    `INSERT INTO turns (branch_id, turn_id, status, expected_state_version,
       action_contract_json, action_contract_hash, created_at)
     VALUES (?, 't1', 'committed', 1, '{}', 'hash', ?)`,
  ).run(branchId, NOW);
  // No-FK branch-scoped rows that the service must clear explicitly.
  db.prepare(`INSERT INTO party_members (branch_id, actor_id, controller, role, joined_at) VALUES (?, 'actor-1', 'player', 'companion', ?)`).run(branchId, NOW);
  db.prepare(`INSERT INTO quest_states (branch_id, quest_id, status, updated_state_version, created_at, updated_at) VALUES (?, 'q1', 'active', 1, ?, ?)`).run(branchId, NOW, NOW);
  db.prepare(`INSERT INTO story_memory_states (branch_id, through_state_version, state_json, state_fingerprint, status, updated_at) VALUES (?, 1, '{}', 'fp', 'current', ?)`).run(branchId, NOW);
  db.prepare(`INSERT INTO story_memory_patches (patch_id, branch_id, from_state_version, to_state_version, base_fingerprint, patch_json, status, created_at) VALUES ('p1', ?, 0, 1, 'fp', '{}', 'applied', ?)`).run(branchId, NOW);
  db.prepare(`INSERT INTO episodic_turn_index (branch_id, turn_id, state_version, search_text, metadata_json) VALUES (?, 't1', 1, 'text', '{}')`).run(branchId);
  db.prepare(`INSERT INTO outbox (branch_id, task_id, kind, payload_json, created_at) VALUES (?, 'task-1', 'kind', '{}', ?)`).run(branchId, NOW);
}

function insertPackage(db, worldId, revision) {
  db.prepare(
    `INSERT INTO world_packages (world_id, revision, source_sha256, ruleset_id,
       ruleset_version, mapping_version, status, content_hash, created_at)
     VALUES (?, ?, 'sha', 'shineword', '1', 'mapper-1', 'published', 'chash', ?)`,
  ).run(worldId, revision, NOW);
  db.prepare(
    `INSERT INTO package_entries (world_id, revision, entry_id, kind, definition_json, provenance_json, visibility, created_at)
     VALUES (?, ?, 'entry-1', 'lore', '{}', '{}', 'public', ?)`,
  ).run(worldId, revision, NOW);
  db.prepare(
    `INSERT INTO book_sections (world_id, revision, book, section_key, title, entry_ids_json, position)
     VALUES (?, ?, 'player_handbook', 'core', '核心', '["entry-1"]', 0)`,
  ).run(worldId, revision);
  db.prepare(
    `INSERT INTO world_package_drafts (world_id, base_revision, draft_json, updated_at)
     VALUES (?, ?, '{}', ?)`,
  ).run(worldId, revision, NOW);
}

async function deleteWorld(adapter, worldId) {
  return deleteProject({ db: adapter, now: () => NOW }, { worldId });
}

test('DEL-A empty world deletes cleanly', async () => {
  const db = setupDb();
  try {
    const adapter = new Adapter(db);
    insertWorld(db, 'w-a');
    const result = await deleteWorld(adapter, 'w-a');
    assert.equal(result.deleted, true);
    assert.equal(result.foreignKeyViolations, 0);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM worlds').get().c, 0);
  } finally { db.close(); }
});

test('DEL-B completed build run deletes with units', async () => {
  const db = setupDb();
  try {
    const adapter = new Adapter(db);
    insertSource(db, 'src-b', 'sha-w-b');
    insertWorld(db, 'w-b');
    insertRun(db, 'run-b', 'w-b', 'src-b', 'completed');
    const result = await deleteWorld(adapter, 'w-b');
    assert.equal(result.deleted, true);
    assert.deepEqual(result.removedSourceIds, ['src-b'], 'last source reference removed');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM world_build_runs').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM world_build_units').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM imported_sources').get().c, 0);
  } finally { db.close(); }
});

test('DEL-C paused and DEL-D stopped builds are deletable', async () => {
  const db = setupDb();
  try {
    const adapter = new Adapter(db);
    insertSource(db, 'src-c', 'sha-w-c');
    insertWorld(db, 'w-c');
    insertRun(db, 'run-c', 'w-c', 'src-c', 'paused_user');
    await deleteWorld(adapter, 'w-c');
    // w-c's deletion removed src-c (last reference); w-d gets its own source.
    insertSource(db, 'src-d', 'sha-w-d');
    insertWorld(db, 'w-d');
    insertRun(db, 'run-d', 'w-d', 'src-d', 'stopped_user');
    await deleteWorld(adapter, 'w-d');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM world_build_runs').get().c, 0);
  } finally { db.close(); }
});

test('DEL-E running build refuses deletion; DEL-F safe stop then delete works', async () => {
  const db = setupDb();
  try {
    const adapter = new Adapter(db);
    insertSource(db, 'src-e', 'sha-w-e');
    insertWorld(db, 'w-e');
    insertRun(db, 'run-e', 'w-e', 'src-e', 'running');
    await assert.rejects(() => deleteWorld(adapter, 'w-e'), ProjectDeletionBlockedError);
    assert.equal((await findBlockingRuns(adapter, 'w-e', NOW)).length, 1);
    // The executor honors the stop request and persists stopped_user.
    db.prepare(`UPDATE world_build_runs SET status = 'stopped_user' WHERE run_id = 'run-e'`).run();
    assert.equal((await findBlockingRuns(adapter, 'w-e', NOW)).length, 0);
    const result = await deleteWorld(adapter, 'w-e');
    assert.equal(result.deleted, true);
    assert.equal(result.foreignKeyViolations, 0);
  } finally { db.close(); }
});

test('DEL-G/H campaign + branch + saves + story memory all removed', async () => {
  const db = setupDb();
  try {
    const adapter = new Adapter(db);
    insertWorld(db, 'w-g');
    insertCampaignGraph(db, 'w-g', 'camp-g', 'branch-g');
    const result = await deleteWorld(adapter, 'w-g');
    assert.equal(result.deleted, true);
    assert.equal(result.foreignKeyViolations, 0, 'foreign_key_check clean');
    for (const table of ['campaigns', 'branches', 'turns', 'snapshots', 'party_members',
      'quest_states', 'story_memory_states', 'story_memory_patches', 'episodic_turn_index', 'outbox']) {
      assert.equal(db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c, 0, `${table} empty`);
    }
  } finally { db.close(); }
});

test('DEL-I world package + entries + sections + draft removed', async () => {
  const db = setupDb();
  try {
    const adapter = new Adapter(db);
    insertWorld(db, 'w-i');
    insertPackage(db, 'w-i', 1);
    await deleteWorld(adapter, 'w-i');
    for (const table of ['world_packages', 'package_entries', 'book_sections', 'world_package_drafts']) {
      assert.equal(db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c, 0, `${table} empty`);
    }
  } finally { db.close(); }
});

test('DEL-J portable-package world (no source) deletes without touching sources', async () => {
  const db = setupDb();
  try {
    const adapter = new Adapter(db);
    insertWorld(db, 'w-j', { sourceSha: '' });
    insertPackage(db, 'w-j', 1);
    insertSource(db, 'src-other', 'sha-other');
    const result = await deleteWorld(adapter, 'w-j');
    assert.deepEqual(result.removedSourceIds, []);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM imported_sources').get().c, 1, 'foreign source untouched');
  } finally { db.close(); }
});

test('DEL-K shared source survives the first deletion; DEL-L last reference cleans it', async () => {
  const db = setupDb();
  try {
    const adapter = new Adapter(db);
    insertSource(db, 'src-shared', 'sha-shared');
    insertWorld(db, 'w-k1', { sourceSha: 'sha-shared' });
    insertWorld(db, 'w-k2', { sourceSha: 'sha-shared' });
    insertRun(db, 'run-k1', 'w-k1', 'src-shared', 'completed');
    insertRun(db, 'run-k2', 'w-k2', 'src-shared', 'completed');
    const first = await deleteWorld(adapter, 'w-k1');
    assert.deepEqual(first.removedSourceIds, [], 'source kept: another project still references it');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM imported_source_segments').get().c, 0);
    const source = db.prepare('SELECT source_id FROM imported_sources WHERE source_id = ?').get('src-shared');
    assert.ok(source, 'shared source still present');
    // Project K2 keeps working: its run row survived.
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM world_build_runs WHERE world_id = 'w-k2'`).get().c, 1);
    const second = await deleteWorld(adapter, 'w-k2');
    assert.deepEqual(second.removedSourceIds, ['src-shared'], 'last reference cleans the source');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM imported_sources').get().c, 0);
  } finally { db.close(); }
});

test('DEL-M every deletion returns foreign_key_check = 0', async () => {
  const db = setupDb();
  try {
    const adapter = new Adapter(db);
    insertWorld(db, 'w-m');
    insertCampaignGraph(db, 'w-m', 'camp-m', 'branch-m');
    insertPackage(db, 'w-m', 2);
    db.prepare(`INSERT INTO review_issues (world_id, issue_id, kind, severity, detail_json, status, created_at)
      VALUES ('w-m', 'issue-1', 'conflict', 'blocking', '{}', 'open', ?)`).run(NOW);
    db.prepare(`INSERT INTO progressive_world_deltas (delta_id, world_id, origin_branch_id,
        published_at_state_version, base_revision, base_content_hash, status, content_hash,
        package_json, validation_json, created_at)
      VALUES ('delta-1', 'w-m', 'branch-m', 1, 1, 'bch', 'published', 'ch', '{}', '{}', ?)`).run(NOW);
    db.prepare(`INSERT INTO world_stage_plans (plan_id, world_id, source_id, source_hash, strategy, stages_json, config_fingerprint, created_at, updated_at)
      VALUES ('plan-m', 'w-m', 'src-none', 'h', 'progressive', '[]', 'cf', ?, ?)`).run(NOW, NOW);
    db.prepare(`INSERT INTO world_stage_states (plan_id, stage_index, status, updated_at)
      VALUES ('plan-m', 0, 'built', ?)`).run(NOW);
    const result = await deleteWorld(adapter, 'w-m');
    assert.equal(result.foreignKeyViolations, 0);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    for (const table of ['review_issues', 'progressive_world_deltas', 'world_stage_plans', 'world_stage_states']) {
      assert.equal(db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c, 0, `${table} empty`);
    }
  } finally { db.close(); }
});

test('DEL-O deleting twice is a safe no-op', async () => {
  const db = setupDb();
  try {
    const adapter = new Adapter(db);
    insertWorld(db, 'w-o');
    await deleteWorld(adapter, 'w-o');
    const again = await deleteWorld(adapter, 'w-o');
    assert.equal(again.deleted, false);
    assert.equal(again.alreadyGone, true);
    assert.equal(again.foreignKeyViolations, 0);
  } finally { db.close(); }
});

test('DEL-legacy source hash fallback cleans a world without runs or plans', async () => {
  const db = setupDb();
  try {
    insertSource(db, 'legacy-src', 'legacy-sha');
    insertWorld(db, 'legacy-world', { sourceSha: 'legacy-sha' });
    const result = await deleteWorld(new Adapter(db), 'legacy-world');
    assert.deepEqual(result.removedSourceIds, ['legacy-src']);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM imported_sources').get().c, 0);
    assert.equal(result.foreignKeyViolations, 0);
  } finally { db.close(); }
});

test('DEL-legacy shared source stays until its final world hash reference disappears', async () => {
  const db = setupDb();
  try {
    insertSource(db, 'legacy-src', 'legacy-sha');
    insertWorld(db, 'legacy-a', { sourceSha: 'legacy-sha' });
    insertWorld(db, 'legacy-b', { sourceSha: 'legacy-sha' });
    const adapter = new Adapter(db);
    assert.deepEqual((await deleteWorld(adapter, 'legacy-a')).removedSourceIds, []);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM imported_sources').get().c, 1);
    assert.deepEqual((await deleteWorld(adapter, 'legacy-b')).removedSourceIds, ['legacy-src']);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM imported_sources').get().c, 0);
  } finally { db.close(); }
});

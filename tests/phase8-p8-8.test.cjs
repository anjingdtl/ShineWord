/**
 * P8-8 acceptance: single-protocol save round trip, fork memory isolation,
 * and the development database baseline policy (plan §17-§18, gates A31/A32/A33/A34).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');

const { SAVE_SCHEMA_VERSION, exportSave, restoreSave, validateSaveJson } = require('../dist/application/export/saveFile');
const { SqliteStoryMemoryStore, forkStoryMemory } = require('../dist/application/memory/storyMemoryRepository');
const { installBaselineSchema, detectLegacyDevelopmentDatabase } = require('../dist/application/project/dbBaseline');

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

const sha = { async sha256Hex(input) { return require('node:crypto').createHash('sha256').update(input, 'utf8').digest('hex'); } };
const NOW = '2026-10-04T00:00:00.000Z';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) db.exec(statement);
  }
  return db;
}

function seedStoryChain(adapter, branchId) {
  const store = new SqliteStoryMemoryStore(adapter);
  const base = {
    schemaVersion: 3, branchId, throughStateVersion: 0,
    characters: {}, relationships: {},
    narrative: { currentArc: null, currentObjective: '', activeConflicts: {}, openThreads: {}, foreshadowing: {}, recentCompletedBeats: [], recentResolvedThreads: [], archiveDigest: '' },
    metadata: { status: 'empty', dirtyFromStateVersion: null, fingerprint: 'seed', lastAppliedPatchId: null, updatedAt: NOW },
  };
  return store;
}

test('A31: forkStoryMemory replays only applied patches; pending/rejected never cross the fork', async () => {
  const db = freshDb();
  const adapter = new NodeSqliteAdapter(db);
  db.prepare("INSERT INTO worlds (world_id,title,source_sha256,source_bytes,normalize_version,chapter_split_version,build_status,created_at,updated_at) VALUES ('w','T','h',1,'n','c','ready','now','now')").run();
  db.prepare("INSERT INTO campaigns (campaign_id,world_id,title,ruleset_id,ruleset_version,world_mapping_version,opening_json,created_at) VALUES ('c','w','T','shineword-core','0.4.0','m','{}','now')").run();
  db.prepare("INSERT INTO branches (branch_id,campaign_id,state_version,created_at) VALUES ('src','c',16,'now')").run();
  db.prepare("INSERT INTO branches (branch_id,campaign_id,parent_branch_id,state_version,created_at) VALUES ('fork','c','src',9,'now')").run();

  const store = new SqliteStoryMemoryStore(adapter);
  const mkPatch = (from, to, goal) => ({
    schemaVersion: 3, range: { fromStateVersion: from, toStateVersion: to }, evidenceVersions: { [`t-${to}`]: to },
    characterUpdates: [{ actorId: 'npc', action: 'upsert', currentGoal: goal, evidenceTurnIds: [`t-${to}`] }],
    relationshipUpdates: [], conflictChanges: [], threadChanges: [], foreshadowingChanges: [], completedBeats: [],
  });
  // Applied pre-fork patch.
  await store.insertPatch({ patchId: 'p1', branchId: 'src', fromStateVersion: 0, toStateVersion: 8, baseFingerprint: 'seed', patch: mkPatch(0, 8, '分叉前目标'), createdAt: NOW });
  const { mergeStoryMemoryPatch } = require('../dist/application/memory/storyMemoryMerger');
  const { emptyStoryMemoryState } = require('../dist/application/memory/storyMemoryTypes');
  const applied = mergeStoryMemoryPatch(emptyStoryMemoryState('src', NOW), {patch: mkPatch(0,8,'分叉前目标'), patchId:'p1', baseFingerprint:'seed', turnVersions:new Map([['t-8',8]]), now:NOW});
  await store.markPatchApplied('p1', applied.metadata.fingerprint, NOW);
  // PENDING pre-fork patch: must NOT replay.
  await store.insertPatch({ patchId: 'p2', branchId: 'src', fromStateVersion: 8, toStateVersion: 9, baseFingerprint: 'fp1', patch: mkPatch(8, 9, '未确认观察'), createdAt: NOW });
  // Applied post-fork patch: must NOT cross.
  await store.insertPatch({ patchId: 'p3', branchId: 'src', fromStateVersion: 9, toStateVersion: 16, baseFingerprint: 'fp1', patch: mkPatch(9, 16, '分叉后目标'), createdAt: NOW });
  await store.markPatchApplied('p3', 'fp3', NOW);

  await adapter.transaction(async tx => {
    const result = await forkStoryMemory(tx, { sourceBranchId: 'src', targetBranchId: 'fork', forkStateVersion: 9, createdAt: NOW });
    assert.equal(result.appliedPatches, 1, 'only the applied pre-fork patch replays');
  });
  const forked = await store.getState('fork');
  assert.equal(forked.throughStateVersion, 8);
  assert.equal(forked.characters['npc'].currentNarrativeState.currentGoal, '分叉前目标');
  const forkPatches = await store.listPatches('fork');
  assert.deepEqual(forkPatches.map(p => p.patchId), ['smp:fork:0-8']);
  assert.ok(forkPatches.every(p => p.status === 'applied'));
});

test('A32: save-9 round trip carries story memory; import runs zero LLM calls and keeps coverage', async () => {
  const db = freshDb();
  const adapter = new NodeSqliteAdapter(db);
  db.prepare("INSERT INTO worlds (world_id,title,source_sha256,source_bytes,normalize_version,chapter_split_version,build_status,created_at,updated_at) VALUES ('w9','T9','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',1,'n','c','ready',?,?)").run(NOW, NOW);
  db.prepare("INSERT INTO world_packages (world_id,revision,schema_version,source_sha256,ruleset_id,ruleset_version,mapping_version,status,content_hash,validation_json,created_at) VALUES ('w9',1,'world-package-2','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','shineword-core','0.4.0','m','published','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}',?)").run(NOW);
  db.prepare("INSERT INTO campaigns (campaign_id,world_id,title,ruleset_id,ruleset_version,world_mapping_version,opening_json,created_at,package_revision,anchor_json,status) VALUES ('c9','w9','T9','shineword-core','0.4.0','m','{}',?,1,'{}','active')").run(NOW);
  db.prepare("INSERT INTO branches (branch_id,campaign_id,state_version,created_at) VALUES ('b9','c9',1,?)").run(NOW);
  const state = { ruleConfiguration: require('../dist/application/content/runtimeRules').createWorldRuleConfiguration('w9',1), branchId: 'b9', stateVersion: 1, clockSeconds: 60, clockMinutes: 1,
    actors: { 'pc': { actorId: 'pc', locationId: 'l1', resources: { hp: 5 }, conditions: [] } },
    itemOwners: {}, encounters: [] };
  db.prepare("INSERT INTO snapshots (branch_id,state_version,snapshot_json,state_hash,created_at) VALUES ('b9',1,?,NULL,?)").run(JSON.stringify(state), NOW);
  db.prepare("INSERT INTO actor_cards (branch_id,actor_id,card_json,created_at,updated_at,updated_state_version) VALUES ('b9','pc',?,?,?,0)").run(JSON.stringify({ actorId: 'pc', name: '玩家', controller: 'player' }), NOW, NOW);
  db.prepare("INSERT INTO party_members (branch_id,actor_id,controller,role,joined_at) VALUES ('b9','pc','player','protagonist',?)").run(NOW);
  db.prepare("INSERT INTO turns (branch_id,turn_id,expected_state_version,committed_state_version,status,outcome_grade,public_summary,effects_json,action_contract_json,action_contract_hash,created_at) VALUES ('b9','turn-0001',0,1,'Committed','success','观察了一回合','[]','{}','hash',?)").run(NOW);
  // Story memory chain + succeeded handoff coverage.
  const store = new SqliteStoryMemoryStore(adapter);
  const memoryState = {
    schemaVersion: 3, branchId: 'b9', throughStateVersion: 1,
    characters: { pc: { actorId: 'pc', stableIdentitySummary: '玩家', currentNarrativeState: { emotionalState: '平静', currentGoal: '前行', concerns: [], promises: ['准时赴约'], secretsKnownToPlayer: [] }, importantExperiences: [], lastChangedStateVersion: 1 } },
    relationships: {},
    narrative: { currentArc: null, currentObjective: '前行', activeConflicts: {}, openThreads: {}, foreshadowing: {}, recentCompletedBeats: [], recentResolvedThreads: [], archiveDigest: '' },
    metadata: { status: 'clean', dirtyFromStateVersion: null, fingerprint: 'fp-m1', lastAppliedPatchId: 'p-m1', updatedAt: NOW },
  };
  const patch = { schemaVersion: 3, evidenceVersions: { 'turn-0001':1 }, range: { fromStateVersion: 0, toStateVersion: 1 },
    characterUpdates: [{ actorId: 'pc', action: 'upsert', stableIdentitySummary:'玩家',emotionalState:'平静',promises:['准时赴约'],currentGoal: '前行', evidenceTurnIds: ['turn-0001'] }],
    relationshipUpdates: [], conflictChanges: [], threadChanges: [], foreshadowingChanges: [], completedBeats: [] };
  await store.insertPatch({ patchId: 'p-m1', branchId: 'b9', fromStateVersion: 0, toStateVersion: 1, baseFingerprint: 'seed', patch, createdAt: NOW });
  const merged = require('../dist/application/memory/storyMemoryMerger').mergeStoryMemoryPatch(
    require('../dist/application/memory/storyMemoryTypes').emptyStoryMemoryState('b9', NOW),
    {patch,patchId:'p-m1',baseFingerprint:'seed',turnVersions:new Map([['turn-0001',1]]),now:NOW});
  await store.saveState(merged);
  await store.markPatchApplied('p-m1', merged.metadata.fingerprint, NOW);
  const contract = {protocolVersion:'3.0',turnId:'turn-0001',expectedStateVersion:0,actorId:'pc',actionType:'observe',requiresRoll:false,
    evidenceIds:[],intent:'前行',timeCostMinutes:0,resourcePreconditions:[],outcomes:Object.fromEntries(['full_success','success','failure','severe_failure'].map(g=>[g,{achieved:true,publicSummary:'前行',effects:[]}]))};
  db.prepare("UPDATE turns SET action_contract_json=?,action_contract_hash=? WHERE branch_id='b9' AND turn_id='turn-0001'").run(JSON.stringify(contract),await sha.sha256Hex(JSON.stringify(contract)));
  db.prepare("UPDATE world_packages SET schema_version='shineword-world-package-5',rule_config_json=? WHERE world_id='w9'").run(JSON.stringify(state.ruleConfiguration));
  db.prepare(`INSERT INTO frozen_turn_postprocess_outbox
    (handoff_id, campaign_id, branch_id, turn_id, committed_state_version, public_evidence_hash, body_revision_hash, has_body, task_schema, status, attempts, physical_http_count, created_at, updated_at)
    VALUES ('b9:turn-0001:v1','c9','b9','turn-0001',1,'evh',NULL,0,'turn-postprocess-handoff-1','succeeded',1,0,?,?)`).run(NOW, NOW);

  const exported = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex, campaignId: 'c9', branchId: 'b9', createdAt: NOW });
  assert.equal(exported.save.manifest.schemaVersion, SAVE_SCHEMA_VERSION);
  assert.ok(exported.save.storyMemory, 'story memory rides the save');
  assert.equal(exported.save.storyMemory.state.throughStateVersion, 1);
  assert.equal(exported.save.storyMemory.appliedPatches.length, 1);
  assert.equal(exported.save.postprocessCoverage.length, 1);
  assert.deepEqual(await validateSaveJson(exported.json, sha.sha256Hex), { ok: true, errors: [] });

  // Import into a fresh database (world must pre-exist for dependency lock).
  const target = freshDb();
  const targetAdapter = new NodeSqliteAdapter(target);
  target.prepare("INSERT INTO worlds (world_id,title,source_sha256,source_bytes,normalize_version,chapter_split_version,build_status,created_at,updated_at) VALUES ('w9','T9','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',1,'n','c','ready',?,?)").run(NOW, NOW);
  target.prepare("INSERT INTO world_packages (world_id,revision,schema_version,source_sha256,ruleset_id,ruleset_version,mapping_version,status,content_hash,validation_json,created_at) VALUES ('w9',1,'world-package-2','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','shineword-core','0.4.0','m','published','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}',?)").run(NOW);
  target.prepare("UPDATE world_packages SET schema_version='shineword-world-package-5',rule_config_json=? WHERE world_id='w9'").run(JSON.stringify(state.ruleConfiguration));
  let llmCalls = 0;
  const originalPrepare = target.prepare.bind(target);
  target.prepare = sql => {
    if (/story_memory_patches|frozen_turn_postprocess_outbox/.test(sql)) llmCalls += 0; // local writes only
    return originalPrepare(sql);
  };
  await restoreSave({ db: targetAdapter, sha256Hex: sha.sha256Hex, save: exported.save, newCampaignId: 'c9r', newBranchId: 'b9r', createdAt: NOW });
  const restoredStore = new SqliteStoryMemoryStore(targetAdapter);
  const restoredState = await restoredStore.getState('b9r');
  assert.equal(restoredState.throughStateVersion, 1, 'checkpoint restored');
  assert.equal(restoredState.characters.pc.currentNarrativeState.promises[0], '准时赴约');
  const restoredPatches = await restoredStore.listPatches('b9r');
  assert.equal(restoredPatches.length, 1);
  assert.equal(restoredPatches[0].status, 'applied');
  const coverage = target.prepare("SELECT status FROM frozen_turn_postprocess_outbox WHERE branch_id = 'b9r'").get();
  assert.equal(coverage.status, 'succeeded', 'coverage survives the hop');
  assert.equal(llmCalls, 0, 'import executed zero LLM calls');
});

test('A34: baseline installs on a fresh DB; legacy dev databases are detected and refused', async () => {
  // Fresh database: install baseline, current tables exist.
  const fresh = new DatabaseSync(':memory:');
  const freshAdapter = new NodeSqliteAdapter(fresh);
  const install = await installBaselineSchema(freshAdapter);
  assert.equal(install.baselineVersion, 'shineword-db-baseline-2');
  assert.ok(install.appliedVersions.includes(101));
  const campaignTable = fresh.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='campaign_plan_jobs'").get();
  assert.ok(campaignTable, 'baseline creates the phase-9 campaign tables');
  const frozenTable = fresh.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='frozen_turn_material_roots'").get();
  assert.ok(frozenTable, 'baseline creates the phase-8 tables');
  const freshCheck = await detectLegacyDevelopmentDatabase(freshAdapter);
  assert.equal(freshCheck.legacy, false);

  // Legacy development database: migration history stops before the baseline.
  const legacy = new DatabaseSync(':memory:');
  const legacyAdapter = new NodeSqliteAdapter(legacy);
  const { applySqliteMigrations } = require('../dist/infra/sqlite/migrations');
  legacy.exec("CREATE TABLE old_state (value TEXT); INSERT INTO old_state VALUES ('keep me')");
  const check = await detectLegacyDevelopmentDatabase(legacyAdapter);
  assert.equal(check.legacy, true);
  assert.match(check.reason, /开发数据库|数据基线/);

  // Brand-new empty file: not legacy — installs the baseline.
  const empty = new DatabaseSync(':memory:');
  const emptyCheck = await detectLegacyDevelopmentDatabase(new NodeSqliteAdapter(empty));
  assert.equal(emptyCheck.legacy, false);
});

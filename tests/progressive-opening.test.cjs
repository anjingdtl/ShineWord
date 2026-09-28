'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { applySqliteMigrations } = require('../dist/infra/sqlite/migrations');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { extractOpeningDossier, compileProgressiveOpeningPackage } = require('../dist/application/worldPackage/progressiveOpening');
const { createCampaign } = require('../dist/application/campaign/createCampaign');
const { encodeWorldPackageArchive, decodeWorldPackageArchive, importPortableWorldPackage } = require('../dist/application/export/worldPackageArchive');

const sha = { sha256Hex: value => createHash('sha256').update(value, 'utf8').digest('hex') };

class NodeSqliteAdapter {
  constructor(db) { this.db = db; this.chain = Promise.resolve(); }
  async execute(sql, params = []) { this.db.prepare(sql).run(...params); }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  transaction(work) {
    const run = () => {
      this.db.exec('BEGIN IMMEDIATE');
      return work(this).then(value => { this.db.exec('COMMIT'); return value; }, error => {
        this.db.exec('ROLLBACK'); throw error;
      });
    };
    const next = this.chain.then(run, run);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }
}

function dbWithSchema() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const sql of migration.sql.split(';').map(part => part.trim()).filter(Boolean)) db.exec(sql);
  }
  return db;
}

function dossierJson(overrides = {}) {
  return JSON.stringify({
    locationName: '青石巷',
    locationQuote: '青石巷口的灯还亮着。',
    setting: '夜色降临，巷口灯光仍在。',
    settingQuote: '青石巷口的灯还亮着。',
    situation: '巷口的灯仍亮着，附近有人经过。',
    situationQuote: '巷口传来一阵急促脚步声。',
    initialGoal: '确认脚步声从何处传来。',
    goalQuote: '她循声望去。',
    unknowns: ['来人身份尚未明确'],
    ...overrides,
  });
}

test('opening dossier accepts one bounded cited response and limits repair to one extra call', async () => {
  const source = '青石巷口的灯还亮着。巷口传来一阵急促脚步声。她循声望去。' + '后文秘密：角色其实是失踪的皇子。';
  let calls = 0;
  const result = await extractOpeningDossier({
    sourceExcerpt: source,
    provider: { complete: async request => {
      calls += 1;
      assert.equal(request.maxOutputTokens, 8000);
      assert.equal(request.vendorOptions, undefined, 'the opening path does not disable reasoning');
      return { text: dossierJson(), usage: { inputTokens: 200, outputTokens: 150, reasoningTokens: 30, estimated: false },
        requestMetrics: [{ attempt: 1, durationMs: 90, httpStatus: 200, outcome: 'completed' }] };
    } },
  });
  assert.equal(calls, 1);
  assert.equal(result.physicalRequests, 1);
  assert.equal(result.repairUsed, false);
  assert.equal(result.dossier.locationName, '青石巷');
  assert.ok(!JSON.stringify(result.dossier).includes('失踪的皇子'));

  let repairCalls = 0;
  const repaired = await extractOpeningDossier({
    sourceExcerpt: source,
    provider: { complete: async () => {
      repairCalls += 1;
      return { text: repairCalls === 1
        ? dossierJson({ locationQuote: '这条引文不在原文里。' })
        : dossierJson() };
    } },
  });
  assert.equal(repairCalls, 2);
  assert.equal(repaired.physicalRequests, 2);
  assert.equal(repaired.repairUsed, true);
});

test('opening evidence after the first-scene budget cannot be compiled or leaked in error text', async () => {
  const source = '开头地点灯火通明。' + '甲'.repeat(1_700) + '后段秘密人物登场。';
  const quote = '后段秘密人物登场。';
  let calls = 0;
  await assert.rejects(() => extractOpeningDossier({
    sourceExcerpt: source,
    provider: { complete: async () => {
      calls += 1;
      return { text: dossierJson({
        locationName: '秘密人物', locationQuote: quote,
        settingQuote: quote, situationQuote: quote, goalQuote: quote,
      }) };
    } },
  }), error => {
    assert.equal(error.category, 'invalid_dossier');
    assert.ok(!error.message.includes('秘密人物'));
    return true;
  });
  assert.equal(calls, 2, 'one normal request plus exactly one repair attempt');
});

test('migration 14 upgrades an existing v2 package without changing its manifest semantics', async () => {
  const db = new DatabaseSync(':memory:');
  const adapter = new NodeSqliteAdapter(db);
  try {
    await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS.slice(0, 13), () => 'before');
    const worldStore = new SqliteWorldStore(adapter);
    await worldStore.createWorld({ worldId: 'w-legacy-package', title: '旧包', sourceSha256: 'a'.repeat(64),
      sourceBytes: 1, normalizeVersion: 'old', chapterSplitVersion: 'old', buildStatus: 'ready',
      createdAt: 'before', updatedAt: 'before' });
    db.prepare(`INSERT INTO world_packages
      (world_id, revision, schema_version, source_sha256, ruleset_id, ruleset_version,
       mapping_version, status, content_hash, validation_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('w-legacy-package', 1, 'world-package-2', 'a'.repeat(64), 'shineword-core', '0.2.0',
        'legacy', 'published', 'b'.repeat(64), '{}', 'before');
    await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS.slice(13), () => 'after');
    const pkg = await worldStore.getWorldPackage('w-legacy-package', 1);
    assert.equal(pkg.manifest.schemaVersion, 'world-package-2');
    assert.equal(pkg.manifest.buildScope, undefined);
    assert.equal(pkg.manifest.contentHash, 'b'.repeat(64));
  } finally {
    db.close();
  }
});

test('progressive opening compiles, publishes with a hashed partial scope, creates a character and survives archive import', async () => {
  const db = dbWithSchema();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  const text = '青石巷口的灯还亮着。巷口传来一阵急促脚步声。她循声望去。';
  const chapter = { worldId: 'w-progressive', chapterId: 'chapter-opening', index: 0,
    title: '开篇', startOffset: 0, endOffset: Array.from(text).length,
    charCount: Array.from(text).length, contentHash: sha.sha256Hex(text) };
  await worldStore.createWorld({ worldId: 'w-progressive', title: '渐进开局测试', sourceSha256: 'a'.repeat(64),
    sourceBytes: 100, normalizeVersion: 'normalize-1', chapterSplitVersion: 'chapter-split-1',
    buildStatus: 'extracting', createdAt: 'now', updatedAt: 'now' });
  await worldStore.saveImportedSource('w-progressive', {
    encoding: 'utf-8', sourceSha256Hex: 'a'.repeat(64), sourceByteLength: 100,
    normalizeVersion: 'normalize-1', chapterSplitVersion: 'chapter-split-1', splitStrategy: 'standard',
    text: '', codePointCount: Array.from(text).length, chapters: [chapter], chunks: [],
  }, 'now');
  const dossier = JSON.parse(dossierJson());
  const published = await compileProgressiveOpeningPackage({
    worldStore, sha256Hex: sha.sha256Hex, worldId: 'w-progressive', sourceSha256: 'a'.repeat(64),
    sourceExcerpt: text, sourceEndCodePoint: Array.from(text).length, chapters: [chapter], dossier,
    requestMetrics: [{ attempt: 1, durationMs: 120, httpStatus: 200, outcome: 'completed' }],
    usage: { inputTokens: 200, outputTokens: 150, reasoningTokens: 30, estimated: false },
    extractionMs: 130, createdAt: 'now',
  });
  assert.equal(published.manifest.schemaVersion, 'world-package-3');
  assert.equal(published.manifest.status, 'published');
  assert.equal(published.manifest.buildScope.strategy, 'progressive');
  assert.equal(published.manifest.buildScope.scope, 'opening');
  assert.equal(published.manifest.buildScope.completeness, 'partial');
  assert.equal(published.manifest.buildScope.sourceRanges[0].contentSha256, sha.sha256Hex(text));
  assert.ok(published.entries.some(item => item.entryId === 'scene-progressive-opening'));
  assert.equal(published.sections.some(section => section.book === 'player_handbook'), true);
  assert.equal(published.sections.some(section => section.book === 'gm_guide'), true);
  assert.equal(published.sections.some(section => section.book === 'monster_manual'), true);

  const pkg = await worldStore.getWorldPackage('w-progressive', published.manifest.revision);
  assert.equal(pkg.manifest.buildScope.completeness, 'partial');
  assert.equal(pkg.manifest.contentHash, published.manifest.contentHash);
  const campaign = await createCampaign({
    db: adapter, worldStore, campaignId: 'camp-progressive', title: '开局测试', worldId: 'w-progressive',
    packageRevision: published.manifest.revision,
    anchor: { worldTimeOrder: 1, locationId: 'opening-location' },
    protagonist: { actorId: 'actor-player', kind: 'original', name: '旅人',
      attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 },
      initialSkills: ['skill-observation'] },
    goal: '确认巷口脚步声的来源', createdAt: 'now',
  });
  assert.equal(campaign.snapshot.stateVersion, 0);
  assert.equal(campaign.snapshot.actors['actor-player'].locationId, 'opening-location');

  const archive = await encodeWorldPackageArchive({ title: '渐进开局测试', ...pkg }, sha.sha256Hex);
  const decoded = await decodeWorldPackageArchive(archive, sha.sha256Hex);
  assert.equal(decoded.manifest.buildScope.completeness, 'partial');
  const importedDb = dbWithSchema();
  const importedStore = new SqliteWorldStore(new NodeSqliteAdapter(importedDb));
  await importPortableWorldPackage({ worldStore: importedStore, sha256Hex: sha.sha256Hex,
    archive, newWorldId: 'w-progressive-copy', createdAt: 'later' });
  const importedPackage = await importedStore.getWorldPackage('w-progressive-copy', 1);
  assert.equal(importedPackage.manifest.buildScope.sourceRanges[0].endCodePoint, Array.from(text).length);
  importedDb.close();
  db.close();
});

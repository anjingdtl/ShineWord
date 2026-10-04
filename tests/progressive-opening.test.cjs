'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { applySqliteMigrations } = require('../dist/infra/sqlite/migrations');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');
const { LedgeredProvider } = require('../dist/application/llm/requestLedger');
const { extractOpeningDossier, compileProgressiveOpeningPackage } = require('../dist/application/worldPackage/progressiveOpening');
const { openingSourceBudgetForProfile } = require('../dist/application/worldPackage/progressiveOpening');
const { createCampaign } = require('../dist/application/campaign/createCampaign');
const { encodeWorldPackageArchive, decodeWorldPackageArchive, importPortableWorldPackage } = require('../dist/application/export/worldPackageArchive');

const sha = { sha256Hex: value => createHash('sha256').update(value, 'utf8').digest('hex') };

class NodeSqliteAdapter {
  constructor(db) { this.db = db; this.chain = Promise.resolve(); }
  async execute(sql, params = []) { return this.db.prepare(sql).run(...params).changes; }
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

function openingProfile(reasoningTier = 'low', contextWindow = 65_536, maxOutputTokens = 65_536) {
  return {
    id: 'glm-test', name: 'GLM test', endpoint: 'https://example.invalid/v4', model: 'GLM-5.3-Flash', keyRef: 'test',
    capabilities: { contextWindow, maxOutputTokens, supportsJson: true, reportsUsage: true },
    reasoningTier, reasoningDialect: 'glm', contentOutputTokens: 16_384,
  };
}

function openingLedgerIdentity(worldId) {
  return { worldId, logicalRequestId: `world-opening-dossier:${worldId}:source-sha` };
}

function openingBudget(sourceCodePoints, tier = 'low') {
  return openingSourceBudgetForProfile(openingProfile(tier), sourceCodePoints);
}

test('opening dossier accepts one bounded cited response and limits repair to one extra call', async () => {
  const source = '青石巷口的灯还亮着。巷口传来一阵急促脚步声。她循声望去。' + '后文秘密：角色其实是失踪的皇子。';
  const budget = openingBudget(Array.from(source).length);
  const ledger = openingLedgerIdentity('w-opening-request');
  let calls = 0;
  const result = await extractOpeningDossier({
    sourceExcerpt: source,
    budget,
    ledger,
    provider: { complete: async request => {
      calls += 1;
      assert.equal(request.maxOutputTokens, budget.maxOutputTokens);
      assert.equal(request.reasoningTier, 'low');
      assert.equal(request.reasoningReserveTokens, budget.reasoningReserveTokens);
      assert.equal(request.requestKind, 'world_extract');
      assert.deepEqual(request.ledger, { ...ledger, requestKind: 'world_extract' });
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
    budget,
    ledger: openingLedgerIdentity('w-opening-repair'),
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

test('progressive opening freezes Low/High/Max through the shared budget kernel and shrinks Max source input', async () => {
  const sourceCodePoints = 8_000;
  const low = openingBudget(sourceCodePoints, 'low');
  const high = openingBudget(sourceCodePoints, 'high');
  const max = openingBudget(sourceCodePoints, 'max');

  assert.ok(low.reasoningReserveTokens < high.reasoningReserveTokens);
  assert.ok(high.reasoningReserveTokens < max.reasoningReserveTokens);
  assert.ok(low.maxOutputTokens < high.maxOutputTokens);
  assert.ok(high.maxOutputTokens < max.maxOutputTokens);
  assert.equal(low.sourceCodePoints, sourceCodePoints);
  assert.ok(max.sourceCodePoints >= 1_600, 'the first-scene evidence range remains available');
  assert.ok(max.sourceCodePoints < high.sourceCodePoints);
  assert.equal(max.maxOutputTokens, max.businessOutputTokens + max.reasoningReserveTokens);

  for (const budget of [low, high, max]) {
    const seen = [];
    const excerpt = '青石巷口的灯还亮着。巷口传来一阵急促脚步声。她循声望去。';
    await extractOpeningDossier({
      sourceExcerpt: excerpt,
      budget,
      ledger: openingLedgerIdentity(`w-${budget.reasoningTier}`),
      provider: { complete: async request => {
        seen.push(request);
        return { text: dossierJson() };
      } },
    });
    assert.equal(seen[0].reasoningTier, budget.reasoningTier);
    assert.equal(seen[0].reasoningReserveTokens, budget.reasoningReserveTokens);
    assert.equal(seen[0].maxOutputTokens, budget.maxOutputTokens);
  }
});

test('opening JSON/evidence repair is a second ledgered physical attempt under the same logical request', async () => {
  const source = '青石巷口的灯还亮着。巷口传来一阵急促脚步声。她循声望去。';
  const budget = openingBudget(Array.from(source).length, 'high');
  const identity = openingLedgerIdentity('w-opening-ledger');
  const db = dbWithSchema();
  const adapter = new NodeSqliteAdapter(db);
  const ledger = new SqliteLlmLedgerStore(adapter);
  let providerCalls = 0;
  try {
    const provider = new LedgeredProvider({ complete: async () => {
      providerCalls += 1;
      return { text: providerCalls === 1
        ? dossierJson({ locationQuote: '这条引文不在原文里。' })
        : dossierJson() };
    } }, ledger, { modelProfileFingerprint: 'redacted-profile-fingerprint' });
    const result = await extractOpeningDossier({ sourceExcerpt: source, budget, ledger: identity, provider });
    const attempts = await ledger.listAttempts(identity.logicalRequestId);
    assert.equal(result.repairUsed, true);
    assert.equal(providerCalls, 2);
    assert.deepEqual(attempts.map(attempt => attempt.attemptNo), [1, 2]);
    assert.ok(attempts.every(attempt => attempt.status === 'succeeded'));
    assert.ok(attempts.every(attempt => attempt.requestKind === 'world_extract'));
    assert.ok(attempts.every(attempt => attempt.reasoningTier === 'high'));
    assert.ok(attempts.every(attempt => attempt.reasoningReserveTokens === budget.reasoningReserveTokens));
    assert.ok(attempts.every(attempt => attempt.wireOutputTokens === budget.maxOutputTokens));
  } finally {
    db.close();
  }
});

test('opening evidence after the first-scene budget cannot be compiled or leaked in error text', async () => {
  const source = '开头地点灯火通明。' + '甲'.repeat(1_700) + '后段秘密人物登场。';
  const quote = '后段秘密人物登场。';
  let calls = 0;
  await assert.rejects(() => extractOpeningDossier({
    sourceExcerpt: source,
    budget: openingBudget(Array.from(source).length),
    ledger: openingLedgerIdentity('w-opening-late-evidence'),
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

test('opening preparation failures expose a desensitized stage code for each failing gate', async () => {
  const source = '青石巷口的灯还亮着。巷口传来一阵急促脚步声。她循声望去。';
  const answer = (text) => ({ complete: async () => ({ text }) });

  await assert.rejects(
    () => extractOpeningDossier({ sourceExcerpt: source, budget: openingBudget(Array.from(source).length), ledger: openingLedgerIdentity('w-opening-json'), provider: answer('这不是 JSON') }),
    error => error.errorCode === 'invalid_dossier:json_parse',
  );

  await assert.rejects(
    () => extractOpeningDossier({ sourceExcerpt: source, budget: openingBudget(Array.from(source).length), ledger: openingLedgerIdentity('w-opening-schema'), provider: answer(dossierJson({ initialGoal: '' })) }),
    error => error.errorCode === 'invalid_dossier:schema',
  );

  await assert.rejects(
    () => extractOpeningDossier({
      sourceExcerpt: source,
      budget: openingBudget(Array.from(source).length),
      ledger: openingLedgerIdentity('w-opening-citation'),
      provider: answer(dossierJson({ locationQuote: '这条引文并不在原文里。' })),
    }),
    error => error.errorCode === 'invalid_dossier:citation',
  );

  // A quote that is present in the opening scene but not covered by any known
  // chapter must be attributed to reference closure, not mistaken for publish.
  const text = '青石巷口的灯还亮着。巷口传来一阵急促脚步声。她循声望去。';
  const chapter = { worldId: 'w-ref', chapterId: 'chapter-opening', index: 0, title: '开篇',
    startOffset: 0, endOffset: Array.from(text).length, charCount: Array.from(text).length,
    contentHash: sha.sha256Hex(text) };
  const db = dbWithSchema();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  try {
    await worldStore.createWorld({ worldId: 'w-ref', title: '引文闭包测试', sourceSha256: 'a'.repeat(64),
      sourceBytes: 100, normalizeVersion: 'normalize-1', chapterSplitVersion: 'chapter-split-1',
      buildStatus: 'extracting', createdAt: 'now', updatedAt: 'now' });
    await assert.rejects(
      () => compileProgressiveOpeningPackage({
        worldStore, sha256Hex: sha.sha256Hex, worldId: 'w-ref', sourceSha256: 'a'.repeat(64),
        sourceExcerpt: text, sourceEndCodePoint: Array.from(text).length,
        chapters: [{ ...chapter, startOffset: 999, endOffset: 1000 }],
        dossier: JSON.parse(dossierJson()),
        requestMetrics: [], usage: null, extractionMs: 1, createdAt: 'now',
      }),
      error => error.errorCode === 'invalid_dossier:reference_closure',
    );
  } finally {
    db.close();
  }
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
  assert.equal(published.manifest.schemaVersion, 'world-package-4'); // P7: opening situation promotes the schema
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

test('anchor-less world setup still exposes the compiled opening location and lore (r7 D3)', async () => {
  // Device regression (2026-09-29 r7): a world without canon anchor events asks
  // for its setup with NO worldTimeOrder; opening facts written with
  // revealAt:'1' were hidden to that query, emptying `locations` and
  // dead-ending the opening wizard on a published package.
  const db = dbWithSchema();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  const text = '青石巷口的灯还亮着。巷口传来一阵急促脚步声。她循声望去。';
  const chapter = { worldId: 'w-anchorless', chapterId: 'chapter-opening', index: 0,
    title: '开篇', startOffset: 0, endOffset: Array.from(text).length,
    charCount: Array.from(text).length, contentHash: sha.sha256Hex(text) };
  await worldStore.createWorld({ worldId: 'w-anchorless', title: '无锚点开局', sourceSha256: 'b'.repeat(64),
    sourceBytes: 100, normalizeVersion: 'normalize-1', chapterSplitVersion: 'chapter-split-1',
    buildStatus: 'extracting', createdAt: 'now', updatedAt: 'now' });
  await worldStore.saveImportedSource('w-anchorless', {
    encoding: 'utf-8', sourceSha256Hex: 'b'.repeat(64), sourceByteLength: 100,
    normalizeVersion: 'normalize-1', chapterSplitVersion: 'chapter-split-1', splitStrategy: 'standard',
    text: '', codePointCount: Array.from(text).length, chapters: [chapter], chunks: [],
  }, 'now');
  const published = await compileProgressiveOpeningPackage({
    worldStore, sha256Hex: sha.sha256Hex, worldId: 'w-anchorless', sourceSha256: 'b'.repeat(64),
    sourceExcerpt: text, sourceEndCodePoint: Array.from(text).length, chapters: [chapter],
    dossier: JSON.parse(dossierJson()),
    requestMetrics: [{ attempt: 1, durationMs: 100, httpStatus: 200, outcome: 'completed' }],
    usage: null, extractionMs: 90, createdAt: 'now',
  });
  assert.ok(published.manifest.revision >= 1);

  const { CampaignSession } = require('../dist/application/campaign/session');
  const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');
  const { SqliteGameStore } = require('../dist/infra/sqlite/sqliteGameStore');
  const { SqliteNarrativeStore } = require('../dist/infra/sqlite/sqliteNarrativeStore');
  const session = new CampaignSession({
    db: adapter,
    turns: new SqliteTurnStore(adapter),
    game: new SqliteGameStore(adapter),
    worldStore,
    narratives: new SqliteNarrativeStore(adapter),
    hashProvider: sha,
    random: () => 0.5,
  }, { complete: async () => ({ text: '', requestMetrics: [] }) },
  { endpoint: 'https://x', model: 'test-model', keyRef: 'kr' });

  const setup = await session.getWorldSetup('w-anchorless');
  assert.equal(setup.packageRevision, published.manifest.revision);
  assert.ok(setup.locations.length > 0, `locations must not be empty for an anchor-less world, got ${JSON.stringify(setup.locations)}`);
  assert.ok(setup.locations.includes('opening-location'));
  assert.ok(setup.lore.some(item => item.name === '开局资料'));

  // Model an already-imported package produced before the D3 fix. The opening
  // facts remain immutable on disk; read projection and campaign creation
  // must recover the playable opening without deleting or re-importing it.
  db.prepare("UPDATE canon_facts SET reveal_at = '1' WHERE world_id = ? AND fact_id IN (?, ?, ?, ?)").run(
    'w-anchorless',
    'fact-w-anchorless-opening-location',
    'fact-w-anchorless-opening-setting',
    'fact-w-anchorless-opening-situation',
    'fact-w-anchorless-opening-goal',
  );
  const legacySetup = await session.getWorldSetup('w-anchorless');
  assert.ok(legacySetup.locations.includes('opening-location'));
  assert.ok(legacySetup.lore.some(item => item.name === '开局资料'));
  assert.equal(db.prepare("SELECT reveal_at FROM canon_facts WHERE world_id = ? AND fact_id = ?").get(
    'w-anchorless', 'fact-w-anchorless-opening-location',
  ).reveal_at, '1', 'compatibility must not rewrite immutable legacy facts');

  const legacyCampaign = await createCampaign({
    db: adapter, worldStore, campaignId: 'camp-legacy-opening', title: '旧格式开局',
    worldId: 'w-anchorless', packageRevision: published.manifest.revision,
    anchor: { worldTimeOrder: 0, locationId: 'opening-location' },
    protagonist: { actorId: 'actor-legacy', kind: 'original', name: '旅人',
      attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 },
      initialSkills: ['skill-observation'] },
    goal: '寻找巷口脚步声的来源',
    createdAt: 'later',
  });
  assert.equal(legacyCampaign.snapshot.actors['actor-legacy'].locationId, 'opening-location');
  assert.equal(db.prepare("SELECT reveal_at FROM canon_facts WHERE world_id = ? AND fact_id = ?").get(
    'w-anchorless', 'fact-w-anchorless-opening-location',
  ).reveal_at, '1', 'campaign recovery must preserve the original fact row');

  // A v3 archive rebinds only the owning world id. Legacy opening identities
  // and immutable reveal times must remain playable after that handoff too.
  const { exportPortableCanon } = require('../dist/application/export/portableCanon');
  const { projectLegacyAnchorlessOpeningFacts } = require('../dist/application/worldPackage/openingCompatibility');
  const sourcePackage = await worldStore.getWorldPackage('w-anchorless', published.manifest.revision);
  const locationFact = (await worldStore.listFacts('w-anchorless')).find(f => f.predicate === 'opening_location');
  await worldStore.saveFact({ ...locationFact, factId: 'unrelated-future-fact', predicate: 'opening_goal' }, 'now');
  const canon = await exportPortableCanon(worldStore, sourcePackage.manifest, sourcePackage.entries, sha.sha256Hex);
  const archive = await encodeWorldPackageArchive({ title: '旧开局完整资料', ...sourcePackage, canon }, sha.sha256Hex);
  await importPortableWorldPackage({ worldStore, archive, sha256Hex: sha.sha256Hex,
    newWorldId: 'portable-anchorless', createdAt: 'later' });
  const copySetup = await session.getWorldSetup('portable-anchorless');
  assert.ok(copySetup.locations.includes('opening-location'));
  const copyPackage = await worldStore.getWorldPackage('portable-anchorless', published.manifest.revision);
  const copyFacts = await worldStore.listFacts('portable-anchorless');
  const projected = projectLegacyAnchorlessOpeningFacts('portable-anchorless', copyPackage.manifest, copyFacts, true);
  assert.equal(projected.find(f => f.factId === 'unrelated-future-fact').revealAt, '1');
  const copyCampaign = await createCampaign({
    db: adapter, worldStore, campaignId: 'camp-portable-opening', title: '导入旧开局',
    worldId: 'portable-anchorless', packageRevision: published.manifest.revision,
    anchor: { worldTimeOrder: 0, locationId: 'opening-location' },
    protagonist: { actorId: 'actor-copy', kind: 'original', name: '旅人',
      attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 },
      initialSkills: ['skill-observation'] }, goal: '观察巷口', createdAt: 'later',
  });
  assert.equal(copyCampaign.snapshot.actors['actor-copy'].locationId, 'opening-location');
  assert.equal(copyFacts.find(f => f.factId === 'fact-w-anchorless-opening-location').revealAt, '1');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  db.close();
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { SqliteSourceStore } = require('../dist/infra/sqlite/sqliteSourceStore');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');
const { SqliteGameStore } = require('../dist/infra/sqlite/sqliteGameStore');
const { SqliteNarrativeStore } = require('../dist/infra/sqlite/sqliteNarrativeStore');
const { CampaignSession } = require('../dist/application/campaign/session');
const { projectPlayerEntriesAtAnchor } = require('../dist/application/campaign/session');
const { createCampaign } = require('../dist/application/campaign/createCampaign');
const { compileProgressiveOpeningPackage } = require('../dist/application/worldPackage/progressiveOpening');
const { publishProgressiveDelta } = require('../dist/application/worldPackage/progressiveDelta');
const { publishUserRequestedSourceLookupDelta } = require('../dist/application/worldPackage/progressiveDelta');
const { visibleEvidenceRanges } = require('../dist/application/progressiveBuild/progressiveTurnContext');
const { LocalSourceSearchService } = require('../dist/application/search/localSourceSearch');
const { ProgressiveBuildQueue } = require('../dist/application/progressiveBuild/progressiveBuildQueue');
const { ProgressiveTurnContextService } = require('../dist/application/progressiveBuild/progressiveTurnContext');
const { assembleBook } = require('../dist/application/worldPackage/publish');
const { encodeWorldPackageArchive, decodeWorldPackageArchive, importProgressiveBranchContentArchive } = require('../dist/application/export/worldPackageArchive');
const { exportSave, restoreSave, validateSaveJson } = require('../dist/application/export/saveFile');
const { loadBranchDeltaEntries } = require('../dist/application/worldPackage/contentManifest');
const { rebindBranchContentManifest } = require('../dist/application/worldPackage/branchContentStore');

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
    for (const sql of migration.sql.split(';').map(item => item.trim()).filter(Boolean)) db.exec(sql);
  }
  return db;
}

function dossier() {
  return {
    locationName: '青石巷', locationQuote: '巷口的灯还亮着。',
    setting: '巷口的灯还亮着。', settingQuote: '巷口的灯还亮着。',
    situation: '远处传来脚步声。', situationQuote: '远处传来脚步声。',
    initialGoal: '确认脚步声的来源。', goalQuote: '她循声望去。', unknowns: ['来人身份未知'],
  };
}

function lore(entryId, text, visibility = 'public', sourceFactId = null) {
  return {
    entryId, kind: 'lore', revision: 1,
    provenance: { kind: visibility === 'gm' ? 'design_fill' : 'explicit',
      sourceFactIds: sourceFactId ? [sourceFactId] : [], rationale: '测试中引用的已核对片段' },
    fieldProvenance: {}, visibility, dependencyIds: [],
    definition: { name: entryId, title: entryId, text },
  };
}

async function makeFixture() {
  const db = dbWithSchema();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  const sourceStore = new SqliteSourceStore(adapter);
  const openingText = '巷口的灯还亮着。远处传来脚步声。她循声望去。';
  const laterText = '后来，白衣客把密信藏在北桥石狮下。';
  const sourceText = `${openingText}\n${laterText}`;
  const sourceHash = sha.sha256Hex(sourceText);
  const end = Array.from(sourceText).length;
  const openingEnd = Array.from(openingText).length;
  const range = { startCodePoint: 0, endCodePoint: end, contentSha256: sourceHash };
  await worldStore.createWorld({ worldId: 'w-progressive-content', title: '渐进内容测试',
    sourceSha256: 'a'.repeat(64), sourceBytes: 100, normalizeVersion: 'n1', chapterSplitVersion: 'c1',
    buildStatus: 'ready', createdAt: 't0', updatedAt: 't0' });
  const chapter = { worldId: 'w-progressive-content', chapterId: 'opening', index: 0,
    title: '开篇', startOffset: 0, endOffset: end, charCount: end, contentHash: sourceHash };
  await worldStore.saveImportedSource('w-progressive-content', {
    encoding: 'utf-8', sourceSha256Hex: 'a'.repeat(64), sourceByteLength: 100,
    normalizeVersion: 'n1', chapterSplitVersion: 'c1', splitStrategy: 'standard', text: '',
    codePointCount: end, chapters: [chapter], chunks: [],
  }, 't0');
  const sourceManifest = {
    sourceId: 'source-progressive-content', rawSha256Hex: 'a'.repeat(64),
    normalizedTreeHash: sourceHash, normalizeTreeHashVersion: 'n1', byteLength: 100,
    codePointCount: end, encoding: 'utf-8', normalizeVersion: 'n1', chapterSplitVersion: 'c1',
    normalizeShardScheme: 'test', splitStrategy: 'standard', fileName: 'fixture.txt', title: 'fixture',
    status: 'staging', createdAt: 't0', updatedAt: 't0',
  };
  await sourceStore.beginStaging(sourceManifest);
  await sourceStore.saveShard({ sourceId: sourceManifest.sourceId, shardIndex: 0, startCp: 0, endCp: end, text: sourceText });
  await sourceStore.activateSource({
    manifest: { ...sourceManifest, status: 'active' },
    chapters: [{ chapterId: 'opening', index: 0, title: '开篇', startOffset: 0, endOffset: end, charCount: end, contentHash: sourceHash }],
    chunks: [{ chunkId: 'chunk-progressive-content', chapterId: 'opening', chunkIndex: 0,
      startOffset: 0, endOffset: end, charCount: end, contentHash: sourceHash }],
  });
  const published = await compileProgressiveOpeningPackage({
    worldStore, sha256Hex: sha.sha256Hex, worldId: 'w-progressive-content', sourceSha256: 'a'.repeat(64),
    sourceExcerpt: openingText, sourceEndCodePoint: openingEnd, chapters: [chapter], dossier: dossier(),
    requestMetrics: [{ attempt: 1, durationMs: 20, httpStatus: 200, outcome: 'completed' }],
    usage: { inputTokens: 20, outputTokens: 20, reasoningTokens: 0, estimated: false },
    extractionMs: 20, createdAt: 't0',
  });
  const opening = {
    db: adapter, worldStore, campaignId: 'camp-progressive-content', title: '渐进内容测试',
    worldId: 'w-progressive-content', packageRevision: published.manifest.revision,
    anchor: { worldTimeOrder: 1, locationId: 'opening-location' },
    protagonist: { actorId: 'actor-player', kind: 'original', name: '旅人',
      attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 },
      initialSkills: ['skill-observation'] },
    goal: '确认脚步声的来源', createdAt: 't0',
  };
  const campaign = await createCampaign(opening);
  const pkg = await worldStore.getWorldPackage(opening.worldId, published.manifest.revision);
  const facts = await worldStore.listFacts(opening.worldId);
  const evidenceRange = visibleEvidenceRanges(pkg.entries, facts, 1)[0];
  assert.ok(evidenceRange, 'opening package must cite at least one player-visible source range');
  const evidenceText = Array.from(sourceText).slice(evidenceRange.startCodePoint, evidenceRange.endCodePoint).join('');
  const exactEvidenceRange = { ...evidenceRange, contentSha256: sha.sha256Hex(evidenceText) };
  const citedFact = facts.find(fact => fact.status !== 'speculation' && fact.status !== 'conflict'
    && fact.sources.some(source => evidenceRange.startCodePoint <= source.startOffset
      && evidenceRange.endCodePoint >= source.endOffset));
  assert.ok(citedFact, 'visible source range must be backed by a non-conflicting fact');
  return { db, adapter, worldStore, sourceStore, sourceText, range,
    evidenceRange: exactEvidenceRange, evidenceText, citedFact, pkg, opening, campaign };
}

async function publishDelta(fixture, input) {
  const section = fixture.pkg.sections.find(item => item.book === (input.book ?? 'player_handbook'));
  return publishProgressiveDelta({
    db: fixture.adapter, worldStore: fixture.worldStore, sourceStore: fixture.sourceStore, sha256Hex: sha.sha256Hex,
    deltaId: input.deltaId, worldId: fixture.opening.worldId, branchId: fixture.campaign.branchId,
    stateVersion: input.stateVersion ?? 0, baseRevision: fixture.pkg.manifest.revision,
    sourceSha256: fixture.pkg.manifest.sourceSha256, mappingVersion: fixture.pkg.manifest.mappingVersion,
    entries: [lore(input.entryId, input.text, input.visibility, fixture.citedFact.factId)],
    sections: [{ book: section.book, sectionKey: section.sectionKey, title: section.title,
      entryIds: [input.entryId], position: section.position }],
    sourceRanges: [fixture.evidenceRange], createdAt: input.createdAt ?? 't1',
  });
}

test('migration 15 creates append-only progressive content projections without rewriting v2 package meaning', async () => {
  const db = new DatabaseSync(':memory:');
  const adapter = new NodeSqliteAdapter(db);
  try {
    for (const migration of BUILTIN_MIGRATIONS.slice(0, 14)) {
      for (const sql of migration.sql.split(';').map(item => item.trim()).filter(Boolean)) db.exec(sql);
    }
    const store = new SqliteWorldStore(adapter);
    await store.createWorld({ worldId: 'w-before-m15', title: '旧世界', sourceSha256: 'a'.repeat(64), sourceBytes: 1,
      normalizeVersion: 'old', chapterSplitVersion: 'old', buildStatus: 'ready', createdAt: 't0', updatedAt: 't0' });
    await adapter.execute(`INSERT INTO world_packages
      (world_id, revision, schema_version, source_sha256, ruleset_id, ruleset_version, mapping_version,
       status, content_hash, validation_json, build_scope_json, created_at)
      VALUES ('w-before-m15', 1, 'world-package-2', ?, 'shineword-core', '0.3.0', 'old', 'published', ?, '{}', '{}', 't0')`,
    ['a'.repeat(64), 'b'.repeat(64)]);
    for (const sql of BUILTIN_MIGRATIONS[14].sql.split(';').map(item => item.trim()).filter(Boolean)) db.exec(sql);
    const old = await store.getWorldPackage('w-before-m15', 1);
    assert.equal(old.manifest.schemaVersion, 'world-package-2');
    assert.equal(old.manifest.buildScope, undefined);
    assert.ok(await adapter.queryOne("SELECT name FROM sqlite_master WHERE type='table' AND name='branch_content_manifests'"));
    assert.ok(await adapter.queryOne("SELECT name FROM sqlite_master WHERE type='table' AND name='progressive_world_deltas'"));
  } finally { db.close(); }
});

test('explicit whole-source lookup publishes exact discoverable quotes and records knowledge on the branch', async () => {
  const fixture = await makeFixture();
  try {
    const context = new ProgressiveTurnContextService(
      fixture.sourceStore,
      new LocalSourceSearchService(fixture.sourceStore, fixture.worldStore),
      new ProgressiveBuildQueue(),
    );
    const lookupInput = {
      campaignId: fixture.opening.campaignId,
      branchId: fixture.campaign.branchId,
      worldId: fixture.opening.worldId,
      sourceSha256: fixture.pkg.manifest.sourceSha256,
      stateVersion: 0,
      query: '北桥密信',
      isCurrent: async () => true,
    };
    assert.equal(await context.currentAction(lookupInput), null,
      'current-action retrieval cannot turn an unscoped request into a whole-novel scan');
    const lookup = await context.activeBookLookup(lookupInput);
    assert.equal(lookup.passages.length, 1);
    assert.equal(lookup.passages[0].chapterTitle, '开篇');
    assert.equal(lookup.passages[0].text, '后来，白衣客把密信藏在北桥石狮下。');
    const facts = await fixture.worldStore.listFacts(fixture.opening.worldId);
    const visibleRanges = visibleEvidenceRanges(fixture.pkg.entries, facts, 1);
    assert.ok(!visibleRanges.some(range => range.startCodePoint <= lookup.passages[0].startCodePoint
      && range.endCodePoint >= lookup.passages[0].endCodePoint),
    'the hit comes from source text outside the opening package citations');

    const passage = lookup.passages[0];
    const exactHash = sha.sha256Hex(passage.text);
    const invalidEntry = {
      ...lore('unscoped-public-quote', passage.text),
      provenance: { kind: 'explicit', sourceFactIds: [], sourceRanges: [{ chapterId: passage.chapterId,
        startCodePoint: passage.startCodePoint, endCodePoint: passage.endCodePoint, contentSha256: exactHash }],
      policyId: 'user-requested-source-lookup', rationale: 'unapproved public quote' },
      visibility: 'public',
    };
    const playerSection = fixture.pkg.sections.find(section => section.book === 'player_handbook');
    const outsideRange = { startCodePoint: passage.startCodePoint, endCodePoint: passage.endCodePoint,
      contentSha256: exactHash };
    const generic = await publishProgressiveDelta({
      db: fixture.adapter, worldStore: fixture.worldStore, sourceStore: fixture.sourceStore,
      sha256Hex: sha.sha256Hex, deltaId: 'unscoped-public-quote-delta', worldId: fixture.opening.worldId,
      branchId: fixture.campaign.branchId, stateVersion: 0, baseRevision: fixture.pkg.manifest.revision,
      sourceSha256: fixture.pkg.manifest.sourceSha256, mappingVersion: fixture.pkg.manifest.mappingVersion,
      entries: [invalidEntry], sections: [{ book: playerSection.book, sectionKey: playerSection.sectionKey,
        title: playerSection.title, entryIds: [invalidEntry.entryId], position: playerSection.position }],
      sourceRanges: [outsideRange], createdAt: 'lookup-test',
    });
    assert.equal(generic.status, 'needs_review', 'ordinary delta publication cannot cite unexplored source');
    assert.equal(generic.activeManifest, null);

    const unsafePurpose = await publishProgressiveDelta({
      db: fixture.adapter, worldStore: fixture.worldStore, sourceStore: fixture.sourceStore,
      sha256Hex: sha.sha256Hex, deltaId: 'unsafe-lookup-purpose-delta', worldId: fixture.opening.worldId,
      branchId: fixture.campaign.branchId, stateVersion: 0, baseRevision: fixture.pkg.manifest.revision,
      sourceSha256: fixture.pkg.manifest.sourceSha256, mappingVersion: fixture.pkg.manifest.mappingVersion,
      entries: [{ ...invalidEntry, entryId: 'unsafe-rule', kind: 'skill', visibility: 'discoverable',
        revealPolicyId: 'source-lookup-confirmation' }],
      sections: [{ book: playerSection.book, sectionKey: 'source-lookup-excerpts', title: '主动查书摘录',
        entryIds: ['unsafe-rule'], position: playerSection.position + 1 }],
      sourceRanges: [outsideRange], purpose: 'player_requested_book_lookup', createdAt: 'lookup-test',
    });
    assert.equal(unsafePurpose.status, 'needs_review', 'lookup purpose cannot publish rules or public content');
    assert.equal(unsafePurpose.activeManifest, null);

    const lateCancel = new AbortController();
    const cancelingHash = async value => {
      lateCancel.abort();
      return sha.sha256Hex(value);
    };
    await assert.rejects(() => publishUserRequestedSourceLookupDelta({
      db: fixture.adapter, worldStore: fixture.worldStore, sourceStore: fixture.sourceStore,
      sha256Hex: cancelingHash, worldId: fixture.opening.worldId, branchId: fixture.campaign.branchId,
      stateVersion: 0, baseRevision: fixture.pkg.manifest.revision,
      sourceSha256: fixture.pkg.manifest.sourceSha256, book: 'player_handbook', passages: lookup.passages,
      existingEntryIds: new Set(), createdAt: 'canceled-lookup', signal: lateCancel.signal,
    }), { name: 'AbortError' });

    const published = await publishUserRequestedSourceLookupDelta({
      db: fixture.adapter, worldStore: fixture.worldStore, sourceStore: fixture.sourceStore,
      sha256Hex: sha.sha256Hex, worldId: fixture.opening.worldId, branchId: fixture.campaign.branchId,
      stateVersion: 0, baseRevision: fixture.pkg.manifest.revision,
      sourceSha256: fixture.pkg.manifest.sourceSha256, book: 'player_handbook', passages: lookup.passages,
      existingEntryIds: new Set(fixture.pkg.entries.map(entry => entry.entryId)), createdAt: 'lookup-test',
    });
    assert.equal(published.status, 'published', JSON.stringify(published.publication?.delta.validation.errors));
    assert.equal(published.entryIds.length, 1);
    const excerpt = published.publication.delta.entries[0];
    assert.equal(excerpt.kind, 'lore');
    assert.equal(excerpt.visibility, 'discoverable');
    assert.equal(excerpt.revealPolicyId, 'source-lookup-confirmation');
    assert.equal(excerpt.definition.text, passage.text);
    assert.deepEqual(excerpt.provenance.sourceRanges[0], {
      chapterId: passage.chapterId, startCodePoint: passage.startCodePoint,
      endCodePoint: passage.endCodePoint, contentSha256: exactHash,
    });
    const leakedPublic = {
      ...lore('public-from-hidden-quote', passage.text),
      provenance: { kind: 'explicit', sourceFactIds: [], sourceRanges: [{ chapterId: passage.chapterId,
        startCodePoint: passage.startCodePoint, endCodePoint: passage.endCodePoint, contentSha256: exactHash }],
      rationale: 'must not promote an unconfirmed hidden quote' },
      visibility: 'public',
    };
    const hiddenQuoteReuse = await publishProgressiveDelta({
      db: fixture.adapter, worldStore: fixture.worldStore, sourceStore: fixture.sourceStore,
      sha256Hex: sha.sha256Hex, deltaId: 'public-from-hidden-quote-delta', worldId: fixture.opening.worldId,
      branchId: fixture.campaign.branchId, stateVersion: 0, baseRevision: fixture.pkg.manifest.revision,
      sourceSha256: fixture.pkg.manifest.sourceSha256, mappingVersion: fixture.pkg.manifest.mappingVersion,
      entries: [leakedPublic], sections: [{ book: playerSection.book, sectionKey: playerSection.sectionKey,
        title: playerSection.title, entryIds: [leakedPublic.entryId], position: playerSection.position }],
      sourceRanges: [outsideRange], createdAt: 'lookup-test',
    });
    assert.equal(hiddenQuoteReuse.status, 'needs_review',
      'a hidden lookup excerpt cannot become evidence for an ordinary public expansion');

    const combined = {
      entries: [...fixture.pkg.entries, ...published.publication.delta.entries],
      sections: [...fixture.pkg.sections, ...published.publication.delta.sections],
    };
    const hidden = assembleBook(combined, 'player_handbook', {
      includeGm: false, knowledge: { discoveredEntryIds: new Set() },
    });
    assert.ok(!hidden.flatMap(group => group.entries).some(entry => entry.entryId === excerpt.entryId),
      'an unconfirmed exact quote stays hidden from the player book');
    assert.ok(!projectPlayerEntriesAtAnchor(combined.entries, facts, 1, new Set())
      .some(entry => entry.entryId === excerpt.entryId),
    'the planner/player projection also withholds undiscovered source lookups');

    const secondPublish = await publishUserRequestedSourceLookupDelta({
      db: fixture.adapter, worldStore: fixture.worldStore, sourceStore: fixture.sourceStore,
      sha256Hex: sha.sha256Hex, worldId: fixture.opening.worldId, branchId: fixture.campaign.branchId,
      stateVersion: 0, baseRevision: fixture.pkg.manifest.revision,
      sourceSha256: fixture.pkg.manifest.sourceSha256, book: 'player_handbook', passages: lookup.passages,
      existingEntryIds: new Set([...fixture.pkg.entries.map(entry => entry.entryId), excerpt.entryId]), createdAt: 'lookup-test',
    });
    assert.equal(secondPublish.status, 'already_published');
    assert.deepEqual(secondPublish.entryIds, [excerpt.entryId]);

    const turns = new SqliteTurnStore(fixture.adapter);
    const session = new CampaignSession({
      db: fixture.adapter, turns, game: new SqliteGameStore(fixture.adapter), worldStore: fixture.worldStore,
      narratives: new SqliteNarrativeStore(fixture.adapter), sourceStore: fixture.sourceStore,
      hashProvider: sha, random: { nextBytes: async length => new Uint8Array(length).fill(9) },
    }, { complete: async () => { throw new Error('source knowledge confirmation must not call a model'); } },
    { model: 'test', id: 'test', name: 'test', endpoint: 'http://localhost', keyRef: 'unused',
      capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: false, contextWindow: 8000, maxOutputTokens: 1000 } });
    await session.recordProgressiveSourceKnowledge({ campaignId: fixture.opening.campaignId,
      branchId: fixture.campaign.branchId, entryIds: published.entryIds });
    const knownState = await turns.getState(fixture.campaign.branchId);
    assert.equal(knownState.stateVersion, 1);
    assert.ok(knownState.discoveries.some(item => item.entryId === excerpt.entryId
      && item.actorId === 'actor-player' && item.knownVia === 'told'));
    const known = assembleBook(combined, 'player_handbook', {
      includeGm: false, knowledge: { discoveredEntryIds: new Set([excerpt.entryId]) },
    });
    assert.ok(known.flatMap(group => group.entries).some(entry => entry.entryId === excerpt.entryId));
    assert.ok(projectPlayerEntriesAtAnchor(combined.entries, facts, 1, new Set([excerpt.entryId]))
      .some(entry => entry.entryId === excerpt.entryId));

    const nowKnownEntry = {
      ...lore('public-after-source-discovery', `基于已发现摘录继续编排。`),
      provenance: { kind: 'explicit', sourceFactIds: [], sourceRanges: [{ chapterId: passage.chapterId,
        startCodePoint: passage.startCodePoint, endCodePoint: passage.endCodePoint, contentSha256: exactHash }],
      rationale: 'only permitted after the branch records the discovery' },
    };
    const afterKnown = await publishProgressiveDelta({
      db: fixture.adapter, worldStore: fixture.worldStore, sourceStore: fixture.sourceStore,
      sha256Hex: sha.sha256Hex, deltaId: 'public-after-source-discovery-delta', worldId: fixture.opening.worldId,
      branchId: fixture.campaign.branchId, stateVersion: 1, baseRevision: fixture.pkg.manifest.revision,
      sourceSha256: fixture.pkg.manifest.sourceSha256, mappingVersion: fixture.pkg.manifest.mappingVersion,
      entries: [nowKnownEntry], sections: [{ book: playerSection.book, sectionKey: playerSection.sectionKey,
        title: playerSection.title, entryIds: [nowKnownEntry.entryId], position: playerSection.position }],
      sourceRanges: [outsideRange], createdAt: 'lookup-test',
    });
    assert.equal(afterKnown.status, 'published', 'the branch may extend only after knowledge is confirmed');

    const save = await exportSave({ db: fixture.adapter, sha256Hex: sha.sha256Hex,
      campaignId: fixture.opening.campaignId, branchId: fixture.campaign.branchId, createdAt: 'lookup-save' });
    assert.ok(save.save.contentDeltas.some(delta => delta.deltaId === published.publication.delta.deltaId));
    assert.equal((await validateSaveJson(save.json, sha.sha256Hex)).ok, true);
    const rewound = await session.rewind({ campaignId: fixture.opening.campaignId,
      sourceBranchId: fixture.campaign.branchId, atStateVersion: 0, newBranchId: 'camp-progressive-lookup-rewind' });
    const rewindState = await turns.getState(rewound.branchId);
    assert.equal(rewindState.stateVersion, 0);
    assert.ok(!rewindState.discoveries.some(item => item.entryId === excerpt.entryId),
      'rewind removes the later knowledge confirmation');
    assert.ok(rewindState.contentManifest.deltas.some(delta => delta.deltaId === published.publication.delta.deltaId),
      'the immutable source package survives rewind without keeping the character discovery');
    assert.ok(!rewindState.contentManifest.deltas.some(delta => delta.deltaId === afterKnown.delta.deltaId),
      'rewinding before the confirmation excludes expansions made in a later branch state');
  } finally { fixture.db.close(); }
});

test('branch delta publication, frozen Planner dependency, fork/save/archive restore and review isolation', async () => {
  const fixture = await makeFixture();
  try {
    const first = await publishDelta(fixture, { deltaId: 'delta-public-1', entryId: 'lore-public-1', text: '已发布的增量线索。' });
    assert.equal(first.status, 'published');
    assert.equal(first.activeManifest.contentVersion, 1);
    assert.equal(first.activeManifest.deltas.length, 1);

    const archiveBytes = await encodeWorldPackageArchive({ title: '渐进内容测试', ...fixture.pkg,
      branchContent: { manifest: first.activeManifest, deltas: [first.delta] } }, sha.sha256Hex);
    const archive = await decodeWorldPackageArchive(archiveBytes, sha.sha256Hex);
    assert.equal(archive.schemaVersion, 'shineword-world-archive-2');
    assert.equal(archive.branchContent.deltas[0].deltaId, 'delta-public-1');

    const copy = await createCampaign({ ...fixture.opening, campaignId: 'camp-progressive-content-copy' });
    const attachResult = await importProgressiveBranchContentArchive({
      db: fixture.adapter, worldStore: fixture.worldStore, sourceStore: fixture.sourceStore, sha256Hex: sha.sha256Hex,
      archive: archiveBytes, branchId: copy.branchId, createdAt: 't2',
    });
    assert.equal(attachResult.deltaCount, 1);
    const copyState = await new SqliteTurnStore(fixture.adapter).getState(copy.branchId);
    assert.deepEqual(copyState.contentManifest.deltas.map(ref => ref.deltaId), ['delta-public-1']);
    const portableManifest = rebindBranchContentManifest(copyState.contentManifest, copy.branchId, 0,
      'w-progressive-content-portable');
    const copiedEntries = await loadBranchDeltaEntries({ manifest: portableManifest,
      worldId: 'w-progressive-content-portable', branchId: copy.branchId, stateVersion: 0,
      baseRevision: fixture.pkg.manifest.revision, baseContentHash: fixture.pkg.manifest.contentHash,
      getDelta: deltaId => fixture.worldStore.getProgressiveDeltaPackage(deltaId), sha256Hex: sha.sha256Hex });
    assert.equal(copiedEntries[0].worldId, fixture.opening.worldId,
      'an unchanged immutable delta remains portable across local world-id remapping');

    let publishedDuringPlanner = false;
    const plannerRequests = [];
    const provider = { complete: async request => {
      if (request.role === 'Planner') {
        const prompt = JSON.parse(request.user);
        plannerRequests.push(prompt);
        if (!publishedDuringPlanner) {
          publishedDuringPlanner = true;
          const later = await publishDelta(fixture, { deltaId: 'delta-gm-later', entryId: 'lore-hidden-later',
            text: '不得提前泄露的后续秘密。', visibility: 'gm', stateVersion: 0 });
          assert.equal(later.status, 'published');
        }
        return { text: JSON.stringify({ proposalVersion: '2.0', turnId: prompt.turnId,
          expectedStateVersion: prompt.expectedStateVersion, actorId: 'actor-player', actionKind: 'observe',
          evidenceIds: [], intent: '观察巷口' }) };
      }
      const narration = JSON.parse(request.user);
      return { text: JSON.stringify({ turnId: narration.turnId, outcomeGrade: narration.outcomeGrade, text: '你观察巷口。' }) };
    } };
    const turns = new SqliteTurnStore(fixture.adapter);
    const excerptText = fixture.evidenceText;
    const progressiveTurnContext = {
      setForegroundBusy() {},
      currentAction: async () => ({
        result: { queryTerms: [], hits: [], adjacentPrefetch: [] },
        passages: [{ chapterId: 'opening', startCodePoint: fixture.evidenceRange.startCodePoint,
          endCodePoint: fixture.evidenceRange.endCodePoint, paragraphId: 'paragraph-opening', text: excerptText }],
        adjacentPrefetch: [],
      }),
      nearDomainPrefetch: async () => null,
    };
    const session = new CampaignSession({
      db: fixture.adapter, turns, game: new SqliteGameStore(fixture.adapter), worldStore: fixture.worldStore,
      narratives: new SqliteNarrativeStore(fixture.adapter), sourceStore: fixture.sourceStore,
      progressiveTurnContext, hashProvider: sha,
      random: { nextBytes: async length => new Uint8Array(length).fill(7) },
    }, provider, { model: 'test', id: 'test', name: 'test', endpoint: 'http://localhost', keyRef: 'unused',
      capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: false, contextWindow: 8000, maxOutputTokens: 4096 } });

    const firstTurn = await session.playTurn({ campaignId: fixture.opening.campaignId,
      branchId: fixture.campaign.branchId, intent: '观察巷口' });
    assert.equal(firstTurn.stateVersion, 1);
    assert.ok(plannerRequests[0].worldContext.includes('已发布的增量线索。'));
    assert.ok(!plannerRequests[0].worldContext.includes('不得提前泄露的后续秘密。'), 'mid-request delta cannot alter frozen Planner context');
    const staged = await fixture.adapter.queryOne('SELECT action_contract_json FROM turns WHERE branch_id = ? AND turn_id = ?',
      [fixture.campaign.branchId, firstTurn.turnId]);
    const frozen = JSON.parse(staged.action_contract_json);
    assert.equal(frozen.contentDependency.contentVersion, 2);
    assert.deepEqual(frozen.contentDependency.deltaIds.slice(0, 2), ['delta-public-1', frozen.contentDependency.deltaIds[1]]);
    assert.match(frozen.contentDependency.deltaIds[1], /^source-excerpts-/);
    const head = await turns.getState(fixture.campaign.branchId);
    assert.equal(head.contentManifest.contentVersion, 3, 'the concurrent extension is available only after the frozen turn commits');
    assert.ok(head.contentManifest.deltas.some(ref => ref.deltaId === 'delta-gm-later'));

    await session.playTurn({ campaignId: fixture.opening.campaignId, branchId: fixture.campaign.branchId, intent: '继续观察' });
    assert.equal(plannerRequests[1].expectedStateVersion, 1);
    assert.ok(plannerRequests[1].worldContext.includes('已发布的增量线索。'));
    assert.ok(!plannerRequests[1].worldContext.includes('不得提前泄露的后续秘密。'), 'GM-only delta stays out of player Planner context');

    const rewound = await session.rewind({ campaignId: fixture.opening.campaignId,
      sourceBranchId: fixture.campaign.branchId, atStateVersion: 0, newBranchId: 'camp-progressive-content-rewind' });
    const rewindState = await turns.getState(rewound.branchId);
    assert.equal(rewindState.stateVersion, 0);
    assert.deepEqual(rewindState.contentManifest.deltas.map(ref => ref.deltaId).filter(id => id !== 'delta-gm-later'),
      ['delta-public-1', frozen.contentDependency.deltaIds[1]]);
    assert.notEqual(rewindState.contentManifest.branchId, fixture.campaign.branchId);
    assert.deepEqual((await turns.getState(copy.branchId)).contentManifest.deltas.map(ref => ref.deltaId), ['delta-public-1'],
      'the second branch never receives a later branch-only delta');

    const exported = await exportSave({ db: fixture.adapter, sha256Hex: sha.sha256Hex,
      campaignId: fixture.opening.campaignId, branchId: fixture.campaign.branchId, createdAt: 't3' });
    assert.equal(exported.save.manifest.schemaVersion, 'shineword-save-9'); // P7: saves declare save-8
    assert.equal(exported.save.contentDeltas.length, 3);
    assert.equal((await validateSaveJson(exported.json, sha.sha256Hex)).ok, true);
    const malformedSave = JSON.parse(exported.json);
    malformedSave.contentDeltas[0].basePackage = null;
    assert.equal((await validateSaveJson(JSON.stringify(malformedSave), sha.sha256Hex)).ok, false,
      'malformed nested delta JSON is reported as a validation error');
    await assert.rejects(() => restoreSave({ db: fixture.adapter, save: malformedSave,
      newCampaignId: 'camp-malformed-progressive-save', newBranchId: 'branch-malformed-progressive-save', createdAt: 't4',
      sha256Hex: sha.sha256Hex }), /Save validation failed before restore/);
    assert.equal(await fixture.adapter.queryOne('SELECT campaign_id FROM campaigns WHERE campaign_id = ?',
      ['camp-malformed-progressive-save']), null, 'invalid imported content writes no campaign rows');
    await restoreSave({ db: fixture.adapter, save: exported.save,
      newCampaignId: 'camp-progressive-content-restored', newBranchId: 'camp-progressive-content-restored-main', createdAt: 't4',
      sha256Hex: sha.sha256Hex });
    const restored = await turns.getState('camp-progressive-content-restored-main');
    assert.equal(restored.contentManifest.manifestHash, exported.save.state.contentManifest.manifestHash);
    assert.equal(restored.contentManifest.branchId, 'camp-progressive-content-restored-main');
    assert.equal(restored.contentManifest.deltas.length, 3);

    const bad = await publishDelta(fixture, { deltaId: 'delta-review-conflict', entryId: 'scene-progressive-opening',
      text: '冲突不得覆盖旧定义。', stateVersion: 2 });
    assert.equal(bad.status, 'needs_review');
    assert.equal(bad.activeManifest, null);
    const reviewRow = await fixture.adapter.queryOne('SELECT status FROM progressive_world_deltas WHERE delta_id = ?', ['delta-review-conflict']);
    assert.equal(reviewRow.status, 'needs_review');
    assert.equal((await turns.getState(fixture.campaign.branchId)).contentManifest.contentVersion, 3,
      'review-only proposals never enter the active content manifest');

    const currentSnapshot = await fixture.adapter.queryOne(
      'SELECT snapshot_json FROM snapshots WHERE branch_id = ? AND state_version = 2', [fixture.campaign.branchId]);
    const snapshot = JSON.parse(currentSnapshot.snapshot_json);
    snapshot.actors['npc-dead'] = { actorId: 'npc-dead', locationId: 'opening-location', resources: { hp: 0 },
      conditions: [], lifeStatus: 'dead' };
    await fixture.adapter.execute('UPDATE snapshots SET snapshot_json = ? WHERE branch_id = ? AND state_version = 2',
      [JSON.stringify(snapshot), fixture.campaign.branchId]);
    await fixture.adapter.execute(`INSERT INTO actor_states
      (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
      VALUES (?, 'npc-dead', 2, 'opening-location', '{"hp":0}', '[]')`, [fixture.campaign.branchId]);
    await fixture.adapter.execute(`INSERT INTO actor_cards
      (branch_id, actor_id, card_json, created_at, updated_at, updated_state_version)
      VALUES (?, 'npc-dead', ?, 't5', 't5', 2)`, [fixture.campaign.branchId,
      JSON.stringify({ actorId: 'npc-dead', kind: 'npc', controller: 'gm', name: '守夜人', templateId: 'old-guard-template' })]);
    const monsterSection = fixture.pkg.sections.find(item => item.book === 'monster_manual');
    const revival = await publishProgressiveDelta({
      db: fixture.adapter, worldStore: fixture.worldStore, sourceStore: fixture.sourceStore, sha256Hex: sha.sha256Hex,
      deltaId: 'delta-revive-dead-npc', worldId: fixture.opening.worldId, branchId: fixture.campaign.branchId,
      stateVersion: 2, baseRevision: fixture.pkg.manifest.revision,
      sourceSha256: fixture.pkg.manifest.sourceSha256, mappingVersion: fixture.pkg.manifest.mappingVersion,
      entries: [{ entryId: 'new-guard-template', kind: 'actor_template', revision: 1,
        provenance: { kind: 'design_fill', sourceFactIds: [], rationale: '测试中的冲突复现' },
        fieldProvenance: {}, visibility: 'gm', dependencyIds: [],
        definition: { name: '守夜人', category: 'human', description: '回归测试', attributes: {}, skills: {},
          hp: 3, stamina: 1, defense: 2, attacks: [], abilities: [],
          behavior: { goal: '守门', retreatThreshold: 0.2, morale: 'steady' }, lootPolicy: 'none',
          threat: { damage: 1, durability: 1, actions: 1, control: 0, environment: 0 } } }],
      sections: [{ book: monsterSection.book, sectionKey: monsterSection.sectionKey, title: monsterSection.title,
        entryIds: ['new-guard-template'], position: monsterSection.position }],
      sourceRanges: [fixture.evidenceRange], createdAt: 't5',
    });
    assert.equal(revival.status, 'needs_review');
    assert.ok(revival.delta.validation.errors.some(message => message.includes('already recorded the NPC as dead')));
    assert.equal((await turns.getState(fixture.campaign.branchId)).contentManifest.deltas.length, 3,
      'a later source package cannot revive an NPC already dead on this branch');
  } finally { fixture.db.close(); }
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMobileHarness, NodeSqliteAdapter, sha } = require('./helpers/mobileHarness.cjs');
const { CampaignSession } = require('../dist/application/campaign/session');
const { createCampaign } = require('../dist/application/campaign/createCampaign');
const { exportPortableCanon } = require('../dist/application/export/portableCanon');
const { encodeWorldPackageArchive, decodeWorldPackageArchive, importPortableWorldPackage } = require('../dist/application/export/worldPackageArchive');
const { buildPackageFromCanon } = require('../dist/application/worldPackage/buildPackageFromCanon');
const { findLocalOpeningSource, hasPlayableOpening } = require('../dist/application/worldPackage/openingRecovery');
const { canonicalStringify } = require('../dist/domain/turns/canonical');

const PROFILE = { id: 'test', name: 'Test', endpoint: 'https://test.invalid/v1', model: 'glm-test', keyRef: 'memory',
  capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: true, contextWindow: 65_536, maxOutputTokens: 24_576 },
  reasoningDialect: 'glm', reasoningTier: 'low', contentOutputTokens: 3_000, concurrency: 1 };
const TEXT = '第一章 街口\n林凡站在青石巷，手持铜钥，身属青岚会，懂得听风术，遵守入夜禁行的规矩。苏轻语站在他身旁。';
const QUOTE = '林凡站在青石巷，手持铜钥，身属青岚会，懂得听风术，遵守入夜禁行的规矩。';

async function built(strategy = 'progressive', legacyOpeningEntry = false) {
  const requests = [];
  const h = await createMobileHarness({ bytes: Buffer.from(TEXT), transport: {
    async post(request) {
      const body = JSON.parse(request.body);
      requests.push(body);
      let output;
      if (body.messages[0].content.includes('WorldMapper')) {
        output = { skills: [], constraints: [], actorTemplates: [], items: [], lore: [], ruleMappings: [] };
      } else if (body.messages[0].content.includes('Extractor')) {
        const entities = [ ['lin', 'character', '林凡'], ['alley', 'location', '青石巷'], ['key', 'item', '铜钥'],
          ['guild', 'faction', '青岚会'], ['wind', 'ability', '听风术'], ['rule', 'rule', '入夜禁行'] ]
          .map(([key, type, name]) => ({ key, type, name, aliases: [] }));
        output = { entities, facts: entities.filter(e => e.type !== 'location').map(e => ({ subject: e.key,
          predicate: e.type === 'character' ? 'current_location' : 'named',
          value: e.type === 'character' ? { location: '青石巷' } : { name: e.name }, status: 'explicit', confidence: 1, segment: 1, quote: QUOTE })),
          events: [], ruleMappings: [] };
      } else if (body.messages[0].content.includes('Timeline')) {
        output = { events: [] };
      } else {
        throw new Error('Unexpected pipeline request');
      }
      return { status: 200, headers: {}, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 100 } }) };
    },
  } });
  try {
    const imported = legacyOpeningEntry
      ? await h.sourceImport.importNovelForOpeningStreaming('memory://synthetic', 'opening.txt', PROFILE, () => {})
      : await h.sourceImport.importNovelUnified('memory://synthetic', 'opening.txt', PROFILE, strategy, () => {});
    for (const id of imported.runIds) {
      const result = await h.sourceImport.runExtraction(id, PROFILE, () => {});
      assert.equal(result.completed, true);
      assert.equal((await h.runStore.getRun(id)).status, 'completed');
    }
    const revision = await h.runtime.worldStore.getPublishedPackageRevision(imported.worldId);
    assert.notEqual(revision, null, 'the complete analysis pipeline publishes a playable package');
    return { ...h, imported, requests, pkg: await h.runtime.worldStore.getWorldPackage(imported.worldId, revision) };
  } catch (error) { h.db.close(); throw error; }
}

function session(h) {
  return new CampaignSession({ db: h.adapter, worldStore: h.runtime.worldStore },
    { complete: async () => { throw new Error('Opening must not call a model'); } }, PROFILE);
}

test('rapid opening uses the same complete extraction/mapping analysis as full build', async () => {
  const rapid = await built('progressive', true);
  const full = await built('full');
  try {
    assert.equal(rapid.imported.strategy, 'progressive');
    assert.ok(Array.isArray(rapid.imported.runIds), 'the compatibility API queues governed build runs, not a dossier');
    assert.equal(rapid.imported.codePointCount, Array.from(TEXT).length);
    const extraction = h => h.requests.find(r => r.messages[0].content.includes('Extractor'));
    assert.equal(extraction(rapid).messages[0].content, extraction(full).messages[0].content);
    assert.ok(extraction(rapid).messages[0].content.includes('relationships'));
    assert.ok(rapid.requests.some(r => r.messages[0].content.includes('WorldMapper')));
    assert.ok(!rapid.requests.some(r => r.messages[0].content.includes('开局资料整理器')));
    for (const h of [rapid, full]) {
      const setup = await session(h).getWorldSetup(h.imported.worldId);
      assert.equal(setup.canonCharacters.some(c => c.name === '林凡'), true);
      assert.equal(setup.locations.includes('青石巷'), true);
      const types = new Set((await h.runtime.worldStore.listEntities(h.imported.worldId)).map(e => e.type));
      for (const kind of ['character', 'location', 'item', 'faction', 'ability', 'rule']) assert.ok(types.has(kind));
      assert.ok(h.pkg.entries.some(e => e.kind === 'scene'));
      assert.equal(h.pkg.manifest.buildScope.completeness, 'complete');
    }
  } finally { rapid.db.close(); full.db.close(); }
});

test('complete analysis -> archive v3 -> independent DB -> canon protagonist -> valid campaign snapshot', async () => {
  const source = await built();
  const target = await createMobileHarness();
  try {
    const canon = await exportPortableCanon(source.runtime.worldStore, source.pkg.manifest, source.pkg.entries, sha.sha256Hex);
    const archive = await encodeWorldPackageArchive({ title: '开局链路测试', ...source.pkg, canon }, sha.sha256Hex);
    const decoded = await decodeWorldPackageArchive(archive, sha.sha256Hex);
    assert.equal(decoded.schemaVersion, 'shineword-world-archive-5');
    await importPortableWorldPackage({ worldStore: target.runtime.worldStore, sha256Hex: sha.sha256Hex,
      archive, newWorldId: 'imported-game', createdAt: 'later' });
    const setup = await session(target).getWorldSetup('imported-game');
    assert.equal(setup.locations.includes('青石巷'), true);
    const hero = setup.canonCharacters.find(c => c.name === '林凡');
    assert.ok(hero, 'original-story characters survive the portable handoff');
    const originalFacts = await source.runtime.worldStore.listFacts(source.imported.worldId);
    const importedFacts = await target.runtime.worldStore.listFacts('imported-game');
    assert.deepEqual(importedFacts.map(f => ({ ...f, worldId: source.imported.worldId })), originalFacts);
    const created = await createCampaign({ db: target.adapter, worldStore: target.runtime.worldStore,
      campaignId: 'game-chain', title: '真实资料开局', worldId: 'imported-game', packageRevision: setup.packageRevision,
      anchor: { worldTimeOrder: 1, locationId: setup.locations[0] },
      protagonist: { actorId: 'player', kind: 'canon', name: hero.name, canonEntityId: hero.entityId },
      goal: '观察街口', createdAt: 'later' });
    assert.equal(created.snapshot.actors.player.locationId, '青石巷');
    assert.equal(created.cards[0].kind, 'canon');
    assert.equal(created.cards[0].entityId, hero.entityId);
    assert.equal(target.db.prepare('PRAGMA foreign_key_check').all().length, 0);
    const copy = await target.runtime.worldStore.getWorldPackage('imported-game', setup.packageRevision);
    assert.equal(copy.manifest.contentHash, source.pkg.manifest.contentHash, 'immutable package identity is preserved');
  } finally { source.db.close(); target.db.close(); }
});

test('archive v3 keeps timeline forward edges and rule mappings through a world-id remap', async () => {
  const h = await built(); const target = await createMobileHarness();
  try {
    const worldId = h.imported.worldId;
    const entities = await h.runtime.worldStore.listEntities(worldId);
    const hero = entities.find(e => e.type === 'character');
    const facts = await h.runtime.worldStore.listFacts(worldId);
    const chapter = (await h.runtime.worldStore.getChapters(worldId))[0];
    await h.runtime.worldStore.saveEvent({ worldId, eventId: 'evt-later', title: '后续', summary: '后续事件', worldTimeOrder: 2,
      narrativeChapterId: chapter.chapterId, validFrom: null, validTo: null, status: 'canon', dependsOnEventIds: [] }, 'now');
    await h.runtime.worldStore.saveEvent({ worldId, eventId: 'evt-first', title: '起点', summary: '当前事件', worldTimeOrder: 1,
      narrativeChapterId: chapter.chapterId, validFrom: null, validTo: null, status: 'canon', dependsOnEventIds: ['evt-later'] }, 'now');
    await h.runtime.worldStore.saveRuleMapping({ worldId, mappingId: 'mapped-insight', targetEntityId: hero.entityId,
      mappingKind: 'attribute', mapping: { attribute: 'insight', value: 2 }, evidenceRefs: [facts.find(f => f.subjectEntityId === hero.entityId).factId],
      rulesetVersion: h.pkg.manifest.ruleset.version, status: 'active' }, 'now');
    const canon = await exportPortableCanon(h.runtime.worldStore, h.pkg.manifest, h.pkg.entries, sha.sha256Hex);
    const archive = await encodeWorldPackageArchive({ title: '时间与规则', ...h.pkg, canon }, sha.sha256Hex);
    await importPortableWorldPackage({ worldStore: target.runtime.worldStore, sha256Hex: sha.sha256Hex, archive,
      newWorldId: 'canon-copy', createdAt: 'now' });
    assert.deepEqual((await target.runtime.worldStore.listEvents('canon-copy')).find(e => e.eventId === 'evt-first').dependsOnEventIds, ['evt-later']);
    assert.equal((await target.runtime.worldStore.listRuleMappings('canon-copy'))[0].mapping.value, 2);
    assert.equal(target.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { h.db.close(); target.db.close(); }
});

test('v3 rejects missing canon references and changed evidence even with a recomputed envelope hash', async () => {
  const h = await built();
  try {
    const canon = await exportPortableCanon(h.runtime.worldStore, h.pkg.manifest, h.pkg.entries, sha.sha256Hex);
    for (const mutate of [c => { c.entities = []; }, c => { c.facts = []; },
      c => { c.facts[0].sources[0].quote = '错误引文'; }, c => { c.chapters[0].endOffset = 1; }]) {
      const bad = JSON.parse(JSON.stringify(canon)); mutate(bad);
      const { contentHash, ...body } = bad; bad.contentHash = sha.sha256Hex(canonicalStringify(body));
      await assert.rejects(() => encodeWorldPackageArchive({ title: '坏包', ...h.pkg, canon: bad }, sha.sha256Hex));
    }
  } finally { h.db.close(); }
});

test('v3 import rolls back the entire world when canon commit fails', async () => {
  const h = await built(); const target = await createMobileHarness();
  try {
    const canon = await exportPortableCanon(h.runtime.worldStore, h.pkg.manifest, h.pkg.entries, sha.sha256Hex);
    const archive = await encodeWorldPackageArchive({ title: '原子导入', ...h.pkg, canon }, sha.sha256Hex);
    target.db.exec("CREATE TEMP TRIGGER reject_canon BEFORE INSERT ON canon_facts BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    await assert.rejects(() => importPortableWorldPackage({ worldStore: target.runtime.worldStore, sha256Hex: sha.sha256Hex,
      archive, newWorldId: 'rollback-copy', createdAt: 'now' }), /injected failure/);
    assert.equal(await target.runtime.worldStore.getWorld('rollback-copy'), null);
    assert.equal(target.db.prepare('SELECT COUNT(*) n FROM entities').get().n, 0);
  } finally { h.db.close(); target.db.close(); }
});

test('mobile publication refuses missing opening locations before paying for a mapper', async () => {
  const h = await createMobileHarness({ bytes: Buffer.from(TEXT) });
  try {
    const imported = await h.sourceImport.importNovelUnified('memory://synthetic', 'empty-analysis.txt', PROFILE, 'progressive', () => {});
    let calls = 0;
    await assert.rejects(() => buildPackageFromCanon({ worldStore: h.runtime.worldStore, worldId: imported.worldId,
      provider: { complete: async () => { calls++; return { text: '{}' }; } }, sha256Hex: sha.sha256Hex,
      sourceSha256: 'a'.repeat(64), mappingVersion: 'test', createdAt: 'now', requirePlayableOpening: true }), /地点证据/);
    assert.equal(calls, 0);
    assert.equal(await h.runtime.worldStore.getPublishedPackageRevision(imported.worldId), null);
  } finally { h.db.close(); }
});

test('legacy opening recovery matches source hashes, never a same-title unrelated world', async () => {
  const h = await built();
  try {
    const source = await h.runtime.worldStore.getWorld(h.imported.worldId);
    await h.runtime.worldStore.createWorld({ ...source, worldId: 'legacy-import', sourceBytes: 0 });
    await h.runtime.worldStore.createWorld({ ...source, worldId: 'unrelated', sourceSha256: 'f'.repeat(64) });
    const found = await findLocalOpeningSource({ worldStore: h.runtime.worldStore, worldId: 'legacy-import',
      getSetup: id => session(h).getWorldSetup(id) });
    assert.equal(found.worldId, source.worldId);
    assert.equal(await findLocalOpeningSource({ worldStore: h.runtime.worldStore, worldId: 'unrelated',
      getSetup: id => session(h).getWorldSetup(id) }), null);
  } finally { h.db.close(); }
});

test('a published legacy archive without canon has a repair state, while a v3 roundtrip is playable', async () => {
  const source = await built(); const target = await createMobileHarness();
  try {
    assert.equal(await hasPlayableOpening(source.runtime.worldStore, source.imported.worldId, source.pkg.manifest.revision), true);
    const legacy = await encodeWorldPackageArchive({ title: '历史资料包', ...source.pkg }, sha.sha256Hex);
    await importPortableWorldPackage({ worldStore: target.runtime.worldStore, sha256Hex: sha.sha256Hex,
      archive: legacy, newWorldId: 'legacy-no-canon', createdAt: 'now' });
    assert.equal(await hasPlayableOpening(target.runtime.worldStore, 'legacy-no-canon', source.pkg.manifest.revision), false,
      'an evidence-gated scene without its facts must never be advertised as playable');
    const canon = await exportPortableCanon(source.runtime.worldStore, source.pkg.manifest, source.pkg.entries, sha.sha256Hex);
    const archive = await encodeWorldPackageArchive({ title: '完整资料包', ...source.pkg, canon }, sha.sha256Hex);
    await importPortableWorldPackage({ worldStore: target.runtime.worldStore, sha256Hex: sha.sha256Hex,
      archive, newWorldId: 'with-canon', createdAt: 'now' });
    assert.equal(await hasPlayableOpening(target.runtime.worldStore, 'with-canon', source.pkg.manifest.revision), true);
  } finally { source.db.close(); target.db.close(); }
});

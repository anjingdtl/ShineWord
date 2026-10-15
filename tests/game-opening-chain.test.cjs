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

test('the canon character picker offers each character once even with unmerged duplicate entities', async () => {
  const h = await built();
  try {
    const worldId = h.imported.worldId;
    const original = (await h.runtime.worldStore.listEntities(worldId)).find(e => e.type === 'character' && e.name === '林凡');
    assert.ok(original, 'the fixture extraction publishes the named character');
    await h.runtime.worldStore.upsertEntity({ worldId, entityId: 'ent-lin-duplicate-row', type: 'character',
      name: '林凡', firstSeenChapterId: null, aliases: [] }, 'later');
    const existingFact = (await h.runtime.worldStore.listFacts(worldId))
      .find(f => f.subjectEntityId === original.entityId);
    assert.ok(existingFact && existingFact.sources.length, 'the fixture character carries a cited fact');
    const saved = await h.runtime.worldStore.saveFact({ worldId, factId: 'fact-lin-dup-location',
      subjectEntityId: 'ent-lin-duplicate-row', predicate: 'current_location', value: { location: '青石巷' },
      status: 'explicit', confidence: 1, validFrom: null, validTo: null, revealAt: null, scope: 'world',
      sources: existingFact.sources }, 'later');
    assert.equal(saved, 'inserted');
    const listEntities = h.runtime.worldStore.listEntities.bind(h.runtime.worldStore);
    h.runtime.worldStore.listEntities = async (...args) => (await listEntities(...args)).reverse();
    const setup = await session(h).getWorldSetup(worldId);
    const named = setup.canonCharacters.filter(c => c.name === '林凡');
    assert.equal(named.length, 1, 'unmerged same-name entity rows must not duplicate the playable canon picker');
    const ids = (await h.runtime.worldStore.listEntities(worldId))
      .filter(e => e.type === 'character' && e.name === '林凡').map(e => e.entityId).sort();
    assert.equal(named[0].entityId, ids[0], 'the deterministic first row by entity_id order is the one offered');
  } finally { h.db.close(); }
});

test('the canon character picker keeps same-name people with independent source evidence', async () => {
  const h = await built();
  try {
    const worldId = h.imported.worldId;
    const original = (await h.runtime.worldStore.listEntities(worldId))
      .find(e => e.type === 'character' && e.name === '林凡');
    assert.ok(original);
    const originalFact = (await h.runtime.worldStore.listFacts(worldId))
      .find(f => f.subjectEntityId === original.entityId && f.sources.length > 0);
    assert.ok(originalFact);
    const otherId = 'ent-lin-independent-person';
    await h.runtime.worldStore.upsertEntity({ worldId, entityId: otherId, type: 'character',
      name: original.name, firstSeenChapterId: null, aliases: [] }, 'later');
    const independentSources = await Promise.all(originalFact.sources.map(async source => ({ ...source,
      startOffset: source.startOffset + 500, endOffset: source.endOffset + 500,
      quoteSha256: await sha.sha256Hex(`${source.quoteSha256}:independent-person`) })));
    const saved = await h.runtime.worldStore.saveFact({ ...originalFact, worldId,
      factId: 'fact-lin-independent-person', subjectEntityId: otherId, sources: independentSources }, 'later');
    assert.equal(saved, 'inserted');

    const setup = await session(h).getWorldSetup(worldId);
    const namedIds = setup.canonCharacters.filter(c => c.name === original.name).map(c => c.entityId).sort();
    assert.deepEqual(namedIds, [original.entityId, otherId].sort(),
      'a shared display name without the same cited assertion is not enough to merge people');
  } finally { h.db.close(); }
});

test('the canon character picker preserves conflicting aliases across a duplicate-row bridge', async () => {
  const h = await built();
  try {
    const worldId = h.imported.worldId;
    const original = (await h.runtime.worldStore.listEntities(worldId))
      .find(e => e.type === 'character' && e.name === '林凡');
    assert.ok(original);
    const originalFact = (await h.runtime.worldStore.listFacts(worldId))
      .find(f => f.subjectEntityId === original.entityId && f.sources.length > 0);
    assert.ok(originalFact);
    const aliasAId = 'ent-lin-alias-a-bridge';
    const aliasBId = 'ent-lin-alias-b-conflict';
    for (const [entityId, alias] of [[aliasAId, '青岚少主'], [aliasBId, '北境行者']]) {
      await h.runtime.worldStore.upsertEntity({ worldId, entityId, type: 'character',
        name: original.name, firstSeenChapterId: null, aliases: [alias] }, 'later');
      const saved = await h.runtime.worldStore.saveFact({ ...originalFact, worldId,
        factId: `fact-${entityId}`, subjectEntityId: entityId }, 'later');
      assert.equal(saved, 'inserted');
    }

    const setup = await session(h).getWorldSetup(worldId);
    const namedIds = setup.canonCharacters.filter(c => c.name === original.name).map(c => c.entityId).sort();
    assert.deepEqual(namedIds, [aliasAId, aliasBId].sort(),
      'an unqualified duplicate row cannot bridge two entities with disjoint explicit aliases');
  } finally { h.db.close(); }
});

test('the canon character picker filters evidence beyond the selected world-time anchor', async () => {
  const h = await built();
  try {
    const worldId = h.imported.worldId;
    const original = (await h.runtime.worldStore.listEntities(worldId))
      .find(e => e.type === 'character' && e.name === '林凡');
    assert.ok(original);
    const originalFact = (await h.runtime.worldStore.listFacts(worldId))
      .find(f => f.subjectEntityId === original.entityId && f.sources.length > 0);
    assert.ok(originalFact);
    const futureId = 'ent-lin-future-only';
    await h.runtime.worldStore.upsertEntity({ worldId, entityId: futureId, type: 'character',
      name: original.name, firstSeenChapterId: null, aliases: [] }, 'later');
    const saved = await h.runtime.worldStore.saveFact({ ...originalFact, worldId,
      factId: 'fact-lin-future-only', subjectEntityId: futureId, validFrom: '2' }, 'later');
    assert.equal(saved, 'inserted');

    const setup = await session(h).getWorldSetup(worldId, 1);
    const namedIds = setup.canonCharacters.filter(c => c.name === original.name).map(c => c.entityId);
    assert.deepEqual(namedIds, [original.entityId], 'future-only identity evidence is not exposed at an earlier anchor');
  } finally { h.db.close(); }
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

test('canon opening suppresses a same-person NPC template linked through a duplicate entity row', async () => {
  const h = await built();
  try {
    const worldId = h.imported.worldId;
    const original = (await h.runtime.worldStore.listEntities(worldId))
      .find(entity => entity.type === 'character' && entity.name === '林凡');
    assert.ok(original, 'the fixture has a canon protagonist');
    const originalFact = (await h.runtime.worldStore.listFacts(worldId))
      .find(fact => fact.subjectEntityId === original.entityId && fact.sources.length > 0);
    assert.ok(originalFact, 'the original entity has visible source evidence');

    const duplicateEntityId = 'ent-lin-same-person-row';
    await h.runtime.worldStore.upsertEntity({ worldId, entityId: duplicateEntityId, type: 'character',
      name: original.name, firstSeenChapterId: null, aliases: [] }, 'later');
    await h.runtime.worldStore.saveFact({ ...originalFact, worldId, factId: 'fact-lin-same-person-row',
      subjectEntityId: duplicateEntityId }, 'later');

    const setup = await session(h).getWorldSetup(worldId);
    const hero = setup.canonCharacters.find(character => character.name === original.name);
    assert.ok(hero, 'the duplicated canon name remains selectable');
    const otherEntityId = hero.entityId === duplicateEntityId ? original.entityId : duplicateEntityId;
    const supportingFactId = otherEntityId === duplicateEntityId ? 'fact-lin-same-person-row' : originalFact.factId;
    const templateId = 'actor-template-duplicate-lin';
    const scenes = h.db.prepare(`SELECT entry_id, definition_json FROM package_entries
      WHERE world_id = ? AND revision = ? AND kind = 'scene'`).all(worldId, setup.packageRevision);
    const scene = scenes.map(row => ({ row, definition: JSON.parse(row.definition_json) }))
      .find(candidate => candidate.definition.locationId === setup.locations[0]);
    assert.ok(scene, 'the opening location has a published scene');
    scene.definition.actors = [...scene.definition.actors, templateId];
    h.db.prepare('UPDATE package_entries SET definition_json = ? WHERE world_id = ? AND revision = ? AND entry_id = ?')
      .run(JSON.stringify(scene.definition), worldId, setup.packageRevision, scene.row.entry_id);
    const definition = { name: original.name, category: 'human', description: '同一原著人物的重复模板',
      attributes: {}, skills: {}, hp: 10, stamina: 10, defense: 2, attacks: [], abilities: [],
      behavior: { goal: '旁观', retreatThreshold: 0.25, morale: 'steady' }, lootPolicy: 'none',
      threat: { damage: 1, durability: 1, actions: 1, control: 0, environment: 0 } };
    h.db.prepare(`INSERT INTO package_entries
      (world_id, revision, entry_id, kind, definition_json, provenance_json,
       field_provenance_json, visibility, dependency_ids_json, created_at)
      VALUES (?, ?, ?, 'actor_template', ?, ?, '{}', 'public', '[]', 'later')`)
      .run(worldId, setup.packageRevision, templateId, JSON.stringify(definition), JSON.stringify({
        kind: 'explicit', sourceFactIds: [supportingFactId], rationale: '回归测试中的重复人物映射。',
      }));

    const created = await createCampaign({ db: h.adapter, worldStore: h.runtime.worldStore,
      campaignId: 'canon-duplicate-person', title: '重复人物开局回归', worldId,
      packageRevision: setup.packageRevision, anchor: { worldTimeOrder: 1, locationId: setup.locations[0] },
      protagonist: { actorId: 'player', kind: 'canon', name: hero.name, canonEntityId: hero.entityId },
      goal: '观察街口', createdAt: 'later' });

    assert.equal(created.cards.filter(card => card.name === original.name).length, 1,
      'the same canon person must not be instantiated again as an NPC');
    assert.equal(created.cards.some(card => card.actorId === `npc-${templateId}`), false);
    assert.equal(created.cards[0].entityId, hero.entityId, 'the selected canonical entity remains the player binding');
  } finally { h.db.close(); }
});

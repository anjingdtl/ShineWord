'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMobileHarness, sha } = require('./helpers/mobileHarness.cjs');
const { canonicalStringify } = require('../dist/domain/turns/canonical');
const { computePackageContentHash } = require('../dist/application/worldPackage/validate');
const { createBaseContentManifest } = require('../dist/application/worldPackage/contentManifest');
const { computeSegmentArtifactHash, createSegmentArtifactManifest } = require('../dist/application/segmentPublication/protocol');
const { SqliteSegmentArtifactStore } = require('../dist/infra/sqlite/sqliteSegmentArtifactStore');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');
const { SqliteWriterStyleStore } = require('../dist/infra/sqlite/sqliteWriterStyleStore');
const { ProjectStyleService } = require('../dist/application/writerStyle/projectStyleService');
const { exportSave, restoreSave, validateSaveJson } = require('../dist/application/export/saveFile');
const { exportPortableCanon } = require('../dist/application/export/portableCanon');
const { encodeWorldPackageArchive, decodeWorldPackageArchive, importPortableWorldPackage } = require('../dist/application/export/worldPackageArchive');

const NOW = '2026-10-02T00:00:00.000Z';
const TEXT = '甲站在石桥。';
const cp = value => Array.from(value).length;
const lore = (id, facts = []) => ({ entryId: id, kind: 'lore', revision: 1,
  provenance: { kind: facts.length ? 'explicit' : 'design_fill', sourceFactIds: facts, rationale: '协议测试证据' },
  fieldProvenance: {}, visibility: 'public', dependencyIds: [], definition: { name: id, text: '石桥场景' } });
function styleOwner(h) { return new ProjectStyleService({ store: new SqliteWriterStyleStore(h.adapter), hash: sha }); }
async function fixture() {
  const h = await createMobileHarness();
  h.style = styleOwner(h);
  const entries = [lore('base-rule')], sections = [];
  const hash = await computePackageContentHash(entries, sections, sha.sha256Hex);
  const manifest = { schemaVersion: 'shineword-world-package-5', ruleConfiguration: require('../dist/application/content/runtimeRules').createWorldRuleConfiguration('portable-world', 1), worldId: 'portable-world', revision: 1,
    sourceSha256: await sha.sha256Hex('raw'), ruleset: { id: 'shineword-core', version: '0.3.0' },
    mappingVersion: 'mapping-1', status: 'published', contentHash: hash };
  const quoteHash = await sha.sha256Hex(TEXT);
  const canon = { chapters: [{ worldId: manifest.worldId, chapterId: 'chapter-1', index: 0, title: '石桥',
    startOffset: 0, endOffset: cp(TEXT), charCount: cp(TEXT), contentHash: quoteHash }],
    entities: [{ worldId: manifest.worldId, entityId: 'person-1', type: 'character', name: '甲', aliases: [],
      firstSeenChapterId: 'chapter-1', summary: '石桥上的人' }],
    facts: [{ worldId: manifest.worldId, factId: 'artifact-fact', subjectEntityId: 'person-1', predicate: 'current_location',
      value: { text: '石桥' }, status: 'explicit', confidence: 1, scope: 'world', validFrom: null, validTo: null, revealAt: null,
      sources: [{ chapterId: 'chapter-1', startOffset: 0, endOffset: cp(TEXT), quote: TEXT, quoteSha256: quoteHash }] }],
    events: [], ruleMappings: [] };
  await h.runtime.worldStore.saveImportedWorldPackage({
    world: { worldId: manifest.worldId, title: '协议测试', sourceSha256: manifest.sourceSha256, sourceBytes: 0,
      normalizeVersion: 'portable', chapterSplitVersion: 'portable', buildStatus: 'ready', createdAt: NOW, updatedAt: NOW },
    manifest, entries, sections, canon, validationJson: '{}', createdAt: NOW });
  await h.adapter.execute(`INSERT INTO campaigns
    (campaign_id, world_id, title, ruleset_id, ruleset_version, world_mapping_version, opening_json, created_at, package_revision, anchor_json, status)
    VALUES ('c', ?, '协议测试', 'shineword-core', '0.3.0', 'mapping-1', '{}', ?, 1, '{}', 'active')`, [manifest.worldId, NOW]);
  await h.adapter.execute("INSERT INTO branches(branch_id,campaign_id,state_version,created_at) VALUES ('b','c',0,?)", [NOW]);
  const range = { sourceId: 'source-1', normalizedTreeHash: quoteHash, startCp: 0, endCp: cp(TEXT), rangeContentHash: quoteHash };
  const payload = { schemaVersion: 'shineword-segment-artifact-1', validationVersion: 'segment-validation-1',
    worldId: manifest.worldId, segmentId: 'later', generation: 1,
    sourceBinding: { sourceSetHash: quoteHash, members: [{ sourceId: 'source-1', sourceOrdinal: 1, normalizedTreeHash: quoteHash }] },
    canonSnapshotHash: quoteHash, coverage: [range], basePackage: { revision: 1, contentHash: hash },
    ruleset: manifest.ruleset, mappingVersion: manifest.mappingVersion, dependencies: [], entries: [lore('artifact-lore', ['artifact-fact'])],
    sections: [], citations: [{ entryId: 'artifact-lore', field: 'provenance', sourceFactIds: ['artifact-fact'], ranges: [range] }], validation: { warnings: [] } };
  const contentHash = await computeSegmentArtifactHash(payload, sha.sha256Hex);
  const artifact = { ...payload, artifactId: `segment-artifact-${contentHash}`, contentHash, createdAt: NOW };
  const store = new SqliteSegmentArtifactStore(h.adapter, sha.sha256Hex);
  await h.adapter.transaction(tx => store.insertArtifact(tx, artifact));
  const contentManifest = createBaseContentManifest({ worldId: manifest.worldId, branchId: 'b', stateVersion: 0,
    basePackage: { revision: 1, contentHash: hash } });
  const overlay = await createSegmentArtifactManifest({ worldId: manifest.worldId, branchId: 'b', stateVersion: 0,
    legacyManifestHash: contentManifest.manifestHash, artifacts: [{ artifactId: artifact.artifactId, contentHash }] }, sha.sha256Hex);
  const view = await h.style.getProjectStyle(manifest.worldId);
  await h.style.updateProjectStyle({ projectId: manifest.worldId, expectedVersion: view.styleVersion,
    mode: 'custom', overrides: { tone: '温和', pacing: '舒缓' } });
  const styleSnapshot = await h.style.freezeEffectiveStyle({ projectId: manifest.worldId, branchId: 'b', turnId: 'frozen-1',
    sceneKind: 'dialogue', participantIds: [], tokenAllowance: 1600 });
  const binding = { manifestHash: contentManifest.manifestHash, contentVersion: 0, branchId: 'b', stateVersion: 0,
    basePackageRevision: 1, deltaIds: [], artifactIds: [artifact.artifactId], artifactManifestHash: overlay.artifactManifestHash };
  const state = { ruleConfiguration: manifest.ruleConfiguration, branchId: 'b', stateVersion: 0, clockMinutes: 0, actors: {}, itemOwners: {}, encounters: [],
    contentManifest, segmentContentBinding: binding, styleSnapshot };
  await h.adapter.execute("INSERT INTO snapshots(branch_id,state_version,snapshot_json,state_hash,created_at) VALUES ('b',0,?,NULL,?)", [JSON.stringify(state), NOW]);
  await h.adapter.execute("INSERT INTO actor_cards(branch_id,actor_id,card_json,created_at,updated_at,updated_state_version) VALUES ('b','pc',?,?,?,0)", [JSON.stringify({ actorId: 'pc', name: '旅人', controller: 'player' }), NOW, NOW]);
  await h.adapter.execute("INSERT INTO party_members(branch_id,actor_id,controller,role,joined_at) VALUES ('b','pc','player','protagonist',?)", [NOW]);
  const contract = { protocolVersion: '2.0', turnId: 'frozen-1', expectedStateVersion: 0, actorId: 'pc', actionType: 'observe',
    evidenceIds: [], requiresRoll: false, intent: '观察石桥', timeCostMinutes: 0, resourcePreconditions: [],
    outcomes: Object.fromEntries(['full_success', 'success', 'failure', 'severe_failure'].map(grade => [grade, { achieved: true, publicSummary: '观察', effects: [] }])),
    contentDependency: binding, styleSnapshot };
  const actionContractJson = canonicalStringify(contract);
  await new SqliteTurnStore(h.adapter).stageRollTurn({ branchId: 'b', turnId: contract.turnId, expectedStateVersion: 0,
    actionContractJson, actionContractHash: await sha.sha256Hex(actionContractJson), createdAt: NOW, status: 'Planned' });
  return { ...h, manifest, entries, sections, artifact, contract };
}
async function rehash(save) {
  const { manifest, ...payload } = save;
  manifest.payloadSha256 = await sha.sha256Hex(canonicalStringify(payload));
  return JSON.stringify(save);
}

test('save v7 survives independent database and a second archive/save hop with complete frozen style and artifact refs', async () => {
  const source = await fixture(), target = await createMobileHarness(), third = await createMobileHarness();
  try {
    const first = await exportSave({ db: source.adapter, sha256Hex: sha.sha256Hex, campaignId: 'c', branchId: 'b', createdAt: NOW, projectStyleArchive: source.style });
    assert.deepEqual(await validateSaveJson(first.json, sha.sha256Hex), { ok: true, errors: [] });
    const canon = await exportPortableCanon(source.runtime.worldStore, source.manifest, source.entries, sha.sha256Hex);
    const archive = await encodeWorldPackageArchive({ title: '协议测试', manifest: source.manifest, entries: source.entries, sections: source.sections,
      canon, segmentArtifacts: [source.artifact], projectStyle: first.save.projectStyle }, sha.sha256Hex);
    for (const [h, save, campaignId, branchId] of [[target, first.save, 'copy-c', 'copy-b']]) {
      h.style = styleOwner(h);
      const imported = await importPortableWorldPackage({ worldStore: h.runtime.worldStore, sha256Hex: sha.sha256Hex, archive,
        newWorldId: 'unused-remap', createdAt: NOW, projectStyleArchive: h.style });
      assert.equal(imported.worldId, source.manifest.worldId);
      await restoreSave({ db: h.adapter, save, sha256Hex: sha.sha256Hex, newCampaignId: campaignId, newBranchId: branchId, createdAt: NOW, projectStyleArchive: h.style });
    }
    const second = await exportSave({ db: target.adapter, sha256Hex: sha.sha256Hex, campaignId: 'copy-c', branchId: 'copy-b', createdAt: NOW, projectStyleArchive: target.style });
    assert.deepEqual(await validateSaveJson(second.json, sha.sha256Hex), { ok: true, errors: [] });
    third.style = styleOwner(third);
    await importPortableWorldPackage({ worldStore: third.runtime.worldStore, sha256Hex: sha.sha256Hex, archive,
      newWorldId: 'unused', createdAt: NOW, projectStyleArchive: third.style });
    await restoreSave({ db: third.adapter, save: second.save, sha256Hex: sha.sha256Hex,
      newCampaignId: 'third-c', newBranchId: 'third-b', createdAt: NOW, projectStyleArchive: third.style });
    const restored = await new SqliteTurnStore(third.adapter).getState('third-b');
    assert.equal(restored.segmentContentBinding.branchId, 'third-b');
    assert.equal(restored.segmentContentBinding.artifactManifestHash, first.save.state.segmentContentBinding.artifactManifestHash);
    assert.deepEqual(restored.styleSnapshot, first.save.state.styleSnapshot);
    assert.equal((await third.style.getProjectStyle(source.manifest.worldId)).semantic.tone, '温和');
    const staged = await new SqliteTurnStore(third.adapter).getStagedTurn('third-b', 'frozen-1');
    assert.equal(staged.actionContractJson, first.save.turns[0].actionContractJson);
    assert.equal(staged.actionContractHash, first.save.turns[0].actionContractHash);
    assert.equal(third.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { source.db.close(); target.db.close(); third.db.close(); }
});

test('rehashing a save does not waive frozen state/manifest/world/dependency checks', async () => {
  const h = await fixture();
  try {
    const exported = await exportSave({ db: h.adapter, sha256Hex: sha.sha256Hex, campaignId: 'c', branchId: 'b', createdAt: NOW });
    const mutations = [
      save => { const contract = JSON.parse(save.turns[0].actionContractJson); contract.contentDependency.artifactManifestHash = '0'.repeat(64); save.turns[0].actionContractJson = JSON.stringify(contract); },
      save => { const contract = JSON.parse(save.turns[0].actionContractJson); contract.expectedStateVersion = 1; save.turns[0].actionContractJson = JSON.stringify(contract); },
      save => { save.state.contentManifest.worldId = 'other-world'; },
      save => { save.state.segmentContentBinding.deltaIds = ['undeclared']; },
      save => { save.snapshotHistory[0].snapshot.styleSnapshot.projectId = 'other-world'; },
      save => { save.segmentArtifacts = []; },
    ];
    for (const mutate of mutations) {
      const save = structuredClone(exported.save); mutate(save);
      const result = await validateSaveJson(await rehash(save), sha.sha256Hex);
      assert.equal(result.ok, false, result.errors.join('\n'));
    }
  } finally { h.db.close(); }
});



test('archive v4 validates added artifact canon and rolls back a late owner import failure', async () => {
  const h = await fixture(), target = await createMobileHarness();
  try {
    const canon = await exportPortableCanon(h.runtime.worldStore, h.manifest, h.entries, sha.sha256Hex);
    const input = { title: '协议测试', manifest: h.manifest, entries: h.entries, sections: h.sections, canon,
      segmentArtifacts: [h.artifact], projectStyle: await h.style.exportProjectStyle(h.manifest.worldId) };
    const missing = structuredClone(canon); missing.facts = [];
    const { contentHash: _old, ...body } = missing; missing.contentHash = await sha.sha256Hex(canonicalStringify(body));
    await assert.rejects(encodeWorldPackageArchive({ ...input, canon: missing }, sha.sha256Hex), /原著资料不完整/);
    const archive = await encodeWorldPackageArchive(input, sha.sha256Hex);
    assert.equal((await decodeWorldPackageArchive(archive, sha.sha256Hex)).canon.facts[0].factId, 'artifact-fact');
    await assert.rejects(importPortableWorldPackage({ worldStore: target.runtime.worldStore, sha256Hex: sha.sha256Hex,
      archive, newWorldId: 'unused', createdAt: NOW, projectStyleArchive: {
        exportProjectStyle: async () => null, restoreProjectStyle: async () => { throw new Error('late-owner-failure'); },
      } }), /late-owner-failure/);
    for (const table of ['worlds', 'world_packages', 'package_entries', 'world_segment_artifacts', 'canon_facts']) {
      assert.equal(target.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, `${table} rolled back`);
    }
    const secret = { ...input, projectStyle: { ...input.projectStyle, authorization: 'must-never-export' } };
    await assert.rejects(encodeWorldPackageArchive(secret, sha.sha256Hex), /forbidden_key/);
  } finally { h.db.close(); target.db.close(); }
});

'use strict';
/**
 * P7-6: shineword-save-8 round-trip and save-7 compatibility.
 * - guidance travels with the save and restores with REBOUND branch identity;
 * - situation state rides snapshots and survives the hop;
 * - a v7-labeled save with phase7 content is refused explicitly;
 * - old v7 saves (no phase7 keys) still validate and import.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMobileHarness, sha } = require('./helpers/mobileHarness.cjs');
const { canonicalStringify } = require('../dist/domain/turns/canonical');
const { computePackageContentHash } = require('../dist/application/worldPackage/validate');
const { createBaseContentManifest } = require('../dist/application/worldPackage/contentManifest');
const { exportSave, restoreSave, validateSaveJson } = require('../dist/application/export/saveFile');
const { SqliteGuidanceStore } = require('../dist/infra/sqlite/sqliteGuidanceStore');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');
const { GUIDANCE_VERSION, decisionPointIdFor } = require('../dist/application/guidance/types');

const NOW = '2026-10-04T00:00:00.000Z';

const lore = (id, facts = []) => ({ entryId: id, kind: 'lore', revision: 1,
  provenance: { kind: facts.length ? 'explicit' : 'design_fill', sourceFactIds: facts, rationale: 'p7 协议测试' },
  fieldProvenance: {}, visibility: 'public', dependencyIds: [], definition: { name: id, text: '协议测试条目' } });

async function fixture() {
  const h = await createMobileHarness();
  const entries = [lore('base-rule')], sections = [];
  const hash = await computePackageContentHash(entries, sections, sha.sha256Hex);
  const manifest = { schemaVersion: 'world-package-2', worldId: 'p7-world', revision: 1,
    sourceSha256: await sha.sha256Hex('raw'), ruleset: { id: 'shineword-core', version: '0.3.0' },
    mappingVersion: 'mapping-1', status: 'published', contentHash: hash };
  await h.runtime.worldStore.saveImportedWorldPackage({
    world: { worldId: manifest.worldId, title: 'P7 存档', sourceSha256: manifest.sourceSha256, sourceBytes: 0,
      normalizeVersion: 'portable', chapterSplitVersion: 'portable', buildStatus: 'ready', createdAt: NOW, updatedAt: NOW },
    manifest, entries, sections, canon: { chapters: [], entities: [], facts: [], events: [], ruleMappings: [] },
    validationJson: '{}', createdAt: NOW });
  await h.adapter.execute(`INSERT INTO campaigns
    (campaign_id, world_id, title, ruleset_id, ruleset_version, world_mapping_version, opening_json, created_at, package_revision, anchor_json, status)
    VALUES ('c', ?, 'P7 存档', 'shineword-core', '0.3.0', 'mapping-1', '{}', ?, 1, '{}', 'active')`, [manifest.worldId, NOW]);
  await h.adapter.execute("INSERT INTO branches(branch_id,campaign_id,state_version,created_at) VALUES ('b','c',1,?)", [NOW]);
  const contentManifest = createBaseContentManifest({ worldId: manifest.worldId, branchId: 'b', stateVersion: 0,
    basePackage: { revision: 1, contentHash: hash } });
  // Snapshot carries P7 situation state + causal order (save-8 territory).
  const state = { branchId: 'b', stateVersion: 1, clockMinutes: 30, actors: {
    'pc': { actorId: 'pc', locationId: 'l1', resources: { hp: 8 }, conditions: [] },
  }, itemOwners: {}, encounters: [], contentManifest,
    situations: [{ situationId: 'sit-a', status: 'active', counters: { heat: 1 }, processedEventKeys: [],
      promises: [], suppressedEventKeys: {}, sourceTurnId: 'turn-0001', statusVersion: 1 }],
    causalWorldTimeOrder: 12 };
  await h.adapter.execute("INSERT INTO snapshots(branch_id,state_version,snapshot_json,state_hash,created_at) VALUES ('b',1,?,NULL,?)", [JSON.stringify(state), NOW]);
  await h.adapter.execute("INSERT INTO actor_cards(branch_id,actor_id,card_json,created_at,updated_at,updated_state_version) VALUES ('b','pc',?,?,?,0)", [JSON.stringify({ actorId: 'pc', name: '旅人', controller: 'player' }), NOW, NOW]);
  await h.adapter.execute("INSERT INTO party_members(branch_id,actor_id,controller,role,joined_at) VALUES ('b','pc','player','protagonist',?)", [NOW]);
  // One committed guidance row for the decision point at version 1.
  const guidanceStore = new SqliteGuidanceStore(h.adapter);
  await guidanceStore.save({
    guidanceVersion: GUIDANCE_VERSION,
    decisionPoint: {
      campaignId: 'c', branchId: 'b', playerActorId: 'pc', sourceTurnId: 'turn-0001',
      decisionPointId: decisionPointIdFor('b', 1), stateVersion: 1,
      contentBindingHash: contentManifest.manifestHash, knowledgeHash: 'k'.repeat(8), contextHash: 'x'.repeat(8),
    },
    severity: 'normal',
    situationSummary: { changes: ['局面展开了'], opportunities: ['北向有动静'], pressures: [] },
    steps: [{ source: 'local', candidateRef: 'method:sit-a:pursue', title: '查探北向', rationale: '动静尚新',
      tradeoffs: '花时间', firstStepIntent: '向北查看', actionKind: 'skill_check', availability: 'available' }],
    degraded: false,
  }, NOW);
  return { ...h, manifest, entries, sections, state };
}

async function rehash(save) {
  const { manifest, ...payload } = save;
  manifest.payloadSha256 = await sha.sha256Hex(canonicalStringify(payload));
  return JSON.stringify(save);
}

test('closeout: malformed imported guidance is rejected before it can crash the play view', async () => {
  const h = await fixture(); try {
    const exported = await exportSave({ db: h.adapter, sha256Hex: sha.sha256Hex, campaignId: 'c', branchId: 'b', createdAt: NOW });
    exported.save.guidance[0].steps = null;
    const validation = await validateSaveJson(await rehash(exported.save), sha.sha256Hex);
    assert.equal(validation.ok, false);
    assert.ok(validation.errors.some(error => error.includes('guidance steps')));
  } finally { h.db.close?.(); }
});







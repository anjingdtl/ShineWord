'use strict';
/**
 * P8-8 (plan §17-§18): shineword-save-9 is the ONLY protocol.
 * - guidance/situation state round-trip with rebound identity (the former
 *   save-8 hop, now on save-9);
 * - every historical label (save-2..8) is refused with its own reason and no
 *   converter exists — a relabeled "clean v7" file is just an unknown-schema
 *   refusal.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMobileHarness, sha } = require('./helpers/mobileHarness.cjs');
const { canonicalStringify } = require('../dist/domain/turns/canonical');
const { computePackageContentHash } = require('../dist/application/worldPackage/validate');
const { createBaseContentManifest } = require('../dist/application/worldPackage/contentManifest');
const { exportSave, restoreSave, validateSaveJson } = require('../dist/application/export/saveFile');
const { SqliteGuidanceStore } = require('../dist/infra/sqlite/sqliteGuidanceStore');
const { decisionPointIdFor, GUIDANCE_VERSION } = require('../dist/application/guidance/types');

const NOW = '2026-10-04T00:00:00.000Z';

async function fixture() {
  const h = await createMobileHarness();
  const entries = [], sections = [];
  const hash = await computePackageContentHash(entries, sections, sha.sha256Hex);
  const manifest = { schemaVersion: 'shineword-world-package-5', ruleConfiguration: require('../dist/application/content/runtimeRules').createWorldRuleConfiguration('p8-world', 1), worldId: 'p8-world', revision: 1,
    sourceSha256: await sha.sha256Hex('raw'), ruleset: { id: 'shineword-core', version: '0.4.0' },
    mappingVersion: 'mapping-1', status: 'published', contentHash: hash };
  await h.runtime.worldStore.saveImportedWorldPackage({
    world: { worldId: manifest.worldId, title: 'P8 存档', sourceSha256: manifest.sourceSha256, sourceBytes: 0,
      normalizeVersion: 'portable', chapterSplitVersion: 'portable', buildStatus: 'ready', createdAt: NOW, updatedAt: NOW },
    manifest, entries, sections, canon: { chapters: [], entities: [], facts: [], events: [], ruleMappings: [] },
    validationJson: '{}', createdAt: NOW });
  await h.adapter.execute(`INSERT INTO campaigns
    (campaign_id, world_id, title, ruleset_id, ruleset_version, world_mapping_version, opening_json, created_at, package_revision, anchor_json, status)
    VALUES ('c', ?, 'P8 存档', 'shineword-core', '0.4.0', 'mapping-1', '{}', ?, 1, '{}', 'active')`, [manifest.worldId, NOW]);
  await h.adapter.execute("INSERT INTO branches(branch_id,campaign_id,state_version,created_at) VALUES ('b','c',1,?)", [NOW]);
  const contentManifest = createBaseContentManifest({ worldId: manifest.worldId, branchId: 'b', stateVersion: 0,
    basePackage: { revision: 1, contentHash: hash } });
  // Snapshot carries P7 situation state + causal order (round-trip territory).
  const state = { ruleConfiguration: manifest.ruleConfiguration, branchId: 'b', stateVersion: 1, clockSeconds: 1800, clockMinutes: 30, actors: {
    'pc': { actorId: 'pc', locationId: 'l1', resources: { hp: 8 }, conditions: [] },
  }, itemOwners: {}, encounters: [], contentManifest,
    situations: [{ situationId: 'sit-a', status: 'active', counters: { heat: 1 }, processedEventKeys: [],
      promises: [], suppressedEventKeys: {}, sourceTurnId: 'turn-0001', statusVersion: 1 }],
    causalWorldTimeOrder: 12 };
  await h.adapter.execute("INSERT INTO snapshots(branch_id,state_version,snapshot_json,state_hash,created_at) VALUES ('b',1,?,NULL,?)", [JSON.stringify(state), NOW]);
  await h.adapter.execute("INSERT INTO actor_cards(branch_id,actor_id,card_json,created_at,updated_at,updated_state_version) VALUES ('b','pc',?,?,?,0)", [JSON.stringify({ actorId: 'pc', name: '旅人', controller: 'player' }), NOW, NOW]);
  await h.adapter.execute("INSERT INTO party_members(branch_id,actor_id,controller,role,joined_at) VALUES ('b','pc','player','protagonist',?)", [NOW]);
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

test('save-9 carries guidance and situation state through a full hop with rebound identity', async () => {
  const source = await fixture();
  const target = await createMobileHarness();
  try {
    const exported = await exportSave({ db: source.adapter, sha256Hex: sha.sha256Hex, campaignId: 'c', branchId: 'b', createdAt: NOW });
    assert.equal(exported.save.manifest.schemaVersion, 'shineword-save-10');
    assert.ok(exported.save.guidance?.length === 1, 'guidance exported');
    assert.ok(exported.save.state.situations?.length === 1, 'situation state rides the head snapshot');
    assert.deepEqual(await validateSaveJson(exported.json, sha.sha256Hex), { ok: true, errors: [] });

    await target.runtime.worldStore.saveImportedWorldPackage({
      world: { worldId: source.manifest.worldId, title: 'P8 存档', sourceSha256: source.manifest.sourceSha256, sourceBytes: 0,
        normalizeVersion: 'portable', chapterSplitVersion: 'portable', buildStatus: 'ready', createdAt: NOW, updatedAt: NOW },
      manifest: source.manifest, entries: source.entries, sections: source.sections,
      canon: { chapters: [], entities: [], facts: [], events: [], ruleMappings: [] }, validationJson: '{}', createdAt: NOW });
    await restoreSave({ db: target.adapter, sha256Hex: sha.sha256Hex, save: exported.save,
      newCampaignId: 'c2', newBranchId: 'b2', createdAt: NOW });
    const guidance = new SqliteGuidanceStore(target.adapter);
    const rows = await guidance.listAll('b2');
    assert.equal(rows.length, 1, 'guidance restored');
    assert.equal(rows[0].decisionPoint.branchId, 'b2', 'branch identity rebound');
    assert.equal(rows[0].decisionPoint.decisionPointId, 'b2:1', 'decision point rebound');
    const state = await new (require('../dist/infra/sqlite/sqliteTurnStore').SqliteTurnStore)(target.adapter).getState('b2');
    assert.equal(state?.situations?.[0]?.situationId, 'sit-a');
    assert.equal(state?.causalWorldTimeOrder, 12);
  } finally {
    source.db.close?.(); target.db.close?.();
  }
});

test('A33: every historical save label is refused with its own reason (single protocol)', async () => {
  const h = await fixture();
  try {
    const exported = await exportSave({ db: h.adapter, sha256Hex: sha.sha256Hex, campaignId: 'c', branchId: 'b', createdAt: NOW });
    for (const old of ['shineword-save-8', 'shineword-save-7', 'shineword-save-6', 'shineword-save-5', 'shineword-save-4', 'shineword-save-3', 'shineword-save-2']) {
      const relabeled = { ...exported.save, manifest: { ...exported.save.manifest, schemaVersion: old } };
      const result = await validateSaveJson(JSON.stringify(relabeled), sha.sha256Hex);
      assert.equal(result.ok, false, `${old} must be refused`);
      const shortLabel = old.replace('shineword-', '');
      assert.ok(
        result.errors.some(e => e.includes(shortLabel)),
        `${old} refusal names the version, got: ${result.errors.join(';')}`,
      );
      assert.ok(
        result.errors.some(e => /single protocol|never converted|new campaign/i.test(e)),
        `${old} refusal states the policy, got: ${result.errors.join(';')}`,
      );
    }
    const unknown = { ...exported.save, manifest: { ...exported.save.manifest, schemaVersion: 'shineword-save-99' } };
    const result = await validateSaveJson(JSON.stringify(unknown), sha.sha256Hex);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => /Unsupported schemaVersion/.test(e)));
  } finally { h.db.close?.(); }
});

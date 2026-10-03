'use strict';
const test = require('node:test');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { entityIdFor, eventIdFor, sanitizeTokenFragment } = require('../dist/application/world/extraction');
const { isSegmentArtifactV1 } = require('../dist/application/segmentPublication');

const TOKEN = /^[a-zA-Z0-9._:-]{1,256}$/;
const now = '2026-10-04T00:00:00.000Z';

class Adapter {
  constructor(db) { this.db = db; this.chain = Promise.resolve(); }
  async execute(sql, params = []) { if (!params.length && sql.includes(';')) { this.db.exec(sql); return 0; } return this.db.prepare(sql).run(...params).changes; }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  transaction(work) {
    const run = async () => { this.db.exec('BEGIN IMMEDIATE'); try { const v = await work(this); this.db.exec('COMMIT'); return v; } catch (e) { this.db.exec('ROLLBACK'); throw e; } };
    const next = this.chain.then(run, run); this.chain = next.then(() => undefined, () => undefined); return next;
  }
}

async function setup() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) db.exec(migration.sql);
  return { db, store: new SqliteWorldStore(new Adapter(db)) };
}

async function seedWorld(store, worldId, entities, facts, mappings = []) {
  await store.createWorld({ worldId, title: 't', sourceSha256: 'a'.repeat(64), sourceBytes: 1,
    normalizeVersion: 'n', chapterSplitVersion: 'c', buildStatus: 'ready', createdAt: now, updatedAt: now });
  await store.db.execute(`INSERT INTO source_chapters(world_id, chapter_id, chapter_index, title, start_offset, end_offset, char_count, content_hash, created_at)
    VALUES (?, 'ch-1', 1, '第一章', 0, 100, 100, ?, ?)`, [worldId, 'e'.repeat(64), now]);
  for (const e of entities) await store.upsertEntity(e, now);
  for (const f of facts) await store.saveFact(f, now);
  for (const m of mappings) await store.saveRuleMapping(m, now);
}

test('slug-derived ids stay inside the artifact TOKEN charset and stay deterministic', () => {
  for (const key of ['边陲镇', '温蒂 & 安娜', 'Border Town', '安娜·温布顿', 'Ångström', 'x']) {
    const id = entityIdFor('world-src-' + 'a'.repeat(8), key);
    assert.match(id, TOKEN, `entityId for ${key} must be ASCII TOKEN`);
    assert.equal(id, entityIdFor('world-src-' + 'a'.repeat(8), key), 'deterministic');
    assert.match(eventIdFor('world-src-' + 'a'.repeat(8), key), TOKEN);
  }
  // Historical ASCII slugs are unchanged so replayed extraction keeps identity.
  assert.equal(entityIdFor('w', 'Border Town'), 'ent-w-border-town');
  assert.equal(entityIdFor('w', 'Anna Wimbledon'), 'ent-w-anna-wimbledon');
  // Distinct CJK names never converge.
  assert.notEqual(entityIdFor('w', '边陲镇'), entityIdFor('w', '温蒂'));
  assert.equal(sanitizeTokenFragment('边'), 'u8fb9');
});

test('repaired legacy ids equal fresh derivation ids and non-CJK keys keep their historical ids', () => {
  // The historical slug rule (pre-ASCII fix), as it shaped legacy stored ids.
  const legacySlug = key =>
    key.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
  // A legacy CJK id renamed by normalizeNonconformingCanonIds() must equal the
  // id a replayed extraction derives for the same key, or replay would fork a
  // duplicate entity instead of upserting.
  for (const key of ['边陲镇', '温蒂 & 安娜', '安娜·温布顿', '赵 四']) {
    const legacyId = `ent-w-${legacySlug(key)}`;
    const repaired = sanitizeTokenFragment(legacyId);
    assert.equal(repaired, entityIdFor('w', key), `repair vs derivation mismatch for ${key}`);
    assert.match(repaired, TOKEN);
  }
  // Keys whose legacy slug was already conforming must derive identical ids,
  // so existing worlds replay without entity duplication.
  assert.equal(entityIdFor('w', "O'Brien"), 'ent-w-o-brien');
  assert.equal(entityIdFor('w', 'Tom & Jerry'), 'ent-w-tom-jerry');
  assert.equal(entityIdFor('w', 'Ångström'), 'ent-w-ngstr-m');
});

test('normalization renames non-conforming canon ids with references and stays idempotent', async () => {
  const { db, store } = await setup();
  const worldId = 'world-src-' + 'b'.repeat(8);
  const cjkEntityId = `ent-${worldId}-边陲镇`;
  const cjkFactId = `fact-${worldId}-边陲镇-location-mention`;
  await seedWorld(store, worldId,
    [
      { worldId, entityId: cjkEntityId, type: 'location', name: '边陲镇', firstSeenChapterId: null, aliases: [] },
      { worldId, entityId: `ent-${worldId}-border-town`, type: 'location', name: '边陲镇', firstSeenChapterId: null, aliases: [] },
    ],
    [
      { worldId, factId: cjkFactId, subjectEntityId: cjkEntityId, predicate: 'named_location',
        value: { name: '边陲镇' }, valueKey: '', status: 'explicit', confidence: 1, validFrom: null, validTo: null,
        revealAt: null, scope: 'world', sources: [{ chapterId: 'ch-1', startOffset: 0, endOffset: 3, quote: '边陲镇', quoteSha256: 'f'.repeat(64) }] },
    ],
    [
      { worldId, mappingId: `map-${worldId}-${cjkEntityId}-attribute-u8d44`, targetEntityId: cjkEntityId, mappingKind: 'attribute',
        mapping: { attribute: 'physique', rank: 1 }, evidenceRefs: [cjkFactId], rulesetVersion: 'rules-0.2.0', status: 'active' },
    ]);
  await db.prepare("INSERT INTO entity_aliases(world_id, alias_id, entity_id, alias, score, created_at) VALUES (?,?,?,?,?,?)")
    .run(worldId, `alias-${worldId}-bjxz`, cjkEntityId, '边境小镇', 1, now);

  const first = await store.normalizeNonconformingCanonIds();
  assert.equal(first.entities, 1);
  assert.equal(first.facts, 1);
  assert.equal(first.mappings, 1);

  const entity = db.prepare('SELECT entity_id FROM entities WHERE world_id = ? AND entity_id LIKE ?').get(worldId, 'ent-%u8fb9%');
  assert.ok(entity, 'renamed entity id keeps an escaped form');
  assert.match(entity.entity_id, TOKEN);
  const fact = db.prepare('SELECT fact_id, subject_entity_id FROM canon_facts WHERE world_id = ? AND fact_id LIKE ?').get(worldId, 'fact-%u8fb9%');
  assert.ok(fact); assert.match(fact.fact_id, TOKEN); assert.equal(fact.subject_entity_id, entity.entity_id);
  assert.ok(db.prepare('SELECT 1 FROM fact_sources WHERE fact_id = ?').get(fact.fact_id), 'fact_sources follows the rename');
  assert.ok(db.prepare('SELECT 1 FROM entity_aliases WHERE entity_id = ?').get(entity.entity_id), 'aliases follow the rename');
  const mapping = db.prepare('SELECT mapping_id, target_entity_id FROM world_rule_mappings WHERE world_id = ?').all(worldId)
    .find(m => m.target_entity_id === entity.entity_id);
  assert.ok(mapping); assert.match(mapping.mapping_id, TOKEN);
  // Untouched conforming rows keep their ids.
  assert.ok(db.prepare('SELECT 1 FROM entities WHERE world_id = ? AND entity_id = ?').get(worldId, `ent-${worldId}-border-town`));
  // FK integrity holds.
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  // Second run is a no-op.
  const second = await store.normalizeNonconformingCanonIds();
  assert.deepEqual(second, { entities: 0, facts: 0, mappings: 0 });
  db.close();
});

test('a segment artifact whose entries derive from a CJK-named entity passes the protocol guard', async () => {
  const { db, store } = await setup();
  const worldId = 'world-src-' + 'c'.repeat(8);
  const entityId = entityIdFor(worldId, '边陲镇');   // post-fix: escaped ASCII
  await seedWorld(store, worldId,
    [{ worldId, entityId, type: 'location', name: '边陲镇', firstSeenChapterId: null, aliases: [] }], []);
  const entryId = `scene-${entityId}`;
  const factId = `fact-${entityId}-location-mention`;
  const { SEGMENT_ARTIFACT_VERSION, SEGMENT_VALIDATION_VERSION } = require('../dist/domain/content/segmentArtifact');
  const artifact = {
    schemaVersion: SEGMENT_ARTIFACT_VERSION, worldId, segmentId: 'seg-1', generation: 1,
    sourceBinding: { sourceSetHash: 'd'.repeat(64), members: [{ sourceId: 'src-1', sourceOrdinal: 1, normalizedTreeHash: 'e'.repeat(64) }] },
    coverage: [{ sourceId: 'src-1', normalizedTreeHash: 'e'.repeat(64), startCp: 0, endCp: 10, rangeContentHash: '1'.repeat(64) }],
    canonSnapshotHash: '2'.repeat(64), validationVersion: SEGMENT_VALIDATION_VERSION,
    basePackage: { revision: 1, contentHash: '3'.repeat(64) },
    ruleset: { id: 'r', version: '1' }, mappingVersion: 'mapper-1#m#low',
    dependencies: [], entries: [{
      entryId, kind: 'scene', revision: 1,
      provenance: { kind: 'explicit', sourceFactIds: [factId], rationale: '由原著已核验的地点证据保留可选择场景。' },
      fieldProvenance: { zones: { kind: 'design_fill', sourceFactIds: [], rationale: '规则集提供可操作区域。' } },
      visibility: 'discoverable', revealPolicyId: 'segment-explicit-discovery', dependencyIds: [],
      definition: { name: '边陲镇', description: '原著地点', locationId: '边陲镇',
        zones: [{ zoneId: `zone-${entityId}`, name: '边陲镇', cover: false, exits: [] }], actors: [], visibleItems: [], hazards: [], clues: [] } }],
    sections: [{ book: 'player_handbook', sectionKey: 'locations', title: '地点与场景', entryIds: [entryId], position: 0 }],
    citations: [
      { entryId, field: 'provenance', sourceFactIds: [factId], ranges: [{ sourceId: 'src-1', normalizedTreeHash: 'e'.repeat(64), startCp: 0, endCp: 10, rangeContentHash: '1'.repeat(64) }] },
      { entryId, field: 'fieldProvenance.zones', sourceFactIds: [], ranges: [] },
    ],
    validation: { warnings: [] },
  };
  const complete = { ...artifact, artifactId: `segment-artifact-${crypto.createHash('sha256').update('a').digest('hex')}`,
    contentHash: crypto.createHash('sha256').update('b').digest('hex'), createdAt: now };
  assert.equal(isSegmentArtifactV1(complete), true, 'post-fix derived ids satisfy the guard');
  assert.equal(isSegmentArtifactV1({ ...complete,
    entries: [{ ...artifact.entries[0], entryId: 'scene-ent-\u8fb9\u9647\u9547' }],
    citations: [{ ...artifact.citations[0], entryId: 'scene-ent-\u8fb9\u9647\u9547' }],
    sections: [{ ...artifact.sections[0], entryIds: ['scene-ent-\u8fb9\u9647\u9547'] }] }), false, 'raw-CJK ids stay rejected');
  db.close();
});

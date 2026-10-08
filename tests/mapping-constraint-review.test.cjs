const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { buildPackageFromCanon } = require('../dist/application/worldPackage/buildPackageFromCanon');

const sha256Hex = text => createHash('sha256').update(text).digest('hex');
const raw = { id: 'lock', name: '锁的压制', description: '佩戴时不能施法。', enforcement: 'block_effect',
  pattern: '佩戴者无法发动巫术', provenanceKind: 'inferred', evidenceFactIds: ['fact-lock'], rationale: '由束缚物推断。' };

async function harness() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) db.exec(migration.sql);
  const adapter = {
    async execute(sql, p = []) { return db.prepare(sql).run(...p).changes; },
    async queryOne(sql, p = []) { return db.prepare(sql).get(...p) ?? null; },
    async queryAll(sql, p = []) { return db.prepare(sql).all(...p); },
    async transaction(work) {
      db.exec('BEGIN IMMEDIATE');
      try { const value = await work(this); db.exec('COMMIT'); return value; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
  const store = new SqliteWorldStore(adapter);
  for (const worldId of ['world', 'other']) {
    await store.createWorld({ worldId, title: worldId, sourceSha256: 'a'.repeat(64), sourceBytes: 10,
      normalizeVersion: 'n', chapterSplitVersion: 'c', buildStatus: 'ready', createdAt: 't', updatedAt: 't' });
    await store.upsertEntity({ worldId, entityId: 'lock', type: 'item', name: '锁', aliases: [], firstSeenChapterId: null }, 't');
    await store.saveFact({ worldId, factId: 'fact-lock', subjectEntityId: 'lock', predicate: 'appearance',
      value: { text: '铁链上挂着坠子。' }, status: 'explicit', confidence: .9, validFrom: null, validTo: null,
      revealAt: null, scope: 'canon', sources: [] }, 't');
  }
  let calls = 0;
  const build = (worldId = 'world', proposal = raw, version = 'test-mapper') => buildPackageFromCanon({
    worldStore: store, worldId, sha256Hex, sourceSha256: 'a'.repeat(64), mappingVersion: version, createdAt: 't',
    provider: { async complete() { calls++; return { text: JSON.stringify({ skills: [], constraints: [proposal], lore: [] }) }; } },
  });
  const issue = async (worldId = 'world') => (await store.listReviewIssues(worldId)).find(i => i.kind === 'mapping_constraint');
  return { db, store, build, issue, calls: () => calls };
}

test('unsupported mapped constraint requires rejection; cached recompile excludes it without changing paid result or canon', async () => {
  const h = await harness();
  try {
    await assert.rejects(h.build(), /unresolved blocking/);
    const issue = await h.issue(); assert.ok(issue, 'review carries the proposal rather than a downgrade message');
    const detail = JSON.parse(issue.detailJson);
    assert.deepEqual(detail.proposal, raw);
    assert.equal(detail.evidence[0].fact.value.text, '铁链上挂着坠子。');
    const before = h.db.prepare("SELECT result_json FROM world_jobs WHERE kind='rule_mapping'").all();
    const facts = await h.store.listFacts('world');
    await assert.rejects(h.store.resolveReviewIssue('world', issue.issueId, 'waived'), /拒绝/);
    await h.store.rejectMappingConstraint('world', issue.issueId, issue.detailJson);
    const result = await h.build();
    assert.equal(result.manifest.status, 'published');
    assert.equal(h.calls(), 1, 'complete paid checkpoint is reused');
    assert.equal(result.entries.some(e => e.kind === 'constraint'), false);
    assert.equal(result.sections.some(s => s.entryIds.includes('constraint-lock')), false);
    assert.deepEqual(h.db.prepare("SELECT result_json FROM world_jobs WHERE kind='rule_mapping'").all(), before);
    assert.deepEqual(await h.store.listFacts('world'), facts);
    assert.equal((await h.store.listReviewIssues('world')).length, 0);
    const published = await h.store.getWorldPackage('world', 1);
    await h.build();
    assert.deepEqual(await h.store.getWorldPackage('world', 1), published, 'later publication preserves old revision');
    assert.equal(h.calls(), 1);
  } finally { h.db.close(); }
});

test('rejection is bound to full proposal and world, including a same-id definition change', async () => {
  const h = await harness();
  try {
    await assert.rejects(h.build(), /unresolved blocking/);
    const old = await h.issue();
    await h.store.rejectMappingConstraint('world', old.issueId, old.detailJson);
    await assert.rejects(h.build('other'), /unresolved blocking/);
    assert.ok(await h.issue('other'));
    await assert.rejects(h.build('world', { ...raw, description: '改成持续伤害。' }, 'mapper-new'), /unresolved blocking/);
    const changed = await h.issue();
    assert.notEqual(changed.issueId, old.issueId);
    assert.equal(JSON.parse(changed.detailJson).proposal.description, '改成持续伤害。');
    await assert.rejects(h.store.rejectMappingConstraint('world', changed.issueId, old.detailJson), /变化|刷新/);
    assert.equal((await h.issue()).status, 'open');
  } finally { h.db.close(); }
});

test('changed source evidence rejects stale UI decisions and reopens cached proposal after a previous rejection', async () => {
  const h = await harness();
  try {
    await assert.rejects(h.build(), /unresolved blocking/);
    const old = await h.issue();
    h.db.prepare("UPDATE canon_facts SET value_json=? WHERE world_id='world' AND fact_id='fact-lock'").run(JSON.stringify({ text: '证据更新。' }));
    await assert.rejects(h.store.rejectMappingConstraint('world', old.issueId, old.detailJson), /证据.*变化|刷新/);
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM review_resolution_policies').get().n, 0);
    await assert.rejects(h.build(), /unresolved blocking/);
    const fresh = await h.issue();
    assert.notEqual(fresh.issueId, old.issueId);
    await h.store.rejectMappingConstraint('world', fresh.issueId, fresh.detailJson);
    await h.build();
    h.db.prepare("UPDATE canon_facts SET status='inference' WHERE world_id='world' AND fact_id='fact-lock'").run();
    await assert.rejects(h.build(), /unresolved blocking/);
    assert.ok(await h.issue());
    assert.equal(h.calls(), 2, 'value changes invalidate mapping input; status changes still reopen review even when the raw proposal is cached');
  } finally { h.db.close(); }
});

test('retiring a previous notice is not a human rejection, while supported audit constraints need no special decision', async () => {
  const h = await harness();
  try {
    await assert.rejects(h.build(), /unresolved blocking/);
    await h.store.resolveReviewIssuesByPrefix('world', ['mapping-constraint']);
    await assert.rejects(h.build(), /unresolved blocking/);
    assert.ok(await h.issue());
    const result = await h.build('other', { ...raw, enforcement: 'audit' });
    assert.equal(result.entries.find(e => e.kind === 'constraint').definition.enforcement, 'audit');
    assert.equal((await h.store.listReviewIssues('other')).length, 0);
    await assert.rejects(h.store.rejectMappingConstraint('world', 'missing', '{}'), /变化|刷新/);
  } finally { h.db.close(); }
});

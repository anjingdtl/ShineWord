const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { buildPackageFromCanon } = require('../dist/application/worldPackage/buildPackageFromCanon');

const sha = {
  sha256Hex: input => createHash('sha256').update(input, 'utf8').digest('hex'),
};

class NodeSqliteAdapter {
  constructor(db) {
    this.db = db;
    this.chain = Promise.resolve();
  }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params) ?? []; }
  transaction(work) {
    const run = () => {
      this.db.exec('BEGIN IMMEDIATE');
      return work(this).then(
        value => { this.db.exec('COMMIT'); return value; },
        error => { this.db.exec('ROLLBACK'); throw error; },
      );
    };
    const next = this.chain.then(run, run);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }
}

function setupDb() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) db.exec(statement);
  }
  return db;
}

function makeWorldStore() {
  const db = setupDb();
  const worldStore = new SqliteWorldStore(new NodeSqliteAdapter(db));
  return { db, worldStore };
}

async function seedWorld(worldStore, worldId = 'w-build') {
  await worldStore.createWorld({
    worldId, title: '测试世界', sourceSha256: 'b'.repeat(64), sourceBytes: 1,
    normalizeVersion: 'n', chapterSplitVersion: 'c', buildStatus: 'ready',
    createdAt: 't', updatedAt: 't',
  });
}

function makeFact(worldId, factId, subjectEntityId, predicate, value, status = 'explicit') {
  return {
    worldId, factId, subjectEntityId, predicate, value, status,
    confidence: 0.9, validFrom: null, validTo: null, revealAt: null,
    scope: 'canon', sources: [],
  };
}

function fakeProvider(payload, usage = { inputTokens: 120, outputTokens: 340, estimated: false }) {
  const calls = [];
  return {
    calls,
    async complete(request) {
      calls.push(request);
      assert.equal(request.role, 'WorldMapper', 'mapping must use the WorldMapper role');
      assert.equal(request.jsonMode, true, 'mapping must request JSON mode');
      return { text: typeof payload === 'string' ? payload : JSON.stringify(payload), usage };
    },
  };
}

async function build(worldStore, provider, worldId = 'w-build') {
  const phases = [];
  const result = await buildPackageFromCanon({
    worldStore,
    provider,
    sha256Hex: sha.sha256Hex,
    worldId,
    sourceSha256: 'b'.repeat(64),
    mappingVersion: 'p2-4-mapping-1',
    createdAt: 't',
    onProgress: info => phases.push(info.phase),
  });
  return { result, phases };
}

const VALID_PROPOSAL = {
  skills: [{
    id: 'swim', name: '凫水', description: '水中行动', attribute: 'agility',
    allowUntrained: true, requirements: [], powerTier: 'ordinary',
    provenanceKind: 'explicit', evidenceFactIds: ['fact-0'], rationale: '原著提到擅长水性。',
  }],
  constraints: [{
    id: 'no-flying', name: '凡人不能飞', description: '世界无飞行能力。',
    enforcement: 'block_action', provenanceKind: 'inferred',
    evidenceFactIds: ['fact-0'], rationale: '原著为低武世界。',
  }],
  actorTemplates: [{
    id: 'night-watch', name: '夜巡守卫', category: 'human', description: '夜巡守卫。',
    attributes: { agility: 1 }, skills: { sword: 'trained' }, hp: 5, stamina: 3, defense: 2,
    attacks: [{ name: '佩刀', skillId: 'sword', damage: 2, range: 'touch' }], abilities: [],
    behavior: { goal: '守住门廊', retreatThreshold: 0.2, morale: 'steady' },
    lootPolicy: '战败后交出门禁牌', lootItemIds: ['seal'],
    threat: { damage: 2, durability: 1, actions: 1, control: 0, environment: 0 },
    provenanceKind: 'rule_mapping', evidenceFactIds: ['fact-0'], rationale: '由门廊守卫事实映射。',
  }],
  items: [{
    id: 'seal', name: '门禁牌', description: '守卫持有的门禁牌。', category: 'key', unique: true,
    provenanceKind: 'explicit', evidenceFactIds: ['fact-0'], rationale: '原著提到门禁牌。',
  }],
  lore: [{
    id: 'qinglan-sect', name: '青岚派', title: '青岚派', text: '青岚派是正道门派。',
    provenanceKind: 'explicit', evidenceFactIds: ['fact-0'], rationale: '原著门派设定。',
  }],
};

// ---------------------------------------------------------------------------
// Happy path: valid LLM proposals publish with correct provenance and books
// ---------------------------------------------------------------------------

test('P2-4: valid LLM mapping publishes; provenance, defaults and three books are consistent', async () => {
  const { worldStore } = makeWorldStore();
  await seedWorld(worldStore);
  await worldStore.upsertEntity({
    worldId: 'w-build', entityId: 'chen', type: 'character', name: '陈青云',
    firstSeenChapterId: null, aliases: [],
  }, 't');
  await worldStore.saveFact(makeFact('w-build', 'fact-0', 'chen', 'faction_member', { faction: '青岚派' }), 't');

  const provider = fakeProvider(VALID_PROPOSAL);
  const { result, phases } = await build(worldStore, provider);

  assert.equal(result.manifest.status, 'published');
  assert.equal(result.manifest.revision, 1);
  assert.equal(result.manifest.mappingVersion, 'p2-4-mapping-1');
  assert.equal(result.reviewIssues, 0);
  assert.deepEqual(result.mappingUsage, { inputTokens: 120, outputTokens: 340, estimated: false });
  assert.ok(phases.includes('load') && phases.includes('mapping') && phases.includes('publish'));

  const byId = new Map(result.entries.map(entry => [entry.entryId, entry]));

  // LLM skill keeps its proposal provenance and evidence.
  const swim = byId.get('skill-swim');
  assert.ok(swim, 'LLM-proposed skill enters the package');
  assert.equal(swim.provenance.kind, 'explicit');
  assert.deepEqual([...swim.provenance.sourceFactIds], ['fact-0']);
  assert.equal(swim.definition.attribute, 'agility');
  assert.equal(swim.definition.allowUntrained, true);

  // Missing baseline skills are deterministically filled as design_fill.
  const stealth = byId.get('skill-stealth');
  assert.ok(stealth, 'baseline stealth filled');
  assert.equal(stealth.provenance.kind, 'design_fill');
  assert.equal(stealth.provenance.rationale, '设计补全：可玩性所需的世界默认值。');
  assert.equal(stealth.definition.name, '潜行');
  assert.equal(stealth.definition.allowUntrained, false);
  const skillEntries = result.entries.filter(entry => entry.kind === 'skill');
  assert.equal(skillEntries.length, 9, '1 LLM skill + 8 baseline defaults');

  // Encounter fallback template is always present.
  const guard = byId.get('common-guard-template');
  assert.ok(guard, 'fallback guard template present');
  assert.equal(guard.provenance.kind, 'design_fill');
  assert.equal(guard.definition.hp, 6);
  assert.equal(guard.definition.defense, 2);
  assert.ok(guard.dependencyIds.includes('skill-sword'), 'guard attack references the baseline sword skill');
  const mappedGuard = byId.get('npc-night-watch');
  assert.deepEqual(mappedGuard.definition.lootItemIds, ['item-seal'], 'mapped loot ids normalize to package item entry ids');
  assert.ok(mappedGuard.dependencyIds.includes('item-seal'), 'loot item is a validated world-package dependency');
  assert.equal(byId.get('item-seal').definition.unique, true, 'the mapped reward retains its one-time identity');

  // Constraint + lore flow into the right books; every reference resolves.
  const entryIds = new Set(result.entries.map(entry => entry.entryId));
  for (const section of result.sections) {
    assert.ok(section.entryIds.length > 0, `section ${section.book}/${section.sectionKey} is non-empty`);
    for (const entryId of section.entryIds) {
      assert.ok(entryIds.has(entryId), `section references existing entry ${entryId}`);
    }
  }
  const positions = new Map();
  for (const section of result.sections) {
    const last = positions.get(section.book);
    if (last !== undefined) assert.ok(section.position > last, 'positions increase within a book');
    positions.set(section.book, section.position);
  }
  const bookSections = book => result.sections.filter(section => section.book === book);
  assert.ok(bookSections('player_handbook').some(section =>
    section.sectionKey === 'skills' && section.entryIds.includes('skill-swim')), 'player handbook lists skills');
  assert.ok(bookSections('player_handbook').some(section =>
    section.sectionKey === 'world' && section.entryIds.includes('lore-qinglan-sect')), 'player handbook lists world lore');
  assert.ok(bookSections('player_handbook').some(section =>
    section.sectionKey === 'constraints' && section.entryIds.includes('constraint-no-flying')), 'player handbook lists constraints');
  assert.ok(bookSections('gm_guide').some(section =>
    section.sectionKey === 'review' && section.entryIds.includes('lore-review-summary')), 'gm guide carries review summary');
  assert.ok(bookSections('monster_manual').some(section =>
    section.entryIds.includes('common-guard-template')), 'monster manual lists templates');

  // The published revision in the store matches what was returned.
  const stored = await worldStore.getWorldPackage('w-build', 1);
  assert.equal(stored.entries.length, result.entries.length);
});

// ---------------------------------------------------------------------------
// Invalid proposals are rejected into the review queue, never published
// ---------------------------------------------------------------------------

test('P2-4: LLM proposal with an invalid attribute is rejected as a major review issue', async () => {
  const { worldStore } = makeWorldStore();
  await seedWorld(worldStore);
  await worldStore.upsertEntity({ worldId: 'w-build', entityId: 'chen', type: 'character', name: '陈青云', firstSeenChapterId: null, aliases: [] }, 't');
  await worldStore.saveFact(makeFact('w-build', 'fact-0', 'chen', 'trait', { note: '测试事实' }), 't');
  const provider = fakeProvider({
    skills: [
      { id: 'flying', name: '飞行', attribute: 'magic', allowUntrained: true, powerTier: 'supernatural', provenanceKind: 'explicit', evidenceFactIds: [], rationale: '越界提案。' },
      { id: 'swim', name: '凫水', attribute: 'agility', allowUntrained: true, powerTier: 'ordinary', provenanceKind: 'explicit', evidenceFactIds: ['fact-0'], rationale: '合法提案。' },
    ],
  });
  const { result } = await build(worldStore, provider);

  assert.equal(result.manifest.status, 'published', 'package still publishes without the bad entry');
  assert.equal(result.reviewIssues, 1);
  const byId = new Map(result.entries.map(entry => [entry.entryId, entry]));
  assert.ok(!byId.has('skill-flying'), 'invalid proposal does not enter the package');
  assert.ok(byId.has('skill-swim'), 'valid sibling proposal survives');

  const issues = await worldStore.listReviewIssues('w-build', 'open');
  const invalid = issues.filter(issue => issue.kind === 'invalid_proposal');
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].severity, 'major');
  const detail = JSON.parse(invalid[0].detailJson);
  assert.equal(detail.kind, 'skill');
  assert.equal(detail.id, 'flying');
});

// ---------------------------------------------------------------------------
// Malformed LLM output refuses publication entirely (G04: a generic default
// package must never masquerade as this novel's complete three books)
// ---------------------------------------------------------------------------

test('P2-4/G04: malformed LLM JSON refuses publication without a human review issue', async () => {
  const { worldStore } = makeWorldStore();
  await seedWorld(worldStore);
  await worldStore.upsertEntity({ worldId: 'w-build', entityId: 'chen', type: 'character', name: '陈青云', firstSeenChapterId: null, aliases: [] }, 't');
  await worldStore.saveFact(makeFact('w-build', 'fact-0', 'chen', 'trait', { note: '测试事实' }), 't');
  const provider = fakeProvider('这不是JSON，模型跑神了');

  await assert.rejects(
    () => build(worldStore, provider),
    /映射失败，未发布任何版本/,
    'mapping failure never publishes a package',
  );
  const issues = await worldStore.listReviewIssues('w-build', 'open');
  const failed = issues.filter(issue => issue.kind === 'mapping_failed');
  assert.equal(failed.length, 0, 'engineering recovery is owned by the background executor');
  const packages = await worldStore.listWorldPackages('w-build');
  assert.equal(packages.length, 0, 'no revision was created');
  assert.equal(await worldStore.getPublishedPackageRevision('w-build'), null,
    'nothing is openable as a published world');
});

test('P2-4/G04: structurally wrong LLM object (no proposal arrays) also refuses', async () => {
  const { worldStore } = makeWorldStore();
  await seedWorld(worldStore);
  await worldStore.upsertEntity({ worldId: 'w-build', entityId: 'chen', type: 'character', name: '陈青云', firstSeenChapterId: null, aliases: [] }, 't');
  await worldStore.saveFact(makeFact('w-build', 'fact-0', 'chen', 'trait', { note: '测试事实' }), 't');
  const provider = fakeProvider({ foo: 1, bar: 'not arrays' });

  await assert.rejects(() => build(worldStore, provider), /映射失败，未发布任何版本/);
  const issues = await worldStore.listReviewIssues('w-build', 'open');
  assert.equal(issues.length, 0, 'invalid model output never asks a human to waive publication');
  assert.equal((await worldStore.listWorldPackages('w-build')).length, 0);
});

// ---------------------------------------------------------------------------
// Real facts fixture: evidence ids must point at stored facts
// ---------------------------------------------------------------------------

test('P2-4: fixture facts build a package whose evidence ids all resolve', async () => {
  const { worldStore } = makeWorldStore();
  await seedWorld(worldStore);

  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'facts-small.json'), 'utf8'));
  const characters = [...new Set(fixture.facts.map(fact => fact.subject))];
  for (const name of characters) {
    await worldStore.upsertEntity({
      worldId: 'w-build', entityId: `ent-${name}`, type: 'character', name,
      firstSeenChapterId: null, aliases: [],
    }, 't');
  }
  const storedFactIds = new Set();
  for (let i = 0; i < fixture.facts.length; i += 1) {
    const raw = fixture.facts[i];
    const fact = makeFact('w-build', `fact-${i}`, `ent-${raw.subject}`, raw.predicate, raw.value);
    const outcome = await worldStore.saveFact(fact, 't');
    if (outcome !== 'duplicate') storedFactIds.add(fact.factId);
  }
  assert.ok(storedFactIds.has('fact-0') && storedFactIds.has('fact-3'), 'fixture facts seeded');

  // Proposals cite fixture fact ids: fact-3 is 陈青云 skill 剑术, fact-7 owns 青锋剑.
  const provider = fakeProvider({
    skills: [{
      id: 'sword', name: '剑术', description: '原著剑术', attribute: 'agility',
      allowUntrained: false, requirements: [], powerTier: 'ordinary',
      provenanceKind: 'explicit', evidenceFactIds: ['fact-3'], rationale: '陈青云擅长剑术。',
    }],
    items: [{
      id: 'qingfeng-jian', name: '青锋剑', description: '陈青云的佩剑。', category: 'weapon',
      weaponSkillId: 'sword', weaponBonusDice: 1, unique: false,
      provenanceKind: 'explicit', evidenceFactIds: ['fact-7'], rationale: '陈青云持有青锋剑。',
    }],
  });
  const { result } = await build(worldStore, provider);

  assert.equal(result.manifest.status, 'published');
  const byId = new Map(result.entries.map(entry => [entry.entryId, entry]));

  // The LLM sword proposal wins over the design_fill default.
  const sword = byId.get('skill-sword');
  assert.ok(sword, 'sword skill present');
  assert.equal(sword.provenance.kind, 'explicit');
  assert.deepEqual([...sword.provenance.sourceFactIds], ['fact-3']);
  const defaults = result.entries.filter(entry =>
    entry.kind === 'skill' && entry.provenance.kind === 'design_fill');
  assert.equal(defaults.length, 7, 'sword came from the LLM so only 7 defaults remain');

  const item = byId.get('item-qingfeng-jian');
  assert.ok(item, 'fixture item present');
  assert.deepEqual([...item.dependencyIds], ['skill-sword'], 'weapon dependency resolves to the package skill');

  // Every evidence fact id on every entry points at a stored fact.
  for (const entry of result.entries) {
    for (const factId of entry.provenance.sourceFactIds) {
      assert.ok(storedFactIds.has(factId), `${entry.entryId} cites stored fact ${factId}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Canon conflicts block publication through the review queue
// ---------------------------------------------------------------------------

test('P2-4: conflict facts produce a blocking canon_conflict issue that stops publication', async () => {
  const { worldStore } = makeWorldStore();
  await seedWorld(worldStore);
  await worldStore.upsertEntity({
    worldId: 'w-build', entityId: 'chen', type: 'character', name: '陈青云',
    firstSeenChapterId: null, aliases: [],
  }, 't');

  await worldStore.saveFact(makeFact('w-build', 'fact-0', 'chen', 'trait', { note: '测试事实' }), 't');
  const first = makeFact('w-build', 'fact-home-1', 'chen', 'home_location', { location: '青云院' });
  const second = makeFact('w-build', 'fact-home-2', 'chen', 'home_location', { location: '凌云阁' });
  await worldStore.saveFact(first, 't');
  assert.equal(await worldStore.saveFact(second, 't'), 'conflict', 'conflicting home locations stored as conflict');

  const provider = fakeProvider(VALID_PROPOSAL);
  await assert.rejects(
    () => build(worldStore, provider),
    /blocking conflict/,
    'canon conflicts prevent publication',
  );
  assert.equal(provider.calls.length, 0, 'known conflicts never spend a mapping request');
  assert.equal(await worldStore.getPublishedPackageRevision('w-build'), null);
  assert.equal((await worldStore.listFacts('w-build')).length, 3, 'extracted canon remains recoverable');

  const issues = await worldStore.listReviewIssues('w-build', 'open');
  const conflicts = issues.filter(issue => issue.kind === 'canon_conflict');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].severity, 'blocking');
  const detail = JSON.parse(conflicts[0].detailJson);
  assert.ok(detail.factIds.includes('fact-home-2'), 'detail lists the conflicting fact id');
});

test('closeout: actual conflict then resolution retires the blocker and allows mapping', async () => {
  const { db, worldStore } = makeWorldStore();
  await seedWorld(worldStore);
  await worldStore.upsertEntity({ worldId: 'w-build', entityId: 'chen', type: 'character', name: '陈青云', firstSeenChapterId: null, aliases: [] }, 't');
  await worldStore.saveFact(makeFact('w-build', 'fact-0', 'chen', 'trait', { note: '测试事实' }), 't');
  await worldStore.saveFact(makeFact('w-build', 'home-1', 'chen', 'home_location', { location: '甲' }), 't');
  await worldStore.saveFact(makeFact('w-build', 'home-2', 'chen', 'home_location', { location: '乙' }), 't');
  const provider = fakeProvider(VALID_PROPOSAL);
  await assert.rejects(() => build(worldStore, provider), /blocking conflict/);
  assert.equal(provider.calls.length, 0);
  await assert.rejects(() => worldStore.resolveReviewIssue('w-build', 'canon-conflict', 'waived'), /逐条核对/);
  await assert.rejects(() => worldStore.resolveCanonFactConflict('w-build', 'home-2', 'complementary'), /缺少原文证据/);
  await worldStore.resolveCanonFactConflict('w-build', 'home-2', 'unverified');
  assert.equal((await worldStore.listFacts('w-build')).find(f => f.factId === 'home-2').status, 'speculation');
  const audit = (await worldStore.listReviewIssues('w-build', 'all')).find(i => i.kind === 'canon_resolution');
  assert.equal(JSON.parse(audit.detailJson).resolution, 'unverified');
  const { result } = await build(worldStore, provider);
  assert.equal(provider.calls.length, 1);
  assert.equal(result.manifest.status, 'published');
  const issue = (await worldStore.listReviewIssues('w-build', 'all')).find(i => i.issueId === 'canon-conflict');
  assert.equal(issue.status, 'resolved');
  db.close();
});

// ---------------------------------------------------------------------------
// Review-gate regressions: a build notice must never outlive the condition it
// describes, and re-recording one must reopen it (found in the live GLM run:
// a transient network failure blocked every later successful retry forever).
// ---------------------------------------------------------------------------

test('review gate: re-recording an issue reopens it, so a waiver cannot disarm the gate permanently', async () => {
  const { worldStore } = makeWorldStore();
  await seedWorld(worldStore);
  const issue = {
    worldId: 'w-build', issueId: 'mapping-failed', kind: 'mapping_failed',
    severity: 'blocking', detailJson: '{"reason":"第一次失败"}', createdAt: 't',
  };
  await worldStore.saveReviewIssue(issue);
  assert.equal((await worldStore.listReviewIssues('w-build', 'open')).length, 1);

  await worldStore.resolveReviewIssue('w-build', 'mapping-failed', 'waived');
  assert.equal((await worldStore.listReviewIssues('w-build', 'open')).length, 0,
    'a waived issue leaves the open set');

  await worldStore.saveReviewIssue({ ...issue, detailJson: '{"reason":"第二次失败"}' });
  const reopened = await worldStore.listReviewIssues('w-build', 'open');
  assert.equal(reopened.length, 1, 'recording the same condition again reopens it');
  assert.equal(reopened[0].severity, 'blocking');
  assert.equal(JSON.parse(reopened[0].detailJson).reason, '第二次失败', 'detail is refreshed');
});

test('review gate: a successful retry retires the stale mapping-failed blocker and publishes', async () => {
  const { worldStore } = makeWorldStore();
  await seedWorld(worldStore);
  await worldStore.upsertEntity({ worldId: 'w-build', entityId: 'chen', type: 'character', name: '陈青云', firstSeenChapterId: null, aliases: [] }, 't');
  await worldStore.saveFact(makeFact('w-build', 'fact-0', 'chen', 'trait', { note: '测试事实' }), 't');

  // Attempt 1: the model returns garbage (or the network dies).
  await assert.rejects(() => build(worldStore, fakeProvider('这不是JSON，模型跑神了')), /映射失败，未发布任何版本/);
  const afterFailure = await worldStore.listReviewIssues('w-build', 'open');
  assert.equal(afterFailure.length, 0, 'technical mapping failures do not enter review');
  // An upgraded installation may still have the notice from the old version.
  await worldStore.saveReviewIssue({ worldId: 'w-build', issueId: 'mapping-failed', kind: 'mapping_failed',
    severity: 'blocking', detailJson: '{"reason":"legacy failure"}', createdAt: 't' });

  // Attempt 2: the same retry that the UI offers ("重新构建将从已完成的进度续建").
  // The old notice describes a condition that no longer holds, so it must not
  // keep refusing publication with a message the user cannot act on.
  const { result } = await build(worldStore, fakeProvider(VALID_PROPOSAL));
  assert.equal(result.manifest.status, 'published', 'the retry publishes instead of dead-ending');
  const afterSuccess = await worldStore.listReviewIssues('w-build', 'open');
  assert.ok(!afterSuccess.some(issue => issue.issueId === 'mapping-failed'), 'stale blocker retired');
});

test('review strategies apply to identical payloads across issue ids, but changed content/severity reopens', async () => {
  const { db, worldStore } = makeWorldStore();
  try {
    await seedWorld(worldStore);
    const issue = { worldId: 'w-build', issueId: 'invalid-1', kind: 'invalid_proposal', severity: 'major',
      detailJson: '{"id":"skill-a","reasons":["unknown enum"]}', createdAt: 't' };
    await worldStore.saveReviewIssue(issue);
    await worldStore.resolveReviewIssue('w-build', issue.issueId, 'waived');
    await worldStore.saveReviewIssue({ ...issue, issueId: 'invalid-2', detailJson: '{"reasons":["unknown enum"],"id":"skill-a"}' });
    assert.equal((await worldStore.listReviewIssues('w-build', 'open')).length, 0);
    assert.equal((await worldStore.listReviewIssues('w-build', 'all')).find(i => i.issueId === 'invalid-2').status, 'waived');
    await worldStore.saveReviewIssue({ ...issue, issueId: 'invalid-3', severity: 'blocking' });
    await worldStore.saveReviewIssue({ ...issue, issueId: 'invalid-4', detailJson: '{"id":"skill-b","reasons":["unknown enum"]}' });
    assert.equal((await worldStore.listReviewIssues('w-build', 'open')).length, 2);
    await worldStore.resolveReviewIssue('w-build', 'invalid-4', 'resolved', false);
    await worldStore.saveReviewIssue({ ...issue, issueId: 'invalid-4', detailJson: '{"id":"skill-b","reasons":["unknown enum"]}' });
    assert.equal((await worldStore.listReviewIssues('w-build', 'open')).length, 2, 'one-time resolution is not reusable');
  } finally { db.close(); }
});

test('mapper automatically expands budget, splits truncated batches, and resumes actual proposals', async () => {
  const { db, worldStore } = makeWorldStore();
  try {
    await seedWorld(worldStore);
    await worldStore.upsertEntity({ worldId: 'w-build', entityId: 'chen', type: 'character', name: '陈青云', firstSeenChapterId: null, aliases: [] }, 't');
    for (let i = 0; i < 4; i++) await worldStore.saveFact(makeFact('w-build', `fact-${i}`, 'chen', `trait-${i}`, { note: `事实${i}` }), 't');
    const calls = [];
    let failedOnce = false;
    const provider = { async complete(request) {
      const facts = JSON.parse(request.user).facts;
      calls.push({ ...request, ids: facts.map(f => f.factId) });
      if (facts.length > 2) return { text: '{"skills":[' };
      if (facts[0].factId === 'fact-2' && !failedOnce) { failedOnce = true; throw new Error('network offline'); }
      return { text: JSON.stringify({ skills: [], lore: facts.map(f => ({ id: f.factId,
        name: f.factId, title: f.factId, text: f.value.note, evidenceFactIds: [f.factId], provenanceKind: 'explicit', rationale: '原著证据' })) }) };
    } };
    await assert.rejects(() => build(worldStore, provider), /network offline/);
    assert.equal(calls.length, 4);
    assert.ok(calls[1].maxOutputTokens > calls[0].maxOutputTokens);
    assert.equal(calls[1].reserveMultiplier, 1.5);
    const priorCalls = calls.length;
    const { result } = await build(worldStore, provider);
    assert.equal(calls.length - priorCalls, 1, 'parent split and completed left child are restored');
    for (let i = 0; i < 4; i++) assert.ok(result.entries.some(e => e.provenance.sourceFactIds.includes(`fact-${i}`)), `fact-${i} proposal restored`);
    assert.equal(result.manifest.status, 'published');
    assert.equal((await worldStore.listReviewIssues('w-build', 'open')).length, 0);
  } finally { db.close(); }
});

test('reasoning-only mapper retry increases reserves and can finish without manual review', async () => {
  const { db, worldStore } = makeWorldStore();
  try {
    await seedWorld(worldStore);
    await worldStore.upsertEntity({ worldId: 'w-build', entityId: 'chen', type: 'character', name: '陈青云', firstSeenChapterId: null, aliases: [] }, 't');
    await worldStore.saveFact(makeFact('w-build', 'fact-0', 'chen', 'trait', { note: '事实' }), 't');
    const calls = [];
    const { result } = await build(worldStore, { async complete(request) {
      calls.push(request);
      if (calls.length === 1) throw new Error('模型只输出了思维链，未产生正文（finish_reason=length）。');
      return { text: '{"skills":[]}' };
    } });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].reserveMultiplier, 1.5);
    assert.equal(result.manifest.status, 'published');
  } finally { db.close(); }
});

test('review gate: a build that finds no conflicts retires a stale canon-conflict notice', async () => {
  const { worldStore } = makeWorldStore();
  await seedWorld(worldStore);
  await worldStore.upsertEntity({ worldId: 'w-build', entityId: 'chen', type: 'character', name: '陈青云', firstSeenChapterId: null, aliases: [] }, 't');
  await worldStore.saveFact(makeFact('w-build', 'fact-0', 'chen', 'trait', { note: '测试事实' }), 't');
  await worldStore.saveReviewIssue({
    worldId: 'w-build', issueId: 'canon-conflict', kind: 'canon_conflict',
    severity: 'blocking', detailJson: '{"count":1}', createdAt: 't',
  });

  const { result } = await build(worldStore, fakeProvider(VALID_PROPOSAL));
  assert.equal(result.manifest.status, 'published');
  const open = await worldStore.listReviewIssues('w-build', 'open');
  assert.ok(!open.some(issue => issue.issueId === 'canon-conflict'), 'stale conflict notice retired');
});

test('P2-4-fix: closed-enum synonyms are folded before validation, unknown values still rejected', async () => {
  const { worldStore } = makeWorldStore();
  await seedWorld(worldStore);
  await worldStore.upsertEntity({ worldId: 'w-build', entityId: 'chen', type: 'character', name: '陈青云', firstSeenChapterId: null, aliases: [] }, 't');
  await worldStore.saveFact(makeFact('w-build', 'fact-0', 'chen', 'trait', { note: '测试事实' }), 't');

  // Live GLM run: the model answered "mundane" (and would answer 体魄/超凡 in
  // Chinese). Those are the same concepts, so they must map, not be dropped.
  const provider = fakeProvider({
    skills: [
      { id: 'swordsmanship', name: '剑术', attribute: 'physique', allowUntrained: false, powerTier: 'mundane', provenanceKind: 'explicit', evidenceFactIds: ['fact-0'], rationale: '原著剑术。' },
      { id: 'qinggong', name: '轻功', attribute: '敏捷', allowUntrained: true, powerTier: '超凡', provenanceKind: 'explicit', evidenceFactIds: ['fact-0'], rationale: '原著轻功。' },
      { id: 'broken', name: '错值', attribute: 'agility', allowUntrained: true, powerTier: 'banana', provenanceKind: 'explicit', evidenceFactIds: ['fact-0'], rationale: '未知档次。' },
    ],
  });
  const { result } = await build(worldStore, provider);
  const byId = new Map(result.entries.map(entry => [entry.entryId, entry]));

  assert.ok(byId.has('skill-swordsmanship'), 'mundane is folded onto ordinary instead of dropping the skill');
  assert.equal(byId.get('skill-swordsmanship').definition.powerTier, 'ordinary');
  assert.ok(byId.has('skill-qinggong'), 'a Chinese enum answer is folded too');
  assert.equal(byId.get('skill-qinggong').definition.attribute, 'agility');
  assert.equal(byId.get('skill-qinggong').definition.powerTier, 'supernatural');

  assert.ok(!byId.has('skill-broken'), 'a genuinely unknown powerTier is still rejected');
  const issues = await worldStore.listReviewIssues('w-build', 'open');
  const invalid = issues.filter(issue => issue.kind === 'invalid_proposal');
  assert.equal(invalid.length, 1, 'only the unknown value reaches the review queue');
  assert.equal(JSON.parse(invalid[0].detailJson).id, 'broken');
});

test('P2-4-fix: actor template numeric strings are coerced, missing numbers still rejected', async () => {
  const { worldStore } = makeWorldStore();
  await seedWorld(worldStore);
  await worldStore.upsertEntity({ worldId: 'w-build', entityId: 'chen', type: 'character', name: '陈青云', firstSeenChapterId: null, aliases: [] }, 't');
  await worldStore.saveFact(makeFact('w-build', 'fact-0', 'chen', 'trait', { note: '测试事实' }), 't');

  // Live GLM run: a canon NPC template arrived with hp/defense as strings.
  // Rejecting it would silently drop the novel's protagonist from the books.
  const provider = fakeProvider({
    actorTemplates: [
      {
        id: 'chen-qingyun', name: '陈青云', category: 'human', description: '外门弟子。',
        attributes: { physique: 2 }, skills: { swordsmanship: 'novice' }, hp: '6', stamina: '4', defense: '2',
        attacks: [{ name: '青锋剑', skillId: 'swordsmanship', damage: 2, range: 'touch' }], abilities: [],
        behavior: { goal: '守住客栈', retreatThreshold: 0.3, morale: 'steady' },
        lootPolicy: '无', lootItemIds: [],
        threat: { damage: 2, durability: 1, actions: 1, control: 0, environment: 0 },
        provenanceKind: 'rule_mapping', evidenceFactIds: ['fact-0'], rationale: '由原著角色事实映射。',
      },
      {
        id: 'statless', name: '无据之人', category: 'human', description: '缺少战斗数值。',
        attributes: {}, skills: {}, abilities: [],
        behavior: { goal: '无', retreatThreshold: 0.2, morale: 'low' },
        lootPolicy: '无', lootItemIds: [],
        threat: {}, provenanceKind: 'rule_mapping', evidenceFactIds: ['fact-0'], rationale: '无效提案。',
      },
    ],
  });
  const { result } = await build(worldStore, provider);
  const byId = new Map(result.entries.map(entry => [entry.entryId, entry]));

  assert.ok([...byId.keys()].some(key => key.includes('chen-qingyun')), 'the numeric-string template survives');
  const template = [...byId.entries()].find(([key]) => key.includes('chen-qingyun'))[1];
  assert.equal(template.definition.hp, 6, 'hp string coerced to a number');
  assert.equal(template.definition.defense, 2);

  const issues = await worldStore.listReviewIssues('w-build', 'open');
  const rejected = issues.filter(issue => issue.kind === 'invalid_proposal');
  assert.equal(rejected.length, 1, 'only the template without numbers is rejected');
  assert.equal(JSON.parse(rejected[0].detailJson).id, 'statless');
});

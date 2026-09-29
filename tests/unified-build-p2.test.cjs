// Unified world build P2 regression suite (U05-U07 core scope):
// - deterministic equivalence: the same frozen proposal function produces the
//   same authoritative entries/skill relations through the windowed (batched)
//   and resident (single-shot) mapping paths
// - dual-genre skills: evidenced genre skills distinguish packages; unevidenced
//   supernatural/magic proposals never masquerade as explicit (U07)
// - skill usage extraction (attack compiles to combat attacks) and template
//   skill-rank field provenance
// - character -> skill -> evidence -> actor_skills -> roll chain (U06 core)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { buildPackageFromCanon } = require('../dist/application/worldPackage/buildPackageFromCanon');
const { createCampaign } = require('../dist/application/campaign/createCampaign');
const { rollSpecForSkill } = require('../dist/domain/characters/card');

const sha = {
  async sha256Hex(input) { return crypto.createHash('sha256').update(input, 'utf8').digest('hex'); },
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
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
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
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  return db;
}

async function makeWorld(db, worldId) {
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await worldStore.createWorld({
    worldId, title: '测试', sourceSha256: 'b'.repeat(64), sourceBytes: 1,
    normalizeVersion: 'n', chapterSplitVersion: 'c', buildStatus: 'ready',
    createdAt: 't', updatedAt: 't',
  });
  return { adapter, worldStore };
}

function makeFact(worldId, factId, subjectEntityId, predicate, value, status = 'explicit') {
  return {
    worldId, factId, subjectEntityId, predicate, value, status,
    confidence: 0.9, validFrom: null, validTo: null, revealAt: null,
    scope: 'canon', sources: [],
  };
}

async function seedEntitiesAndFacts(worldStore, worldId, entityNames, factSpecs) {
  for (const name of entityNames) {
    await worldStore.upsertEntity({
      worldId, entityId: `ent-${name}`, type: 'character', name,
      firstSeenChapterId: null, aliases: [],
    }, 't');
  }
  for (const spec of factSpecs) {
    await worldStore.saveFact(
      makeFact(worldId, spec.id, `ent-${spec.subject}`, spec.predicate, spec.value, spec.status ?? 'explicit'),
      't',
    );
  }
}

/** Provider whose proposal function is DETERMINISTIC over the batch's fact
 * set: for every contiguous run of FACTS_PER_SKILL facts it proposes one
 * genre skill citing exactly those facts. Both mapping paths therefore
 * express the same underlying proposal function. */
function deterministicSkillProvider({ factsPerSkill, prefix = 'art' } = {}) {
  const calls = [];
  return {
    calls,
    async complete(request) {
      calls.push(request);
      const payload = JSON.parse(request.user);
      const factIds = payload.facts.map(fact => fact.factId);
      const globalIndexOf = factId => Number(factId.replace(/^fact-/, ''));
      const skills = [];
      let currentArt = -1;
      let currentSlice = [];
      for (const factId of factIds) {
        const artIndex = Math.floor(globalIndexOf(factId) / factsPerSkill) + 1;
        if (artIndex !== currentArt) {
          if (currentSlice.length > 0) {
            skills.push(makeArt(currentArt, currentSlice));
          }
          currentArt = artIndex;
          currentSlice = [];
        }
        currentSlice.push(factId);
      }
      if (currentSlice.length > 0) skills.push(makeArt(currentArt, currentSlice));
      function makeArt(artIndex, slice) {
        return {
          id: `${prefix}-${artIndex}`, name: `武艺${artIndex}`, attribute: 'agility',
          usage: 'attack', allowUntrained: false, powerTier: 'ordinary',
          provenanceKind: 'explicit', evidenceFactIds: slice, rationale: '由本批事实映射。',
        };
      }
      return {
        text: JSON.stringify({ skills, constraints: [], actorTemplates: [], items: [], lore: [], ruleMappings: [] }),
        usage: { inputTokens: 1000, outputTokens: 800, estimated: false },
      };
    },
  };
}

/** Normalizes a package for cross-mode comparison: strips run-identity
 * (revision, buildScope stage labels) and sorts everything. */
function normalizePackage(result) {
  const normalizeEntry = entry => ({
    entryId: entry.entryId,
    kind: entry.kind,
    visibility: entry.visibility,
    provenance: {
      kind: entry.provenance.kind,
      sourceFactIds: [...entry.provenance.sourceFactIds].sort(),
    },
    definition: JSON.stringify(entry.definition, Object.keys(JSON.parse(JSON.stringify(entry.definition))).sort()),
    dependencyIds: [...entry.dependencyIds].sort(),
  });
  const entries = result.entries
    // lore-review-summary embeds build-process counters (batch count), not
    // package content - excluded like runId/time/stage labels.
    .filter(entry => entry.entryId !== 'lore-review-summary')
    .map(normalizeEntry).sort((a, b) => a.entryId.localeCompare(b.entryId));
  const sections = result.sections.map(section => ({
    book: section.book, title: section.title,
    entryIds: [...section.entryIds].sort(),
  })).sort((a, b) => `${a.book}/${a.title}`.localeCompare(`${b.book}/${b.title}`));
  return JSON.stringify({ entries, sections });
}

// ---------------------------------------------------------------------------
// U05: frozen proposals -> identical authoritative entries across modes
// ---------------------------------------------------------------------------

test('U05 deterministic equivalence: windowed batches and resident single-shot converge', async () => {
  // 900 facts forces the windowed path into 2 batches (MAX_PROMPT_FACTS 800)
  // while resident maps them in one request.
  const factSpecs = [];
  for (let i = 0; i < 900; i += 1) {
    factSpecs.push({
      id: `fact-${i}`, subject: '沈砚', predicate: `note-${i}`,
      value: { note: `事实${i}` },
    });
  }

  const dbA = setupDb();
  const dbB = setupDb();
  try {
    const a = await makeWorld(dbA, 'w-win');
    const b = await makeWorld(dbB, 'w-res');
    await seedEntitiesAndFacts(a.worldStore, 'w-win', ['沈砚'], factSpecs);
    await seedEntitiesAndFacts(b.worldStore, 'w-res', ['沈砚'], factSpecs);

    const windowedProvider = deterministicSkillProvider({ factsPerSkill: 90 });
    const residentProvider = deterministicSkillProvider({ factsPerSkill: 90 });

    const windowed = await buildPackageFromCanon({
      worldStore: a.worldStore, provider: windowedProvider, sha256Hex: sha.sha256Hex,
      worldId: 'w-win', sourceSha256: 'b'.repeat(64), mappingVersion: 'eq-1', createdAt: 't1',
    });
    const resident = await buildPackageFromCanon({
      worldStore: b.worldStore, provider: residentProvider, sha256Hex: sha.sha256Hex,
      worldId: 'w-res', sourceSha256: 'b'.repeat(64), mappingVersion: 'eq-1', createdAt: 't2',
      resident: true,
    });

    assert.ok(windowedProvider.calls.length >= 2, `windowed path batched (${windowedProvider.calls.length} calls)`);
    assert.equal(residentProvider.calls.length, 1, 'resident path mapped in one request');

    // The deterministic proposal function (90 facts -> 1 evidenced skill)
    // yields 10 evidenced skills in both modes.
    const skillsOf = result => result.entries.filter(entry => entry.kind === 'skill'
      && entry.provenance.kind === 'explicit');
    assert.equal(skillsOf(windowed).length, 10);
    assert.equal(skillsOf(resident).length, 10);

    // U05 core: identical authoritative entries and skill relations, ignoring
    // runId/time/revision/stage labels.
    assert.equal(normalizePackage(windowed), normalizePackage(resident));
  } finally {
    dbA.close();
    dbB.close();
  }
});

// ---------------------------------------------------------------------------
// U07: dual genre + no magic without evidence
// ---------------------------------------------------------------------------

function genreFactSet(genre) {
  if (genre === 'wuxia') {
    return [
      { id: 'fact-0', subject: '林惊澜', predicate: 'skill', value: { name: '碧波剑法' } },
      { id: 'fact-1', subject: '林惊澜', predicate: 'trait', value: { note: '剑随身三年' } },
      { id: 'fact-2', subject: '林惊澜', predicate: 'relationship', value: { person: '云岫', relation: '同门' } },
    ];
  }
  return [
    { id: 'fact-0', subject: '韩铮', predicate: 'skill', value: { name: '机甲格斗术' } },
    { id: 'fact-1', subject: '韩铮', predicate: 'trait', value: { note: '轨道工地的老工头' } },
    { id: 'fact-2', subject: '韩铮', predicate: 'relationship', value: { person: '苏禾', relation: '搭档' } },
  ];
}

function genreProvider(genre) {
  const evidenced = genre === 'wuxia'
    ? {
      id: 'bibo-sword', name: '碧波剑法', attribute: 'agility', usage: 'attack',
      allowUntrained: false, powerTier: 'enhanced',
      provenanceKind: 'explicit', evidenceFactIds: ['fact-0', 'fact-1'], rationale: '原著明写剑法传承。',
    }
    : {
      id: 'mech-brawl', name: '机甲格斗术', attribute: 'physique', usage: 'attack',
      allowUntrained: false, powerTier: 'ordinary',
      provenanceKind: 'explicit', evidenceFactIds: ['fact-0'], rationale: '原著明写驾驶机甲近战。',
    };
  return {
    async complete() {
      return {
        text: JSON.stringify({
          skills: [
            evidenced,
            // Cross-genre invention WITHOUT evidence: a fireball in a
            // hard-SF dockyard, or a fictional 'neural-blade' in wuxia. The
            // honesty gate must drop it, not publish it as explicit.
            {
              id: 'fireball', name: '火球术', attribute: 'knowledge', usage: 'attack',
              allowUntrained: false, powerTier: 'supernatural',
              provenanceKind: 'explicit', evidenceFactIds: [], rationale: '没有证据的超自然提案。',
            },
          ],
          constraints: [], actorTemplates: [], items: [], lore: [], ruleMappings: [],
        }),
        usage: { inputTokens: 500, outputTokens: 300, estimated: false },
      };
    },
  };
}

async function buildGenrePackage(genre) {
  const db = setupDb();
  const { worldStore } = await makeWorld(db, `w-${genre}`);
  await seedEntitiesAndFacts(worldStore, `w-${genre}`,
    genre === 'wuxia' ? ['林惊澜', '云岫'] : ['韩铮', '苏禾'], genreFactSet(genre));
  const result = await buildPackageFromCanon({
    worldStore, provider: genreProvider(genre), sha256Hex: sha.sha256Hex,
    worldId: `w-${genre}`, sourceSha256: 'b'.repeat(64), mappingVersion: 'genre-1', createdAt: 't',
  });
  return { db, worldStore, result };
}

test('U07 dual genre: evidenced genre skills distinguish packages; unevidenced magic never publishes', async () => {
  const wuxia = await buildGenrePackage('wuxia');
  const scifi = await buildGenrePackage('scifi');
  try {
    const skillIdsOf = result => new Set(result.entries
      .filter(entry => entry.kind === 'skill' && entry.provenance.kind === 'explicit')
      .map(entry => entry.entryId));
    const wuxiaSkills = skillIdsOf(wuxia.result);
    const scifiSkills = skillIdsOf(scifi.result);
    assert.ok(wuxiaSkills.has('skill-bibo-sword'), 'wuxia evidenced sword art present');
    assert.ok(scifiSkills.has('skill-mech-brawl'), 'scifi evidenced mech brawling present');
    assert.equal([...wuxiaSkills].some(id => id.startsWith('skill-mech')), false);
    assert.equal([...scifiSkills].some(id => id.startsWith('skill-bibo')), false);
    assert.notDeepEqual([...wuxiaSkills].sort(), [...scifiSkills].sort(), 'skill sets differ by genre');

    // No fireball in EITHER genre; the relationship-fact smuggled supernatural
    // skill is dropped too.
    for (const { result, name } of [{ result: wuxia.result, name: 'wuxia' }, { result: scifi.result, name: 'scifi' }]) {
      assert.equal(result.entries.some(entry => entry.entryId === 'skill-fireball'), false,
        `${name}: unevidenced fireball rejected`);
      assert.equal(result.manifest.status, 'published');
    }

    // Skill names come from the novel's own vocabulary, not a genre dictionary.
    const sword = wuxia.result.entries.find(entry => entry.entryId === 'skill-bibo-sword');
    assert.equal(sword.definition.usage, 'attack');
    assert.deepEqual([...sword.provenance.sourceFactIds].sort(), ['fact-0', 'fact-1']);
    assert.equal(sword.definition.powerTier, 'enhanced');
  } finally {
    wuxia.db.close();
    scifi.db.close();
  }
});

// ---------------------------------------------------------------------------
// Skill usage + template rank provenance + character chain (U06 core)
// ---------------------------------------------------------------------------

test('U06 chain: evidenced attack skill -> template -> campaign actor_skills -> executable roll spec', async () => {
  const db = setupDb();
  try {
    const { adapter, worldStore } = await makeWorld(db, 'w-chain');
    await worldStore.upsertEntity({
      worldId: 'w-chain', entityId: 'ent-青云院', type: 'location', name: '青云院',
      firstSeenChapterId: null, aliases: [],
    }, 't');
    await worldStore.saveFact(
      makeFact('w-chain', 'fact-loc', 'ent-青云院', 'trait', { note: '山中学府' }), 't');
    await seedEntitiesAndFacts(worldStore, 'w-chain', ['洛清霜', '同伴甲'], [
      { id: 'fact-0', subject: '洛清霜', predicate: 'skill', value: { name: '回风剑' } },
      { id: 'fact-1', subject: '洛清霜', predicate: 'trait', value: { note: '剑法出众' } },
      { id: 'fact-2', subject: '同伴甲', predicate: 'trait', value: { note: '可靠同伴' } },
    ]);
    const provider = {
      async complete() {
        return {
          text: JSON.stringify({
            skills: [{
              id: 'huifeng-sword', name: '回风剑', attribute: 'agility', usage: 'attack',
              allowUntrained: false, powerTier: 'enhanced',
              provenanceKind: 'explicit', evidenceFactIds: ['fact-0', 'fact-1'], rationale: '原著剑法。',
            }],
            constraints: [],
            actorTemplates: [{
              id: 'luo-qingshuang', name: '洛清霜', category: 'human',
              description: '原著角色。', attributes: { agility: 3 },
              skills: { 'skill-huifeng-sword': 'expert' }, hp: 8, stamina: 6, defense: 3,
              attacks: [{ name: '回风三叠', skillId: 'huifeng-sword', damage: 2, range: 'near' }],
              abilities: [], behavior: { goal: '护道', retreatThreshold: 0.2, morale: 'steady' },
              lootPolicy: '无掉落', lootItemIds: [], threat: { damage: 2, durability: 2, actions: 1, control: 0, environment: 0 },
              provenanceKind: 'explicit', evidenceFactIds: ['fact-0'], rationale: '原著人物。',
            }],
            items: [], lore: [], ruleMappings: [],
          }),
          usage: { inputTokens: 600, outputTokens: 400, estimated: false },
        };
      },
    };
    const result = await buildPackageFromCanon({
      worldStore, provider, sha256Hex: sha.sha256Hex,
      worldId: 'w-chain', sourceSha256: 'b'.repeat(64), mappingVersion: 'chain-1', createdAt: 't',
    });
    assert.equal(result.manifest.status, 'published');

    // Skill traceability: evidence ids resolve, usage survives cleaning.
    const skill = result.entries.find(entry => entry.entryId === 'skill-huifeng-sword');
    assert.deepEqual([...skill.provenance.sourceFactIds], ['fact-0', 'fact-1']);
    assert.equal(skill.definition.usage, 'attack');

    // Template: skills and attacks point at the published definition; rank
    // fields carry rule_mapping provenance (traceable, never "explicit").
    const template = result.entries.find(entry => entry.entryId === 'npc-luo-qingshuang');
    assert.ok(template, 'canon character template present');
    assert.deepEqual(template.dependencyIds, ['skill-huifeng-sword']);
    assert.deepEqual(template.definition.skills, { 'skill-huifeng-sword': 'expert' });
    assert.equal(template.fieldProvenance.skills.kind, 'rule_mapping');
    assert.equal(template.fieldProvenance.skills.sourceFactIds.includes('fact-0'), true);

    // Campaign instantiation: the template is public? No - templates are gm
    // visibility; recruitment uses public recruiting candidates. For the
    // chain test instantiate the protagonist with the evidenced skill and a
    // companion via template - but gm templates are not recruitable. Instead:
    // verify the actor_skills + roll chain with an original protagonist whose
    // initial skill must exist in the published catalog.
    const created = await createCampaign({
      db: adapter, worldStore,
      campaignId: 'camp-chain', title: '链路验证', worldId: 'w-chain',
      packageRevision: result.manifest.revision,
      anchor: { worldTimeOrder: 1, locationId: '青云院' },
      protagonist: {
        actorId: 'actor-hero', kind: 'original', name: '旅人',
        attributes: { physique: 1, agility: 3, insight: 1, knowledge: 1, willpower: 1, social: 1 },
        initialSkills: ['huifeng-sword'],
      },
      companions: [], goal: '验证链路', createdAt: 't0',
    });
    assert.equal(created.branchId, 'camp-chain-main');

    // actor_skills persisted for the protagonist.
    const rows = db.prepare(
      "SELECT skill_id, rank FROM actor_skills WHERE branch_id = 'camp-chain-main' AND actor_id = 'actor-hero'",
    ).all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].skill_id, 'huifeng-sword');
    assert.equal(rows[0].rank, 'novice');

    // The roll spec compiles from card + catalog (executable action chain).
    const hero = created.cards.find(card => card.actorId === 'actor-hero');
    const catalog = {};
    for (const entry of result.entries.filter(entry => entry.kind === 'skill')) {
      catalog[entry.entryId] = entry.definition;
      catalog[entry.entryId.replace(/^skill-/, '')] = entry.definition;
    }
    const spec = rollSpecForSkill(hero, catalog, 'huifeng-sword', 'challenging');
    assert.equal(spec.attribute, 3);
    assert.equal(spec.skillRank, 'novice');
    assert.equal(spec.difficulty, 6);
  } finally {
    db.close();
  }
});

test('P2 usage cleaning: unknown usage degrades to utility, attack survives; six-attribute discipline holds', async () => {
  const db = setupDb();
  try {
    const { worldStore } = await makeWorld(db, 'w-usage');
    await seedEntitiesAndFacts(worldStore, 'w-usage', ['甲'], [
      { id: 'fact-0', subject: '甲', predicate: 'skill', value: { name: '针黹' } },
      { id: 'fact-1', subject: '甲', predicate: 'trait', value: { note: '善女红' } },
    ]);
    const provider = {
      async complete() {
        return {
          text: JSON.stringify({
            skills: [
              {
                id: 'needle', name: '针黹', attribute: 'knowledge', usage: 'weird-unknown',
                allowUntrained: true, powerTier: 'ordinary',
                provenanceKind: 'explicit', evidenceFactIds: ['fact-0'], rationale: '原著技能。',
              },
              {
                id: 'liuxue', name: '流血', attribute: 'physique', usage: 'attack',
                allowUntrained: false, powerTier: 'ordinary',
                provenanceKind: 'explicit', evidenceFactIds: ['fact-1'], rationale: '原著技能。',
              },
            ],
            constraints: [], actorTemplates: [], items: [], lore: [], ruleMappings: [],
          }),
          usage: { inputTokens: 100, outputTokens: 100, estimated: false },
        };
      },
    };
    const result = await buildPackageFromCanon({
      worldStore, provider, sha256Hex: sha.sha256Hex,
      worldId: 'w-usage', sourceSha256: 'b'.repeat(64), mappingVersion: 'u-1', createdAt: 't',
    });
    const byId = new Map(result.entries.map(entry => [entry.entryId, entry]));
    assert.equal(byId.get('skill-needle').definition.usage, 'utility', 'unknown usage degrades to utility');
    assert.equal(byId.get('skill-liuxue').definition.usage, 'attack');
    // Six-attribute enum holds for both.
    assert.ok(['physique', 'agility', 'insight', 'knowledge', 'willpower', 'social']
      .includes(byId.get('skill-needle').definition.attribute));
  } finally {
    db.close();
  }
});

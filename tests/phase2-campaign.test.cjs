const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');
const { SqliteGameStore } = require('../dist/infra/sqlite/sqliteGameStore');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { SqliteNarrativeStore } = require('../dist/infra/sqlite/sqliteNarrativeStore');
const { validatePackage, computePackageContentHash } = require('../dist/application/worldPackage/validate');
const { publishWorldPackage, assembleBook } = require('../dist/application/worldPackage/publish');
const {
  createOriginalCard, createTemplateCard, rollSpecForSkill, SKILL_RANK_DIE,
} = require('../dist/domain/characters/card');
const { createCampaign } = require('../dist/application/campaign/createCampaign');
const { CampaignSession } = require('../dist/application/campaign/session');
const {
  freezeInitiative, distanceBetweenZones, decideNpcAction, DEFAULT_REST_POLICY,
} = require('../dist/application/campaign/encounterFlow');

const sha = {
  sha256Hex: input => createHash('sha256').update(input, 'utf8').digest('hex'),
  sha256BytesHex: bytes => createHash('sha256').update(bytes).digest('hex'),
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

function entry(entryId, kind, definition, extra = {}) {
  return {
    entryId, kind, revision: 1,
    // These package fixtures represent reviewed design-fill with no imported
    // novel fact dependency. Tests that exercise provenance visibility seed
    // actual StoredFact rows explicitly.
    provenance: { kind: 'design_fill', sourceFactIds: [], rationale: '测试夹具中的审定设定' },
    fieldProvenance: {},
    visibility: 'public',
    dependencyIds: [],
    definition,
    ...extra,
  };
}

const SKILL_STEALTH = entry('stealth', 'skill', {
  name: '潜行', description: '隐蔽行动', attribute: 'agility',
  allowUntrained: false, requirements: ['入门训练'], powerTier: 'ordinary',
});
const SKILL_SWORD = entry('sword', 'skill', {
  name: '剑术', description: '近战攻击', attribute: 'agility',
  allowUntrained: false, requirements: [], usage: 'attack', powerTier: 'ordinary',
});
const LORE_RAIN = entry('lore-rain', 'lore', {
  name: '雨夜', title: '雨夜的书阁', text: '藏书阁雨夜有守卫巡逻。',
});
const OPENING_COURTYARD = entry('scene-open-courtyard', 'scene', {
  name: '庭院', description: '测试世界公开开局地点。', locationId: 'courtyard',
  zones: [
    { zoneId: 'z-a', name: '庭院入口', cover: false, exits: ['z-b', 'courtyard-exit'] },
    { zoneId: 'z-b', name: '井边', cover: true, exits: ['z-a', 'z-c', 'courtyard-exit'] },
    { zoneId: 'z-c', name: '回廊', cover: false, exits: ['z-b', 'courtyard-exit'] },
  ],
  actors: [], visibleItems: [], hazards: [], clues: [],
});

function sampleEntries() {
  const guard = {
    name: '藏书阁守卫', category: 'human', description: '巡逻守卫',
    attributes: { physique: 2, agility: 1, insight: 1 },
    skills: { sword: 'trained' }, hp: 6, stamina: 4, defense: 3,
    attacks: [{ name: '长刀', skillId: 'sword', damage: 2, range: 'touch' }],
    abilities: [], behavior: { goal: '守住入口', retreatThreshold: 0.25, morale: 'steady' },
    lootPolicy: '无掉落',
    threat: { damage: 2, durability: 2, actions: 1, control: 0, environment: 0 },
  };
  return [
    SKILL_STEALTH,
    SKILL_SWORD,
    LORE_RAIN,
    OPENING_COURTYARD,
    entry('companion-template', 'actor_template', {
      ...guard, name: '同行守卫', recruitment: {
        recruitable: true, openingEligible: true, minimumCloseness: 5,
        openingRelationship: { stance: 'friendly', closeness: 6 },
      },
    }),
    entry('guard-template', 'actor_template', guard, { visibility: 'gm' }),
    entry('future-companion-template', 'actor_template', {
      ...guard, name: '未来同行者', recruitment: {
        recruitable: true, openingEligible: true, minimumCloseness: 5,
        validFromOrder: 10, openingRelationship: { stance: 'friendly', closeness: 6 },
      },
    }),
  ];
}

function sampleSections(entries) {
  const ids = entries.map(e => e.entryId);
  return [
    { book: 'player_handbook', sectionKey: 'skills', title: '技能', entryIds: ['stealth', 'sword'], position: 1 },
    { book: 'player_handbook', sectionKey: 'world', title: '世界', entryIds: ['lore-rain'], position: 0 },
    { book: 'gm_guide', sectionKey: 'opening', title: '开局', entryIds: ['lore-rain', 'guard-template'], position: 0 },
    { book: 'monster_manual', sectionKey: 'humans', title: '人类对手', entryIds: ['guard-template'], position: 0 },
  ];
}

async function publishSamplePackage(worldStore, worldId) {
  const entries = sampleEntries();
  const sections = sampleSections(entries);
  const result = await publishWorldPackage({
    worldStore, sha256Hex: sha.sha256Hex, worldId,
    sourceSha256: 'a'.repeat(64), mappingVersion: 'map-1',
    entries, sections, createdAt: 't',
  });
  return { result, entries, sections };
}

async function seedWorld(db, worldStore, worldId = 'w-pkg') {
  await worldStore.createWorld({
    worldId, title: '测试世界', sourceSha256: 'a'.repeat(64), sourceBytes: 1,
    normalizeVersion: 'n', chapterSplitVersion: 'c', buildStatus: 'ready',
    createdAt: 't', updatedAt: 't',
  });
  return worldId;
}

// ---------------------------------------------------------------------------
// P2-1: package validation + publication gate
// ---------------------------------------------------------------------------

test('package validation rejects unknown ops, dangling deps, cycles and missing loot item refs', () => {
  const badAbility = entry('bad-ability', 'ability', {
    name: '飞剑', description: '', attribute: 'agility',
    costs: { stamina: 2 }, range: 'mid', targetPolicy: 'single_enemy',
    requiresRoll: true, effects: [{ op: 'summon_dragon', amount: 99 }],
    cooldownRounds: 0, passive: false, powerTier: 'supernatural',
  }, { dependencyIds: ['ghost-skill'] });

  const report = validatePackage({ worldId: 'w', revision: 0 }, [
    SKILL_STEALTH,
    badAbility,
    entry('a', 'item', { name: 'A', description: '', category: 'tool', unique: false },
      { dependencyIds: ['b'] }),
    entry('b', 'item', { name: 'B', description: '', category: 'tool', unique: false },
      { dependencyIds: ['a'] }),
    entry('bad-looter', 'actor_template', {
      name: '无效守卫', hp: 2, defense: 1, lootItemIds: ['item-ghost'],
    }, { dependencyIds: ['item-ghost'] }),
  ], []);

  assert.equal(report.ok, false);
  assert.ok(report.errors.some(e => /unknown effect op/.test(e)), 'unknown op rejected');
  assert.ok(report.errors.some(e => /dangling dependency ghost-skill/.test(e)), 'dangling dep rejected');
  assert.ok(report.errors.some(e => /cycle detected/.test(e)), 'dependency cycle rejected');
  assert.ok(report.errors.some(e => /bad-looter: dangling dependency item-ghost/.test(e)),
    'loot references must resolve before publication');
  assert.ok(report.errors.some(e => /loot item item-ghost must reference a published item/.test(e)),
    'loot references must resolve specifically to an item entry');
});

test('publication gate: blocking review issue stops publish; published revision is immutable', async () => {
  const db = setupDb();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await seedWorld(db, worldStore);

  await worldStore.saveReviewIssue({
    worldId: 'w-pkg', issueId: 'conflict-1', kind: 'timeline_conflict',
    severity: 'blocking', detailJson: '{"detail":"同一时间既死亡又在场"}', createdAt: 't',
  });

  await assert.rejects(
    () => publishSamplePackage(worldStore, 'w-pkg'),
    /blocking conflict/,
    'blocking conflicts prevent publication',
  );

  await worldStore.resolveReviewIssue('w-pkg', 'conflict-1', 'waived');
  const { result } = await publishSamplePackage(worldStore, 'w-pkg');
  assert.equal(result.manifest.revision, 1);
  assert.equal(result.manifest.status, 'published');
  assert.equal(result.report.errors.length, 0);

  // Re-publishing the same revision is refused; content hash is stable.
  const { result: again } = await publishSamplePackage(worldStore, 'w-pkg');
  assert.equal(again.manifest.revision, 2, 'corrections ship as a new revision');
  assert.equal(again.manifest.contentHash, result.manifest.contentHash, 'same content, same hash');
});

test('three books reference the same entries with visibility filtering', async () => {
  const db = setupDb();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await seedWorld(db, worldStore);
  const { result } = await publishSamplePackage(worldStore, 'w-pkg');
  const pkg = await worldStore.getWorldPackage('w-pkg', result.manifest.revision);

  const playerHandbook = assembleBook(pkg, 'player_handbook', { includeGm: false });
  const playerEntryIds = playerHandbook.flatMap(group => group.entries.map(e => e.entryId));
  assert.ok(playerEntryIds.includes('stealth'));
  assert.ok(!playerEntryIds.includes('guard-template'), 'gm-only template stays out of the player view');

  const monsterManual = assembleBook(pkg, 'monster_manual', { includeGm: true });
  const manualEntryIds = monsterManual.flatMap(group => group.entries.map(e => e.entryId));
  assert.ok(manualEntryIds.includes('guard-template'), 'editor mode sees the full manual');

  // Same skill entry object flows into all views (single source of truth).
  const handbookSkill = pkg.entries.find(e => e.entryId === 'stealth');
  const manualSkill = pkg.entries.find(e => e.entryId === 'stealth');
  assert.equal(handbookSkill, manualSkill);
});

// ---------------------------------------------------------------------------
// P2-2: character cards + campaign creation
// ---------------------------------------------------------------------------

test('original card factory enforces budgets: 4 free points, 3 skills, 4 prepared slots', () => {
  const catalog = { stealth: SKILL_STEALTH.definition, sword: SKILL_SWORD.definition };
  const card = createOriginalCard({
    actorId: 'a-player', name: '沈青', worldId: 'w', worldPackageRevision: 1,
    attributes: { physique: 1, agility: 3, insight: 2, knowledge: 1, willpower: 1, social: 1 },
    initialSkills: ['stealth', 'sword'],
    preparedAbilities: [],
  }, catalog);
  assert.equal(card.skills.stealth, 'novice');
  assert.deepEqual(card.resourceMax, { hp: 10, stamina: 10 });

  // 5 spent free points refused (2+2+1 over the 4-point budget).
  assert.throws(
    () => createOriginalCard({
      actorId: 'a', name: 'x', worldId: 'w', worldPackageRevision: 1,
      attributes: { physique: 3, agility: 3, insight: 2, knowledge: 1, willpower: 1, social: 1 },
      initialSkills: ['stealth'],
    }, catalog),
    /Free attribute points exceeded/,
  );
  // Attribute above cap refused.
  assert.throws(
    () => createOriginalCard({
      actorId: 'a', name: 'x', worldId: 'w', worldPackageRevision: 1,
      attributes: { physique: 4, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 },
      initialSkills: ['stealth'],
    }, catalog),
    /between 1 and 3/,
  );
  // 4th initial skill refused.
  assert.throws(
    () => createOriginalCard({
      actorId: 'a', name: 'x', worldId: 'w', worldPackageRevision: 1,
      attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 },
      initialSkills: ['stealth', 'sword', 'stealth', 'sword'],
    }, catalog),
    /Initial skill budget/,
  );
  // Unknown world skill refused.
  assert.throws(
    () => createOriginalCard({
      actorId: 'a', name: 'x', worldId: 'w', worldPackageRevision: 1,
      attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 },
      initialSkills: ['fly'],
    }, catalog),
    /Unknown skill fly/,
  );
});

test('card-driven roll specs: different cards produce different dice, untrained blocked', () => {
  const catalog = { stealth: SKILL_STEALTH.definition, sword: SKILL_SWORD.definition };
  const expert = createOriginalCard({
    actorId: 'a1', name: '老手', worldId: 'w', worldPackageRevision: 1,
    attributes: { physique: 1, agility: 3, insight: 1, knowledge: 1, willpower: 1, social: 1 },
    initialSkills: ['stealth'],
  }, catalog);
  expert.skills.stealth = 'expert';

  const spec = rollSpecForSkill(expert, catalog, 'stealth', 'challenging');
  assert.deepEqual(spec, { attribute: 3, skillRank: 'expert', difficulty: 6 });

  const novice = createOriginalCard({
    actorId: 'a2', name: '新手', worldId: 'w', worldPackageRevision: 1,
    attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 },
    initialSkills: ['sword'],
  }, catalog);
  // stealth not in the novice's list -> untrained, and the skill forbids it.
  assert.throws(() => rollSpecForSkill(novice, catalog, 'stealth', 'normal'), /untrained/);
  // Unknown skill refused.
  assert.throws(() => rollSpecForSkill(expert, catalog, 'fly', 'normal'), /not defined/);
});

async function createSampleCampaign(db, adapter, worldStore, campaignId, initialSkills = ['stealth']) {
  const { result } = await publishSamplePackage(worldStore, 'w-pkg');
  return createCampaign({
    db: adapter, worldStore,
    campaignId, title: '雨夜潜入', worldId: 'w-pkg',
    packageRevision: result.manifest.revision,
    anchor: { worldTimeOrder: 5, locationId: 'courtyard' },
    protagonist: {
      actorId: 'actor-shen', kind: 'original', name: '沈青',
      attributes: { physique: 1, agility: 3, insight: 2, knowledge: 1, willpower: 1, social: 1 },
      initialSkills,
    },
    companions: [{ actorId: 'actor-su', templateId: 'companion-template' }],
    goal: '进入藏书阁取回手稿',
    createdAt: 't0',
  });
}

test('campaign creation locks the package and writes all state in one transaction', async () => {
  const db = setupDb();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await seedWorld(db, worldStore);

  const created = await createSampleCampaign(db, adapter, worldStore, 'camp-a');
  assert.equal(created.branchId, 'camp-a-main');
  assert.equal(created.cards.length, 2);
  const protagonist = created.cards.find(card => card.actorId === 'actor-shen');
  assert.equal(protagonist.attributes.agility, 3);
  const companion = created.cards.find(card => card.actorId === 'actor-su');
  assert.equal(companion.kind, 'companion');
  assert.equal(companion.resourceMax.hp, 6, 'companion instantiated from template hp');

  const campaignRow = db.prepare("SELECT package_revision, anchor_json FROM campaigns WHERE campaign_id = 'camp-a'").get();
  assert.equal(campaignRow.package_revision, 1);
  assert.deepEqual(JSON.parse(campaignRow.anchor_json), { worldTimeOrder: 5, locationId: 'courtyard' });

  const party = db.prepare("SELECT COUNT(*) AS n FROM party_members WHERE branch_id = 'camp-a-main'").get();
  assert.equal(party.n, 2);
  const skills = db.prepare("SELECT COUNT(*) AS n FROM actor_skills WHERE branch_id = 'camp-a-main' AND actor_id = 'actor-shen'").get();
  assert.equal(skills.n, 1);

  // Missing package: explicit failure, never a demo fallback.
  await assert.rejects(
    () => createCampaign({
      db: adapter, worldStore, campaignId: 'camp-b', title: 'x', worldId: 'w-pkg',
      packageRevision: 99,
      anchor: { worldTimeOrder: 1, locationId: 'courtyard' },
      protagonist: { actorId: 'a', kind: 'original', name: 'x', attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 }, initialSkills: ['stealth'] },
      goal: 'g', createdAt: 't',
    }),
    /not found|not published/,
  );
  await assert.rejects(
    () => createCampaign({
      db: adapter, worldStore, campaignId: 'camp-too-many-allies', title: 'x', worldId: 'w-pkg', packageRevision: 1,
      anchor: { worldTimeOrder: 1, locationId: 'courtyard' },
      protagonist: { actorId: 'player', kind: 'original', name: 'x',
        attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 }, initialSkills: ['stealth'] },
      companions: [
        { actorId: 'ally-1', templateId: 'guard-template' },
        { actorId: 'ally-2', templateId: 'guard-template' },
        { actorId: 'ally-3', templateId: 'guard-template' },
      ],
      goal: 'g', createdAt: 't',
    }),
    /最多可招募两名同伴/,
    'the campaign API enforces the same party limit as the opening UI',
  );
});

// ---------------------------------------------------------------------------
// P2-2/P2-3: session loop with card-driven rolls + settlement + isolation
// ---------------------------------------------------------------------------

// V2 restricted-proposal provider: the planner proposes an action SHAPE only
// (kind + skill + evidence); all numbers are compiled locally by the engine.
class ScriptedPlannerProvider {
  constructor() { this.calls = 0; }
  async complete(request) {
    this.calls += 1;
    const payload = JSON.parse(request.user);
    if (request.role === 'Planner') {
      const proposal = {
        proposalVersion: '2.0',
        turnId: payload.turnId,
        expectedStateVersion: payload.expectedStateVersion,
        actorId: 'actor-shen',
        actionKind: 'skill_check',
        skillId: 'stealth',
        difficultyBand: 'challenging',
        evidenceIds: ['lore-rain'],
        intent: payload.playerIntent,
        narrativeHint: { successSummary: 'ok', failureSummary: 'fail' },
      };
      return { text: JSON.stringify(proposal), usage: { inputTokens: 100, outputTokens: 50, estimated: false } };
    }
    return {
      text: JSON.stringify({ turnId: payload.turnId, outcomeGrade: payload.outcomeGrade, text: `剧情 ${payload.turnId}` }),
      usage: { inputTokens: 80, outputTokens: 60, estimated: false },
    };
  }
}

const RNG = { nextIntInclusive: (min, max) => max };

async function makeSession(db, campaignId = 'camp-s', options = {}) {
  if (campaignId && typeof campaignId === 'object') {
    options = campaignId;
    campaignId = 'camp-s';
  }
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await seedWorld(db, worldStore);
  await createSampleCampaign(db, adapter, worldStore, campaignId, options.initialSkills ?? ['stealth']);
  const provider = new ScriptedPlannerProvider();
  const session = new CampaignSession({
    db: adapter,
    turns: new SqliteTurnStore(adapter),
    game: new SqliteGameStore(adapter),
    worldStore,
    narratives: new SqliteNarrativeStore(adapter),
    hashProvider: sha,
    random: options.random ?? RNG,
  }, provider, { endpoint: 'https://x', model: 'test-model', keyRef: 'kr' });
  return { session, adapter, worldStore, provider };
}

test('session playTurn uses card-driven dice and settles growth atomically', async () => {
  const db = setupDb();
  const { session, adapter } = await makeSession(db);
  const summary = await session.getSummary('camp-s', 'camp-s-main');
  assert.equal(summary.packageRevision, 1);

  const result = await session.playTurn({
    campaignId: 'camp-s', branchId: 'camp-s-main', intent: '趁雨声潜行接近书阁',
  });
  assert.equal(result.stateVersion, summary.state.stateVersion + 1);

  // Dice come from the card: agility 3 -> 3 dice, novice -> d6, challenging -> 6.
  assert.ok(result.dice.startsWith('3d6:'), `expected 3d6, got ${result.dice}`);
  assert.ok(result.text.length > 0);

  // Growth settled in the same transaction: skill row + ledger row exist.
  // Challenge id is the STABLE open-challenge id (skill sequence 1) — a
  // per-turn id would let re-typed input farm points (P2 A04).
  const skill = db.prepare("SELECT practice_points, awarded_turns_json FROM actor_skills WHERE branch_id = 'camp-s-main' AND actor_id = 'actor-shen' AND skill_id = 'stealth'").get();
  assert.equal(skill.practice_points, 1);
  assert.ok(skill.awarded_turns_json.includes('challenge-camp-s-main-actor-shen-stealth-1:practice'));
  assert.ok(skill.awarded_turns_json.includes('challenge-camp-s-main-actor-shen-stealth-1:closed'),
    'an achieved challenge is closed; the next attempt opens a new one');
  const ledger = db.prepare("SELECT COUNT(*) AS n FROM reward_ledger WHERE branch_id = 'camp-s-main'").get();
  assert.equal(ledger.n, 1);

  // The snapshot stamped at this version is complete: the protagonist's
  // awarded stealth AND the companion's template skill (sword) are both there.
  const snap = JSON.parse(db.prepare("SELECT snapshot_json FROM snapshots WHERE branch_id = 'camp-s-main' AND state_version = 1").get().snapshot_json);
  const protagonistSkill = snap.skills.find(skill => skill.actorId === 'actor-shen');
  assert.ok(protagonistSkill && protagonistSkill.skillId === 'stealth' && protagonistSkill.practicePoints === 1,
    'protagonist skill progress is stamped into the snapshot');
  assert.ok(snap.skills.some(skill => skill.actorId === 'actor-su' && skill.skillId === 'sword'),
    'companion template skills are part of the complete snapshot');
  assert.equal(snap.clockSeconds, 600, 'clock advanced by the engine-fixed skill-check cost (10 min)');

  // Replaying the same turn id (recovery) replays without re-awarding.
  const replay = await session.playTurn({
    campaignId: 'camp-s', branchId: 'camp-s-main', intent: '重复提交',
    turnIdOverride: 'turn-0001',
  });
  assert.equal(replay.resumed, true);
  const ledgerAfterReplay = db.prepare("SELECT COUNT(*) AS n FROM reward_ledger WHERE branch_id = 'camp-s-main'").get();
  if (ledgerAfterReplay.n !== 1) {
    console.log('LEDGER:', JSON.stringify(db.prepare('SELECT * FROM reward_ledger').all()));
    console.log('TURNS:', JSON.stringify(db.prepare('SELECT turn_id, status FROM turns').all()));
  }
  assert.equal(ledgerAfterReplay.n, 1, 'replay never double-awards');
});

test('two campaigns of one world stay isolated; rewind restores historical skills', async () => {
  const db = setupDb();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await seedWorld(db, worldStore);
  await createSampleCampaign(db, adapter, worldStore, 'camp-1');
  await createSampleCampaign(db, adapter, worldStore, 'camp-2');

  const { CampaignSession: Session } = { CampaignSession: require('../dist/application/campaign/session').CampaignSession };
  const mk = () => new Session({
    db: adapter, turns: new SqliteTurnStore(adapter), game: new SqliteGameStore(adapter),
    worldStore, narratives: new SqliteNarrativeStore(adapter), hashProvider: sha, random: RNG,
  }, new ScriptedPlannerProvider(), { endpoint: 'https://x', model: 'm', keyRef: 'kr' });

  const s1 = mk();
  await s1.playTurn({ campaignId: 'camp-1', branchId: 'camp-1-main', intent: '行动一' });
  await s1.playTurn({ campaignId: 'camp-1', branchId: 'camp-1-main', intent: '行动二' });

  const s2 = mk();
  await s2.playTurn({ campaignId: 'camp-2', branchId: 'camp-2-main', intent: '另一局行动' });

  const camp1Ledger = db.prepare("SELECT COUNT(*) AS n FROM reward_ledger WHERE branch_id = 'camp-1-main'").get().n;
  const camp2Ledger = db.prepare("SELECT COUNT(*) AS n FROM reward_ledger WHERE branch_id = 'camp-2-main'").get().n;
  assert.equal(camp1Ledger, 2);
  assert.equal(camp2Ledger, 1, 'the second campaign only earns its own rewards');

  // Rewind camp-1 to version 1: its head skill progress reverts to the fork point.
  const rewind = await s1.rewind({
    campaignId: 'camp-1', sourceBranchId: 'camp-1-main', atStateVersion: 1, newBranchId: 'camp-1-r1',
  });
  assert.equal(rewind.stateVersion, 1);
  const rewoundSkill = db.prepare("SELECT practice_points FROM actor_skills WHERE branch_id = 'camp-1-r1' AND actor_id = 'actor-shen' AND skill_id = 'stealth'").get();
  assert.equal(rewoundSkill.practice_points, 1, 'fork-point practice restored');
  const headSkill = db.prepare("SELECT practice_points FROM actor_skills WHERE branch_id = 'camp-1-main' AND actor_id = 'actor-shen' AND skill_id = 'stealth'").get();
  assert.equal(headSkill.practice_points, 2, 'source branch head keeps its progress');

  // Cards copied into the rewound branch for continued play.
  const rewoundCards = db.prepare("SELECT COUNT(*) AS n FROM actor_cards WHERE branch_id = 'camp-1-r1'").get();
  assert.equal(rewoundCards.n, 2);
});

test('rest and training follow V0.2 policy: threshold only enables training', async () => {
  const db = setupDb();
  const { session, adapter } = await makeSession(db);

  // Training before the threshold is refused. Conditions are no longer UI
  // inputs — the engine queries real state (P2 acceptance A02).
  await assert.rejects(
    () => session.trainSkill({
      campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'actor-shen',
      skillId: 'stealth',
    }),
    /practice threshold/,
  );

  // The initial skill starts at novice: 10 independent challenges to its
  // threshold of 10 (each achieved challenge opens the next). Milestone/turn
  // awards never auto-advance.
  for (let i = 0; i < 10; i += 1) {
    await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: `行动 ${i}` });
  }
  const beforeTraining = await session.getSummary('camp-s', 'camp-s-main');
  const progress = await session.trainSkill({
    campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'actor-shen',
    skillId: 'stealth',
  });
  assert.equal(progress.advanced, true);
  assert.equal(progress.nextRank, 'trained');
  assert.equal(progress.pointsSpent, 10);
  const afterTraining = await session.getSummary('camp-s', 'camp-s-main');
  assert.ok(afterTraining.state.stateVersion > beforeTraining.state.stateVersion,
    'training is a versioned action transaction');
  assert.equal(afterTraining.state.clockSeconds, beforeTraining.state.clockSeconds + 240 * 60,
    'training consumes real world time (4 hours)');
  assert.equal(afterTraining.state.actors['actor-shen'].resources.stamina, 8,
    'training consumes real resources (2 stamina)');
  const trainedCard = await session.getCard('camp-s-main', 'actor-shen');
  assert.equal(trainedCard.skills.stealth, 'trained', 'card projection updated in the same transaction');
  const trainSnap = JSON.parse(db.prepare("SELECT snapshot_json FROM snapshots WHERE branch_id = 'camp-s-main' ORDER BY state_version DESC LIMIT 1").get().snapshot_json);
  assert.equal(trainSnap.cards.find(c => c.actorId === 'actor-shen').card.skills.stealth, 'trained',
    'the snapshot stamped by the training commit carries the trained card (A03)');

  // Insufficient REAL stamina blocks training — an engine-queried condition,
  // checked before anything is spent.
  db.prepare("UPDATE actor_states SET resources_json = ? WHERE branch_id = 'camp-s-main' AND actor_id = 'actor-shen'")
    .run(JSON.stringify({ hp: 10, stamina: 1 }));
  await assert.rejects(
    () => session.trainSkill({
      campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'actor-shen',
      skillId: 'stealth',
    }),
    /Training requires the configured resources/,
  );

  // Rest advances the world clock and restores stamina, committed as a turn.
  const before = await session.getSummary('camp-s', 'camp-s-main');
  const rest = await session.rest({ campaignId: 'camp-s', branchId: 'camp-s-main', kind: 'short' });
  assert.equal(rest.clockSecondsAdvanced, 30 * 60);
  const after = await session.getSummary('camp-s', 'camp-s-main');
  assert.equal(after.state.stateVersion, before.state.stateVersion + 1);
  assert.equal(after.state.clockSeconds, before.state.clockSeconds + 1800);
  assert.equal(after.state.clockMinutes, Math.floor(after.state.clockSeconds / 60),
    'the loaded minute projection stays in sync with the action transaction clock');
  const restSnapshot = JSON.parse(db.prepare("SELECT snapshot_json FROM snapshots WHERE branch_id = 'camp-s-main' ORDER BY state_version DESC LIMIT 1").get().snapshot_json);
  assert.equal(restSnapshot.clockMinutes, Math.floor(restSnapshot.clockSeconds / 60),
    'the raw persisted snapshot stores a minute projection matching its authoritative seconds');
  assert.equal(after.state.actors['actor-shen'].resources.stamina, 3, 'short rest restores 2 stamina from 1');
});

// ---------------------------------------------------------------------------
// M5: elastic turn-context integration (infrastructure plan §57-§60)
// ---------------------------------------------------------------------------

class CapturingProvider extends ScriptedPlannerProvider {
  constructor() {
    super();
    this.requests = [];
  }
  async complete(request) {
    this.requests.push(request);
    return super.complete(request);
  }
}

test('M5: playTurn routes planner/narrator through kernel budgets and separate contexts', async () => {
  const db = setupDb();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await seedWorld(db, worldStore);
  await createSampleCampaign(db, adapter, worldStore, 'camp-ctx');
  const provider = new CapturingProvider();
  const session = new CampaignSession({
    db: adapter,
    turns: new SqliteTurnStore(adapter),
    game: new SqliteGameStore(adapter),
    worldStore,
    narratives: new SqliteNarrativeStore(adapter),
    hashProvider: sha,
    random: RNG,
  }, provider, {
    endpoint: 'https://x', model: 'glm-test', keyRef: 'kr',
    capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: true, contextWindow: 32_000, maxOutputTokens: 8_192 },
    reasoningEffort: 'low',
    reasoningReserveTokens: 2_048,
  });

  await session.playTurn({ campaignId: 'camp-ctx', branchId: 'camp-ctx-main', intent: '雨夜潜行接近书阁' });

  const plannerRequest = provider.requests.find(request => request.role === 'Planner');
  const narratorRequest = provider.requests.find(request => request.role === 'Narrator');
  assert.ok(plannerRequest && narratorRequest);

  // Kernel budgets, not the legacy fixed 1200/1500 (planner demand maximum
  // 4000 fits the declared 8192 ceiling with the GLM reserve inside).
  assert.equal(plannerRequest.maxOutputTokens, 4_000);
  assert.notEqual(narratorRequest.maxOutputTokens, 1_500);

  // Separate frozen contexts: the narrator payload carries its own
  // worldContext, never the full planner context.
  const narratorPayload = JSON.parse(narratorRequest.user);
  assert.ok(typeof narratorPayload.worldContext === 'string');
  const plannerPayload = JSON.parse(plannerRequest.user);
  assert.ok(plannerPayload.worldContext.length > 0);
  assert.ok(narratorPayload.worldContext.length < plannerPayload.worldContext.length,
    'narrator context is deliberately smaller');

  const contexts = session.lastTurnContexts;
  assert.ok(contexts.planner && contexts.narrator);
  assert.equal(contexts.planner.legacyFallback, false);
  assert.equal(contexts.narrator.legacyFallback, false);
  assert.notEqual(contexts.planner.contextId, contexts.narrator.contextId);
  assert.equal(contexts.narrator.included.some(item => item.board === 'worldKnowledge'), false);
  assert.equal(contexts.narrator.included.some(item => item.board === 'sourceEvidence'), false);
});

test('M5: unknown capabilities degrade to the legacy path without breaking play', async () => {
  const db = setupDb();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await seedWorld(db, worldStore);
  await createSampleCampaign(db, adapter, worldStore, 'camp-legacy');
  const provider = new CapturingProvider();
  const session = new CampaignSession({
    db: adapter,
    turns: new SqliteTurnStore(adapter),
    game: new SqliteGameStore(adapter),
    worldStore,
    narratives: new SqliteNarrativeStore(adapter),
    hashProvider: sha,
    random: RNG,
  }, provider, { endpoint: 'https://x', model: 'stub', keyRef: 'kr' });

  const result = await session.playTurn({ campaignId: 'camp-legacy', branchId: 'camp-legacy-main', intent: '潜行' });
  assert.ok(result.stateVersion >= 1, 'the turn still plays');
  assert.equal(session.lastTurnContexts.planner.legacyFallback, true);
  assert.equal(
    provider.requests.find(request => request.role === 'Planner').maxOutputTokens,
    1_200,
    'legacy fixed planner budget',
  );
});

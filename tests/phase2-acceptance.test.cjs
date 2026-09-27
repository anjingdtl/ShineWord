// Formal regression for the P2 independent-acceptance findings (A01–A07 in
// docs/reviews/P2_ACCEPTANCE_REVIEW.md). Each probe here is the test-suite
// equivalent of docs/reviews/P2_ACCEPTANCE_REPRO.cjs — same fixtures class,
// same expectations — plus hardened variants (anti-farm closure, rolled-but-
// uncommitted restore, capped healing, NPC attack legality). Weakening any
// assertion here reopens the acceptance defect it pins.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');
const { SqliteGameStore } = require('../dist/infra/sqlite/sqliteGameStore');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { SqliteNarrativeStore } = require('../dist/infra/sqlite/sqliteNarrativeStore');
const { assembleBook } = require('../dist/application/worldPackage/publish');
const { CampaignSession } = require('../dist/application/campaign/session');
const {
  distanceBetweenZones, rangeCoversBand, decideNpcAction,
} = require('../dist/application/campaign/encounterFlow');
const { exportSave, restoreSave, validateSaveJson, SAVE_SCHEMA_VERSION } = require('../dist/application/export/saveFile');
const { validatePlannerProposal } = require('../dist/domain/turns/proposal');

const sha = {
  sha256Hex: input => createHash('sha256').update(input, 'utf8').digest('hex'),
  sha256BytesHex: bytes => createHash('sha256').update(bytes).digest('hex'),
};

class NodeSqliteAdapter {
  constructor(db) { this.db = db; this.chain = Promise.resolve(); }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return; }
    this.db.prepare(sql).run(...params);
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
    provenance: { kind: 'rule_mapping', sourceFactIds: ['f-1'], rationale: '映射自原著表现' },
    fieldProvenance: {}, visibility: 'public', dependencyIds: [], definition, ...extra,
  };
}

const SKILL_STEALTH = entry('stealth', 'skill', {
  name: '潜行', description: '隐蔽行动', attribute: 'agility',
  allowUntrained: false, requirements: [], powerTier: 'ordinary',
});
const SKILL_SWORD = entry('sword', 'skill', {
  name: '剑术', description: '近战攻击', attribute: 'agility',
  allowUntrained: false, requirements: [], powerTier: 'ordinary', usage: 'attack',
});
const LORE_RAIN = entry('lore-rain', 'lore', { name: '雨夜', title: '雨夜的书阁', text: '藏书阁雨夜有守卫巡逻。' });
const GUARD_TEMPLATE = entry('guard-template', 'actor_template', {
  name: '藏书阁守卫', category: 'human', description: '巡逻守卫',
  attributes: { physique: 2, agility: 1, insight: 1 },
  skills: { sword: 'trained' }, hp: 6, stamina: 4, defense: 3,
  attacks: [{ name: '长刀', skillId: 'sword', damage: 2, range: 'touch' }],
  abilities: [], behavior: { goal: '守住入口', retreatThreshold: 0.25, morale: 'steady' },
  lootPolicy: '无掉落', threat: { damage: 2, durability: 2, actions: 1, control: 0, environment: 0 },
}, { visibility: 'gm' });

const RNG_MAX = { nextIntInclusive: (min, max) => max };
const RNG_MIN = { nextIntInclusive: min => min };

class ProposalProvider {
  constructor() { this.calls = 0; this.override = null; }
  async complete(request) {
    this.calls += 1;
    const payload = JSON.parse(request.user);
    if (request.role === 'Planner') {
      const proposal = this.override ? this.override(payload) : {
        proposalVersion: '2.0', turnId: payload.turnId, expectedStateVersion: payload.expectedStateVersion,
        actorId: 'actor-shen', actionKind: 'skill_check', skillId: 'stealth', difficultyBand: 'challenging',
        evidenceIds: ['lore-rain'], intent: payload.playerIntent,
      };
      return { text: JSON.stringify(proposal), usage: { inputTokens: 10, outputTokens: 5, estimated: false } };
    }
    return {
      text: JSON.stringify({ turnId: payload.turnId, outcomeGrade: payload.outcomeGrade, text: `剧情 ${payload.turnId}` }),
      usage: { inputTokens: 8, outputTokens: 6, estimated: false },
    };
  }
}

async function seedWorld(db, worldStore, worldId = 'w-pkg') {
  await worldStore.createWorld({
    worldId, title: '测试世界', sourceSha256: 'a'.repeat(64), sourceBytes: 1,
    normalizeVersion: 'n', chapterSplitVersion: 'c', buildStatus: 'ready', createdAt: 't', updatedAt: 't',
  });
}

async function publishSample(worldStore, worldId = 'w-pkg') {
  const { publishWorldPackage } = require('../dist/application/worldPackage/publish');
  const entries = [SKILL_STEALTH, SKILL_SWORD, LORE_RAIN, GUARD_TEMPLATE];
  const sections = [
    { book: 'player_handbook', sectionKey: 'skills', title: '技能', entryIds: ['stealth', 'sword'], position: 1 },
    { book: 'player_handbook', sectionKey: 'world', title: '世界', entryIds: ['lore-rain'], position: 0 },
    { book: 'monster_manual', sectionKey: 'humans', title: '人类对手', entryIds: ['guard-template'], position: 0 },
  ];
  return publishWorldPackage({
    worldStore, sha256Hex: sha.sha256Hex, worldId, sourceSha256: 'a'.repeat(64),
    mappingVersion: 'map-1', entries, sections, createdAt: 't',
  });
}

async function makeSession(db, { random = RNG_MAX, initialSkills = ['stealth'] } = {}) {
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await seedWorld(db, worldStore);
  const pub = await publishSample(worldStore);
  const { createCampaign } = require('../dist/application/campaign/createCampaign');
  await createCampaign({
    db: adapter, worldStore, campaignId: 'camp-s', title: '雨夜潜入', worldId: 'w-pkg',
    packageRevision: pub.manifest.revision,
    anchor: { worldTimeOrder: 5, locationId: 'courtyard' },
    protagonist: {
      actorId: 'actor-shen', kind: 'original', name: '沈青',
      attributes: { physique: 1, agility: 3, insight: 2, knowledge: 1, willpower: 1, social: 1 },
      initialSkills,
    },
    companions: [{ actorId: 'actor-su', templateId: 'guard-template' }],
    goal: '进入藏书阁取回手稿', createdAt: 't0',
  });
  const provider = new ProposalProvider();
  const session = new CampaignSession({
    db: adapter, turns: new SqliteTurnStore(adapter), game: new SqliteGameStore(adapter),
    worldStore, narratives: new SqliteNarrativeStore(adapter), hashProvider: sha, random,
  }, provider, { endpoint: 'https://x', model: 'test-model', keyRef: 'kr' });
  return { session, adapter, worldStore, provider };
}

// ---------------------------------------------------------------------------
// A01: local rules authority — the planner cannot inject numbers
// ---------------------------------------------------------------------------

test('A01: planner effects/outcomes in proposals are rejected before any commit', () => {
  const errors = validatePlannerProposal({
    proposalVersion: '2.0', turnId: 'turn-0001', expectedStateVersion: 0, actorId: 'a',
    actionKind: 'skill_check', skillId: 'stealth', evidenceIds: [], intent: 'x',
    requiresRoll: false,
    outcomes: { success: { achieved: true, publicSummary: 'x', effects: [{ op: 'restoreResource', actorId: 'a', resourceId: 'hp', amount: 999 }] } },
  });
  assert.ok(errors.some(e => /proposals must not carry authoritative contract data/.test(e)));
  assert.ok(errors.some(e => /requiresRoll/.test(e)));
});

test('A01: a tampered planner response cannot push hp above the card maximum', async () => {
  const db = setupDb();
  const { session, provider } = await makeSession(db);
  const baseComplete = provider.complete.bind(provider);
  // A hostile/dialect-broken model returns a V1-shaped contract with a huge
  // restore in outcomes — the V2 gate must refuse it outright.
  provider.complete = async request => {
    const response = await baseComplete(request);
    if (request.role === 'Planner') {
      const parsed = JSON.parse(response.text);
      parsed.requiresRoll = false;
      parsed.outcomes = {
        full_success: { achieved: true, publicSummary: 'x', effects: [{ op: 'restoreResource', actorId: 'actor-shen', resourceId: 'hp', amount: 999 }] },
        success: { achieved: true, publicSummary: 'x', effects: [{ op: 'restoreResource', actorId: 'actor-shen', resourceId: 'hp', amount: 999 }] },
        failure: { achieved: false, publicSummary: 'x', effects: [] },
        severe_failure: { achieved: false, publicSummary: 'x', effects: [] },
      };
      response.text = JSON.stringify(parsed);
    }
    return response;
  };
  await assert.rejects(() => session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: 'observe' }));
  const summary = await session.getSummary('camp-s', 'camp-s-main');
  assert.ok(summary.state.actors['actor-shen'].resources.hp <= 10, 'hp never exceeds the card maximum');
  db.close();
});

test('A01: compiled ability healing carries the engine cap even when hp is low', async () => {
  const db = setupDb();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await seedWorld(db, worldStore);
  // A package with a healing ability.
  const { publishWorldPackage } = require('../dist/application/worldPackage/publish');
  const HEAL = entry('ability-bandage', 'ability', {
    name: '包扎', description: '处理伤口', attribute: 'insight',
    costs: { stamina: 1 }, range: 'touch', targetPolicy: 'single_ally',
    requiresRoll: false, effects: [{ op: 'heal', amount: 99 }],
    cooldownRounds: 0, passive: false, powerTier: 'ordinary',
  });
  const entries = [SKILL_STEALTH, SKILL_SWORD, LORE_RAIN, GUARD_TEMPLATE, HEAL];
  const pub = await publishWorldPackage({
    worldStore, sha256Hex: sha.sha256Hex, worldId: 'w-pkg', sourceSha256: 'a'.repeat(64),
    mappingVersion: 'map-1', entries,
    sections: [{ book: 'player_handbook', sectionKey: 'abilities', title: '能力', entryIds: ['ability-bandage'], position: 2 }],
    createdAt: 't',
  });
  const { createCampaign } = require('../dist/application/campaign/createCampaign');
  await createCampaign({
    db: adapter, worldStore, campaignId: 'camp-h', title: '治疗', worldId: 'w-pkg',
    packageRevision: pub.manifest.revision,
    anchor: { worldTimeOrder: 1, locationId: 'camp' },
    protagonist: {
      actorId: 'actor-shen', kind: 'original', name: '沈青',
      attributes: { physique: 1, agility: 2, insight: 2, knowledge: 1, willpower: 1, social: 1 },
      initialSkills: ['stealth'], learnedAbilities: ['ability-bandage'], preparedAbilities: ['ability-bandage'],
    },
    goal: '治疗', createdAt: 't0',
  });
  db.prepare("UPDATE actor_states SET resources_json = ? WHERE branch_id = 'camp-h-main' AND actor_id = 'actor-shen'")
    .run(JSON.stringify({ hp: 3, stamina: 5 }));
  const provider = new ProposalProvider();
  const session = new CampaignSession({
    db: adapter, turns: new SqliteTurnStore(adapter), game: new SqliteGameStore(adapter),
    worldStore, narratives: new SqliteNarrativeStore(adapter), hashProvider: sha, random: RNG_MAX,
  }, provider, { endpoint: 'https://x', model: 'm', keyRef: 'kr' });
  provider.override = payload => ({
    proposalVersion: '2.0', turnId: payload.turnId, expectedStateVersion: payload.expectedStateVersion,
    actorId: 'actor-shen', actionKind: 'ability', abilityId: 'ability-bandage', targetId: 'actor-shen',
    evidenceIds: [], intent: '包扎自己',
  });
  await session.playTurn({ campaignId: 'camp-h', branchId: 'camp-h-main', intent: '包扎自己' });
  const after = await session.getSummary('camp-h', 'camp-h-main');
  assert.equal(after.state.actors['actor-shen'].resources.hp, 10, 'heal 99 clamps at the card cap 10');
  assert.equal(after.state.actors['actor-shen'].resources.stamina, 4, 'ability cost settled');
  db.close();
});

// ---------------------------------------------------------------------------
// A02: training is a versioned, timed, resource-consuming action
// ---------------------------------------------------------------------------

test('A02: training advances stateVersion and world clock atomically with skill+card', async () => {
  const db = setupDb();
  const { session } = await makeSession(db);
  for (let i = 0; i < 10; i += 1) {
    await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: 'same unchanged goal' });
  }
  const before = await session.getSummary('camp-s', 'camp-s-main');
  const result = await session.trainSkill({
    campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'actor-shen', skillId: 'stealth',
  });
  assert.equal(result.advanced, true);
  const after = await session.getSummary('camp-s', 'camp-s-main');
  assert.ok(after.state.stateVersion > before.state.stateVersion, 'versioned action');
  assert.ok(after.state.clockSeconds > before.state.clockSeconds, 'time consumed');
  assert.equal(after.state.clockSeconds - before.state.clockSeconds, 240 * 60);
  const card = await session.getCard('camp-s-main', 'actor-shen');
  assert.equal(card.skills.stealth, 'trained');
  db.close();
});

// ---------------------------------------------------------------------------
// A03: rewind restores the HISTORICAL card, never the current one
// ---------------------------------------------------------------------------

test('A03: rewound branch rolls with the historical card rank', async () => {
  const db = setupDb();
  const { session } = await makeSession(db);
  for (let i = 0; i < 10; i += 1) {
    await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: 'accumulate' });
  }
  await session.trainSkill({ campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'actor-shen', skillId: 'stealth' });
  await session.rewind({ campaignId: 'camp-s', sourceBranchId: 'camp-s-main', atStateVersion: 1, newBranchId: 'rewound' });
  const oldCard = await session.getCard('rewound', 'actor-shen');
  const oldSkill = db.prepare("SELECT rank FROM actor_skills WHERE branch_id='rewound' AND actor_id='actor-shen' AND skill_id='stealth'").get();
  assert.equal(oldCard.skills.stealth, oldSkill.rank, 'card rank equals the historical skill rank');
  const next = await session.playTurn({ campaignId: 'camp-s', branchId: 'rewound', intent: 'historical check' });
  assert.ok(next.dice.startsWith('3d6:'), `historical novice card rolls 3d6, got ${next.dice}`);
  const headCard = await session.getCard('camp-s-main', 'actor-shen');
  assert.equal(headCard.skills.stealth, 'trained', 'source branch keeps its trained card');
  db.close();
});

// ---------------------------------------------------------------------------
// A04: milestone idempotency + challenge closure anti-farm
// ---------------------------------------------------------------------------

test('A04: the same milestone identity grants exactly once', async () => {
  const db = setupDb();
  const { session } = await makeSession(db);
  const milestone = {
    campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'actor-shen',
    skillId: 'stealth', points: 2, encounterId: 'same-milestone',
  };
  const first = await session.grantMilestone(milestone);
  assert.equal(first.granted, 2);
  const row = () => db.prepare("SELECT practice_points FROM actor_skills WHERE branch_id='camp-s-main' AND actor_id='actor-shen' AND skill_id='stealth'").get().practice_points;
  const afterFirst = row();
  const second = await session.grantMilestone(milestone);
  assert.equal(second.granted, 0);
  assert.equal(second.replayed, true);
  assert.equal(row(), afterFirst, 'practice points unchanged by the replay');
  const ledger = db.prepare("SELECT COUNT(*) AS n FROM reward_ledger WHERE branch_id='camp-s-main' AND reward_kind='milestone' AND encounter_id='same-milestone'").get();
  assert.equal(ledger.n, 1);
  db.close();
});

test('A04: unachieved retries never farm practice — closure opens the next challenge', async () => {
  const db = setupDb();
  const { session, provider } = await makeSession(db, { random: RNG_MIN, initialSkills: ['stealth', 'sword'] });
  // Minimum dice: with a d6 pool and challenging (6) difficulty every roll
  // fails, so every retry stays inside the SAME open challenge.
  for (let i = 0; i < 5; i += 1) {
    await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: 'retry the same thing' });
  }
  const skill = db.prepare("SELECT practice_points, awarded_turns_json FROM actor_skills WHERE branch_id='camp-s-main' AND actor_id='actor-shen' AND skill_id='stealth'").get();
  assert.equal(skill.practice_points, 1, 'five failed retries of one challenge are worth one point');
  assert.ok(!skill.awarded_turns_json.includes(':closed'), 'an unachieved challenge never closes');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reward_ledger WHERE branch_id='camp-s-main'").get().n, 1);
  // A different skill opens its OWN challenge sequence.
  provider.override = payload => ({
    proposalVersion: '2.0', turnId: payload.turnId, expectedStateVersion: payload.expectedStateVersion,
    actorId: 'actor-shen', actionKind: 'skill_check', skillId: 'sword', difficultyBand: 'simple',
    evidenceIds: [], intent: 'draw the sword',
  });
  await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: 'draw the sword' });
  const sword = db.prepare("SELECT practice_points FROM actor_skills WHERE branch_id='camp-s-main' AND actor_id='actor-shen' AND skill_id='sword'").get();
  assert.equal(sword.practice_points, 1);
  db.close();
});

test('A04: automatic actions never award practice', async () => {
  const db = setupDb();
  const { session, provider } = await makeSession(db);
  provider.override = payload => ({
    proposalVersion: '2.0', turnId: payload.turnId, expectedStateVersion: payload.expectedStateVersion,
    actorId: 'actor-shen', actionKind: 'observe', evidenceIds: [], intent: 'look around',
  });
  await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: 'look around' });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reward_ledger WHERE branch_id='camp-s-main'").get().n, 0);
  db.close();
});

// ---------------------------------------------------------------------------
// A05: complete save round-trip, resumable after import
// ---------------------------------------------------------------------------

test('A05: exported save restores dependencies, cards, contracts and dice; play continues', async () => {
  const db = setupDb();
  const { session, adapter } = await makeSession(db);
  await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: 'sneak' });
  await session.rest({ campaignId: 'camp-s', branchId: 'camp-s-main', kind: 'short' });

  const exported = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex, campaignId: 'camp-s', branchId: 'camp-s-main', createdAt: 'review' });
  const validation = await validateSaveJson(exported.json, sha.sha256Hex);
  assert.deepEqual(validation, { ok: true, errors: [] });
  assert.equal(exported.save.manifest.schemaVersion, SAVE_SCHEMA_VERSION);
  assert.equal(exported.save.manifest.packageRevision, 1, 'dependency lock exported');

  await restoreSave({ db: adapter, save: exported.save, newCampaignId: 'restored-c', newBranchId: 'restored-b', createdAt: 'review' });
  const restored = await session.getSummary('restored-c', 'restored-b');
  assert.equal(restored.cards.length, 2, 'cards restored');
  assert.equal(restored.packageRevision, 1, 'package lock restored');

  const cont = await session.playTurn({ campaignId: 'restored-c', branchId: 'restored-b', intent: 'continue restored game' });
  assert.equal(cont.stateVersion, restored.state.stateVersion + 1, 'imported game really continues');

  // The reward ledger traveled with the save: replaying the original branch
  // history cannot double-award on the restored branch.
  const ledger = db.prepare("SELECT COUNT(*) AS n FROM reward_ledger WHERE branch_id='restored-b'").get();
  assert.ok(ledger.n >= 1, 'reward ledger restored');
  const rolls = db.prepare("SELECT COUNT(*) AS n FROM roll_records WHERE branch_id='restored-b'").get();
  assert.ok(rolls.n >= 1, 'roll records restored with full dice');
  const contracts = db.prepare("SELECT action_contract_json FROM turns WHERE branch_id='restored-b' AND action_contract_json <> '{}'").get();
  assert.ok(contracts, 'frozen contracts restored (not placeholder {})');
  db.close();
});

test('A05: a rolled-but-uncommitted turn resumes after import with its own dice', async () => {
  const db = setupDb();
  const { session, adapter, provider } = await makeSession(db);
  // First turn succeeds and commits; then stop the "process" mid-flight by
  // exporting right after a commit — the staged path is exercised by staging
  // a turn manually with a persisted roll.
  await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: 'sneak' });
  const turnStore = new SqliteTurnStore(adapter);
  const contractJson = JSON.stringify({
    protocolVersion: '1.0', turnId: 'turn-0002', expectedStateVersion: 1, actorId: 'actor-shen',
    actionType: 'skill_check', skillId: 'stealth', difficultyBand: 'challenging',
    evidenceIds: [], requiresRoll: true, intent: 'interrupted', timeCostMinutes: 10,
    resourcePreconditions: [],
    outcomes: {
      full_success: { achieved: true, publicSummary: 'ok', effects: [] },
      success: { achieved: true, publicSummary: 'ok', effects: [] },
      failure: { achieved: false, publicSummary: 'no', effects: [] },
      severe_failure: { achieved: false, publicSummary: 'bad', effects: [] },
    },
  });
  const contractHash = sha.sha256Hex(contractJson);
  await turnStore.stageRollTurn({ branchId: 'camp-s-main', turnId: 'turn-0002', expectedStateVersion: 1, actionContractJson: contractJson, actionContractHash: contractHash, createdAt: 't', status: 'AwaitRoll' });
  await turnStore.recordRoll('camp-s-main', {
    rulesetId: 'shineword-core', rulesetVersion: '0.1.0', turnId: 'turn-0002', rollIndex: 0,
    contractHash, diceCount: 3, dieSides: 6, rolls: [2, 5, 1], highest: 5, difficulty: 6,
    margin: -1, grade: 'failure', createdAt: 't',
  });

  const exported = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex, campaignId: 'camp-s', branchId: 'camp-s-main', createdAt: 'review' });
  await restoreSave({ db: adapter, save: exported.save, newCampaignId: 'rc2', newBranchId: 'rb2', createdAt: 'review' });
  const persistedRoll = db.prepare("SELECT rolls_json, grade FROM roll_records WHERE branch_id='rb2' AND turn_id='turn-0002'").get();
  assert.deepEqual(JSON.parse(persistedRoll.rolls_json), [2, 5, 1], 'the rolled dice traveled with the save');
  // Resuming the interrupted turn reuses the persisted roll — never re-rolls.
  provider.override = () => { throw new Error('planner must not be called during resume'); };
  const resumed = await session.playTurn({ campaignId: 'rc2', branchId: 'rb2', intent: 'resume', turnIdOverride: 'turn-0002' });
  assert.equal(resumed.resumed, true);
  assert.ok(resumed.dice.includes('2, 5, 1'), `reused the original dice, got ${resumed.dice}`);
  db.close();
});

test('A05: legacy v2 saves are refused with the documented upgrade policy', async () => {
  const db = setupDb();
  const { adapter } = await makeSession(db);
  const exported = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex, campaignId: 'camp-s', branchId: 'camp-s-main', createdAt: 't' });
  const legacy = JSON.parse(exported.json);
  legacy.manifest.schemaVersion = 'shineword-save-2';
  legacy.manifest.payloadSha256 = sha.sha256Hex(JSON.stringify({ legacy: true }));
  const validation = await validateSaveJson(JSON.stringify(legacy), sha.sha256Hex);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some(e => /Legacy shineword-save-2/.test(e)), validation.errors.join('; '));
  db.close();
});

// ---------------------------------------------------------------------------
// A06: player book views hide undiscovered entries
// ---------------------------------------------------------------------------

test('A06: discoverable entries stay hidden until discovered; edit view sees all', () => {
  const secret = entry('secret', 'lore', { name: '秘辛', title: 't', text: 'unlearned secret' }, { visibility: 'discoverable' });
  const pkg = {
    entries: [SKILL_STEALTH, secret],
    sections: [
      { book: 'monster_manual', sectionKey: 's', title: 's', entryIds: ['secret', 'stealth'], position: 0 },
    ],
  };
  const playerView = assembleBook(pkg, 'monster_manual', { includeGm: false });
  const playerIds = playerView.flatMap(g => g.entries.map(e => e.entryId));
  assert.ok(!playerIds.includes('secret'), 'undiscovered entry hidden');
  assert.ok(playerIds.includes('stealth'), 'public entry visible');

  const discoveredView = assembleBook(pkg, 'monster_manual', {
    includeGm: false, knowledge: { discoveredEntryIds: new Set(['secret']) },
  });
  assert.ok(discoveredView.flatMap(g => g.entries.map(e => e.entryId)).includes('secret'),
    'a real discovery record reveals the entry');

  const editView = assembleBook(pkg, 'monster_manual', { includeGm: true });
  assert.ok(editView.flatMap(g => g.entries.map(e => e.entryId)).includes('secret'),
    'the separate edit view sees everything');
});

// ---------------------------------------------------------------------------
// A07: zone connectivity, range covers, NPC legality
// ---------------------------------------------------------------------------

test('A07: disconnected zones are out_of_range, not far', () => {
  const zones = [
    { zoneId: 'a', exits: ['b'] },
    { zoneId: 'b', exits: ['a'] },
    { zoneId: 'isolated', exits: [] },
  ];
  assert.equal(distanceBetweenZones(zones, 'a', 'a'), 'near');
  assert.equal(distanceBetweenZones(zones, 'a', 'b'), 'mid');
  assert.equal(distanceBetweenZones(zones, 'a', 'isolated'), 'out_of_range');
  const chain = [
    { zoneId: 'a', exits: ['b'] }, { zoneId: 'b', exits: ['a', 'c'] },
    { zoneId: 'c', exits: ['b', 'd'] }, { zoneId: 'd', exits: ['c'] },
  ];
  assert.equal(distanceBetweenZones(chain, 'a', 'c'), 'far');
  assert.equal(distanceBetweenZones(chain, 'a', 'd'), 'out_of_range', 'three hops is out of range');
  assert.equal(distanceBetweenZones(chain, 'a', 'd'), 'out_of_range');
});

test('A07: touch attacks cannot cross bands; range covers are explicit', () => {
  assert.equal(rangeCoversBand('touch', 'near'), true);
  assert.equal(rangeCoversBand('touch', 'mid'), false);
  assert.equal(rangeCoversBand('touch', 'far'), false);
  assert.equal(rangeCoversBand('far', 'far'), true);
  assert.equal(rangeCoversBand('far', 'out_of_range'), false);
  assert.equal(rangeCoversBand('mid', 'near'), true);
});

test('A07: NPC policy never picks a medic/stealth skill as its weapon', () => {
  const { startEncounter } = require('../dist/domain/combat/encounter');
  const zones = [{ zoneId: 'z1', exits: ['z2'] }, { zoneId: 'z2', exits: ['z1'] }];
  const medicCard = {
    actorId: 'npc-medic', name: '医者', kind: 'npc', controller: 'gm',
    attributes: { physique: 1, agility: 1, insight: 3, knowledge: 2, willpower: 2, social: 2 },
    skills: { stealth: 'trained', sword: 'trained' }, abilities: [], preparedAbilities: [],
    resourceMax: { hp: 8, stamina: 8 }, defense: 2, powerTier: 'ordinary',
    rulesetId: 'shineword-core', rulesetVersion: '0.1.0', worldId: 'w', worldPackageRevision: 1, cardRevision: 1,
  };
  const foeCard = {
    actorId: 'foe', name: '敌手', kind: 'creature', controller: 'gm',
    attributes: { physique: 2, agility: 2, insight: 1, knowledge: 1, willpower: 1, social: 1 },
    skills: { sword: 'trained' }, abilities: [], preparedAbilities: [],
    resourceMax: { hp: 6, stamina: 6 }, defense: 2, powerTier: 'ordinary',
    rulesetId: 'shineword-core', rulesetVersion: '0.1.0', worldId: 'w', worldPackageRevision: 1, cardRevision: 1,
  };
  const encounter = startEncounter({
    encounterId: 'enc-1', scene: { sceneId: 's', coverSpotIds: [], exitIds: ['gate'] },
    actors: [
      { actorId: 'npc-medic', side: 'npc', hp: 8, maxHp: 8, stamina: 8, conditions: [] },
      { actorId: 'foe', side: 'player', hp: 6, maxHp: 6, stamina: 6, conditions: [] },
    ],
    initiative: ['npc-medic', 'foe'],
  }).state;
  const catalog = { stealth: SKILL_STEALTH.definition, sword: SKILL_SWORD.definition };
  const decision = decideNpcAction({
    actor: { actorId: 'npc-medic', card: medicCard, side: 'hostile', zoneId: 'z1', armor: 0, attackSkillIds: ['sword'] },
    encounter, combatants: [
      { actorId: 'npc-medic', card: medicCard, side: 'hostile', zoneId: 'z1', armor: 0, attackSkillIds: ['sword'] },
      { actorId: 'foe', card: foeCard, side: 'party', zoneId: 'z1', armor: 0, attackSkillIds: ['sword'] },
    ],
    catalog, zones,
  });
  assert.equal(decision.kind, 'attack');
  assert.equal(decision.skillId, 'sword', 'only the declared attack skill is chosen, never stealth');
});

test('A07: low-morale NPC retreats through a real scene exit', () => {
  const { startEncounter } = require('../dist/domain/combat/encounter');
  const zones = [{ zoneId: 'z1', exits: [] }];
  const weakling = {
    actorId: 'npc-w', name: '溃兵', kind: 'creature', controller: 'gm',
    attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 },
    skills: { sword: 'novice' }, abilities: [], preparedAbilities: [],
    resourceMax: { hp: 10, stamina: 10 }, defense: 2, powerTier: 'ordinary',
    rulesetId: 'shineword-core', rulesetVersion: '0.1.0', worldId: 'w', worldPackageRevision: 1, cardRevision: 1,
  };
  const hero = {
    actorId: 'hero', name: '主角', kind: 'original', controller: 'player',
    attributes: { physique: 3, agility: 2, insight: 1, knowledge: 1, willpower: 1, social: 1 },
    skills: { sword: 'trained' }, abilities: [], preparedAbilities: [],
    resourceMax: { hp: 10, stamina: 10 }, defense: 2, powerTier: 'ordinary',
    rulesetId: 'shineword-core', rulesetVersion: '0.1.0', worldId: 'w', worldPackageRevision: 1, cardRevision: 1,
  };
  const encounter = startEncounter({
    encounterId: 'enc-2', scene: { sceneId: 's', coverSpotIds: [], exitIds: ['north-gate'] },
    actors: [
      { actorId: 'npc-w', side: 'npc', hp: 1, maxHp: 10, stamina: 5, conditions: [] },
      { actorId: 'hero', side: 'player', hp: 10, maxHp: 10, stamina: 10, conditions: [] },
    ],
    initiative: ['npc-w', 'hero'],
  }).state;
  const decision = decideNpcAction({
    actor: { actorId: 'npc-w', card: weakling, side: 'hostile', zoneId: 'z1', armor: 0, attackSkillIds: ['sword'] },
    encounter,
    combatants: [
      { actorId: 'npc-w', card: weakling, side: 'hostile', zoneId: 'z1', armor: 0, attackSkillIds: ['sword'] },
      { actorId: 'hero', card: hero, side: 'party', zoneId: 'z1', armor: 0, attackSkillIds: ['sword'] },
    ],
    catalog: { sword: SKILL_SWORD.definition }, zones,
  });
  assert.deepEqual(decision, { kind: 'retreat', exitId: 'north-gate' }, 'retreat uses a scene exit that exists');
});

// ---------------------------------------------------------------------------
// G01: encounter scheduling end-to-end (initiative, attack, NPC turns,
// disable/rescue/retreat/end, cleanup, crash-resume via the envelope)
// ---------------------------------------------------------------------------

test('G01: encounter begin/attack/npc/rescue/retreat run through atomic commits', async () => {
  const db = setupDb();
  const { session } = await makeSession(db, { initialSkills: ['stealth', 'sword'] });

  // Put the party near a guard; begin an encounter with one hostile guard.
  const view = await session.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main',
    hostiles: [{ templateId: 'guard-template', count: 1 }],
  });
  assert.equal(view.status, 'active');
  assert.equal(view.actors.length, 3, 'player + companion + hostile');
  const hostile = view.actors.find(actor => actor.side === 'hostile');
  assert.ok(hostile, 'hostile instantiated from the template');
  assert.ok(view.initiative.length === 3, 'initiative frozen over all combatants');

  // The current actor must be whoever won initiative; loop until the player
  // acts, letting NPC turns run deterministically.
  let guardId = hostile.actorId;
  let steps = 0;
  let current = view;
  while (!current.currentActorIsPlayer && steps < 6) {
    current = await session.encounterNpcTurn({
      campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: current.encounterId,
    });
    steps += 1;
  }
  assert.ok(current.currentActorIsPlayer, 'initiative eventually reaches the player');

  // A touch-range attack against the adjacent-zone guard is refused locally
  // (A07); the standard move closes the distance first.
  await assert.rejects(
    () => session.encounterAttack({
      campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: current.encounterId, targetId: guardId,
    }),
    /cannot reach|不能/i,
    'range gate refuses cross-zone touch attacks',
  );
  const guardZone = current.actors.find(actor => actor.actorId === guardId).zoneId;
  await session.encounterMove({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: current.encounterId, toZoneId: guardZone,
  });

  // Player attacks the guard: dice come from the card, damage from the local
  // template, the encounter projection syncs from the committed state.
  const before = await session.getSummary('camp-s', 'camp-s-main');
  const afterAttack = await session.encounterAttack({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: current.encounterId, targetId: guardId,
  });
  assert.ok(afterAttack.lastDice, 'attack rolled card-driven dice');
  const afterState = await session.getSummary('camp-s', 'camp-s-main');
  assert.equal(afterState.state.stateVersion, before.state.stateVersion + 1,
    'each combat action is one versioned transaction');

  // Attacking out of turn / twice in one round is refused locally.
  if (afterAttack.currentActorIsPlayer) {
    await assert.rejects(
      () => session.encounterAttack({
        campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: current.encounterId, targetId: guardId,
      }),
      /不是玩家方角色|main action|攻击技能|范围|range|目标/i,
    );
  }

  // Retreat ends the encounter as escaped and cleans hostile projections.
  const retreated = await session.encounterRetreat({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: current.encounterId,
  });
  assert.equal(retreated.status, 'escaped');
  const cardsAfter = db.prepare("SELECT COUNT(*) AS n FROM actor_cards WHERE branch_id = 'camp-s-main' AND actor_id = ?").get(guardId);
  assert.equal(cardsAfter.n, 0, 'transient hostile card removed after the encounter');
  const statesAfter = db.prepare("SELECT COUNT(*) AS n FROM actor_states WHERE branch_id = 'camp-s-main' AND actor_id = ?").get(guardId);
  assert.equal(statesAfter.n, 0, 'transient hostile state removed');
  db.close();
});

test('G01: a fight to resolution disables the loser and syncs encounter state', async () => {
  const db = setupDb();
  const { session } = await makeSession(db, { initialSkills: ['stealth', 'sword'] });
  const view = await session.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main',
    hostiles: [{ templateId: 'guard-template', count: 1 }],
  });
  const guardId = view.actors.find(actor => actor.side === 'hostile').actorId;

  // Force the guard to 1 hp so one hit resolves the encounter.
  db.prepare("UPDATE actor_states SET resources_json = ? WHERE branch_id = 'camp-s-main' AND actor_id = ?")
    .run(JSON.stringify({ hp: 1, stamina: 4 }), guardId);
  const weak = await session.getEncounterView('camp-s', 'camp-s-main', view.encounterId);
  const weakGuard = weak.actors.find(actor => actor.actorId === guardId);
  weakGuard.hp = 1;

  let current = weak;
  let guardSteps = 0;
  let movedIntoRange = false;
  while (current.status === 'active' && guardSteps < 40) {
    if (current.currentActorIsPlayer) {
      if (!movedIntoRange) {
        const zone = current.actors.find(actor => actor.actorId === guardId).zoneId;
        const me = current.actors.find(actor => actor.isPlayer).zoneId;
        if (zone !== me) {
          current = await session.encounterMove({
            campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, toZoneId: zone,
          });
          continue;
        }
      }
      movedIntoRange = true;
      current = await session.encounterAttack({
        campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, targetId: guardId,
      });
    } else {
      current = await session.encounterNpcTurn({
        campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
      });
    }
    guardSteps += 1;
  }
  assert.equal(current.status, 'resolved', 'dropping the last hostile resolves the encounter');
  assert.ok(current.actors.every(actor => actor.side === 'party' || actor.hp <= 0));
  db.close();
});

// ---------------------------------------------------------------------------
// G04: batched mapping covers ALL facts (no silent 800-fact truncation)
// ---------------------------------------------------------------------------

test('G04: mapping runs in batches and every fact is offered to the mapper', async () => {
  const db = setupDb();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await seedWorld(db, worldStore, 'w-batch');
  await worldStore.upsertEntity({ worldId: 'w-batch', entityId: 'hero', type: 'character', name: '主角', firstSeenChapterId: null, aliases: [] }, 't');

  const { buildPackageFromCanon } = require('../dist/application/worldPackage/buildPackageFromCanon');
  const seenCounts = [];
  const provider = {
    async complete(request) {
      const payload = JSON.parse(request.user);
      seenCounts.push(payload.facts.length);
      const factIds = payload.facts.map(fact => fact.factId);
      return {
        text: JSON.stringify({
          skills: [{
            id: `skill-batch${seenCounts.length}`, name: `批次技能${seenCounts.length}`,
            description: 'x', attribute: 'agility', allowUntrained: true, requirements: [],
            powerTier: 'ordinary', provenanceKind: 'explicit',
            evidenceFactIds: [payload.facts[0].factId], rationale: 'r',
          }],
          constraints: [], actorTemplates: [], items: [],
          lore: factIds.slice(0, 3).map((factId, index) => ({
            id: `lore-b${seenCounts.length}-${index}`, name: `资料${index}`, title: 't',
            text: 'x', provenanceKind: 'explicit', evidenceFactIds: [factId], rationale: 'r',
          })),
        }),
        usage: null,
      };
    },
  };

  // 1601 facts => 3 batches (800 + 800 + 1); a single-call mapper would have
  // silently dropped 801 of them.
  for (let i = 0; i < 1601; i += 1) {
    await worldStore.saveFact({
      worldId: 'w-batch', factId: `fact-${i}`, subjectEntityId: 'hero',
      predicate: `trait-${i}`, value: { note: `n${i}` }, status: 'explicit', confidence: 0.9,
      validFrom: null, validTo: null, revealAt: null, scope: 'canon', sources: [],
    }, 't');
  }
  const result = await buildPackageFromCanon({
    worldStore, provider, sha256Hex: sha.sha256Hex, worldId: 'w-batch',
    sourceSha256: 'a'.repeat(64), mappingVersion: 'm1', createdAt: 't',
  });
  assert.deepEqual(seenCounts, [800, 800, 1], 'all 1601 facts were offered across 3 batches');
  assert.equal(result.manifest.status, 'published');
  const runtime = await getDatabaseRuntimeForTest(adapter);
  const validation = JSON.parse(
    (await runtime.db.queryOne('SELECT validation_json FROM world_packages WHERE world_id = ? AND revision = ?',
      ['w-batch', result.manifest.revision])).validation_json,
  );
  assert.equal(validation.factsOfferedToMapper, 1601, 'coverage is recorded honestly');
  assert.equal(validation.mappingBatches, 3);
  db.close();
});



async function getDatabaseRuntimeForTest(adapter) {
  return { db: adapter };
}

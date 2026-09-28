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
const { commitResolvedTurn } = require('../dist/application/turns/commitTurn');
const {
  distanceBetweenZones, rangeCoversBand, decideNpcAction, explainNpcDecision,
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
    // Keep ordinary fixture entries independent of absent imported facts;
    // provenance-gate tests seed real facts in their own setup.
    provenance: { kind: 'design_fill', sourceFactIds: [], rationale: '测试夹具中的审定设定' },
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
const OPENING_COURTYARD = entry('scene-open-courtyard', 'scene', {
  name: '庭院', description: '测试世界公开开局地点。', locationId: 'courtyard',
  zones: [
    { zoneId: 'z-a', name: '庭院入口', cover: false, exits: ['z-b', 'courtyard-exit'] },
    { zoneId: 'z-b', name: '井边', cover: true, exits: ['z-a', 'z-c', 'courtyard-exit'] },
    { zoneId: 'z-c', name: '回廊', cover: false, exits: ['z-b', 'courtyard-exit'] },
  ],
  actors: ['guard-template'], visibleItems: [], hazards: [], clues: [],
});
const ITEM_KIT = entry('item-field-kit', 'item', {
  name: '急救包', description: '测试用初始物品。', category: 'tool', effects: [], unique: true,
});
const ITEM_RELIC = entry('item-relic', 'item', {
  name: '旧铜令牌', description: '一枚旧铜令牌。', category: 'key', unique: true,
}, { visibility: 'gm' });
const GUARD_TEMPLATE = entry('guard-template', 'actor_template', {
  name: '藏书阁守卫', category: 'human', description: '巡逻守卫',
  attributes: { physique: 2, agility: 1, insight: 1 },
  skills: { sword: 'trained' }, hp: 6, stamina: 4, defense: 3,
  attacks: [{ name: '长刀', skillId: 'sword', damage: 2, range: 'touch' }],
  abilities: [], behavior: { goal: '守住入口', retreatThreshold: 0.25, morale: 'steady' },
  lootPolicy: '无掉落', threat: { damage: 2, durability: 2, actions: 1, control: 0, environment: 0 },
}, { visibility: 'gm' });
const COMPANION_TEMPLATE = entry('companion-template', 'actor_template', {
  ...GUARD_TEMPLATE.definition,
  name: '同行守卫',
  recruitment: {
    recruitable: true, openingEligible: true, minimumCloseness: 5,
    openingRelationship: { stance: 'friendly', closeness: 6 },
  },
  startingItems: ['item-field-kit'],
});
const FUTURE_COMPANION_TEMPLATE = entry('future-companion-template', 'actor_template', {
  ...COMPANION_TEMPLATE.definition,
  name: '未来同行者',
  recruitment: {
    recruitable: true, openingEligible: true, minimumCloseness: 5,
    validFromOrder: 10, openingRelationship: { stance: 'friendly', closeness: 6 },
  },
  startingItems: [],
});
const SOCIAL_CHARM = entry('charm', 'skill', {
  name: '说服', description: '以交涉改善关系', attribute: 'social',
  allowUntrained: false, requirements: [], powerTier: 'ordinary', usage: 'social',
});
const CLUE_NOTE = entry('clue-note', 'lore', {
  name: '暗号便笺', title: '暗号便笺', text: '守门人愿意协助携带者。',
}, { visibility: 'discoverable' });
const RECRUITABLE_NPC = entry('recruitable-npc', 'actor_template', {
  ...GUARD_TEMPLATE.definition,
  name: '谨慎的守门人',
  recruitment: { recruitable: true, openingEligible: false, minimumCloseness: 2 },
});
const RECRUITMENT_SCENE = entry('scene-courtyard', 'scene', {
  name: '庭院', description: '守门人驻守的庭院。', locationId: 'courtyard',
  zones: [
    { zoneId: 'gate', name: '门口', cover: false, exits: ['well'] },
    { zoneId: 'well', name: '井边', cover: true, exits: ['gate', 'steps'] },
    { zoneId: 'steps', name: '台阶', cover: false, exits: ['well'] },
  ],
  actors: ['recruitable-npc'], visibleItems: [], hazards: [], clues: ['clue-note'],
});

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

async function publishSample(worldStore, worldId = 'w-pkg', { lootItemIds = [], entryRevision = 1, includeRecruitmentScene = false } = {}) {
  const { publishWorldPackage } = require('../dist/application/worldPackage/publish');
  const guardTemplate = lootItemIds.length > 0
    ? {
        ...GUARD_TEMPLATE,
        definition: { ...GUARD_TEMPLATE.definition, lootItemIds: [...lootItemIds] },
        dependencyIds: [...lootItemIds],
      }
    : GUARD_TEMPLATE;
  const entries = [SKILL_STEALTH, SKILL_SWORD, LORE_RAIN, OPENING_COURTYARD, ITEM_KIT, COMPANION_TEMPLATE, FUTURE_COMPANION_TEMPLATE,
    ...(includeRecruitmentScene ? [SOCIAL_CHARM, CLUE_NOTE, RECRUITABLE_NPC, RECRUITMENT_SCENE] : []),
    ...(lootItemIds.length > 0 ? [ITEM_RELIC] : []), guardTemplate]
    .map(item => ({ ...item, revision: entryRevision }));
  const sections = [
    { book: 'player_handbook', sectionKey: 'skills', title: '技能', entryIds: ['stealth', 'sword', ...(includeRecruitmentScene ? ['charm'] : [])], position: 1 },
    { book: 'player_handbook', sectionKey: 'world', title: '世界', entryIds: ['lore-rain', ...(includeRecruitmentScene ? ['clue-note', 'scene-courtyard'] : [])], position: 0 },
    { book: 'player_handbook', sectionKey: 'items', title: '物品', entryIds: ['item-field-kit'], position: 3 },
    { book: 'monster_manual', sectionKey: 'humans', title: '人类对手', entryIds: ['guard-template', 'companion-template', ...(includeRecruitmentScene ? ['recruitable-npc'] : [])], position: 0 },
  ];
  return publishWorldPackage({
    worldStore, sha256Hex: sha.sha256Hex, worldId, sourceSha256: 'a'.repeat(64),
    mappingVersion: 'map-1', entries, sections, createdAt: 't',
  });
}

async function makeSession(db, { random = RNG_MAX, initialSkills = ['stealth'], lootItemIds = [], companionDirective, includeRecruitmentScene = false } = {}) {
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await seedWorld(db, worldStore);
  const pub = await publishSample(worldStore, 'w-pkg', { lootItemIds, includeRecruitmentScene });
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
    companions: [{ actorId: 'actor-su', templateId: 'companion-template', ...(companionDirective ? { directive: companionDirective } : {}) }],
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

test('engine-only rescue effects are accepted by engine contracts and remain forbidden to planner contracts', () => {
  const { validateActionContract } = require('../dist/domain/turns/contracts');
  const effect = { op: 'removeCondition', actorId: 'actor-su', conditionId: 'disabled' };
  const outcome = { achieved: true, publicSummary: '援救同伴', effects: [effect] };
  const contract = {
    protocolVersion: '1.0', turnId: 'engine-rescue-check', expectedStateVersion: 0,
    actorId: 'actor-shen', actionType: 'rescue', targetId: 'actor-su', evidenceIds: [],
    requiresRoll: false, intent: '援救同伴', timeCostMinutes: 0, resourcePreconditions: [],
    outcomes: { full_success: outcome, success: outcome, failure: outcome, severe_failure: outcome },
  };
  assert.deepEqual(validateActionContract(contract, 'engine'), []);
  assert.ok(validateActionContract(contract, 'planner').some(error => /removeCondition/.test(error)));
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

test('A08: GM templates stay private and direct template IDs cannot bypass recruitment authority', async () => {
  const db = setupDb();
  const { session, adapter, worldStore, provider } = await makeSession(db);
  const setup = await session.getWorldSetup('w-pkg', 5);
  const openingIds = setup.companionTemplates.map(item => item.entryId);
  assert.deepEqual(openingIds, ['companion-template']);
  assert.ok(!JSON.stringify(setup).includes('guard-template'));
  assert.ok(!JSON.stringify(setup).includes('藏书阁守卫'));
  assert.ok(!setup.encounterTemplates.some(item => item.entryId === 'guard-template'),
    'secret template IDs are also absent from the player encounter projection');
  assert.ok(!setup.encounterTemplates.some(item => item.entryId === 'future-companion-template'),
    'future templates stay outside the current time projection');
  const { projectPlayerEntriesAtAnchor } = require('../dist/application/campaign/session');
  const { assembleBook } = require('../dist/application/worldPackage/publish');
  const lockedPackage = await worldStore.getWorldPackage('w-pkg', setup.packageRevision);
  const playerEntries = projectPlayerEntriesAtAnchor(lockedPackage.entries, await worldStore.listFacts('w-pkg'), 5, new Set());
  const playerBooks = ['player_handbook', 'gm_guide', 'monster_manual'].flatMap(book =>
    assembleBook({ entries: playerEntries, sections: lockedPackage.sections }, book,
      { includeGm: false, knowledge: { discoveredEntryIds: new Set() } }));
  assert.ok(!JSON.stringify(playerBooks).includes('guard-template'));
  assert.ok(!JSON.stringify(playerBooks).includes('未来同行者'));
  assert.deepEqual(playerEntries.find(item => item.entryId === 'scene-open-courtyard').definition.actors, [],
    'the anchored three-book projection also strips private nested scene actor references');
  const futureSetup = await session.getWorldSetup('w-pkg', 10);
  assert.ok(futureSetup.companionTemplates.some(item => item.entryId === 'future-companion-template'));
  assert.ok(futureSetup.encounterTemplates.some(item => item.entryId === 'future-companion-template'));
  assert.ok(!JSON.stringify(futureSetup).includes('guard-template'));

  const { createCampaign } = require('../dist/application/campaign/createCampaign');
  const packageRevision = await worldStore.getPublishedPackageRevision('w-pkg');
  await assert.rejects(() => createCampaign({
    db: adapter, worldStore, campaignId: 'camp-gm-bypass', title: '越权开局', worldId: 'w-pkg',
    packageRevision, anchor: { worldTimeOrder: 5, locationId: 'courtyard' },
    protagonist: { actorId: 'player-bypass', kind: 'original', name: '越权者',
      attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 }, initialSkills: ['stealth'] },
    companions: [{ actorId: 'hidden-ally', templateId: 'guard-template' }], goal: '绕过 UI', createdAt: 'test',
  }), /不可招募|公开的资格/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE campaign_id='camp-gm-bypass'").get().n, 0,
    'server refusal leaves no partial campaign rows');
  await assert.rejects(() => session.recruitCompanion({
    campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'guard-template',
  }), /招募被拒绝/);
  assert.ok(!(await session.getSummary('camp-s', 'camp-s-main')).cards.some(card => card.kind === 'npc'));
  await assert.rejects(() => session.getCard('camp-s-main', 'npc-guard-template'), /玩家可见投影/);

  let plannerPayload = '';
  const complete = provider.complete.bind(provider);
  provider.complete = async request => {
    if (request.role === 'Planner') plannerPayload = request.user;
    return complete(request);
  };
  await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: '查看庭院环境' });
  assert.ok(!plannerPayload.includes('guard-template') && !plannerPayload.includes('藏书阁守卫'),
    'a public scene cannot leak a GM template through nested actor references or planner cards');

  await assert.rejects(() => createCampaign({
    db: adapter, worldStore, campaignId: 'camp-future-bypass', title: '越时开局', worldId: 'w-pkg',
    packageRevision, anchor: { worldTimeOrder: 5, locationId: 'courtyard' },
    protagonist: { actorId: 'player-future', kind: 'original', name: '越时者',
      attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 }, initialSkills: ['stealth'] },
    companions: [{ actorId: 'future-ally', templateId: 'future-companion-template' }],
    goal: '越过故事时间资格', createdAt: 'test',
  }), /不可招募|公开的资格/);

  await createCampaign({
    db: adapter, worldStore, campaignId: 'camp-other', title: '另一战役', worldId: 'w-pkg',
    packageRevision, anchor: { worldTimeOrder: 5, locationId: 'courtyard' },
    protagonist: { actorId: 'player-other', kind: 'original', name: '另一主角',
      attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 }, initialSkills: ['stealth'] },
    goal: '隔离战役验证', createdAt: 'test',
  });
  await assert.rejects(() => session.getSummary('camp-other', 'camp-s-main'), /does not belong/,
    'a valid campaign id cannot authorize reads from another campaign branch');

  const twoCompanions = await createCampaign({
    db: adapter, worldStore, campaignId: 'camp-two-companions', title: '双同伴开局', worldId: 'w-pkg',
    packageRevision, anchor: { worldTimeOrder: 10, locationId: 'courtyard' },
    protagonist: { actorId: 'player-two', kind: 'original', name: '同行者',
      attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 }, initialSkills: ['stealth'] },
    companions: [
      { actorId: 'ally-two-a', templateId: 'companion-template' },
      { actorId: 'ally-two-b', templateId: 'future-companion-template' },
    ],
    goal: '验证每支队伍单人加两名同伴', createdAt: 'test',
  });
  assert.equal(twoCompanions.cards.filter(card => card.controller === 'companion').length, 2);
  assert.equal(twoCompanions.snapshot.party.length, 3);

  await worldStore.upsertEntity({ worldId: 'w-pkg', entityId: 'canon-person', type: 'character',
    name: '锚点人物', firstSeenChapterId: null, aliases: [] }, 'test');
  const canonFacts = [
    { worldId: 'w-pkg', factId: 'canon-location', subjectEntityId: 'canon-person', predicate: 'current_location',
      value: { location: 'courtyard' }, status: 'explicit', confidence: 1, validFrom: null, validTo: null,
      revealAt: null, scope: 'world', sources: [] },
    { worldId: 'w-pkg', factId: 'canon-skill', subjectEntityId: 'canon-person', predicate: 'skill',
      value: { skill: '潜行' }, status: 'explicit', confidence: 1, validFrom: null, validTo: null,
      revealAt: null, scope: 'world', sources: [] },
  ];
  for (const fact of canonFacts) await worldStore.saveFact(fact, 'test');
  await worldStore.saveRuleMapping({ worldId: 'w-pkg', mappingId: 'canon-stealth', targetEntityId: 'canon-person',
    mappingKind: 'skill', mapping: { skillId: 'stealth', rank: 'trained' }, evidenceRefs: ['canon-skill'],
    rulesetVersion: '0.2.0', status: 'active' }, 'test');
  const canonCampaign = await createCampaign({
    db: adapter, worldStore, campaignId: 'camp-canon', title: '原著开局', worldId: 'w-pkg', packageRevision,
    anchor: { worldTimeOrder: 5, locationId: 'courtyard' },
    protagonist: { actorId: 'player-canon', kind: 'canon', name: '锚点人物', canonEntityId: 'canon-person' },
    goal: '检查锚点人物开局', createdAt: 'test',
  });
  assert.equal(canonCampaign.cards.find(card => card.controller === 'player').kind, 'canon');
  assert.equal(canonCampaign.cards.find(card => card.controller === 'player').skills.stealth, 'trained');
  assert.equal(canonCampaign.snapshot.actors['player-canon'].locationId, 'courtyard');
  db.close();
});

test('A11: recruitment, relationship, party lifecycle, knowledge and item lineage are versioned together', async () => {
  const db = setupDb();
  const { session, adapter, provider } = await makeSession(db, {
    initialSkills: ['charm'], includeRecruitmentScene: true,
  });
  const options0 = await session.getRecruitmentOptions('camp-s', 'camp-s-main');
  assert.equal(options0.length, 1);
  assert.equal(options0[0].eligible, false);
  assert.match(options0[0].reason, /关系尚不足/);
  await assert.rejects(() => session.recruitCompanion({
    campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'recruitable-npc',
  }), /招募被拒绝/);
  await assert.rejects(() => session.recruitCompanion({
    campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'npc-recruitable-npc',
  }), /关系尚不足/);

  provider.override = payload => ({
    proposalVersion: '2.0', turnId: payload.turnId, expectedStateVersion: payload.expectedStateVersion,
    actorId: 'actor-shen', actionKind: 'skill_check', skillId: 'charm', difficultyBand: 'normal',
    targetId: 'npc-recruitable-npc', evidenceIds: [], intent: payload.playerIntent,
  });
  await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: '礼貌交涉一次' });
  await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: '继续交涉' });
  assert.ok((await session.getRecruitmentOptions('camp-s', 'camp-s-main'))[0].eligible,
    'a successful social skill action advances the local relationship threshold');
  await session.recruitCompanion({
    campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'npc-recruitable-npc', directive: 'follow',
  });
  let summary = await session.getSummary('camp-s', 'camp-s-main');
  const turnStore = new SqliteTurnStore(adapter);
  let state = await turnStore.getState('camp-s-main');
  const makeEngineContract = (turnId, actorId, effect) => {
    const outcome = { achieved: true, publicSummary: 'test engine state', effects: effect ? [effect] : [] };
    return { protocolVersion: '1.0', turnId, expectedStateVersion: state.stateVersion, actorId,
      actionType: 'test_state', evidenceIds: [], requiresRoll: false, intent: 'test state', timeCostMinutes: 0,
      resourcePreconditions: [], outcomes: { full_success: outcome, success: outcome, failure: outcome, severe_failure: outcome } };
  };
  const commitEngine = async (contract, updateNextState) => commitResolvedTurn({ store: turnStore, branchId: 'camp-s-main', contract,
    contractHash: sha.sha256Hex(JSON.stringify(contract)), contractOrigin: 'engine', outcomeGrade: 'success', updateNextState });
  assert.ok(summary.state.party.some(member => member.actorId === 'npc-recruitable-npc' && member.role === 'companion'));
  assert.equal(summary.state.itemOwners['item-field-kit'], 'actor-su');
  assert.equal(summary.state.itemSources['item-field-kit'].kind, 'starting_loadout');
  assert.ok(!summary.cards.some(card => card.kind === 'npc'), 'full NPC card never enters the player projection');

  provider.override = payload => ({
    proposalVersion: '2.0', turnId: payload.turnId, expectedStateVersion: payload.expectedStateVersion,
    actorId: 'actor-shen', actionKind: 'observe', evidenceIds: ['clue-note'], intent: payload.playerIntent,
  });
  await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: '调查便笺' });
  summary = await session.getSummary('camp-s', 'camp-s-main');
  assert.ok(summary.state.discoveries.some(item => item.actorId === 'actor-shen' && item.entryId === 'clue-note'));
  assert.ok(!summary.state.discoveries.some(item => item.actorId === 'actor-su' && item.entryId === 'clue-note'),
    'discoveries are not implicitly copied to companions');
  await assert.rejects(() => session.shareKnowledge({ campaignId: 'camp-s', branchId: 'camp-s-main',
    sourceActorId: 'actor-shen', recipientActorId: 'npc-guard-template', entryId: 'clue-note', channel: 'conversation' }), /队伍角色显式传递/,
    'a direct actor ID cannot grant a player discovery to a GM-controlled NPC');
  const versionBeforeInvalidShare = summary.state.stateVersion;
  await assert.rejects(() => session.shareKnowledge({ campaignId: 'camp-s', branchId: 'camp-s-main',
    sourceActorId: 'actor-shen', recipientActorId: 'actor-su', entryId: 'clue-note', channel: 'broadcast' }), /通信方式必须明确/);
  assert.equal((await session.getSummary('camp-s', 'camp-s-main')).state.stateVersion, versionBeforeInvalidShare,
    'an unrecognized communication channel has no state effect');
  state = await turnStore.getState('camp-s-main');
  await commitEngine(makeEngineContract('test-signal-out-of-range', 'actor-shen'),
    next => { next.actors['actor-su'].zoneId = 'z-c'; });
  await assert.rejects(() => session.shareKnowledge({ campaignId: 'camp-s', branchId: 'camp-s-main',
    sourceActorId: 'actor-shen', recipientActorId: 'actor-su', entryId: 'clue-note', channel: 'signal' }), /同区或相邻区域/);
  state = await turnStore.getState('camp-s-main');
  await commitEngine(makeEngineContract('test-signal-return', 'actor-shen'),
    next => { next.actors['actor-su'].zoneId = 'z-a'; });
  await session.shareKnowledge({ campaignId: 'camp-s', branchId: 'camp-s-main', sourceActorId: 'actor-shen',
    recipientActorId: 'actor-su', entryId: 'clue-note', channel: 'conversation' });
  summary = await session.getSummary('camp-s', 'camp-s-main');
  assert.ok(summary.state.discoveries.some(item => item.actorId === 'actor-su' && item.entryId === 'clue-note' && item.knownVia === 'told'));

  await session.setCompanionDirective({ campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'actor-su', directive: 'protect' });
  await session.splitCompanions({ campaignId: 'camp-s', branchId: 'camp-s-main', actorIds: ['actor-su'], groupId: 'group-scout' });
  summary = await session.getSummary('camp-s', 'camp-s-main');
  const splitVersion = summary.state.stateVersion;
  assert.equal(summary.state.party.find(member => member.actorId === 'actor-su').groupId, 'group-scout');
  assert.equal(JSON.parse(db.prepare("SELECT card_json FROM actor_cards WHERE branch_id='camp-s-main' AND actor_id='actor-su'").get().card_json).companionDirective, 'protect');
  await assert.rejects(() => session.getCard('camp-s-main', 'actor-su'), /玩家可见投影/,
    'the separated companion card is hidden from the main group view');

  await session.rewind({ campaignId: 'camp-s', sourceBranchId: 'camp-s-main', atStateVersion: splitVersion, newBranchId: 'camp-s-rewound' });
  const rewound = await session.getSummary('camp-s', 'camp-s-rewound');
  assert.equal(rewound.state.party.find(member => member.actorId === 'actor-su').groupId, 'group-scout');
  assert.equal(rewound.state.itemSources['item-field-kit'].sourceId, 'companion-template');
  await session.rejoinCompanion({ campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'actor-su' });

  state = await turnStore.getState('camp-s-main');
  const companionHp = state.actors['actor-su'].resources.hp;
  await commitEngine(makeEngineContract('test-companion-critical', 'actor-shen', {
    op: 'consumeResource', actorId: 'actor-su', resourceId: 'hp', amount: companionHp,
  }));
  state = await turnStore.getState('camp-s-main');
  assert.equal(state.actors['actor-su'].lifeStatus, 'critical', 'zero HP is a persisted critical state');
  await assert.rejects(() => session.leaveCompanion({ campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'actor-su' }), /失能或濒危/);
  await commitEngine(makeEngineContract('test-companion-rescued', 'actor-shen', {
    op: 'restoreResource', actorId: 'actor-su', resourceId: 'hp', amount: 1, cap: 6,
  }));
  state = await turnStore.getState('camp-s-main');
  assert.equal(state.actors['actor-su'].lifeStatus, 'active', 'explicit HP rescue returns the actor to active');

  await session.leaveCompanion({ campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'actor-su' });
  const rejoinOption = (await session.getRejoinOptions('camp-s', 'camp-s-main')).find(item => item.actorId === 'actor-su');
  assert.equal(rejoinOption.eligible, true);
  await session.rejoinCompanion({ campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'actor-su' });
  summary = await session.getSummary('camp-s', 'camp-s-main');
  assert.equal(summary.state.party.find(member => member.actorId === 'actor-su').groupId, 'main');
  await session.transferItem({ campaignId: 'camp-s', branchId: 'camp-s-main', itemId: 'item-field-kit',
    fromActorId: 'actor-su', toActorId: 'actor-shen' });
  summary = await session.getSummary('camp-s', 'camp-s-main');
  assert.equal(summary.state.itemOwners['item-field-kit'], 'actor-shen');
  assert.equal(summary.state.itemSources['item-field-kit'].kind, 'transfer');
  await assert.rejects(() => session.transferItem({ campaignId: 'camp-s', branchId: 'camp-s-main', itemId: 'item-field-kit',
    fromActorId: 'actor-su', toActorId: 'actor-shen' }), /当前归属 actor-shen/);
  state = await turnStore.getState('camp-s-main');
  const playerHp = state.actors['actor-shen'].resources.hp;
  await commitEngine(makeEngineContract('test-player-critical', 'actor-shen', {
    op: 'consumeResource', actorId: 'actor-shen', resourceId: 'hp', amount: playerHp,
  }));
  state = await turnStore.getState('camp-s-main');
  const criticalVersion = state.stateVersion;
  assert.equal(state.actors['actor-shen'].lifeStatus, 'critical');
  await assert.rejects(() => session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: '濒危时继续行动' }), /失能或濒危/);
  await assert.rejects(() => session.rest({ campaignId: 'camp-s', branchId: 'camp-s-main', kind: 'long' }), /失能或濒危/);
  await assert.rejects(() => session.trainSkill({ campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'actor-shen', skillId: 'charm' }), /失能或濒危/);
  assert.equal((await turnStore.getState('camp-s-main')).stateVersion, criticalVersion,
    'critical-state refusals do not commit actions or advance time');
  await commitEngine(makeEngineContract('test-companion-death-resolved', 'actor-shen'), next => {
    next.actors['actor-su'].resources.hp = 0;
    next.actors['actor-su'].conditions = ['disabled'];
    next.actors['actor-su'].lifeStatus = 'dead';
  });
  state = await turnStore.getState('camp-s-main');
  assert.equal(state.actors['actor-su'].lifeStatus, 'dead');
  await assert.rejects(() => session.leaveCompanion({ campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'actor-su' }), /失能或濒危/);
  const deadVersion = state.stateVersion;
  await assert.rejects(() => commitEngine(makeEngineContract('test-no-ordinary-revival', 'actor-shen', {
    op: 'restoreResource', actorId: 'actor-su', resourceId: 'hp', amount: 1, cap: 6,
  })), /Dead actor/);
  assert.equal((await turnStore.getState('camp-s-main')).stateVersion, deadVersion,
    'an ordinary healing effect cannot reverse a resolved death or partially commit');
  assert.deepEqual(new Set(db.prepare("SELECT event_type FROM branch_events WHERE branch_id='camp-s-main'").all().map(row => row.event_type)),
    new Set(['relationship_changed', 'companion_recruited', 'knowledge_discovered', 'knowledge_shared', 'companion_directive_changed',
      'party_split', 'companion_left', 'companion_rejoined', 'item_transferred', 'consumeResource', 'restoreResource',
      'actor_entered_critical_state', 'actor_recovered_from_critical', 'actor_death_resolved']));

  const exported = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex, campaignId: 'camp-s', branchId: 'camp-s-main', createdAt: 'lifecycle' });
  await restoreSave({ db: adapter, save: exported.save, newCampaignId: 'camp-lifecycle-copy', newBranchId: 'branch-lifecycle-copy', createdAt: 'lifecycle' });
  const restored = await session.getSummary('camp-lifecycle-copy', 'branch-lifecycle-copy');
  assert.equal(restored.state.itemSources['item-field-kit'].kind, 'transfer');
  assert.equal(restored.state.party.find(member => member.actorId === 'actor-su').groupId, 'main');
  assert.equal(restored.state.actors['actor-su'].lifeStatus, 'dead', 'death-risk outcome is in the save snapshot');
  assert.ok(restored.state.discoveries.some(item => item.actorId === 'actor-su' && item.entryId === 'clue-note' && item.knownVia === 'told'));
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
    cooldownRounds: 1, passive: false, powerTier: 'ordinary',
  });
  const entries = [SKILL_STEALTH, SKILL_SWORD, LORE_RAIN, OPENING_COURTYARD, GUARD_TEMPLATE, HEAL]
    .map(item => item.entryId === 'scene-open-courtyard'
      ? { ...item, definition: { ...item.definition, locationId: 'camp' } }
      : item);
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
  assert.equal(after.state.actors['actor-shen'].abilityCooldowns['ability-bandage'], after.state.stateVersion + 1,
    'cooldown is stored in the complete versioned snapshot');
  await assert.rejects(
    () => session.playTurn({ campaignId: 'camp-h', branchId: 'camp-h-main', intent: '再次包扎自己' }),
    /冷却中/,
    'a prepared, learned ability still cannot bypass its cooldown',
  );
  const afterRefusal = await session.getSummary('camp-h', 'camp-h-main');
  assert.equal(afterRefusal.state.stateVersion, after.state.stateVersion, 'a cooldown refusal has no action cost');
  assert.equal(afterRefusal.state.actors['actor-shen'].resources.stamina, 4, 'a refused cooldown does not spend stamina');
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
  const zones = [{ zoneId: 'z1', exits: ['north-gate'] }];
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

test('Phase 2: companion directives and neutral faction semantics are deterministic', () => {
  const { startEncounter } = require('../dist/domain/combat/encounter');
  const zones = [
    { zoneId: 'z1', exits: ['z2'] },
    { zoneId: 'z2', exits: ['z1', 'z3', 'north-gate'] },
    { zoneId: 'z3', exits: ['z2'] },
  ];
  const card = (actorId, kind, controller, extra = {}) => ({
    actorId, name: actorId, kind, controller,
    attributes: { physique: 1, agility: 2, insight: 1, knowledge: 1, willpower: 1, social: 1 },
    skills: { sword: 'trained' }, abilities: [], preparedAbilities: [],
    resourceMax: { hp: 10, stamina: 10 }, defense: 2, powerTier: 'ordinary',
    rulesetId: 'shineword-v02', rulesetVersion: '0.2', worldId: 'w', worldPackageRevision: 1, cardRevision: 1,
    ...extra,
  });
  const hero = card('hero', 'original', 'player');
  const companion = card('ally', 'companion', 'companion', {
    companionLeaderActorId: 'hero', combatAttacks: [{ skillId: 'sword', range: 'far' }],
  });
  const nearThreat = card('near-threat', 'npc', 'gm');
  const weakThreat = card('weak-threat', 'npc', 'gm');
  const makeDecisionCase = ({ directive, actorSide = 'party', actorZone = 'z2', actorHp = 10,
    allyHp = 10, allyConditions = [], firstThreatHp = 5, secondThreatHp = 1, secondThreatZone = 'z3',
    attackRange = 'far', exits = ['north-gate'] } = {}) => {
    const actorCard = { ...companion, companionDirective: directive,
      combatAttacks: [{ skillId: 'sword', range: attackRange }] };
    const combatants = [
      { actorId: 'hero', card: hero, side: 'party', zoneId: 'z1', armor: 0, attackSkillIds: ['sword'] },
      { actorId: 'ally', card: actorCard, side: actorSide, zoneId: actorZone, armor: 0, attackSkillIds: ['sword'] },
      { actorId: 'near-threat', card: nearThreat, side: 'hostile', zoneId: 'z1', armor: 0, attackSkillIds: ['sword'] },
      { actorId: 'weak-threat', card: weakThreat, side: 'hostile', zoneId: secondThreatZone, armor: 0, attackSkillIds: ['sword'] },
    ];
    const encounter = startEncounter({
      encounterId: `directive-${directive ?? actorSide}`,
      scene: { sceneId: 's', coverSpotIds: [], exitIds: exits },
      actors: [
        { actorId: 'hero', side: 'player', hp: allyHp, maxHp: 10, stamina: 5, conditions: allyConditions },
        { actorId: 'ally', side: actorSide === 'neutral' ? 'neutral' : 'player', hp: actorHp, maxHp: 10, stamina: 5, conditions: [] },
        { actorId: 'near-threat', side: 'npc', hp: firstThreatHp, maxHp: 10, stamina: 5, conditions: [] },
        { actorId: 'weak-threat', side: 'npc', hp: secondThreatHp, maxHp: 10, stamina: 5, conditions: [] },
      ],
      initiative: ['hero', 'ally', 'near-threat', 'weak-threat'],
    }).state;
    const actor = { ...combatants[1], card: actorCard };
    const decision = decideNpcAction({
      actor, encounter, combatants,
      catalog: { sword: SKILL_SWORD.definition }, zones,
    });
    return { actor, encounter, combatants, zones, decision };
  };
  const makeDecision = options => makeDecisionCase(options).decision;

  assert.equal(makeDecision({ directive: 'follow', actorZone: 'z3' }).kind, 'move',
    'follow closes distance to its persisted leader');
  assert.deepEqual(makeDecision({ directive: 'support', actorZone: 'z1', allyHp: 0, allyConditions: ['disabled'] }),
    { kind: 'rescue', targetId: 'hero' }, 'support uses the same legal rescue action when an ally is disabled in-zone');
  assert.deepEqual(makeDecision({ directive: 'protect' }),
    { kind: 'attack', targetId: 'near-threat', skillId: 'sword' },
    'protect prioritizes the hostile near its leader over a weaker distant hostile');
  assert.deepEqual(makeDecision({ directive: undefined }),
    { kind: 'attack', targetId: 'weak-threat', skillId: 'sword' },
    'the default policy remains the weakest legal target');
  assert.equal(makeDecision({ directive: 'conserve', attackRange: 'touch' }).kind, 'guard',
    'conserve does not spend a main action chasing a target outside melee range');
  assert.deepEqual(makeDecision({ directive: 'retreat' }),
    { kind: 'retreat', exitId: 'north-gate' }, 'retreat directive exits without inventing a roll');
  assert.deepEqual(makeDecision({ directive: undefined, actorSide: 'neutral' }), { kind: 'guard' },
    'neutral actors are not automatically hostile to either faction');
  assert.deepEqual(makeDecision({ actorHp: 5, exits: ['north-gate'] }), { kind: 'attack', targetId: 'weak-threat', skillId: 'sword' },
    'ordinary template morale does not retreat above its threshold');
  assert.equal(makeDecision({ actorHp: 1, exits: [] }).kind, 'attack',
    'low morale cannot retreat when the scene has no connected exit');
  const supportDeclined = makeDecisionCase({ directive: 'support', actorZone: 'z3',
    secondThreatZone: 'z1', attackRange: 'touch' });
  assert.deepEqual(supportDeclined.decision, { kind: 'move', towardActorId: 'weak-threat' });
  assert.match(explainNpcDecision(supportDeclined), /支援指令未触发：同一区域没有满足规则的失能队友.*接近 weak-threat/,
    'a support no-op reports both the missing aid condition and the deterministic fallback action');
  const moraleCard = { ...companion, kind: 'npc', combatBehavior: { retreatThreshold: 0.75, morale: 'low' } };
  const moraleState = startEncounter({
    encounterId: 'template-morale', scene: { sceneId: 's', coverSpotIds: [], exitIds: ['north-gate'] },
    actors: [
      { actorId: 'ally', side: 'npc', hp: 5, maxHp: 10, stamina: 5, conditions: [] },
      { actorId: 'hero', side: 'player', hp: 10, maxHp: 10, stamina: 5, conditions: [] },
    ], initiative: ['ally', 'hero'],
  }).state;
  assert.deepEqual(decideNpcAction({
    actor: { actorId: 'ally', card: moraleCard, side: 'hostile', zoneId: 'z1', armor: 0, attackSkillIds: ['sword'] },
    encounter: moraleState,
    combatants: [
      { actorId: 'ally', card: moraleCard, side: 'hostile', zoneId: 'z1', armor: 0, attackSkillIds: ['sword'] },
      { actorId: 'hero', card: hero, side: 'party', zoneId: 'z1', armor: 0, attackSkillIds: ['sword'] },
    ], catalog: { sword: SKILL_SWORD.definition }, zones: [{ zoneId: 'z1', exits: ['north-gate'] }],
  }), { kind: 'retreat', exitId: 'north-gate' }, 'template-authored morale threshold overrides the generic fallback');
});

test('Phase 2: neutral encounter actors persist as neutral and commit a no-target guard turn', async () => {
  const db = setupDb();
  const { session } = await makeSession(db, { initialSkills: ['stealth', 'sword'] });
  let view = await session.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: 'neutral-side',
    hostiles: [{ templateId: 'guard-template' }],
    neutrals: [{ templateId: 'guard-template' }],
  });
  const neutral = view.actors.find(actor => actor.side === 'neutral');
  assert.ok(neutral, 'the service projects neutral as a separate faction');
  assert.equal(db.prepare("SELECT side FROM encounter_actors WHERE branch_id = 'camp-s-main' AND encounter_id = 'neutral-side' AND actor_id = ?")
    .get(neutral.actorId).side, 'neutral', 'SQLite stores the faction without collapsing it into npc/hostile');
  const neutralHp = neutral.hp;
  let steps = 0;
  while (view.currentActorId !== neutral.actorId && view.status === 'active' && steps < 8) {
    view = view.currentActorIsPlayer
      ? await session.encounterPassTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId: `neutral-reach-${steps}` })
      : await session.encounterNpcTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId: `neutral-reach-${steps}` });
    steps += 1;
  }
  assert.equal(view.currentActorId, neutral.actorId, 'neutral receives its own frozen initiative slot');
  view = await session.encounterNpcTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId: 'neutral-safe-turn' });
  assert.equal(view.lastDice, null, 'the neutral guard action does not secretly attack or roll');
  assert.match(view.lastAction, /戒备/);
  assert.match(view.lastAction, /依据：中立阵营不会自动选择敌对目标/,
    'the committed player-facing event states why the neutral actor passed');
  const resumed = await session.getActiveEncounter('camp-s', 'camp-s-main');
  assert.equal(resumed.actors.find(actor => actor.actorId === neutral.actorId).side, 'neutral',
    'the reloaded active encounter retains the neutral side');
  assert.equal(resumed.actors.find(actor => actor.actorId === neutral.actorId).hp, neutralHp,
    'neutral policy does not damage either side');
  db.close();
});

test('Phase 2: support instruction commits a legal companion rescue', async () => {
  const db = setupDb();
  const { session } = await makeSession(db, { initialSkills: ['stealth', 'sword'], companionDirective: 'support' });
  db.prepare("UPDATE actor_states SET resources_json = ?, conditions_json = ? WHERE branch_id = 'camp-s-main' AND actor_id = 'actor-shen'")
    .run(JSON.stringify({ hp: 0, stamina: 10 }), JSON.stringify(['disabled']));
  let view = await session.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: 'companion-support',
    hostiles: [{ templateId: 'guard-template' }],
  });
  const companionCard = JSON.parse(db.prepare("SELECT card_json FROM actor_cards WHERE branch_id = 'camp-s-main' AND actor_id = 'actor-su'").get().card_json);
  assert.equal(companionCard.companionDirective, 'support');
  assert.equal(companionCard.companionLeaderActorId, 'actor-shen');
  assert.equal(view.currentActorId, 'actor-su', 'the living support companion gets the first conscious slot');
  view = await session.encounterNpcTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId: 'companion-support-rescue' });
  const rescued = (await session.getSummary('camp-s', 'camp-s-main')).state.actors['actor-shen'];
  assert.equal(rescued.resources.hp, 1);
  assert.deepEqual(rescued.conditions, []);
  assert.match(view.lastAction, /援救|救回/);
  assert.match(view.lastAction, /依据：遵循支援指令/,
    'the committed rescue explains the directive and eligibility basis');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM branch_events WHERE branch_id = 'camp-s-main' AND event_type = 'recordEvent' AND payload_json LIKE '%ally_rescued%'").get().n, 1,
    'the rescue is a single committed event in the action transaction');
  db.close();
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

test('G01: AI companions control their own turn, move into range and attack once', async () => {
  const db = setupDb();
  const { session } = await makeSession(db, { initialSkills: ['stealth', 'sword'] });
  let view = await session.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: 'companion-ai',
    hostiles: [{ templateId: 'guard-template', count: 1 }],
  });
  let steps = 0;
  while (view.currentActorId !== 'actor-su' && steps < 8) {
    const requestId = `reach-companion-${steps}`;
    view = view.currentActorIsPlayer
      ? await session.encounterPassTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId })
      : await session.encounterNpcTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId });
    steps += 1;
  }
  assert.equal(view.currentActorId, 'actor-su', 'initiative reaches the companion');
  assert.equal(view.currentActorIsPlayer, false, 'a companion slot is controlled by the deterministic AI');
  const hostileId = view.actors.find(actor => actor.side === 'hostile').actorId;
  const stateBeforeRefusal = await session.getSummary('camp-s', 'camp-s-main');
  await assert.rejects(
    () => session.encounterAttack({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, targetId: hostileId }),
    /自动策略|自动行动/,
    'the player cannot directly choose a companion attack',
  );
  const adjacentZone = view.zones.find(zone => zone.zoneId !== view.actors.find(actor => actor.actorId === 'actor-su').zoneId
    && zone.exits.includes(view.actors.find(actor => actor.actorId === 'actor-su').zoneId))?.zoneId;
  assert.ok(adjacentZone, 'fixture exposes a legal adjacent movement zone');
  await assert.rejects(
    () => session.encounterMove({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
      actorId: 'actor-su', toZoneId: adjacentZone }),
    /移动目标必须由玩家控制/,
    'the player cannot move a companion directly',
  );
  await assert.rejects(
    () => session.encounterPassTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId }),
    /当前行动者不是玩家方角色/,
    'the companion AI, rather than the player, spends its action slot',
  );
  assert.equal((await session.getSummary('camp-s', 'camp-s-main')).state.stateVersion, stateBeforeRefusal.state.stateVersion,
    'refused direct commands have no action cost');

  const companionZone = view.actors.find(actor => actor.actorId === 'actor-su').zoneId;
  view = await session.encounterNpcTurn({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId: 'companion-close-distance',
  });
  assert.equal(view.currentActorId, 'actor-su', 'a standard move leaves the companion in its same major-action slot');
  assert.equal(view.actors.find(actor => actor.actorId === 'actor-su').movedThisRound, true);
  assert.notEqual(view.actors.find(actor => actor.actorId === 'actor-su').zoneId, companionZone,
    'the companion moves one adjacent zone to close distance');
  const hpBeforeAttack = view.actors.find(actor => actor.actorId === hostileId).hp;

  view = await session.encounterNpcTurn({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId: 'companion-legal-attack',
  });
  assert.ok(view.lastDice, 'the companion commits a card-driven attack');
  assert.ok(view.actors.find(actor => actor.actorId === hostileId).hp < hpBeforeAttack,
    'the legal companion attack changes the hostile state');
  assert.notEqual(view.currentActorId, 'actor-su', 'the attack spends the companion major action exactly once');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM reward_ledger
    WHERE branch_id = ? AND encounter_id = ? AND actor_id = 'actor-su' AND skill_id = 'sword' AND reward_kind = 'practice'`)
    .get('camp-s-main', view.encounterId).n, 1, 'companion practice settles atomically with its attack');
  db.close();
});

test('G01: a fight to resolution disables the loser and syncs encounter state', async () => {
  const db = setupDb();
  const { session } = await makeSession(db, { initialSkills: ['stealth', 'sword'], lootItemIds: ['item-relic'] });
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
  const resolved = await session.getSummary('camp-s', 'camp-s-main');
  assert.equal(resolved.state.itemOwners['item-relic'], 'actor-shen',
    'published template loot goes to the living player and is included in the resolved snapshot');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory WHERE branch_id = 'camp-s-main' AND item_id = 'item-relic'").get().n, 1,
    'the engine grants the declared item exactly once');
  db.close();
});

test('G01: an NPC retreat removes only that combatant while other hostiles remain', async () => {
  const db = setupDb();
  const { session } = await makeSession(db, { initialSkills: ['stealth', 'sword'] });
  const started = await session.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: 'one-npc-retreat',
    hostiles: [{ templateId: 'guard-template', count: 2 }],
  });
  const retreatingId = 'guard-template-h1';
  const remainingId = 'guard-template-h2';
  const initiativeIndex = started.initiative.indexOf(retreatingId);
  assert.ok(initiativeIndex >= 0);

  // Set up the local low-morale condition in both authoritative resources and
  // the encounter projection, then give this actor the next initiative slot.
  db.prepare("UPDATE actor_states SET resources_json = ? WHERE branch_id = 'camp-s-main' AND actor_id = ?")
    .run(JSON.stringify({ hp: 1, stamina: 4 }), retreatingId);
  db.prepare("UPDATE encounter_actors SET hp = 1 WHERE branch_id = 'camp-s-main' AND encounter_id = ? AND actor_id = ?")
    .run(started.encounterId, retreatingId);
  db.prepare("UPDATE encounters SET turn_cursor = ? WHERE branch_id = 'camp-s-main' AND encounter_id = ?")
    .run(initiativeIndex, started.encounterId);

  const before = await session.getSummary('camp-s', 'camp-s-main');
  const result = await session.encounterNpcTurn({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: started.encounterId,
    requestId: 'retreat-guard-1',
  });
  const after = await session.getSummary('camp-s', 'camp-s-main');
  assert.equal(result.status, 'active', 'one fleeing NPC does not end the whole encounter');
  assert.ok(!result.initiative.includes(retreatingId), 'the fleeing NPC leaves the remaining initiative');
  assert.ok(result.initiative.includes(remainingId), 'the other hostile keeps its initiative slot');
  assert.equal(result.actors.find(actor => actor.actorId === retreatingId).hp, 0);
  assert.ok(result.actors.find(actor => actor.actorId === retreatingId).conditions.includes('retreated'));
  assert.ok(result.actors.find(actor => actor.actorId === remainingId).hp > 0);
  assert.equal(after.state.stateVersion, before.state.stateVersion + 1,
    'retreat state, cursor, actor cleanup, and encounter snapshot share one commit');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM actor_cards WHERE branch_id = 'camp-s-main' AND actor_id = ?").get(retreatingId).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM actor_states WHERE branch_id = 'camp-s-main' AND actor_id = ?").get(retreatingId).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM actor_cards WHERE branch_id = 'camp-s-main' AND actor_id = ?").get(remainingId).n, 1);
  db.close();
});

// ---------------------------------------------------------------------------
// P2 second-round combat acceptance: action economy, UnitOfWork and history
// ---------------------------------------------------------------------------

test('R2-01: movement is a versioned separate allowance and request replay is idempotent', async () => {
  const db = setupDb();
  const { session } = await makeSession(db, { initialSkills: ['stealth', 'sword'] });
  let view = await session.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: 'move-economy',
    hostiles: [{ templateId: 'guard-template', count: 1 }],
  });
  let npcSteps = 0;
  while (!view.currentActorIsPlayer && npcSteps < 6) {
    view = await session.encounterNpcTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId });
    npcSteps += 1;
  }
  assert.ok(view.currentActorIsPlayer);
  const actorId = view.currentActorId;
  const actorBefore = view.actors.find(actor => actor.actorId === actorId);
  const destination = view.zones.find(zone => zone.zoneId !== actorBefore.zoneId && zone.exits.includes(actorBefore.zoneId));
  assert.ok(destination, 'fixture has an adjacent destination');
  const before = await session.getSummary('camp-s', 'camp-s-main');
  const moveRequestId = `move-${before.state.stateVersion}`;
  const moved = await session.encounterMove({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
    toZoneId: destination.zoneId, requestId: moveRequestId,
  });
  assert.equal(moved.currentActorId, actorId, 'movement leaves the actor in its initiative slot for the main action');
  assert.equal(moved.actors.find(actor => actor.actorId === actorId).movedThisRound, true);
  assert.equal((await session.getSummary('camp-s', 'camp-s-main')).state.actors[actorId].zoneId, destination.zoneId,
    'the authoritative actor location and encounter zone projection commit together');
  assert.equal((await session.getSummary('camp-s', 'camp-s-main')).state.stateVersion, before.state.stateVersion + 1,
    'movement is one authoritative action commit');

  await session.encounterMove({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
    toZoneId: destination.zoneId, requestId: moveRequestId,
  });
  assert.equal((await session.getSummary('camp-s', 'camp-s-main')).state.stateVersion, before.state.stateVersion + 1,
    'replaying the same movement request does not spend another action');
  const otherDestination = view.zones.find(zone => zone.zoneId !== destination.zoneId && zone.exits.includes(destination.zoneId));
  await assert.rejects(
    () => session.encounterMove({
      campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
      toZoneId: otherDestination.zoneId,
    }),
    /movement|移动|用尽/i,
    'a second standard move is refused even though the main action remains available',
  );

  const afterMove = await session.getSummary('camp-s', 'camp-s-main');
  const snap = JSON.parse(db.prepare('SELECT snapshot_json FROM snapshots WHERE branch_id = ? AND state_version = ?')
    .get('camp-s-main', afterMove.state.stateVersion).snapshot_json);
  const savedActor = snap.encounters.find(entry => entry.state.encounterId === view.encounterId).state.actors[actorId];
  assert.equal(savedActor.movedThisRound, true, 'movement quota is inside the complete snapshot');
  db.close();
});

test('R2-03: dash pays the main action and standard movement remains independently available', async () => {
  const db = setupDb();
  const { session } = await makeSession(db, { initialSkills: ['stealth', 'sword'] });
  let view = await session.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: 'dash-economy',
    hostiles: [{ templateId: 'guard-template', count: 1 }],
  });
  let npcSteps = 0;
  while (!view.currentActorIsPlayer && npcSteps < 8) {
    view = await session.encounterNpcTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId });
    npcSteps += 1;
  }
  assert.ok(view.currentActorIsPlayer);
  const actorId = view.currentActorId;
  const startZone = view.actors.find(actor => actor.actorId === actorId).zoneId;
  const dashDestination = view.zones.find(zone => zone.zoneId !== startZone && zone.exits.includes(startZone));
  assert.ok(dashDestination, 'fixture has an adjacent dash destination');

  const dashed = await session.encounterDash({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
    toZoneId: dashDestination.zoneId, requestId: 'dash-main-action',
  });
  const dashedActor = dashed.actors.find(actor => actor.actorId === actorId);
  assert.equal(dashedActor.zoneId, dashDestination.zoneId);
  assert.equal((await session.getSummary('camp-s', 'camp-s-main')).state.actors[actorId].zoneId, dashDestination.zoneId);
  assert.equal(dashedActor.actedThisRound, true, 'dash consumes the main action');
  assert.equal(dashedActor.movedThisRound, false, 'dash does not consume the separate standard-move allowance');

  const moveDestination = dashed.zones.find(zone => zone.zoneId !== dashedActor.zoneId && zone.exits.includes(dashedActor.zoneId));
  assert.ok(moveDestination, 'fixture has a second adjacent zone for the remaining standard move');
  const stateVersionAfterDash = dashed.stateVersion;
  const movedAfterMain = await session.encounterMove({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: dashed.encounterId,
    actorId, toZoneId: moveDestination.zoneId, requestId: 'move-after-dash',
  });
  const movedActor = movedAfterMain.actors.find(actor => actor.actorId === actorId);
  assert.equal(movedActor.zoneId, moveDestination.zoneId);
  assert.equal((await session.getSummary('camp-s', 'camp-s-main')).state.actors[actorId].zoneId, moveDestination.zoneId);
  assert.equal(movedActor.actedThisRound, true);
  assert.equal(movedActor.movedThisRound, true, 'movement can follow a main action and is recorded once');
  assert.equal(movedAfterMain.currentActorId, dashed.currentActorId, 'out-of-turn movement leaves the initiative cursor unchanged');
  assert.equal(movedAfterMain.stateVersion, stateVersionAfterDash + 1);

  await session.encounterMove({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: movedAfterMain.encounterId,
    actorId, toZoneId: dashedActor.zoneId, requestId: 'move-after-dash',
  });
  assert.equal((await session.getSummary('camp-s', 'camp-s-main')).state.stateVersion, stateVersionAfterDash + 1,
    'replaying post-action movement does not spend another allowance');
  db.close();
});

test('R2-03: rescue spends the major action, then the rescued actor waits for its frozen slot', async () => {
  const db = setupDb();
  const { session, adapter } = await makeSession(db, { initialSkills: ['stealth', 'sword'] });
  const downCard = JSON.parse(db.prepare("SELECT card_json FROM actor_cards WHERE branch_id = 'camp-s-main' AND actor_id = 'actor-su'").get().card_json);
  downCard.attributes.agility = 99;
  db.prepare("UPDATE actor_cards SET card_json = ? WHERE branch_id = 'camp-s-main' AND actor_id = 'actor-su'")
    .run(JSON.stringify(downCard));
  db.prepare("UPDATE actor_states SET resources_json = ?, conditions_json = ? WHERE branch_id = 'camp-s-main' AND actor_id = 'actor-su'")
    .run(JSON.stringify({ hp: 0, stamina: 4 }), JSON.stringify(['disabled']));
  let view = await session.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: 'rescue-economy',
    hostiles: [{ templateId: 'guard-template', count: 1 }],
  });
  assert.equal(view.initiative[0], 'actor-su', 'the fixture puts the incapacitated actor first in initiative');
  assert.notEqual(view.currentActorId, 'actor-su', 'an incapacitated starting slot is skipped');
  assert.equal(view.actors.find(actor => actor.actorId === 'actor-su').hp, 0);
  assert.ok(view.actors.find(actor => actor.actorId === 'actor-su').conditions.includes('disabled'));
  let npcSteps = 0;
  while ((!view.currentActorIsPlayer || view.currentActorId === 'actor-su') && npcSteps < 8) {
    if (view.currentActorIsPlayer) {
      view = await session.encounterPassTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
        requestId: `rescue-skip-${npcSteps}` });
    } else {
      view = await session.encounterNpcTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
        requestId: `rescue-npc-${npcSteps}` });
    }
    npcSteps += 1;
  }
  assert.ok(view.currentActorIsPlayer && view.currentActorId !== 'actor-su', 'a conscious party member reaches a legal action slot');
  const rescuerId = view.currentActorId;
  view = await session.encounterRescue({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
    targetId: 'actor-su', requestId: 'rescue-main-action',
  });
  const rescued = view.actors.find(actor => actor.actorId === 'actor-su');
  assert.equal(rescued.hp, 1);
  assert.equal(rescued.conditions.includes('disabled'), false);
  assert.equal(view.actors.find(actor => actor.actorId === rescuerId).actedThisRound, true,
    'rescue spends exactly the rescuer\'s main action');
  assert.ok(view.currentActorId !== rescuerId, 'the rescued ally does not interrupt the frozen initiative slot');
  const rescueSave = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex,
    campaignId: 'camp-s', branchId: 'camp-s-main', createdAt: 'r2-rescue' });
  await restoreSave({ db: adapter, save: rescueSave.save,
    newCampaignId: 'camp-rescue-import', newBranchId: 'camp-rescue-import-main', createdAt: 'r2-rescue-import' });
  const restored = await session.getActiveEncounter('camp-rescue-import', 'camp-rescue-import-main');
  assert.ok(restored, 'a save after rescue retains the active encounter');
  assert.deepEqual(restored.actors.find(actor => actor.actorId === 'actor-su'), rescued,
    'the rescued HP/conditions and frozen initiative state survive save restoration');
  assert.equal(restored.currentActorId, view.currentActorId);
  db.close();
});

test('R2-01: attack snapshot fault rolls back HP, cursor, events and rewards; retry reuses the persisted die', async () => {
  const db = setupDb();
  const { session, adapter } = await makeSession(db, { initialSkills: ['stealth', 'sword'], lootItemIds: ['item-relic'] });
  let view = await session.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: 'attack-atomic',
    hostiles: [{ templateId: 'guard-template', count: 1 }],
  });
  let npcSteps = 0;
  while (!view.currentActorIsPlayer && npcSteps < 8) {
    view = await session.encounterNpcTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId });
    npcSteps += 1;
  }
  assert.ok(view.currentActorIsPlayer, 'an attack-capable party actor reaches the cursor');
  const hostileId = view.actors.find(actor => actor.side === 'hostile').actorId;
  const attacker = view.actors.find(actor => actor.actorId === view.currentActorId);
  const hostile = view.actors.find(actor => actor.actorId === hostileId);
  if (attacker.zoneId !== hostile.zoneId) {
    const adjacent = view.zones.find(zone => zone.zoneId !== attacker.zoneId && zone.exits.includes(attacker.zoneId));
    view = await session.encounterMove({
      campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
      toZoneId: adjacent.zoneId, requestId: 'fault-prep-move',
    });
  }
  db.prepare("UPDATE actor_states SET resources_json = ? WHERE branch_id = 'camp-s-main' AND actor_id = ?")
    .run(JSON.stringify({ hp: 1, stamina: 4 }), hostileId);
  db.prepare("UPDATE encounter_actors SET hp = 1 WHERE branch_id = 'camp-s-main' AND encounter_id = ? AND actor_id = ?")
    .run(view.encounterId, hostileId);
  const before = await session.getSummary('camp-s', 'camp-s-main');
  const beforeView = await session.getEncounterView('camp-s', 'camp-s-main', view.encounterId);
  const beforeHp = before.state.actors[hostileId].resources.hp;
  const rollRequestId = 'fault-key';
  const rollTurnId = `enc:${view.encounterId}:request:${rollRequestId}`;
  let randomCalls = 0;
  session.encounters.deps.random = { nextIntInclusive: (_min, max) => { randomCalls += 1; return max; } };

  db.exec(`CREATE TRIGGER injected_combat_snapshot_failure BEFORE INSERT ON snapshots
    WHEN NEW.branch_id = 'camp-s-main' AND NEW.state_version = ${before.state.stateVersion + 1}
    BEGIN SELECT RAISE(ABORT, 'injected combat snapshot failure'); END;`);
  await assert.rejects(
    () => session.encounterAttack({
      campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
      targetId: hostileId, requestId: rollRequestId,
    }),
    /injected combat snapshot failure/,
  );
  db.exec('DROP TRIGGER injected_combat_snapshot_failure;');

  const afterFailure = await session.getSummary('camp-s', 'camp-s-main');
  const viewAfterFailure = await session.getEncounterView('camp-s', 'camp-s-main', view.encounterId);
  assert.equal(afterFailure.state.stateVersion, before.state.stateVersion, 'failed UnitOfWork rolls back branch version');
  assert.equal(afterFailure.state.actors[hostileId].resources.hp, beforeHp, 'failed UnitOfWork rolls back damage');
  assert.equal(viewAfterFailure.currentActorId, beforeView.currentActorId, 'failed UnitOfWork rolls back the initiative cursor');
  assert.deepEqual(viewAfterFailure.actors.map(actor => actor.zoneId), beforeView.actors.map(actor => actor.zoneId),
    'failed UnitOfWork rolls back battlefield projections');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM branch_events WHERE branch_id = ? AND state_version = ?')
    .get('camp-s-main', before.state.stateVersion + 1).n, 0, 'failed UnitOfWork leaves no partial events');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reward_ledger WHERE branch_id = ? AND encounter_id = ?')
    .get('camp-s-main', view.encounterId).n, 0, 'failed UnitOfWork leaves no partial reward');
  assert.equal(afterFailure.state.itemOwners['item-relic'], undefined,
    'a failed last-hit commit leaves no partial loot ownership');
  const firstRoll = db.prepare('SELECT rolls_json FROM roll_records WHERE branch_id = ? AND turn_id = ?')
    .get('camp-s-main', rollTurnId);
  assert.ok(firstRoll, 'dice are durably frozen before the failing commit boundary');
  const callsAtFault = randomCalls;

  const rolledSave = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex,
    campaignId: 'camp-s', branchId: 'camp-s-main', createdAt: 'r2-rolled-uncommitted' });
  await restoreSave({ db: adapter, save: rolledSave.save,
    newCampaignId: 'camp-rolled-import', newBranchId: 'camp-rolled-import-main', createdAt: 'r2-rolled-import' });
  const rolledImportView = await session.getActiveEncounter('camp-rolled-import', 'camp-rolled-import-main');
  assert.ok(rolledImportView, 'an exported rolled-but-uncommitted fight remains active');
  assert.equal(rolledImportView.currentActorId, beforeView.currentActorId);
  assert.equal(db.prepare('SELECT rolls_json FROM roll_records WHERE branch_id = ? AND turn_id = ?')
    .get('camp-rolled-import-main', rollTurnId).rolls_json, firstRoll.rolls_json,
    'save import preserves the original frozen die for the pending attack');
  const importedCommit = await session.encounterAttack({
    campaignId: 'camp-rolled-import', branchId: 'camp-rolled-import-main', encounterId: view.encounterId,
    targetId: hostileId, requestId: rollRequestId,
  });
  assert.equal(randomCalls, callsAtFault, 'the imported pending action resumes without rerolling');
  assert.notEqual(importedCommit.currentActorId, beforeView.currentActorId,
    'the imported retry commits the pending attack and initiative cursor together');
  const importedSummary = await session.getSummary('camp-rolled-import', 'camp-rolled-import-main');
  assert.equal(importedSummary.state.itemOwners['item-relic'], 'actor-shen',
    'the imported retry commits the frozen loot reward in its attack transaction');

  const committed = await session.encounterAttack({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
    targetId: hostileId, requestId: rollRequestId,
  });
  assert.equal(randomCalls, callsAtFault, 'recovery reuses the persisted roll without drawing again');
  assert.ok(committed.currentActorId !== beforeView.currentActorId, 'recovery commits the cursor with the attack');
  assert.equal((await session.getSummary('camp-s', 'camp-s-main')).state.stateVersion, before.state.stateVersion + 1);
  assert.equal((await session.getSummary('camp-s', 'camp-s-main')).state.itemOwners['item-relic'], 'actor-shen',
    'the original retry grants the reward once after the injected rollback');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reward_ledger WHERE branch_id = ? AND encounter_id = ?')
    .get('camp-s-main', view.encounterId).n, 1, 'attack practice is committed with the battle action');
  assert.equal(db.prepare('SELECT rolls_json FROM roll_records WHERE branch_id = ? AND turn_id = ?')
    .get('camp-s-main', rollTurnId).rolls_json, firstRoll.rolls_json, 'the original dice remain attached to the same action');
  const committedState = await session.getSummary('camp-s', 'camp-s-main');
  const hpAfterCommit = committedState.state.actors[hostileId]?.resources.hp;
  const eventsAfterCommit = db.prepare('SELECT COUNT(*) AS n FROM branch_events WHERE branch_id = ? AND turn_id = ?')
    .get('camp-s-main', rollTurnId).n;
  await session.encounterAttack({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
    targetId: hostileId, requestId: rollRequestId,
  });
  const duplicateState = await session.getSummary('camp-s', 'camp-s-main');
  assert.equal(duplicateState.state.actors[hostileId]?.resources.hp, hpAfterCommit,
    'duplicate committed request does not reapply damage or revive a cleaned temporary actor');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM branch_events WHERE branch_id = ? AND turn_id = ?')
    .get('camp-s-main', rollTurnId).n, eventsAfterCommit, 'duplicate committed request does not duplicate events');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reward_ledger WHERE branch_id = ? AND encounter_id = ?')
    .get('camp-s-main', view.encounterId).n, 1, 'duplicate committed request does not duplicate the reward ledger row');
  db.close();
});

test('R2-02: fork and save restore the active battlefield; ended snapshots never revive temporary enemies', async () => {
  const db = setupDb();
  const { session, adapter } = await makeSession(db, { initialSkills: ['stealth', 'sword'] });
  const preBattleSave = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex,
    campaignId: 'camp-s', branchId: 'camp-s-main', createdAt: 'r2-before-battle' });
  await restoreSave({ db: adapter, save: preBattleSave.save,
    newCampaignId: 'camp-before-battle-import', newBranchId: 'camp-before-battle-import-main', createdAt: 'r2-before-battle-import' });
  assert.equal(await session.getActiveEncounter('camp-before-battle-import', 'camp-before-battle-import-main'), null,
    'a pre-battle save does not invent or revive an encounter');

  let view = await session.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: 'history-fight',
    hostiles: [{ templateId: 'guard-template', count: 1 }],
  });
  const hostileId = view.actors.find(actor => actor.side === 'hostile').actorId;
  const startedSave = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex,
    campaignId: 'camp-s', branchId: 'camp-s-main', createdAt: 'r2-after-begin' });
  await restoreSave({ db: adapter, save: startedSave.save,
    newCampaignId: 'camp-start-import', newBranchId: 'camp-start-import-main', createdAt: 'r2-start-import' });
  const startedImport = await session.getActiveEncounter('camp-start-import', 'camp-start-import-main');
  assert.ok(startedImport, 'a save immediately after encounter start restores the frozen initiative');
  assert.deepEqual(startedImport.initiative, view.initiative);
  assert.equal(startedImport.actors.find(actor => actor.actorId === hostileId).movedThisRound, false);
  let steps = 0;
  while (!view.currentActorIsPlayer && steps < 8) {
    view = await session.encounterNpcTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId });
    steps += 1;
  }
  const player = view.actors.find(actor => actor.actorId === view.currentActorId);
  const hostile = view.actors.find(actor => actor.actorId === hostileId);
  if (player.zoneId !== hostile.zoneId) {
    const adjacent = view.zones.find(zone => zone.zoneId !== player.zoneId && zone.exits.includes(player.zoneId));
    view = await session.encounterMove({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, toZoneId: adjacent.zoneId });
  }
  const source = await session.getSummary('camp-s', 'camp-s-main');
  const preMoveVersion = source.state.stateVersion - 1;
  const sourceEncounter = source.state.encounters.find(entry => entry.state.encounterId === view.encounterId);
  assert.ok(sourceEncounter, 'full snapshot contains the encounter');
  assert.equal(sourceEncounter.state.status, 'active');
  assert.ok(sourceEncounter.state.initiative.includes(hostileId));
  assert.equal(sourceEncounter.state.actors[view.currentActorId].movedThisRound, true,
    'fork point includes the movement allowance and battlefield');

  const fork = await session.rewind({
    campaignId: 'camp-s', sourceBranchId: 'camp-s-main', atStateVersion: source.state.stateVersion,
    newBranchId: 'camp-s-fight-fork',
  });
  const forkState = await session.getSummary('camp-s', fork.branchId);
  const forkEncounter = await session.getActiveEncounter('camp-s', fork.branchId);
  assert.ok(forkEncounter, 'active encounter is rehydrated on the fork');
  assert.equal(forkEncounter.currentActorId, view.currentActorId);
  assert.deepEqual(forkState.state.encounters[0], sourceEncounter, 'fork restores the exact battlefield envelope');
  assert.ok(forkState.cards.some(card => card.actorId === hostileId), 'active temporary enemy projection is restored');

  const exported = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex,
    campaignId: 'camp-s', branchId: 'camp-s-main', createdAt: 'r2-active' });
  assert.equal(exported.save.manifest.schemaVersion, SAVE_SCHEMA_VERSION);
  assert.ok(exported.save.state.encounters.some(entry => entry.state.encounterId === view.encounterId));
  assert.ok(exported.save.snapshotHistory.some(entry => entry.stateVersion === preMoveVersion),
    'the portable save carries earlier complete snapshots, not only its current state');
  assert.equal((await validateSaveJson(exported.json, sha.sha256Hex)).ok, true,
    'the history-bearing save passes payload integrity validation');
  await restoreSave({ db: adapter, save: exported.save, newCampaignId: 'camp-active-import', newBranchId: 'camp-active-import-main', createdAt: 'r2-import' });
  const importedView = await session.getActiveEncounter('camp-active-import', 'camp-active-import-main');
  assert.ok(importedView, 'save import restores the active encounter');
  assert.equal(importedView.currentActorId, view.currentActorId);
  assert.deepEqual((await session.getSummary('camp-active-import', 'camp-active-import-main')).state.encounters[0], sourceEncounter);
  const importedRewind = await session.rewind({
    campaignId: 'camp-active-import', sourceBranchId: 'camp-active-import-main',
    atStateVersion: preMoveVersion, newBranchId: 'camp-active-import-rewind',
  });
  const importedRewindState = await session.getSummary('camp-active-import', importedRewind.branchId);
  const importedRewindEncounter = await session.getActiveEncounter('camp-active-import', importedRewind.branchId);
  assert.ok(importedRewindEncounter, 'an imported active battle can rewind to an earlier in-battle snapshot');
  assert.equal(importedRewindEncounter.currentActorId, view.currentActorId,
    'the restored initiative actor remains current after an in-battle rewind');
  assert.equal(importedRewindEncounter.actors.find(actor => actor.actorId === view.currentActorId).movedThisRound, false,
    'rewind restores the movement quota from the earlier full battlefield snapshot');

  view = await session.encounterAttack({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
    targetId: hostileId, requestId: 'history-attack-after-move',
  });
  assert.equal(view.status, 'active', 'the post-move attack fixture keeps the encounter open for recovery');
  const postAttack = await session.getSummary('camp-s', 'camp-s-main');
  const attackSave = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex,
    campaignId: 'camp-s', branchId: 'camp-s-main', createdAt: 'r2-after-attack' });
  await restoreSave({ db: adapter, save: attackSave.save,
    newCampaignId: 'camp-attack-import', newBranchId: 'camp-attack-import-main', createdAt: 'r2-attack-import' });
  const attackImport = await session.getActiveEncounter('camp-attack-import', 'camp-attack-import-main');
  assert.ok(attackImport, 'a post-attack save remains in the same active encounter');
  assert.equal(attackImport.currentActorId, view.currentActorId);
  assert.equal((await session.getSummary('camp-attack-import', 'camp-attack-import-main')).state.actors[hostileId].resources.hp,
    postAttack.state.actors[hostileId].resources.hp, 'committed attack damage survives save restoration');

  const ended = await session.encounterRetreat({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId });
  assert.equal(ended.status, 'escaped');
  const endedState = await session.getSummary('camp-s', 'camp-s-main');
  assert.equal(endedState.state.actors[hostileId], undefined, 'cleanup removes the temporary enemy from world state');
  assert.equal(endedState.cards.some(card => card.actorId === hostileId), false, 'cleanup removes the temporary card');
  assert.equal(endedState.state.encounters[0].state.status, 'escaped', 'ended encounter history remains in the snapshot');
  const endedSave = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex,
    campaignId: 'camp-s', branchId: 'camp-s-main', createdAt: 'r2-ended' });
  await restoreSave({ db: adapter, save: endedSave.save, newCampaignId: 'camp-ended-import', newBranchId: 'camp-ended-import-main', createdAt: 'r2-ended-import' });
  const endedImport = await session.getSummary('camp-ended-import', 'camp-ended-import-main');
  assert.equal(await session.getActiveEncounter('camp-ended-import', 'camp-ended-import-main'), null);
  assert.equal(endedImport.state.actors[hostileId], undefined, 'ended save history does not resurrect the temporary enemy');
  assert.equal(endedImport.cards.some(card => card.actorId === hostileId), false);
  db.close();
});

test('R2-03: the completed round clock advances once across player passes, AI movement and attacks', async () => {
  const db = setupDb();
  const { session } = await makeSession(db, { initialSkills: ['stealth', 'sword'] });
  let view = await session.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: 'round-clock',
    hostiles: [{ templateId: 'guard-template', count: 1 }],
  });
  const start = await session.getSummary('camp-s', 'camp-s-main');
  for (let expectedRound = 1; expectedRound <= 2; expectedRound += 1) {
    let actions = 0;
    while (view.round === expectedRound && view.status === 'active' && actions < 20) {
      const requestId = `round-${expectedRound}-v${(await session.getSummary('camp-s', 'camp-s-main')).state.stateVersion}`;
      view = view.currentActorIsPlayer
        ? await session.encounterPassTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId })
        : await session.encounterNpcTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId });
      actions += 1;
    }
    assert.ok(actions < 20, `round ${expectedRound} completes instead of stalling`);
    assert.equal(view.round, expectedRound + 1, `round ${expectedRound} advances exactly once`);
    const state = await session.getSummary('camp-s', 'camp-s-main');
    assert.equal(state.state.clockSeconds - start.state.clockSeconds, expectedRound * 6,
      'the six-second world clock is independent of the action type at round end');
    const roundEvents = db.prepare("SELECT COUNT(*) AS n FROM branch_events WHERE branch_id = ? AND event_type = 'combat_round_completed'")
      .get('camp-s-main').n;
    assert.equal(roundEvents, expectedRound, 'one clock event is committed per completed round');
  }
  const npcActionTypes = db.prepare(`SELECT payload_json FROM branch_events
    WHERE branch_id = ? AND event_type = 'recordEvent'`).all('camp-s-main')
    .map(row => JSON.parse(row.payload_json).eventType);
  assert.ok(npcActionTypes.includes('combat_moved'), 'the out-of-range NPC closes distance with a committed move');
  assert.ok(npcActionTypes.includes('attack'), 'the NPC later attacks from a legal range');
  db.close();
});

test('R2-03: a mid-encounter party join waits for next round and restores with fresh allowances', async () => {
  const db = setupDb();
  const { session, adapter } = await makeSession(db, { initialSkills: ['stealth', 'sword'] });
  let view = await session.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: 'late-party-member',
    hostiles: [{ templateId: 'guard-template', count: 2 }],
  });
  const frozenInitiative = [...view.initiative];
  const source = JSON.parse(db.prepare("SELECT card_json FROM actor_cards WHERE branch_id = 'camp-s-main' AND actor_id = 'actor-su'").get().card_json);
  const joined = { ...source, actorId: 'actor-late', name: '新加入同伴', controller: 'companion' };
  db.prepare(`INSERT INTO actor_cards (branch_id, actor_id, card_json, created_at, updated_at, updated_state_version)
    VALUES ('camp-s-main', ?, ?, 'joined', 'joined', 0)`).run(joined.actorId, JSON.stringify(joined));
  db.prepare(`INSERT INTO actor_states (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
    VALUES ('camp-s-main', ?, 0, 'courtyard', ?, '[]')`).run(joined.actorId, JSON.stringify({ hp: 6, stamina: 4 }));
  db.prepare(`INSERT INTO party_members (branch_id, actor_id, controller, role, joined_at)
    VALUES ('camp-s-main', ?, 'companion', 'companion', 'joined')`).run(joined.actorId);

  view = await session.encounterQueueJoin({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
    actorId: joined.actorId, requestId: 'queue-late-member',
  });
  assert.ok(view.pendingActorIds.includes(joined.actorId), 'the join is committed as a pending next-round entrant');
  assert.ok(!view.actors.some(actor => actor.actorId === joined.actorId), 'the entrant cannot act in the round in which they arrive');
  assert.ok(!view.initiative.includes(joined.actorId), 'the frozen current-round order is not changed');
  const queuedVersion = view.stateVersion;
  const replay = await session.encounterQueueJoin({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId,
    actorId: joined.actorId, requestId: 'queue-late-member',
  });
  assert.equal(replay.stateVersion, queuedVersion, 'retrying the join request does not queue a second actor');
  const queuedSave = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex,
    campaignId: 'camp-s', branchId: 'camp-s-main', createdAt: 'pending-entrant' });
  await restoreSave({ db: adapter, save: queuedSave.save,
    newCampaignId: 'camp-pending-import', newBranchId: 'camp-pending-import-main', createdAt: 'pending-entrant-import' });
  view = await session.getActiveEncounter('camp-pending-import', 'camp-pending-import-main');
  assert.ok(view?.pendingActorIds.includes(joined.actorId), 'save import preserves a participant waiting for next-round entry');
  assert.ok(!view?.actors.some(actor => actor.actorId === joined.actorId), 'save import does not activate the newcomer early');

  let actions = 0;
  while (view.status === 'active' && view.round === 1 && actions < 40) {
    const requestId = `advance-to-entrant-${actions}-${view.stateVersion}`;
    view = view.currentActorIsPlayer
      ? await session.encounterPassTurn({
          campaignId: 'camp-pending-import', branchId: 'camp-pending-import-main', encounterId: view.encounterId, requestId,
        })
      : await session.encounterNpcTurn({
          campaignId: 'camp-pending-import', branchId: 'camp-pending-import-main', encounterId: view.encounterId, requestId,
        });
    actions += 1;
  }
  assert.equal(view.round, 2, 'the existing initiative completes one full round');
  assert.deepEqual(view.initiative.slice(0, frozenInitiative.length), frozenInitiative,
    'existing actors keep their originally frozen order');
  assert.equal(view.initiative.filter(actorId => actorId === joined.actorId).length, 1,
    'the newcomer is inserted once at the next round boundary');
  assert.deepEqual(view.pendingActorIds, []);
  const newActor = view.actors.find(actor => actor.actorId === joined.actorId);
  assert.ok(newActor, 'the pending party member becomes a combatant at the next round');
  assert.equal(newActor.actedThisRound, false);
  assert.equal(newActor.movedThisRound, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM branch_events WHERE branch_id = 'camp-pending-import-main' AND event_type = 'combat_actors_joined'").get().n, 1,
    'the actual battle entry is recorded in the same round-boundary transaction');
  const restartedView = await session.getActiveEncounter('camp-pending-import', 'camp-pending-import-main');
  assert.ok(restartedView?.actors.some(actor => actor.actorId === joined.actorId),
    'the newcomer, initiative slot and unused allowances survive encounter reload');
  db.close();
});

test('ability qualification blocks unprepared, self-policy, range and world-hard-constraint violations', () => {
  const { compileProposal } = require('../dist/application/game/v2Compile');
  const actor = {
    actorId: 'actor-shen', name: '沈青', kind: 'original', controller: 'player',
    attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 },
    skills: {}, abilities: ['ability-test'], preparedAbilities: ['ability-test'],
    resourceMax: { hp: 10, stamina: 10 }, defense: 2, powerTier: 'ordinary',
    rulesetId: 'shineword-v02', rulesetVersion: '0.2', worldId: 'w', worldPackageRevision: 1, cardRevision: 1,
  };
  const hostile = { ...actor, actorId: 'guard', name: '守卫', kind: 'creature', controller: 'gm' };
  const ally = { ...actor, actorId: 'ally', name: '苏禾', kind: 'companion', controller: 'companion' };
  const state = {
    branchId: 'b', stateVersion: 4, clockMinutes: 0, actors: {
      'actor-shen': { actorId: 'actor-shen', locationId: 'library', zoneId: 'shelves', resources: { hp: 10, stamina: 10 }, conditions: [] },
      guard: { actorId: 'guard', locationId: 'street', resources: { hp: 8, stamina: 5 }, conditions: [] },
      ally: { actorId: 'ally', locationId: 'street', resources: { hp: 8, stamina: 5 }, conditions: [] },
    }, itemOwners: {},
  };
  const definition = {
    name: '试验能力', description: '用于资格边界验证', attribute: 'insight', costs: {}, range: 'far',
    targetPolicy: 'single_enemy', requiresRoll: false, effects: [{ op: 'damage', amount: 1 }],
    cooldownRounds: 0, passive: false, powerTier: 'ordinary',
  };
  const run = (options = {}) => {
    const { ability = definition, card = actor, targetId = 'guard', intent = '使用试验能力', constraints = [], scenes = [], state: sourceState = state } = options;
    return compileProposal({
      proposal: { proposalVersion: '2.0', turnId: 't', expectedStateVersion: 4, actorId: 'actor-shen',
        actionKind: 'ability', abilityId: 'ability-test', targetId, evidenceIds: [], intent },
      actingCard: card, cards: [card, ally, hostile], catalog: {},
      abilities: new Map([['ability-test', ability]]), scenes, constraints, state: sourceState,
    });
  };

  assert.throws(() => run({ ability: { ...definition, targetPolicy: 'self', range: 'self', effects: [{ op: 'heal', amount: 1 }] },
    card: { ...actor, preparedAbilities: [] }, targetId: 'actor-shen' }), /尚未准备/);
  assert.throws(() => run({ ability: { ...definition, targetPolicy: 'self', range: 'self' }, targetId: 'guard' }), /只能以施动者本人/);
  assert.throws(() => run({ ability: { ...definition, targetPolicy: 'single_ally' }, targetId: 'ally' }), /不在施术者所在场景/);
  assert.throws(() => run({
    ability: { ...definition, targetPolicy: 'single_ally', range: 'near' }, targetId: 'ally',
    state: { ...state, actors: { ...state.actors, ally: { ...state.actors.ally, locationId: 'library', zoneId: 'aisle' } } },
    scenes: [{ name: '藏书阁', description: '藏书阁', locationId: 'library', zones: [
      { zoneId: 'shelves', name: '书架', cover: false, exits: ['aisle'] },
      { zoneId: 'aisle', name: '过道', cover: false, exits: ['shelves'] },
    ], actors: [], visibleItems: [], hazards: [], clues: [] }],
  }), /mid 距离/);
  assert.throws(() => run({ ability: { ...definition, name: '飞行术', description: '飞越屋顶', targetPolicy: 'self', range: 'self', effects: [{ op: 'apply_condition', conditionId: 'airborne' }] },
    targetId: 'actor-shen', intent: '发动飞行术', constraints: [{ name: '不可飞行', description: '本世界没有飞行能力', enforcement: 'block_effect', pattern: '飞行' }] }), /世界硬约束/);
});

test('discovering an in-scene clue advances a quest, grants an item and survives books, rewind and save restore', async () => {
  const db = setupDb();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await seedWorld(db, worldStore, 'w-knowledge');
  const { publishWorldPackage } = require('../dist/application/worldPackage/publish');
  const clue = entry('clue-secret', 'lore', { name: '暗格字迹', title: '暗格字迹', text: '书架后有通往密室的暗格。' }, { visibility: 'discoverable' });
  const item = entry('item-key', 'item', {
    name: '铜钥匙', description: '开启暗格的钥匙。', category: 'key', effects: [], unique: true,
  });
  const quest = entry('quest-hidden-room', 'quest', {
    name: '寻找密室', description: '找到暗格入口。',
    trigger: { eventType: 'knowledge_discovered', summaryPattern: 'clue-secret' },
    objectives: [{ objectiveId: 'find-clue', description: '发现暗格字迹', counter: 'clue-secret', target: 1 }],
    rewards: { items: ['item-key'] }, failurePath: '改日再查',
  }, { dependencyIds: ['item-key'] });
  const scene = entry('scene-library', 'scene', {
    name: '藏书阁', description: '雨夜的藏书阁。', locationId: 'camp',
    zones: [{ zoneId: 'shelves', name: '书架', cover: true, exits: [] }],
    actors: [], visibleItems: [], hazards: [], clues: ['clue-secret'],
  }, { visibility: 'gm', dependencyIds: ['clue-secret', 'quest-hidden-room'] });
  const publicStart = entry('scene-public-library', 'scene', {
    name: '藏书阁', description: '公共开局区域。', locationId: 'camp',
    zones: [{ zoneId: 'entrance', name: '入口', cover: false, exits: [] }],
    actors: [], visibleItems: [], hazards: [], clues: [],
  });
  const entries = [SKILL_STEALTH, clue, item, quest, publicStart, scene];
  const sections = [
    { book: 'player_handbook', sectionKey: 'clues', title: '线索', entryIds: ['clue-secret', 'stealth'], position: 0 },
    { book: 'gm_guide', sectionKey: 'quests', title: '任务', entryIds: ['quest-hidden-room', 'scene-library'], position: 0 },
    { book: 'monster_manual', sectionKey: 'items', title: '物品', entryIds: ['item-key'], position: 0 },
  ];
  const pub = await publishWorldPackage({ worldStore, sha256Hex: sha.sha256Hex, worldId: 'w-knowledge',
    sourceSha256: 'a'.repeat(64), mappingVersion: 'map-knowledge', entries, sections, createdAt: 't' });
  const { createCampaign } = require('../dist/application/campaign/createCampaign');
  await createCampaign({
    db: adapter, worldStore, campaignId: 'camp-knowledge', title: '密室调查', worldId: 'w-knowledge', packageRevision: pub.manifest.revision,
    anchor: { worldTimeOrder: 1, locationId: 'camp' },
    protagonist: { actorId: 'actor-shen', kind: 'original', name: '沈青',
      attributes: { physique: 1, agility: 2, insight: 1, knowledge: 1, willpower: 1, social: 1 }, initialSkills: ['stealth'] },
    goal: '调查藏书阁', createdAt: 't0',
  });
  const provider = new ProposalProvider();
  provider.override = payload => ({ proposalVersion: '2.0', turnId: payload.turnId,
    expectedStateVersion: payload.expectedStateVersion, actorId: 'actor-shen', actionKind: 'interact',
    evidenceIds: ['clue-secret'], intent: payload.playerIntent });
  const session = new CampaignSession({
    db: adapter, turns: new SqliteTurnStore(adapter), game: new SqliteGameStore(adapter),
    worldStore, narratives: new SqliteNarrativeStore(adapter), hashProvider: sha, random: RNG_MAX,
  }, provider, { endpoint: 'https://x', model: 'm', keyRef: 'kr' });
  const before = await session.getSummary('camp-knowledge', 'camp-knowledge-main');
  assert.equal(assembleBook({ entries, sections }, 'player_handbook', { includeGm: false, knowledge: { discoveredEntryIds: new Set() } })
    .flatMap(group => group.entries).some(found => found.entryId === 'clue-secret'), false);
  await session.playTurn({ campaignId: 'camp-knowledge', branchId: 'camp-knowledge-main', intent: '查看书架并记录暗格线索' });
  const after = await session.getSummary('camp-knowledge', 'camp-knowledge-main');
  assert.deepEqual(after.state.discoveries.map(discovery => discovery.entryId), ['clue-secret']);
  assert.equal(after.state.questProgress.find(progress => progress.questId === 'quest-hidden-room').status, 'succeeded');
  assert.equal(after.state.itemOwners['item-key'], 'actor-shen');
  assert.ok(assembleBook({ entries, sections }, 'player_handbook', {
    includeGm: false, knowledge: { discoveredEntryIds: new Set(after.state.discoveries.map(item => item.entryId)) },
  }).flatMap(group => group.entries).some(found => found.entryId === 'clue-secret'));
  assert.equal(db.prepare("SELECT count(*) n FROM branch_knowledge WHERE branch_id='camp-knowledge-main'").get().n, 1);
  assert.equal(db.prepare("SELECT status FROM quest_states WHERE branch_id='camp-knowledge-main' AND quest_id='quest-hidden-room'").get().status, 'succeeded');
  assert.equal(db.prepare("SELECT count(*) n FROM quest_reward_ledger WHERE branch_id='camp-knowledge-main'").get().n, 1);

  const fork = await session.rewind({ campaignId: 'camp-knowledge', sourceBranchId: 'camp-knowledge-main', atStateVersion: before.state.stateVersion,
    newBranchId: 'camp-knowledge-past' });
  const past = await session.getSummary('camp-knowledge', fork.branchId);
  assert.deepEqual(past.state.discoveries, [], 'rewind restores pre-discovery knowledge');
  assert.equal(past.state.questProgress.find(progress => progress.questId === 'quest-hidden-room').status, 'available');
  assert.equal(past.state.itemOwners['item-key'], undefined, 'rewind does not carry a future reward');

  const save = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex, campaignId: 'camp-knowledge', branchId: 'camp-knowledge-main', createdAt: 't1' });
  await restoreSave({ db: adapter, save: save.save, newCampaignId: 'camp-knowledge-copy', newBranchId: 'camp-knowledge-copy-main', createdAt: 't2' });
  const restored = await new SqliteTurnStore(adapter).getState('camp-knowledge-copy-main');
  assert.deepEqual(restored.discoveries.map(discovery => discovery.entryId), ['clue-secret']);
  assert.equal(restored.questProgress.find(progress => progress.questId === 'quest-hidden-room').status, 'succeeded');
  assert.equal(restored.itemOwners['item-key'], 'actor-shen');
  db.close();
});

test('session retrieves a relevant event older than the six-entry recent-story window', async () => {
  const db = setupDb();
  const { session, provider } = await makeSession(db);
  const capturedContexts = [];
  const originalComplete = provider.complete.bind(provider);
  provider.override = payload => ({
    proposalVersion: '2.0', turnId: payload.turnId, expectedStateVersion: payload.expectedStateVersion,
    actorId: 'actor-shen', actionKind: 'observe', evidenceIds: [], intent: payload.playerIntent,
  });
  provider.complete = async request => {
    const payload = JSON.parse(request.user);
    if (request.role === 'Planner') capturedContexts.push(payload.worldContext);
    if (request.role === 'Narrator') {
      return {
        text: JSON.stringify({ turnId: payload.turnId, outcomeGrade: payload.outcomeGrade,
          text: `公开叙事记录：${payload.playerIntent}` }),
        usage: { inputTokens: 8, outputTokens: 4, estimated: false },
      };
    }
    return originalComplete(request);
  };

  const marker = '深井密钥-OLDMEMORY-7Q';
  for (let index = 0; index < 8; index += 1) {
    const intent = index === 0 ? `记录线索 ${marker}` : `普通探索 ${index}`;
    await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent });
  }
  await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: `查询 ${marker}` });
  const context = capturedContexts[8];
  assert.ok(context.includes('【相关长期记忆】'), 'relevant retrieval is present in the Planner context');
  assert.ok(context.includes(marker), 'a matching event outside the six most recent turns is retrieved');
  assert.ok(!context.slice(context.lastIndexOf('【最近的经历】')).includes(marker),
    'the old event was surfaced by retrieval, not by the six-entry recent-story section');
  db.close();
});

test('portable world package ZIP validates, remaps and imports without bundling source text', async () => {
  const db = setupDb();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await seedWorld(db, worldStore, 'w-portable');
  const published = await publishSample(worldStore, 'w-portable');
  const pkg = await worldStore.getWorldPackage('w-portable', published.manifest.revision);
  const { encodeWorldPackageArchive, decodeWorldPackageArchive, importPortableWorldPackage } =
    require('../dist/application/export/worldPackageArchive');
  const archive = await encodeWorldPackageArchive({
    title: '可移植测试世界', manifest: pkg.manifest, entries: pkg.entries, sections: pkg.sections,
  }, sha.sha256Hex);
  assert.deepEqual(Array.from(archive.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04], 'export is a real ZIP container');
  const decoded = await decodeWorldPackageArchive(archive, sha.sha256Hex);
  assert.equal(decoded.title, '可移植测试世界');
  assert.equal(decoded.manifest.contentHash, pkg.manifest.contentHash);
  const imported = await importPortableWorldPackage({
    worldStore, sha256Hex: sha.sha256Hex, archive, newWorldId: 'w-portable-copy', createdAt: 't1',
  });
  assert.equal(imported.revision, 1);
  assert.equal((await worldStore.getWorld('w-portable-copy')).sourceBytes, 0, 'the portable package does not claim to contain novel source');
  const copy = await worldStore.getWorldPackage('w-portable-copy', 1);
  assert.equal(copy.manifest.status, 'published');
  assert.deepEqual(copy.entries.map(entry => entry.entryId).sort(), pkg.entries.map(entry => entry.entryId).sort());
  const damaged = archive.slice();
  damaged[48] = (damaged[48] ?? 0) ^ 0x01;
  await assert.rejects(() => decodeWorldPackageArchive(damaged, sha.sha256Hex), /checksum/);
  db.close();
});

test('portable package identity restores a combat save after local world-id remapping', async () => {
  const sourceDb = setupDb();
  const { session: sourceSession, adapter: sourceAdapter, worldStore: sourceWorldStore } = await makeSession(sourceDb);
  const sourceEncounter = await sourceSession.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: 'portable-active',
    hostiles: [{ templateId: 'guard-template', count: 1 }],
  });
  const sourceSummary = await sourceSession.getSummary('camp-s', 'camp-s-main');
  const sourcePackage = await sourceWorldStore.getWorldPackage('w-pkg', 1);
  const { encodeWorldPackageArchive, importPortableWorldPackage } =
    require('../dist/application/export/worldPackageArchive');
  const archive = await encodeWorldPackageArchive({ title: '测试世界', ...sourcePackage }, sha.sha256Hex);
  const exported = await exportSave({ db: sourceAdapter, sha256Hex: sha.sha256Hex,
    campaignId: 'camp-s', branchId: 'camp-s-main', createdAt: 'portable-save' });
  assert.equal(exported.save.manifest.worldRef.packageContentHash, sourcePackage.manifest.contentHash,
    'the save locks the exact published package content as well as its revision');

  const targetDb = setupDb();
  const targetAdapter = new NodeSqliteAdapter(targetDb);
  const targetWorldStore = new SqliteWorldStore(targetAdapter);
  const imported = await importPortableWorldPackage({
    worldStore: targetWorldStore, sha256Hex: sha.sha256Hex, archive,
    newWorldId: 'w-portable-local-copy', createdAt: 'portable-import',
  });
  assert.equal(imported.worldId, 'w-portable-local-copy');
  assert.equal(imported.revision, sourcePackage.manifest.revision,
    'portable import preserves the campaign-locked revision instead of rebasing it');
  const importedPackage = await targetWorldStore.getWorldPackage(imported.worldId, imported.revision);
  assert.equal(importedPackage.manifest.contentHash, sourcePackage.manifest.contentHash,
    'portable import preserves the immutable package content identity');
  assert.deepEqual(importedPackage.entries.map(item => item.revision), sourcePackage.entries.map(item => item.revision));

  await restoreSave({ db: targetAdapter, save: exported.save,
    newCampaignId: 'portable-restored-campaign', newBranchId: 'portable-restored-main', createdAt: 'portable-restore' });
  const restoredSession = new CampaignSession({
    db: targetAdapter,
    turns: new SqliteTurnStore(targetAdapter),
    game: new SqliteGameStore(targetAdapter),
    worldStore: targetWorldStore,
    narratives: new SqliteNarrativeStore(targetAdapter),
    hashProvider: sha,
    random: RNG_MAX,
  }, new ProposalProvider(), { endpoint: 'https://x', model: 'test-model', keyRef: 'kr' });
  const restoredEncounter = await restoredSession.getActiveEncounter('portable-restored-campaign', 'portable-restored-main');
  assert.ok(restoredEncounter, 'an imported world package resolves the save dependency after local-id remapping');
  assert.equal(restoredEncounter.currentActorId, sourceEncounter.currentActorId,
    'the previously active actor remains next to act after clean import');
  const restoredSummary = await restoredSession.getSummary('portable-restored-campaign', 'portable-restored-main');
  assert.equal(restoredSummary.state.actors[sourceEncounter.actors.find(actor => actor.side === 'hostile').actorId].resources.hp,
    sourceSummary.state.actors[sourceEncounter.actors.find(actor => actor.side === 'hostile').actorId].resources.hp);
  assert.equal(restoredSummary.state.encounters[0].state.encounterId, sourceSummary.state.encounters[0].state.encounterId);
  const restoredCampaign = await targetAdapter.queryOne(
    'SELECT world_id, package_revision FROM campaigns WHERE campaign_id = ?', ['portable-restored-campaign']);
  assert.equal(restoredCampaign.world_id, 'w-portable-local-copy');
  assert.equal(restoredCampaign.package_revision, sourcePackage.manifest.revision);

  const reExported = await exportSave({ db: targetAdapter, sha256Hex: sha.sha256Hex,
    campaignId: 'portable-restored-campaign', branchId: 'portable-restored-main', createdAt: 'portable-re-export' });
  assert.equal(reExported.save.manifest.worldRef.worldId, 'w-portable-local-copy');
  const chainedDb = setupDb();
  const chainedAdapter = new NodeSqliteAdapter(chainedDb);
  const chainedWorldStore = new SqliteWorldStore(chainedAdapter);
  const chainedImport = await importPortableWorldPackage({
    // Re-import the original portable package while restoring a save exported
    // from an already-remapped local world id: the content hash, not the
    // original local id, is the immutable identity across this extra hop.
    worldStore: chainedWorldStore, sha256Hex: sha.sha256Hex, archive,
    newWorldId: 'w-portable-second-copy', createdAt: 'portable-second-import',
  });
  assert.equal(chainedImport.revision, sourcePackage.manifest.revision);
  await restoreSave({ db: chainedAdapter, save: reExported.save,
    newCampaignId: 'portable-chained-campaign', newBranchId: 'portable-chained-main', createdAt: 'portable-chained-restore' });
  const chainedSession = new CampaignSession({
    db: chainedAdapter,
    turns: new SqliteTurnStore(chainedAdapter),
    game: new SqliteGameStore(chainedAdapter),
    worldStore: chainedWorldStore,
    narratives: new SqliteNarrativeStore(chainedAdapter),
    hashProvider: sha,
    random: RNG_MAX,
  }, new ProposalProvider(), { endpoint: 'https://x', model: 'test-model', keyRef: 'kr' });
  const chainedEncounter = await chainedSession.getActiveEncounter('portable-chained-campaign', 'portable-chained-main');
  assert.ok(chainedEncounter, 'an exported save remains portable after its world package has crossed multiple import hops');
  assert.equal(chainedEncounter.currentActorId, sourceEncounter.currentActorId,
    'transitive package identity preserves the active initiative slot');
  assert.equal((await chainedAdapter.queryOne(
    'SELECT world_id FROM campaigns WHERE campaign_id = ?', ['portable-chained-campaign'])).world_id,
  'w-portable-second-copy');

  const wrongLock = structuredClone(exported.save);
  wrongLock.manifest.worldRef.packageContentHash = 'f'.repeat(64);
  await assert.rejects(() => restoreSave({ db: targetAdapter, save: wrongLock,
    newCampaignId: 'portable-wrong-lock', newBranchId: 'portable-wrong-lock-main', createdAt: 'portable-wrong-lock' }),
  /Missing dependency|different content hash/);
  assert.equal(await targetAdapter.queryOne('SELECT campaign_id FROM campaigns WHERE campaign_id = ?', ['portable-wrong-lock']), null,
    'a different same-revision package is rejected before creating a campaign');
  sourceDb.close();
  targetDb.close();
  chainedDb.close();
});

test('portable archive preserves builder and draft content-hash basis across immutable revisions', async () => {
  const db = setupDb();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await seedWorld(db, worldStore, 'w-revision-hash');
  const first = await publishSample(worldStore, 'w-revision-hash', { entryRevision: 0 });
  const built = await worldStore.getWorldPackage('w-revision-hash', first.manifest.revision);
  const { publishWorldPackage } = require('../dist/application/worldPackage/publish');
  const { computePackageContentHash } = require('../dist/application/worldPackage/validate');
  const { encodeWorldPackageArchive, decodeWorldPackageArchive } =
    require('../dist/application/export/worldPackageArchive');
  const { importPortableWorldPackage } = require('../dist/application/export/worldPackageArchive');

  // The canon builder emits revision 0, while the immutable DB row stores r1.
  // The ZIP records which input revision the legacy manifest hash covered.
  assert.ok(built.entries.every(item => item.revision === 1));
  assert.notEqual(
    await computePackageContentHash(built.entries, built.sections, sha.sha256Hex),
    built.manifest.contentHash,
    'the stored revision differs from the builder revision covered by the hash',
  );
  const firstArchive = await encodeWorldPackageArchive({ title: '版本哈希测试世界', ...built }, sha.sha256Hex);
  const firstDecoded = await decodeWorldPackageArchive(firstArchive, sha.sha256Hex);
  assert.equal(firstDecoded.contentHashBasisRevision, 0);

  // An editor draft starts from the stored r1 entries and publishes r2. The
  // hash basis must remain r1, and portable import must preserve the immutable r2 lock.
  const second = await publishWorldPackage({
    worldStore,
    sha256Hex: sha.sha256Hex,
    worldId: 'w-revision-hash',
    sourceSha256: 'a'.repeat(64),
    mappingVersion: 'map-2',
    entries: built.entries,
    sections: built.sections,
    createdAt: 't2',
  });
  assert.equal(second.manifest.revision, 2);
  const stored = await worldStore.getWorldPackage('w-revision-hash', 2);
  assert.ok(stored.entries.every(item => item.revision === 2));
  const archive = await encodeWorldPackageArchive({
    title: '版本哈希测试世界', ...stored,
  }, sha.sha256Hex);
  const decoded = await decodeWorldPackageArchive(archive, sha.sha256Hex);
  assert.equal(decoded.manifest.revision, 2);
  assert.equal(decoded.contentHashBasisRevision, 1);

  const imported = await importPortableWorldPackage({
    worldStore, sha256Hex: sha.sha256Hex, archive, newWorldId: 'w-revision-hash-copy', createdAt: 't-import',
  });
  assert.equal(imported.revision, 2);
  const copy = await worldStore.getWorldPackage(imported.worldId, imported.revision);
  assert.equal(copy.manifest.contentHash, stored.manifest.contentHash);
  assert.ok(copy.entries.every(item => item.revision === 2));
  const copyArchive = await encodeWorldPackageArchive({ title: '版本哈希副本', ...copy }, sha.sha256Hex);
  assert.equal((await decodeWorldPackageArchive(copyArchive, sha.sha256Hex)).contentHashBasisRevision, 1);
  db.close();
});

test('world entry drafts persist separately, validate, and publish as a new immutable revision', async () => {
  const db = setupDb();
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);
  await seedWorld(db, worldStore, 'w-draft');
  const first = await publishSample(worldStore, 'w-draft');
  const base = await worldStore.getWorldPackage('w-draft', first.manifest.revision);
  const draftEntries = base.entries.map(item => item.entryId === 'lore-rain'
    ? { ...item, definition: { ...item.definition, text: '草稿：藏书阁雨夜巡逻加倍。' } }
    : item);
  await worldStore.saveWorldPackageDraft({ worldId: 'w-draft', baseRevision: 1,
    draftJson: JSON.stringify({ entries: draftEntries, sections: base.sections }), updatedAt: 't-draft' });
  const savedDraft = await worldStore.getWorldPackageDraft('w-draft');
  assert.equal(savedDraft.baseRevision, 1);
  assert.equal(JSON.parse(savedDraft.draftJson).entries.find(item => item.entryId === 'lore-rain').definition.text,
    '草稿：藏书阁雨夜巡逻加倍。');
  assert.equal((await worldStore.getWorldPackage('w-draft', 1)).entries.find(item => item.entryId === 'lore-rain').definition.text,
    '藏书阁雨夜有守卫巡逻。', 'draft editing never mutates the published package');
  const { publishWorldPackage } = require('../dist/application/worldPackage/publish');
  const second = await publishWorldPackage({ worldStore, sha256Hex: sha.sha256Hex, worldId: 'w-draft',
    sourceSha256: 'a'.repeat(64), mappingVersion: 'map-1', entries: draftEntries, sections: base.sections, createdAt: 't-publish' });
  assert.equal(second.manifest.revision, 2);
  assert.equal((await worldStore.getWorldPackage('w-draft', 1)).entries.find(item => item.entryId === 'lore-rain').definition.text,
    '藏书阁雨夜有守卫巡逻。');
  assert.equal((await worldStore.getWorldPackage('w-draft', 2)).entries.find(item => item.entryId === 'lore-rain').definition.text,
    '草稿：藏书阁雨夜巡逻加倍。');
  await assert.rejects(() => worldStore.saveWorldPackageDraft({ worldId: 'w-draft', baseRevision: 1,
    draftJson: JSON.stringify({ entries: draftEntries, sections: base.sections }), updatedAt: 't-stale' }), /stale/);
  await worldStore.clearWorldPackageDraft('w-draft', 1);
  assert.equal(await worldStore.getWorldPackageDraft('w-draft'), null);
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

// ---------------------------------------------------------------------------
// Closeout C6: scene fate contract drives disabled fates end to end.
// ---------------------------------------------------------------------------

test('closeout C6: scene fate contract assigns death_risk when a hostile drops', async () => {
  const db = setupDb();
  const { session } = await makeSession(db, { initialSkills: ['sword'] });
  let view = await session.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: 'fate-scene',
    hostiles: [{ templateId: 'guard-template' }],
    fateContract: {
      encounterId: 'fate-scene',
      rules: [
        { fate: 'death_risk', appliesTo: 'npc', minDisabledRounds: 0, priority: 1, outcome: { kind: 'death_risk', lethalAfterRounds: 3 } },
        { fate: 'awaits_rescue', appliesTo: 'companion', minDisabledRounds: 0, priority: 2, outcome: { kind: 'awaits_rescue' } },
      ],
    },
  });
  // Drive the encounter: max rolls mean the guard drops quickly; the loop
  // keeps turns moving until the encounter ends or the fate lands.
  let steps = 0;
  while (view.status === 'active' && steps < 40) {
    const npc = view.actors.find(actor => actor.side === 'npc' && actor.hp > 0);
    if (view.currentActorIsPlayer) {
      view = npc
        ? await session.encounterAttack({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId: `fate-atk-${steps}`, targetId: npc.actorId, skillId: 'sword' })
        : await session.encounterPassTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId: `fate-pass-${steps}` });
    } else {
      view = await session.encounterNpcTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId: `fate-npc-${steps}` });
    }
    steps += 1;
  }
  const dropped = Object.values(view.fates ?? {});
  assert.ok(dropped.length > 0, `fate states must exist after a hostile drops (steps=${steps})`);
  const guardFate = dropped.find(state => state.fate === 'death_risk');
  assert.ok(guardFate, 'the contract assigns death_risk to a disabled hostile');
  assert.ok(guardFate.phase === 'active' || guardFate.phase === 'concluded');
  // Reload from persistence: fate states and the contract survive.
  const reloaded = await session.getEncounterView('camp-s', 'camp-s-main', 'fate-scene');
  assert.deepEqual(reloaded.fates[Object.keys(reloaded.fates)[0]], view.fates[Object.keys(view.fates)[0]]);
  db.close();
});

test('closeout C6: no contract means no automatic fate (explicit, not guessed)', async () => {
  const db = setupDb();
  const { session } = await makeSession(db, { initialSkills: ['sword'] });
  let view = await session.beginEncounter({
    campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: 'nofate-scene',
    hostiles: [{ templateId: 'guard-template' }],
  });
  let steps = 0;
  while (view.status === 'active' && steps < 40) {
    const npc = view.actors.find(actor => actor.side === 'npc' && actor.hp > 0);
    if (view.currentActorIsPlayer) {
      view = npc
        ? await session.encounterAttack({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId: `nf-atk-${steps}`, targetId: npc.actorId, skillId: 'sword' })
        : await session.encounterPassTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId: `nf-pass-${steps}` });
    } else {
      view = await session.encounterNpcTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: view.encounterId, requestId: `nf-npc-${steps}` });
    }
    steps += 1;
  }
  assert.equal(Object.keys(view.fates ?? {}).length, 0, 'without a contract no fate is invented');
  assert.equal(view.endingTriggered, null);
  db.close();
});

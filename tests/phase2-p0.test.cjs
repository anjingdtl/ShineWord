const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');
const { SqliteGameStore } = require('../dist/infra/sqlite/sqliteGameStore');
const { forkBranch, markDivergence } = require('../dist/application/branch/fork');
const { commitResolvedTurn } = require('../dist/application/turns/commitTurn');
const { settleTurnProgress } = require('../dist/application/game/turnSettlement');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const {
  exportSave, validateSaveJson, restoreSave, SAVE_SCHEMA_VERSION,
} = require('../dist/application/export/saveFile');
const { canonicalStringify } = require('../dist/domain/turns/canonical');
const { cloneGameState } = require('../dist/domain/state/types');

const { createHash } = require('node:crypto');

// Same adapter shape the RN sqlite driver presents (used by all store tests).
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

const sha = {
  sha256Hex: input => createHash('sha256').update(input, 'utf8').digest('hex'),
  sha256BytesHex: bytes => createHash('sha256').update(bytes).digest('hex'),
};

function setupDb() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) db.exec(statement);
  }
  return db;
}

function seedBranch(db, branchId, campaignId = 'camp-1', stateVersion = 0) {
  db.prepare('INSERT INTO worlds (world_id, title, source_sha256, source_bytes, normalize_version, chapter_split_version, build_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('world-1', 'w', 'a'.repeat(64), 1, 'n', 'c', 'ready', 't', 't');
  // A published package the campaign can lock (v3 saves carry the lock).
  db.prepare(`INSERT INTO world_packages (world_id, revision, source_sha256, ruleset_id, ruleset_version, mapping_version, status, content_hash, created_at)
    VALUES ('world-1', 1, ?, 'shineword-core', '0.1.0', '1', 'published', ?, 't')`)
    .run('a'.repeat(64), 'c'.repeat(64));
  db.prepare(`INSERT INTO campaigns (campaign_id, world_id, title, ruleset_id, ruleset_version, world_mapping_version, opening_json, created_at, package_revision, anchor_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '{}', 'active')`)
    .run(campaignId, 'world-1', 'c', 'shineword-core', '0.1.0', '1', '{}', 't');
  db.prepare('INSERT INTO branches (branch_id, campaign_id, state_version, created_at) VALUES (?, ?, ?, ?)')
    .run(branchId, campaignId, stateVersion, 't');
  db.prepare('INSERT INTO actor_states (branch_id, actor_id, state_version, location_id, resources_json, conditions_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(branchId, 'actor-player', stateVersion, 'start', JSON.stringify({ hp: 10, stamina: 10 }), '[]');
  // A phase-2 campaign owns cards and party membership (v3 saves carry them).
  const card = {
    actorId: 'actor-player', name: 'p', kind: 'original', controller: 'player',
    attributes: { physique: 1, agility: 2, insight: 1, knowledge: 1, willpower: 1, social: 1 },
    skills: {}, abilities: [], preparedAbilities: [], resourceMax: { hp: 10, stamina: 10 },
    defense: 2, powerTier: 'ordinary', rulesetId: 'shineword-core', rulesetVersion: '0.1.0',
    worldId: 'world-1', worldPackageRevision: 1, cardRevision: 1,
  };
  db.prepare('INSERT INTO actor_cards (branch_id, actor_id, card_json, created_at, updated_at, updated_state_version) VALUES (?, ?, ?, ?, ?, ?)')
    .run(branchId, 'actor-player', JSON.stringify(card), 't', 't', stateVersion);
  db.prepare('INSERT INTO party_members (branch_id, actor_id, controller, role, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run(branchId, 'actor-player', 'player', 'protagonist', 't');
}

function moveContract(turnId, expectedStateVersion, locationId) {
  return {
    protocolVersion: '2.0', turnId, expectedStateVersion,
    actorId: 'actor-player', actionType: 'move', evidenceIds: ['e'],
    requiresRoll: false, intent: 'move on', timeCostMinutes: 5, resourcePreconditions: [],
    outcomes: {
      full_success: { achieved: true, publicSummary: 'ok', effects: [{ op: 'changeLocation', actorId: 'actor-player', locationId }] },
      success: { achieved: true, publicSummary: 'ok', effects: [{ op: 'changeLocation', actorId: 'actor-player', locationId }] },
      failure: { achieved: false, publicSummary: 'no', effects: [] },
      severe_failure: { achieved: false, publicSummary: 'bad', effects: [] },
    },
  };
}

test('phase2 commits stamp complete snapshots (skills + relationships) in one transaction', async () => {
  const db = setupDb();
  try {
    seedBranch(db, 'b-snap');
    const adapter = new NodeSqliteAdapter(db);
    const turnStore = new SqliteTurnStore(adapter);
    const gameStore = new SqliteGameStore(adapter);

    const progress = { actorId: 'actor-player', skillId: 'stealth', rank: 'novice', practicePoints: 2, awardedKeys: ['enc-0:practice'], stateVersion: 1 };
    await commitResolvedTurn({
      store: turnStore, branchId: 'b-snap',
      contract: moveContract('turn-0001', 0, 'archive'),
      contractHash: await sha.sha256Hex('c1'),
      outcomeGrade: 'success',
      settlement: {
        encounterId: 'enc-0',
        skillUpserts: [progress],
        rewardLedger: [{ encounterId: 'enc-0', actorId: 'actor-player', skillId: 'stealth', rewardKind: 'practice' }],
        relationships: [{ relId: 'r1', fromActorId: 'actor-player', toActorId: 'npc-guard', stance: 'wary', closeness: -2, updatedTurnId: 'turn-0001' }],
      },
      committedAt: 't1',
    });

    const snapshotRow = db.prepare("SELECT snapshot_json FROM snapshots WHERE branch_id = 'b-snap' AND state_version = 1").get();
    const snapshot = JSON.parse(snapshotRow.snapshot_json);
    assert.deepEqual(snapshot.skills, [{ actorId: 'actor-player', skillId: 'stealth', rank: 'novice', practicePoints: 2, awardedKeys: ['enc-0:practice'] }]);
    assert.equal(snapshot.relationships.length, 1);

    // The ledger row and skill row landed in the SAME commit; a replay finds
    // the committed turn and never re-executes the settlement.
    const ledger = db.prepare("SELECT COUNT(*) AS n FROM reward_ledger WHERE branch_id = 'b-snap'").get();
    assert.equal(ledger.n, 1);

    // A second attempt at the same encounter through a different turn is
    // aborted atomically: no new turn row, no double reward.
    await assert.rejects(
      async () => commitResolvedTurn({
        store: turnStore, branchId: 'b-snap',
        contract: moveContract('turn-0002', 1, 'gate'),
        contractHash: await sha.sha256Hex('c2'),
        outcomeGrade: 'success',
        settlement: {
          encounterId: 'enc-0',
          skillUpserts: [{ ...progress, practicePoints: 3, stateVersion: 2 }],
          rewardLedger: [{ encounterId: 'enc-0', actorId: 'actor-player', skillId: 'stealth', rewardKind: 'practice' }],
          relationships: [],
        },
        committedAt: 't2',
      }),
      /double award/,
    );
    const turn2 = db.prepare("SELECT COUNT(*) AS n FROM turns WHERE branch_id = 'b-snap' AND turn_id = 'turn-0002'").get();
    assert.equal(turn2.n, 0, 'aborted commit leaves no partial turn');
  } finally {
    db.close();
  }
});

test('historical fork restores the fork-point skills and relationships, never current rows', async () => {
  const db = setupDb();
  try {
    seedBranch(db, 'main');
    const adapter = new NodeSqliteAdapter(db);
    const turnStore = new SqliteTurnStore(adapter);
    const gameStore = new SqliteGameStore(adapter);

    // V1: novice stealth via settlement. V2: expert sword (current state).
    await commitResolvedTurn({
      store: turnStore, branchId: 'main',
      contract: moveContract('turn-0001', 0, 'archive'),
      contractHash: await sha.sha256Hex('c1'), outcomeGrade: 'success',
      settlement: {
        encounterId: 'enc-1',
        skillUpserts: [{ actorId: 'actor-player', skillId: 'stealth', rank: 'novice', practicePoints: 1, awardedKeys: ['enc-1:practice'], stateVersion: 1 }],
        rewardLedger: [{ encounterId: 'enc-1', actorId: 'actor-player', skillId: 'stealth', rewardKind: 'practice' }],
        relationships: [{ relId: 'r1', fromActorId: 'actor-player', toActorId: 'npc-a', stance: 'wary', closeness: -3, updatedTurnId: 'turn-0001' }],
      },
      committedAt: 't1',
    });
    await commitResolvedTurn({
      store: turnStore, branchId: 'main',
      contract: moveContract('turn-0002', 1, 'gate'),
      contractHash: await sha.sha256Hex('c2'), outcomeGrade: 'success',
      settlement: {
        encounterId: 'enc-2',
        skillUpserts: [{ actorId: 'actor-player', skillId: 'sword', rank: 'expert', practicePoints: 0, awardedKeys: [], stateVersion: 2 }],
        rewardLedger: [{ encounterId: 'enc-2', actorId: 'actor-player', skillId: 'sword', rewardKind: 'practice' }],
        relationships: [{ relId: 'r1', fromActorId: 'actor-player', toActorId: 'npc-a', stance: 'friendly', closeness: 9, updatedTurnId: 'turn-0002' }],
      },
      committedAt: 't2',
    });

    const forked = await forkBranch({
      db: adapter, turnStore, gameStore,
      sourceBranchId: 'main', targetBranchId: 'rewind', campaignId: 'camp-1',
      forkTurnId: 'turn-0001', atStateVersion: 1, createdAt: 't3',
    });
    assert.equal(forked.historyComplete, true);
    assert.equal(forked.snapshot.stateVersion, 1);

    // The rewound branch holds the V1 progress, not the branch head's.
    const skills = await gameStore.listSkillProgress('rewind', 'actor-player');
    assert.deepEqual(skills.map(s => ({ id: s.skillId, rank: s.rank, points: s.practicePoints })),
      [{ id: 'stealth', rank: 'novice', points: 1 }]);
    const rels = await gameStore.listRelationships('rewind');
    assert.equal(rels[0].closeness, -3, 'relationship restored from the fork point');

    // Ledger rows were NOT copied: the fork may re-earn rewards in its own
    // timeline, while the source ledger stays intact.
    const forkLedger = db.prepare("SELECT COUNT(*) AS n FROM reward_ledger WHERE branch_id = 'rewind'").get();
    assert.equal(forkLedger.n, 0, 'reward ledger belongs to the branch timeline');

    // Source branch unchanged.
    const mainSkills = await gameStore.listSkillProgress('main', 'actor-player');
    assert.equal(mainSkills.length, 2);
  } finally {
    db.close();
  }
});

test('legacy snapshot without skill history refuses historical fork instead of fabricating', async () => {
  const db = setupDb();
  try {
    seedBranch(db, 'legacy');
    const adapter = new NodeSqliteAdapter(db);
    const turnStore = new SqliteTurnStore(adapter);
    const gameStore = new SqliteGameStore(adapter);

    // A pre-Phase-2 snapshot: actors only, no skills/relationships arrays.
    db.prepare("INSERT INTO snapshots (branch_id, state_version, snapshot_json, state_hash, created_at) VALUES ('legacy', 0, ?, NULL, 't')")
      .run(JSON.stringify({
        branchId: 'legacy', stateVersion: 0, clockMinutes: 0,
        actors: { 'actor-player': { actorId: 'actor-player', locationId: 'start', resources: { hp: 10, stamina: 10 }, conditions: [] } },
        itemOwners: {},
      }));

    // Move the legacy branch head forward so version 0 is genuinely historical.
    await commitResolvedTurn({
      store: turnStore, branchId: 'legacy',
      contract: moveContract('turn-0001', 0, 'archive'),
      contractHash: await sha.sha256Hex('cl'), outcomeGrade: 'success',
      committedAt: 't1',
    });

    await assert.rejects(
      async () => forkBranch({
        db: adapter, turnStore, gameStore,
        sourceBranchId: 'legacy', targetBranchId: 'leg-fork', campaignId: 'camp-1',
        forkTurnId: null, atStateVersion: 0, createdAt: 't',
      }),
      /fabricate progress|lacks skill\/relationship history/,
    );

    // Forking at HEAD is still allowed: current rows ARE the head values.
    const headFork = await forkBranch({
      db: adapter, turnStore, gameStore,
      sourceBranchId: 'legacy', targetBranchId: 'leg-head', campaignId: 'camp-1',
      forkTurnId: null, atStateVersion: undefined, createdAt: 't',
    });
    assert.equal(headFork.snapshot.stateVersion, 1);
    assert.equal(headFork.historyComplete, false);
  } finally {
    db.close();
  }
});

test('cloneGameState deep-copies skill and relationship projections', () => {
  const state = {
    branchId: 'b', stateVersion: 3, clockMinutes: 12,
    actors: {}, itemOwners: {},
    skills: [{ actorId: 'a', skillId: 's', rank: 'trained', practicePoints: 1, awardedKeys: ['e:practice'] }],
    relationships: [{ relId: 'r', fromActorId: 'a', toActorId: 'n', stance: 'wary', closeness: 1, updatedTurnId: null }],
  };
  const cloned = cloneGameState(state);
  cloned.skills[0].awardedKeys.push('e2:practice');
  cloned.relationships[0].closeness = 99;
  assert.equal(state.skills[0].awardedKeys.length, 1);
  assert.equal(state.relationships[0].closeness, 1);
});

test('save round-trip: export hashes payload, restore rebuilds a new campaign atomically', async () => {
  const db = setupDb();
  try {
    seedBranch(db, 'main', 'camp-src');
    const adapter = new NodeSqliteAdapter(db);
    const turnStore = new SqliteTurnStore(adapter);
    const gameStore = new SqliteGameStore(adapter);

    await commitResolvedTurn({
      store: turnStore, branchId: 'main',
      contract: moveContract('turn-0001', 0, 'archive'),
      contractHash: await sha.sha256Hex('c1'), outcomeGrade: 'success',
      settlement: {
        encounterId: 'enc-1',
        skillUpserts: [{ actorId: 'actor-player', skillId: 'stealth', rank: 'novice', practicePoints: 1, awardedKeys: ['enc-1:practice'], stateVersion: 1 }],
        rewardLedger: [{ encounterId: 'enc-1', actorId: 'actor-player', skillId: 'stealth', rewardKind: 'practice' }],
        relationships: [{ relId: 'r1', fromActorId: 'actor-player', toActorId: 'npc-a', stance: 'wary', closeness: -1, updatedTurnId: 'turn-0001' }],
      },
      committedAt: 't1',
    });
    db.prepare("INSERT INTO turn_narratives (branch_id, turn_id, outcome_grade, text, status, created_at) VALUES ('main', 'turn-0001', 'success', '雨夜潜入成功。', 'Committed', 't1')")
      .run();

    const { json, jsonByteLength } = await exportSave({
      db: adapter, sha256Hex: sha.sha256Hex, campaignId: 'camp-src', branchId: 'main', createdAt: 't',
    });
    assert.equal(typeof jsonByteLength, 'number');
    assert.ok(jsonByteLength > 0);
    assert.ok(json.includes(SAVE_SCHEMA_VERSION));

    const validated = await validateSaveJson(json, sha.sha256Hex);
    assert.deepEqual(validated, { ok: true, errors: [] });

    // Restore as a NEW campaign/branch into the same DB.
    const restored = await restoreSave({
      db: adapter, save: JSON.parse(json), sha256Hex: sha.sha256Hex,
      newCampaignId: 'camp-restore', newBranchId: 'restored-main', createdAt: 't2',
    });
    assert.equal(restored.branchId, 'restored-main');
    assert.equal(restored.stateVersion, 1);

    const turnState = await turnStore.getState('restored-main');
    assert.equal(turnState.stateVersion, 1);
    assert.equal(turnState.actors['actor-player'].locationId, 'archive');
    const restoredSkills = await gameStore.listSkillProgress('restored-main', 'actor-player');
    assert.equal(restoredSkills[0].rank, 'novice');
    const restoredNarratives = db.prepare("SELECT COUNT(*) AS n FROM turn_narratives WHERE branch_id = 'restored-main' AND status = 'Committed'").get();
    assert.equal(restoredNarratives.n, 1, 'committed narrative is restored');
    const restoredRolls = db.prepare("SELECT COUNT(*) AS n FROM roll_records WHERE branch_id = 'restored-main'").get();

    // Missing world dependency: explicit error, never a silent restore.
    await assert.rejects(
      async () => restoreSave({
        db: adapter,
        save: { ...JSON.parse(json), manifest: { ...JSON.parse(json).manifest, worldRef: { worldId: 'ghost-world', sourceSha256: 'b'.repeat(64) } } },
        sha256Hex: sha.sha256Hex,
        newCampaignId: 'camp-ghost', newBranchId: 'ghost-main', createdAt: 't3',
      }),
      /Save validation failed before restore/,
    );
    // Hash mismatch on the world: refuse to mix versions.
    await assert.rejects(
      async () => restoreSave({
        db: adapter,
        save: { ...JSON.parse(json), manifest: { ...JSON.parse(json).manifest, worldRef: { worldId: 'world-1', sourceSha256: 'c'.repeat(64) } } },
        sha256Hex: sha.sha256Hex,
        newCampaignId: 'camp-hash', newBranchId: 'hash-main', createdAt: 't3',
      }),
      /Save validation failed before restore/,
    );
  } finally {
    db.close();
  }
});

test('divergence overlay is per-branch; two campaigns of one novel never pollute', async () => {
  const db = setupDb();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const worldStore = new SqliteWorldStore(adapter);
    const createdAt = 't';
    await worldStore.createWorld({
      worldId: 'w-div', title: 'w', sourceSha256: 'a'.repeat(64), sourceBytes: 1,
      normalizeVersion: 'n', chapterSplitVersion: 'c', buildStatus: 'ready',
      createdAt, updatedAt: createdAt,
    });
    await worldStore.saveEvent({
      worldId: 'w-div', eventId: 'ev-anchor', title: 'a', summary: 's',
      worldTimeOrder: 1, narrativeChapterId: null, validFrom: null, validTo: null,
      status: 'canon', dependsOnEventIds: [],
    }, createdAt);
    await worldStore.saveEvent({
      worldId: 'w-div', eventId: 'ev-later', title: 'l', summary: 's',
      worldTimeOrder: 5, narrativeChapterId: null, validFrom: null, validTo: null,
      status: 'canon', dependsOnEventIds: [],
    }, createdAt);

    await markDivergence(worldStore, 'w-div', 'ev-anchor', 'branch-one');
    const branchOne = await worldStore.listEvents('w-div', 'branch-one');
    assert.equal(branchOne.find(e => e.eventId === 'ev-later').status, 'pending');

    const shared = await worldStore.listEvents('w-div');
    assert.equal(shared.find(e => e.eventId === 'ev-later').status, 'canon');
    const row = db.prepare("SELECT status FROM canon_events WHERE event_id = 'ev-later'").get();
    assert.equal(row.status, 'canon');
  } finally {
    db.close();
  }
});

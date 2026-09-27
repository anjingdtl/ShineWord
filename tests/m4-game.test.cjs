const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');
const { SqliteGameStore } = require('../dist/infra/sqlite/sqliteGameStore');
const { SqliteNarrativeStore } = require('../dist/infra/sqlite/sqliteNarrativeStore');
const { forkBranch } = require('../dist/application/branch/fork');
const { retrieveContext, shouldSummarize, buildSummaryRequest, SUMMARY_INTERVAL_TURNS } = require('../dist/application/memory/retrieval');
const { exportSave, validateSaveJson, SAVE_SCHEMA_VERSION } = require('../dist/application/export/saveFile');
const { runLlmTurn } = require('../dist/application/game/llmTurn');
const { commitResolvedTurn } = require('../dist/application/turns/commitTurn');

class NodeSqliteAdapter {
  constructor(db) {
    this.db = db;
    this.chain = Promise.resolve();
  }
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

const sha = {
  async sha256BytesHex(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); },
  async sha256Hex(input) { return crypto.createHash('sha256').update(input, 'utf8').digest('hex'); },
};

function setupDb() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  return db;
}

function seedBranch(db, branchId, stateVersion = 0) {
  db.prepare('INSERT INTO branches (branch_id, campaign_id, state_version, created_at) VALUES (?, ?, ?, ?)')
    .run(branchId, 'camp-1', stateVersion, '2026-09-27T00:00:00.000Z');
  db.prepare(`INSERT INTO actor_states (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(branchId, 'actor-player', stateVersion, 'start', JSON.stringify({ hp: 10, stamina: 10 }), '[]');
  db.prepare(`INSERT INTO snapshots (branch_id, state_version, snapshot_json, state_hash, created_at)
    VALUES (?, ?, ?, NULL, ?)`)
    .run(branchId, stateVersion, JSON.stringify({
      branchId, stateVersion, clockMinutes: 0,
      actors: { 'actor-player': { actorId: 'actor-player', locationId: 'start', resources: { hp: 10, stamina: 10 }, conditions: [] } },
      itemOwners: {},
    }), '2026-09-27T00:00:00.000Z');
}

test('game store persists skill practice with turn-id dedup and advancement', async () => {
  const db = setupDb();
  try {
    seedBranch(db, 'b-skills');
    const store = new SqliteGameStore(new NodeSqliteAdapter(db));
    let progress = { skillId: 'sword', rank: 'untrained', practicePoints: 0, awardedTurns: [] };
    progress = { ...progress, practicePoints: 1, awardedTurns: ['turn-1'] };
    await store.upsertSkillProgress('b-skills', 'actor-player', progress, 1);

    const loaded = await store.getSkillProgress('b-skills', 'actor-player', 'sword');
    assert.deepEqual(loaded, progress);

    // Re-awarding the same turn changes nothing after reload.
    const { awardPractice } = require('../dist/domain/progression/growth');
    const deduped = awardPractice(loaded, 'turn-1');
    assert.equal(deduped, loaded);
  } finally {
    db.close();
  }
});

test('fork copies state, skills and relationships; branches never leak into each other', async () => {
  const db = setupDb();
  try {
    seedBranch(db, 'main-b');
    const adapter = new NodeSqliteAdapter(db);
    const turnStore = new SqliteTurnStore(adapter);
    const gameStore = new SqliteGameStore(adapter);

    await gameStore.upsertSkillProgress('main-b', 'actor-player', { skillId: 'sword', rank: 'trained', practicePoints: 3, awardedTurns: ['t1', 't2', 't3'] }, 0);
    await gameStore.upsertRelationship({ branchId: 'main-b', relId: 'r1', fromActorId: 'actor-player', toActorId: 'npc-guard', stance: 'wary', closeness: -2, updatedTurnId: null }, 0);

    const forked = await forkBranch({
      db: adapter,
      turnStore,
      gameStore,
      sourceBranchId: 'main-b',
      targetBranchId: 'fork-b',
      campaignId: 'camp-1',
      forkTurnId: 'turn-0004',
      createdAt: '2026-09-27T00:00:00.000Z',
    });
    assert.equal(forked.snapshot.branchId, 'fork-b');
    assert.equal(forked.copiedSkills, 1);
    assert.equal(forked.copiedRelationships, 1);

    // Mutations on the fork never touch the source.
    await gameStore.upsertSkillProgress('fork-b', 'actor-player', { skillId: 'sword', rank: 'expert', practicePoints: 0, awardedTurns: [] }, 1);
    await gameStore.upsertRelationship({ branchId: 'fork-b', relId: 'r1', fromActorId: 'actor-player', toActorId: 'npc-guard', stance: 'friendly', closeness: 3, updatedTurnId: 't9' }, 1);

    const mainSkills = await gameStore.listSkillProgress('main-b', 'actor-player');
    assert.equal(mainSkills[0].rank, 'trained');
    const mainRels = await gameStore.listRelationships('main-b');
    assert.equal(mainRels[0].stance, 'wary');

    const forkSkills = await gameStore.listSkillProgress('fork-b', 'actor-player');
    assert.equal(forkSkills[0].rank, 'expert');
  } finally {
    db.close();
  }
});

test('fork at an earlier snapshot restores the historical state (rewind)', async () => {
  const db = setupDb();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const turnStore = new SqliteTurnStore(adapter);
    const gameStore = new SqliteGameStore(adapter);
    seedBranch(db, 'main-b', 0);

    // Commit a turn to reach stateVersion 1 with a different location.
    const contract = {
      protocolVersion: '1.0', turnId: 'turn-0001', expectedStateVersion: 0,
      actorId: 'actor-player', actionType: 'move', evidenceIds: ['e'],
      requiresRoll: false, intent: 'move on', timeCostMinutes: 5, resourcePreconditions: [],
      outcomes: {
        full_success: { achieved: true, publicSummary: 'ok', effects: [{ op: 'changeLocation', actorId: 'actor-player', locationId: 'archive' }] },
        success: { achieved: true, publicSummary: 'ok', effects: [{ op: 'changeLocation', actorId: 'actor-player', locationId: 'archive' }] },
        failure: { achieved: false, publicSummary: 'no', effects: [] },
        severe_failure: { achieved: false, publicSummary: 'bad', effects: [] },
      },
    };
    await commitResolvedTurn({
      store: turnStore, branchId: 'main-b', contract,
      contractHash: await sha.sha256Hex('c'), outcomeGrade: 'success', rollRecord: undefined,
      committedAt: '2026-09-27T00:00:01.000Z',
    });

    const forked = await forkBranch({
      db: adapter, turnStore, gameStore,
      sourceBranchId: 'main-b', targetBranchId: 'rewind-b', campaignId: 'camp-1',
      forkTurnId: null, atStateVersion: 0,
      createdAt: '2026-09-27T00:00:02.000Z',
    });
    assert.equal(forked.snapshot.stateVersion, 0);
    assert.equal(forked.snapshot.actors['actor-player'].locationId, 'start');

    const state = await turnStore.getState('rewind-b');
    assert.equal(state.stateVersion, 0);
    assert.equal(state.actors['actor-player'].locationId, 'start');
  } finally {
    db.close();
  }
});

test('retrieval filters visibility, time, branch and status BEFORE ranking', () => {
  const items = [
    // Public canon fact, visible to all.
    { id: 'f1', text: '东阳侯府的布局', scope: 'world', branchId: null, validFrom: null, validTo: null, visibleToActors: null, status: 'explicit', knownToActors: null },
    // Secret: only 张中丞 knows.
    { id: 'f2', text: '妖后党与张中丞密谋', scope: 'world', branchId: null, validFrom: null, validTo: null, visibleToActors: ['npc-zhang'], status: 'explicit', knownToActors: ['npc-zhang'] },
    // Future fact: not valid yet at order 5.
    { id: 'f3', text: '论剑大会的结果', scope: 'world', branchId: null, validFrom: 10, validTo: null, visibleToActors: null, status: 'explicit', knownToActors: null },
    // Expired fact.
    { id: 'f4', text: '旧居在北方', scope: 'world', branchId: null, validFrom: null, validTo: 3, visibleToActors: null, status: 'explicit', knownToActors: null },
    // Branch event from ANOTHER branch: never crosses.
    { id: 'f5', text: '东阳侯府的冲突事件', scope: 'branch', branchId: 'other-b', validFrom: null, validTo: null, visibleToActors: null, status: 'event', knownToActors: null },
    // Conflict status: adjudication only.
    { id: 'f6', text: '东阳侯府的矛盾记载', scope: 'world', branchId: null, validFrom: null, validTo: null, visibleToActors: null, status: 'conflict', knownToActors: null },
    // Branch event on the right branch, keyword matches.
    { id: 'f7', text: '东阳侯府的夜宴', scope: 'branch', branchId: 'b1', validFrom: null, validTo: null, visibleToActors: null, status: 'event', knownToActors: null },
  ];

  const result = retrieveContext(items, {
    viewerActorId: 'actor-player',
    branchId: 'b1',
    worldTimeOrder: 5,
    queryText: '东阳侯府',
    limit: 10,
  });

  const ids = result.items.map(item => item.id);
  assert.ok(ids.includes('f1'), 'public canon must surface');
  assert.ok(ids.includes('f7'), 'own-branch event must surface');
  assert.ok(!ids.includes('f2'), 'secret must never leak to the viewer');
  assert.ok(!ids.includes('f3'), 'future fact must stay hidden');
  assert.ok(!ids.includes('f4'), 'expired fact must stay hidden');
  assert.ok(!ids.includes('f5'), 'foreign branch data must not cross');
  assert.ok(!ids.includes('f6'), 'conflicts are adjudication-only');
  assert.equal(result.stats.afterVisibility, 6);
  assert.equal(result.stats.afterTime, 4);
  assert.equal(result.stats.afterStatus, 2);

  // Empty query: nothing ranks, nothing returns (no filler context).
  const empty = retrieveContext(items, { viewerActorId: 'actor-player', branchId: 'b1', worldTimeOrder: 5, queryText: '', limit: 10 });
  assert.equal(empty.items.length, 0);
});

test('summarizer cadence and payload validation', () => {
  assert.equal(shouldSummarize(8, 0), true);
  assert.equal(shouldSummarize(7, 0), false);
  assert.equal(SUMMARY_INTERVAL_TURNS, 8);
  const payload = buildSummaryRequest(0, 8, [{ turnId: 't1', publicSummary: 's' }]);
  assert.equal(payload.role, 'Summarizer');
  assert.throws(() => buildSummaryRequest(8, 8, []), /must advance/);
});

test('save export contains no secrets and import validation rejects tampered files', async () => {
  const db = setupDb();
  try {
    seedBranch(db, 'main-b');
    db.prepare(`INSERT INTO worlds (world_id, title, source_sha256, source_bytes, normalize_version, chapter_split_version, build_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('world-1', 'w', 'a'.repeat(64), 1, 'n', 'c', 'ready', '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z');
    db.prepare(`INSERT INTO campaigns (campaign_id, world_id, title, ruleset_id, ruleset_version, world_mapping_version, opening_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('camp-1', 'world-1', '测试战役', 'shineword-core', '0.1.0', '1', '{}', '2026-09-27T00:00:00.000Z');

    const adapter = new NodeSqliteAdapter(db);
    const { json } = await exportSave({
      db: adapter, sha256Hex: sha.sha256Hex, campaignId: 'camp-1', branchId: 'main-b',
      createdAt: '2026-09-27T00:00:00.000Z',
    });
    const parsed = JSON.parse(json);
    assert.equal(parsed.manifest.schemaVersion, SAVE_SCHEMA_VERSION);
    assert.equal(parsed.manifest.worldRef.sourceSha256, 'a'.repeat(64));
    assert.ok(!json.toLowerCase().includes('apikey'), 'no api key material in export');

    const valid = validateSaveJson(json);
    assert.equal(valid.ok, true);

    const badSchema = validateSaveJson(JSON.stringify({ ...parsed, manifest: { ...parsed.manifest, schemaVersion: 'x' } }));
    assert.equal(badSchema.ok, false);

    const secret = validateSaveJson(JSON.stringify({ ...parsed, apiKey: 'sk-leak' }));
    assert.equal(secret.ok, false);
    assert.ok(secret.errors.some(error => /forbidden key/i.test(error)));

    assert.equal(validateSaveJson('not json').ok, false);
  } finally {
    db.close();
  }
});

class ScriptedProvider {
  async complete(request) {
    const payload = JSON.parse(request.user);
    if (request.role === 'Planner') {
      const risky = Number(payload.turnId.split('-').pop()) % 3 !== 0;
      const clause = summary => ({ achieved: true, publicSummary: summary, effects: [{ op: 'advanceClock', minutes: 1 }] });
      const contract = {
        protocolVersion: '1.0',
        turnId: payload.turnId,
        expectedStateVersion: payload.expectedStateVersion,
        actorId: 'actor-player',
        actionType: risky ? 'investigate' : 'observe',
        targetId: 'scene',
        evidenceIds: ['demo'],
        requiresRoll: risky,
        intent: payload.playerIntent,
        timeCostMinutes: 1,
        resourcePreconditions: [],
        outcomes: {
          full_success: clause('full'),
          success: clause('ok'),
          failure: { achieved: false, publicSummary: 'fail', effects: [] },
          severe_failure: { achieved: false, publicSummary: 'bad', effects: [] },
        },
      };
      if (risky) { contract.skillId = 'sword'; contract.difficultyBand = 'normal'; }
      return { text: JSON.stringify(contract) };
    }
    return {
      text: JSON.stringify({ turnId: payload.turnId, outcomeGrade: payload.outcomeGrade, text: `叙事 ${payload.turnId}` }),
    };
  }
}

const RNG = { nextIntInclusive: (min, max) => max };

async function runTurn(adapter, branchId, index, turnIdOverride) {
  const turnStore = new SqliteTurnStore(adapter);
  const narratives = new SqliteNarrativeStore(adapter);
  const turnId = turnIdOverride ?? `turn-${String(index).padStart(4, '0')}`;
  return runLlmTurn({
    provider: new ScriptedProvider(),
    store: turnStore,
    journal: turnStore,
    narratives,
    branchId,
    turnId,
    playerIntent: `行动 ${index}`,
    hashProvider: sha,
    random: RNG,
    resolveRollSpec() { return { attribute: 2, skillRank: 'trained', difficulty: 4 }; },
    now: (() => {
      let n = 0;
      return () => new Date(Date.UTC(2026, 8, 27, 0, 0, n++)).toISOString();
    })(),
  });
}

test('100-turn long-range campaign stays consistent; rewind keeps original branch intact', async () => {
  const db = setupDb();
  try {
    seedBranch(db, 'main-100');
    const adapter = new NodeSqliteAdapter(db);
    const gameStore = new SqliteGameStore(adapter);
    await gameStore.upsertSkillProgress('main-100', 'actor-player', { skillId: 'sword', rank: 'trained', practicePoints: 0, awardedTurns: [] }, 0);

    for (let i = 1; i <= 100; i += 1) {
      const result = await runTurn(adapter, 'main-100', i);
      assert.equal(result.stateVersion, i);
    }

    const turnStore = new SqliteTurnStore(adapter);
    const state = await turnStore.getState('main-100');
    assert.equal(state.stateVersion, 100);
    assert.equal(state.clockMinutes, 200); // 1 contract timeCost + 1 advanceClock per turn
    const committed = db.prepare("SELECT COUNT(*) AS n FROM turns WHERE branch_id = 'main-100' AND status = 'Committed'").get();
    assert.equal(committed.n, 100);
    const narratives = db.prepare("SELECT COUNT(*) AS n FROM turn_narratives WHERE branch_id = 'main-100' AND status = 'Committed'").get();
    assert.equal(narratives.n, 100);

    // Fork at turn 50 snapshot: fork head must be exactly version 50.
    const forked = await forkBranch({
      db: adapter, turnStore, gameStore,
      sourceBranchId: 'main-100', targetBranchId: 'fork-50', campaignId: 'camp-1',
      forkTurnId: 'turn-0050', atStateVersion: 50,
      createdAt: '2026-09-27T01:00:00.000Z',
    });
    assert.equal(forked.snapshot.stateVersion, 50);

    // Continue both branches; each advances independently.
    await runTurn(adapter, 'fork-50', 51);
    const forkState = await turnStore.getState('fork-50');
    assert.equal(forkState.stateVersion, 51);
    const mainState = await turnStore.getState('main-100');
    assert.equal(mainState.stateVersion, 100, 'source branch head must not move');

    // Dice of a committed turn on main are immutable after the fork.
    const mainRoll = db.prepare("SELECT rolls_json FROM roll_records WHERE branch_id = 'main-100' AND turn_id = 'turn-0001'").get();
    assert.ok(mainRoll, 'turn-0001 is risky and must have a persisted roll');
    // A resumed committed turn replays instead of re-rolling.
    const replayed = await runTurn(adapter, 'main-100', 1, 'turn-0001');
    assert.equal(replayed.resumed, true);
    assert.equal(replayed.stateVersion, 1, 'replay returns the committed turn own version');
  } finally {
    db.close();
  }
});

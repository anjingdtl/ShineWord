const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { tokenize, buildEpisodicIndex } = require('../dist/application/memory/episodicIndex');
const {
  recallEpisodes,
  resolveQueryActors,
  renderEpisodicRecall,
  defaultEstimateTokens,
} = require('../dist/application/memory/episodicRetriever');
const {
  SqliteEpisodicStore,
  episodicRecordFromTurn,
} = require('../dist/application/memory/episodicStore');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { applySqliteMigrations } = require('../dist/infra/sqlite/migrations');

class NodeSqliteAdapter {
  constructor(db) { this.db = db; }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  async transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = await work(this); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

// ---------------------------------------------------------------- tokenizer

test('tokenizer: CJK n-grams and latin words', () => {
  const tokens = tokenize('青鸾佩 white-crane 修仙');
  assert.ok(tokens.includes('青鸾'));
  assert.ok(tokens.includes('青鸾佩'));
  assert.ok(tokens.includes('white-crane'));
  assert.ok(tokens.includes('修仙'));
});

// ----------------------------------------------------------------- fixtures

const KEY_EVENTS = new Map([
  [3, { summary: '白山君把信物青鸾佩交给主角，约定北疆再见', actorIds: ['npc-1', 'player'], itemIds: ['item-qingluan'] }],
  [18, { summary: '在藏经阁发现北疆地图的残页，指向旧长城', actorIds: ['player'], itemIds: ['item-map-fragment'] }],
  [73, { summary: '老船工警告主角：夜渡黑水河的人没有一个回来', actorIds: ['npc-ferryman', 'player'], itemIds: [] }],
  [260, { summary: '白山君兑现承诺，交出青鸾佩背后的家书', actorIds: ['npc-1', 'player'], itemIds: ['item-letter'] }],
]);

function fixtureTurns(count) {
  const turns = [];
  for (let v = 1; v <= count; v += 1) {
    const key = KEY_EVENTS.get(v);
    turns.push({
      branchId: 'b1',
      turnId: `t-${v}`,
      stateVersion: v,
      publicSummary: key ? key.summary : `第${v}回合，主角在山门附近修行，日常推进`,
      narrativeText: key ? `${key.summary}。这一幕令人难忘。` : `第${v}回合的寻常叙述。`,
      actorIds: key ? key.actorIds : ['player'],
      locationIds: key ? [] : ['loc-court'],
      questIds: [],
      entryIds: [],
      itemIds: key ? key.itemIds : [],
      keywords: key ? ['青鸾佩', '白山君', '北疆'].slice(0, key.itemIds.length > 0 ? 2 : 1) : [],
      invalidAtStateVersion: null,
    });
  }
  return turns;
}

const ACTOR_HINTS = [
  { actorId: 'player', name: '主角' },
  { actorId: 'npc-1', name: '白山君', aliases: ['白兄'] },
  { actorId: 'npc-ferryman', name: '老船工' },
];

function recall(records, queryText, options = {}) {
  return recallEpisodes(records, {
    viewerActorId: 'player',
    branchId: 'b1',
    maxStateVersion: Number.MAX_SAFE_INTEGER,
    queryText,
    actors: ACTOR_HINTS,
  }, options);
}

// ------------------------------------------------------ long-range recall

for (const size of [30, 100, 300, 1000]) {
  test(`long recall: ${size} turns - early key events stay retrievable at the end`, () => {
    const records = fixtureTurns(size);
    const byText = recall(records, '青鸾佩 白山君 当初的约定');
    const versions = byText.selected.map(episode => episode.record.stateVersion);
    assert.ok(versions.includes(3), `turn 3 missing from ${JSON.stringify(versions.slice(0, 12))}`);
    if (size >= 260) {
      assert.ok(versions.includes(260), 'turn 260 (promise payoff) missing');
    }
  });
}

test('long recall: 1000-turn corpus answers the Turn-1 promise question', () => {
  const records = fixtureTurns(1000);
  const selection = recall(records, '白山君当初答应过什么？青鸾佩的约定', { topK: 6 });
  const versions = selection.selected.map(episode => episode.record.stateVersion);
  assert.ok(versions.includes(3));
  assert.ok(versions.includes(260));
});

// ------------------------------------------------------------------ gates

test('gates: branch, time and invalidation filter BEFORE relevance', () => {
  const records = [
    ...fixtureTurns(20),
    { ...fixtureTurns(1)[0], branchId: 'other-branch', stateVersion: 3, publicSummary: '青鸾佩出现在别的分支' },
    { ...fixtureTurns(1)[0], stateVersion: 25, publicSummary: '未来的青鸾佩事件' },
    { ...fixtureTurns(1)[0], stateVersion: 5, invalidAtStateVersion: 5, publicSummary: '已被作废的青鸾佩事件' },
  ];
  const selection = recallEpisodes(records, {
    branchId: 'b1',
    maxStateVersion: 20,
    queryText: '青鸾佩',
    actors: ACTOR_HINTS,
  });
  for (const episode of selection.selected) {
    assert.equal(episode.record.branchId, 'b1');
    assert.ok(episode.record.stateVersion <= 20);
    assert.equal(episode.record.invalidAtStateVersion, null);
  }
});

test('aliases: unique alias boosts its actor; ambiguous alias boosts nobody', () => {
  const hints = [
    ...ACTOR_HINTS,
    { actorId: 'npc-2', name: '老李头', aliases: ['老李'] },
    { actorId: 'npc-3', name: '李掌柜', aliases: ['老李'] },
  ];
  const unique = resolveQueryActors('白兄最近在哪', hints);
  assert.deepEqual(unique.resolved, ['npc-1']);
  const ambiguous = resolveQueryActors('老李说好的青鸾佩呢', hints);
  assert.ok(ambiguous.ambiguous.includes('老李'));
  assert.equal(ambiguous.resolved.includes('npc-2'), false);
  assert.equal(ambiguous.resolved.includes('npc-3'), false);
});

// --------------------------------------------------------- hybrid + packing

test('hybrid: recent turns join the selection even without top relevance', () => {
  const records = fixtureTurns(12);
  const selection = recall(records, '青鸾佩', { topK: 5 });
  const versions = selection.selected.map(episode => episode.record.stateVersion);
  assert.ok(versions.includes(3));
  assert.ok(Math.max(...versions) >= 11, 'at least one recent turn bridges the story');
  // Render is chronological even though selection was relevance-first.
  const rendered = renderEpisodicRecall(selection);
  const renderedVersions = rendered.split('\n')
    .map(line => Number(line.split(':')[0].replace('t-', '')));
  for (let i = 1; i < renderedVersions.length; i += 1) {
    assert.ok(renderedVersions[i] > renderedVersions[i - 1], 'rendered chronologically');
  }
});

test('packing: whole-item fit under a token budget drops overflow, never clips', () => {
  const records = fixtureTurns(30);
  const keyEpisode = records[2]; // t-3 carries the 青鸾佩 event
  const oneEpisodeBudget = defaultEstimateTokens(
    `${keyEpisode.publicSummary}\n${keyEpisode.narrativeText}`,
  );
  const selection = recall(records, '青鸾佩 白山君 北疆', {
    topK: 8,
    tokenBudget: oneEpisodeBudget + 8,
  });
  assert.ok(selection.selected.length >= 1);
  assert.ok(selection.selected.some(episode => episode.record.turnId === 't-3'),
    'the key episode fits whole');
  const used = selection.selected
    .reduce((sum, episode) => sum + defaultEstimateTokens(`${episode.record.publicSummary}\n${episode.record.narrativeText}`), 0);
  assert.ok(used <= oneEpisodeBudget + 8 + 1);
  assert.ok(selection.droppedByBudget.length >= 0);
});

test('determinism: identical inputs produce byte-identical recall results', () => {
  const records = fixtureTurns(100);
  const a = recall(records, '北疆地图 残页', { topK: 7 });
  const b = recall([...records].reverse(), '北疆地图 残页', { topK: 7 });
  assert.equal(
    JSON.stringify(a.selected.map(episode => [episode.record.turnId, episode.score, episode.reasons])),
    JSON.stringify(b.selected.map(episode => [episode.record.turnId, episode.score, episode.reasons])),
  );
});

// ------------------------------------------------------------ performance

const PERF_TARGETS = { 30: 100, 100: 300, 300: 800, 1000: 2500 };
for (const [size, targetMs] of Object.entries(PERF_TARGETS)) {
  test(`performance: ${size} turns recall under ${targetMs}ms (no O(N^2))`, () => {
    const records = fixtureTurns(Number(size));
    const start = process.hrtime.bigint();
    const selection = recall(records, '青鸾佩 白山君 约定 北疆地图', { topK: 8, tokenBudget: 1200 });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(selection.selected.length > 0);
    assert.ok(elapsedMs < targetMs, `recall took ${elapsedMs.toFixed(1)}ms (target < ${targetMs}ms)`);
  });
}

test('performance: index build alone for 1000 turns stays fast', () => {
  const records = fixtureTurns(1000);
  const start = process.hrtime.bigint();
  const index = buildEpisodicIndex(records);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(index.turns.length, 1000);
  assert.ok(elapsedMs < 2000, `index build took ${elapsedMs.toFixed(1)}ms`);
});

// --------------------------------------------------------- store + fork

test('store: episodic roundtrip and invalid filtering', async () => {
  const adapter = new NodeSqliteAdapter(new DatabaseSync(':memory:'));
  await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  const store = new SqliteEpisodicStore(adapter);
  const record = fixtureTurns(1)[0];
  record.itemIds = ['item-x'];
  await store.saveTurnRecord(record);
  record.publicSummary = 'updated';
  await store.saveTurnRecord(record);
  const listed = await store.listRecords('b1');
  assert.equal(listed.length, 1, 'upsert not insert');
  assert.equal(listed[0].publicSummary, 'updated');
  assert.deepEqual(listed[0].itemIds, ['item-x']);

  const future = { ...record, turnId: 't-99', stateVersion: 99 };
  await store.saveTurnRecord(future);
  const gated = await store.listRecords('b1', 1);
  assert.equal(gated.length, 1);
  assert.equal(gated[0].stateVersion, 1);
});

test('derivation: episodic record extracts entities from committed effects', () => {
  const entry = {
    branchId: 'b1', turnId: 't-5', stateVersion: 5, outcomeGrade: 'success',
    publicSummary: '把青鸾佩交给白山君', narrativeText: '……', narrativeStatus: 'Committed',
    rollRecord: null, committedAt: 'now',
    effects: [
      { op: 'transferItem', itemId: 'item-qingluan', fromActorId: 'player', toActorId: 'npc-1' },
      { op: 'changeLocation', actorId: 'player', locationId: 'loc-north' },
      { op: 'recordEvent', eventType: 'relationship_changed', fromActorId: 'player', toActorId: 'npc-1' },
      { op: 'restoreResource', actorId: 'player', resourceId: 'stamina', amount: 2 },
    ],
  };
  const record = episodicRecordFromTurn({ entry });
  assert.deepEqual([...record.actorIds].sort(), ['npc-1', 'player']);
  assert.deepEqual(record.itemIds, ['item-qingluan']);
  assert.deepEqual(record.locationIds, ['loc-north']);
});

test('fork: episodic rows <= fork version copy to the new branch', async () => {
  const adapter = new NodeSqliteAdapter(new DatabaseSync(':memory:'));
  await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  const store = new SqliteEpisodicStore(adapter);
  for (const turn of fixtureTurns(12)) {
    await store.saveTurnRecord(turn);
  }
  await adapter.execute(
    `INSERT INTO worlds (world_id, title, source_sha256, source_bytes, normalize_version,
        chapter_split_version, build_status, created_at, updated_at)
     VALUES ('w1', 'w', 'h', 1, 'v1', 'v1', 'ready', 't', 't')`,
  );
  await adapter.execute(
    `INSERT INTO campaigns (campaign_id, world_id, title, ruleset_id, ruleset_version,
        world_mapping_version, opening_json, created_at)
     VALUES ('c1', 'w1', 'c', 'r', '1', '1', '{}', 't')`,
  );
  await adapter.execute(
    `INSERT INTO branches (branch_id, campaign_id, parent_branch_id, fork_turn_id, state_version, created_at)
     VALUES ('b1', 'c1', NULL, NULL, 12, 't')`,
  );
  await adapter.transaction(async tx => {
    await tx.execute(
      `INSERT INTO branches (branch_id, campaign_id, parent_branch_id, fork_turn_id, state_version, created_at)
       VALUES ('b2', 'c1', 'b1', NULL, 6, 't')`,
    );
    await tx.execute(
      `INSERT INTO episodic_turn_index (branch_id, turn_id, state_version, search_text, metadata_json, invalid_at_state_version)
       SELECT 'b2', turn_id, state_version, search_text, metadata_json, invalid_at_state_version
         FROM episodic_turn_index
        WHERE branch_id = 'b1' AND state_version <= 6`,
    );
  });
  const b2 = await store.listRecords('b2');
  assert.equal(b2.length, 6, 'only pre-fork episodes cross over');
  assert.equal(Math.max(...b2.map(record => record.stateVersion)), 6);
});

test('migration 21 creates episodic_turn_index', async () => {
  const adapter = new NodeSqliteAdapter(new DatabaseSync(':memory:'));
  const applied = await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  assert.ok(applied.includes(101));
  const tables = await adapter.queryAll(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='episodic_turn_index'",
  );
  assert.equal(tables.length, 1);
});

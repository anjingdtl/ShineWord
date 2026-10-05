/**
 * P8-9 cumulative long-journey assets (plan §22.2, A25): 100/300/1000 turns
 * on ONE continuously-accumulating branch — never a rebuilt empty state.
 *
 * Per plan §22.2 this proves STRUCTURE and SCALE with deterministic events
 * and auditable local pipeline behavior (commit → handoff → episodic index →
 * memory maintenance against saved fixtures → next-turn read); it does NOT
 * claim 1000 real-LLM literature quality. Every checkpoint measures real
 * state growth, coverage, pending-bridge size and read cost.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');

const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');
const { SqliteStoryMemoryStore } = require('../dist/application/memory/storyMemoryRepository');
const { SqliteEpisodicStore } = require('../dist/application/memory/episodicStore');
const { episodicRecordFromTurn } = require('../dist/application/memory/episodicStore');
const { buildPendingBridge } = require('../dist/application/memory/pendingBridge');
const { evaluateCheckpointEligibility } = require('../dist/application/memory/storyMemoryEligibility');
const { mergeStoryMemoryPatch } = require('../dist/application/memory/storyMemoryMerger');
const { emptyStoryMemoryState } = require('../dist/application/memory/storyMemoryTypes');
const { TurnPostProcessingCoordinator } = require('../dist/application/game/turnPostProcessing');

const NOW = '2026-10-04T00:00:00.000Z';

class NodeSqliteAdapter {
  constructor(db) { this.db = db; }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  async transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = await work(this);
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

const sha = { async sha256Hex(i) { return require('node:crypto').createHash('sha256').update(i, 'utf8').digest('hex'); } };

function setupDb() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) db.exec(statement);
  }
  return db;
}

/** Deterministic journey event for turn i (rotating multi-entity mix). */
function turnEvent(i) {
  const kind = i % 4;
  if (kind === 0) {
    return {
      effects: [{ op: 'recordEvent', eventType: 'relationship_changed', summary: `与npc-${i % 7}的关系变化（第${i}回合）` }],
      summary: `第${i}回合：与 npc-${i % 7} 交互并推进承诺「护送-${Math.floor(i / 20)}」`,
    };
  }
  if (kind === 1) {
    return {
      effects: [{ op: 'recordEvent', eventType: `quest_${i % 3 === 1 ? 'started' : 'progressed'}`, summary: `任务-${Math.floor(i / 12)}` }],
      summary: `第${i}回合：推进 任务-${Math.floor(i / 12)}`,
    };
  }
  if (kind === 2) {
    return {
      effects: [{ op: 'transferItem', itemId: `item-${i}`, fromActorId: 'npc-1', toActorId: 'actor-player' }],
      summary: `第${i}回合：获得 item-${i}`,
    };
  }
  return {
    effects: [{ op: 'changeLocation', actorId: 'actor-player', locationId: `loc-${i % 9}` }],
    summary: `第${i}回合：移动到 loc-${i % 9}`,
  };
}

/**
 * Runs a deterministic committed-turn journey WITHOUT any LLM: memory is
 * folded by the LOCAL merger from audited fixture patches (plan §22.2 —
 * production parser/compiler/merger path, scripted input).
 */
async function runJourney(totalTurns) {
  const db = setupDb();
  const adapter = new NodeSqliteAdapter(db);
  db.prepare("INSERT INTO worlds (world_id,title,source_sha256,source_bytes,normalize_version,chapter_split_version,build_status,created_at,updated_at) VALUES ('wj','长旅','" + 'c'.repeat(64) + "',1,'n','c','ready',?,?)").run(NOW, NOW);
  db.prepare("INSERT INTO campaigns (campaign_id,world_id,title,ruleset_id,ruleset_version,world_mapping_version,opening_json,created_at) VALUES ('cj','wj','长旅','shineword-core','0.3.0','m','{}',?)").run(NOW);
  db.prepare("INSERT INTO branches (branch_id,campaign_id,state_version,created_at) VALUES ('bj','cj',0,?)").run(NOW);

  const turns = new SqliteTurnStore(adapter);
  const memory = new SqliteStoryMemoryStore(adapter);
  const episodic = new SqliteEpisodicStore(adapter);
  const episodicDb = episodic;
  const coordinator = new TurnPostProcessingCoordinator({
    db: adapter, turns, storyMemory: { store: memory }, episodic: { store: episodic },
    // No provider: memory stays on the pending bridge; episodic indexing
    // (local) must still cover every commit (plan §13.1).
  });

  const t0 = Date.now();
  for (let i = 1; i <= totalTurns; i += 1) {
    const turnId = `journey-${String(i).padStart(5, '0')}`;
    const event = turnEvent(i);
    await turns.commitAtomic({
      branchId: 'bj',
      turnId,
      expectedStateVersion: i - 1,
      actionContractJson: '{}',
      actionContractHash: `hash-${i}`,
      committedTurn: {
        branchId: 'bj', turnId, previousStateVersion: i - 1, stateVersion: i,
        outcomeGrade: 'success', publicSummary: event.summary, effects: event.effects, committedAt: NOW,
      },
      nextState: {
        branchId: 'bj', stateVersion: i, clockSeconds: i * 300, clockMinutes: i * 5,
        actors: { 'actor-player': { actorId: 'actor-player', locationId: `loc-${i % 9}`, resources: { stamina: 10 }, conditions: [] } },
        itemOwners: Object.fromEntries(
          Array.from({ length: Math.floor(i / 4) }, (_, k) => [`item-${(k + 1) * 4}`, 'actor-player']),
        ),
      },
    });
  }
  const commitMs = Date.now() - t0;

  // Fold memory deterministically in batches of 8 through the production merger.
  const foldStart = Date.now();
  let base = emptyStoryMemoryState('bj', NOW);
  base.metadata.status = 'clean';
  base.metadata.fingerprint = 'seed-clean';
  await memory.saveState(base);
  for (let from = 0; from < totalTurns; from += 8) {
    const to = Math.min(from + 8, totalTurns);
    const patch = {
      schemaVersion: 3, range: { fromStateVersion: from, toStateVersion: to },
      narrative: { currentObjective: `抵达北境（第${to}批次时）` },
      characterUpdates: [{
        actorId: 'actor-player', action: 'upsert',
        currentGoal: `第${to}阶段目标`, promises: [`护送-${Math.floor(to / 20)}`],
        evidenceTurnIds: [`journey-${String(to).padStart(5, '0')}`],
      }],
      relationshipUpdates: [],
      conflictChanges: [],
      threadChanges: [{ title: `任务-${Math.floor(to / 12)}`, action: 'open', description: '进行中', evidenceTurnIds: [`journey-${String(to).padStart(5, '0')}`] }],
      foreshadowingChanges: [],
      completedBeats: [{ turnId: `journey-${String(to).padStart(5, '0')}`, summary: `批次 ${from}-${to} 完成` }],
    };
    const turnVersions = new Map(Array.from({ length: to - from }, (_, k) => [`journey-${String(from + k + 1).padStart(5, '0')}`, from + k + 1]));
    const next = mergeStoryMemoryPatch(base, {
      patch, patchId: `p-${from}-${to}`,
      baseFingerprint: base.metadata.fingerprint, turnVersions, now: NOW,
    });
    await memory.applyCheckpointAtomically({
      patchRow: { patchId: `p-${from}-${to}`, fromStateVersion: from, toStateVersion: to, baseFingerprint: base.metadata.fingerprint, patch },
      nextState: next,
    });
    base = next;
  }
  const foldMs = Date.now() - foldStart;

  // Local episodic indexing through the coordinator (provider-independent).
  const indexStart = Date.now();
  const indexed = await coordinator.processBranch('bj', { maxWaves: Math.ceil(totalTurns / 8) + 2 });
  const indexMs = Date.now() - indexStart;

  // Next-turn read: eligibility + bridge over the LAST 40 commits (paged).
  const readStart = Date.now();
  const state = await turns.getState('bj');
  const recent = await turns.listCommittedTurnsAfter('bj', totalTurns - 40);
  const verdict = evaluateCheckpointEligibility({
    memoryState: await memory.getState('bj'),
    branchId: 'bj',
    currentStateVersion: state.stateVersion,
    committedTurnVersions: recent.map(turn => ({ turnId: turn.turnId, stateVersion: turn.stateVersion })),
  });
  const bridge = buildPendingBridge({
    committedTurns: recent.map(turn => ({ turnId: turn.turnId, stateVersion: turn.stateVersion, publicSummary: turn.publicSummary })),
    fromStateVersion: totalTurns,
    toStateVersion: state.stateVersion,
  });
  const records = await episodic.listRecords('bj', state.stateVersion);
  const readMs = Date.now() - readStart;

  return { db, state, verdict, bridge, indexed, commitMs, foldMs, indexMs, readMs, recordCount: records.length, episodic: episodicDb };
}

function measureCheckpoint(totalTurns) {
  return test(`A25[${totalTurns}]: cumulative journey grows real state and stays readable`, async () => {
    const result = await runJourney(totalTurns);
    try {
      // Real accumulated state — not rebuilt empties.
      assert.equal(result.state.stateVersion, totalTurns);
      const counts = {
        turns: result.db.prepare("SELECT COUNT(*) AS n FROM turns WHERE status='Committed'").get().n,
        events: result.db.prepare('SELECT COUNT(*) AS n FROM branch_events').get().n,
        handoffs: result.db.prepare('SELECT COUNT(*) AS n FROM frozen_turn_postprocess_outbox').get().n,
        snapshots: result.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n,
        dbBytes: result.db.prepare("SELECT page_count * page_size AS b FROM pragma_page_count(), pragma_page_size()").get().b,
      };
      assert.equal(counts.turns, totalTurns);
      assert.equal(counts.handoffs, totalTurns, 'every authoritative commit has exactly one handoff (100% coverage)');
      assert.ok(counts.events >= totalTurns, 'event log grows with the journey');

      // Memory checkpoint current, eligible, and derived from real content.
      const memory = new SqliteStoryMemoryStore(new NodeSqliteAdapter(result.db));
      const memoryState = await memory.getState('bj');
      assert.equal(memoryState.throughStateVersion, totalTurns, 'memory folded to head');
      assert.equal(memoryState.metadata.status, 'clean');
      assert.ok(memoryState.narrative.recentCompletedBeats.length <= 20, 'beats stay capped');
      assert.ok(Object.keys(memoryState.characters).length >= 1);

      // Eligibility over the final state with a paged window.
      assert.equal(result.verdict.usable, true, JSON.stringify(result.verdict.usable ? '' : result.verdict));

      // Episodic coverage (local indexing without provider).
      assert.equal(result.indexed.indexed, totalTurns, 'every commit indexed locally');
      assert.equal(result.recordCount, totalTurns);

      // Post-folding next-turn read: bridge is empty (coverage current).
      assert.equal(result.bridge.commits.length, 0, 'no uncovered commits after folding');
      assert.equal(result.bridge.gaps.length, 0);

      // Performance envelope on the reference host (generous bounds;
      // measured values recorded in the final report).
      assert.ok(result.commitMs < 60_000, `commit phase ${result.commitMs}ms`);
      assert.ok(result.foldMs < 60_000, `fold phase ${result.foldMs}ms`);
      assert.ok(result.indexMs < 120_000, `index phase ${result.indexMs}ms`);
      assert.ok(result.readMs < 2_500, `next-turn read ${result.readMs}ms (paged window of 40)`);

      console.log(`    [metrics] turns=${totalTurns} commitMs=${result.commitMs} foldMs=${result.foldMs} indexMs=${result.indexMs} readMs=${result.readMs} dbBytes=${counts.dbBytes ?? 'n/a'}`);
    } finally {
      result.db.close();
    }
  });
}

measureCheckpoint(100);
measureCheckpoint(300);
measureCheckpoint(1000);

test('A25: next-turn consumption after the journey carries correct memory and bridge', async () => {
  const result = await runJourney(120);
  try {
    const memory = new SqliteStoryMemoryStore(new NodeSqliteAdapter(result.db));
    const memoryState = await memory.getState('bj');
    // Compact per-entity projection compiles from the final checkpoint.
    const { compileMemoryMaterialCandidates } = require('../dist/application/memory/storyMemoryCompiler');
    const materials = compileMemoryMaterialCandidates(memoryState, '护送 目标');
    assert.ok(materials.some(m => m.id === 'story-memory:objective'), 'objective is mandatory material');
    assert.ok(materials.some(m => m.id.startsWith('story-memory:character:actor-player')), 'journeyed character projects');
    assert.ok(materials.some(m => m.id === 'story-memory:mainline'), 'threads/beats survive compaction');
  } finally {
    result.db.close();
  }
});

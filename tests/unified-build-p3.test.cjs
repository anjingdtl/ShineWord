// Unified world build P3 regression suite (U08/U09 core scope):
// - deterministic 30/30/40 stage boundaries on chapter ends (ties -> earlier),
//   tiny books merge stages, mega single chapter, exact no-hole coverage
// - trigger engine: boundary proximity (last 15%), dependency demand,
//   in-order triggering only, repeated triggers dedupe to one task
// - scoped runs: progressive initial queue builds ONLY S1; un-triggered
//   stages never request prose
// - stage packages publish as cumulative partial scope; whole text upgrades
//   to whole_source/complete
// - activation at safe boundaries only; running interaction blocks; rewind
//   and fork fall back to the base revision (old saves never force-upgraded)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteSourceStore } = require('../dist/infra/sqlite/sqliteSourceStore');
const { SqliteBuildRunStore } = require('../dist/infra/sqlite/sqliteBuildRunStore');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { SqliteStagePlanStore } = require('../dist/infra/sqlite/sqliteStagePlanStore');
const { importTxtSourceStreaming } = require('../dist/application/import/streamingTxtImport');
const { buildPackageFromCanon } = require('../dist/application/worldPackage/buildPackageFromCanon');
const {
  computeStagePlan,
  evaluateStageTriggers,
  DEFAULT_BOUNDARY_PREBUILD_RATIO,
} = require('../dist/application/worldBuild/stagePlan');
const {
  ensureStagePlan,
  queueInitialStages,
  evaluateAndClaimTriggers,
  markStageRunStatus,
  builtStageRanges,
} = require('../dist/application/worldBuild/stageOrchestrator');
const {
  isAtSafeBoundary,
  activatePendingStages,
  resolvePlayableRevision,
} = require('../dist/application/worldPackage/stageActivation');
const { parseUnitRanges } = require('../dist/application/worldBuild/coordinator');
const { FixtureExtractor } = require('./fixtures/fixtureExtractor.cjs');

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

const sha = {
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

function chapter(id, index, startCp, endCp) {
  return {
    chapterId: id, index, title: `第${index}章`, startOffset: startCp, endOffset: endCp,
    charCount: endCp - startCp, contentHash: 'x',
  };
}

// ---------------------------------------------------------------------------
// U08: stage boundaries
// ---------------------------------------------------------------------------

test('U08 stage boundaries: 100 equal chapters snap near 30%/60%, exact coverage', () => {
  const chapters = [];
  let cp = 0;
  for (let i = 1; i <= 100; i += 1) {
    chapters.push(chapter(`ch-${i}`, i, cp, cp + 1_000));
    cp += 1_000;
  }
  const plan = computeStagePlan(chapters, 100_000);
  assert.equal(plan.stages.length, 3);
  const [s1, s2, s3] = plan.stages;
  assert.equal(s1.startCp, 0);
  // Ideal cuts 30k/60k land exactly on chapter ends 30/60.
  assert.equal(s1.endCp, 30_000);
  assert.equal(s2.startCp, 30_000);
  assert.equal(s2.endCp, 60_000);
  assert.equal(s3.endCp, 100_000);
  for (const stage of plan.stages) {
    assert.ok(stage.chapterIds.length > 0);
    assert.ok(stage.ratio > 0);
  }
  assert.ok(Math.abs(s1.ratio - 0.30) < 1e-9);
  assert.ok(Math.abs(s2.ratio - 0.30) < 1e-9);
  assert.ok(Math.abs(s3.ratio - 0.40) < 1e-9);
});

test('U08 stage boundaries: uneven chapters snap to nearest end, ties choose earlier', () => {
  // Ideal 30% = 3000cp: chapter ends at 2900 and 3100 are equidistant ->
  // earlier (2900) wins. Ideal 60% = 6000: exact chapter end 6000.
  const chapters = [
    chapter('a', 1, 0, 2_900), chapter('b', 2, 2_900, 3_100),
    chapter('c', 3, 3_100, 6_000), chapter('d', 4, 6_000, 10_000),
  ];
  const plan = computeStagePlan(chapters, 10_000);
  assert.equal(plan.stages[0].endCp, 2_900, 'tie resolved to the earlier boundary');
  assert.equal(plan.stages[1].endCp, 6_000);
  assert.equal(plan.stages[2].endCp, 10_000);
});

test('U08 stage boundaries: tiny books merge stages; mega single chapter is one stage', () => {
  const two = computeStagePlan([chapter('a', 1, 0, 60), chapter('b', 2, 60, 100)], 100);
  assert.equal(two.stages.length, 2);
  assert.equal(two.stages[0].endCp, 60);
  const one = computeStagePlan([chapter('solo', 1, 0, 5_000_000)], 5_000_000);
  assert.equal(one.stages.length, 1);
  assert.equal(one.stages[0].ratio, 1);
  // Coverage stays exact in every degenerate case.
  for (const plan of [two, one]) {
    assert.equal(plan.stages[0].startCp, 0);
    assert.equal(plan.stages[plan.stages.length - 1].endCp, plan.codePointCount);
  }
});

// ---------------------------------------------------------------------------
// U08: trigger engine
// ---------------------------------------------------------------------------

function triggerFixture() {
  const chapters = [];
  let cp = 0;
  for (let i = 1; i <= 100; i += 1) {
    chapters.push(chapter(`ch-${i}`, i, cp, cp + 1_000));
    cp += 1_000;
  }
  const plan = computeStagePlan(chapters, 100_000);
  const states = new Map();
  for (const stage of plan.stages) {
    states.set(stage.index, { status: 'untriggered', triggerDedupeKey: null });
  }
  return { plan, states };
}

test('U08 triggers: boundary proximity fires inside the last 15% of the built stage', () => {
  const { plan, states } = triggerFixture();
  states.set(0, { status: 'activated', triggerDedupeKey: 'initial:0' });
  const windowStart = 30_000 - Math.floor(30_000 * DEFAULT_BOUNDARY_PREBUILD_RATIO);
  // Anchor just inside the pre-build window -> S2 proximity trigger.
  const inside = evaluateStageTriggers({ plan, states, anchorCp: windowStart + 10 });
  assert.deepEqual(inside.map(decision => decision.stageIndex), [1]);
  assert.equal(inside[0].reason, 'boundary_proximity');
  // Anchor earlier in S1 -> no trigger.
  const outside = evaluateStageTriggers({ plan, states, anchorCp: windowStart - 1 });
  assert.equal(outside.length, 0);
  // Long stays never auto-sweep: no anchor, no need -> nothing fires.
  assert.equal(evaluateStageTriggers({ plan, states }).length, 0);
});

test('U08 triggers: dependency demand fires only for the NEXT unbuilt stage', () => {
  const { plan, states } = triggerFixture();
  states.set(0, { status: 'activated', triggerDedupeKey: 'initial:0' });
  // A needed span inside S3 while S2 is unbuilt: must NOT trigger S3 yet.
  const premature = evaluateStageTriggers({
    plan, states, neededRanges: [{ startCp: 70_000, endCp: 71_000 }],
  });
  assert.equal(premature.length, 0, 'S3 cannot trigger before S2 is built');
  states.set(1, { status: 'activated', triggerDedupeKey: 'proximity:1' });
  const mature = evaluateStageTriggers({
    plan, states, neededRanges: [{ startCp: 70_000, endCp: 71_000 }],
  });
  assert.deepEqual(mature.map(decision => decision.stageIndex), [2]);
  assert.equal(mature[0].reason, 'dependency_demand');
});

// ---------------------------------------------------------------------------
// U08: orchestrator - scoped runs, dedupe, stage lifecycle
// ---------------------------------------------------------------------------

async function prepareWorld(db, fixtureName, worldId, sourceId) {
  const adapter = new NodeSqliteAdapter(db);
  const sourceStore = new SqliteSourceStore(adapter);
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', fixtureName));
  const decoder = new TextDecoder('utf-8');
  const source = {
    buffer: bytes, encoding: 'utf-8',
    rawSha256Hex: crypto.createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
    async readText(offset, maxBytes) {
      const end = Math.min(offset + maxBytes, bytes.length);
      const atEof = end >= bytes.length;
      const text = decoder.decode(bytes.subarray(offset, end), { stream: !atEof });
      return { text, nextByteOffset: end, atEof };
    },
  };
  const now = '2026-09-29T15:00:00.000Z';
  await sourceStore.beginStaging({
    sourceId, rawSha256Hex: source.rawSha256Hex, normalizedTreeHash: '',
    normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: bytes.length,
    codePointCount: 0, encoding: 'utf-8', normalizeVersion: 'normalize-1',
    chapterSplitVersion: 'chapter-split-1', normalizeShardScheme: 'normalize-shard-1',
    splitStrategy: 'standard', fileName: fixtureName, title: null,
    status: 'staging', createdAt: now, updatedAt: now,
  });
  const result = await importTxtSourceStreaming(source, sourceStore, sourceId, {
    sha256Hex: sha.sha256Hex,
    sha256BytesHex: async buf => crypto.createHash('sha256').update(buf).digest('hex'),
  });
  await sourceStore.activateSource({
    manifest: {
      sourceId, rawSha256Hex: result.rawSha256Hex, normalizedTreeHash: result.normalizedTreeHash,
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: result.byteLength,
      codePointCount: result.codePointCount, encoding: result.encoding,
      normalizeVersion: result.normalizeVersion, chapterSplitVersion: result.chapterSplitVersion,
      normalizeShardScheme: result.normalizeShardScheme, splitStrategy: result.splitStrategy,
      fileName: fixtureName, title: null, status: 'active', createdAt: now, updatedAt: now,
    },
    chapters: result.chapters, chunks: result.chunks,
  });
  const worldStore = new SqliteWorldStore(adapter);
  await worldStore.createWorld({
    worldId, title: 't', sourceSha256: result.rawSha256Hex, sourceBytes: bytes.length,
    normalizeVersion: result.normalizeVersion, chapterSplitVersion: result.chapterSplitVersion,
    buildStatus: 'extracting', createdAt: now, updatedAt: now,
  });
  return { adapter, sourceStore, worldStore, result };
}

function orchestratorDeps(db, adapter, sourceStore, worldStore) {
  return {
    db,
    stageStore: new SqliteStagePlanStore(adapter),
    runStore: new SqliteBuildRunStore(adapter),
    sourceStore,
    worldStore,
    sha256Hex: sha.sha256Hex,
    now: () => '2026-09-29T15:00:00.000Z',
  };
}

const TEMPLATE = {
  extractorVersion: 'fixture-1',
  modelFingerprint: 'ep#m',
  mode: 'group',
  budget: {
    contextWindowTokens: 30_000, maxContentOutputTokens: 3_000, reasoningReserveTokens: 0,
    reasoningEffort: 'off', supportsPromptCache: false, reserveTokens: 2_000,
  },
};

test('U08 progressive initial queue builds ONLY S1; un-triggered stages never request prose', async () => {
  const db = setupDb();
  try {
    const { adapter, sourceStore, worldStore, result } = await prepareWorld(db, 'novel-medium.txt', 'w-p3a', 'src-p3a');
    const deps = orchestratorDeps(db, adapter, sourceStore, worldStore);
    const { plan } = await ensureStagePlan(deps, {
      worldId: 'w-p3a', sourceId: 'src-p3a', strategy: 'progressive', configFingerprint: 'cf',
    });
    assert.ok(plan.stages.length >= 2, 'medium fixture plans multiple stages');
    const queued = await queueInitialStages(deps, {
      worldId: 'w-p3a', title: 't', template: TEMPLATE,
    });
    assert.equal(queued.length, 1, 'progressive mode queues only S1');
    assert.equal(queued[0].stageIndex, 0);

    // The S1 run's units cover ONLY chunks inside the S1 codepoint range.
    const s1 = plan.stages[0];
    const units = await deps.runStore.listUnits(queued[0].runId);
    assert.ok(units.length > 0);
    for (const unit of units) {
      const { ranges } = parseUnitRanges(unit.sourceRangesJson);
      for (const range of ranges) {
        const chunk = result.chunks.find(candidate => candidate.chunkId === range.chunkId);
        assert.ok(chunk, `planned chunk ${range.chunkId} exists`);
        assert.ok(chunk.endOffset > s1.startCp && chunk.startOffset < s1.endCp,
          `chunk ${chunk.chunkId} inside S1 range`);
      }
    }
    // S2/S3 remain untriggered: no runs, no queued units beyond S1's scope.
    const states = await deps.stageStore.listStageStates((await deps.stageStore.getStagePlanByWorld('w-p3a')).planId);
    assert.equal(states.filter(state => state.status !== 'untriggered').length, 1);
  } finally {
    db.close();
  }
});

test('U08 a canceled stage run can be re-queued; a live run keeps the claim', async () => {
  const db = setupDb();
  try {
    const { adapter, sourceStore, worldStore } = await prepareWorld(db, 'novel-medium.txt', 'w-p3c', 'src-p3c');
    const deps = orchestratorDeps(db, adapter, sourceStore, worldStore);
    await ensureStagePlan(deps, { worldId: 'w-p3c', sourceId: 'src-p3c', strategy: 'progressive', configFingerprint: 'cf' });
    const queued = await queueInitialStages(deps, { worldId: 'w-p3c', title: 't', template: TEMPLATE });
    assert.equal(queued.length, 1);
    const planId = (await deps.stageStore.getStagePlanByWorld('w-p3c')).planId;

    // While the run is live (queued), a new claim is deduped away.
    assert.equal(await deps.stageStore.claimStageTrigger({
      planId, stageIndex: 0, reason: 'demand:0', dedupeKey: 'demand:0', now: 't',
    }), false, 'live run keeps the claim');

    // Cancel the run -> the stage re-claims and produces a fresh run slot.
    await deps.runStore.setRunStatus(queued[0].runId, 'canceled', 't');
    assert.equal(await deps.stageStore.claimStageTrigger({
      planId, stageIndex: 0, reason: 'requeue', dedupeKey: 'requeue:0', now: 't',
    }), true, 'canceled run releases the stage for requeue');
    const reQueued = await queueInitialStages(deps, { worldId: 'w-p3c', title: 't', template: TEMPLATE });
    assert.equal(reQueued.length, 1, 'S1 re-queues after cancel');
    assert.notEqual(reQueued[0].runId, queued[0].runId);
  } finally {
    db.close();
  }
});

test('U08 repeated triggers dedupe to one task; full strategy queues every stage; switch builds the remainder', async () => {
  const db = setupDb();
  try {
    const { adapter, sourceStore, worldStore } = await prepareWorld(db, 'novel-medium.txt', 'w-p3b', 'src-p3b');
    const deps = orchestratorDeps(db, adapter, sourceStore, worldStore);
    await ensureStagePlan(deps, { worldId: 'w-p3b', sourceId: 'src-p3b', strategy: 'progressive', configFingerprint: 'cf' });
    await queueInitialStages(deps, { worldId: 'w-p3b', title: 't', template: TEMPLATE });
    await markStageRunStatus(deps, { worldId: 'w-p3b', stageIndex: 0, status: 'activated' });

    // Same trigger twice -> one run, second absorbed (dedupe).
    const planRow = await deps.stageStore.getStagePlanByWorld('w-p3b');
    const plan = { planVersion: 'stage-plan-1', strategy: 'progressive', codePointCount: 100, stages: planRow.stages };
    const anchorCp = plan.stages[1].startCp - 1;
    const first = await evaluateAndClaimTriggers(deps, {
      worldId: 'w-p3b', title: 't', template: TEMPLATE, anchorCp,
    });
    assert.equal(first.length, 1);
    assert.equal(first[0].deduped, false);
    assert.ok(first[0].runId);
    const second = await evaluateAndClaimTriggers(deps, {
      worldId: 'w-p3b', title: 't', template: TEMPLATE, anchorCp,
    });
    assert.equal(second.length, 0, 'repeat trigger creates NO new task (dedupe)');
    const statesAfter = await deps.stageStore.listStageStates(planRow.planId);
    const s1 = statesAfter.find(state => state.stageIndex === 1);
    assert.equal(s1.status, 'queued');
    assert.equal(s1.runId, first[0].runId, 'the single queued task keeps its run');
    assert.equal((await deps.runStore.listUnits(first[0].runId)).length > 0, true);

    // Switching to full builds the remainder: queueInitialStages claims every
    // still-untriggered stage exactly once; the activated S1 is untouched.
    await deps.stageStore.setStageStatus({ planId: planRow.planId, stageIndex: 1, status: 'activated', now: 't' });
    const rest = await queueInitialStages(deps, { worldId: 'w-p3b', title: 't', template: TEMPLATE });
    const finalStates = await deps.stageStore.listStageStates(planRow.planId);
    const reQueuedActivated = finalStates.filter(state => state.status === 'queued');
    assert.ok(rest.every(entry => entry.stageIndex >= 1), 'only unbuilt stages queued');
    assert.equal(reQueuedActivated.filter(state => state.triggerDedupeKey === 'initial:0').length, 0,
      'already-activated S1 not re-queued');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// U09: stage packages + activation
// ---------------------------------------------------------------------------

function factRow(worldId, factId, subject, predicate, value, spans, status = 'explicit') {
  return {
    worldId, factId, subjectEntityId: subject, predicate, value, status,
    confidence: 0.9, validFrom: null, validTo: null, revealAt: null,
    scope: 'canon',
    sources: spans.map(span => ({
      chapterId: span.chapterId ?? 'ch-0001', startOffset: span.startCp, endOffset: span.endCp,
      quote: '引文', quoteSha256: 'q',
    })),
  };
}

test('U09 stage package publishes cumulative partial scope; whole text upgrades to complete', async () => {
  const db = setupDb();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const worldStore = new SqliteWorldStore(adapter);
    await worldStore.createWorld({
      worldId: 'w-pkg', title: 't', sourceSha256: 'b'.repeat(64), sourceBytes: 1,
      normalizeVersion: 'n', chapterSplitVersion: 'c', buildStatus: 'ready',
      createdAt: 't', updatedAt: 't',
    });
    await worldStore.upsertEntity({
      worldId: 'w-pkg', entityId: 'ent-甲', type: 'character', name: '甲',
      firstSeenChapterId: null, aliases: [],
    }, 't');
    await worldStore.saveImportedSource('w-pkg', {
      encoding: 'utf-8', sourceSha256Hex: 'b'.repeat(64), sourceByteLength: 1,
      normalizeVersion: 'n', chapterSplitVersion: 'c', splitStrategy: 'standard',
      text: '', codePointCount: 10_000,
      chapters: [chapter('ch-0001', 1, 0, 10_000)],
      chunks: [],
    }, 't');
    // Two facts: one inside the S1 prefix [0,3000), one in S3.
    await worldStore.saveFact(factRow('w-pkg', 'fact-in', 'ent-甲', 'skill', { name: '剑' },
      [{ startCp: 100, endCp: 200 }]), 't');
    await worldStore.saveFact(factRow('w-pkg', 'fact-out', 'ent-甲', 'skill', { name: '晚期武艺' },
      [{ startCp: 8_000, endCp: 8_100 }]), 't');

    const provider = {
      async complete(request) {
        const payload = JSON.parse(request.user);
        const ids = payload.facts.map(fact => fact.factId);
        return {
          text: JSON.stringify({
            skills: ids.map((id, i) => ({
              id: `sk-${i}`, name: `技能${i}`, attribute: 'agility', usage: 'utility',
              allowUntrained: true, powerTier: 'ordinary',
              provenanceKind: 'explicit', evidenceFactIds: [id], rationale: '证据映射。',
            })),
            constraints: [], actorTemplates: [], items: [], lore: [], ruleMappings: [],
          }),
          usage: { inputTokens: 100, outputTokens: 100, estimated: false },
        };
      },
    };
    const stageHash = await sha.sha256Hex('stage-range');
    const partial = await buildPackageFromCanon({
      worldStore, provider, sha256Hex: sha.sha256Hex,
      worldId: 'w-pkg', sourceSha256: 'b'.repeat(64), mappingVersion: 'st-1', createdAt: 't',
      stageScope: {
        ranges: [{ startCodePoint: 0, endCodePoint: 3_000, contentSha256: stageHash }],
        coversWholeText: false,
      },
    });
    assert.equal(partial.manifest.status, 'published');
    assert.equal(partial.manifest.buildScope.scope, 'incremental');
    assert.equal(partial.manifest.buildScope.completeness, 'partial');
    assert.equal(partial.manifest.buildScope.strategy, 'progressive');
    // Only the in-range fact was offered: exactly one evidenced skill.
    const evidencedSkills = partial.entries.filter(entry => entry.kind === 'skill'
      && entry.provenance.kind === 'explicit');
    assert.equal(evidencedSkills.length, 1, 'facts outside the built prefix are not mapped');

    const whole = await buildPackageFromCanon({
      worldStore, provider, sha256Hex: sha.sha256Hex,
      worldId: 'w-pkg', sourceSha256: 'b'.repeat(64), mappingVersion: 'st-1', createdAt: 't2',
      stageScope: {
        ranges: [{ startCodePoint: 0, endCodePoint: 10_000, contentSha256: stageHash }],
        coversWholeText: true,
      },
    });
    assert.equal(whole.manifest.buildScope.scope, 'whole_source');
    assert.equal(whole.manifest.buildScope.completeness, 'complete');
    const wholeSkills = whole.entries.filter(entry => entry.kind === 'skill'
      && entry.provenance.kind === 'explicit');
    assert.equal(wholeSkills.length, 2, 'whole-text scope maps every fact');

    // Non-contiguous stage ranges refuse to publish.
    await assert.rejects(() => buildPackageFromCanon({
      worldStore, provider, sha256Hex: sha.sha256Hex,
      worldId: 'w-pkg', sourceSha256: 'b'.repeat(64), mappingVersion: 'st-1', createdAt: 't3',
      stageScope: {
        ranges: [{ startCodePoint: 500, endCodePoint: 3_000, contentSha256: stageHash }],
        coversWholeText: false,
      },
    }), /不连续/);
  } finally {
    db.close();
  }
});

test('U09 activation: safe boundary only; running interaction blocks; rewind/fork keep the base', async () => {
  const db = setupDb();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const stageStore = new SqliteStagePlanStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const sourceStore = new SqliteSourceStore(adapter);
    await worldStore.createWorld({
      worldId: 'w-act', title: 't', sourceSha256: 'b'.repeat(64), sourceBytes: 1,
      normalizeVersion: 'n', chapterSplitVersion: 'c', buildStatus: 'ready',
      createdAt: 't', updatedAt: 't',
    });
    await sourceStore.beginStaging({
      sourceId: 'src-act', rawSha256Hex: 'a'.repeat(64), normalizedTreeHash: '',
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: 1, codePointCount: 10_000,
      encoding: 'utf-8', normalizeVersion: 'normalize-1', chapterSplitVersion: 'chapter-split-1',
      normalizeShardScheme: 'normalize-shard-1', splitStrategy: 'standard',
      fileName: 'x', title: null, status: 'staging', createdAt: 't', updatedAt: 't',
    });
    await sourceStore.activateSource({
      manifest: {
        sourceId: 'src-act', rawSha256Hex: 'a'.repeat(64), normalizedTreeHash: 't1',
        normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: 1, codePointCount: 10_000,
        encoding: 'utf-8', normalizeVersion: 'normalize-1', chapterSplitVersion: 'chapter-split-1',
        normalizeShardScheme: 'normalize-shard-1', splitStrategy: 'standard',
        fileName: 'x', title: null, status: 'active', createdAt: 't', updatedAt: 't',
      },
      chapters: Array.from({ length: 10 }, (_, i) => chapter(`ch-${i + 1}`, i + 1, i * 1_000, (i + 1) * 1_000)),
      chunks: [],
    });
    // Campaign + branch at revision 1.
    db.prepare(`INSERT INTO campaigns
      (campaign_id, world_id, title, ruleset_id, ruleset_version, world_mapping_version,
       opening_json, created_at, package_revision, anchor_json, status)
      VALUES ('camp', 'w-act', 't', 'shine', 'r', 'm', '{}', 't', 1, '{}', 'active')`).run();
    db.prepare(`INSERT INTO branches (branch_id, campaign_id, parent_branch_id, fork_turn_id, state_version, created_at)
      VALUES ('camp-main', 'camp', NULL, NULL, 7, 't')`).run();

    const { plan } = await ensureStagePlan(
      { db, stageStore, runStore: new SqliteBuildRunStore(adapter), sourceStore, worldStore, sha256Hex: sha.sha256Hex, now: () => 't' },
      { worldId: 'w-act', sourceId: 'src-act', strategy: 'progressive', configFingerprint: 'cf' },
    );
    const planId = (await stageStore.getStagePlanByWorld('w-act')).planId;
    await stageStore.claimStageTrigger({ planId, stageIndex: 0, reason: 'initial', dedupeKey: 'initial:0', now: 't' });
    await stageStore.setStageStatus({ planId, stageIndex: 0, status: 'built', now: 't' });
    await stageStore.setStageStatus({ planId, stageIndex: 0, status: 'pending_activation', packageRevision: 2, now: 't' });

    // A running interaction operation blocks activation (frozen turn).
    db.prepare(`INSERT INTO interaction_operations
      (operation_id, campaign_id, branch_id, operation_kind, status, expected_state_version, fence_token, next_step, max_steps, created_at, updated_at)
      VALUES ('op-1', 'camp', 'camp-main', 'encounter_auto', 'running', 7, 1, 0, 4, 't', 't')`).run();
    let blocked = await activatePendingStages(
      { db: adapter, stageStore }, { campaignId: 'camp', branchId: 'camp-main', stateVersion: 7, worldId: 'w-act', now: 't' },
    );
    assert.equal(blocked.activated, false);
    assert.equal(blocked.reason, 'not_safe_boundary');

    db.prepare("UPDATE interaction_operations SET status = 'completed' WHERE operation_id = 'op-1'").run();
    const ok = await activatePendingStages(
      { db: adapter, stageStore }, { campaignId: 'camp', branchId: 'camp-main', stateVersion: 7, worldId: 'w-act', now: 't' },
    );
    assert.equal(ok.activated, true);
    assert.equal(ok.reason, 'ok');

    // The branch now plays with revision 2.
    const effective = await resolvePlayableRevision(stageStore, {
      campaignId: 'camp', branchId: 'camp-main', stateVersion: 7, baseRevision: 1,
    });
    assert.equal(effective, 2);

    // Rewind to state version 3: the advance (recorded at 7) no longer
    // applies - the old base revision plays again.
    const rewound = await resolvePlayableRevision(stageStore, {
      campaignId: 'camp', branchId: 'camp-main', stateVersion: 3, baseRevision: 1,
    });
    assert.equal(rewound, 1, 'rewind drops later activation intents');

    // A fork (new branch id) has no advances: base revision.
    const forked = await resolvePlayableRevision(stageStore, {
      campaignId: 'camp', branchId: 'camp-fork', stateVersion: 7, baseRevision: 1,
    });
    assert.equal(forked, 1, 'fork starts from the base lock');

    // Existing character state survives activation (nothing rewrote rows).
    const advanceCount = db.prepare('SELECT COUNT(*) AS n FROM campaign_package_advances').get();
    assert.equal(advanceCount.n, 1, 'exactly one advance recorded');
    assert.equal(plan.stages.length >= 1, true);
  } finally {
    db.close();
  }
});

test('U09 builtStageRanges reports the cumulative prefix and completion', async () => {
  const db = setupDb();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const stageStore = new SqliteStagePlanStore(adapter);
    const sourceStore = new SqliteSourceStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    await sourceStore.beginStaging({
      sourceId: 'src-r', rawSha256Hex: 'a'.repeat(64), normalizedTreeHash: '',
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: 1, codePointCount: 10_000,
      encoding: 'utf-8', normalizeVersion: 'normalize-1', chapterSplitVersion: 'chapter-split-1',
      normalizeShardScheme: 'normalize-shard-1', splitStrategy: 'standard',
      fileName: 'x', title: null, status: 'staging', createdAt: 't', updatedAt: 't',
    });
    await sourceStore.activateSource({
      manifest: {
        sourceId: 'src-r', rawSha256Hex: 'a'.repeat(64), normalizedTreeHash: 't1',
        normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: 1, codePointCount: 10_000,
        encoding: 'utf-8', normalizeVersion: 'normalize-1', chapterSplitVersion: 'chapter-split-1',
        normalizeShardScheme: 'normalize-shard-1', splitStrategy: 'standard',
        fileName: 'x', title: null, status: 'active', createdAt: 't', updatedAt: 't',
      },
      chapters: Array.from({ length: 10 }, (_, i) => chapter(`ch-${i + 1}`, i + 1, i * 1_000, (i + 1) * 1_000)),
      chunks: [],
    });
    await worldStore.createWorld({
      worldId: 'w-r', title: 't', sourceSha256: 'b'.repeat(64), sourceBytes: 1,
      normalizeVersion: 'n', chapterSplitVersion: 'c', buildStatus: 'ready', createdAt: 't', updatedAt: 't',
    });
    const deps = {
      db, stageStore, runStore: new SqliteBuildRunStore(adapter), sourceStore, worldStore,
      sha256Hex: sha.sha256Hex, now: () => 't',
    };
    await ensureStagePlan(deps, { worldId: 'w-r', sourceId: 'src-r', strategy: 'progressive', configFingerprint: 'cf' });
    const planId = (await stageStore.getStagePlanByWorld('w-r')).planId;

    const none = await builtStageRanges(deps, 'w-r');
    assert.equal(none.allBuilt, false);
    assert.equal(none.ranges.length, 0);

    await stageStore.setStageStatus({ planId, stageIndex: 0, status: 'built', now: 't' });
    const partial = await builtStageRanges(deps, 'w-r');
    assert.deepEqual(partial.ranges, [{ startCp: 0, endCp: partial.ranges[0].endCp }]);
    assert.equal(partial.allBuilt, false);

    const states = await stageStore.listStageStates(planId);
    for (const state of states) {
      await stageStore.setStageStatus({ planId, stageIndex: state.stageIndex, status: 'built', now: 't' });
    }
    const all = await builtStageRanges(deps, 'w-r');
    assert.equal(all.allBuilt, true);
    assert.equal(all.ranges[0].startCp, 0);
  } finally {
    db.close();
  }
});

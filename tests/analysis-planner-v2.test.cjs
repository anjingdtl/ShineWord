'use strict';
/**
 * Planner-v2 (plan-analysis-1) regression suite:
 * - chapter-first AnalysisSlices, token-budget batches, NO chunk-count caps
 * - probe/shrink ladders, density calibration, density-driven splits
 * - slice -> storage-chunk evidence attribution (absolute offsets)
 * - replan guards: completed/running units never replanned
 * - deterministic playability gate (TTFP)
 */
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
const { importTxtSourceStreaming } = require('../dist/application/import/streamingTxtImport');
const { orderChunksByChapter } = require('../dist/application/worldBuild/chapterBatchPlanner');
const { createExtractionRun, executeRun, parseUnitRanges } = require('../dist/application/worldBuild/coordinator');
const {
  planAnalysisBatches,
  buildAnalysisSlices,
  resolveAnalysisBatchBudget,
  nextSourceRatioUp,
  nextSourceRatioDown,
  TokenDensityCalibrator,
  densitySplitPartCount,
  capSourceRatioByDensity,
  predictOutputTokens,
  SOURCE_RATIO_PROBE_START,
  DEFAULT_EXTRACTION_DENSITY,
} = require('../dist/application/worldBuild/analysisBatchPlanner');
const { LlmGroupExtractor } = require('../dist/application/world/llmGroupExtractor');
const { evaluatePlayabilityGate } = require('../dist/application/worldPackage/playabilityGate');
const { FixtureExtractor } = require('./fixtures/fixtureExtractor.cjs');

const sha = {
  sha256Hex: async input => crypto.createHash('sha256').update(input).digest('hex'),
  sha256BytesHex: bytes => crypto.createHash('sha256').update(bytes).digest('hex'),
};

const BUDGET_1M = {
  contextWindowTokens: 1_048_576, maxContentOutputTokens: 16_384, reasoningReserveTokens: 0,
  reasoningEffort: 'off', supportsPromptCache: true, reserveTokens: 2_000,
};

function syntheticSource(chapterCount, chunksPerChapter, chunkCp) {
  const chapters = [];
  const chunks = [];
  let cp = 0;
  for (let c = 1; c <= chapterCount; c += 1) {
    const chapterId = `ch-${String(c).padStart(4, '0')}`;
    const start = cp;
    for (let k = 1; k <= chunksPerChapter; k += 1) {
      chunks.push({
        chunkId: `${chapterId}-c${String(k).padStart(3, '0')}`,
        chapterId,
        chunkIndex: k - 1,
        startOffset: cp,
        endOffset: cp + chunkCp,
        charCount: chunkCp,
        contentHash: `h-${cp}`,
      });
      cp += chunkCp;
    }
    chapters.push({
      chapterId, index: c - 1, title: `第${c}章`,
      startOffset: start, endOffset: cp, charCount: cp - start, contentHash: `ch-${c}`,
    });
  }
  return { chapters, chunks };
}

test('V2-01 many small chapters merge into one large batch; no 14/32 chunk cap', () => {
  // 20 chapters x 5 chunks = 100 storage chunks, 1,200 cp each (1.2M cp book).
  const { chapters, chunks } = syntheticSource(20, 5, 1_200);
  const batches = planAnalysisBatches(chapters, chunks, BUDGET_1M, {
    sourceRatio: SOURCE_RATIO_PROBE_START, density: DEFAULT_EXTRACTION_DENSITY,
  });
  assert.equal(batches.length, 1, 'whole book fits one batch at 12% of 1M');
  assert.equal(batches[0].segments.length, 100, 'all 100 storage chunks in the single batch');
  assert.equal(batches[0].slices.length, 20, 'one AnalysisSlice per chapter');
  assert.equal(batches[0].chapterIds.length, 20);
  assert.ok(batches[0].estInputTokens > 100_000, 'batch is genuinely large');
});

test('V2-02 budget resolution: window share, hard input, density budget all bind', () => {
  // 1M window, ratio 0.12 -> 125,829 (window share binds).
  const byRatio = resolveAnalysisBatchBudget(BUDGET_1M, { sourceRatio: 0.12, density: 0.06 });
  assert.equal(byRatio.sourceTargetTokens, Math.floor(1_048_576 * 0.12));
  // Tiny window with a big output reserve: hard input room binds below the
  // 30% window share.
  const tiny = { ...BUDGET_1M, contextWindowTokens: 30_000, maxContentOutputTokens: 20_000 };
  const byHard = resolveAnalysisBatchBudget(tiny, { sourceRatio: 0.30, density: 0.06 });
  assert.equal(byHard.sourceTargetTokens, 30_000 - 20_000 - 0 - 2_000 - 1_500);
  // Huge density: the output-density budget binds.
  const byDensity = resolveAnalysisBatchBudget(BUDGET_1M, { sourceRatio: 0.30, density: 0.5 });
  assert.equal(byDensity.sourceTargetTokens, Math.floor((16_384 * 0.85) / 0.5));
});

test('V2-03 over-long chapter is sliced at chunk boundaries, fields stay exact', () => {
  // One chapter of 20 chunks (24k cp); slice target 7,200 tokens -> 4 slices
  // (6+6+6+2 chunks each: greedy chunk-boundary packing).
  const { chapters, chunks } = syntheticSource(1, 20, 1_200);
  const slices = buildAnalysisSlices(chapters, chunks, 7_200);
  assert.equal(slices.length, 4);
  assert.ok(slices.every(slice => slice.chapterId === chapters[0].chapterId));
  assert.deepEqual(slices.map(slice => slice.startCp), [0, 7_200, 14_400, 21_600]);
  // Contiguous, no holes/overlaps.
  for (let i = 1; i < slices.length; i += 1) {
    assert.equal(slices[i].startCp, slices[i - 1].endCp);
  }
  assert.equal(slices[slices.length - 1].endCp, 24_000);
  const memberIds = slices.flatMap(slice => slice.memberChunkIds);
  assert.equal(memberIds.length, 20, 'every chunk is a member of exactly one slice');
  assert.equal(new Set(memberIds).size, 20);
});

test('V2-04 chapter order and storage coverage invariants (no holes, no duplicates)', () => {
  const { chapters, chunks } = syntheticSource(30, 4, 1_200);
  const batches = planAnalysisBatches(chapters, chunks, BUDGET_1M, { sourceRatio: 0.03 });
  assert.ok(batches.length > 1, 'small ratio forces multiple batches');
  const planned = batches.flatMap(batch => batch.segments.map(segment => segment.chunkId));
  const ordered = orderChunksByChapter(chapters, chunks).map(chunk => chunk.chunkId);
  assert.deepEqual(planned, ordered, 'exact ordered coverage');
  // Slices also stay in chapter order across batches.
  const sliceChapterIds = batches.flatMap(batch => batch.slices.map(slice => slice.chapterId));
  const orderedChapters = [...chapters].sort((a, b) => a.index - b.index).map(c => c.chapterId);
  assert.deepEqual(sliceChapterIds, orderedChapters);
});

test('V2-05 dual-route fan-out keeps shared coverage with distinct identities', () => {
  const { chapters, chunks } = syntheticSource(6, 3, 1_200);
  const dual = planAnalysisBatches(chapters, chunks, BUDGET_1M, { routes: 'dual' });
  const single = planAnalysisBatches(chapters, chunks, BUDGET_1M, {});
  assert.equal(dual.length, single.length * 2);
  for (let i = 0; i < single.length; i += 1) {
    assert.deepEqual(dual[i * 2].segments, single[i].segments);
    assert.equal(dual[i * 2].route, 'characters');
    assert.equal(dual[i * 2 + 1].route, 'world');
  }
});

test('V2-06 source ratio ladders: probe growth and truncation shrink', () => {
  assert.equal(nextSourceRatioUp(0.12), 0.20);
  assert.equal(nextSourceRatioUp(0.20), 0.25);
  assert.equal(nextSourceRatioUp(0.25), 0.30);
  assert.equal(nextSourceRatioUp(0.30), 0.30, 'max holds');
  assert.equal(nextSourceRatioDown(0.30), 0.20);
  assert.equal(nextSourceRatioDown(0.20), 0.12);
  assert.equal(nextSourceRatioDown(0.12), 0.06, 'below the ladder: halving');
  assert.equal(nextSourceRatioDown(0.02), 0.02, 'floor holds');
});

test('V2-07 density calibration from measured usage', () => {
  const calibrator = new TokenDensityCalibrator(0.06);
  assert.equal(calibrator.due(1) && calibrator.due(2) && calibrator.due(3), true);
  assert.equal(calibrator.due(4), false);
  assert.equal(calibrator.due(6), true, 'interval checkpoint');
  calibrator.record(100_000, 5_200);
  calibrator.record(100_000, 6_800);
  assert.equal(calibrator.recalibrate(), 0.06, '5.2%+6.8% averaged -> 6%');
  // A heavy-output run recalibrates upward and is clamped sane.
  const heavy = new TokenDensityCalibrator(0.06);
  heavy.record(10_000, 9_000);
  assert.ok(heavy.recalibrate() > 0.06);
  assert.ok(heavy.currentDensity <= 0.5);
});

test('V2-08 density-driven split counts and ratio growth cap', () => {
  assert.equal(densitySplitPartCount(100_000, 0.06, 16_384), 1, '6% of 100k fits 16k');
  assert.equal(densitySplitPartCount(500_000, 0.06, 16_384), 3, '30k predicted -> 3 parts');
  assert.equal(densitySplitPartCount(1_000, 0.06, 16_384), 1);
  // Growth cap: with density 0.5 and 16k output, even 12% of 1M overflows.
  assert.equal(capSourceRatioByDensity(BUDGET_1M, 0.5) <= 0.12, true);
  // At density 6% with a 16k content budget the answerable input tops out
  // around 232k tokens (~22% of the window): growth stops at the 0.20 step.
  assert.equal(capSourceRatioByDensity(BUDGET_1M, 0.06), 0.20);
  // A larger declared output budget unlocks the full ladder.
  assert.equal(capSourceRatioByDensity({ ...BUDGET_1M, maxContentOutputTokens: 65_536 }, 0.06), 0.30);
  assert.equal(predictOutputTokens(100_000, 0.06), 6_000);
});

test('V2-09 quote attribution: AnalysisSlice evidence maps back to member chunks with absolute offsets', async () => {
  // Two storage chunks of one chapter merged into ONE segment (the v2 wire
  // protocol). A quote from the second chunk must resolve to that chunk with
  // absolute codepoint offsets.
  const segmentText = 'abcdefghij'; // chunk1 [0,5), chunk2 [5,10)
  const quote = 'fgh';
  const response = {
    text: JSON.stringify({
      entities: [{ key: 'alice', type: 'character', name: 'Alice', aliases: [] }],
      facts: [{
        subject: 'alice', predicate: 'current_location', value: { text: quote },
        status: 'explicit', confidence: 0.9, segment: 1, quote,
      }],
      events: [], ruleMappings: [],
    }),
  };
  const extractor = new LlmGroupExtractor(async () => response, 16_384, 'off');
  const group = await extractor.extract({
    unitId: 'u1',
    worldId: 'w',
    segments: [{
      chunkId: 'ch-0001-c001',
      chapterId: 'ch-0001',
      chapterTitle: '第1章',
      startCp: 0,
      text: segmentText,
      memberChunks: [
        { chunkId: 'ch-0001-c001', startCp: 0, endCp: 5 },
        { chunkId: 'ch-0001-c002', startCp: 5, endCp: 10 },
      ],
    }],
  });
  assert.equal(group.facts.length, 1);
  const fact = group.facts[0];
  assert.equal(fact.chunkId, 'ch-0001-c002', 'attributed to the member chunk containing the quote');
  assert.equal(fact.evidence.startOffset, 5);
  assert.equal(fact.evidence.endOffset, 8);
  assert.equal(fact.evidence.chapterId, 'ch-0001');
});

test('V2-10 replan guards: completed units keep their identity across growth replans', async () => {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  class Adapter {
    constructor(db) { this.db = db; this.chain = Promise.resolve(); }
    async execute(sql, params = []) {
      if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
      return this.db.prepare(sql).run(...params).changes;
    }
    async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
    async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
    transaction(work) {
      const run = async () => {
        this.db.exec('BEGIN IMMEDIATE');
        try { const value = await work(this); this.db.exec('COMMIT'); return value; }
        catch (error) { this.db.exec('ROLLBACK'); throw error; }
      };
      const pending = this.chain.then(run, run);
      this.chain = pending.then(() => undefined, () => undefined);
      return pending;
    }
  }
  try {
    const adapter = new Adapter(db);
    const sourceStore = new SqliteSourceStore(adapter);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'novel-small.txt'));
    const source = {
      buffer: bytes, encoding: 'utf-8', byteLength: bytes.length,
      rawSha256Hex: sha.sha256BytesHex(bytes),
      decoder: new TextDecoder('utf-8'),
      async readText(offset, maxBytes) {
        const end = Math.min(offset + maxBytes, bytes.length);
        const text = this.decoder.decode(bytes.subarray(offset, end), { stream: end < bytes.length });
        return { text, nextByteOffset: end, atEof: end >= bytes.length };
      },
    };
    const now = '2026-10-01T00:00:00.000Z';
    await sourceStore.beginStaging({
      sourceId: 'src-v2g', rawSha256Hex: source.rawSha256Hex, normalizedTreeHash: '',
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: bytes.length,
      codePointCount: 0, encoding: 'utf-8', normalizeVersion: 'normalize-1',
      chapterSplitVersion: 'chapter-split-1', normalizeShardScheme: 'normalize-shard-1',
      splitStrategy: 'standard', fileName: 'novel-small.txt', title: null,
      status: 'staging', createdAt: now, updatedAt: now,
    });
    const imported = await importTxtSourceStreaming(source, sourceStore, 'src-v2g', {
      sha256Hex: sha.sha256Hex, sha256BytesHex: sha.sha256BytesHex,
    });
    await sourceStore.activateSource({
      manifest: {
        sourceId: 'src-v2g', rawSha256Hex: imported.rawSha256Hex, normalizedTreeHash: imported.normalizedTreeHash,
        normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: imported.byteLength,
        codePointCount: imported.codePointCount, encoding: imported.encoding,
        normalizeVersion: imported.normalizeVersion, chapterSplitVersion: imported.chapterSplitVersion,
        normalizeShardScheme: imported.normalizeShardScheme, splitStrategy: imported.splitStrategy,
        fileName: 'novel-small.txt', title: null, status: 'active', createdAt: now, updatedAt: now,
      },
      chapters: imported.chapters, chunks: imported.chunks,
    });

    const smallNames = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'facts-small.json'), 'utf8'));
    const nameSet = new Set();
    for (const fact of smallNames.facts) {
      nameSet.add(fact.subject);
      if (typeof fact.value.person === 'string') nameSet.add(fact.value.person);
    }
    const fixture = new FixtureExtractor({ knownNames: [...nameSet] });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-v2g', worldId: 'w-v2g', sourceId: 'src-v2g', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group', budget: BUDGET_1M,
      },
    );
    const done = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture,
      groupExtractor: {
        version: 'llm-group-extractor-1',
        async extract({ segments }) {
          const entities = new Map();
          const facts = [];
          for (const segment of segments) {
            const perChunk = await fixture.extract({
              chunk: {
                chunkId: segment.chunkId, chapterId: segment.chapterId, chunkIndex: 0,
                startOffset: segment.startCp, endOffset: segment.startCp + [...segment.text].length,
                charCount: [...segment.text].length, contentHash: 'x',
              },
              chunkText: segment.text, worldId: 'w-v2g',
            });
            for (const entity of perChunk.entities) entities.set(entity.entityKey, entity);
            for (const fact of perChunk.facts) facts.push({ ...fact, chunkId: segment.memberChunks?.[0]?.chunkId ?? segment.chunkId });
          }
          return { entities: [...entities.values()], facts, events: [], ruleMappings: [], rejectedQuotes: 0 };
        },
      },
      sha256Hex: sha.sha256Hex, owner: 'v2g', budget: BUDGET_1M,
    }, 'run-v2g');
    assert.equal(done.completed, true);
    const units = await runStore.listUnits('run-v2g');
    // Every completed unit kept its identity (nothing re-planned under it).
    for (const unit of units.filter(u => u.status === 'completed')) {
      assert.equal(unit.attempt, 1, `unit ${unit.unitId} executed exactly once`);
    }
    // Full storage coverage: every chunk done exactly once.
    for (const chunk of imported.chunks) {
      const job = await worldStore.getJob('w-v2g', `job-extract-${chunk.chunkId}`);
      assert.equal(job?.status, 'done', `chunk ${chunk.chunkId} done`);
      assert.equal(job.attempts, 1, `chunk ${chunk.chunkId} committed exactly once`);
    }
    const run = await runStore.getRun('run-v2g');
    assert.equal(run.planVersion, 'plan-analysis-1');
  } finally {
    db.close();
  }
});

test('V2-11 playability gate: deterministic canon-based verdicts', () => {
  const entities = [
    { entityId: 'e-char', entityKey: 'alice', type: 'character', name: 'Alice' },
    { entityId: 'e-loc', entityKey: 'home', type: 'location', name: 'Home' },
  ];
  const fact = subjectEntityId => ({ subjectEntityId, status: 'explicit' });
  const facts = [
    fact('e-char'), fact('e-char'), fact('e-loc'),
    ...Array.from({ length: 22 }, () => fact('e-char')),
  ];
  // Insufficient canon.
  let verdict = evaluatePlayabilityGate({ entities, facts: facts.slice(0, 3), eventCount: 0, openBlockingReviewIssues: 0 });
  assert.equal(verdict.playable, false);
  assert.ok(verdict.reasons.length >= 2);
  // Sufficient canon.
  verdict = evaluatePlayabilityGate({ entities, facts, eventCount: 2, openBlockingReviewIssues: 0 });
  assert.equal(verdict.playable, true);
  assert.deepEqual(verdict.reasons, []);
  // Blocking review issue vetoes.
  verdict = evaluatePlayabilityGate({ entities, facts, eventCount: 2, openBlockingReviewIssues: 1 });
  assert.equal(verdict.playable, false);
  assert.ok(verdict.reasons.some(reason => reason.includes('阻断')));
  // Speculative-only facts don't count.
  verdict = evaluatePlayabilityGate({
    entities, facts: facts.map(f => ({ ...f, status: 'speculation' })), eventCount: 1, openBlockingReviewIssues: 0,
  });
  assert.equal(verdict.playable, false);
});

test('V2-12 TTFP hook: fires after each completed batch of stage-scoped v2 runs only', async () => {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  class Adapter {
    constructor(db) { this.db = db; this.chain = Promise.resolve(); }
    async execute(sql, params = []) {
      if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
      return this.db.prepare(sql).run(...params).changes;
    }
    async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
    async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
    transaction(work) {
      const run = async () => {
        this.db.exec('BEGIN IMMEDIATE');
        try { const value = await work(this); this.db.exec('COMMIT'); return value; }
        catch (error) { this.db.exec('ROLLBACK'); throw error; }
      };
      const pending = this.chain.then(run, run);
      this.chain = pending.then(() => undefined, () => undefined);
      return pending;
    }
  }
  try {
    const adapter = new Adapter(db);
    const sourceStore = new SqliteSourceStore(adapter);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'novel-small.txt'));
    const source = {
      buffer: bytes, encoding: 'utf-8', byteLength: bytes.length,
      rawSha256Hex: sha.sha256BytesHex(bytes),
      decoder: new TextDecoder('utf-8'),
      async readText(offset, maxBytes) {
        const end = Math.min(offset + maxBytes, bytes.length);
        const text = this.decoder.decode(bytes.subarray(offset, end), { stream: end < bytes.length });
        return { text, nextByteOffset: end, atEof: end >= bytes.length };
      },
    };
    const now = '2026-10-01T00:00:00.000Z';
    await sourceStore.beginStaging({
      sourceId: 'src-ttfp', rawSha256Hex: source.rawSha256Hex, normalizedTreeHash: '',
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: bytes.length,
      codePointCount: 0, encoding: 'utf-8', normalizeVersion: 'normalize-1',
      chapterSplitVersion: 'chapter-split-1', normalizeShardScheme: 'normalize-shard-1',
      splitStrategy: 'standard', fileName: 'novel-small.txt', title: null,
      status: 'staging', createdAt: now, updatedAt: now,
    });
    const imported = await importTxtSourceStreaming(source, sourceStore, 'src-ttfp', {
      sha256Hex: sha.sha256Hex, sha256BytesHex: sha.sha256BytesHex,
    });
    await sourceStore.activateSource({
      manifest: {
        sourceId: 'src-ttfp', rawSha256Hex: imported.rawSha256Hex, normalizedTreeHash: imported.normalizedTreeHash,
        normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: imported.byteLength,
        codePointCount: imported.codePointCount, encoding: imported.encoding,
        normalizeVersion: imported.normalizeVersion, chapterSplitVersion: imported.chapterSplitVersion,
        normalizeShardScheme: imported.normalizeShardScheme, splitStrategy: imported.splitStrategy,
        fileName: 'novel-small.txt', title: null, status: 'active', createdAt: now, updatedAt: now,
      },
      chapters: imported.chapters, chunks: imported.chunks,
    });
    const smallNames = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'facts-small.json'), 'utf8'));
    const nameSet = new Set();
    for (const fact of smallNames.facts) {
      nameSet.add(fact.subject);
      if (typeof fact.value.person === 'string') nameSet.add(fact.value.person);
    }
    const fixture = new FixtureExtractor({ knownNames: [...nameSet] });
    const groupExtractor = {
      version: 'llm-group-extractor-1',
      async extract({ segments }) {
        const entities = new Map();
        const facts = [];
        for (const segment of segments) {
          const perChunk = await fixture.extract({
            chunk: {
              chunkId: segment.chunkId, chapterId: segment.chapterId, chunkIndex: 0,
              startOffset: segment.startCp, endOffset: segment.startCp + [...segment.text].length,
              charCount: [...segment.text].length, contentHash: 'x',
            },
            chunkText: segment.text, worldId: 'w-ttfp',
          });
          for (const entity of perChunk.entities) entities.set(entity.entityKey, entity);
          for (const fact of perChunk.facts) facts.push({ ...fact, chunkId: segment.memberChunks?.[0]?.chunkId ?? segment.chunkId });
        }
        return { entities: [...entities.values()], facts, events: [], ruleMappings: [], rejectedQuotes: 0 };
      },
    };
    const makeRun = async (runId, worldId, scope) => {
      await createExtractionRun(
        { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
        {
          runId, worldId, sourceId: 'src-ttfp', modelFingerprint: 'ep#m',
          title: 't', extractorVersion: fixture.version, mode: 'group', budget: BUDGET_1M, scope,
        },
      );
    };
    await makeRun('run-scoped', 'w-ttfp', { startCp: 0, endCp: Math.floor(imported.codePointCount / 2) });
    await makeRun('run-whole', 'w-ttfp2', null);

    let scopedHookCalls = 0;
    let wholeHookCalls = 0;
    const execute = (runId, worldId, counter) => executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor,
      sha256Hex: sha.sha256Hex, owner: runId, budget: BUDGET_1M,
      onBatchCommitted: async () => { counter.n += 1; },
    }, runId);
    const scoped = { n: 0 };
    const doneScoped = await execute('run-scoped', 'w-ttfp', scoped);
    const whole = { n: 0 };
    const doneWhole = await execute('run-whole', 'w-ttfp2', whole);
    scopedHookCalls = scoped.n;
    wholeHookCalls = whole.n;
    assert.equal(doneScoped.completed, true);
    assert.equal(doneWhole.completed, true);
    assert.ok(scopedHookCalls > 0, 'stage-scoped v2 run fires the TTFP hook per completed batch');
    assert.equal(wholeHookCalls, 0, 'whole-source run does not fire the progressive opening hook');
  } finally {
    db.close();
  }
});

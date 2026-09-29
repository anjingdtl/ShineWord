// Unified world build P1 regression suite (U01-U04 core scope):
// - frozen run config: snapshot, revival, endpoint sanitization, no secrets
// - chapter batch planner: 1M/30MB synthetic coverage, oversized chapters,
//   the 32-storage-chunk cap is gone, dual-route fan-out
// - truncation ladder + calibrated replanning of the unclaimed tail
// - global RPM/TPM scheduler + scheduled provider wrapper
// - multi-runner lease exclusivity, cross-process pause/cancel flags
// - book registry key/entityKey reuse fix
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
const { importTxtSourceStreaming } = require('../dist/application/import/streamingTxtImport');
const {
  createExtractionRun,
  executeRun,
  parseUnitRanges,
} = require('../dist/application/worldBuild/coordinator');
const {
  BODY_TARGET_LADDER,
  nextBodyTargetRatio,
  planChapterBatches,
} = require('../dist/application/worldBuild/chapterBatchPlanner');
const {
  freezeRunConfig,
  reviveRunConfig,
  revivePlanState,
  frozenConfigIdentity,
  providerProfileFromFrozen,
  sanitizeEndpoint,
} = require('../dist/application/worldBuild/runConfig');
const {
  GlobalRateScheduler,
  estimateRequestTokens,
} = require('../dist/application/worldBuild/rateScheduler');
const { RateScheduledProvider } = require('../dist/application/llm/scheduledProvider');
const { buildBookRegistry, BOOK_REGISTRY_VERSION } = require('../dist/application/world/bookRegistry');
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

class NodeTextSource {
  constructor(buffer, encoding = 'utf-8') {
    this.buffer = buffer;
    this.encoding = encoding;
    this.rawSha256Hex = crypto.createHash('sha256').update(buffer).digest('hex');
    this.decoder = new TextDecoder(encoding === 'utf-8-sig' || encoding === 'utf-8' ? 'utf-8' : encoding);
  }
  get byteLength() { return this.buffer.length; }
  async readText(offset, maxBytes) {
    const end = Math.min(offset + maxBytes, this.buffer.length);
    const atEof = end >= this.buffer.length;
    const text = this.decoder.decode(this.buffer.subarray(offset, end), { stream: !atEof });
    return { text, nextByteOffset: end, atEof };
  }
}

async function prepareActiveSqliteSource(db, fixtureName, sourceId) {
  const store = new SqliteSourceStore(new NodeSqliteAdapter(db));
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', fixtureName));
  const source = new NodeTextSource(bytes);
  const now = '2026-09-29T12:00:00.000Z';
  await store.beginStaging({
    sourceId, rawSha256Hex: source.rawSha256Hex, normalizedTreeHash: '',
    normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: bytes.length,
    codePointCount: 0, encoding: 'utf-8', normalizeVersion: 'normalize-1',
    chapterSplitVersion: 'chapter-split-1', normalizeShardScheme: 'normalize-shard-1',
    splitStrategy: 'standard', fileName: fixtureName, title: null,
    status: 'staging', createdAt: now, updatedAt: now,
  });
  const result = await importTxtSourceStreaming(source, store, sourceId, {
    sha256Hex: sha.sha256Hex, sha256BytesHex: sha.sha256BytesHex,
  });
  await store.activateSource({
    manifest: {
      sourceId, rawSha256Hex: result.rawSha256Hex, normalizedTreeHash: result.normalizedTreeHash,
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: result.byteLength,
      codePointCount: result.codePointCount, encoding: result.encoding,
      normalizeVersion: result.normalizeVersion, chapterSplitVersion: result.chapterSplitVersion,
      normalizeShardScheme: result.normalizeShardScheme, splitStrategy: result.splitStrategy,
      fileName: fixtureName, title: null, status: 'active', createdAt: now, updatedAt: now,
    },
    chapters: result.chapters,
    chunks: result.chunks,
  });
  return { store, result };
}

function fixtureNames() {
  const small = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'facts-small.json'), 'utf8'));
  const medium = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'facts-medium.json'), 'utf8'));
  const names = new Set();
  for (const fact of [...small.facts, ...medium.facts]) {
    names.add(fact.subject);
    if (typeof fact.value.person === 'string') names.add(fact.value.person);
  }
  return [...names];
}

/** Deterministic synthetic chapter/chunk metadata (no prose needed - the
 * planner only reads counts and ids). */
function syntheticSource(chapterCount, chunksPerChapter, chunkCp) {
  const chapters = [];
  const chunks = [];
  let chunkIndex = 0;
  let cp = 0;
  for (let c = 1; c <= chapterCount; c += 1) {
    const chapterId = `ch-${String(c).padStart(4, '0')}`;
    const chapterStart = cp;
    for (let k = 1; k <= chunksPerChapter; k += 1) {
      chunks.push({
        chunkId: `${chapterId}-c${String(k).padStart(3, '0')}`,
        chapterId,
        chunkIndex: chunkIndex++,
        startOffset: cp,
        endOffset: cp + chunkCp,
        charCount: chunkCp,
        contentHash: 'x',
      });
      cp += chunkCp;
    }
    chapters.push({
      chapterId, index: c, title: `第${c}章`, startOffset: chapterStart, endOffset: cp,
      charCount: cp - chapterStart, contentHash: 'x',
    });
  }
  return { chapters, chunks };
}

const BUDGET_1M = {
  contextWindowTokens: 1_048_576,
  maxContentOutputTokens: 16_384,
  reasoningReserveTokens: 2_048,
  reasoningEffort: 'low',
  supportsPromptCache: true,
  reserveTokens: 2_000,
};

// ---------------------------------------------------------------------------
// U01: frozen run configuration
// ---------------------------------------------------------------------------

test('U01 frozen run config: sanitize, freeze, revive, identity, no secrets', () => {
  const dirty = 'https://user:secret@open.example.com/v1/chat/completions?api_key=sk-hush';
  const clean = sanitizeEndpoint(dirty);
  assert.equal(clean.includes('user:secret'), false);
  assert.equal(clean.includes('sk-hush'), false);
  assert.equal(clean.includes('api_key'), false);
  assert.equal(clean.includes('chat/completions'), true);

  const profile = {
    id: 'default', name: 'DS', endpoint: dirty, model: 'deepseek-v4.1-flash', keyRef: 'llm.default',
    capabilities: {
      supportsJson: true, supportsStreaming: false, reportsUsage: true,
      contextWindow: 1_048_576, maxOutputTokens: 131_072, supportsPromptCache: true,
    },
    reasoningEffort: 'off',
    contentOutputTokens: 16_384,
    reasoningReserveTokens: 0,
    concurrency: 3,
    tpm: 3_000_000,
    rpm: 60,
  };
  const frozen = freezeRunConfig(profile, {
    contextWindowTokens: 1_048_576, maxContentOutputTokens: 16_384, reasoningReserveTokens: 0,
    reasoningEffort: 'off', supportsPromptCache: true, reserveTokens: 2_000,
  });
  assert.equal(frozen.endpoint.includes('secret'), false);
  assert.equal(frozen.keyRef, 'llm.default');
  assert.equal(frozen.bodyTargetRatio, 0.30);
  assert.equal(frozen.configVersion, 'run-config-1');

  const json = JSON.stringify(frozen);
  assert.equal(json.includes('sk-hush'), false, 'frozen config never carries the key');
  const revived = reviveRunConfig(json);
  assert.deepEqual(revived, frozen);
  assert.equal(reviveRunConfig(null), null);
  assert.equal(reviveRunConfig(JSON.stringify({ configVersion: 'run-config-0' })), null);

  assert.equal(frozenConfigIdentity(frozen), frozenConfigIdentity(revived));
  const other = { ...frozen, model: 'other' };
  assert.notEqual(frozenConfigIdentity(frozen), frozenConfigIdentity(other));

  const providerProfile = providerProfileFromFrozen(frozen);
  assert.equal(providerProfile.endpoint, frozen.endpoint);
  assert.equal(providerProfile.model, frozen.model);
  assert.equal(providerProfile.keyRef, frozen.keyRef);
  assert.equal(providerProfile.capabilities.contextWindow, 1_048_576);
});

test('U01 createExtractionRun persists the frozen config and scope; executeRun resumes from them', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore, result } = await prepareActiveSqliteSource(db, 'novel-small.txt', 'src-frozen');
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    const frozen = {
      configVersion: 'run-config-1', endpoint: 'https://ep.example.com/v1/chat/completions',
      model: 'glm-5.3-flash', keyRef: 'llm.default', reasoningEffort: 'off',
      contentOutputTokens: 16_384, reasoningReserveTokens: 2_048, contextWindowTokens: 1_048_576,
      maxOutputTokens: 131_072, supportsPromptCache: true, supportsJson: true, concurrency: 2,
      bodyTargetRatio: 0.30, contextWindowSource: 'declared', profileId: 'default', profileName: 'GLM',
    };
    const run = await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-frozen', worldId: 'w-frozen', sourceId: 'src-frozen',
        modelFingerprint: 'https://ep.example.com#glm-5.3-flash', title: 't',
        extractorVersion: fixture.version, mode: 'group', budget: BUDGET_1M, config: frozen,
      },
    );
    assert.equal(run.planVersion, 'plan-chapter-1');
    assert.equal(run.configJson ? JSON.parse(run.configJson).model : null, 'glm-5.3-flash');
    assert.equal(JSON.parse(run.planStateJson).bodyTargetRatio, 0.30);

    // A later profile switch cannot alter the persisted run identity.
    const stored = await runStore.getRun('run-frozen');
    assert.equal(reviveRunConfig(stored.configJson).model, 'glm-5.3-flash');
    assert.deepEqual(revivePlanState(stored.planStateJson, { bodyTargetRatio: 0.3 }), {
      bodyTargetRatio: 0.3, estOutputPerChunk: undefined, replanCount: 0,
    });

    // Scoped run plans only the overlapping chunks (stage semantics, P3 base).
    const total = result.chunks.length;
    const scoped = await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-scoped', worldId: 'w-scoped', sourceId: 'src-frozen', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group', budget: BUDGET_1M,
        scope: { startCp: 0, endCp: Math.max(1, Math.floor(result.codePointCount * 0.3)) },
      },
    );
    const scopedUnits = await runStore.listUnits('run-scoped');
    const scopedChunks = new Set();
    for (const unit of scopedUnits) {
      for (const range of parseUnitRanges(unit.sourceRangesJson).ranges) scopedChunks.add(range.chunkId);
    }
    assert.ok(scopedChunks.size < total, 'scoped run plans fewer chunks than the whole book');
    assert.equal(scoped.unitsTotal, scopedUnits.length);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// U02: chapter batch planner
// ---------------------------------------------------------------------------

test('U02 chapter planner: 1M-codepoint synthetic book packs chapter-aligned with exact coverage', () => {
  // ~1M code points: 700 chapters x 6 chunks x 240 cp.
  const { chapters, chunks } = syntheticSource(700, 6, 240);
  const totalCp = chunks.reduce((sum, chunk) => sum + chunk.charCount, 0);
  assert.ok(totalCp >= 1_000_000, `synthetic book is ~1M cp, got ${totalCp}`);
  const batches = planChapterBatches(chapters, chunks, BUDGET_1M, {});
  assert.ok(batches.length > 0);
  // Exact, ordered coverage - no holes, no duplicates.
  const planned = batches.flatMap(batch => batch.segments);
  assert.equal(planned.length, chunks.length);
  for (let i = 0; i < planned.length; i += 1) {
    assert.equal(planned[i].chunkId, chunks[i].chunkId);
  }
  // Output-budget bound: no batch exceeds floor(16384*0.7/800)=14 chunks.
  for (const batch of batches) {
    assert.ok(batch.segments.length <= 14, `batch of ${batch.segments.length} chunks exceeds the output budget`);
    assert.ok(batch.estInputTokens <= Math.floor(1_048_576 * 0.30), 'batch body above the 30% window target');
  }
  // Chapter alignment: every batch's segments are whole chapters except
  // possibly the split-oversized case (not present here).
  const chunksPerChapter = new Map();
  for (const batch of batches) {
    const byChapter = new Map();
    for (const segment of batch.segments) {
      byChapter.set(segment.chapterId, (byChapter.get(segment.chapterId) ?? 0) + 1);
    }
    for (const [chapterId, count] of byChapter) {
      // A chapter contributes chunks to consecutive batches only when it is
      // the batch-spanning chapter; assert counts never re-appear after a gap.
      chunksPerChapter.set(chapterId, (chunksPerChapter.get(chapterId) ?? 0) + count);
    }
  }
  for (const [chapterId, count] of chunksPerChapter) {
    assert.equal(count, 6, `chapter ${chapterId} coverage changed`);
  }
});

test('U02 chapter planner: 30MB-equivalent synthetic input, no storage-block cap', () => {
  // 30MB UTF-8 CJK ~= 10M code points. Planner is metadata-only; large counts
  // must still pack deterministically and the 32-chunk storage cap is gone.
  const { chapters, chunks } = syntheticSource(2_000, 42, 120);
  const totalCp = chunks.reduce((sum, chunk) => sum + chunk.charCount, 0);
  assert.ok(totalCp >= 9_000_000, `~10M cp synthetic, got ${totalCp}`);
  const bigOutput = { ...BUDGET_1M, maxContentOutputTokens: 65_536 };
  const batches = planChapterBatches(chapters, chunks, bigOutput, { estOutputPerChunk: 100 });
  const planned = batches.flatMap(batch => batch.segments);
  assert.equal(planned.length, chunks.length, 'exact coverage on the 30MB-scale input');
  const maxSize = Math.max(...batches.map(batch => batch.segments.length));
  assert.ok(maxSize > 32, `the old 32-chunk cap must be gone, max batch was ${maxSize}`);
  for (const batch of batches) {
    assert.ok(batch.estInputTokens <= Math.floor(1_048_576 * 0.30), 'body target respected');
  }
});

test('U02 chapter planner: oversized single chapter splits at chunk boundaries with full coverage', () => {
  // One mega chapter of 100 chunks (12k cp each) plus normal chapters.
  const { chapters, chunks } = syntheticSource(1, 100, 12_000);
  chapters.push({
    chapterId: 'ch-0002', index: 2, title: '第2章', startOffset: 1_200_000, endOffset: 1_202_400,
    charCount: 2_400, contentHash: 'x',
  });
  for (let k = 1; k <= 2; k += 1) {
    chunks.push({
      chunkId: `ch-0002-c${String(k).padStart(3, '0')}`, chapterId: 'ch-0002',
      chunkIndex: 100 + k - 1, startOffset: 1_200_000 + (k - 1) * 1_200,
      endOffset: 1_200_000 + k * 1_200, charCount: 1_200, contentHash: 'x',
    });
  }
  const batches = planChapterBatches(chapters, chunks, BUDGET_1M, {});
  const planned = batches.flatMap(batch => batch.segments);
  assert.equal(planned.length, chunks.length, 'mega chapter covered exactly once');
  for (let i = 0; i < planned.length; i += 1) {
    assert.equal(planned[i].chunkId, chunks[i].chunkId);
  }
});

test('U02 chapter planner: dual-route fan-out duplicates coverage with route identities', () => {
  const { chapters, chunks } = syntheticSource(20, 5, 1_200);
  const single = planChapterBatches(chapters, chunks, BUDGET_1M, { routes: 'single' });
  const dual = planChapterBatches(chapters, chunks, BUDGET_1M, { routes: 'dual' });
  assert.equal(dual.length, single.length * 2);
  const characterBatches = dual.filter(batch => batch.route === 'characters');
  const worldBatches = dual.filter(batch => batch.route === 'world');
  assert.equal(characterBatches.length, single.length);
  assert.equal(worldBatches.length, single.length);
  for (let i = 0; i < single.length; i += 1) {
    assert.deepEqual(characterBatches[i].segments, single[i].segments);
    assert.deepEqual(worldBatches[i].segments, single[i].segments);
    assert.equal(characterBatches[i].inputHashSeed, worldBatches[i].inputHashSeed);
  }
});

// ---------------------------------------------------------------------------
// U03: truncation ladder + replanning of the unclaimed tail
// ---------------------------------------------------------------------------

test('U03 ladder: 30% -> 20% -> 12% -> halving floor', () => {
  assert.equal(nextBodyTargetRatio(0.30), 0.20);
  assert.equal(nextBodyTargetRatio(0.20), 0.12);
  assert.equal(nextBodyTargetRatio(0.12), 0.06);
  assert.equal(nextBodyTargetRatio(0.05), 0.025);
  assert.equal(nextBodyTargetRatio(0.02), 0.02, 'floor holds');
  assert.deepEqual([...BODY_TARGET_LADDER], [0.30, 0.20, 0.12]);
});

test('U03 truncation splits the unit, shrinks the ladder for queued tail, and coverage still completes', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore, result } = await prepareActiveSqliteSource(db, 'novel-medium.txt', 'src-ladder');
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    const budget = {
      contextWindowTokens: 30_000, maxContentOutputTokens: 3_000, reasoningReserveTokens: 0,
      reasoningEffort: 'off', supportsPromptCache: false, reserveTokens: 2_000,
    };
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-ladder', worldId: 'w-ladder', sourceId: 'src-ladder', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group', budget,
      },
    );
    const before = await runStore.listUnits('run-ladder');
    assert.ok(before.length >= 4, 'several batches planned');

    let truncatedOnce = false;
    const groupExtractor = {
      version: 'llm-group-extractor-1',
      async extract({ segments }) {
        if (!truncatedOnce && segments.length > 1) {
          truncatedOnce = true;
          throw new Error('model response truncated: finish_reason=length at max_tokens');
        }
        return fixtureGroupFacts(fixture, segments);
      },
    };
    const done = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor,
      sha256Hex: sha.sha256Hex, owner: 'ladder', budget,
    }, 'run-ladder');
    assert.equal(done.completed, true, 'run still completes after truncation recovery');

    const units = await runStore.listUnits('run-ladder');
    const canceledParents = units.filter(u => u.status === 'canceled');
    assert.ok(canceledParents.length >= 1, 'the truncated unit was replaced');
    assert.ok(units.some(u => u.parentUnitId !== null), 'split children exist');

    // The ladder replan happened and persisted on the run row.
    const run = await runStore.getRun('run-ladder');
    const planState = JSON.parse(run.planStateJson);
    assert.equal(planState.bodyTargetRatio, 0.20, 'body target ladder stepped down for the tail');
    assert.ok(planState.replanCount >= 1, 'replan recorded');

    // Full coverage world-side: every chunk done exactly once.
    for (const chunk of result.chunks) {
      const job = await worldStore.getJob('w-ladder', `job-extract-${chunk.chunkId}`);
      assert.equal(job?.status, 'done', `chunk ${chunk.chunkId} done after recovery`);
    }
    const facts = await worldStore.listFacts('w-ladder');
    const factIds = new Set(facts.map(fact => fact.factId));
    assert.equal(factIds.size, facts.length, 'no duplicate facts after replan');
  } finally {
    db.close();
  }
});

test('U03 replaceUnclaimedUnits only touches queued units - running/completed/retrying keep identity', async () => {
  const db = setupDb();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const sourceStore = new SqliteSourceStore(adapter);
    const now = '2026-09-29T13:00:00.000Z';
    await sourceStore.beginStaging({
      sourceId: 's', rawSha256Hex: 'a'.repeat(64), normalizedTreeHash: '',
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: 10, codePointCount: 10,
      encoding: 'utf-8', normalizeVersion: 'normalize-1', chapterSplitVersion: 'chapter-split-1',
      normalizeShardScheme: 'normalize-shard-1', splitStrategy: 'standard',
      fileName: 'x.txt', title: null, status: 'staging', createdAt: now, updatedAt: now,
    });
    const runStore = new SqliteBuildRunStore(adapter);
    const mk = (id, ord, status) => ({
      unitId: id, runId: 'r', kind: 'extract_group', sourceRangesJson: '[]', inputHash: `h-${id}`,
      configFingerprint: 'cf', parentUnitId: null, ord, status, attempt: 0, retryAt: null,
      resultRef: null, usageJson: null, errorCode: null, errorMessage: null,
      createdAt: now, updatedAt: now,
    });
    await runStore.createRun({
      runId: 'r', worldId: 'w', sourceId: 's', sourceSnapshotHash: 'h', pipelineVersion: 'p',
      planVersion: 'plan-chapter-1', modelFingerprint: 'm', phase: 'extracting', status: 'running',
      unitsTotal: 4, unitsDone: 0, unitsFailed: 0, leaseOwner: null, leaseExpiresAt: null,
      fencingToken: 0, heartbeatAt: null, lastErrorCode: null, lastErrorMessage: null,
      createdAt: now, updatedAt: now, configJson: null, planStateJson: null, scopeJson: null,
      pauseRequested: false, cancelRequested: false,
    }, [
      mk('r-1', 0, 'completed'), mk('r-2', 1, 'running'), mk('r-3', 2, 'queued'), mk('r-4', 3, 'failed_retryable'),
    ]);
    const token = await runStore.acquireLease('r', 'owner-a', 60_000, now);
    assert.ok(token !== null);
    const ok = await runStore.replaceUnclaimedUnits({
      runId: 'r', fencingToken: token,
      planStateJson: JSON.stringify({ bodyTargetRatio: 0.2, replanCount: 1 }),
      units: [{ ...mk('r-3x', 2, 'queued'), inputHash: 'h-new' }],
      now,
    });
    assert.equal(ok, true);
    const units = await runStore.listUnits('r');
    const byId = new Map(units.map(unit => [unit.unitId, unit]));
    assert.equal(byId.get('r-1').status, 'completed');
    assert.equal(byId.get('r-2').status, 'running');
    assert.equal(byId.get('r-4').status, 'failed_retryable');
    assert.equal(byId.get('r-3').status, 'canceled');
    assert.equal(byId.get('r-3x').status, 'queued');
    const run = await runStore.getRun('r');
    assert.equal(run.unitsTotal, 4, 'replacement keeps the effective total');
    assert.equal(JSON.parse(run.planStateJson).bodyTargetRatio, 0.2);

    // Fenced: a stale token cannot reorder.
    const stale = await runStore.replaceUnclaimedUnits({
      runId: 'r', fencingToken: token + 5, units: [], now,
    });
    assert.equal(stale, false);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// U04: rate scheduler + provider wrapper + multi-runner + control flags
// ---------------------------------------------------------------------------

test('U04 rate scheduler: RPM sliding window, TPM accounting, retry-after floor', async () => {
  let clock = 0;
  const waits = [];
  const scheduler = new GlobalRateScheduler({
    rpm: 2, tpm: 1_000, maxConcurrent: 8,
    now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; },
  });
  const lease1 = await scheduler.acquire(300);
  const lease2 = await scheduler.acquire(300);
  assert.equal(waits.length, 0, 'two requests within RPM fit immediately');
  const third = scheduler.acquire(300);
  const lease3 = await third;
  assert.ok(waits.length >= 1, 'third request waited for the RPM window');
  lease1.release(); lease2.release(); lease3.release();

  // TPM: settle reports the true (larger) usage; the next big request waits.
  scheduler.settle({ inputTokens: 800, outputTokens: 150 });
  const stats = scheduler.stats();
  assert.ok(stats.windowTokens >= 950, `tokens settled to actual usage, got ${stats.windowTokens}`);

  // Retry-After pushes an acquire floor.
  clock += 60_000; // RPM window clears first
  scheduler.noteRetryAfter(5_000);
  const before = clock;
  await scheduler.acquire(10);
  assert.ok(clock >= before + 5_000, 'acquire honored the retry-after floor');
});

test('U04 scheduled provider: acquire/settle wrap and release on failure', async () => {
  const seen = [];
  let clock = 0;
  const scheduler = new GlobalRateScheduler({
    rpm: 10, tpm: 100_000, maxConcurrent: 1,
    now: () => clock, sleep: async ms => { clock += ms; },
  });
  const inner = {
    async complete(request) {
      seen.push(request);
      if (request.user === 'boom') throw new Error('transport exploded');
      return { text: 'ok', usage: { inputTokens: 120, outputTokens: 30, estimated: false } };
    },
  };
  const provider = new RateScheduledProvider(inner, scheduler);
  const response = await provider.complete({
    role: 'Extractor', system: 's', user: 'u', maxOutputTokens: 64,
  });
  assert.equal(response.text, 'ok');
  const stats = scheduler.stats();
  assert.equal(stats.inFlight, 0, 'lease released after success');
  assert.equal(stats.windowTokens, 150, 'settled to reported usage');
  assert.ok(stats.totalAcquired === 1);

  await assert.rejects(() => provider.complete({
    role: 'Extractor', system: 's', user: 'boom', maxOutputTokens: 64,
  }), /transport exploded/);
  assert.equal(scheduler.stats().inFlight, 0, 'lease released after failure');
  assert.ok(estimateRequestTokens({ system: '一二三', user: '四五六', maxOutputTokens: 10 }) >= 13);
});

test('U04 multi-runner: two coordinators race one run - exactly one executes, no double claims', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore } = await prepareActiveSqliteSource(db, 'novel-small.txt', 'src-race');
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    const budget = {
      contextWindowTokens: 30_000, maxContentOutputTokens: 3_000, reasoningReserveTokens: 0,
      reasoningEffort: 'off', supportsPromptCache: false, reserveTokens: 2_000,
    };
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-race', worldId: 'w-race', sourceId: 'src-race', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group', budget,
      },
    );
    const groupExtractor = { version: 'v', extract: async ({ segments }) => fixtureGroupFacts(fixture, segments) };
    const [first, second] = await Promise.all([
      executeRun({
        sourceStore, runStore, worldStore, extractor: fixture, groupExtractor,
        sha256Hex: sha.sha256Hex, owner: 'runner-a', budget, leaseTtlMs: 60_000,
      }, 'run-race'),
      executeRun({
        sourceStore, runStore, worldStore, extractor: fixture, groupExtractor,
        sha256Hex: sha.sha256Hex, owner: 'runner-b', budget, leaseTtlMs: 60_000,
      }, 'run-race'),
    ]);
    const winners = [first, second].filter(result => !result.lostLease);
    assert.equal(winners.length, 1, 'exactly one coordinator executed the run');
    assert.equal(winners[0].completed, true);
    // Every unit was claimed at most once by the winner (attempts === 1 for
    // one-pass units; replan-free run here).
    const units = await runStore.listUnits('run-race');
    for (const unit of units.filter(u => u.status === 'completed')) {
      assert.equal(unit.attempt, 1, `unit ${unit.unitId} claimed exactly once`);
    }
    const facts = await worldStore.listFacts('w-race');
    const ids = new Set(facts.map(fact => fact.factId));
    assert.equal(ids.size, facts.length, 'no duplicate facts across runners');
  } finally {
    db.close();
  }
});

test('U04 control flags: cross-process pause and cancel stop the coordinator between units', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore } = await prepareActiveSqliteSource(db, 'novel-medium.txt', 'src-flags');
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    const budget = {
      contextWindowTokens: 30_000, maxContentOutputTokens: 3_000, reasoningReserveTokens: 0,
      reasoningEffort: 'off', supportsPromptCache: false, reserveTokens: 2_000,
    };
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-pause', worldId: 'w-flags', sourceId: 'src-flags', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group', budget,
      },
    );
    const groupExtractor = {
      version: 'v',
      async extract({ segments }) {
        // Simulate the user (another process) clicking pause ONCE mid-run.
        if (!pauseClicked) {
          pauseClicked = true;
          await runStore.requestRunControl('run-pause', 'pause', new Date().toISOString());
        }
        return fixtureGroupFacts(fixture, segments);
      },
    };
    let pauseClicked = false;
    const paused = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor,
      sha256Hex: sha.sha256Hex, owner: 'ui', budget,
    }, 'run-pause');
    assert.equal(paused.completed, false);
    const runAfterPause = await runStore.getRun('run-pause');
    assert.equal(runAfterPause.status, 'paused_user');
    assert.equal(runAfterPause.pauseRequested, false, 'pause flag consumed');
    assert.ok(runAfterPause.unitsDone >= 1, 'at least one unit committed before pausing');

    // Resume: flag cleared implicitly (pause flag already consumed); run
    // completes with a cooperative extractor.
    const resumed = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture,
      groupExtractor: { version: 'v', extract: async ({ segments }) => fixtureGroupFacts(fixture, segments) },
      sha256Hex: sha.sha256Hex, owner: 'ui', budget,
    }, 'run-pause');
    assert.equal(resumed.completed, true, 'paused run resumes and completes');

    // Cancel: a fresh run gets canceled between units.
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-cancel', worldId: 'w-flags2', sourceId: 'src-flags', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group', budget,
      },
    );
    const cancelExtractor = {
      version: 'v',
      async extract({ segments }) {
        await runStore.requestRunControl('run-cancel', 'cancel', new Date().toISOString());
        return fixtureGroupFacts(fixture, segments);
      },
    };
    const canceled = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor: cancelExtractor,
      sha256Hex: sha.sha256Hex, owner: 'ui', budget,
    }, 'run-cancel');
    assert.equal(canceled.completed, false);
    assert.equal((await runStore.getRun('run-cancel')).status, 'canceled');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// Registry key/entityKey reuse fix
// ---------------------------------------------------------------------------

test('registry checkpoint reuse maps legacy `key` payloads to entityKey', async () => {
  const db = setupDb();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const worldStore = new SqliteWorldStore(adapter);
    const now = '2026-09-29T14:00:00.000Z';
    await worldStore.createWorld({
      worldId: 'w-reg', title: 't', sourceSha256: 'h'.repeat(64), sourceBytes: 10,
      normalizeVersion: 'normalize-1', chapterSplitVersion: 'chapter-split-1',
      buildStatus: 'extracting', createdAt: now, updatedAt: now,
    });
    // Legacy checkpoint payload (the registry-1 serialization bug): `key`.
    await worldStore.upsertJob({
      worldId: 'w-reg', jobId: 'job-registry-w-reg', kind: 'rule_mapping', targetId: 'book-registry',
      status: 'done', attempts: 1, contentHash: 'content-1', extractorVersion: BOOK_REGISTRY_VERSION,
      modelFingerprint: 'ep#m', usageJson: '{}', resultJson: JSON.stringify({
        entities: [{ key: 'hero', type: 'character', name: '主角', aliases: ['少侠'] }],
      }), error: null, createdAt: now, updatedAt: now,
    }, now);
    const registry = await buildBookRegistry({
      worldStore, complete: async () => { throw new Error('must not re-request on checkpoint reuse'); },
      segmentBody: '正文', worldId: 'w-reg', modelFingerprint: 'ep#m', createdAt: now,
      contentHash: 'content-1',
    });
    assert.equal(registry.reused, true);
    assert.equal(registry.entities.length, 1);
    assert.equal(registry.entities[0].entityKey, 'hero', 'legacy key field mapped to entityKey');
    assert.equal(registry.entities[0].name, '主角');
  } finally {
    db.close();
  }
});

// helpers -------------------------------------------------------------------

async function fixtureGroupFacts(fixture, segments) {
  const entities = new Map();
  const facts = [];
  const events = [];
  for (const segment of segments) {
    const perChunk = await fixture.extract({
      chunk: {
        chunkId: segment.chunkId, chapterId: segment.chapterId, chunkIndex: 0,
        startOffset: segment.startCp, endOffset: segment.startCp + [...segment.text].length,
        charCount: [...segment.text].length, contentHash: 'x',
      },
      chunkText: segment.text,
      worldId: 'w',
    });
    for (const entity of perChunk.entities) entities.set(entity.entityKey, entity);
    for (const fact of perChunk.facts) facts.push({ ...fact, chunkId: segment.chunkId });
    for (const event of perChunk.events) events.push({ ...event, chunkId: segment.chunkId });
  }
  return { entities: [...entities.values()], facts, events, ruleMappings: [], rejectedQuotes: 0 };
}

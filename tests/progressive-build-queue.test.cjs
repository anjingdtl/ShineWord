'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LocalSourceSearchService } = require('../dist/application/search/localSourceSearch');
const { visibleEvidenceRanges } = require('../dist/application/progressiveBuild/progressiveTurnContext');
const { ProgressiveBuildQueue, StaleProgressiveBuildError } = require('../dist/application/progressiveBuild/progressiveBuildQueue');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function task(overrides = {}) {
  return {
    campaignId: 'campaign-a', branchId: 'branch-a', stateVersion: 1,
    priority: 'near_domain', dedupeKey: 'task-default',
    run: async () => 'done', ...overrides,
  };
}

test('visible source scope comes only from published entry citations visible at the story-time anchor', () => {
  const entries = [
    { entryId: 'public', visibility: 'public', provenance: { sourceFactIds: ['safe'] }, fieldProvenance: {} },
    { entryId: 'known-clue', visibility: 'discoverable', provenance: { sourceFactIds: ['clue'] }, fieldProvenance: {} },
    { entryId: 'private', visibility: 'gm', provenance: { sourceFactIds: ['secret'] }, fieldProvenance: {} },
  ];
  const fact = (factId, revealAt, startOffset) => ({ factId, status: 'explicit', validFrom: null,
    validTo: null, revealAt, sources: [{ chapterId: 'chapter-1', startOffset, endOffset: startOffset + 3 }] });
  const ranges = visibleEvidenceRanges(entries, [
    fact('safe', '1', 10), fact('clue', '1', 20), fact('secret', '1', 30), fact('future', '9', 40),
  ], 1);
  assert.deepEqual(ranges, [
    { chapterId: 'chapter-1', startCodePoint: 10, endCodePoint: 13 },
    { chapterId: 'chapter-1', startCodePoint: 20, endCodePoint: 23 },
  ]);
});

test('source search can index only published evidence ranges and never returns later source text', async () => {
  const sourceText = '青石巷的灯还亮着。\n后文秘密：NPC真实身份是密探。';
  const chars = Array.from(sourceText);
  const safeEnd = Array.from('青石巷的灯还亮着。').length;
  const readRanges = [];
  const sources = {
    getManifest: async () => ({ status: 'active', rawSha256Hex: 'source-v1', normalizedTreeHash: 'tree-v1' }),
    getChapters: async () => [{ chapterId: 'chapter-1', index: 0, startOffset: 0, endOffset: chars.length }],
    getChunks: async () => { throw new Error('scoped lookup must not scan the full source chunk list'); },
    readRange: async (_sourceId, start, end) => {
      readRanges.push([start, end]);
      return chars.slice(start, end).join('');
    },
  };
  const worlds = { listEntities: async () => [] };
  const lookup = await new LocalSourceSearchService(sources, worlds).search({
    sourceId: 'source-1', worldId: 'world-1', query: '青石巷灯', topK: 3,
    sourceRanges: [{ chapterId: 'chapter-1', startCodePoint: 0, endCodePoint: safeEnd }],
  });
  assert.equal(lookup.passages.length, 1);
  assert.equal(lookup.passages[0].text, '青石巷的灯还亮着。');
  assert.ok(!JSON.stringify(lookup).includes('密探'));
  assert.ok(readRanges.every(([start, end]) => start >= 0 && end <= safeEnd));
});

test('queue pauses background work during foreground play and runs current action before near and active lookup', async () => {
  const queue = new ProgressiveBuildQueue();
  const started = [];
  queue.setForegroundBusy(true);
  const near = queue.enqueue(task({ priority: 'near_domain', dedupeKey: 'near', run: async () => { started.push('near'); return 'near'; } }));
  const book = queue.enqueue(task({ priority: 'active_book_lookup', dedupeKey: 'book', run: async () => { started.push('book'); return 'book'; } }));
  assert.deepEqual(started, []);
  const current = await queue.enqueue(task({ priority: 'current_action', dedupeKey: 'current', run: async () => {
    started.push('current'); return 'current';
  } }));
  assert.equal(current, 'current');
  assert.deepEqual(started, ['current']);
  queue.setForegroundBusy(false);
  assert.deepEqual(await Promise.all([near, book]), ['near', 'book']);
  assert.deepEqual(started, ['current', 'near', 'book']);
});

test('queue deduplicates identical work and caches a completed result', async () => {
  const queue = new ProgressiveBuildQueue();
  const gate = deferred();
  let calls = 0;
  const first = queue.enqueue(task({ dedupeKey: 'same', run: async () => { calls += 1; await gate.promise; return { value: 7 }; } }));
  const second = queue.enqueue(task({ dedupeKey: 'same', run: async () => { calls += 100; return null; } }));
  await new Promise(resolve => setImmediate(resolve));
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [{ value: 7 }, { value: 7 }]);
  assert.equal(await queue.enqueue(task({ dedupeKey: 'same', run: async () => { calls += 100; return null; } })).then(result => result.value), 7);
  assert.equal(calls, 1);
});

test('current action preempts a late near-domain result and stale state results are fenced', async () => {
  const queue = new ProgressiveBuildQueue();
  let nearAborted = false;
  const near = queue.enqueue(task({ priority: 'near_domain', dedupeKey: 'near-late', run: async ({ signal }) => {
    await new Promise(resolve => signal.addEventListener('abort', () => { nearAborted = true; resolve(); }, { once: true }));
    return 'late near result';
  } }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await queue.enqueue(task({ priority: 'current_action', dedupeKey: 'current-now', run: async () => 'current' })), 'current');
  await assert.rejects(near, error => error.name === 'AbortError');
  assert.equal(nearAborted, true);

  let staleTaskRan = false;
  await assert.rejects(queue.enqueue(task({ dedupeKey: 'stale', isCurrent: () => false, run: async () => {
    staleTaskRan = true; return 'stale';
  } })), StaleProgressiveBuildError);
  assert.equal(staleTaskRan, false);
});

test('queue bounds top-k source input and enforces per-task and ten-turn provider budgets', async () => {
  const queue = new ProgressiveBuildQueue();
  let sizes;
  await queue.enqueue(task({ sourcePassages: ['😀'.repeat(1_250), '乙'.repeat(1_200), '丙'.repeat(1_200), '不应带入'],
    dedupeKey: 'bounded-input', run: async context => {
      sizes = context.sourcePassages.map(value => Array.from(value).length);
      assert.equal(context.sourcePassages.length, 3);
      context.consumeProviderRequest(1_200);
      context.consumeProviderRequest(1_200);
      return 'bounded';
    } }));
  assert.deepEqual(sizes, [1_200, 1_200, 1_200]);

  const budgetQueue = new ProgressiveBuildQueue();
  for (let index = 0; index < 3; index += 1) {
    await budgetQueue.enqueue(task({ stateVersion: index + 1, dedupeKey: `budget-${index}`,
      run: async context => { context.consumeProviderRequest(1_200); return index; } }));
  }
  await assert.rejects(budgetQueue.enqueue(task({ stateVersion: 10, dedupeKey: 'budget-overflow',
    run: async context => { context.consumeProviderRequest(1_200); return 'should not fit'; } })), /ten-turn model budget/);
  assert.equal(await budgetQueue.enqueue(task({ stateVersion: 11, dedupeKey: 'next-budget-window',
    run: async context => { context.consumeProviderRequest(1_200); return 'next window'; } })), 'next window');
  await assert.rejects(budgetQueue.enqueue(task({ stateVersion: 12, dedupeKey: 'request-cap',
    run: async context => { context.consumeProviderRequest(1_200); context.consumeProviderRequest(1_200); context.consumeProviderRequest(1_200); return 'too many'; } })), /physical-request budget/);
  await assert.rejects(budgetQueue.enqueue(task({ stateVersion: 12, dedupeKey: 'output-cap',
    run: async context => { context.consumeProviderRequest(1_201); return 'too much'; } })), /output budget/);
});

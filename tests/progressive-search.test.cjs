'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { CodePointOffsetIndex } = require('../dist/domain/world/textOffsets');
const {
  buildLocalSourceSearchIndex,
  LocalSourceSearchIndexBuilder,
  normalizeSearchText,
  searchLocalSource,
  tokenizeChineseSearchText,
} = require('../dist/application/search/chineseSourceSearch');
const { LocalSourceSearchService } = require('../dist/application/search/localSourceSearch');
const { probeFts5 } = require('../dist/infra/sqlite/ftsCapability');

function sourceChunk(chunkId, chapterId, chapterIndex, chunkIndex, startCodePoint, text) {
  const length = Array.from(text).length;
  return { chunkId, chapterId, chapterIndex, chunkIndex, startCodePoint,
    endCodePoint: startCodePoint + length, contentHash: `hash-${chunkId}`, text };
}

test('Chinese bigrams and Latin words are explicit and independent of SQLite tokenizer behavior', () => {
  const tokens = tokenizeChineseSearchText('白篱梦，GLM-5.3！');
  assert.ok(tokens.includes('b:白篱'));
  assert.ok(tokens.includes('b:篱梦'));
  assert.ok(tokens.includes('w:glm'));
  assert.ok(tokens.includes('w:5'));
  assert.equal(normalizeSearchText('沈砚（沈公子）'), '沈砚沈公子');
});

test('incremental postings match the batch index and aliases resolve locally', () => {
  const chunks = [
    sourceChunk('c1', 'chapter-1', 0, 0, 0, '青石巷夜里很静。\n沈砚走进青石巷。\n门边放着一把旧伞。'),
    sourceChunk('c2', 'chapter-2', 1, 0, 100, '翌日，沈砚到了城门。\n城门尚未开启。'),
  ];
  const entities = [{ entityId: 'shen-yan', name: '沈砚', aliases: ['沈公子'] }];
  const builder = new LocalSourceSearchIndexBuilder(entities);
  for (const chunk of chunks) builder.addChunk(chunk);
  const incremental = builder.finish();
  const batched = buildLocalSourceSearchIndex({ chunks, entities });
  assert.deepEqual(incremental.paragraphs, batched.paragraphs);
  assert.deepEqual([...incremental.postings].map(([term, docs]) => [term, [...docs]]),
    [...batched.postings].map(([term, docs]) => [term, [...docs]]));

  const aliasSearch = searchLocalSource(incremental, { query: '沈公子现在在哪里？' });
  assert.ok(aliasSearch.resolvedEntityIds.includes('shen-yan'));
  assert.ok(aliasSearch.hits.some(hit => hit.matchedEntityIds.includes('shen-yan')));
  assert.equal(aliasSearch.hasMatches, true);
});

test('unknown terms report no local match without claiming that a fact is absent', () => {
  const index = buildLocalSourceSearchIndex({ chunks: [
    sourceChunk('c1', 'chapter-1', 0, 0, 0, '青石巷夜里很静。'),
  ] });
  const result = searchLocalSource(index, { query: '天外飞仙的秘密' });
  assert.equal(result.hasMatches, false);
  assert.deepEqual(result.hits, []);
  assert.equal(Object.hasOwn(result, 'factAbsent'), false);
  assert.equal(Object.hasOwn(result, 'notFoundInSource'), false);
});

test('code-point offsets preserve astral characters and adjacent prefetch never crosses chapters', () => {
  const first = sourceChunk('c1', 'chapter-1', 0, 0, 20, '😀白篱梦开门。\n沈砚进门。');
  const second = sourceChunk('c2', 'chapter-2', 1, 0, 100, '后日城门紧闭。');
  const index = buildLocalSourceSearchIndex({ chunks: [first, second] });
  const hit = searchLocalSource(index, { query: '城门紧闭' });
  assert.equal(hit.hits.length, 1);
  assert.equal(hit.hits[0].startCodePoint, 100);
  const source = new CodePointOffsetIndex(first.text);
  assert.equal(source.slice(0, 1), '😀');
  assert.equal(first.endCodePoint - first.startCodePoint, Array.from(first.text).length);
  assert.ok(hit.adjacentPrefetch.every(item => item.chapterId === 'chapter-2'));
  assert.equal(hit.adjacentPrefetch.length, 0, 'no neighboring paragraph exists in that chapter');
});

test('local source service streams chunks, returns bounded passages, and invalidates cache on alias or source revision changes', async () => {
  const rawText = '青石巷夜里很静。\n沈砚走进青石巷。\n门边放着一把旧伞。\n翌日，沈砚到了城门。\n城门尚未开启。';
  const offset = new CodePointOffsetIndex(rawText);
  const splitAt = Array.from('青石巷夜里很静。\n沈砚走进青石巷。\n门边放着一把旧伞。\n').length;
  const chunks = [
    { chunkId: 'c1', chapterId: 'chapter-1', chunkIndex: 0, startOffset: 0, endOffset: splitAt,
      charCount: splitAt, contentHash: 'h1' },
    { chunkId: 'c2', chapterId: 'chapter-2', chunkIndex: 0, startOffset: splitAt,
      endOffset: offset.codePointCount, charCount: offset.codePointCount - splitAt, contentHash: 'h2' },
  ];
  let rawSha256Hex = 'source-v1';
  let aliases = ['沈公子'];
  let rangeReads = 0;
  const sources = {
    getManifest: async () => ({ status: 'active', rawSha256Hex, normalizedTreeHash: 'tree-v1' }),
    getChapters: async () => [
      { chapterId: 'chapter-1', index: 0 }, { chapterId: 'chapter-2', index: 1 },
    ],
    getChunks: async () => chunks,
    readRange: async (_sourceId, from, to) => {
      rangeReads += 1;
      return offset.slice(from, to);
    },
  };
  const worlds = { listEntities: async () => [
    { entityId: 'shen-yan', name: '沈砚', aliases },
  ] };
  const service = new LocalSourceSearchService(sources, worlds);

  const first = await service.search({ sourceId: 'source-1', worldId: 'world-1', query: '沈砚' });
  assert.ok(first.passages.length > 0);
  assert.ok(first.passages.every(passage => passage.text.length < 40));
  const readsAfterFirstBuild = rangeReads;
  await service.search({ sourceId: 'source-1', worldId: 'world-1', query: '沈砚' });
  assert.equal(rangeReads - readsAfterFirstBuild, 4,
    'a cache hit performs only bounded passage and same-chapter prefetch reads, not a full rebuild');

  aliases = ['沈家公子'];
  const afterAliasChange = await service.search({ sourceId: 'source-1', worldId: 'world-1', query: '沈家公子' });
  assert.ok(afterAliasChange.result.resolvedEntityIds.includes('shen-yan'));
  const readsAfterAliasRebuild = rangeReads;
  rawSha256Hex = 'source-v2';
  await service.search({ sourceId: 'source-1', worldId: 'world-1', query: '沈砚' });
  assert.ok(rangeReads - readsAfterAliasRebuild >= chunks.length,
    'a source revision invalidates the cached index');
});

test('SQLite FTS5 capability probe detects support without using its tokenizer policy', async () => {
  const db = new DatabaseSync(':memory:');
  const adapter = {
    execute: async sql => { db.exec(sql); },
    queryOne: async () => null,
    queryAll: async () => [],
    transaction: async work => work(adapter),
  };
  try {
    assert.equal(await probeFts5(adapter), true);
  } finally {
    db.close();
  }
  const unsupported = {
    execute: async sql => { if (sql.includes('CREATE VIRTUAL TABLE')) throw new Error('no FTS module'); },
    queryOne: async () => null,
    queryAll: async () => [],
    transaction: async work => work(unsupported),
  };
  assert.equal(await probeFts5(unsupported), false);
});

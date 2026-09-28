'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeWorldPreparation, sourceRangesCoverWholeText } = require('../dist/application/worldPackage/preparationStatus');

const hash = 'a'.repeat(64);

function fact(factId) {
  return { worldId: 'w', factId, subjectEntityId: 'e', predicate: 'known', value: {},
    status: 'explicit', confidence: 1, validFrom: null, validTo: null, revealAt: null, scope: 'world', sources: [] };
}

function entry(entryId, sourceFactIds = []) {
  return { entryId, kind: 'lore', revision: 1,
    provenance: { kind: sourceFactIds.length ? 'explicit' : 'design_fill', sourceFactIds, rationale: 'test' },
    fieldProvenance: {}, visibility: 'public', dependencyIds: [], definition: { name: entryId, text: entryId } };
}

function chunk(chunkId, extractionStatus, startOffset = 0, endOffset = 1) {
  return { worldId: 'w', chunkId, chapterId: 'c', chunkIndex: 0, startOffset, endOffset,
    charCount: endOffset - startOffset, contentHash: hash, extractionStatus };
}

test('tri-state reports scoped organization, known unmapped material and a completed no-hit book separately', () => {
  const partial = summarizeWorldPreparation({
    manifest: { revision: 1, buildScope: { strategy: 'progressive', scope: 'opening', completeness: 'partial',
      sourceRanges: [{ startCodePoint: 0, endCodePoint: 1, contentSha256: hash }] } },
    entries: [entry('opening-lore', ['f1']), entry('core-skill')],
    sections: [
      { book: 'player_handbook', sectionKey: 'world', title: 'World', entryIds: ['opening-lore', 'core-skill'], position: 0 },
      { book: 'gm_guide', sectionKey: 'npcs', title: 'NPCs', entryIds: [], position: 0 },
      { book: 'monster_manual', sectionKey: 'creatures', title: 'Creatures', entryIds: [], position: 0 },
    ],
    facts: [fact('f1'), fact('f2')],
    chunks: [chunk('c1', 'extracted'), chunk('c2', 'pending')],
  });
  assert.equal(partial.books.find(book => book.book === 'player_handbook').state, 'organized');
  assert.equal(partial.books.find(book => book.book === 'gm_guide').state, 'unorganized');
  assert.equal(partial.books.find(book => book.book === 'monster_manual').state, 'unorganized');
  assert.equal(partial.unmappedFactCount, 1);
  assert.equal(partial.fullSourceComplete, false);

  const complete = summarizeWorldPreparation({
    manifest: { revision: 2, buildScope: { strategy: 'full', scope: 'whole_source', completeness: 'complete',
      sourceRanges: [
        { startCodePoint: 0, endCodePoint: 2, contentSha256: hash },
      ] } },
    entries: [entry('full-lore', ['f1'])],
    sections: [{ book: 'player_handbook', sectionKey: 'world', title: 'World', entryIds: ['full-lore'], position: 0 }],
    facts: [fact('f1')],
    chunks: [chunk('c1', 'extracted', 0, 1), chunk('c2', 'extracted', 1, 2)],
    sourceCodePointCount: 2,
  });
  assert.equal(complete.fullSourceComplete, true);
  assert.equal(complete.books.find(book => book.book === 'gm_guide').state, 'not_found');
  assert.equal(complete.books.find(book => book.book === 'monster_manual').state, 'not_found');
});

test('a package claiming whole-source completion is not complete while source chunks remain', () => {
  const status = summarizeWorldPreparation({
    manifest: { revision: 2, buildScope: { strategy: 'full', scope: 'whole_source', completeness: 'complete',
      sourceRanges: [
        { startCodePoint: 0, endCodePoint: 2, contentSha256: hash },
      ] } },
    entries: [], sections: [], facts: [],
    chunks: [chunk('c1', 'extracted', 0, 1), chunk('c2', 'failed', 1, 2)],
    sourceCodePointCount: 2,
  });
  assert.equal(status.fullSourceComplete, false);
  assert.equal(status.failedChunkCount, 1);
});

test('whole-source completeness requires contiguous source coverage and extracted chunks inside it', () => {
  assert.equal(sourceRangesCoverWholeText([
    { startCodePoint: 1, endCodePoint: 2 },
    { startCodePoint: 0, endCodePoint: 1 },
  ], 2), true);
  assert.equal(sourceRangesCoverWholeText([
    { startCodePoint: 0, endCodePoint: 1 },
    { startCodePoint: 2, endCodePoint: 3 },
  ], 3), false);
  assert.equal(sourceRangesCoverWholeText([
    { startCodePoint: 0, endCodePoint: 2 },
    { startCodePoint: 1, endCodePoint: 3 },
  ], 3), false);

  const status = summarizeWorldPreparation({
    manifest: { revision: 2, buildScope: { strategy: 'full', scope: 'whole_source', completeness: 'complete',
      sourceRanges: [
        { startCodePoint: 0, endCodePoint: 1, contentSha256: hash },
      ] } },
    entries: [], sections: [], facts: [],
    chunks: [chunk('c1', 'extracted', 0, 1), chunk('c2', 'extracted', 1, 2)],
    sourceCodePointCount: 2,
  });
  assert.equal(status.fullSourceComplete, false, 'a scope ending before the source end is not complete');
});

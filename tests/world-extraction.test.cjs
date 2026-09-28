const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  applyExtraction,
  checkEvidence,
  entityIdFor,
} = require('../dist/application/world/extraction');
const {
  proposeEntityMerges,
  planEntityMerge,
} = require('../dist/application/world/entityMerge');
const {
  buildOpening,
  canonFactsVisibleAt,
} = require('../dist/application/world/opening');
const { importTxtSource } = require('../dist/application/import/txtImport');
const { CodePointOffsetIndex } = require('../dist/domain/world/textOffsets');
const { LlmChunkExtractor } = require('../dist/application/world/llmExtractor');

const sha = {
  async sha256BytesHex(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex');
  },
  async sha256Hex(input) {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  },
};

const decoder = {
  decode(bytes, encoding) {
    return new TextDecoder(encoding === 'utf-8-sig' ? 'utf-8' : encoding).decode(bytes);
  },
};

async function loadSmallParsed() {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'novel-small.txt'));
  return importTxtSource(bytes, sha, decoder);
}

test('LLM extractor leaves reasoning-enabled models room for sourced facts', async () => {
  const parsed = await loadSmallParsed();
  let request;
  const extractor = new LlmChunkExtractor(async input => {
    request = input;
    return { text: JSON.stringify({ entities: [], facts: [], events: [], ruleMappings: [] }) };
  });
  await extractor.extract({ chunk: parsed.chunks[0], chunkText: '', worldId: 'w-budget' });
  assert.equal(request.role, 'Extractor');
  assert.equal(request.maxOutputTokens, 8000,
    'the default remains below the configured 8192-token profile cap while leaving room after reasoning');
  assert.equal(request.jsonMode, true);
  assert.equal(request.vendorOptions?.thinkingDisabled, undefined,
    'the extractor never opts out of reasoning to reclaim output tokens');
});

test('evidence validation rejects tampered quotes and out-of-chapter spans', async () => {
  const parsed = await loadSmallParsed();
  const index = new CodePointOffsetIndex(parsed.text);
  const chapterIndex = new Map(parsed.chapters.map(c => [c.chapterId, { start: c.startOffset, end: c.endOffset }]));

  const quote = '陈青云居住在青岚山脚下的青云院';
  const absStart = parsed.text.indexOf(quote);
  const cpStart = index.utf16IndexOf(absStart);
  const cpEnd = cpStart + quote.length;

  const ok = checkEvidence(
    { subjectKey: '陈青云', predicate: 'home_location', value: {}, status: 'explicit', confidence: 1, evidence: { chapterId: 'ch-0001', startOffset: cpStart, endOffset: cpEnd, quote } },
    parsed,
    chapterIndex,
    index,
  );
  assert.equal(ok.ok, true);

  const wrongQuote = checkEvidence(
    { subjectKey: '陈青云', predicate: 'home_location', value: {}, status: 'explicit', confidence: 1, evidence: { chapterId: 'ch-0001', startOffset: cpStart, endOffset: cpEnd, quote: '篡改过的引文' } },
    parsed,
    chapterIndex,
    index,
  );
  assert.equal(wrongQuote.ok, false);

  const shiftedSpan = checkEvidence(
    { subjectKey: '陈青云', predicate: 'home_location', value: {}, status: 'explicit', confidence: 1, evidence: { chapterId: 'ch-0001', startOffset: cpStart + 1, endOffset: cpEnd + 1, quote } },
    parsed,
    chapterIndex,
    index,
  );
  assert.equal(shiftedSpan.ok, false);

  const outsideChapter = checkEvidence(
    { subjectKey: '陈青云', predicate: 'home_location', value: {}, status: 'explicit', confidence: 1, evidence: { chapterId: 'ch-0002', startOffset: cpStart, endOffset: cpEnd, quote } },
    parsed,
    chapterIndex,
    index,
  );
  assert.equal(outsideChapter.ok, false);
});

test('applyExtraction preserves speculation status and rejects unevidenced facts', async () => {
  const parsed = await loadSmallParsed();
  const quote = '柳无痕其实是离火教的人';
  const absStart = parsed.text.indexOf(quote);
  const index = new CodePointOffsetIndex(parsed.text);
  const cpStart = index.utf16IndexOf(absStart);

  const resolved = await applyExtraction({
    worldId: 'w-ex',
    parsed,
    createdAt: '2026-09-27T00:00:00.000Z',
    sha256Hex: sha.sha256Hex,
    extraction: {
      entities: [
        { entityKey: '柳无痕', type: 'character', name: '柳无痕' },
        { entityKey: '离火教', type: 'faction', name: '离火教' },
      ],
      facts: [
        {
          subjectKey: '柳无痕',
          predicate: 'faction_member',
          value: { faction: '离火教' },
          status: 'speculation',
          confidence: 0.5,
          evidence: { chapterId: 'ch-0002', startOffset: cpStart, endOffset: cpStart + quote.length, quote },
        },
        {
          subjectKey: '柳无痕',
          predicate: 'owns_item',
          value: { item: '不存在之物' },
          status: 'explicit',
          confidence: 1,
          evidence: { chapterId: 'ch-0002', startOffset: cpStart, endOffset: cpStart + 3, quote: '完全不是' },
        },
      ],
      events: [],
      ruleMappings: [],
    },
  });

  assert.equal(resolved.facts.length, 1);
  assert.equal(resolved.facts[0].status, 'speculation', 'speculation must never be promoted to canon');
  assert.equal(resolved.rejected.length, 1);
  assert.equal(resolved.rejected[0].kind, 'evidence');
  assert.match(resolved.facts[0].sources[0].quoteSha256, /^[0-9a-f]{64}$/);
  assert.equal(resolved.entities[0].entityId, entityIdFor('w-ex', '柳无痕'));
});

test('entity merge proposes candidates deterministically and never auto-merges', () => {
  const entity = (id, name, aliases, type = 'character') => ({
    worldId: 'w', entityId: id, type, name, firstSeenChapterId: null, aliases,
  });

  const existing = [entity('e1', '陈青云', ['一阵风']), entity('e2', '青岚派', [], 'faction')];
  const incoming = [entity('e3', '陈青云', []), entity('e4', '青云', [])];

  const candidates = proposeEntityMerges(existing, incoming);
  const exact = candidates.find(candidate => candidate.secondaryEntityId === 'e3');
  assert.ok(exact, 'same-name same-type entity must be proposed');
  assert.equal(exact.score, 1.0);
  assert.equal(exact.basis, 'exact_name');
  assert.ok(!candidates.some(candidate => candidate.primaryEntityId === 'e2' || candidate.secondaryEntityId === 'e2'),
    'different types must never be proposed');

  // The plan forbids auto-merging on name equality: merging is explicit.
  const plan = planEntityMerge(existing[0], [incoming[0]]);
  assert.deepEqual(plan.absorbedEntityIds, ['e3']);
  assert.ok(!plan.aliasAdditions.includes('陈青云'), 'primary name must not become its own alias');
  assert.deepEqual(plan.aliasAdditions, []);

  assert.throws(() => planEntityMerge(existing[0], [entity('e9', '青岚派', [], 'faction')]),
    /Cannot merge/);
});

test('original character opening distributes 4 free points with single cap 3', () => {
  const { profile, snapshot } = buildOpening({
    branchId: 'b1',
    actorId: 'actor-new',
    displayName: '无名小卒',
    kind: 'original',
    freeAttributePoints: { agility: 2, physique: 1, insight: 1 },
  }, { facts: [], mappings: [] });

  assert.equal(profile.kind, 'original');
  assert.equal(profile.attributes.agility, 3);
  assert.equal(profile.attributes.physique, 2);
  assert.equal(profile.attributes.insight, 2);
  assert.equal(profile.attributes.willpower, 1);
  assert.equal(snapshot.actors['actor-new'].locationId, 'unset');

  assert.throws(() => buildOpening({
    branchId: 'b1',
    actorId: 'a',
    displayName: 'x',
    kind: 'original',
    freeAttributePoints: { agility: 2, physique: 2, insight: 1 },
  }, { facts: [], mappings: [] }), /Free attribute points exceeded/);

  assert.throws(() => buildOpening({
    branchId: 'b1',
    actorId: 'a',
    displayName: 'x',
    kind: 'original',
    freeAttributePoints: { agility: 3 },
  }, { facts: [], mappings: [] }), /must be an integer between 0 and 2/);
});

test('canon character opening derives location and only mapped skills, never speculation', async () => {
  const parsed = await loadSmallParsed();
  const resolved = await applyExtraction({
    worldId: 'w-can',
    parsed,
    createdAt: 't',
    sha256Hex: sha.sha256Hex,
    extraction: {
      entities: [
        { entityKey: '陈青云', type: 'character', name: '陈青云' },
        { entityKey: '黑风客栈', type: 'location', name: '黑风客栈' },
      ],
      facts: [],
      events: [],
      ruleMappings: [],
    },
  });
  const entity = resolved.entities[0];

  const locationFact = {
    worldId: 'w-can',
    factId: 'f-loc',
    subjectEntityId: entity.entityId,
    predicate: 'current_location',
    value: { location: '黑风客栈' },
    status: 'explicit',
    confidence: 1,
    validFrom: null,
    validTo: null,
    revealAt: null,
    scope: 'world',
    sources: [],
  };
  const speculatedSkillFact = {
    ...locationFact,
    factId: 'f-skill',
    predicate: 'skill',
    value: { skill: '飞升之术' },
    status: 'speculation',
  };

  const mappings = [{
    worldId: 'w-can',
    mappingId: 'm1',
    targetEntityId: entity.entityId,
    mappingKind: 'skill',
    mapping: { skillId: 'sword', rank: 'trained' },
    evidenceRefs: ['f-loc'],
    rulesetVersion: '0.1.0',
    status: 'active',
  }];

  const { profile, snapshot, startLocation } = buildOpening({
    branchId: 'b-canon',
    actorId: 'actor-chen',
    displayName: '陈青云',
    kind: 'canon',
    worldTimeOrder: 5,
    canonEntity: entity,
  }, { facts: [locationFact, speculatedSkillFact], mappings });

  // Missing anchor: canon openings are refused instead of silently reading
  // the whole timeline.
  assert.throws(
    () => buildOpening({
      branchId: 'b-canon', actorId: 'actor-chen', displayName: '陈青云',
      kind: 'canon', canonEntity: entity,
    }, { facts: [locationFact], mappings }),
    /worldTimeOrder/,
  );

  // Late-story evidence cannot leak into an early anchor: the sword mapping
  // cites a fact only valid from order 8, so at anchor 5 the skill is gone.
  const lateEvidence = { ...locationFact, factId: 'f-late-sword', validFrom: '8' };
  const lateMapping = { ...mappings[0], evidenceRefs: ['f-late-sword'] };
  const early = buildOpening({
    branchId: 'b-canon', actorId: 'actor-chen', displayName: '陈青云',
    kind: 'canon', worldTimeOrder: 5, canonEntity: entity,
  }, { facts: [locationFact, lateEvidence], mappings: [lateMapping] });
  assert.deepEqual(early.profile.skillRanks, {}, 'evidence after the anchor grants nothing');

  assert.equal(startLocation, '黑风客栈');
  assert.equal(snapshot.actors['actor-chen'].locationId, '黑风客栈');
  assert.deepEqual(profile.skillRanks, { sword: 'trained' });
  assert.equal(profile.attributes.physique, 1, 'unmapped attributes default to base 1');
  assert.ok(profile.evidenceFactIds.includes('f-loc'));

  // Temporal filter: future facts are invisible at earlier world time, and
  // expired facts (validTo in the past) are invisible at later times.
  const futureFact = { ...locationFact, factId: 'f-future', validFrom: '10' };
  assert.deepEqual(canonFactsVisibleAt([locationFact, futureFact], 3), [locationFact]);
  const expiredFact = { ...locationFact, factId: 'f-expired', validTo: '2' };
  assert.deepEqual(canonFactsVisibleAt([locationFact, expiredFact], 3), [locationFact]);
  // Not-yet-revealed facts stay hidden (foresight block).
  const unrevealedFact = { ...locationFact, factId: 'f-secret', revealAt: '9' };
  assert.deepEqual(canonFactsVisibleAt([locationFact, unrevealedFact], 3), [locationFact]);
});

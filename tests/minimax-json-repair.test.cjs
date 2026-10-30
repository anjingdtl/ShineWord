/**
 * MiniMax-class vendor JSON artifact repair (final-closeout V1.1.1, R4).
 *
 * Real-device evidence (2026-10-29 captures): MiniMax-M3.1-Flash deterministically
 * emits HTTP-200/finish=stop extraction responses with two GLM/DeepSeek-invisible
 * artifacts — a dropped key closing quote ("quote:v") and a missing nested-object
 * closing brace ("mapping":{"functions":[...],"evidenceQuotes":[...]}). The repair
 * is syntactic-only, whitelist-bound, and runs after strict parsing fails; every
 * downstream validator (verbatim quote, evidence closure) stays untouched.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  repairDroppedKeyClosingQuote,
  repairVendorStructuralArtifacts,
} = require('../dist/application/llm/responseNormalizer');
const { parseStructuredOutput } = require('../dist/application/llm/structuredOutput');
const {
  EXTRACTION_STRUCTURAL_REPAIR,
  evidenceRefsFromCandidate,
  parseExtractorJson,
} = require('../dist/application/world/llmExtractor');
const { LlmGroupExtractor } = require('../dist/application/world/llmGroupExtractor');

const VOCAB = EXTRACTION_STRUCTURAL_REPAIR.vocabulary;

test('form-A repair restores only whitelisted schema keys', () => {
  const malformed = '{"facts":[{"subject":"a","quote:"x","status":"explicit"}],"count":1}';
  const repaired = repairDroppedKeyClosingQuote(malformed, VOCAB);
  assert.equal(repaired, '{"facts":[{"subject":"a","quote":"x","status":"explicit"}],"count":1}');
  assert.deepEqual(JSON.parse(repaired).facts[0], { subject: 'a', quote: 'x', status: 'explicit' });
  // A non-vocabulary key with the same artifact shape stays untouched:
  const foreign = '{"mystery:"value","facts":[]}';
  assert.equal(repairDroppedKeyClosingQuote(foreign, VOCAB), '{"mystery:"value","facts":[]}');
});

test('form-B repair inserts the missing brace at the element boundary comma', () => {
  // The captured artifact shape: a nested mapping object loses its closer, the
  // element-level evidence key lands inside it, the stray element closer is
  // consumed by the mapping, and the next element opener breaks the parse.
  const artifact = '{"ruleMappings":['
    + '{"target":"ent-a","kind":"skill","mapping":{"id":"s1","levels":["low","high"],"evidenceQuotes":["level one"]},'
    + '{"target":"ent-b","kind":"attribute","mapping":{"id":"a1","scale":["low"]},"evidenceQuotes":["scale one"]}'
    + ']}';
  assert.throws(() => JSON.parse(artifact), /Expected double-quoted property name|Unexpected token/,
    'the artifact must be invalid JSON before repair');
  const repaired = repairVendorStructuralArtifacts(artifact, EXTRACTION_STRUCTURAL_REPAIR);
  assert.ok(repaired !== null, 'artifact must be repaired');
  const parsed = JSON.parse(repaired);
  assert.equal(parsed.ruleMappings.length, 2);
  assert.equal(parsed.ruleMappings[1].target, 'ent-b');
});

test('repair composes with parseStructuredOutput and is opt-in per caller', () => {
  const artifact = '{"entities":[{"key:"hero","type":"character","name":"Hero"}]}';
  assert.throws(() => parseStructuredOutput(artifact, { label: 'x' }),
    /JSON appears truncated|no JSON|could not be parsed/,
    'callers without structuralRepair keep the strict behaviour');
  const { value, repairSteps } = parseStructuredOutput(artifact, {
    label: 'x', structuralRepair: EXTRACTION_STRUCTURAL_REPAIR,
  });
  assert.equal(value.entities[0].key, 'hero');
  assert.ok(repairSteps.includes('repair_vendor_structural_artifacts'));
});

test('well-formed vendor responses are byte-identical (repair never fires)', () => {
  const valid = '{"facts":[{"subject":"s","predicate":"p","quote":"q","status":"explicit"}]}';
  assert.equal(repairVendorStructuralArtifacts(valid, EXTRACTION_STRUCTURAL_REPAIR), null);
});

test('truncated output is never "repaired" into a fake completion', () => {
  const truncated = '{"facts":[{"subject":"s","quote":"unterminated';
  assert.equal(repairVendorStructuralArtifacts(truncated, EXTRACTION_STRUCTURAL_REPAIR), null);
  assert.throws(() => parseStructuredOutput(truncated, {
    label: 'x', structuralRepair: EXTRACTION_STRUCTURAL_REPAIR,
  }), error => error.code === 'json_truncated');
});

test('unknown artifact classes abort the repair instead of guessing', () => {
  // A value object wearing element-level keys stays untouched: the scan has no
  // vocabulary knowledge about nesting, so any structure it cannot prove
  // deterministic aborts with null.
  const ambiguous = '{"facts":[{"subject":"s","value":{"role":"r","status":"nested"}},{"subject":"t","quote":"q","status":"explicit"}],"tail":"}';
  assert.equal(repairVendorStructuralArtifacts(ambiguous, EXTRACTION_STRUCTURAL_REPAIR), null);
});

test('extractor recovers the misnested evidence key and strict verification still applies', async () => {
  // Form B artifact: the mapping object is unclosed, so evidenceQuotes lands
  // inside it. The extractor must read it from the artifact location.
  const segments = [{
    chunkId: 'c1', chapterId: 'ch-1', chapterTitle: 'T', startCp: 0,
    text: 'The wall stands twelve feet high. A cold steam rises from the vent.',
  }];
  const responseText = '{"entities":[{"key":"wall","type":"location","name":"Wall","aliases":[]}],'
    + '"facts":[{"subject":"wall","predicate":"height","value":{"feet":"twelve"},"status":"explicit",'
    + '"segment":1,"quote":"The wall stands twelve feet high."}],'
    + '"events":[],"ruleMappings":[{"target":"wall","kind":"resource",'
    + '"mapping":{"material":"stone","vent":["cold steam"],"evidenceQuotes":["A cold steam rises from the vent."]}'
    // element closer present, mapping closer missing: the artifact.
    + '}]}';
  const extractor = new LlmGroupExtractor(async () => ({ text: responseText, requestMetrics: [] }), 16_384, 'high');
  const group = await extractor.extract({ unitId: 'u', worldId: 'w', segments });
  assert.equal(group.facts.length, 1);
  assert.equal(group.rejectedQuotes, 0);
  assert.equal(group.ruleMappings.length, 1);
  assert.deepEqual(group.ruleMappings[0].evidenceRefs, ['A cold steam rises from the vent.'],
    'misnested evidenceQuotes must be recovered from the artifact location');
});

test('evidenceRefsFromCandidate prefers direct refs and never invents them', () => {
  assert.deepEqual(evidenceRefsFromCandidate({ evidenceQuotes: ['a'] }), ['a']);
  assert.deepEqual(evidenceRefsFromCandidate({ mapping: { evidenceQuotes: ['b'] } }), ['b']);
  assert.deepEqual(evidenceRefsFromCandidate({ evidenceQuotes: ['a'], mapping: { evidenceQuotes: ['b'] } }), ['a']);
  assert.deepEqual(evidenceRefsFromCandidate({ mapping: { owner: 'x' } }), []);
  assert.deepEqual(evidenceRefsFromCandidate({}), []);
  assert.deepEqual(evidenceRefsFromCandidate({ evidenceQuotes: ['a', 3, 'b'] }), ['a', 'b'],
    'non-string entries are filtered, not coerced');
});

test('repaired extraction output still passes the verbatim evidence gate only for real quotes', async () => {
  const segments = [{
    chunkId: 'c1', chapterId: 'ch-1', chapterTitle: 'T', startCp: 0,
    text: 'Anchor line stays. Nothing else is here.',
  }];
  const responseText = '{"entities":[{"key":"s","type":"character","name":"S","aliases":[]}],'
    + '"facts":['
    + '{"subject":"s","predicate":"note","value":{"v":"anchor"},"status":"explicit","segment":1,"quote":"Anchor line stays."},'
    + '{"subject":"s","predicate":"note","value":{"v":"fake"},"status":"explicit","segment":1,"quote":"Anchor line stays, comrade."}'
    + '],"events":[],"ruleMappings":[]}';
  const extractor = new LlmGroupExtractor(async () => ({ text: responseText, requestMetrics: [] }), 16_384, 'high');
  const group = await extractor.extract({ unitId: 'u', worldId: 'w', segments });
  assert.equal(group.facts.length, 1, 'the paraphrase-resistant gate keeps only verbatim quotes');
  assert.equal(group.facts[0].evidence.quote, 'Anchor line stays.');
});

test('parseExtractorJson repairs the captured artifact classes end to end', () => {
  // Both artifacts in one response, shaped exactly like the captures: form A
  // on a fact key; form B where the first element's mapping object never
  // closes, swallows evidenceQuotes, and the next element opener breaks the
  // parse (the extractor then recovers the misnested evidence refs).
  const artifact = '{"entities":[{"key:"ent-1","type":"character","name":"E1","aliases":[]}],'
    + '"facts":[{"subject":"ent-1","predicate":"current_location","value":{"location":"L1"},'
    + '"status":"explicit","confidence":0.9,"segment":1,"quote:"Q1"}],'
    + '"events":[],"ruleMappings":[{"target":"ent-1","kind":"skill",'
    + '"mapping":{"id":"s1","tiers":["basic"],"evidenceQuotes":["Q1"]},'
    + '{"target":"ent-2","kind":"attribute","mapping":{"id":"a1","scale":["low"]},"evidenceQuotes":["Q2"]}'
    + ']}';
  const raw = parseExtractorJson(artifact);
  assert.equal(raw.entities.length, 1);
  assert.equal(raw.entities[0].key, 'ent-1');
  assert.equal(raw.facts.length, 1);
  assert.equal(raw.facts[0].quote, 'Q1');
  assert.equal(raw.ruleMappings.length, 2);
});

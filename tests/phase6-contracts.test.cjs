const test = require('node:test');
const assert = require('node:assert/strict');
const { isSourceRangeV1, isSourceSetBindingV1, isBuildIntentV1, assertSourceRange, isSourceBindingCompatible } = require('../dist/domain/build/validation');
const h = 'a'.repeat(64), other = 'b'.repeat(64);
const member = { sourceId: 'source-1', sourceOrdinal: 1, normalizedTreeHash: h };
const binding = { sourceSetHash: h, members: [member] };
const range = { sourceId: member.sourceId, normalizedTreeHash: h, startCp: 0, endCp: 240, rangeContentHash: h };
test('source coordinates reject legacy/unidentified, malformed and out-of-source ranges', () => {
  assert.equal(isSourceRangeV1({ startCodePoint: 0, endCodePoint: 240, contentSha256: h }), false);
  for (const patch of [{startCp:-1}, {endCp:0}, {startCp:1.2}, {normalizedTreeHash:''}, {sourceId:''}])
    assert.equal(isSourceRangeV1({...range,...patch}),false);
  assert.throws(() => assertSourceRange(range,{sourceId:'source-2',normalizedTreeHash:h,codePointCount:300}));
  assert.throws(() => assertSourceRange(range,{sourceId:'source-1',normalizedTreeHash:h,codePointCount:200}));
  assert.doesNotThrow(() => assertSourceRange(range,{sourceId:'source-1',normalizedTreeHash:h,codePointCount:300}));
});
test('append-only membership keeps existing work compatible without ignoring replacement or renumbering', () => {
  const appended={sourceSetHash:other,members:[member,{sourceId:'source-2',sourceOrdinal:2,normalizedTreeHash:other}]};
  assert.equal(isSourceBindingCompatible(binding,appended),true);
  assert.equal(isSourceBindingCompatible(binding,{...appended,members:[{...member,normalizedTreeHash:other}]}),false);
  assert.equal(isSourceBindingCompatible(binding,{...appended,members:[{...member,sourceOrdinal:2}]}),false);
  assert.equal(isSourceSetBindingV1({...binding,members:[member,member]}),false);
});
test('frozen intents cannot use a range from another source snapshot or arbitrary protocol', async () => {
  const intent={intentId:'i',worldId:'w',planVersion:'segment-plan-1',segmentId:'s',generation:1,
    sourceBinding:binding,ranges:[range],reason:'bootstrap',priority:'P1',executionConfigFingerprint:h,demandRefs:[]};
  assert.equal(isBuildIntentV1(intent),true);
  assert.equal(isBuildIntentV1({...intent,ranges:[{...range,normalizedTreeHash:other}]}),false);
  assert.equal(isBuildIntentV1({...intent,planVersion:'stage-plan-1'}),false);
  assert.equal(isBuildIntentV1({...intent,generation:0}),false);
  // Replaceable executor consumes exactly the frozen intent, not storage chunks as requests.
  let seen; const executor={async ensureRun(value){seen=value;return {runIds:['r1','r2']};}};
  assert.deepEqual(await executor.ensureRun(intent),{runIds:['r1','r2']}); assert.equal(seen,intent);
});

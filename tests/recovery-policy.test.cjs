const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyTurnRecovery,
} = require('../dist/application/turns/recovery');

const base = {
  hasContract: false,
  hasRoll: false,
  hasNarrativeCandidate: false,
  hasCommittedResult: false,
};

test('recovery policy never rerolls a persisted roll', () => {
  assert.equal(
    classifyTurnRecovery({
      ...base,
      state: 'AwaitRoll',
      hasContract: true,
      hasRoll: true,
    }),
    'resume-narrator',
  );
  assert.equal(
    classifyTurnRecovery({
      ...base,
      state: 'Resolved',
      hasContract: true,
      hasRoll: true,
    }),
    'resume-narrator',
  );
});

test('narrated candidates are validated instead of regenerated', () => {
  assert.equal(
    classifyTurnRecovery({
      ...base,
      state: 'Narrated',
      hasContract: true,
      hasRoll: true,
      hasNarrativeCandidate: true,
    }),
    'validate-candidate',
  );
});

test('paused and committed turns cannot silently continue', () => {
  assert.equal(
    classifyTurnRecovery({ ...base, state: 'Paused' }),
    'remain-paused',
  );
  assert.equal(
    classifyTurnRecovery({
      ...base,
      state: 'Resolved',
      hasCommittedResult: true,
    }),
    'read-committed',
  );
});

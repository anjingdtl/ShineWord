const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStoredApiProfile } = require('../dist/application/llm/profileMigration');

const legacyProfile = {
  id: 'default',
  name: 'GLM preset',
  endpoint: 'https://example.invalid/v1',
  model: 'glm-5.3-flash',
  keyRef: 'llm.default',
  capabilities: {
    supportsJson: true,
    supportsStreaming: false,
    reportsUsage: true,
    contextWindow: 1_048_576,
    maxOutputTokens: 131_072,
    supportsPromptCache: true,
  },
  reasoningEffort: 'off',
};

test('legacy off migrates to low while preserving endpoint, model, key reference and capabilities', () => {
  const migrated = normalizeStoredApiProfile(legacyProfile);
  assert.equal(migrated.reasoningTier, 'low');
  assert.equal(Object.hasOwn(migrated, 'reasoningEffort'), false);
  assert.equal(migrated.endpoint, legacyProfile.endpoint);
  assert.equal(migrated.model, legacyProfile.model);
  assert.equal(migrated.keyRef, legacyProfile.keyRef);
  assert.deepEqual(migrated.capabilities, legacyProfile.capabilities);
});

test('custom profile legacy synthetic 128K/8192 capability pair becomes unknown', () => {
  const migrated = normalizeStoredApiProfile({
    ...legacyProfile,
    name: 'Default',
    model: 'my-private-model',
    capabilities: {
      ...legacyProfile.capabilities,
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
    },
  });
  assert.equal(migrated.capabilities.contextWindow, undefined);
  assert.equal(migrated.capabilities.maxOutputTokens, undefined);
});

test('valid custom capabilities and newer reasoning tiers survive profile normalization', () => {
  const migrated = normalizeStoredApiProfile({
    ...legacyProfile,
    name: 'Default',
    model: 'my-private-model',
    reasoningTier: 'max',
    capabilities: {
      ...legacyProfile.capabilities,
      contextWindow: 64_000,
      maxOutputTokens: 12_000,
    },
  });
  assert.equal(migrated.reasoningTier, 'max');
  assert.equal(migrated.capabilities.contextWindow, 64_000);
  assert.equal(migrated.capabilities.maxOutputTokens, 12_000);
});

test('custom unknown capabilities stay absent instead of becoming synthetic defaults', () => {
  const migrated = normalizeStoredApiProfile({
    ...legacyProfile,
    name: 'Default',
    model: 'custom',
    reasoningTier: 'high',
    capabilities: {
      supportsJson: true,
      supportsStreaming: false,
      reportsUsage: true,
    },
  });
  assert.equal(migrated.reasoningTier, 'high');
  assert.equal(migrated.capabilities.contextWindow, undefined);
  assert.equal(migrated.capabilities.maxOutputTokens, undefined);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function loadProfileStore(storage) {
  const filename = path.resolve(__dirname, '../mobile/src/profileStore.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const profileModule = new Module(filename, module);
  profileModule.filename = filename;
  profileModule.paths = Module._nodeModulePaths(path.dirname(filename));
  const nativeRequire = profileModule.require.bind(profileModule);
  profileModule.require = request => {
    if (request === '@react-native-async-storage/async-storage') {
      return { __esModule: true, default: storage };
    }
    if (request.endsWith('/application/llm/profileMigration')) {
      return require('../dist/application/llm/profileMigration');
    }
    return nativeRequire(request);
  };
  profileModule._compile(compiled, filename);
  return profileModule.exports;
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async getItem(key) { return data.get(key) ?? null; },
    async setItem(key, value) { data.set(key, value); },
  };
}

test('GLM streaming preset respects an explicit endpoint output ceiling and preserves the existing credential reference', async () => {
  const storage = memoryStorage(); const api = loadProfileStore(storage);
  const original = await api.saveApiProfile({ endpoint: 'https://example.invalid/v1', model: 'custom-model', reasoningTier: 'high',
    contextWindowTokens: 1048576, maxOutputTokens: 32768 });
  const updated = await api.saveApiProfile({ id: original.id, endpoint: original.endpoint, model: 'glm-5.3-flash',
    presetId: 'glm-5.3-flash', reasoningTier: 'high', contextWindowTokens: 1048576, maxOutputTokens: 32768 });
  assert.equal(updated.capabilities.supportsStreaming, true);
  assert.equal(updated.capabilities.maxOutputTokens, 32768);
  assert.equal(updated.capabilities.contextWindow, 1048576);
  assert.equal(updated.keyRef, original.keyRef);
  assert.equal((await api.loadApiProfile()).capabilities.maxOutputTokens, 32768);
});

test('DeepSeek preset maps the official display name to the documented wire ID and capabilities', () => {
  const { presetById } = loadProfileStore(memoryStorage());
  const preset = presetById('deepseek-v4.1-flash');
  assert.equal(preset.label, 'DeepSeek V4.1 Flash（1M）');
  assert.equal(preset.model, 'deepseek-flash');
  assert.equal(preset.profile.capabilities.contextWindow, 1_048_576);
  assert.equal(preset.profile.capabilities.maxOutputTokens, 393_216);
  assert.equal(preset.profile.reasoningTier, 'low');
  assert.equal(preset.profile.reasoningDialect, 'deepseek');
});

for (const tier of ['low', 'high', 'max']) {
  test(`DeepSeek preset sends ${tier} with thinking enabled and the exact kernel wire budget (unit transport)`, async () => {
    const { presetById, saveApiProfile } = loadProfileStore(memoryStorage());
    const preset = presetById('deepseek-v4.1-flash');
    const profile = await saveApiProfile({
      endpoint: 'https://example.invalid/v1', model: preset.model,
      presetId: preset.id, reasoningTier: tier,
    });
    assert.equal(profile.name, preset.label);
    assert.equal(profile.reasoningTier, tier);
    assert.equal(profile.reasoningDialect, 'deepseek');
    const { resolveModelCapabilities } = require('../dist/application/llm/capabilityResolver');
    const { planLlmRequest, DEFAULT_OUTPUT_DEMANDS } = require('../dist/application/llm/requestBudgetKernel');
    const { OpenAICompatibleProvider } = require('../dist/application/llm/openAICompatible');
    const { MemorySecretStore } = require('../dist/application/llm/memorySecretStore');
    const plan = planLlmRequest({
      capabilities: resolveModelCapabilities({
        declared: {
          contextWindowTokens: profile.capabilities.contextWindow,
          maxOutputTokens: profile.capabilities.maxOutputTokens,
        }, reasoningMode: 'always_on',
      }),
      requestKind: 'planner', estimatedMandatoryInputTokens: 0,
      businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.planner,
      reasoningPolicy: { tier, providerDialect: profile.reasoningDialect, model: profile.model },
    });
    const secrets = new MemorySecretStore();
    await secrets.set(profile.keyRef, 'unit-test-key');
    const bodies = [];
    const provider = new OpenAICompatibleProvider(profile, secrets, {
      async post(request) {
        bodies.push(JSON.parse(request.body));
        return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) };
      },
    });
    await provider.complete({
      role: 'Planner', system: 'unit fixture', user: 'unit fixture',
      maxOutputTokens: plan.wireOutputTokens, maxPhysicalRequests: 1,
      reasoningTier: plan.reasoningPolicy.tier,
    });
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].model, 'deepseek-flash');
    assert.deepEqual(bodies[0].thinking, { type: 'enabled' });
    assert.equal(bodies[0].reasoning_effort, tier);
    assert.equal(plan.reasoningPolicy.effectiveTier, tier);
    assert.equal(bodies[0].max_tokens, plan.wireOutputTokens);
    assert.equal(Object.hasOwn(bodies[0].thinking, 'budget_tokens'), false);
  });
}

test('new custom profiles require an explicit tier and keep unknown capabilities absent', async () => {
  const storage = memoryStorage();
  const { saveApiProfile } = loadProfileStore(storage);
  const profile = await saveApiProfile({
    endpoint: 'https://example.invalid/v1',
    model: 'custom-model',
    reasoningTier: 'max',
  });
  assert.equal(profile.reasoningTier, 'max');
  assert.equal(Object.hasOwn(profile, 'reasoningEffort'), false);
  assert.equal(profile.capabilities.contextWindow, undefined);
  assert.equal(profile.capabilities.maxOutputTokens, undefined);
  assert.equal(profile.keyRef, 'llm.default');

  const saved = JSON.parse(storage.data.get('shineword.api.profile.v1'));
  assert.equal(saved.reasoningTier, 'max');
  assert.equal(Object.hasOwn(saved, 'reasoningEffort'), false);
  assert.equal(Object.hasOwn(saved.capabilities, 'contextWindow'), false);
  assert.equal(Object.hasOwn(saved.capabilities, 'maxOutputTokens'), false);
});

test('preset save keeps preset capabilities but the explicit user tier wins', async () => {
  const storage = memoryStorage();
  const { saveApiProfile } = loadProfileStore(storage);
  const profile = await saveApiProfile({
    endpoint: 'https://example.invalid/v1',
    model: 'glm-5.3-flash',
    presetId: 'glm-5.3-flash',
    reasoningTier: 'high',
  });
  assert.equal(profile.reasoningTier, 'high');
  assert.equal(profile.capabilities.contextWindow, 1_048_576);
  assert.equal(profile.capabilities.maxOutputTokens, 131_072);
});

test('legacy profile load persists low migration under the same key and preserves keyRef', async () => {
  const storage = memoryStorage({
    'shineword.api.profile.v1': JSON.stringify({
      id: 'default', name: 'Legacy', endpoint: 'https://example.invalid/v1',
      model: 'custom-model', keyRef: 'llm.default',
      capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: true },
      reasoningEffort: 'off',
    }),
  });
  const { loadApiProfile } = loadProfileStore(storage);
  const profile = await loadApiProfile();
  assert.equal(profile.reasoningTier, 'low');
  assert.equal(profile.keyRef, 'llm.default');
  assert.equal(JSON.parse(storage.data.get('shineword.api.profile.v1')).reasoningTier, 'low');
});

test('save rejects a legacy or unknown tier instead of persisting it', async () => {
  const { saveApiProfile } = loadProfileStore(memoryStorage());
  await assert.rejects(saveApiProfile({
    endpoint: 'https://example.invalid/v1',
    model: 'custom-model',
    reasoningTier: 'off',
  }), /supported reasoning tier/);
});

const configuredInput = {
  endpoint: 'https://example.invalid/v1', model: 'glm-5.3-flash',
  presetId: 'glm-5.3-flash', reasoningTier: 'low',
};

test('multiple API records retain independent keys and survive switching/restart', async () => {
  const storage = memoryStorage();
  const secretValues = new Map();
  const secrets = { async set(ref, value) { secretValues.set(ref, value); }, async get(ref) { return secretValues.get(ref); } };
  const api = loadProfileStore(storage);
  const primary = await api.saveConfiguredApiProfile({ ...configuredInput, name: 'Primary' }, 'primary-secret', secrets);
  const backup = await api.saveConfiguredApiProfile({ ...configuredInput, endpoint: 'https://backup.invalid/v1', name: 'Backup' }, 'backup-secret', secrets);
  assert.notEqual(primary.id, backup.id);
  assert.notEqual(primary.keyRef, backup.keyRef);
  assert.equal((await api.listApiProfiles()).length, 2);
  await api.selectApiProfile(primary.id);
  const restarted = loadProfileStore(storage);
  assert.equal((await restarted.loadApiProfile()).id, primary.id);
  assert.equal(secretValues.get(primary.keyRef), 'primary-secret');
  assert.equal(secretValues.get(backup.keyRef), 'backup-secret');
  const edited = await restarted.saveConfiguredApiProfile({ ...configuredInput, id: backup.id,
    endpoint: backup.endpoint, name: 'Backup renamed', reasoningTier: 'max' }, '', secrets);
  assert.equal(edited.keyRef, backup.keyRef);
  assert.equal((await restarted.listApiProfiles()).length, 2);
  assert.equal((await restarted.loadApiProfile()).id, backup.id);
  assert.equal(JSON.stringify([...storage.data.values()]).includes('secret'), false);
});

test('adding an API without its own key cannot silently reuse another record credential', async () => {
  const storage = memoryStorage();
  const values = new Map();
  const secrets = { async set(ref, value) { values.set(ref, value); }, async get(ref) { return values.get(ref); } };
  const api = loadProfileStore(storage);
  const primary = await api.saveConfiguredApiProfile(configuredInput, 'primary-key', secrets);
  await assert.rejects(api.saveConfiguredApiProfile({ ...configuredInput, endpoint: 'https://backup.invalid/v1' }, '', secrets), /请输入 API Key/);
  assert.equal((await api.listApiProfiles()).length, 1);
  assert.equal((await api.loadApiProfile()).id, primary.id);
});

test('explicitly adding the same endpoint and model keeps separate accounts and credentials', async () => {
  const storage = memoryStorage();
  const values = new Map();
  const secrets = { async set(ref, value) { values.set(ref, value); }, async get(ref) { return values.get(ref); } };
  const api = loadProfileStore(storage);
  const primary = await api.saveConfiguredApiProfile({ ...configuredInput, id: null, name: 'Account A' }, 'account-a', secrets);
  await assert.rejects(api.saveConfiguredApiProfile({ ...configuredInput, id: null, name: 'Account B' }, '', secrets), /请输入 API Key/);
  const backup = await api.saveConfiguredApiProfile({ ...configuredInput, id: null, name: 'Account B' }, 'account-b', secrets);
  assert.notEqual(primary.id, backup.id);
  assert.notEqual(primary.keyRef, backup.keyRef);
  assert.equal(values.get(primary.keyRef), 'account-a');
  assert.equal(values.get(backup.keyRef), 'account-b');
  assert.equal((await api.listApiProfiles()).length, 2);
  await api.selectApiProfile(primary.id);
  assert.equal((await api.loadApiProfile()).name, 'Account A');
});

test('first-run missing key does not publish a profile that bypasses setup after restart', async () => {
  const storage = memoryStorage();
  const { saveConfiguredApiProfile, loadApiProfile } = loadProfileStore(storage);
  await assert.rejects(saveConfiguredApiProfile(configuredInput, '', {
    async get() { return null; }, async set() { assert.fail('must not write a blank key'); },
  }), /请输入 API Key/);
  assert.equal(await loadApiProfile(), null);
});

test('Keychain failure preserves the previous profile and validation does not rotate its key', async () => {
  const storage = memoryStorage();
  const { saveApiProfile, saveConfiguredApiProfile, loadApiProfile } = loadProfileStore(storage);
  const previous = await saveApiProfile({ ...configuredInput, endpoint: 'https://old.invalid/v1' });
  await assert.rejects(saveConfiguredApiProfile(configuredInput, 'private-key', {
    async set() { throw new Error('Keychain unavailable'); },
  }), /Keychain unavailable/);
  assert.deepEqual(await loadApiProfile(), previous);
  await assert.rejects(saveConfiguredApiProfile({ ...configuredInput, endpoint: '' }, 'private-key', {
    async set() { assert.fail('invalid profile must not rotate the credential'); },
  }), /Endpoint and model/);
  assert.deepEqual(await loadApiProfile(), previous);
});

test('configured save writes only keyRef to ordinary storage and allows saved key reuse', async () => {
  const storage = memoryStorage();
  const { saveConfiguredApiProfile } = loadProfileStore(storage);
  let secret = null;
  const secrets = {
    async set(ref, value) { assert.equal(ref, 'llm.default'); secret = value; },
    async get(ref) { assert.equal(ref, 'llm.default'); return secret; },
  };
  await saveConfiguredApiProfile(configuredInput, ' private-key ', secrets);
  assert.equal(secret, 'private-key');
  assert.equal(storage.data.get('shineword.api.profile.v1').includes('private-key'), false);
  const profile = await saveConfiguredApiProfile({ ...configuredInput, reasoningTier: 'max' }, '', secrets);
  assert.equal(profile.reasoningTier, 'max');
  assert.equal(profile.keyRef, 'llm.default');
});

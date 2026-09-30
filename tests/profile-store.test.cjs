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

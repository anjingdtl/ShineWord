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

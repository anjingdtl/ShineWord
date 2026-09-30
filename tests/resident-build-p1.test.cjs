// 1M resident build P1 regression suite: reasoning-parameter passthrough per
// vendor dialect, the resident three-message request shape, and probe v2
// (prefix-cache detection via cached_tokens, output-ceiling behaviour).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OpenAICompatibleProvider,
  reasoningDialect,
} = require('../dist/application/llm/openAICompatible');
const { probeCapabilities } = require('../dist/application/llm/capabilities');
const { MemorySecretStore } = require('../dist/application/llm/memorySecretStore');

function deepseekProfile() {
  return {
    id: 'p-ds', name: 'DeepSeek', endpoint: 'https://api.example.com/v1',
    model: 'DeepSeek-V4.1-Flash', keyRef: 'k.ds',
    capabilities: {
      supportsJson: true, supportsStreaming: false, reportsUsage: true,
      contextWindow: 1_048_576, maxOutputTokens: 393_216, supportsPromptCache: true,
    },
    contentOutputTokens: 16_384,
    reasoningReserveTokens: 0,
    reasoningEffort: 'off',
  };
}

function glmProfile() {
  return {
    id: 'p-glm', name: 'GLM', endpoint: 'https://api.example.com/v1',
    model: 'glm-5.3-flash', keyRef: 'k.glm',
    capabilities: {
      supportsJson: true, supportsStreaming: false, reportsUsage: true,
      contextWindow: 1_048_576, maxOutputTokens: 131_072, supportsPromptCache: true,
    },
    contentOutputTokens: 16_384,
    reasoningReserveTokens: 2_048,
    reasoningEffort: 'low',
  };
}

function captureTransport(requests, extraUsage = {}) {
  return {
    async post(input) {
      requests.push(input);
      return {
        status: 200,
        body: JSON.stringify({
          id: `req-${requests.length}`,
          choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 90 },
            completion_tokens_details: { reasoning_tokens: 5 },
            ...extraUsage,
          },
        }),
      };
    },
  };
}

test('DeepSeek dialect: reasoning_effort carries low/high/max while thinking stays enabled', async () => {
  const secrets = new MemorySecretStore();
  await secrets.set('k.ds', 'sk');
  for (const tier of ['low', 'high', 'max']) {
    const requests = [];
    const provider = new OpenAICompatibleProvider(deepseekProfile(), secrets, captureTransport(requests));
    const result = await provider.complete({
      role: 'Extractor', system: 'sys', user: 'body',
      maxOutputTokens: 16_384, jsonMode: true, reasoningTier: tier,
    });
    assert.equal(requests.length, 1);
    const body = JSON.parse(requests[0].body);
    assert.deepEqual(body.thinking, { type: 'enabled' });
    assert.equal(body.reasoning_effort, tier);
    assert.equal(body.max_tokens, 16_384, 'content-only budget (reserve = 0)');
    assert.equal(result.usage.cachedInputTokens, 90);
    assert.equal(result.usage.reasoningTokens, 5);
  }
});

test('GLM dialect sends exact low/high/max tiers, clear_thinking=false, and content + reserve', async () => {
  const secrets = new MemorySecretStore();
  await secrets.set('k.glm', 'sk');
  for (const tier of ['low', 'high', 'max']) {
    const requests = [];
    const provider = new OpenAICompatibleProvider(glmProfile(), secrets, captureTransport(requests));
    await provider.complete({
      role: 'Extractor', system: 'sys', user: 'body',
      maxOutputTokens: 16_384 + 2_048, jsonMode: true, reasoningTier: tier,
    });
    const body = JSON.parse(requests[0].body);
    assert.equal(body.reasoning_effort, tier);
    assert.deepEqual(body.thinking, { clear_thinking: false });
    assert.equal(body.max_tokens, 18_432, 'content budget + reasoning reserve');
    assert.ok(131_072 - body.max_tokens >= 8_192);
  }
});

test('no explicit tier uses the compatibility default low and never disables thinking', async () => {
  const secrets = new MemorySecretStore();
  await secrets.set('k.glm', 'sk');
  const requests = [];
  const provider = new OpenAICompatibleProvider(glmProfile(), secrets, captureTransport(requests));
  await provider.complete({ role: 'Narrator', system: 's', user: 'u', maxOutputTokens: 500 });
  const body = JSON.parse(requests[0].body);
  assert.deepEqual(body.thinking, { clear_thinking: false }, 'thinking stays on');
  assert.equal(body.reasoning_effort, 'low', 'compatibility fallback is the lowest tier');
});

test('resident shape: followUpUserMessages append after the byte-stable system+user prefix', async () => {
  const secrets = new MemorySecretStore();
  await secrets.set('k.ds', 'sk');
  const requests = [];
  const provider = new OpenAICompatibleProvider(deepseekProfile(), secrets, captureTransport(requests));
  const scopeA = '仅抽取第 1..14 段（共 40 段）的事实。';
  const scopeB = '仅抽取第 15..28 段（共 40 段）的事实。';
  await provider.complete({
    role: 'Extractor', system: 'sys', user: 'whole-book-body',
    maxOutputTokens: 16_384, jsonMode: true, reasoningEffort: 'off',
    followUpUserMessages: [scopeA],
  });
  await provider.complete({
    role: 'Extractor', system: 'sys', user: 'whole-book-body',
    maxOutputTokens: 16_384, jsonMode: true, reasoningEffort: 'off',
    followUpUserMessages: [scopeB],
  });
  const first = JSON.parse(requests[0].body);
  const second = JSON.parse(requests[1].body);
  assert.equal(first.messages.length, 3);
  assert.equal(first.messages[0].role, 'system');
  assert.equal(first.messages[1].role, 'user');
  assert.equal(first.messages[2].role, 'user');
  // The cacheable prefix is byte-identical across units; only the scope
  // instruction (messages[2]) differs.
  assert.deepEqual(first.messages.slice(0, 2), second.messages.slice(0, 2));
  assert.equal(first.messages[2].content, scopeA);
  assert.equal(second.messages[2].content, scopeB);
});

test('reasoning dialect routing is model-name based and request-layer only', () => {
  assert.equal(reasoningDialect('DeepSeek-V4.1-Flash'), 'deepseek');
  assert.equal(reasoningDialect('deepseek-chat'), 'deepseek');
  assert.equal(reasoningDialect('GLM-5.3-Flash'), 'glm');
  assert.equal(reasoningDialect('glm-4-plus'), 'glm');
  assert.equal(reasoningDialect('qwen-max'), 'generic');
});

test('a generic endpoint rejecting the reasoning field fails once with an actionable tier message', async () => {
  const secrets = new MemorySecretStore();
  await secrets.set('k.generic', 'sk');
  let calls = 0;
  const profile = {
    ...glmProfile(), model: 'custom-model', keyRef: 'k.generic', reasoningDialect: 'generic',
  };
  const provider = new OpenAICompatibleProvider(profile, secrets, {
    async post(request) {
      calls += 1;
      assert.equal(JSON.parse(request.body).reasoning_effort, 'max');
      return { status: 400, body: JSON.stringify({ error: { message: 'Unknown field reasoning_effort' } }) };
    },
  });
  await assert.rejects(
    provider.complete({ role: 'Planner', system: 's', user: 'u', maxOutputTokens: 100, reasoningTier: 'max' }),
    /当前端点可能不支持思考档位参数/,
  );
  assert.equal(calls, 1, 'unsupported field does not trigger a retry');
});

test('probe v2 detects prefix cache from cached_tokens on the repeated long prompt', async () => {
  const bodies = [];
  const probed = await probeCapabilities({
    transport: {
      async post(request) {
        bodies.push(JSON.parse(request.body));
        const isLongPrompt = (bodies.at(-1).messages?.[0]?.content ?? '').length > 1000;
        const isRepeat = bodies.filter(b => (b.messages?.[0]?.content ?? '').length > 1000).length >= 2;
        return {
          status: 200,
          body: JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: isLongPrompt && isRepeat
              ? { prompt_tokens: 1500, prompt_tokens_details: { cached_tokens: 1400 } }
              : { prompt_tokens: 1500 },
          }),
        };
      },
    },
    endpoint: 'https://api.example.com/v1',
    model: 'm',
    apiKey: 'k',
  });
  assert.equal(probed.capabilities.supportsPromptCache, true);
  assert.equal(probed.probes.promptCache, true);
  const longPrompts = bodies.filter(b => (b.messages?.[0]?.content ?? '').length > 1000);
  assert.equal(longPrompts.length, 2);
  assert.equal(longPrompts[0].messages[0].content, longPrompts[1].messages[0].content,
    'the cache probe sends the SAME long prompt twice');
  assert.ok(longPrompts[0].messages[0].content.length >= 1024, 'prompt is >= 1024 conservative tokens');
});

test('probe v2 reports no cache when cached_tokens stays 0 (T7 precondition)', async () => {
  const probed = await probeCapabilities({
    transport: {
      async post() {
        return {
          status: 200,
          body: JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 1500, prompt_tokens_details: { cached_tokens: 0 } },
          }),
        };
      },
    },
    endpoint: 'https://api.example.com/v1',
    model: 'm',
    apiKey: 'k',
  });
  assert.equal(probed.capabilities.supportsPromptCache, false);
  assert.equal(probed.probes.promptCache, false);
});

test('probe v2 surfaces output-ceiling rejection and reasoning-token reporting', async () => {
  const probed = await probeCapabilities({
    transport: {
      async post(request) {
        const body = JSON.parse(request.body);
        if (body.max_tokens > 8_192) {
          return { status: 400, body: JSON.stringify({ error: { message: 'max_tokens exceeds model limit 8192' } }) };
        }
        return {
          status: 200,
          body: JSON.stringify({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 5, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 1 } },
          }),
        };
      },
    },
    endpoint: 'https://api.example.com/v1',
    model: 'm',
    apiKey: 'k',
    declaredMaxOutputTokens: 16_384,
  });
  assert.equal(probed.probes.outputCeiling.accepted, false);
  assert.match(probed.probes.outputCeiling.message, /max_tokens/);
  assert.equal(probed.probes.reasoningTokens, true);
  assert.equal(probed.capabilities.maxOutputTokens, 16_384);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { OpenAICompatibleProvider } = require('../dist/application/llm/openAICompatible');
const { MemorySecretStore } = require('../dist/application/llm/memorySecretStore');
const { TurnRequestBudget } = require('../dist/application/llm/requestBudget');

function profile(endpoint = 'https://example.test/v1') {
  return {
    id: 'p1',
    name: 'test',
    endpoint,
    model: 'model-x',
    keyRef: 'shineword.llm.p1',
    capabilities: {
      supportsJson: true,
      supportsStreaming: false,
      reportsUsage: true,
      contextWindow: 32000,
      maxOutputTokens: 4096,
    },
  };
}

test('OpenAI-compatible provider keeps API key out of profile and normalizes usage', async () => {
  const secrets = new MemorySecretStore();
  await secrets.set('shineword.llm.p1', 'secret-value');

  let request;
  const provider = new OpenAICompatibleProvider(
    profile(),
    secrets,
    {
      async post(input) {
        request = input;
        return {
          status: 200,
          body: JSON.stringify({
            id: 'req-1',
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 20,
              prompt_tokens_details: { cached_tokens: 10 },
            },
          }),
        };
      },
    },
  );

  const result = await provider.complete({
    role: 'Planner',
    system: 'system',
    user: 'user',
    maxOutputTokens: 1000,
    jsonMode: true,
  });

  assert.equal(request.url, 'https://example.test/v1/chat/completions');
  assert.equal(request.headers.Authorization, 'Bearer secret-value');
  assert.equal(JSON.parse(request.body).response_format.type, 'json_object');
  assert.equal(result.usage.inputTokens, 100);
  assert.equal(result.usage.cachedInputTokens, 10);
  assert.equal(result.usage.estimated, false);
  assert.equal(JSON.stringify(profile()).includes('secret-value'), false);
});

test('provider rejects public cleartext HTTP but permits explicit localhost', async () => {
  const secrets = new MemorySecretStore();
  await secrets.set('shineword.llm.p1', 'k');
  const transport = {
    async post() {
      return { status: 200, body: '{"choices":[{"message":{"content":"ok"}}]}' };
    },
  };
  await assert.rejects(
    new OpenAICompatibleProvider(profile('http://example.com/v1'), secrets, transport)
      .complete({ role: 'Narrator', system: 's', user: 'u', maxOutputTokens: 10 }),
    /HTTPS/,
  );
  await new OpenAICompatibleProvider(profile('http://127.0.0.1:8000/v1'), secrets, transport)
    .complete({ role: 'Narrator', system: 's', user: 'u', maxOutputTokens: 10 });
});

test('provider records every physical reasoning attempt and honors a strict request cap', async () => {
  const secrets = new MemorySecretStore();
  await secrets.set('shineword.llm.p1', 'k');
  const requests = [];
  const observed = [];
  let call = 0;
  const provider = new OpenAICompatibleProvider(profile(), secrets, {
    async post(input) {
      requests.push(input);
      call += 1;
      return call === 1
        ? { status: 200, body: JSON.stringify({
          choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'private reasoning is not returned' } }],
          usage: { prompt_tokens: 12, completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 99 } },
        }), timings: { responseHeadersMs: 25, completeResponseMs: 30 } }
        : { status: 200, body: JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 14, completion_tokens: 110, completion_tokens_details: { reasoning_tokens: 80 } },
        }), timings: { responseHeadersMs: 20, completeResponseMs: 35 } };
    },
  }, 1000, { maxPhysicalRequests: 2, onPhysicalRequest: metric => observed.push(metric) });

  const result = await provider.complete({ role: 'Extractor', system: 's', user: 'u', maxOutputTokens: 100 });
  assert.equal(requests.length, 2);
  assert.equal(result.requestMetrics.length, 2);
  assert.equal(observed.length, 2);
  assert.equal(result.requestMetrics[0].outcome, 'reasoning_only');
  assert.equal(result.requestMetrics[0].usage.reasoningTokens, 99);
  assert.equal(result.requestMetrics[1].outcome, 'completed');
  assert.equal(result.requestMetrics[1].timings.responseHeadersMs, 20);
  assert.equal(JSON.parse(requests[0].body).thinking, undefined,
    'the provider does not add an automatic reasoning opt-out');
  assert.equal(JSON.stringify(result.requestMetrics).includes('private reasoning'), false);
});

test('provider emits one physical attempt when configured with a one-request cap', async () => {
  const secrets = new MemorySecretStore();
  await secrets.set('shineword.llm.p1', 'k');
  let requests = 0;
  const observed = [];
  const provider = new OpenAICompatibleProvider(profile(), secrets, {
    async post() {
      requests += 1;
      return { status: 200, body: JSON.stringify({
        choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'reasoning' } }],
        usage: { completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 100 } },
      }) };
    },
  }, 1000, { maxPhysicalRequests: 1, onPhysicalRequest: metric => observed.push(metric) });
  await assert.rejects(
    provider.complete({ role: 'Extractor', system: 's', user: 'u', maxOutputTokens: 100 }),
    /只输出了思维链/,
  );
  assert.equal(requests, 1);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].outcome, 'reasoning_only');
});

test('provider honors per-request physical cap and keeps the selected tier', async () => {
  const secrets = new MemorySecretStore();
  await secrets.set('shineword.llm.p1', 'k');
  const requests = [];
  const provider = new OpenAICompatibleProvider(profile(), secrets, {
    async post(input) {
      requests.push(input);
      return { status: 200, body: JSON.stringify({
        choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'private' } }],
        usage: { completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 100 } },
      }) };
    },
  }, 1000, { maxPhysicalRequests: 3 });
  await assert.rejects(provider.complete({
    role: 'Planner', system: 's', user: 'u', maxOutputTokens: 100,
    maxPhysicalRequests: 1, reasoningTier: 'max', reasoningReserveTokens: 50,
  }), /只输出了思维链/);
  assert.equal(requests.length, 1, 'the application owns the one permitted follow-up attempt');
  const body = JSON.parse(requests[0].body);
  assert.equal(body.max_tokens, 100);
  assert.equal(body.reasoning_effort, 'max');
});

test('turn request budget hard-stops the fifth physical request', () => {
  const budget = new TurnRequestBudget(4);
  budget.consume('Planner');
  budget.consume('Narrator');
  budget.consume('Checker');
  budget.consume('Narrator');
  assert.equal(budget.remaining(), 0);
  assert.throws(() => budget.consume('Checker'), /budget exceeded/);
});

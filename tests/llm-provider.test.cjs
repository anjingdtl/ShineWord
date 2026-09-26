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

test('turn request budget hard-stops the fifth physical request', () => {
  const budget = new TurnRequestBudget(4);
  budget.consume('Planner');
  budget.consume('Narrator');
  budget.consume('Checker');
  budget.consume('Narrator');
  assert.equal(budget.remaining(), 0);
  assert.throws(() => budget.consume('Checker'), /budget exceeded/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { parseStructuredOutput, StructuredParseError } = require('../dist/application/llm/structuredOutput');
const {
  stripReasoningWrappers,
  findBalancedJsonSpans,
  repairTrailingCommas,
} = require('../dist/application/llm/responseNormalizer');
const { LedgeredProvider, recoverInterruptedAttempts, OutcomeUnknownReplayError } = require('../dist/application/llm/requestLedger');
const { LlmRequestFailure } = require('../dist/application/llm/types');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');
const { applySqliteMigrations } = require('../dist/infra/sqlite/migrations');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');

class NodeSqliteAdapter {
  constructor(db) { this.db = db; }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  async transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = await work(this); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

async function ledgerStore() {
  const adapter = new NodeSqliteAdapter(new DatabaseSync(':memory:'));
  await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  return new SqliteLlmLedgerStore(adapter);
}

// ---------------------------------------------------------------- JSON matrix

const ALIASES = { type: 'op', effectType: 'op', to: 'locationId', resource: 'resourceId' };

function parse(raw, options = {}) {
  return parseStructuredOutput(raw, { label: 'test', fieldAliases: ALIASES, ...options });
}

test('json: strict valid JSON parses with no repairs', () => {
  const { value, repairSteps } = parse('{"op":"move","locationId":"loc-1"}');
  assert.deepEqual(value, { op: 'move', locationId: 'loc-1' });
  assert.equal(repairSteps.length, 0);
});

test('json: prose wrapper around JSON', () => {
  const { value } = parse('好的，以下是结果：\n{"op":"observe"}\n希望有帮助。');
  assert.equal(value.op, 'observe');
});

test('json: fenced json block', () => {
  const { value, repairSteps } = parse('```json\n{"op":"talk"}\n```');
  assert.equal(value.op, 'talk');
  assert.ok(repairSteps.includes('strip_markdown_fence'));
});

test('json: plain fence without json tag', () => {
  const { value } = parse('```\n{"op":"talk"}\n```');
  assert.equal(value.op, 'talk');
});

test('json: trailing comma repaired outside strings only', () => {
  const { value, repairSteps } = parse('{"op":"say","text":"逗号, } 不在字符串外","tags":["a","b",],}');
  assert.equal(value.op, 'say');
  assert.equal(value.text, '逗号, } 不在字符串外');
  assert.deepEqual(value.tags, ['a', 'b']);
  assert.ok(repairSteps.includes('repair_trailing_comma'));
  assert.equal(repairTrailingCommas('{"a":"x,}"}'), null, 'no repair inside strings');
});

test('json: braces and comma-brace inside string literals never break balance', () => {
  const raw = '下面是结果：{"text":"他说：{不要走}，真的,}"} 完成。';
  const { value } = parse(raw);
  assert.equal(value.text, '他说：{不要走}，真的,}');
});

test('json: escaped quotes inside strings', () => {
  const { value } = parse('{"text":"他说\\"再见\\"然后离开"}');
  assert.equal(value.text, '他说"再见"然后离开');
});

test('json: nested objects and arrays survive balanced extraction', () => {
  const raw = '结果 {"outer":{"inner":[{"k":1},{"k":2}]},"tail":true} 完';
  const { value } = parse(raw);
  assert.deepEqual(value.outer.inner, [{ k: 1 }, { k: 2 }]);
  assert.equal(value.tail, true);
});

test('json: double-encoded JSON unwraps (<= 2 layers)', () => {
  const oneLayer = JSON.stringify({ op: 'observe' });
  const { value, repairSteps } = parse(JSON.stringify(oneLayer));
  assert.equal(value.op, 'observe');
  assert.ok(repairSteps.includes('decode_double_encoded'));
});

test('json: field alias type->op and effectType->op promoted', () => {
  const a = parse('{"type":"move","locationId":"l1"}');
  assert.equal(a.value.op, 'move');
  const b = parse('{"effects":[{"effectType":"move","to":"l2"}]}');
  assert.equal(b.value.effects[0].op, 'move');
  assert.equal(b.value.effects[0].locationId, 'l2');
});

test('json: alias never overwrites a canonical field the model provided', () => {
  const { value } = parse('{"op":"talk","type":"move"}');
  assert.equal(value.op, 'talk', 'canonical wins');
  assert.equal(value.type, 'move', 'alias key stays untouched');
});

test('json: known enum aliases remap whitelisted values per field', () => {
  const { value } = parse('{"visibility":"公开","grade":"普通"}', {
    enumAliases: { visibility: { '公开': 'public' }, grade: { '普通': 'normal' } },
  });
  assert.equal(value.visibility, 'public');
  assert.equal(value.grade, 'normal');
});

test('json: unrelated JSON before the real payload - validator picks the valid one', () => {
  const raw = '{"noise":true} 说明文字 {"op":"move","locationId":"loc-9"}';
  const { value } = parse(raw, {
    validate: candidate => {
      if (!('op' in candidate)) throw new Error('missing op');
    },
  });
  assert.equal(value.op, 'move');
});

test('json: truncated JSON classifies as json_truncated, not invalid', () => {
  assert.throws(
    () => parse('{"op":"move","locationId":"loc-1"'),
    error => error instanceof StructuredParseError && error.code === 'json_truncated',
  );
});

test('json: no JSON at all classifies as no_json_found', () => {
  assert.throws(
    () => parse('模型拒绝了请求，无法给出结构化结果。'),
    error => error instanceof StructuredParseError && error.code === 'no_json_found',
  );
});

test('json: missing mandatory field surfaces schema_invalid with validator message', () => {
  assert.throws(
    () => parse('{"op":"move"}', {
      validate: candidate => {
        if (!('locationId' in candidate)) throw new Error('locationId required for move');
      },
    }),
    error => error instanceof StructuredParseError
      && error.code === 'schema_invalid'
      && error.message.includes('locationId required'),
  );
});

test('json: malicious extra fields reach the validator (never silently dropped)', () => {
  let seen;
  parse('{"op":"observe","__inject__":"evil"}', {
    validate: candidate => { seen = candidate; },
  });
  assert.equal(seen.__inject__, 'evil');
});

test('json: reasoning wrapper stripped before extraction', () => {
  const raw = '<think>我应该返回一个 JSON 对象</think>\n{"op":"observe"}';
  assert.equal(stripReasoningWrappers('<think>a</think>b'), 'b');
  const { value, repairSteps } = parse(raw);
  assert.equal(value.op, 'observe');
  assert.ok(repairSteps.includes('strip_reasoning_wrapper'));
});

test('json: triple-encoded JSON is refused rather than endlessly unwrapped', () => {
  // A whole response encoded 3 times stays a string after the 2-layer cap
  // and is rejected; payloads nested inside valid objects are never unwrapped.
  const threeLayers = JSON.stringify(JSON.stringify(JSON.stringify({ op: 'observe' })));
  assert.throws(
    () => parse(threeLayers),
    error => error instanceof StructuredParseError,
  );
});

test('json: balanced span finder ignores brackets inside strings', () => {
  const spans = findBalancedJsonSpans('x {"a":"[not an array]"} y {"b":2}');
  assert.equal(spans.length, 2);
  assert.equal(JSON.parse(spans[0].text).a, '[not an array]');
});

// ------------------------------------------------------------- ledger matrix

function fakeProvider(behavior) {
  return {
    async complete(request) { return behavior(request); },
  };
}

const LEDGER_META = {
  logicalRequestId: 'planner:branch-1:turn-1',
  requestKind: 'planner',
  branchId: 'branch-1',
  stateVersion: 7,
};

test('ledger: prepared -> sent -> succeeded persists usage', async () => {
  const store = await ledgerStore();
  const provider = new LedgeredProvider(
    fakeProvider(async () => ({
      text: '{"ok":true}',
      requestId: 'prov-123',
      usage: { inputTokens: 100, outputTokens: 50, reasoningTokens: 8, cachedInputTokens: 20, estimated: false },
    })),
    store,
    { modelProfileFingerprint: 'fp-1' },
  );
  const response = await provider.complete({
    role: 'Planner', system: 's', user: 'u', maxOutputTokens: 100,
    reasoningTier: 'low', reasoningReserveTokens: 16, reasoningPolicyVersion: 'reasoning-policy-1', ledger: LEDGER_META,
  });
  assert.equal(response.text, '{"ok":true}');
  const attempts = await store.listAttempts(LEDGER_META.logicalRequestId);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, 'succeeded');
  assert.equal(attempts[0].attemptNo, 1);
  assert.equal(attempts[0].attemptId, 'planner:branch-1:turn-1#a1');
  assert.equal(attempts[0].providerRequestId, 'prov-123');
  assert.equal(attempts[0].inputTokens, 100);
  assert.equal(attempts[0].outputTokens, 50);
  assert.equal(attempts[0].reasoningTokens, 8);
  assert.equal(attempts[0].reasoningTier, 'low');
  assert.equal(attempts[0].reasoningReserveTokens, 16);
  assert.equal(attempts[0].reasoningPolicyVersion, 'reasoning-policy-1');
  assert.equal(attempts[0].wireOutputTokens, 100);
  assert.equal(attempts[0].cachedInputTokens, 20);
  assert.equal(attempts[0].branchId, 'branch-1');
  assert.equal(attempts[0].stateVersion, 7);
  assert.ok(attempts[0].finishedAt >= attempts[0].startedAt);
});

test('ledger: sent -> failure records class and http status', async () => {
  const store = await ledgerStore();
  const failure = new LlmRequestFailure('LLM provider HTTP 500.', [{
    attempt: 1, durationMs: 10, httpStatus: 500, outcome: 'http_error', errorCategory: 'provider_http',
  }]);
  const provider = new LedgeredProvider(
    fakeProvider(async () => { throw failure; }),
    store,
    { modelProfileFingerprint: 'fp-1' },
  );
  await assert.rejects(provider.complete({ role: 'Planner', system: 's', user: 'u', maxOutputTokens: 100, ledger: LEDGER_META }));
  const attempts = await store.listAttempts(LEDGER_META.logicalRequestId);
  assert.equal(attempts[0].status, 'failed');
  assert.equal(attempts[0].failureClass, 'http_server');
  assert.equal(attempts[0].httpStatus, 500);
});

test('ledger: reasoning_only failure retains known token usage for calibration', async () => {
  const store = await ledgerStore();
  const failure = new LlmRequestFailure('reasoning-only', [
    {
      attempt: 1, durationMs: 10, httpStatus: 200, outcome: 'reasoning_only', completionState: 'reasoning_only',
      usage: { inputTokens: 100, outputTokens: 120, reasoningTokens: 110, cachedInputTokens: 20, estimated: false },
    },
    {
      attempt: 2, durationMs: 12, httpStatus: 200, outcome: 'reasoning_only', completionState: 'reasoning_only',
      usage: { inputTokens: 120, outputTokens: 150, reasoningTokens: 140, cachedInputTokens: 25, estimated: false },
    },
  ]);
  const provider = new LedgeredProvider(
    fakeProvider(async () => { throw failure; }),
    store,
    { modelProfileFingerprint: 'fp-1' },
  );
  await assert.rejects(provider.complete({
    role: 'Planner', system: 's', user: 'u', maxOutputTokens: 8_000,
    reasoningTier: 'high', reasoningReserveTokens: 8_192,
    reasoningPolicyVersion: 'reasoning-policy-1', ledger: LEDGER_META,
  }));
  const attempts = await store.listAttempts(LEDGER_META.logicalRequestId);
  assert.equal(attempts[0].failureClass, 'reasoning_only');
  assert.equal(attempts[0].inputTokens, 220);
  assert.equal(attempts[0].outputTokens, 270);
  assert.equal(attempts[0].reasoningTokens, 250);
  assert.equal(attempts[0].cachedInputTokens, 45);
  assert.equal(attempts[0].estimatedUsage, 0);
  assert.deepEqual(await store.listRecentReasoningTokens({
    modelProfileFingerprint: 'fp-1', reasoningTier: 'high', requestKind: LEDGER_META.requestKind, limit: 32,
  }), [250], 'failed but known reasoning usage remains a valid calibration sample');
});

test('ledger: retries increment attempt_no under one logical request', async () => {
  const store = await ledgerStore();
  let calls = 0;
  const provider = new LedgeredProvider(
    fakeProvider(async () => {
      calls += 1;
      if (calls === 1) {
        throw new LlmRequestFailure('simulated network failure', [{
          attempt: 1, durationMs: 5, httpStatus: null, outcome: 'transport_error', errorCategory: 'network',
        }]);
      }
      return { text: '{"ok":true}' };
    }),
    store,
    { modelProfileFingerprint: 'fp-1' },
  );
  await assert.rejects(provider.complete({ role: 'Planner', system: 's', user: 'u', maxOutputTokens: 100, ledger: LEDGER_META }));
  await provider.complete({ role: 'Planner', system: 's', user: 'u', maxOutputTokens: 100, ledger: LEDGER_META });
  const attempts = await store.listAttempts(LEDGER_META.logicalRequestId);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].attemptNo, 1);
  assert.equal(attempts[1].attemptNo, 2);
  assert.deepEqual(attempts.map(a => a.status), ['failed', 'succeeded']);
  assert.equal(attempts[0].failureClass, 'network_connect');
});

test('ledger: crash mid-flight -> cold start marks outcome_unknown and blocks replay', async () => {
  const store = await ledgerStore();
  // Simulate a crash: a row stuck in 'sent' with no terminal state.
  const attempt = await store.beginAttempt(
    { logicalRequestId: 'planner:branch-x:turn-9', requestKind: 'planner', branchId: 'branch-x', modelProfileFingerprint: 'fp' },
    1000,
  );
  await store.updateAttempt(attempt.attemptId, { status: 'sent' });

  const { recoveredAttemptIds } = await recoverInterruptedAttempts(store);
  assert.deepEqual(recoveredAttemptIds, [attempt.attemptId]);
  const after = (await store.listAttempts('planner:branch-x:turn-9'))[0];
  assert.equal(after.status, 'outcome_unknown');
  assert.equal(after.errorCode, 'interrupted_by_process_exit');

  const provider = new LedgeredProvider(
    fakeProvider(async () => ({ text: 'should not be called' })),
    store,
    { modelProfileFingerprint: 'fp' },
  );
  await assert.rejects(
    provider.complete({
      role: 'Planner', system: 's', user: 'u', maxOutputTokens: 100,
      ledger: { logicalRequestId: 'planner:branch-x:turn-9', requestKind: 'planner' },
    }),
    error => error instanceof OutcomeUnknownReplayError,
  );
  // No new attempt row was created by the blocked replay.
  assert.equal((await store.listAttempts('planner:branch-x:turn-9')).length, 1);
});

test('ledger: allowOutcomeUnknownReplay is an explicit operator escape hatch', async () => {
  const store = await ledgerStore();
  const attempt = await store.beginAttempt(
    { logicalRequestId: 'summarizer:b:t', requestKind: 'summarizer', modelProfileFingerprint: 'fp' },
    1,
  );
  await store.updateAttempt(attempt.attemptId, { status: 'sent' });
  await recoverInterruptedAttempts(store);
  const provider = new LedgeredProvider(
    fakeProvider(async () => ({ text: 'ok' })),
    store,
    { modelProfileFingerprint: 'fp', allowOutcomeUnknownReplay: true },
  );
  const response = await provider.complete({
    role: 'Summarizer', system: 's', user: 'u', maxOutputTokens: 10,
    ledger: { logicalRequestId: 'summarizer:b:t', requestKind: 'summarizer' },
  });
  assert.equal(response.text, 'ok');
});

test('ledger: requests without ledger metadata pass through unlogged', async () => {
  const store = await ledgerStore();
  let seen = null;
  const provider = new LedgeredProvider(
    fakeProvider(async request => { seen = request; return { text: 'plain' }; }),
    store,
    { modelProfileFingerprint: 'fp' },
  );
  await provider.complete({ role: 'WorldMapper', system: 's', user: 'u', maxOutputTokens: 10 });
  assert.equal(seen.role, 'WorldMapper');
  assert.equal((await store.listInterruptedAttemptIds()).length, 0);
});

test('ledger: migration 19 creates llm_request_attempts table', async () => {
  const adapter = new NodeSqliteAdapter(new DatabaseSync(':memory:'));
  const applied = await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  assert.ok(applied.includes(19));
  const row = await adapter.queryAll(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='llm_request_attempts'",
  );
  assert.equal(row.length, 1);
});

test('ledger migrations 22/23 preserve old rows and add tier-scoped usage policy metadata', async () => {
  const adapter = new NodeSqliteAdapter(new DatabaseSync(':memory:'));
  await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS.slice(0, 21));
  await adapter.execute(
    `INSERT INTO llm_request_attempts
       (attempt_id, logical_request_id, request_kind, model_profile_fingerprint, attempt_no, status, started_at)
     VALUES ('old#a1', 'old', 'planner', 'profile-a', 1, 'succeeded', 1)`,
  );
  const applied = await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS.slice(21));
  // v24 (stopped_user status rebuild) rides along; it preserves all rows too.
  assert.deepEqual(applied, [22, 23, 24]);

  const store = new SqliteLlmLedgerStore(adapter);
  const old = await store.listAttempts('old');
  assert.equal(old[0].reasoningTier, null, 'historical records remain unknown, not low');
  assert.equal(old[0].reasoningReserveTokens, null);
  assert.equal(old[0].reasoningPolicyVersion, null);
  assert.equal(old[0].wireOutputTokens, null);
  assert.equal(old[0].reasoningTokens, null, 'missing provider usage remains unknown');

  for (const [index, tier, value] of [
    [0, 'high', 500], [1, 'high', 900], [2, 'high', null], [3, 'low', 2_100],
  ]) {
    const attempt = await store.beginAttempt({
      logicalRequestId: `sample-${index}`,
      requestKind: 'planner',
      modelProfileFingerprint: 'profile-a',
      reasoningTier: tier,
    }, index + 10);
    await store.updateAttempt(attempt.attemptId, {
      status: 'succeeded',
      reasoningTokens: value,
      finishedAt: index + 10,
    });
  }
  assert.deepEqual(await store.listRecentReasoningTokens({
    modelProfileFingerprint: 'profile-a', reasoningTier: 'high', requestKind: 'planner', limit: 32,
  }), [900, 500], 'unknown usage is omitted and another tier is excluded');
});

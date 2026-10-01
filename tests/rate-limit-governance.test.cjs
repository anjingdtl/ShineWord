/**
 * Rate-limit governance (2026-10-01): adaptive scheduler penalties, request
 * spacing, Retry-After parsing, and the scheduled provider's 429 wiring.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const {
  GlobalRateScheduler,
} = require('../dist/application/worldBuild/rateScheduler');
const {
  RateScheduledProvider,
} = require('../dist/application/llm/scheduledProvider');
const {
  parseRetryAfterMs,
} = require('../dist/application/llm/openAICompatible');
const {
  LlmRequestFailure,
} = require('../dist/application/llm/types');

function makeScheduler() {
  let clock = 0;
  const waited = [];
  const scheduler = new GlobalRateScheduler({
    rpm: 1000,
    tpm: 10_000_000,
    maxConcurrent: 4,
    now: () => clock,
    sleep: async ms => { waited.push(ms); clock += ms; },
  });
  return { scheduler, getClock: () => clock, waited };
}

test('noteRateLimited grows an exponential penalty floor capped at 180s', () => {
  const { scheduler, getClock } = makeScheduler();
  const expected = [15_000, 30_000, 60_000, 120_000, 180_000, 180_000];
  for (const [index, ms] of expected.entries()) {
    const before = getClock();
    scheduler.noteRateLimited();
    assert.equal(
      scheduler.stats().retryAfterUntil,
      before + ms,
      `streak ${index + 1} should floor for ${ms}ms`,
    );
  }
  assert.equal(scheduler.stats().rateLimitStreak, 6);
});

test('provider Retry-After hint overrides the streak penalty when longer', () => {
  const { scheduler, getClock } = makeScheduler();
  const before = getClock();
  scheduler.noteRateLimited({ retryAfterMs: 45_000 });
  assert.equal(scheduler.stats().retryAfterUntil, before + 45_000);
});

test('acquire blocks during the penalty floor and then spaces grants apart', async () => {
  const { scheduler, getClock } = makeScheduler();
  scheduler.noteRateLimited(); // floor 15s, spacing -> 2s
  const before = getClock();
  const lease1 = await scheduler.acquire(100);
  assert.ok(getClock() >= before + 15_000, 'first grant waited out the floor');
  // Spacing: the next grant must wait the adaptive spacing (2s), not 0s.
  const mid = getClock();
  const lease2 = await scheduler.acquire(100);
  assert.ok(
    getClock() >= mid + scheduler.stats().adaptiveSpacingMs,
    `second grant spaced by ${scheduler.stats().adaptiveSpacingMs}ms`,
  );
  lease1.release();
  lease2.release();
});

test('spacing doubles on consecutive 429s and decays after successes', () => {
  const { scheduler } = makeScheduler();
  scheduler.noteRateLimited();
  assert.equal(scheduler.stats().adaptiveSpacingMs, 2_000);
  scheduler.noteRateLimited();
  assert.equal(scheduler.stats().adaptiveSpacingMs, 6_000);
  scheduler.noteRateLimited();
  scheduler.noteRateLimited();
  assert.equal(scheduler.stats().adaptiveSpacingMs, 30_000, 'spacing capped at 30s');
  scheduler.noteSuccess();
  assert.equal(scheduler.stats().adaptiveSpacingMs, 18_000);
  assert.equal(scheduler.stats().rateLimitStreak, 0, 'success resets the streak');
  scheduler.noteSuccess();
  scheduler.noteSuccess();
  scheduler.noteSuccess();
  assert.equal(scheduler.stats().adaptiveSpacingMs, 3_888, 'spacing decays 60% per success');
  scheduler.noteSuccess();
  scheduler.noteSuccess();
  scheduler.noteSuccess();
  assert.equal(scheduler.stats().adaptiveSpacingMs, 0, 'spacing fully relaxes');
});

test('scheduled provider feeds 429 metrics into the scheduler and notes success', async () => {
  const { scheduler } = makeScheduler();
  let calls = 0;
  const inner = {
    async complete() {
      calls += 1;
      if (calls === 1) {
        throw new LlmRequestFailure('HTTP 429', [{
          attempt: 1,
          durationMs: 30,
          httpStatus: 429,
          outcome: 'http_error',
          errorCategory: 'provider_http',
          retryAfterMs: 9_000,
        }]);
      }
      return { text: 'ok', usage: { inputTokens: 10, outputTokens: 5, estimated: false } };
    },
  };
  const provider = new RateScheduledProvider(inner, scheduler);

  await assert.rejects(() => provider.complete({
    role: 'Extractor', system: 's', user: 'u', maxOutputTokens: 64,
  }), /HTTP 429/);
  const after429 = scheduler.stats();
  assert.equal(after429.rateLimitStreak, 1, '429 metric grew the streak');
  assert.ok(after429.retryAfterUntil !== null, '429 pushed a penalty floor');
  assert.ok(after429.retryAfterUntil >= 9_000, 'provider Retry-After honored (>=9s)');

  // Advance the deterministic clock past the floor, then succeed.
  const response = await provider.complete({
    role: 'Extractor', system: 's', user: 'u', maxOutputTokens: 64,
  });
  assert.equal(response.text, 'ok');
  assert.equal(scheduler.stats().rateLimitStreak, 0, 'success reset the streak');
  assert.equal(scheduler.stats().inFlight, 0);
});

test('non-429 failures never pace the scheduler', async () => {
  const { scheduler } = makeScheduler();
  const inner = {
    async complete() {
      throw new LlmRequestFailure('HTTP 500', [{
        attempt: 1, durationMs: 10, httpStatus: 500,
        outcome: 'http_error', errorCategory: 'provider_http',
      }]);
    },
  };
  const provider = new RateScheduledProvider(inner, scheduler);
  await assert.rejects(() => provider.complete({
    role: 'Extractor', system: 's', user: 'u', maxOutputTokens: 64,
  }), /HTTP 500/);
  const stats = scheduler.stats();
  assert.equal(stats.rateLimitStreak, 0);
  assert.equal(stats.retryAfterUntil, null);
  assert.equal(stats.adaptiveSpacingMs, 0);
});

test('parseRetryAfterMs: seconds, HTTP-date, and garbage', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  assert.equal(parseRetryAfterMs({ 'retry-after': '30' }, now), 30_000);
  assert.equal(parseRetryAfterMs({ 'retry-after': '0' }, now), 0);
  const inAMinute = new Date(now + 60_000).toUTCString();
  assert.equal(parseRetryAfterMs({ 'retry-after': inAMinute }, now), 60_000);
  assert.equal(parseRetryAfterMs({ 'retry-after': 'soon' }, now), null);
  assert.equal(parseRetryAfterMs(undefined, now), null);
  assert.equal(parseRetryAfterMs({}, now), null);
});

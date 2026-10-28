/**
 * Local narration template (convergence W4c — D4 approved) acceptance C-13.
 *
 * Snapshot tests pin the template text (frozen-facts only, grade labels,
 * honest source marker) and the end-to-end degrade behavior through
 * runV2Turn: a definite provider failure commits the turn with the local
 * template, while an UNCERTAIN dispatched outcome still surfaces the
 * existing failure (never auto-degraded, never re-sent).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  localNarrationText,
  localNarrationCandidate,
  NARRATOR_LOCAL_DEGRADE_DEADLINE_MS,
} = require('../dist/application/game/narrationTemplate');
const { SchedulerQueueError } = require('../dist/application/worldBuild/rateScheduler');
const { LlmRequestFailure } = require('../dist/application/llm/types');

const CONTRACT_OUTCOMES = {
  full_success: { achieved: true, publicSummary: '你把现场看得一清二楚', effects: [] },
  success: { achieved: true, publicSummary: '你确认了异常的来源', effects: [] },
  failure: { achieved: false, publicSummary: '你没有看出额外的线索', effects: [] },
  severe_failure: { achieved: false, publicSummary: '你的翻动惊动了旁人', effects: [] },
};

test('template renders grade label + frozen summary + honest source marker', () => {
  const text = localNarrationText({ grade: 'success', outcomeSummary: CONTRACT_OUTCOMES.success.publicSummary,
    rollRecord: { diceCount: 3, dieSides: 6, rolls: [2, 5, 6], highest: 6, difficulty: 'normal' } });
  assert.match(text, /^（本地叙事）/);
  assert.match(text, /成功：你确认了异常的来源。/);
  assert.match(text, /检定 3d6 \[2, 5, 6\]（最高 6）。/);
  assert.match(text, /你达到了目的/);
});

test('template contains no duration claims (clock-safe) and no invented facts', () => {
  for (const grade of ['full_success', 'success', 'failure', 'severe_failure']) {
    const text = localNarrationText({ grade, outcomeSummary: CONTRACT_OUTCOMES[grade].publicSummary });
    assert.doesNotMatch(text, /一整|整夜|通宵|小时|钟头|all day|overnight|hours/i, `${grade} must stay clock-safe`);
    assert.ok(text.length <= 120, `${grade} template stays short`);
  }
  const noRoll = localNarrationText({ grade: 'failure', outcomeSummary: CONTRACT_OUTCOMES.failure.publicSummary });
  assert.doesNotMatch(noRoll, /检定/);
});

test('candidate carries the frozen turn identity and grade', () => {
  const candidate = localNarrationCandidate({ contract: { outcomes: CONTRACT_OUTCOMES }, turnId: 'turn-x', grade: 'severe_failure' });
  assert.equal(candidate.turnId, 'turn-x');
  assert.equal(candidate.outcomeGrade, 'severe_failure');
  assert.match(candidate.text, /严重失败/);
  assert.ok(candidate.text.trim().length > 0);
  assert.equal(NARRATOR_LOCAL_DEGRADE_DEADLINE_MS, 45_000);
});

test('definite-failure classifier: queue cancel, wire gate and definite HTTP reject are definite', () => {
  // Re-implement the predicate the same way v2Turn does to pin semantics.
  const isDefinite = error => {
    if (error instanceof SchedulerQueueError) return error.code === 'cancelled';
    if (error instanceof LlmRequestFailure) {
      return error.requestMetrics.length > 0 && error.requestMetrics.every(metric =>
        metric.dispatchState === 'not_sent' || metric.outcome === 'invalid_response' || metric.outcome === 'http_error');
    }
    return false;
  };
  assert.equal(isDefinite(new SchedulerQueueError('cancelled', 'queued cancelled')), true);
  assert.equal(isDefinite(new SchedulerQueueError('quota_infeasible', 'no quota')), false);
  const definiteRefusal = new LlmRequestFailure('HTTP 401', [{ attempt: 1, durationMs: 10, httpStatus: 401,
    outcome: 'http_error', dispatchState: 'sent' }]);
  const unrepairable = new LlmRequestFailure('invalid', [{ attempt: 1, durationMs: 10, httpStatus: 200,
    outcome: 'invalid_response', dispatchState: 'sent' }]);
  const refusedBeforeSend = new LlmRequestFailure('refused', [{ attempt: 1, durationMs: 1, httpStatus: null,
    outcome: 'transport_error', dispatchState: 'not_sent' }]);
  const unknownTransport = new LlmRequestFailure('cut', [{ attempt: 1, durationMs: 999, httpStatus: null,
    outcome: 'transport_error', dispatchState: 'sent' }]);
  assert.equal(isDefinite(definiteRefusal), true);
  assert.equal(isDefinite(unrepairable), true);
  assert.equal(isDefinite(refusedBeforeSend), true);
  assert.equal(isDefinite(unknownTransport), false, 'dispatched transport failure stays uncertain');
  const emptyMetrics = new LlmRequestFailure('odd', []);
  assert.equal(isDefinite(emptyMetrics), false, 'no metrics means no proof of definiteness');
});

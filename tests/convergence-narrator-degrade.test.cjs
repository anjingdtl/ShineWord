/**
 * Narrator degrade end-to-end (convergence W4c — D4 approved).
 *
 * Through the production CampaignSession.playTurn: a DEFINITE Narrator
 * failure (provider rejection / unrepairable response / pre-dispatch
 * refusal) commits the turn with the local template instead of failing;
 * an UNCERTAIN dispatched outcome keeps the existing hard failure (never
 * auto-degraded, never re-sent). C-13/C-15 automated halves.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, SITUATION_ID } = require('./helpers/phase9CampaignFixture.cjs');
const { LlmRequestFailure } = require('../dist/application/llm/types');

function modelWithPolicy(policy = { kind: 'fixed', band: 'normal' }, evidenceIds = []) {
  const model = candidateModel();
  const sweep = model.firstSituation.methods.find(method => method.methodId === 'sweep');
  sweep.difficultyPolicy = policy;
  sweep.evidencePolicy = policy.kind === 'planner_required'
    ? { kind: 'planner_required' }
    : { kind: 'fixed', evidenceIds };
  sweep.evidenceAllowlist = policy.kind === 'planner_required' ? [] : evidenceIds;
  return model;
}

function narratorFailure(kind) {
  if (kind === 'http_reject') {
    return new LlmRequestFailure('HTTP 429', [{ attempt: 1, durationMs: 12, httpStatus: 429,
      outcome: 'http_error', dispatchState: 'sent' }]);
  }
  if (kind === 'not_sent_refusal') {
    return new LlmRequestFailure('connection refused', [{ attempt: 1, durationMs: 2, httpStatus: null,
      outcome: 'transport_error', dispatchState: 'not_sent' }]);
  }
  // uncertain: dispatched transport cut — must NOT degrade
  return new LlmRequestFailure('socket cut', [{ attempt: 1, durationMs: 90_000, httpStatus: null,
    outcome: 'transport_error', dispatchState: 'sent' }]);
}

async function playOneTurn(h) {
  const guidance = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId,
    branchId: h.branchId, sourceTurnId: 'opening', localOnly: true });
  const step = guidance.steps.find(item => item.candidateRef === `method:${SITUATION_ID}:sweep`);
  return h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
    intent: step.firstStepIntent,
    guidanceChoice: { decisionPoint: guidance.decisionPoint, candidateRef: step.candidateRef } });
}

for (const kind of ['http_reject', 'not_sent_refusal']) {
  test(`definite Narrator failure (${kind}) degrades to the local template and still commits`, async t => {
    let narratorAttempts = 0;
    const h = await fixture({
      model: modelWithPolicy({ kind: 'fixed', band: 'normal' }, []),
      includeGuidance: true,
      provider: {
        async complete(request) {
          if (request.role === 'Narrator') {
            narratorAttempts += 1;
            throw narratorFailure(kind);
          }
          const value = JSON.parse(request.user);
          if (request.role === 'Planner') {
            return { text: JSON.stringify({ proposalVersion: '2.0', turnId: value.turnId,
              expectedStateVersion: value.expectedStateVersion, actorId: 'pc', actionKind: 'skill_check',
              skillId: 'skill-observation', difficultyBand: 'normal', evidenceIds: [],
              intent: value.playerIntent, candidateRef: `method:${SITUATION_ID}:sweep` }) };
          }
          throw new Error('unexpected role ' + request.role);
        },
      },
    });
    t.after(() => h.db.close());
    const turn = await playOneTurn(h);
    assert.ok(turn.turnId);
    assert.match(turn.text, /^（本地叙事）/, 'committed narrative is the honest local template');
    assert.ok(turn.grade, 'roll grade still settled');
    const committed = await h.turns.listCommittedTurns(h.branchId);
    assert.ok(committed.some(entry => entry.turnId === turn.turnId), 'turn committed through the normal boundary');
    assert.equal(narratorAttempts, 1, 'narrator attempted exactly once; degrade never re-sends');
  });
}

test('uncertain dispatched Narrator outcome is NOT auto-degraded', async t => {
  const h = await fixture({
    model: modelWithPolicy({ kind: 'fixed', band: 'normal' }, []),
    includeGuidance: true,
    provider: {
      async complete(request) {
        if (request.role === 'Narrator') throw narratorFailure('unknown_transport');
        throw new Error('unexpected role ' + request.role);
      },
    },
  });
  t.after(() => h.db.close());
  const committedBefore = (await h.turns.listCommittedTurns(h.branchId)).length;
  await assert.rejects(() => playOneTurn(h), /socket cut|Narrator|transport/i,
    'uncertain narrator failure still fails the turn into the existing recovery flow');
  const committedAfter = (await h.turns.listCommittedTurns(h.branchId)).length;
  assert.equal(committedAfter, committedBefore, 'no turn committed on the unknown path');
});

test('healthy Narrator journey is unchanged by the degrade wiring', async t => {
  let narratorCalls = 0;
  const h = await fixture({
    model: modelWithPolicy({ kind: 'fixed', band: 'normal' }, []),
    includeGuidance: true,
    provider: {
      async complete(request) {
        const value = JSON.parse(request.user);
        if (request.role === 'Narrator') {
          narratorCalls += 1;
          return { text: JSON.stringify({ turnId: value.turnId, outcomeGrade: value.outcomeGrade,
            text: `叙事：${value.turnId}` }) };
        }
        throw new Error('unexpected role ' + request.role);
      },
    },
  });
  t.after(() => h.db.close());
  const turn = await playOneTurn(h);
  assert.equal(narratorCalls, 1);
  assert.doesNotMatch(turn.text, /（本地叙事）/, 'model narrative used when the provider is healthy');
});

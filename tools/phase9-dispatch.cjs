/** Budget-enforced QA HTTP adapter shared by host drivers and device proxies. */
const { postQaHttp } = require('./phase9-http.cjs');
const budgetAuthority = require('./phase9-budget.cjs');
const { HttpRequestNotSentError } = require('../dist/application/llm/openAICompatible');

function createBudgetedHttpTransport({ owner = 'host:phase9', budget = budgetAuthority, onMetric = () => {} } = {}) {
  return {
    async post(request) {
      const reservationId = budget.reservePhysicalRequest({ owner,
        requestKind: request.requestKind ?? 'unknown', logicalRequestId: request.logicalRequestId,
        attemptId: request.attemptId, attemptNo: request.attemptNo, campaignId: request.campaignId,
        branchId: request.branchId, worldId: request.worldId, stateVersion: request.stateVersion,
        profileFingerprint: request.profileFingerprint });
      let dispatched = false;
      try {
        const response = await postQaHttp({ url: request.url, headers: request.headers, body: request.body,
          timeoutMs: request.timeoutMs, streamActivityTimeoutMs: request.streamActivityTimeoutMs,
          onDispatch: () => { dispatched = true; budget.markPhysicalRequestDispatched(reservationId); } });
        budget.finishPhysicalRequest(reservationId, { outcome: 'completed', httpStatus: response.status,
          frameCount: response.timings.streamFrameCount, maxFrameGapMs: response.timings.maxStreamFrameGapMs });
        try { onMetric({ reservationId, requestKind: request.requestKind ?? 'unknown', status: response.status,
          elapsedMs: response.timings.completeResponseMs, streamFrameCount: response.timings.streamFrameCount ?? 0,
          firstStreamFrameMs: response.timings.firstStreamFrameMs ?? null,
          maxStreamFrameGapMs: response.timings.maxStreamFrameGapMs ?? null,
          streamActivityMonitored: response.timings.streamActivityMonitored ?? false }); } catch { /* metrics are not transport */ }
        return response;
      } catch (error) {
        const notSent = error instanceof HttpRequestNotSentError;
        try {
          budget.finishPhysicalRequest(reservationId, { outcome: notSent ? 'not_sent' : 'outcome_unknown',
            failureClass: notSent ? 'not_sent' : error?.name ?? 'unknown' });
        } catch { /* unresolved reservation remains a budget-consuming checkpoint */ }
        try { onMetric({ reservationId, requestKind: request.requestKind ?? 'unknown', status: null,
          elapsedMs: null, dispatchState: notSent ? 'not_sent' : dispatched ? 'sent_unknown' : 'unknown' }); } catch { /* telemetry is not transport */ }
        throw error;
      }
    },
  };
}

module.exports = { createBudgetedHttpTransport };

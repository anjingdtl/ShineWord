/** Dedicated emulator QA proxy backed by the same physical budget as host drivers. */
const http = require('node:http');
const { postQaHttp } = require('./phase9-http.cjs');
const defaultBudget = require('./phase9-budget.cjs');

function createQaProxy({ endpoint, budget = defaultBudget, reserve, log = () => {}, timeoutMs = 1_200_000,
  streamActivityTimeoutMs = 60_000 } = {}) {
  if (typeof endpoint !== 'string' || !/^https?:\/\//i.test(endpoint)) throw new Error('Phase 9 proxy endpoint is invalid.');
  endpoint = endpoint.replace(/\/+$/, '');
  // `reserve` remains as a narrow test seam for legacy proxy unit tests. Real
  // device launches always use the shared authority and full lifecycle audit.
  const legacyReserve = typeof reserve === 'function' ? reserve : null;
  const report = metric => { try { log({ at: new Date().toISOString(), ...metric }); } catch { /* telemetry is not transport */ } };
  return http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/chat/completions') { res.writeHead(404); res.end(); return; }
    let reservationId = null;
    let dispatched = false;
    const started = Date.now();
    res.on('close', () => {
      if (!res.writableFinished) report({ phase: 'downstream_closed', dispatched, ms: Date.now() - started });
    });
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const requestBody = Buffer.concat(chunks);
      const kind = String(req.headers['x-phase9-request-kind'] || 'android_unknown');
      try {
        if (legacyReserve) legacyReserve(kind);
        else reservationId = budget.reservePhysicalRequest({ owner: 'android:phase9-proxy', requestKind: kind,
          logicalRequestId: req.headers['x-phase9-logical-request-id'],
          attemptId: req.headers['x-phase9-attempt-id'],
          attemptNo: Number.isInteger(Number(req.headers['x-phase9-attempt-no'])) ? Number(req.headers['x-phase9-attempt-no']) : undefined,
          campaignId: req.headers['x-phase9-campaign-id'], branchId: req.headers['x-phase9-branch-id'],
          worldId: req.headers['x-phase9-world-id'],
          stateVersion: Number.isInteger(Number(req.headers['x-phase9-state-version'])) ? Number(req.headers['x-phase9-state-version']) : undefined,
          profileFingerprint: req.headers['x-phase9-profile-fingerprint'] });
      } catch {
        report({ status: 429, failure: 'qa_dispatch_denied', dispatched: false });
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'QA request reservation denied before upstream dispatch' }));
        return;
      }
      let parsed;
      try { parsed = JSON.parse(requestBody.toString('utf8')); } catch { parsed = null; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        if (reservationId) budget.finishPhysicalRequest(reservationId, { outcome: 'not_sent', failureClass: 'invalid_request' });
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"invalid request"}'); return;
      }

      const streaming = parsed.stream === true;
      const response = await postQaHttp({
        url: `${endpoint}/chat/completions`,
        headers: { 'Content-Type': 'application/json', ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) },
        body: requestBody,
        timeoutMs,
        ...(streaming ? { streamActivityTimeoutMs } : {}),
        onDispatch: () => {
          dispatched = true;
          if (reservationId) budget.markPhysicalRequestDispatched(reservationId);
        },
        onHeaders: ({ status, headers, responseHeadersMs }) => {
          res.writeHead(status, { 'Content-Type': headers['content-type'] || 'application/json',
            ...(headers['retry-after'] ? { 'Retry-After': headers['retry-after'] } : {}) });
          report({ phase: 'response_headers', status, responseHeadersMs, dispatched: true });
        },
        onChunk: chunk => { if (!res.destroyed) res.write(chunk); },
      });
      if (reservationId) budget.finishPhysicalRequest(reservationId, { outcome: 'completed', httpStatus: response.status,
        frameCount: response.timings.streamFrameCount, maxFrameGapMs: response.timings.maxStreamFrameGapMs });
      res.end();
      report({ phase: 'completed', status: response.status, bytes: Buffer.byteLength(response.body), dispatched: true,
        frameCount: response.timings.streamFrameCount ?? 0, maxFrameGapMs: response.timings.maxStreamFrameGapMs ?? null,
        streamActivityMonitored: response.timings.streamActivityMonitored ?? false, ms: Date.now() - started });
    } catch (error) {
      if (reservationId) {
        try {
          const notSent = error?.name === 'HttpRequestNotSentError';
          budget.finishPhysicalRequest(reservationId, { outcome: notSent ? 'not_sent' : 'outcome_unknown',
            failureClass: notSent ? 'not_sent' : error?.name || 'unknown' });
        } catch { /* reservation stays unresolved and therefore reserved against the cap */ }
      }
      // Never return a synthetic retryable response once upstream dispatch may
      // have happened: the production request ledger must observe uncertainty.
      report({ status: null, failure: dispatched ? 'qa_transport_unknown' : 'qa_input_or_preflight_failed',
        dispatched, ms: Date.now() - started });
      if (!res.destroyed) res.destroy();
    }
  });
}

module.exports = { createQaProxy };

if (require.main === module) {
  const fs = require('node:fs');
  const budgetModule = require('./phase9-budget.cjs');
  const manifest = process.env.PHASE9_BUDGET_SCOPE_FILE
    ? budgetModule.readScopedBudgetManifest(process.env.PHASE9_BUDGET_SCOPE_FILE)
    : budgetModule.readManifest();
  const endpoint = manifest.inputs?.llm?.endpoint;
  if (typeof endpoint !== 'string' || !/^https?:\/\//i.test(endpoint)) {
    throw new Error('Phase 9 QA proxy endpoint is missing from the selected budget manifest.');
  }
  const server = createQaProxy({ endpoint, budget: budgetModule, log: metric => console.log(JSON.stringify(metric)) });
  const port = Number(process.env.PHASE9_PROXY_PORT || 18591);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Phase 9 QA proxy port is invalid.');
  server.listen(port, '0.0.0.0', () => {
    const current = budgetModule.readManifest();
    const used = current.spentPhysicalRequests ?? current.budget?.spent;
    const cap = current.capPhysicalRequests ?? current.budget?.hardStop;
    console.log(`Phase9 QA proxy ready on port ${port}; scoped requests ${used}/${cap}; credentials and request content are never logged.`);
  });
}

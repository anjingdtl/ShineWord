/** QA HTTP transport with hard and complete-SSE-frame activity deadlines. */
const http = require('node:http');
const https = require('node:https');
const { StringDecoder } = require('node:string_decoder');
const { HttpRequestTimeoutError, HttpRequestNotSentError } = require('../dist/application/llm/openAICompatible');
const { SseFrameMonitor } = require('../dist/application/llm/sseFrameMonitor');

const DEFINITELY_NOT_SENT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ERR_INVALID_URL']);
function definitelyNotSent(error) { return Boolean(error && DEFINITELY_NOT_SENT.has(error.code)); }

function postQaHttp({ url, headers, body, timeoutMs, streamActivityTimeoutMs, onHeaders, onChunk, onSseFrame, onDispatch }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1_200_000) throw Error('Invalid QA HTTP hard deadline');
  if (streamActivityTimeoutMs !== undefined && (!Number.isInteger(streamActivityTimeoutMs)
    || streamActivityTimeoutMs < 1 || streamActivityTimeoutMs > timeoutMs)) throw Error('Invalid QA SSE activity deadline');
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol)) throw Error('Invalid QA HTTP protocol');
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let settled = false, timer, idleTimer, dispatched = false, responseReceived = false, sseResponse = false;
    let responseHeadersMs = null, firstBodyByteMs = null;
    const chunks = [];
    const decoder = new StringDecoder('utf8');
    const monitor = new SseFrameMonitor(started, atMs => {
      resetIdle();
      try { onSseFrame?.({ frameCount: monitor.summary().frameCount, atMs, elapsedMs: atMs - started }); }
      catch { /* audit callbacks must not alter upstream I/O */ }
    });
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(idleTimer);
      if (error) reject(error); else resolve(result);
    };
    const markDispatched = () => {
      if (dispatched) return;
      dispatched = true;
      try { onDispatch?.(); }
      catch (error) { finish(error); request.destroy(); }
    };
    const resetIdle = () => {
      if (streamActivityTimeoutMs === undefined || !sseResponse || settled) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const error = new HttpRequestTimeoutError(streamActivityTimeoutMs, 'sse_idle');
        finish(error); request.destroy(error);
      }, streamActivityTimeoutMs);
    };
    if (streamActivityTimeoutMs !== undefined) {
      // The no-frame budget starts at dispatch and remains active until the
      // response headers prove this was not an SSE response.
      idleTimer = setTimeout(() => {
        const error = new HttpRequestTimeoutError(streamActivityTimeoutMs, 'sse_idle');
        finish(error); request.destroy(error);
      }, streamActivityTimeoutMs);
    }
    const request = (target.protocol === 'https:' ? https : http).request(target,
      { method: 'POST', headers }, response => {
        responseReceived = true;
        markDispatched();
        responseHeadersMs = Date.now() - started;
        const responseHeaders = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value ?? '']));
        sseResponse = streamActivityTimeoutMs !== undefined && responseHeaders['content-type']?.toLowerCase().includes('text/event-stream') === true;
        if (sseResponse) resetIdle(); else clearTimeout(idleTimer);
        try { onHeaders?.({ status: response.statusCode, headers: responseHeaders, responseHeadersMs }); }
        catch { /* forwarding telemetry cannot change the upstream outcome */ }
        response.on('data', chunk => {
          if (firstBodyByteMs === null) firstBodyByteMs = Date.now() - started;
          chunks.push(chunk);
          try { onChunk?.(chunk); } catch { /* forwarding telemetry cannot change the upstream outcome */ }
          if (sseResponse) monitor.push(decoder.write(chunk), Date.now());
        });
        response.on('error', error => finish(error));
        response.on('aborted', () => finish(new Error('QA HTTP response aborted')));
        response.on('end', () => {
          if (sseResponse) monitor.push(decoder.end(), Date.now());
          finish(null, { status: response.statusCode,
            headers: responseHeaders,
            body: Buffer.concat(chunks).toString('utf8'),
            timings: { responseHeadersMs, firstBodyByteMs, completeResponseMs: Date.now() - started,
              ...(streamActivityTimeoutMs !== undefined ? { streamFrameCount: monitor.summary().frameCount,
                firstStreamFrameMs: monitor.summary().firstFrameMs,
                maxStreamFrameGapMs: monitor.summary().maxFrameGapMs,
                streamActivityMonitored: sseResponse } : {}),
              dispatchState: 'sent' } });
        });
      });
    timer = setTimeout(() => {
      const error = new HttpRequestTimeoutError(timeoutMs, 'absolute');
      // Settle before destroy triggers response-aborted, preserving the actual deadline kind.
      finish(error); request.destroy(error);
    }, timeoutMs);
    request.on('finish', markDispatched);
    request.on('error', error => {
      if (!dispatched && !responseReceived && definitelyNotSent(error)) {
        finish(new HttpRequestNotSentError('QA transport could not connect; no upstream request was sent.'));
      } else finish(error);
    });
    // The hard timer covers connect, headers and the full body; the idle timer
    // is reset only by complete SSE event boundaries, never by arbitrary chunks.
    request.end(body);
  });
}
module.exports = { postQaHttp, definitelyNotSent };

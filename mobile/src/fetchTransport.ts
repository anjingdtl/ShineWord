import type {
  HttpRequest,
  HttpResponse,
  HttpTransport,
} from '../../src/application/llm/openAICompatible';
import { acquireLlmExecution } from './llmExecutionBridge';
import { HttpRequestTimeoutError } from '../../src/application/llm/httpErrors';
import { SseFrameMonitor } from '../../src/application/llm/sseFrameMonitor';
import { decodeUtf8 } from '../../src/application/llm/utf8';

interface StreamingResponseBody {
  getReader?: () => {
    read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  };
}

function monitorSseBytes(monitor: SseFrameMonitor, bytes: Uint8Array, atMs: number): void {
  // SSE separators are ASCII. The event monitor only needs to distinguish CR
  // and LF; all other bytes simply make the current line non-empty.
  let runStart = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!;
    if (byte !== 0x0a && byte !== 0x0d) continue;
    if (index > runStart) monitor.push('x', atMs);
    monitor.push(byte === 0x0d ? '\r' : '\n', atMs);
    runStart = index + 1;
  }
  if (runStart < bytes.length) monitor.push('x', atMs);
}

function joinBytes(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

function parseXhrHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return headers;
}

function providerQueueMsFrom(headers: Record<string, string>): number | null {
  const serverTiming = headers['server-timing'];
  const queueMatch = serverTiming?.match(/(?:queue|queued|wait)[^,;]*;dur=([0-9.]+)/i);
  const queueHeader = headers['x-queue-time-ms'] ?? headers['x-request-queue-ms'];
  return queueMatch
    ? Number(queueMatch[1])
    : queueHeader && /^\d+(?:\.\d+)?$/.test(queueHeader) ? Number(queueHeader) : null;
}

export class FetchHttpTransport implements HttpTransport {
  async post(request: HttpRequest): Promise<HttpResponse> {
    const releaseExecution = await acquireLlmExecution(request);
    const startedAt = Date.now();
    const controller = new AbortController();
    let abortRequest = (): void => controller.abort();
    let deadlineError: HttpRequestTimeoutError | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const hardTimer = setTimeout(() => {
      deadlineError = new HttpRequestTimeoutError(request.timeoutMs, 'absolute');
      abortRequest();
    }, request.timeoutMs);
    const clearIdle = (): void => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = undefined;
    };
    const resetIdle = (): void => {
      clearIdle();
      if (request.streamActivityTimeoutMs === undefined) return;
      idleTimer = setTimeout(() => {
        deadlineError = new HttpRequestTimeoutError(request.streamActivityTimeoutMs!, 'sse_idle');
        abortRequest();
      }, request.streamActivityTimeoutMs);
    };
    if (request.streamActivityTimeoutMs !== undefined) resetIdle();
    try {
      const transportHeaders: Record<string, string> = { ...request.headers };
      let target: URL | null = null;
      try { target = new URL(request.url); } catch { /* fetch will report the stable transport error */ }
      const qaProxy = target && ['18591', '18691'].includes(target.port)
        && ['localhost', '127.0.0.1', '10.0.2.2'].includes(target.hostname);
      if (qaProxy) {
        const internal: Array<[string, string | number | undefined]> = [
          ['x-phase9-request-kind', request.requestKind],
          ['x-phase9-logical-request-id', request.logicalRequestId],
          ['x-phase9-attempt-id', request.attemptId],
          ['x-phase9-attempt-no', request.attemptNo],
          ['x-phase9-campaign-id', request.campaignId],
          ['x-phase9-branch-id', request.branchId],
          ['x-phase9-world-id', request.worldId],
          ['x-phase9-state-version', request.stateVersion],
          ['x-phase9-profile-fingerprint', request.profileFingerprint],
        ];
        for (const [name, value] of internal) if (value !== undefined) transportHeaders[name] = String(value);
      }

      // React Native's fetch response is buffered, while its XHR implementation
      // emits incremental responseText through onprogress. Route requests that
      // opted into SSE activity deadlines through XHR so only complete event
      // frames renew the idle deadline on the actual Android transport.
      if (request.streamActivityTimeoutMs !== undefined && typeof XMLHttpRequest !== 'undefined') {
        const Xhr = XMLHttpRequest;
        const response = await new Promise<HttpResponse>((resolve, reject) => {
          const xhr = new Xhr();
          abortRequest = () => xhr.abort();
          let settled = false;
          let responseHeadersMs: number | null = null;
          let firstBodyByteMs: number | null = null;
          let headers: Record<string, string> = {};
          let expectsSse = false;
          let consumedLength = 0;
          let streamActivityMonitored = false;
          const monitor = new SseFrameMonitor(startedAt, resetIdle);
          const settleError = (error: unknown): void => {
            if (settled) return;
            settled = true;
            reject(error);
          };
          const updateHeaders = (): void => {
            if (responseHeadersMs !== null || xhr.readyState < XMLHttpRequest.HEADERS_RECEIVED) return;
            responseHeadersMs = Math.max(0, Date.now() - startedAt);
            headers = parseXhrHeaders(xhr.getAllResponseHeaders() ?? '');
            expectsSse = (headers['content-type']?.toLowerCase() ?? '').includes('text/event-stream');
            if (!expectsSse) clearIdle();
          };
          const consumeNewText = (incremental: boolean): void => {
            let text: string;
            try { text = xhr.responseText ?? ''; } catch { return; }
            if (text.length <= consumedLength) return;
            const delta = text.slice(consumedLength);
            consumedLength = text.length;
            if (firstBodyByteMs === null) firstBodyByteMs = Math.max(0, Date.now() - startedAt);
            if (expectsSse) {
              if (incremental) streamActivityMonitored = true;
              monitor.push(delta, Date.now());
            }
          };
          const finish = (): void => {
            if (settled || xhr.readyState !== XMLHttpRequest.DONE) return;
            if (xhr.status === 0) {
              settleError(new TypeError('Network request failed'));
              return;
            }
            updateHeaders();
            consumeNewText(false);
            settled = true;
            clearIdle();
            const streamSummary = monitor.summary();
            resolve({
              status: xhr.status,
              body: xhr.responseText ?? '',
              headers,
              timings: {
                localQueueMs: null,
                responseHeadersMs: responseHeadersMs ?? Math.max(0, Date.now() - startedAt),
                firstBodyByteMs,
                completeResponseMs: Math.max(0, Date.now() - startedAt),
                providerQueueMs: providerQueueMsFrom(headers),
                streamFrameCount: streamSummary.frameCount,
                firstStreamFrameMs: streamSummary.firstFrameMs,
                maxStreamFrameGapMs: streamSummary.maxFrameGapMs,
                streamActivityMonitored,
              },
            });
          };
          xhr.open('POST', request.url, true);
          for (const [name, value] of Object.entries(transportHeaders)) xhr.setRequestHeader(name, value);
          xhr.onreadystatechange = () => {
            updateHeaders();
            if (xhr.readyState === XMLHttpRequest.LOADING) consumeNewText(true);
            finish();
          };
          xhr.onprogress = () => {
            updateHeaders();
            if (xhr.readyState < XMLHttpRequest.DONE) consumeNewText(true);
            finish();
          };
          xhr.onload = finish;
          xhr.onerror = () => settleError(new TypeError('Network request failed'));
          xhr.onabort = () => settleError(Object.assign(new Error('The request was aborted.'), { name: 'AbortError' }));
          xhr.ontimeout = () => settleError(new TypeError('Network request timed out'));
          try { xhr.send(request.body); } catch (error) { settleError(error); }
        });
        if (deadlineError) throw deadlineError;
        return response;
      }

      const response = await fetch(request.url, {
        method: 'POST',
        headers: transportHeaders,
        body: request.body,
        signal: controller.signal,
      });
      const responseHeadersMs = Math.max(0, Date.now() - startedAt);
      const headers: Record<string, string> = {};
      response.headers?.forEach((value, key) => { headers[key] = value; });
      const providerQueueMs = providerQueueMsFrom(headers);

      const contentType = headers['content-type']?.toLowerCase() ?? '';
      const expectsSse = request.streamActivityTimeoutMs !== undefined && contentType.includes('text/event-stream');
      const streamBody = (response as unknown as { body?: StreamingResponseBody | null }).body;
      const reader = expectsSse ? streamBody?.getReader?.() : undefined;
      let body = '';
      let streamActivityMonitored = false;
      const monitor = new SseFrameMonitor(startedAt, resetIdle);
      if (expectsSse && reader) {
        streamActivityMonitored = true;
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          if (!part.value) continue;
          chunks.push(part.value);
          totalBytes += part.value.length;
          monitorSseBytes(monitor, part.value, Date.now());
        }
        body = decodeUtf8(joinBytes(chunks, totalBytes));
      } else {
        // Some React Native fetch implementations expose only a buffered body.
        // Keep the hard cap, but never pretend that buffered bytes are SSE frames.
        clearIdle();
        body = await response.text();
      }
      if (deadlineError) throw deadlineError;
      const streamSummary = monitor.summary();
      return {
        status: response.status,
        body,
        headers,
        timings: {
          // Fetch does not expose connection-pool queueing or token-level
          // streaming. When a body reader exists these fields describe actual
          // complete SSE event boundaries, not arbitrary network chunks.
          localQueueMs: null,
          responseHeadersMs,
          firstBodyByteMs: null,
          completeResponseMs: Math.max(0, Date.now() - startedAt),
          providerQueueMs,
          ...(request.streamActivityTimeoutMs !== undefined ? {
            streamFrameCount: streamSummary.frameCount,
            firstStreamFrameMs: streamSummary.firstFrameMs,
            maxStreamFrameGapMs: streamSummary.maxFrameGapMs,
            streamActivityMonitored,
          } : {}),
        },
      };
    } catch (error) {
      if (deadlineError) throw deadlineError;
      throw error;
    } finally {
      clearTimeout(hardTimer);
      clearIdle();
      releaseExecution();
    }
  }
}

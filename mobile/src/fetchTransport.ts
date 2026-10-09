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

export class FetchHttpTransport implements HttpTransport {
  async post(request: HttpRequest): Promise<HttpResponse> {
    const releaseExecution = await acquireLlmExecution(request);
    const startedAt = Date.now();
    const controller = new AbortController();
    let deadlineError: HttpRequestTimeoutError | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const hardTimer = setTimeout(() => {
      deadlineError = new HttpRequestTimeoutError(request.timeoutMs, 'absolute');
      controller.abort();
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
        controller.abort();
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
      const response = await fetch(request.url, {
        method: 'POST',
        headers: transportHeaders,
        body: request.body,
        signal: controller.signal,
      });
      const responseHeadersMs = Math.max(0, Date.now() - startedAt);
      const headers: Record<string, string> = {};
      response.headers?.forEach((value, key) => { headers[key] = value; });
      const serverTiming = headers['server-timing'];
      const queueMatch = serverTiming?.match(/(?:queue|queued|wait)[^,;]*;dur=([0-9.]+)/i);
      const queueHeader = headers['x-queue-time-ms'] ?? headers['x-request-queue-ms'];
      const providerQueueMs = queueMatch
        ? Number(queueMatch[1])
        : queueHeader && /^\d+(?:\.\d+)?$/.test(queueHeader) ? Number(queueHeader) : null;

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

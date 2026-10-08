import type {
  HttpRequest,
  HttpResponse,
  HttpTransport,
} from '../../src/application/llm/openAICompatible';
import { acquireLlmExecution } from './llmExecutionBridge';
import { HttpRequestTimeoutError } from '../../src/application/llm/httpErrors';

export class FetchHttpTransport implements HttpTransport {
  async post(request: HttpRequest): Promise<HttpResponse> {
    const releaseExecution = await acquireLlmExecution(request);
    const startedAt = Date.now();
    const controller = new AbortController();
    let deadlineElapsed = false;
    const timer = setTimeout(() => { deadlineElapsed = true; controller.abort(); }, request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      const responseHeadersMs = Math.max(0, Date.now() - startedAt);
      const body = await response.text();
      // Some fetch implementations finish despite an abort. Such a late body
      // cannot turn an expired physical request into a trusted completion.
      if (deadlineElapsed) throw new HttpRequestTimeoutError(request.timeoutMs);
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const serverTiming = headers['server-timing'];
      const queueMatch = serverTiming?.match(/(?:queue|queued|wait)[^,;]*;dur=([0-9.]+)/i);
      const queueHeader = headers['x-queue-time-ms'] ?? headers['x-request-queue-ms'];
      const providerQueueMs = queueMatch
        ? Number(queueMatch[1])
        : queueHeader && /^\d+(?:\.\d+)?$/.test(queueHeader) ? Number(queueHeader) : null;
      return {
        status: response.status,
        body,
        headers,
        timings: {
          // Fetch does not expose connection-pool queueing or token-level
          // streaming here. Keep those fields null instead of relabeling the
          // combined network/server wait as a narrower phase.
          localQueueMs: null,
          responseHeadersMs,
          firstBodyByteMs: null,
          completeResponseMs: Math.max(0, Date.now() - startedAt),
          providerQueueMs,
        },
      };
    } catch (error) {
      if (deadlineElapsed) throw new HttpRequestTimeoutError(request.timeoutMs);
      throw error;
    } finally {
      clearTimeout(timer);
      releaseExecution();
    }
  }
}

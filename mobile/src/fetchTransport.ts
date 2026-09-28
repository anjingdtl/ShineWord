import type {
  HttpRequest,
  HttpResponse,
  HttpTransport,
} from '../../src/application/llm/openAICompatible';

export class FetchHttpTransport implements HttpTransport {
  async post(request: HttpRequest): Promise<HttpResponse> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      const responseHeadersMs = Math.max(0, Date.now() - startedAt);
      const body = await response.text();
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
      if (controller.signal.aborted) throw new Error('LLM request timed out.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

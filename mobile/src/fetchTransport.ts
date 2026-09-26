import type {
  HttpRequest,
  HttpResponse,
  HttpTransport,
} from '../../src/application/llm/openAICompatible';

export class FetchHttpTransport implements HttpTransport {
  async post(request: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return { status: response.status, body, headers };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('LLM request timed out.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

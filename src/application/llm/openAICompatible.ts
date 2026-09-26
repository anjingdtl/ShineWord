import type {
  ApiProfile,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  SecretStore,
} from './types';

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

export interface HttpTransport {
  post(request: HttpRequest): Promise<HttpResponse>;
}

interface OpenAIResponseShape {
  id?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
  error?: {
    message?: string;
  };
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(trimmed) && !/^http:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(trimmed)) {
    throw new Error('LLM endpoint must use HTTPS unless it is an explicit local/private endpoint.');
  }
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

function messageText(
  content: string | Array<{ type?: string; text?: string }> | undefined,
): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => (part && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

export class OpenAICompatibleProvider implements LlmProvider {
  constructor(
    private readonly profile: ApiProfile,
    private readonly secrets: SecretStore,
    private readonly transport: HttpTransport,
    private readonly timeoutMs = 60_000,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const apiKey = await this.secrets.get(this.profile.keyRef);
    if (!apiKey) throw new Error('LLM API key is missing from secure storage.');

    const maxTokens = Math.min(
      request.maxOutputTokens,
      this.profile.capabilities.maxOutputTokens,
    );
    if (!Number.isInteger(maxTokens) || maxTokens < 1) {
      throw new Error('maxOutputTokens must resolve to a positive integer.');
    }

    const body: Record<string, unknown> = {
      model: this.profile.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      max_tokens: maxTokens,
      stream: false,
    };
    if (request.jsonMode && this.profile.capabilities.supportsJson) {
      body.response_format = { type: 'json_object' };
    }

    const response = await this.transport.post({
      url: normalizeEndpoint(this.profile.endpoint),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      timeoutMs: this.timeoutMs,
    });

    let parsed: OpenAIResponseShape;
    try {
      parsed = JSON.parse(response.body) as OpenAIResponseShape;
    } catch {
      throw new Error(`LLM provider returned non-JSON HTTP body (status ${response.status}).`);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(parsed.error?.message || `LLM provider HTTP ${response.status}.`);
    }

    const text = messageText(parsed.choices?.[0]?.message?.content);
    if (!text.trim()) throw new Error('LLM provider returned an empty completion.');

    return {
      text,
      requestId: parsed.id,
      usage: parsed.usage
        ? {
            inputTokens: parsed.usage.prompt_tokens,
            outputTokens: parsed.usage.completion_tokens,
            cachedInputTokens: parsed.usage.prompt_tokens_details?.cached_tokens,
            estimated: false,
          }
        : { estimated: true },
    };
  }
}

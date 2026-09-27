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
    finish_reason?: string | null;
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      /** Provider chain-of-thought extension (GLM & friends). Strictly
       * separated from business text; never falls back into `text`. */
      reasoning_content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
  error?: {
    message?: string;
  };
}

/** Why a completion came back without usable business text. */
export type EmptyCompletionReason =
  | 'content_filter'
  | 'length'
  | 'reasoning_only'
  | 'no_choices'
  | 'empty';

export function classifyEmptyCompletion(input: {
  finishReason: string | null;
  hasReasoning: boolean;
  hasChoices: boolean;
}): EmptyCompletionReason | undefined {
  if (input.finishReason === 'content_filter') return 'content_filter';
  if (input.finishReason === 'length') {
    return input.hasReasoning ? 'reasoning_only' : 'length';
  }
  if (input.hasReasoning) return 'reasoning_only';
  if (!input.hasChoices) return 'no_choices';
  return 'empty';
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
    // Some gateways serialise content as typed parts; join only the text
    // parts so emptiness checks see the real payload.
    return content
      .map(part => (part && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

/** Reasoning stays ON for reasoning models (policy: never auto-disable).
 * A reasoning-only completion is retried with a bigger output budget; the
 * provider chain-of-thought is counted in usage, never in business text. */
const REASONING_ONLY_RETRIES = 2;
const RETRY_BUDGET_GROWTH = 1.5;

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

    const capabilityMax = this.profile.capabilities.maxOutputTokens;
    if (!Number.isInteger(capabilityMax) || capabilityMax < 1) {
      throw new Error('maxOutputTokens must resolve to a positive integer.');
    }

    let maxTokens = Math.min(request.maxOutputTokens, capabilityMax);
    let attempt = 0;
    let lastEmptyReason: EmptyCompletionReason | undefined;
    let lastFinishReason: string | null = null;

    while (true) {
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
      if (request.vendorOptions?.thinkingDisabled ?? this.profile.thinkingDisabled) {
        // ONLY an explicit opt-out may disable thinking; reasoning models run
        // with reasoning ON by default (policy 2026-09-27).
        body.thinking = { type: 'disabled' };
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

      const choice = parsed.choices?.[0];
      const message = choice?.message ?? {};
      // Strict separation: reasoning_content never becomes business text.
      const text = messageText(message.content);
      const reasoning = typeof message.reasoning_content === 'string'
        && message.reasoning_content.trim().length > 0
        ? message.reasoning_content
        : null;
      const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
      lastFinishReason = finishReason;

      if (text.trim()) {
        const usage = parsed.usage;
        return {
          text,
          requestId: parsed.id,
          usage: usage
            ? {
                inputTokens: usage.prompt_tokens,
                outputTokens: usage.completion_tokens,
                cachedInputTokens: usage.prompt_tokens_details?.cached_tokens,
                reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
                estimated: false,
              }
            : { estimated: true },
        };
      }

      lastEmptyReason = classifyEmptyCompletion({
        finishReason,
        hasReasoning: reasoning !== null,
        hasChoices: Boolean(choice),
      });

      // A reasoning-only completion means the model spent the budget thinking
      // (TAVO-MINI approach): retry with a grown budget instead of failing the
      // turn or disabling reasoning. content_filter / no_choices never retry.
      if (
        lastEmptyReason === 'reasoning_only' &&
        attempt < REASONING_ONLY_RETRIES
      ) {
        attempt += 1;
        maxTokens = Math.min(Math.ceil(maxTokens * RETRY_BUDGET_GROWTH), capabilityMax);
        continue;
      }

      if (lastEmptyReason === 'reasoning_only') {
        throw new Error(
          '模型只输出了思维链，未产生正文（已自动重试并提高输出预算）。' +
            `请提高该模型的最大输出 token 配置后重试（finish_reason=${lastFinishReason ?? 'unknown'}）。`,
        );
      }
      if (lastEmptyReason === 'content_filter') {
        throw new Error('模型输出被服务商内容过滤拦截，请调整行动描述后重试。');
      }
      if (lastEmptyReason === 'length') {
        throw new Error('模型输出被截断（finish_reason=length），请提高输出 token 上限。');
      }
      throw new Error('LLM provider returned an empty completion.');
    }
  }
}

import { LlmRequestFailure } from './types';
import type {
  ApiProfile,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmPhysicalRequestMetric,
  SecretStore,
} from './types';
import { normalizeReasoningTier } from './types';
import { physicalRequestTimeoutMs } from './requestDeadline';
import { IncompleteCompletionStreamError, readCompletionStream } from './completionStream';
import {
  providerReasoningParamsForTier,
  reasoningDialectForModel,
  type ReasoningDialect,
} from './reasoningPolicy';

export type { ReasoningDialect } from './reasoningPolicy';

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
  timings?: {
    localQueueMs?: number | null;
    responseHeadersMs?: number | null;
    firstBodyByteMs?: number | null;
    completeResponseMs?: number | null;
    providerQueueMs?: number | null;
  };
}

export interface HttpTransport {
  post(request: HttpRequest): Promise<HttpResponse>;
}

export interface OpenAIResponseShape {
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

/**
 * Vendor dialect for reasoning-parameter shaping (request layer only). This
 * routes REQUEST PARAMETERS, never capability assumptions: probing, not
 * branding, decides what a model can do (plan §13).
 */
export function reasoningDialect(model: string): ReasoningDialect {
  return reasoningDialectForModel(model);
}

function applyReasoningParams(
  body: Record<string, unknown>,
  dialect: ReasoningDialect,
  tier: 'low' | 'high' | 'max',
): void {
  Object.assign(body, providerReasoningParamsForTier(dialect, tier));
}

function isUnsupportedReasoningParameter(status: number, message: string | undefined): boolean {
  if (status !== 400 || !message) return false;
  return /(unknown|unsupported|unrecognized|not supported|unexpected|extra inputs? are not permitted).{0,100}(reasoning_effort|thinking)|(reasoning_effort|thinking).{0,100}(unknown|unsupported|unrecognized|not supported|unexpected)/i
    .test(message);
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

export interface OpenAICompatibleProviderOptions {
  /** Physical HTTP request cap; omitted preserves the existing retry policy. */
  maxPhysicalRequests?: number;
  /** Optional redacted observer, invoked once for each completed HTTP attempt. */
  onPhysicalRequest?: (metric: LlmPhysicalRequestMetric) => void;
}

function transportErrorCategory(error: unknown): 'timeout' | 'network' {
  const value = error as { name?: unknown; code?: unknown; message?: unknown };
  const descriptor = `${String(value?.name ?? '')} ${String(value?.code ?? '')} ${String(value?.message ?? '')}`;
  return /abort|timeout|timed out/i.test(descriptor) ? 'timeout' : 'network';
}

/** Only structured socket/DNS errors prove that no HTTP request reached a
 * server. Generic mobile fetch failures, disconnects and timeout messages do
 * not prove that billing never occurred. */
function definitelyNotSent(error: unknown): boolean {
  let value: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!value || typeof value !== 'object') return false;
    const record = value as { code?: unknown; cause?: unknown };
    if (record.code === 'ECONNREFUSED' || record.code === 'ENOTFOUND' || record.code === 'EAI_AGAIN') return true;
    value = record.cause;
  }
  return false;
}

/** Provider/transport errors can echo credentials with arbitrary key formats. */
function sanitizedFailureMessage(message: string, apiKey: string): string {
  return message.split(apiKey).join('[redacted]')
    .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]');
}

const PROVIDER_ERROR_TEXT_MAX_CHARS = 300;

/** Metric-safe provider error text: sanitized, single-line, length-capped. */
function providerErrorText(message: string | undefined, apiKey: string): string | undefined {
  if (!message || !message.trim()) return undefined;
  return sanitizedFailureMessage(message, apiKey)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PROVIDER_ERROR_TEXT_MAX_CHARS);
}

/**
 * Parses a Retry-After response header (seconds or HTTP-date) into ms.
 * Returns null when absent or unparseable; never throws.
 */
export function parseRetryAfterMs(
  headers: Record<string, string> | undefined,
  nowMs: number = Date.now(),
): number | null {
  const raw = headers?.['retry-after'];
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1_000;
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - nowMs);
  return null;
}

export class OpenAICompatibleProvider implements LlmProvider {
  constructor(
    private readonly profile: ApiProfile,
    private readonly secrets: SecretStore,
    private readonly transport: HttpTransport,
    private readonly timeoutMs = 60_000,
    private readonly options: OpenAICompatibleProviderOptions = {},
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const apiKey = await this.secrets.get(this.profile.keyRef);
    if (!apiKey) throw new Error('LLM API key is missing from secure storage.');

    const capabilityMax = this.profile.capabilities.maxOutputTokens ?? request.maxOutputTokens;
    if (typeof capabilityMax !== 'number' || !Number.isInteger(capabilityMax) || capabilityMax < 1) {
      throw new Error('maxOutputTokens must resolve from the profile or the explicit request.');
    }

    let maxTokens = Math.min(request.maxOutputTokens, capabilityMax);
    let attempt = 0;
    let lastEmptyReason: EmptyCompletionReason | undefined;
    let lastFinishReason: string | null = null;
    const requestMetrics: LlmPhysicalRequestMetric[] = [];
    const maxPhysicalRequests = request.maxPhysicalRequests
      ?? this.options.maxPhysicalRequests
      ?? REASONING_ONLY_RETRIES + 1;
    if (!Number.isInteger(maxPhysicalRequests) || maxPhysicalRequests < 1
      || maxPhysicalRequests > REASONING_ONLY_RETRIES + 1) {
      throw new Error(`maxPhysicalRequests must be an integer from 1 to ${REASONING_ONLY_RETRIES + 1}.`);
    }
    const observe = (metric: LlmPhysicalRequestMetric): void => {
      const normalized: LlmPhysicalRequestMetric = { ...metric,
        dispatchState: metric.dispatchState ?? (metric.httpStatus === null ? 'unknown' : 'sent') };
      requestMetrics.push(normalized);
      try { this.options.onPhysicalRequest?.(normalized); } catch { /* telemetry must not fail a turn */ }
    };
    const requestUrl = normalizeEndpoint(this.profile.endpoint);

    const dialect = this.profile.reasoningDialect ?? reasoningDialect(this.profile.model);
    const reasoningTier = normalizeReasoningTier(
      request.reasoningTier
        ?? this.profile.reasoningTier
        ?? request.reasoningEffort
        ?? this.profile.reasoningEffort,
    );
    const timeoutMs = physicalRequestTimeoutMs(this.timeoutMs, request.requestKind, reasoningTier);
    const streamedPlanning = request.requestKind === 'campaign_plan' && reasoningTier !== 'low'
      && this.profile.capabilities.supportsStreaming === true;

    while (true) {
      // Resident-mode request structure: [system, user, ...followUps]. The
      // system+user prefix must stay byte-stable across units of one run so
      // provider prefix caches hit (1M plan §4.2).
      const messages: Array<{ role: string; content: string }> = [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ];
      for (const extra of request.followUpUserMessages ?? []) {
        messages.push({ role: 'user', content: extra });
      }
      const body: Record<string, unknown> = {
        model: this.profile.model,
        messages,
        max_tokens: maxTokens,
        stream: streamedPlanning,
      };
      if (request.jsonMode && this.profile.capabilities.supportsJson) {
        body.response_format = { type: 'json_object' };
      }
      // Policy 2026-09-30: model thinking is NEVER disabled - neither by
      // request nor by profile. The effort only selects the vendor's THINKING
      // TIER (DeepSeek and GLM parameters differ; see applyReasoningParams).
      applyReasoningParams(body, dialect, reasoningTier);

      let response: HttpResponse;
      const physicalStartedAt = Date.now();
      const physicalAttempt = requestMetrics.length + 1;
      try {
        response = await this.transport.post({
          url: requestUrl,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          timeoutMs,
        });
      } catch (error) {
        const category = transportErrorCategory(error);
        const notSent = category === 'network' && definitelyNotSent(error);
        observe({
          attempt: physicalAttempt,
          durationMs: Math.max(0, Date.now() - physicalStartedAt),
          httpStatus: null,
          outcome: 'transport_error',
          errorCategory: category,
          dispatchState: notSent ? 'not_sent' : 'unknown',
          ...(notSent ? { usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0, estimated: false } } : {}),
          timings: { completeResponseMs: Math.max(0, Date.now() - physicalStartedAt) },
        });
        if (error instanceof Error && /aborted?/i.test(error.name + error.message)) {
          throw new LlmRequestFailure(
            `LLM 请求超时（${Math.round(timeoutMs / 1000)} 秒）。推理模型的思维链可能需要更长时间。`,
            requestMetrics,
          );
        }
        throw new LlmRequestFailure(sanitizedFailureMessage(
          error instanceof Error ? error.message : 'LLM transport failed.', apiKey,
        ), requestMetrics);
      }

      let parsed: OpenAIResponseShape;
      try {
        const eventStream = response.headers?.['content-type']?.includes('text/event-stream')
          || /^(?:\uFEFF)?(?:data:|:)/.test(response.body.trimStart());
        parsed = eventStream ? readCompletionStream(response.body) : JSON.parse(response.body) as OpenAIResponseShape;
      } catch (error) {
        const incomplete = error instanceof IncompleteCompletionStreamError;
        observe({
          attempt: physicalAttempt,
          durationMs: Math.max(0, Date.now() - physicalStartedAt),
          httpStatus: response.status,
          outcome: 'invalid_response',
          errorCategory: incomplete ? 'network' : 'invalid_response',
          ...(incomplete ? { dispatchState: 'unknown' as const } : {}),
          timings: response.timings,
        });
        throw new LlmRequestFailure(incomplete ? error.message
          : `LLM provider returned invalid completion body (status ${response.status}).`, requestMetrics);
      }
      if (response.status < 200 || response.status >= 300) {
        const retryAfterMs = parseRetryAfterMs(response.headers);
        observe({
          attempt: physicalAttempt,
          durationMs: Math.max(0, Date.now() - physicalStartedAt),
          httpStatus: response.status,
          outcome: 'http_error',
          errorCategory: 'provider_http',
          timings: response.timings,
          providerErrorText: providerErrorText(parsed.error?.message, apiKey),
          retryAfterMs,
        });
        if (isUnsupportedReasoningParameter(response.status, parsed.error?.message)) {
          throw new LlmRequestFailure(
            '当前端点可能不支持思考档位参数（reasoning_effort/thinking）；请核对端点协议配置。',
            requestMetrics,
          );
        }
        throw new LlmRequestFailure(sanitizedFailureMessage(
          parsed.error?.message || `LLM provider HTTP ${response.status}.`, apiKey,
        ), requestMetrics);
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
        const normalizedUsage = usage
          ? {
              inputTokens: usage.prompt_tokens,
              outputTokens: usage.completion_tokens,
              cachedInputTokens: usage.prompt_tokens_details?.cached_tokens,
              reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
              estimated: false,
            }
          : { estimated: true };
        observe({
          attempt: physicalAttempt,
          durationMs: Math.max(0, Date.now() - physicalStartedAt),
          httpStatus: response.status,
          outcome: finishReason === 'length' ? 'invalid_response' : 'completed',
          ...(finishReason === 'length' ? { completionState: 'length' as const } : {}),
          timings: response.timings,
          usage: normalizedUsage,
        });
        if (finishReason === 'length') {
          throw new LlmRequestFailure('模型正文输出被截断（finish_reason=length），需要提高输出预算或拆小批次。', requestMetrics);
        }
        return {
          text,
          requestId: parsed.id,
          usage: normalizedUsage,
          requestMetrics,
        };
      }

      lastEmptyReason = classifyEmptyCompletion({
        finishReason,
        hasReasoning: reasoning !== null,
        hasChoices: Boolean(choice),
      });

      const emptyUsage = parsed.usage
        ? {
            inputTokens: parsed.usage.prompt_tokens,
            outputTokens: parsed.usage.completion_tokens,
            cachedInputTokens: parsed.usage.prompt_tokens_details?.cached_tokens,
            reasoningTokens: parsed.usage.completion_tokens_details?.reasoning_tokens,
            estimated: false,
          }
        : { estimated: true };
      observe({
        attempt: physicalAttempt,
        durationMs: Math.max(0, Date.now() - physicalStartedAt),
        httpStatus: response.status,
        outcome: lastEmptyReason === 'reasoning_only' ? 'reasoning_only' : 'invalid_response',
        completionState: lastEmptyReason,
        timings: response.timings,
        usage: emptyUsage,
      });

      // A reasoning-only completion means the model spent the budget thinking
      // (TAVO-MINI approach): retry with a grown budget instead of failing the
      // turn or disabling reasoning. content_filter / no_choices never retry.
      if (
        lastEmptyReason === 'reasoning_only' &&
        attempt < Math.min(REASONING_ONLY_RETRIES, maxPhysicalRequests - 1)
      ) {
        attempt += 1;
        maxTokens = Math.min(Math.ceil(maxTokens * RETRY_BUDGET_GROWTH), capabilityMax);
        continue;
      }

      if (lastEmptyReason === 'reasoning_only') {
        throw new LlmRequestFailure(
          '模型只输出了思维链，未产生正文（已自动重试并提高输出预算）。' +
            `请提高该模型的最大输出 token 配置后重试（finish_reason=${lastFinishReason ?? 'unknown'}）。`,
          requestMetrics,
        );
      }
      if (lastEmptyReason === 'content_filter') {
        throw new LlmRequestFailure('模型输出被服务商内容过滤拦截，请调整行动描述后重试。', requestMetrics);
      }
      if (lastEmptyReason === 'length') {
        throw new LlmRequestFailure('模型输出被截断（finish_reason=length），请提高输出 token 上限。', requestMetrics);
      }
      throw new LlmRequestFailure('LLM provider returned an empty completion.', requestMetrics);
    }
  }
}

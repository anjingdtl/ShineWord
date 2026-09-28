export type LlmRole =
  | 'Extractor'
  | 'WorldMapper'
  | 'Planner'
  | 'Narrator'
  | 'Checker'
  | 'Summarizer';

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  /** Provider-reported chain-of-thought tokens (never part of text). */
  reasoningTokens?: number;
  estimated: boolean;
}

/** Redacted measurements for one physical provider HTTP attempt. */
export interface LlmPhysicalRequestMetric {
  attempt: number;
  durationMs: number;
  httpStatus: number | null;
  outcome: 'completed' | 'reasoning_only' | 'http_error' | 'transport_error' | 'invalid_response';
  completionState?: 'content_filter' | 'length' | 'reasoning_only' | 'no_choices' | 'empty';
  errorCategory?: 'timeout' | 'network' | 'provider_http' | 'invalid_response';
  timings?: {
    localQueueMs?: number | null;
    responseHeadersMs?: number | null;
    firstBodyByteMs?: number | null;
    completeResponseMs?: number | null;
    providerQueueMs?: number | null;
  };
  usage?: LlmUsage;
}

/** Failed provider completion with its safe, per-attempt measurements. */
export class LlmRequestFailure extends Error {
  constructor(
    message: string,
    readonly requestMetrics: readonly LlmPhysicalRequestMetric[],
  ) {
    super(message);
    this.name = 'LlmRequestFailure';
  }
}

export interface LlmResponse {
  text: string;
  usage?: LlmUsage;
  requestId?: string;
  /** Metrics contain no prompt, response, endpoint, or credential data. */
  requestMetrics?: readonly LlmPhysicalRequestMetric[];
}

export interface LlmRequest {
  role: LlmRole;
  system: string;
  user: string;
  maxOutputTokens: number;
  jsonMode?: boolean;
  /** Provider-specific request tuning; an explicit thinking opt-out. */
  vendorOptions?: {
    thinkingDisabled?: boolean;
  };
}

export interface LlmProvider {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export interface LlmProviderCapabilities {
  supportsJson: boolean;
  supportsStreaming: boolean;
  reportsUsage: boolean;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface ApiProfile {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  keyRef: string;
  capabilities: LlmProviderCapabilities;
  /**
   * EXPLICIT opt-out only (policy 2026-09-27): reasoning models run with
   * reasoning ON; the provider retries reasoning-only completions with a
   * grown budget instead of disabling thinking. Never auto-set.
   */
  thinkingDisabled?: boolean;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

export interface SecretStore {
  set(keyRef: string, secret: string): Promise<void>;
  get(keyRef: string): Promise<string | null>;
  delete(keyRef: string): Promise<void>;
}

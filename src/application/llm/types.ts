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
  /** Provider-specific request tuning. (thinkingDisabled is OBSOLETE and
   *  ignored: policy 2026-09-30 forbids disabling model thinking.) */
  vendorOptions?: {
    thinkingDisabled?: boolean;
  };
  /** Reasoning effort passthrough ('off' = non-thinking; 1M plan §3.2). */
  reasoningEffort?: 'off' | 'low' | 'high';
  /**
   * Extra user messages appended AFTER `user` (resident mode: [0]=system,
   * [1]=whole-book user, [2]=per-unit scope instruction). The prefix formed
   * by system+user must stay byte-stable for prefix-cache hits.
   */
  followUpUserMessages?: readonly string[];
}

export interface LlmProvider {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export interface LlmProviderCapabilities {
  supportsJson: boolean;
  supportsStreaming: boolean;
  reportsUsage: boolean;
  /**
   * Context window in tokens. Optional since the capability-source
   * governance (infrastructure plan §7): an unprobed, undeclared window is
   * UNKNOWN and must stay absent - never fabricated as 128K. Consumers
   * (budget kernel, profileModelBudget) fail closed when it is missing.
   */
  contextWindow?: number;
  maxOutputTokens: number;
  /** Probe-determined prefix-cache support (resident-mode gate, probe v2). */
  supportsPromptCache?: boolean;
}

export interface ApiProfile {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  keyRef: string;
  capabilities: LlmProviderCapabilities;
  /** OBSOLETE (policy 2026-09-30): thinking is never disabled; ignored. */
  thinkingDisabled?: boolean;
  /** Content output budget per request (1M plan §3.1); default 16,384. */
  contentOutputTokens?: number;
  /** Chain-of-thought reserve on top of the content budget (GLM low = 2,048). */
  reasoningReserveTokens?: number;
  /** Reasoning effort passthrough; 'off' = non-thinking extraction. */
  reasoningEffort?: 'off' | 'low' | 'high';
  /** Resident-build worker concurrency (1-4; default 3). */
  concurrency?: number;
  /** Provider tokens-per-minute limit for conservative scheduling (§6). */
  tpm?: number;
  /** Provider requests-per-minute limit for global scheduling (unified P1 §5). */
  rpm?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

export interface SecretStore {
  set(keyRef: string, secret: string): Promise<void>;
  get(keyRef: string): Promise<string | null>;
  delete(keyRef: string): Promise<void>;
}

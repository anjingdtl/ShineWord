export type LlmRole =
  | 'Extractor'
  | 'WorldMapper'
  | 'Planner'
  | 'Narrator'
  | 'Checker'
  | 'Summarizer';

/** User-selectable reasoning depth. Legacy `off` is not a product tier. */
export type ReasoningTier = 'low' | 'high' | 'max';

/** Provider protocol adapter selected for reasoning parameters. */
export type ReasoningDialect = 'deepseek' | 'glm' | 'generic' | 'unsupported';

/** Persisted/request compatibility only; normalize `off` to `low` at boundaries. */
export type LegacyReasoningEffort = 'off' | 'low' | 'high';

export type LlmRequestKind =
  | 'planner'
  | 'narrator'
  | 'memory_checkpoint'
  | 'memory_repair'
  | 'world_extract'
  | 'world_mapping'
  | 'world_adjudication'
  | 'timeline'
  | 'registry'
  | 'summarizer';

export function normalizeReasoningTier(value: unknown): ReasoningTier {
  if (value === 'high' || value === 'max') return value;
  // Missing/legacy `off` values migrate to the lowest supported thinking tier.
  return 'low';
}

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
  /**
   * Sanitized, length-capped provider error text from the HTTP error body
   * (e.g. the reason behind a 400). Without it the UI can only say "HTTP 400"
   * and the actual rejection reason is lost for diagnosis.
   */
  providerErrorText?: string;
  /**
   * Provider Retry-After hint parsed from the response headers (ms), when the
   * provider sent one with an HTTP error (typically 429). Feeds the global
   * rate scheduler's backoff floor.
   */
  retryAfterMs?: number | null;
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
  /** Exact provider wire max_tokens ceiling (business output + reasoning reserve). */
  maxOutputTokens: number;
  /** Optional per-call cap for physical transport attempts; app-level recovery may own the next bounded attempt. */
  maxPhysicalRequests?: number;
  jsonMode?: boolean;
  /** Provider-specific request tuning. (thinkingDisabled is OBSOLETE and
   *  ignored: policy 2026-09-30 forbids disabling model thinking.) */
  vendorOptions?: {
    thinkingDisabled?: boolean;
  };
  /** Explicit product tier selected when this request's policy was frozen. */
  reasoningTier?: ReasoningTier;
  /** Reserve and policy identity paired with the selected tier. */
  reasoningReserveTokens?: number | null;
  reasoningPolicyVersion?: string;
  /** Request kind for the shared reasoning and budget policy. */
  requestKind?: LlmRequestKind;
  /** @deprecated Historical payload compatibility; new callers use reasoningTier. */
  reasoningEffort?: LegacyReasoningEffort;
  /**
   * Extra user messages appended AFTER `user` (resident mode: [0]=system,
   * [1]=whole-book user, [2]=per-unit scope instruction). The prefix formed
   * by system+user must stay byte-stable for prefix-cache hits.
   */
  followUpUserMessages?: readonly string[];
  /**
   * Physical-request ledger metadata (infrastructure plan §51-§56). Present
   * only for request kinds already migrated onto the durable ledger
   * (planner/narrator/summarizer); absent metadata passes through unlogged.
   */
  ledger?: {
    logicalRequestId: string;
    requestKind: string;
    campaignId?: string;
    branchId?: string;
    worldId?: string;
    stateVersion?: number;
  };
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
  /** Unknown until user/provider evidence supplies a positive integer. */
  maxOutputTokens?: number;
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
  /** Product reasoning tier. Old profiles are normalized during load. */
  reasoningTier?: ReasoningTier;
  /** Optional explicit adapter override; generic is inferred from model name otherwise. */
  reasoningDialect?: ReasoningDialect;
  /** @deprecated Historical profile compatibility; migrate `off` to `low`. */
  reasoningEffort?: LegacyReasoningEffort;
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

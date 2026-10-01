/**
 * Frozen per-run model configuration (unified build P1 §1).
 *
 * A run's endpoint/model/keyRef and every non-secret execution parameter are
 * snapshotted at creation time and travel with the run record. Switching the
 * global profile mid-run never changes an in-flight run; a different
 * endpoint/model requires an explicit new run. Secrets (the API key itself)
 * are NEVER frozen - only the keyRef is stored, and the key is resolved from
 * the SecretStore (Keychain on device) at execution time.
 */
import type { ApiProfile } from '../llm/types';
import { normalizeReasoningTier, type ReasoningDialect, type ReasoningTier } from '../llm/types';
import { reasoningDialectForModel, REASONING_POLICY_VERSION, resolveReasoningPolicy } from '../llm/reasoningPolicy';
import type { LlmRequestKind } from '../llm/types';
import { DEFAULT_OUTPUT_DEMANDS } from '../llm/requestDemands';
import type { ModelBudget } from './groupPlanner';

export const RUN_CONFIG_VERSION = 'run-config-2';

export interface FrozenReasoningReservePolicy {
  policyVersion: string;
  scope: 'per_request_kind';
  reserves: Partial<Record<LlmRequestKind, number>>;
}

const WORLD_BUILD_REQUEST_KINDS: readonly LlmRequestKind[] = [
  'world_extract', 'world_mapping', 'world_adjudication', 'timeline', 'registry',
];

function normalizeFrozenReserves(value: unknown): Partial<Record<LlmRequestKind, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const reserves: Partial<Record<LlmRequestKind, number>> = {};
  for (const kind of WORLD_BUILD_REQUEST_KINDS) {
    const reserve = raw[kind];
    if (typeof reserve === 'number' && Number.isInteger(reserve) && reserve > 0) reserves[kind] = reserve;
  }
  return reserves;
}

export interface FrozenRunConfig {
  configVersion: typeof RUN_CONFIG_VERSION;
  /** Endpoint WITHOUT credentials or query secrets (sanitized). */
  endpoint: string;
  model: string;
  /** SecretStore key holding the API key; the key itself never lives here. */
  keyRef: string;
  reasoningTier: ReasoningTier;
  reasoningDialect: ReasoningDialect;
  reasoningReservePolicy: FrozenReasoningReservePolicy;
  /** Content output budget per request (excl. reasoning). */
  contentOutputTokens: number;
  /** Chain-of-thought reserve on top of the content budget. */
  reasoningReserveTokens: number;
  /** Declared/probed context window, in tokens. */
  contextWindowTokens: number;
  /** Endpoint hard output ceiling, in tokens. */
  maxOutputTokens: number;
  supportsPromptCache: boolean;
  supportsJson: boolean;
  /** Worker concurrency for this run (1-4). */
  concurrency: number;
  /** Provider tokens-per-minute, if known. */
  tpm?: number;
  /** Provider requests-per-minute, if known. */
  rpm?: number;
  /** Initial body target as a fraction of the context window (default 0.30). */
  bodyTargetRatio: number;
  /**
   * How the contextWindow was established. A tiny probe request can never
   * PROVE a 1M window; 'declared' means the profile/configuration states it
   * and the value is only as trustworthy as that declaration.
   */
  contextWindowSource: 'declared' | 'probed' | 'fallback';
  /** Sanitized provider id/name for logs (no secrets). */
  profileId: string;
  profileName: string;
}

/** Strips userinfo and query strings so a logged endpoint can't leak secrets. */
export function sanitizeEndpoint(endpoint: string): string {
  const noQuery = endpoint.split('?')[0] ?? endpoint;
  const noHash = noQuery.split('#')[0] ?? noQuery;
  return noHash.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/@]+)@/, '$1');
}

export function freezeRunConfig(
  profile: ApiProfile,
  budget: ModelBudget,
  options: {
    bodyTargetRatio?: number;
    contextWindowSource?: 'declared' | 'probed' | 'fallback';
  } = {},
): FrozenRunConfig {
  const maxOutputTokens = profile.capabilities.maxOutputTokens;
  if (typeof maxOutputTokens !== 'number' || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error('World Build requires a declared positive model maxOutputTokens capability.');
  }
  const reasoningTier = budget.reasoningTier ?? normalizeReasoningTier(profile.reasoningTier ?? profile.reasoningEffort);
  const reasoningDialect = budget.reasoningDialect ?? profile.reasoningDialect ?? reasoningDialectForModel(profile.model);
  const reserves = Object.fromEntries(WORLD_BUILD_REQUEST_KINDS.map(requestKind => {
    const resolved = resolveReasoningPolicy({
      providerDialect: reasoningDialect,
      model: profile.model,
      tier: reasoningTier,
      requestKind,
      modelMaxOutputTokens: maxOutputTokens,
      contextWindowTokens: budget.contextWindowTokens,
      minimumBusinessOutputTokens: DEFAULT_OUTPUT_DEMANDS[requestKind].minimum,
    });
    return [requestKind, resolved.reserveTokens];
  })) as Partial<Record<LlmRequestKind, number>>;
  return {
    configVersion: RUN_CONFIG_VERSION,
    endpoint: sanitizeEndpoint(profile.endpoint),
    model: profile.model,
    keyRef: profile.keyRef,
    reasoningTier,
    reasoningDialect,
    reasoningReservePolicy: {
      policyVersion: budget.reasoningPolicyVersion ?? REASONING_POLICY_VERSION,
      scope: 'per_request_kind',
      reserves,
    },
    contentOutputTokens: budget.maxContentOutputTokens,
    reasoningReserveTokens: budget.reasoningReserveTokens,
    contextWindowTokens: budget.contextWindowTokens,
    maxOutputTokens,
    supportsPromptCache: budget.supportsPromptCache,
    supportsJson: profile.capabilities.supportsJson,
    concurrency: Math.max(1, Math.min(4, profile.concurrency ?? 2)),
    tpm: profile.tpm,
    rpm: profile.rpm,
    bodyTargetRatio: options.bodyTargetRatio ?? 0.30,
    contextWindowSource: options.contextWindowSource ?? 'declared',
    profileId: profile.id,
    profileName: profile.name,
  };
}

/** Stable fingerprint over the frozen config (excludes nothing - there are no secrets). */
export function frozenConfigIdentity(config: FrozenRunConfig): string {
  const parts = [
    config.configVersion,
    config.endpoint,
    config.model,
    config.reasoningTier,
    config.reasoningDialect,
    config.reasoningReservePolicy.policyVersion,
    JSON.stringify(config.reasoningReservePolicy.reserves),
    String(config.contentOutputTokens),
    String(config.reasoningReserveTokens),
    String(config.contextWindowTokens),
    String(config.maxOutputTokens),
    config.supportsPromptCache ? 'cache' : 'nocache',
    String(config.concurrency),
    config.tpm === undefined ? '' : String(config.tpm),
    config.rpm === undefined ? '' : String(config.rpm),
  ];
  return parts.join('#');
}

/** Parses and validates a frozen config; null for legacy/foreign payloads. */
export function reviveRunConfig(json: string | null): FrozenRunConfig | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Omit<Partial<FrozenRunConfig>, 'configVersion' | 'reasoningTier'> & {
      configVersion?: string;
      reasoningTier?: unknown;
      reasoningEffort?: unknown;
    };
    const legacyV1 = raw.configVersion === 'run-config-1';
    if (!legacyV1 && raw.configVersion !== RUN_CONFIG_VERSION) return null;
    if (typeof raw.endpoint !== 'string' || typeof raw.model !== 'string' || typeof raw.keyRef !== 'string') return null;
    if (typeof raw.contentOutputTokens !== 'number' || typeof raw.contextWindowTokens !== 'number') return null;
    return {
      configVersion: RUN_CONFIG_VERSION,
      endpoint: raw.endpoint,
      model: raw.model,
      keyRef: raw.keyRef,
      reasoningTier: normalizeReasoningTier(raw.reasoningTier ?? raw.reasoningEffort),
      reasoningDialect: raw.reasoningDialect === 'glm' || raw.reasoningDialect === 'deepseek'
        || raw.reasoningDialect === 'unsupported' ? raw.reasoningDialect : 'generic',
      reasoningReservePolicy: {
        policyVersion: typeof raw.reasoningReservePolicy?.policyVersion === 'string'
          ? raw.reasoningReservePolicy.policyVersion
          : REASONING_POLICY_VERSION,
        scope: 'per_request_kind',
        reserves: normalizeFrozenReserves(raw.reasoningReservePolicy?.reserves),
      },
      contentOutputTokens: raw.contentOutputTokens,
      reasoningReserveTokens: raw.reasoningReserveTokens ?? 0,
      contextWindowTokens: raw.contextWindowTokens,
      maxOutputTokens: raw.maxOutputTokens ?? raw.contentOutputTokens,
      supportsPromptCache: raw.supportsPromptCache === true,
      supportsJson: raw.supportsJson !== false,
      concurrency: raw.concurrency ?? 3,
      tpm: raw.tpm,
      rpm: raw.rpm,
      bodyTargetRatio: raw.bodyTargetRatio ?? 0.30,
      contextWindowSource: raw.contextWindowSource ?? 'declared',
      profileId: raw.profileId ?? 'default',
      profileName: raw.profileName ?? '',
    };
  } catch {
    return null;
  }
}

/**
 * Rebuilds the provider-facing profile from a frozen config. The SecretStore
 * still resolves the key at execution time via keyRef.
 */
export function providerProfileFromFrozen(config: FrozenRunConfig): ApiProfile {
  return {
    id: config.profileId,
    name: config.profileName,
    endpoint: config.endpoint,
    model: config.model,
    keyRef: config.keyRef,
    capabilities: {
      supportsJson: config.supportsJson,
      supportsStreaming: false,
      reportsUsage: true,
      contextWindow: config.contextWindowTokens,
      maxOutputTokens: config.maxOutputTokens,
      supportsPromptCache: config.supportsPromptCache,
    },
    reasoningTier: config.reasoningTier,
    reasoningDialect: config.reasoningDialect,
    contentOutputTokens: config.contentOutputTokens,
    reasoningReserveTokens: config.reasoningReserveTokens > 0 ? config.reasoningReserveTokens : undefined,
    concurrency: config.concurrency,
    tpm: config.tpm,
    rpm: config.rpm,
  };
}

/** Mutable planning state persisted separately from the frozen config. */
export interface RunPlanState {
  /** Legacy chapter planner (plan-chapter-1): body share of the window. */
  bodyTargetRatio: number;
  estOutputPerChunk?: number;
  replanCount: number;
  /** Planner-v2 (plan-analysis-1): the active policy fields. */
  plannerVersion?: 'plan-analysis-1';
  sourceRatio?: number;
  density?: number;
}

export function revivePlanState(json: string | null, defaults: { bodyTargetRatio: number }): RunPlanState {
  if (!json) {
    return { bodyTargetRatio: defaults.bodyTargetRatio, replanCount: 0 };
  }
  try {
    const raw = JSON.parse(json) as Partial<RunPlanState>;
    return {
      bodyTargetRatio: typeof raw.bodyTargetRatio === 'number' ? raw.bodyTargetRatio : defaults.bodyTargetRatio,
      estOutputPerChunk: typeof raw.estOutputPerChunk === 'number' ? raw.estOutputPerChunk : undefined,
      replanCount: typeof raw.replanCount === 'number' ? raw.replanCount : 0,
      plannerVersion: raw.plannerVersion === 'plan-analysis-1' ? 'plan-analysis-1' : undefined,
      sourceRatio: typeof raw.sourceRatio === 'number' && raw.sourceRatio > 0 && raw.sourceRatio <= 1
        ? raw.sourceRatio
        : undefined,
      density: typeof raw.density === 'number' && raw.density > 0 ? raw.density : undefined,
    };
  } catch {
    return { bodyTargetRatio: defaults.bodyTargetRatio, replanCount: 0 };
  }
}

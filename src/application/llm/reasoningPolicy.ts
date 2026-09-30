/**
 * The single product-level reasoning policy.
 *
 * Reserves below are cold-start planning values, not model capability claims.
 * Provider protocol parameters are kept separate from the product tier, and
 * the selected tier is never silently lowered to make a request fit.
 */
import type { LlmRequestKind, ReasoningDialect, ReasoningTier } from './types';
import { DEFAULT_OUTPUT_DEMANDS } from './requestDemands';

export type { ReasoningDialect } from './types';

export interface ReasoningUsageStats {
  sampleCount: number;
  p50?: number;
  p90?: number;
  p95?: number;
  max?: number;
}

/** Builds reusable percentiles from a rolling ledger sample. Missing or
 * malformed provider values are excluded rather than coerced to zero. */
export function reasoningUsageStatsFromSamples(
  samples: readonly (number | null | undefined)[],
): ReasoningUsageStats | null {
  const sorted = samples
    .filter((sample): sample is number => typeof sample === 'number' && Number.isInteger(sample) && sample >= 0)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const nearestRank = (percentile: number): number => sorted[
    Math.max(0, Math.ceil(percentile * sorted.length) - 1)
  ]!;
  const maximum = sorted[sorted.length - 1]!;
  return {
    sampleCount: sorted.length,
    p50: nearestRank(0.50),
    p90: nearestRank(0.90),
    p95: nearestRank(0.95),
    max: maximum,
  };
}

export interface ProviderReasoningParams {
  reasoning_effort?: ReasoningTier;
  thinking?: { type?: 'enabled'; clear_thinking?: false };
}

export type ReasoningReserveSource = 'cold_start' | 'usage_calibrated';

export interface ResolveReasoningPolicyInput {
  providerDialect: ReasoningDialect;
  model: string;
  tier: ReasoningTier;
  requestKind: LlmRequestKind;
  modelMaxOutputTokens: number;
  contextWindowTokens: number;
  providerWireMaxOutputTokens?: number;
  minimumBusinessOutputTokens?: number;
  historicalStats?: ReasoningUsageStats | null;
  reserveMultiplier?: number;
  /** Frozen per-run reserve carried by FrozenRunConfig. */
  reserveTokensOverride?: number;
}

/** Frozen product decision fields passed into the budget kernel. */
export interface ReasoningPolicySelection {
  tier: ReasoningTier;
  providerDialect: ReasoningDialect;
  model: string;
  historicalStats?: ReasoningUsageStats | null;
  /** Bounded retry boost after a classified reasoning_only completion. */
  reserveMultiplier?: number;
  /** Frozen per-run request-kind reserve. */
  reserveTokensOverride?: number;
}

export interface ResolvedReasoningPolicy {
  tier: ReasoningTier;
  effectiveTier: ReasoningTier;
  reserveTokens: number;
  providerParams: ProviderReasoningParams;
  /** Current supported OpenAI-compatible adapters bill thinking inside the
   * completion/output ceiling. */
  reasoningBudget: 'inside_completion';
  reserveSource: ReasoningReserveSource;
  reserveClamped: boolean;
  p95ReasoningTokens?: number;
  policyVersion: string;
}

export const REASONING_POLICY_VERSION = 'reasoning-policy-1';
export const REASONING_ONLY_RESERVE_MULTIPLIER = 1.5;
export const REASONING_ONLY_RECOVERY_ATTEMPTS = 1;
export const REASONING_CALIBRATION_MIN_SAMPLES = 8;
export const REASONING_USAGE_ROLLING_WINDOW = 32;

interface TierReserves {
  target: Record<ReasoningTier, number>;
  minimum: Record<ReasoningTier, number>;
}

/** Initial reserve schedule by request kind: low < high < max. */
export const REASONING_RESERVE_POLICY: Record<LlmRequestKind, TierReserves> = {
  planner: {
    target: { low: 2_048, high: 8_192, max: 24_576 },
    minimum: { low: 1_024, high: 4_096, max: 12_288 },
  },
  narrator: {
    target: { low: 1_024, high: 4_096, max: 12_288 },
    minimum: { low: 512, high: 2_048, max: 6_144 },
  },
  memory_checkpoint: {
    target: { low: 2_048, high: 8_192, max: 24_576 },
    minimum: { low: 1_024, high: 4_096, max: 12_288 },
  },
  memory_repair: {
    target: { low: 2_048, high: 8_192, max: 24_576 },
    minimum: { low: 1_024, high: 4_096, max: 12_288 },
  },
  world_extract: {
    target: { low: 4_096, high: 16_384, max: 49_152 },
    minimum: { low: 2_048, high: 8_192, max: 24_576 },
  },
  world_mapping: {
    target: { low: 4_096, high: 12_288, max: 32_768 },
    minimum: { low: 2_048, high: 6_144, max: 16_384 },
  },
  world_adjudication: {
    target: { low: 2_048, high: 8_192, max: 24_576 },
    minimum: { low: 1_024, high: 4_096, max: 12_288 },
  },
  timeline: {
    target: { low: 2_048, high: 8_192, max: 24_576 },
    minimum: { low: 1_024, high: 4_096, max: 12_288 },
  },
  registry: {
    target: { low: 4_096, high: 12_288, max: 32_768 },
    minimum: { low: 2_048, high: 6_144, max: 16_384 },
  },
  summarizer: {
    target: { low: 1_024, high: 4_096, max: 12_288 },
    minimum: { low: 512, high: 2_048, max: 6_144 },
  },
};

export class ReasoningCapabilityInsufficientError extends Error {
  readonly code = 'reasoning_capability_insufficient';

  constructor(message: string) {
    super(message);
    this.name = 'ReasoningCapabilityInsufficientError';
  }
}

export class ReasoningDialectUnsupportedError extends Error {
  readonly code = 'reasoning_dialect_unsupported';

  constructor() {
    super('当前兼容端点配置为不支持思考档位参数，无法保证所选思考强度。');
    this.name = 'ReasoningDialectUnsupportedError';
  }
}

export function reasoningDialectForModel(model: string): Exclude<ReasoningDialect, 'unsupported'> {
  const lower = model.toLowerCase();
  if (lower.includes('deepseek')) return 'deepseek';
  if (lower.includes('glm')) return 'glm';
  return 'generic';
}

/** Product tier to wire parameters. Thinking is always explicitly enabled. */
export function providerReasoningParamsForTier(
  providerDialect: ReasoningDialect,
  tier: ReasoningTier,
): ProviderReasoningParams {
  if (providerDialect === 'unsupported') throw new ReasoningDialectUnsupportedError();
  if (providerDialect === 'deepseek') {
    return { thinking: { type: 'enabled' }, reasoning_effort: tier };
  }
  if (providerDialect === 'glm') {
    return { reasoning_effort: tier, thinking: { clear_thinking: false } };
  }
  return { reasoning_effort: tier };
}

export function resolveReasoningPolicy(input: ResolveReasoningPolicyInput): ResolvedReasoningPolicy {
  const providerParams = providerReasoningParamsForTier(input.providerDialect, input.tier);
  for (const [label, value] of [
    ['modelMaxOutputTokens', input.modelMaxOutputTokens],
    ['contextWindowTokens', input.contextWindowTokens],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new ReasoningCapabilityInsufficientError(`${label} must be a known positive integer to reserve reasoning output.`);
    }
  }

  const schedule = REASONING_RESERVE_POLICY[input.requestKind];
  const coldStartReserve = schedule.target[input.tier];
  const minimumReserve = schedule.minimum[input.tier];
  const stats = input.historicalStats;
  const calibrated = Boolean(stats && Number.isInteger(stats.sampleCount)
    && stats.sampleCount >= REASONING_CALIBRATION_MIN_SAMPLES
    && typeof stats.p95 === 'number' && Number.isFinite(stats.p95) && stats.p95 >= 0);
  const p95ReasoningTokens = typeof stats?.p95 === 'number' && Number.isFinite(stats.p95) && stats.p95 >= 0
    ? Math.ceil(stats.p95)
    : undefined;
  const calibratedReserve = calibrated
    ? Math.max(coldStartReserve, Math.ceil((stats!.p95 as number) * 1.25))
    : coldStartReserve;
  const multiplier = input.reserveMultiplier ?? 1;
  if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 2) {
    throw new ReasoningCapabilityInsufficientError('Reasoning reserve retry multiplier must be between 1 and 2.');
  }
  if (input.reserveTokensOverride !== undefined
    && (!Number.isInteger(input.reserveTokensOverride) || input.reserveTokensOverride < minimumReserve)) {
    throw new ReasoningCapabilityInsufficientError('Frozen reasoning reserve is below the selected tier minimum.');
  }
  const targetReserve = Math.ceil((input.reserveTokensOverride ?? calibratedReserve) * multiplier);
  const wireCeiling = Math.min(
    input.modelMaxOutputTokens,
    input.providerWireMaxOutputTokens ?? input.modelMaxOutputTokens,
    input.contextWindowTokens,
  );
  const businessMinimum = input.minimumBusinessOutputTokens ?? DEFAULT_OUTPUT_DEMANDS[input.requestKind].minimum;
  const maximumReserve = wireCeiling - businessMinimum;
  if (maximumReserve < minimumReserve) {
    throw new ReasoningCapabilityInsufficientError(
      `${input.model} cannot reserve the minimum ${input.tier} reasoning budget for ${input.requestKind} ` +
        `while preserving ${businessMinimum} business output tokens (wire ceiling ${wireCeiling}).`,
    );
  }

  const reserveTokens = Math.min(targetReserve, maximumReserve);
  if (reserveTokens <= 0 || reserveTokens >= input.modelMaxOutputTokens) {
    throw new ReasoningCapabilityInsufficientError(
      `${input.model} cannot fit a ${input.tier} reasoning reserve below its model output ceiling.`,
    );
  }

  return {
    tier: input.tier,
    effectiveTier: input.tier,
    reserveTokens,
    providerParams,
    reasoningBudget: 'inside_completion',
    reserveSource: calibrated && input.reserveTokensOverride === undefined ? 'usage_calibrated' : 'cold_start',
    reserveClamped: reserveTokens < targetReserve,
    p95ReasoningTokens,
    policyVersion: REASONING_POLICY_VERSION,
  };
}

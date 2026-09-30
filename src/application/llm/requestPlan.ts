/**
 * Request-planning types for the unified request budget kernel
 * (infrastructure plan §6-§10). A business call declares WHAT it needs
 * (output demand, context demands); the kernel resolves HOW MUCH the
 * provider can actually grant and freezes the decision into a plan.
 */

import type { ContextDemand, ElasticAllocationResult } from '../context/contextTypes';
import type { RequestEnvelope } from '../context/modelEnvelope';
import type { LlmRequestKind } from './types';

export type { LlmRequestKind } from './types';

export type CapabilitySource =
  | 'user_declared'
  | 'provider_documented'
  | 'provider_probe'
  | 'derived'
  | 'unknown';

/** Model capabilities with explicit provenance (plan §7). */
export interface FrozenModelCapabilities {
  contextWindowTokens: number | null;
  contextWindowSource: CapabilitySource;

  maxOutputTokens: number | null;
  maxOutputSource: CapabilitySource;

  reportsUsage: boolean;
  supportsJsonMode: boolean;
  supportsPromptCache: boolean;

  reasoningMode: 'none' | 'optional' | 'always_on' | 'unknown';
  reasoningUsageReported: boolean;
}

/** Business output demand - what the task needs, not what the model has. */
export interface OutputDemand {
  minimum: number;
  target: number;
  maximum: number;
}

export type BudgetInfeasibleCode =
  | 'context_window_unknown'
  | 'output_demand_infeasible'
  | 'envelope_infeasible'
  | 'mandatory_input_infeasible'
  | 'mandatory_exceeds_hard';

export class BudgetInfeasibleError extends Error {
  constructor(
    message: string,
    readonly code: BudgetInfeasibleCode,
  ) {
    super(message);
    this.name = 'BudgetInfeasibleError';
  }
}

export interface RequestBudgetTrace {
  requestKind: LlmRequestKind;
  capabilitySources: {
    contextWindow: CapabilitySource;
    maxOutput: CapabilitySource;
  };
  derivedMaxOutputTokens: number | null;
  steps: Array<{
    step: string;
    detail: Record<string, number | string | boolean | null>;
  }>;
}

export interface FrozenLlmRequestPlan {
  requestKind: LlmRequestKind;
  capabilitiesFingerprint: string;
  contextPlanId: string;

  envelope: RequestEnvelope;
  allocation: ElasticAllocationResult | null;

  /** Protocol/contract tokens reserved before elastic allocation. */
  mandatoryInputTokens: number;
  allocatedInputTokens: number;
  requestedOutputTokens: number;

  trace: RequestBudgetTrace;
}

/** FNV-1a 32-bit hash over a canonical JSON serialization. */
export function stableFingerprint(value: unknown): string {
  const canonical = canonicalize(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(',')}}`;
}

export interface LlmRequestPlanningInput {
  capabilities: FrozenModelCapabilities;
  requestKind: LlmRequestKind;

  /** Unclippable protocol/contract tokens (action protocol, stateVersion...). */
  estimatedMandatoryInputTokens: number;
  businessOutputDemand: OutputDemand;
  contextDemands?: readonly ContextDemand[];

  /** Protocol ceiling for the wire max_tokens; default = model max output. */
  providerWireMaxOutputTokens?: number;
  /** Provider adapter declaration (plan §8); default 'separate'. */
  reasoningBudget?: 'inside_completion' | 'separate';
  /** Overrides the capability-derived reasoning reserve. */
  reasoningReserveTokens?: number;
  /** Overrides the derived safety margin (tests / explicit policy). */
  safetyMarginTokens?: number;
}

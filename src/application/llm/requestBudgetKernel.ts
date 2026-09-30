/**
 * Unified request budget kernel (infrastructure plan §6).
 *
 * Every LLM business request resolves its input envelope, output grant and
 * reasoning reserve HERE before a single byte hits the provider. The kernel
 * is a pure function: identical inputs produce identical plans, and every
 * decision lands in the trace for the request ledger / context debug views.
 */

import { allocateElasticContext } from '../context/elasticAllocator';
import { computeRequestEnvelope } from '../context/modelEnvelope';
import type { ContextDemand } from '../context/contextTypes';
import { deriveMaxOutputTokens } from './capabilityResolver';
import type { FrozenLlmRequestPlan, LlmRequestPlanningInput, RequestBudgetTrace } from './requestPlan';
import { BudgetInfeasibleError, stableFingerprint } from './requestPlan';

export { DEFAULT_OUTPUT_DEMANDS } from './requestDemands';

/** Default CoT reserve per reasoning mode (GLM low tier ≈ 2,048; plan §11). */
const DEFAULT_REASONING_RESERVE: Record<'none' | 'optional' | 'always_on' | 'unknown', number> = {
  none: 0,
  optional: 0,
  always_on: 2_048,
  unknown: 1_024,
};

export function planLlmRequest(input: LlmRequestPlanningInput): FrozenLlmRequestPlan {
  const trace: RequestBudgetTrace = {
    requestKind: input.requestKind,
    capabilitySources: {
      contextWindow: input.capabilities.contextWindowSource,
      maxOutput: input.capabilities.maxOutputSource,
    },
    derivedMaxOutputTokens: null,
    steps: [],
  };
  const record = (step: string, detail: Record<string, number | string | boolean | null>): void => {
    trace.steps.push({ step, detail });
  };

  // 1. Context window must be known from a real source - never fabricated.
  const C = input.capabilities.contextWindowTokens;
  if (C === null) {
    record('capability_gate', {
      blocked: 'context_window_unknown',
      source: input.capabilities.contextWindowSource,
    });
    throw new BudgetInfeasibleError(
      'Model context window is unknown; declare it in the provider profile or provider documentation.',
      'context_window_unknown',
    );
  }
  record('capability_gate', { contextWindow: C, source: input.capabilities.contextWindowSource });

  // 2. Output ceiling: declared/documented/probed, else a derived runtime
  //    safety value (never written back, always marked derived).
  let modelMax = input.capabilities.maxOutputTokens;
  if (modelMax === null) {
    modelMax = deriveMaxOutputTokens(C);
    trace.derivedMaxOutputTokens = modelMax;
    record('derive_max_output', { derived: modelMax, source: 'derived' });
  }
  const wireCeiling = input.providerWireMaxOutputTokens ?? modelMax;
  const outputCeiling = Math.min(modelMax, wireCeiling);
  record('output_ceiling', { modelMax, wireCeiling, outputCeiling });

  // 3. Reasoning reserve + provider dialect.
  const reasoningBudget = input.reasoningBudget ?? 'separate';
  const reasoningReserve = Math.max(0, Math.floor(
    input.reasoningReserveTokens ?? DEFAULT_REASONING_RESERVE[input.capabilities.reasoningMode],
  ));
  record('reasoning_reserve', { reasoningBudget, reasoningReserve });

  // 4. Output grant: prefer the business maximum, degrade to target, then to
  //    the wire-inclusive minimum. Inside-completion reasoning shares the
  //    wire budget, so the grant shrinks before the request ever fails.
  const demand = input.businessOutputDemand;
  let requested = Math.min(demand.maximum, outputCeiling);
  if (reasoningBudget === 'inside_completion' && requested + reasoningReserve > wireCeiling) {
    requested = Math.min(Math.max(demand.target, 0), wireCeiling - reasoningReserve);
  }
  const wireOutput = reasoningBudget === 'inside_completion'
    ? requested + reasoningReserve
    : requested;
  const effectiveMinimum = reasoningBudget === 'inside_completion'
    ? demand.minimum + reasoningReserve
    : demand.minimum;
  if (requested <= 0 || wireOutput < effectiveMinimum || wireOutput > wireCeiling) {
    record('output_grant', {
      blocked: 'output_demand_infeasible',
      requested,
      wireOutput,
      effectiveMinimum,
      wireCeiling,
    });
    throw new BudgetInfeasibleError(
      `Output demand infeasible: business minimum ${demand.minimum} + reasoning ${reasoningReserve}` +
        ` does not fit the wire ceiling ${wireCeiling}.`,
      'output_demand_infeasible',
    );
  }
  record('output_grant', { requested, wireOutput, minimum: demand.minimum, target: demand.target });

  // 5. Envelope: Hard = C - wire output - S; Soft/Burst at 80%/95%.
  const envelope = computeRequestEnvelope({
    contextWindowTokens: C,
    outputReservationTokens: requested,
    reasoningReserveTokens: reasoningReserve,
    reasoningBudget,
    safetyMarginTokens: input.safetyMarginTokens,
  });
  record('envelope', {
    hard: envelope.hardInputLimit,
    soft: envelope.softInputLimit,
    burst: envelope.burstInputLimit,
    safety: envelope.safetyMarginTokens,
  });

  // 6. Mandatory protocol floor must fit the hard limit (fail closed).
  const mandatoryTokens = Math.max(0, Math.floor(input.estimatedMandatoryInputTokens));
  if (mandatoryTokens > envelope.hardInputLimit) {
    record('mandatory_gate', { blocked: 'mandatory_input_infeasible', mandatoryTokens });
    throw new BudgetInfeasibleError(
      `Mandatory protocol input ${mandatoryTokens} exceeds the hard input limit ${envelope.hardInputLimit}.`,
      'mandatory_input_infeasible',
    );
  }
  record('mandatory_gate', { mandatoryTokens });

  // 7. Elastic allocation for everything else.
  const elasticLimit = envelope.hardInputLimit - mandatoryTokens;
  const demands: readonly ContextDemand[] = input.contextDemands ?? [];
  const allocation = demands.length > 0
    ? allocateElasticContext(demands, elasticLimit)
    : null;
  if (allocation?.status === 'infeasible') {
    record('elastic_allocation', { blocked: allocation.infeasibleReason ?? 'mandatory_exceeds_hard' });
    throw new BudgetInfeasibleError(
      'Mandatory context demands exceed the hard input limit.',
      'mandatory_exceeds_hard',
    );
  }
  if (allocation) {
    record('elastic_allocation', {
      demands: demands.length,
      totalAllocated: allocation.totalAllocated,
      hard: allocation.hardInputLimit,
    });
  }

  const capabilitiesFingerprint = stableFingerprint({
    contextWindow: C,
    contextWindowSource: input.capabilities.contextWindowSource,
    maxOutput: modelMax,
    maxOutputSource: trace.derivedMaxOutputTokens !== null ? 'derived' : input.capabilities.maxOutputSource,
    reasoningMode: input.capabilities.reasoningMode,
  });
  const contextPlanId = stableFingerprint({
    requestKind: input.requestKind,
    capabilitiesFingerprint,
    mandatoryTokens,
    allocations: allocation?.allocations.map(entry => [entry.id, entry.allocated]) ?? [],
  });

  return {
    requestKind: input.requestKind,
    capabilitiesFingerprint,
    contextPlanId,
    envelope,
    allocation,
    mandatoryInputTokens: mandatoryTokens,
    allocatedInputTokens: mandatoryTokens + (allocation?.totalAllocated ?? 0),
    requestedOutputTokens: requested,
    trace,
  };
}

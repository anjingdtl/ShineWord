import type { LlmRequest } from '../llm/types';
import type { FrozenModelCapabilities } from '../llm/requestPlan';
import { BudgetInfeasibleError } from '../llm/requestPlan';
import type { ReasoningPolicySelection } from '../llm/reasoningPolicy';
import { ReasoningCapabilityInsufficientError } from '../llm/reasoningPolicy';
import { planLlmRequest, DEFAULT_OUTPUT_DEMANDS } from '../llm/requestBudgetKernel';
import { estimateTokens } from '../context/tokenEstimate';

/** Recheck the ACTUAL post-settlement packet before Narrator dispatch. */
export function fitGuidanceNarratorRequest(request: LlmRequest, input: {
  capabilities: FrozenModelCapabilities;
  reasoningPolicy: ReasoningPolicySelection;
  plainNarratorSystem: string;
}): LlmRequest {
  if (input.capabilities.contextWindowTokens === null) {
    const payload = JSON.parse(request.user) as Record<string, unknown>;
    if (!payload.situationPacket) return request;
    delete payload.situationPacket;
    // Preserve the established legacy story envelope. With no declared
    // context limit, adding a guidance payload cannot be admitted safely.
    return { ...request, system: input.plainNarratorSystem, user: JSON.stringify(payload) };
  }
  const fit = (candidate: LlmRequest): LlmRequest => {
    const plan = planLlmRequest({
      capabilities: input.capabilities, requestKind: 'narrator',
      estimatedMandatoryInputTokens: estimateTokens(candidate.system + candidate.user) + 100,
      businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.narrator,
      providerWireMaxOutputTokens: candidate.maxOutputTokens,
      reasoningPolicy: { ...input.reasoningPolicy,
        ...(candidate.reasoningReserveTokens !== null && candidate.reasoningReserveTokens !== undefined
          ? { reserveTokensOverride: candidate.reasoningReserveTokens } : {}) },
    });
    return { ...candidate, maxOutputTokens: plan.wireOutputTokens,
      reasoningReserveTokens: plan.reasoningPolicy?.reserveTokens ?? candidate.reasoningReserveTokens };
  };
  try { return fit(request); } catch (error) {
    if (!(error instanceof BudgetInfeasibleError) && !(error instanceof ReasoningCapabilityInsufficientError)) throw error;
    const payload = JSON.parse(request.user) as Record<string, unknown>;
    if (!payload.situationPacket) throw error;
    // Guidance is optional derived content. If it cannot fit, keep the story
    // request within its budget and assemble local choices after settlement.
    delete payload.situationPacket;
    return fit({ ...request, system: input.plainNarratorSystem, user: JSON.stringify(payload) });
  }
}

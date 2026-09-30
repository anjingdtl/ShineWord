/** World Build adapter to the shared request budget kernel. */
import type { ApiProfile, LlmRequest, LlmRequestKind } from '../llm/types';
import { normalizeReasoningTier } from '../llm/types';
import { resolveModelCapabilities } from '../llm/capabilityResolver';
import { planLlmRequest } from '../llm/requestBudgetKernel';
import { DEFAULT_OUTPUT_DEMANDS } from '../llm/requestDemands';
import { reasoningDialectForModel } from '../llm/reasoningPolicy';
import { estimateTokens } from './groupPlanner';

export interface WorldBuildRequestGovernance {
  profile: ApiProfile;
  runId: string;
  worldId: string;
  modelProfileFingerprint: string;
  frozenReserveTokensByRequestKind?: Partial<Record<LlmRequestKind, number>>;
}

export interface GovernWorldBuildRequestInput {
  request: Omit<LlmRequest, 'maxOutputTokens'> & { maxOutputTokens?: number };
  requestKind: LlmRequestKind;
  logicalRequestId: string;
  governance: WorldBuildRequestGovernance;
  /** Optional same-tier reserve increase for a bounded reasoning-only retry. */
  reserveMultiplier?: number;
}

/**
 * Freeze one World Build request through the common envelope/policy kernel.
 * The entire serialized prompt remains mandatory: the kernel can reject it,
 * while the coordinator may then split its source ranges into smaller units.
 */
export function governWorldBuildRequest(input: GovernWorldBuildRequestInput): LlmRequest {
  const { profile } = input.governance;
  const contextWindowTokens = profile.capabilities.contextWindow;
  const modelMaxOutputTokens = profile.capabilities.maxOutputTokens;
  if (!Number.isInteger(contextWindowTokens) || (contextWindowTokens ?? 0) < 1) {
    throw new Error('World Build requires a known context window capability.');
  }
  if (!Number.isInteger(modelMaxOutputTokens) || (modelMaxOutputTokens ?? 0) < 1) {
    throw new Error('World Build requires a known model maxOutputTokens capability.');
  }

  const request = input.request;
  const prompt = `${request.system}\n${request.user}\n${(request.followUpUserMessages ?? []).join('\n')}`;
  const capabilities = resolveModelCapabilities({
    declared: {
      contextWindowTokens,
      maxOutputTokens: modelMaxOutputTokens,
      supportsJsonMode: profile.capabilities.supportsJson,
      reportsUsage: profile.capabilities.reportsUsage,
      supportsPromptCache: profile.capabilities.supportsPromptCache,
      reasoningUsageReported: profile.capabilities.reportsUsage,
    },
    reasoningMode: 'always_on',
  });
  const demand = DEFAULT_OUTPUT_DEMANDS[input.requestKind];
  const businessOutputTokens = Math.floor(request.maxOutputTokens ?? demand.target);
  const reasoningTier = normalizeReasoningTier(profile.reasoningTier ?? profile.reasoningEffort);
  const plan = planLlmRequest({
    capabilities,
    requestKind: input.requestKind,
    estimatedMandatoryInputTokens: estimateTokens(prompt),
    businessOutputDemand: {
      minimum: demand.minimum,
      target: businessOutputTokens,
      maximum: Math.min(demand.maximum, businessOutputTokens),
    },
    providerWireMaxOutputTokens: modelMaxOutputTokens!,
    reasoningPolicy: {
      tier: reasoningTier,
      providerDialect: profile.reasoningDialect ?? reasoningDialectForModel(profile.model),
      model: profile.model,
      reserveMultiplier: input.reserveMultiplier,
      reserveTokensOverride: input.governance.frozenReserveTokensByRequestKind?.[input.requestKind],
    },
  });
  const policy = plan.reasoningPolicy;
  if (!policy) throw new Error('World Build reasoning policy was not frozen.');
  const governedRequest = { ...request };
  // Legacy callers may still construct a request with reasoningEffort. Once
  // the request crosses this boundary, only the frozen product tier is valid.
  delete governedRequest.reasoningEffort;
  return {
    ...governedRequest,
    maxOutputTokens: plan.wireOutputTokens,
    maxPhysicalRequests: 1,
    reasoningTier: policy.tier,
    reasoningReserveTokens: policy.reserveTokens,
    reasoningPolicyVersion: policy.policyVersion,
    requestKind: input.requestKind,
    ledger: {
      logicalRequestId: input.logicalRequestId,
      requestKind: input.requestKind,
      worldId: input.governance.worldId,
    },
  };
}

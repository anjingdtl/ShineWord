/** Settings estimate, using the same capability resolver, policy and kernel
 * as production. It does not describe the mandatory input of an actual turn. */
import { resolveModelCapabilities } from './capabilityResolver';
import { planLlmRequest } from './requestBudgetKernel';
import { DEFAULT_OUTPUT_DEMANDS } from './requestDemands';
import { BudgetInfeasibleError, type BudgetInfeasibleCode } from './requestPlan';
import {
  ReasoningCapabilityInsufficientError,
  ReasoningDialectUnsupportedError,
} from './reasoningPolicy';
import type { LlmRequestKind, ReasoningDialect, ReasoningTier } from './types';

/** No turn protocol exists in settings; this is an explicit estimate only. */
export const PREVIEW_MANDATORY_INPUT_ESTIMATE = 0;

export interface RequestBudgetPreviewInput {
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  model: string;
  providerDialect: ReasoningDialect;
  reasoningTier: ReasoningTier;
  requestKind: LlmRequestKind;
  representativeMandatoryInputTokens?: number;
}

export type RequestBudgetPreview = {
  available: true;
  contextWindowTokens: number;
  businessOutputTokens: number;
  reasoningReserveTokens: number;
  safetyMarginTokens: number;
  hardInputLimit: number;
  softInputLimit: number;
  burstInputLimit: number;
  wireOutputTokens: number;
  reserveClamped: boolean;
} | {
  available: false;
  errorCode: BudgetInfeasibleCode | 'max_output_unknown'
    | 'reasoning_capability_insufficient' | 'reasoning_dialect_unsupported';
};

export function previewLlmRequestBudget(input: RequestBudgetPreviewInput): RequestBudgetPreview {
  const capabilities = resolveModelCapabilities({
    declared: {
      contextWindowTokens: input.contextWindowTokens,
      maxOutputTokens: input.maxOutputTokens,
    },
    reasoningMode: 'always_on',
  });
  if (capabilities.contextWindowTokens === null) {
    return { available: false, errorCode: 'context_window_unknown' };
  }
  // The production kernel can derive a runtime safety ceiling, but settings
  // must not present it as a known model capability or a precise preview.
  if (capabilities.maxOutputTokens === null) {
    return { available: false, errorCode: 'max_output_unknown' };
  }

  try {
    const plan = planLlmRequest({
      capabilities,
      requestKind: input.requestKind,
      estimatedMandatoryInputTokens: input.representativeMandatoryInputTokens
        ?? PREVIEW_MANDATORY_INPUT_ESTIMATE,
      businessOutputDemand: DEFAULT_OUTPUT_DEMANDS[input.requestKind],
      reasoningPolicy: {
        model: input.model,
        providerDialect: input.providerDialect,
        tier: input.reasoningTier,
      },
    });
    return {
      available: true,
      contextWindowTokens: capabilities.contextWindowTokens,
      businessOutputTokens: plan.requestedOutputTokens,
      reasoningReserveTokens: plan.envelope.reasoningReserveTokens,
      safetyMarginTokens: plan.envelope.safetyMarginTokens,
      hardInputLimit: plan.envelope.hardInputLimit,
      softInputLimit: plan.envelope.softInputLimit,
      burstInputLimit: plan.envelope.burstInputLimit,
      wireOutputTokens: plan.wireOutputTokens,
      reserveClamped: plan.reasoningPolicy!.reserveClamped,
    };
  } catch (error) {
    if (error instanceof BudgetInfeasibleError
      || error instanceof ReasoningCapabilityInsufficientError
      || error instanceof ReasoningDialectUnsupportedError) {
      return { available: false, errorCode: error.code };
    }
    throw error;
  }
}

import type { GuidanceDecisionPointBinding, TurnGuidanceV1 } from './types';
import { decisionPointIdFor } from './types';

export interface RecoverableGuidanceChoice {
  decisionPoint: GuidanceDecisionPointBinding;
  candidateRef: string;
}

export interface RecoverableGuidanceChoiceInput {
  campaignId: string;
  branchId: string;
  stateVersion: number | null | undefined;
  intent: string;
  guidance: TurnGuidanceV1 | null | undefined;
  recovery: {
    expectedStateVersion: number;
    intent: string;
    frozen: boolean;
    unknownAttemptIds: readonly string[];
  } | null | undefined;
}

/**
 * A pending composer draft may have started from a guidance button, then
 * waited for required scene content before dispatch. The draft persists only
 * the text, so recover the route binding only from one exact, current,
 * available guidance step. Frozen or unknown dispatches keep their original
 * recovery semantics and are never rebound here.
 */
export function resolveRecoverableGuidanceChoice(
  input: RecoverableGuidanceChoiceInput,
): RecoverableGuidanceChoice | null {
  const { campaignId, branchId, guidance, recovery } = input;
  const intent = input.intent.trim();
  const stateVersion = input.stateVersion;
  if (!intent || typeof stateVersion !== 'number' || !Number.isSafeInteger(stateVersion) || stateVersion < 0
    || !guidance || !recovery || recovery.frozen || recovery.unknownAttemptIds.length > 0
    || recovery.expectedStateVersion !== stateVersion || recovery.intent.trim() !== intent) {
    return null;
  }

  const binding = guidance.decisionPoint;
  if (binding.campaignId !== campaignId || binding.branchId !== branchId
    || binding.stateVersion !== stateVersion
    || binding.decisionPointId !== decisionPointIdFor(branchId, stateVersion)) {
    return null;
  }

  const matches = guidance.steps.filter(step => step.availability === 'available'
    && step.firstStepIntent.trim() === intent);
  if (matches.length !== 1) return null;
  return { decisionPoint: binding, candidateRef: matches[0]!.candidateRef };
}

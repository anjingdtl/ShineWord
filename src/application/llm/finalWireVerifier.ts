/**
 * Final wire verification (P8-2, plan §10.4): the last check runs after the
 * request is FULLY assembled - system, user payload, Prepared packet, repair
 * instructions, follow-up messages - and before any HTTP dispatch. Preview
 * numbers never substitute for this check.
 *
 * Failure here is a typed BudgetInfeasibleError, so the shared error
 * dispatch treats it like any other zero-send budget failure.
 */

import { BudgetInfeasibleError } from './requestPlan';
import { estimateTokens } from '../context/tokenEstimate';

export interface FinalWireMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface FinalWireBudget {
  /** Real model context window (verified capability, never fabricated). */
  contextWindowTokens: number;
  /** Input-side ceiling from the frozen envelope. */
  hardInputLimit: number;
  /** Output actually granted on the wire (business + reasoning reserve). */
  wireOutputTokens: number;
  /** Envelope safety margin. */
  safetyMarginTokens: number;
}

export interface FinalWireCheck {
  ok: boolean;
  estimatedInputTokens: number;
  hardInputLimit: number;
  overByTokens: number;
}

const PER_MESSAGE_OVERHEAD_TOKENS = 8;

export function estimateFinalWireInput(
  messages: readonly FinalWireMessage[],
  overheadPerMessage = PER_MESSAGE_OVERHEAD_TOKENS,
): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.content !== 'string' || !message.content) continue;
    total += estimateTokens(message.content) + overheadPerMessage;
  }
  return total;
}

/**
 * Verifies the fully-assembled request against the frozen envelope. Throws
 * `BudgetInfeasibleError('final_wire_exceeded')` when the real messages no
 * longer fit; the caller must not dispatch.
 */
export function verifyFinalWireRequest(input: {
  messages: readonly FinalWireMessage[];
  budget: FinalWireBudget;
}): FinalWireCheck {
  const { budget } = input;
  const estimatedInputTokens = estimateFinalWireInput(input.messages);
  const overByTokens = Math.max(
    0,
    Math.max(
      estimatedInputTokens - budget.hardInputLimit,
      estimatedInputTokens + budget.wireOutputTokens + budget.safetyMarginTokens - budget.contextWindowTokens,
    ),
  );
  const check: FinalWireCheck = {
    ok: overByTokens === 0,
    estimatedInputTokens,
    hardInputLimit: budget.hardInputLimit,
    overByTokens,
  };
  if (!check.ok) {
    throw new BudgetInfeasibleError(
      `Final wire check failed: estimated input ${estimatedInputTokens} exceeds the frozen envelope`
      + ` (hard input ${budget.hardInputLimit}, window ${budget.contextWindowTokens}, wire output ${budget.wireOutputTokens}) by ${overByTokens} tokens.`,
      'final_wire_exceeded',
    );
  }
  return check;
}

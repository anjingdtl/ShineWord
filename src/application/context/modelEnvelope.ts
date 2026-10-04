/**
 * Request envelope math (infrastructure plan §8-§9).
 *
 *   C = context window          O = output reservation
 *   R = reasoning reserve       S = safety margin
 *
 *   HardInput = C - O - R - S        SoftInput = 0.80 x HardInput
 *   BurstInput = 0.95 x HardInput
 *
 * When the provider bills reasoning INSIDE the completion budget the wire
 * output is O_business + R and R is subtracted from the input side exactly
 * once; when reasoning is a separate channel R never touches the input
 * window (plan §8: the adapter declares the dialect - never both).
 */

import { BudgetInfeasibleError } from '../llm/requestPlan';

export type ReasoningBudgetDialect = 'inside_completion' | 'separate';

export interface RequestEnvelopeInput {
  contextWindowTokens: number;
  /** Business (content) output tokens granted to this request. */
  outputReservationTokens: number;
  /** Chain-of-thought reserve; semantics decided by reasoningBudget. */
  reasoningReserveTokens: number;
  reasoningBudget: ReasoningBudgetDialect;
  /** Overrides the derived margin; used by tests and explicit policy. */
  safetyMarginTokens?: number;
}

export interface RequestEnvelope {
  contextWindowTokens: number;
  outputReservationTokens: number;
  reasoningReserveTokens: number;
  /** What actually goes on the wire as max_tokens. */
  wireOutputTokens: number;
  reasoningBudget: ReasoningBudgetDialect;
  safetyMarginTokens: number;
  hardInputLimit: number;
  softInputLimit: number;
  burstInputLimit: number;
}

export const SOFT_INPUT_RATIO = 0.8;
export const BURST_INPUT_RATIO = 0.95;

/**
 * Safety margin by window size (plan §9): small windows carry an absolute
 * floor, mid windows 1.5%, large windows are capped so 1M models do not
 * waste 20K tokens on jitter.
 */
export function deriveSafetyMargin(contextWindowTokens: number): number {
  if (!Number.isInteger(contextWindowTokens) || contextWindowTokens <= 0) {
    throw new Error('deriveSafetyMargin requires a positive integer context window.');
  }
  if (contextWindowTokens < 64_000) {
    return Math.max(1_024, Math.floor(contextWindowTokens * 0.02));
  }
  if (contextWindowTokens < 200_000) {
    return Math.max(1_024, Math.floor(contextWindowTokens * 0.015));
  }
  return Math.min(8_192, Math.max(1_024, Math.floor(contextWindowTokens * 0.01)));
}

export function computeRequestEnvelope(input: RequestEnvelopeInput): RequestEnvelope {
  const { contextWindowTokens: C } = input;
  if (!Number.isInteger(C) || C <= 0) {
    throw new Error('computeRequestEnvelope requires a positive integer context window.');
  }
  const O = Math.floor(input.outputReservationTokens);
  const R = Math.floor(input.reasoningReserveTokens);
  if (O < 0 || R < 0) throw new Error('Envelope reservations must be non-negative.');

  const S = Math.floor(
    input.safetyMarginTokens ?? deriveSafetyMargin(C),
  );
  // Reasoning inside the completion budget consumes the wire output AND the
  // context window once (the completion is part of the window); a separate
  // reasoning channel does not reduce the input window at all.
  const wireOutputTokens = input.reasoningBudget === 'inside_completion'
    ? O + R
    : O;
  const inputSideOutput = wireOutputTokens;

  const hardInputLimit = C - inputSideOutput - S;
  if (hardInputLimit <= 0) {
    // P8-2: a typed failure, so the planner's BudgetInfeasibleError
    // dispatch sees it instead of crashing the turn with a plain Error.
    throw new BudgetInfeasibleError(
      `Envelope infeasible: context ${C} - output ${inputSideOutput} - safety ${S} leaves no input room.`,
      'envelope_infeasible',
    );
  }
  return {
    contextWindowTokens: C,
    outputReservationTokens: O,
    reasoningReserveTokens: R,
    wireOutputTokens,
    reasoningBudget: input.reasoningBudget,
    safetyMarginTokens: S,
    hardInputLimit,
    softInputLimit: Math.floor(hardInputLimit * SOFT_INPUT_RATIO),
    burstInputLimit: Math.floor(hardInputLimit * BURST_INPUT_RATIO),
  };
}

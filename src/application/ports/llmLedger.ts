/**
 * Durable physical-request ledger port (infrastructure plan §51-§56).
 *
 * One row per PHYSICAL dispatch of a logical business request. Lifecycle:
 *   prepared -> sent -> succeeded | failed
 *   prepared | sent  -> outcome_unknown (cold start after process kill)
 *   any      -> cancelled (user abort)
 *
 * An outcome_unknown attempt BLOCKS automatic replay of the same logical
 * request: the server may have completed and billed it.
 */

import type { ReasoningTier } from '../llm/types';

export type LlmAttemptStatus =
  | 'prepared'
  | 'sent'
  | 'succeeded'
  | 'failed'
  | 'outcome_unknown'
  | 'cancelled';

export type LlmFailureClass =
  | 'network_connect'
  | 'timeout_unknown'
  | 'http_rate_limit'
  | 'http_server'
  | 'http_client'
  | 'content_filter'
  | 'reasoning_only'
  | 'length'
  | 'empty'
  | 'no_choices'
  | 'invalid_transport_json'
  | 'invalid_business_json'
  | 'schema_invalid'
  | 'budget_infeasible'
  | 'cancelled'
  | 'unknown';

export interface LlmRequestAttemptRecord {
  attemptId: string;
  logicalRequestId: string;
  requestKind: string;
  campaignId: string | null;
  branchId: string | null;
  worldId: string | null;
  stateVersion: number | null;
  modelProfileFingerprint: string;
  reasoningTier: ReasoningTier | null;
  attemptNo: number;
  status: LlmAttemptStatus;
  failureClass: string | null;
  errorCode: string | null;
  httpStatus: number | null;
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cachedInputTokens: number | null;
  estimatedUsage: number;
  startedAt: number;
  finishedAt: number | null;
}

export interface NewLlmRequestAttempt {
  logicalRequestId: string;
  requestKind: string;
  campaignId?: string | null;
  branchId?: string | null;
  worldId?: string | null;
  stateVersion?: number | null;
  modelProfileFingerprint: string;
  reasoningTier?: ReasoningTier | null;
}

export interface LlmAttemptPatch {
  status?: LlmAttemptStatus;
  failureClass?: LlmFailureClass | null;
  errorCode?: string | null;
  httpStatus?: number | null;
  providerRequestId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  cachedInputTokens?: number | null;
  estimatedUsage?: number;
  finishedAt?: number;
}

export interface LlmRequestLedgerStore {
  /** Creates attempt 1..N for the logical request; id = `<logical>#a<N>`. */
  beginAttempt(input: NewLlmRequestAttempt, startedAt: number): Promise<LlmRequestAttemptRecord>;
  updateAttempt(attemptId: string, patch: LlmAttemptPatch): Promise<void>;
  listAttempts(logicalRequestId: string): Promise<LlmRequestAttemptRecord[]>;
  /** Known samples only; unknown provider usage is not represented as zero. */
  listRecentReasoningTokens(input: {
    modelProfileFingerprint: string;
    reasoningTier: ReasoningTier;
    requestKind: string;
    limit: number;
  }): Promise<number[]>;
  /** Attempt ids still in prepared/sent (interrupted dispatch candidates). */
  listInterruptedAttemptIds(): Promise<string[]>;
}

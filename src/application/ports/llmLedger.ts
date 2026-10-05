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
import type { BuildRunStatus } from './worldBuildStore';

export type LlmAttemptStatus =
  | 'prepared'
  | 'sent'
  | 'succeeded'
  | 'failed'
  | 'outcome_unknown'
  | 'cancelled';

export type LlmFailureClass =
  | 'network_connect'
  | 'network_unknown'
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
  requestFingerprint?: string | null;
  responseJson?: string | null;
  responseHash?: string | null;
  attemptId: string;
  logicalRequestId: string;
  requestKind: string;
  campaignId: string | null;
  branchId: string | null;
  worldId: string | null;
  stateVersion: number | null;
  modelProfileFingerprint: string;
  reasoningTier: ReasoningTier | null;
  reasoningReserveTokens: number | null;
  reasoningPolicyVersion: string | null;
  wireOutputTokens: number | null;
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
  /** Explicit player acknowledgement; preserves the unknown outcome and usage. */
  replayApprovedAt?: number | null;
}

export interface NewLlmRequestAttempt {
  requestFingerprint?: string;
  physicalAttemptLimit?: number;
  /** Explicit operator replay only; never inferred from elapsed time. */
  allowOutcomeUnknownReplay?: boolean;
  logicalRequestId: string;
  requestKind: string;
  campaignId?: string | null;
  branchId?: string | null;
  worldId?: string | null;
  stateVersion?: number | null;
  modelProfileFingerprint: string;
  reasoningTier?: ReasoningTier | null;
  reasoningReserveTokens?: number | null;
  reasoningPolicyVersion?: string | null;
  wireOutputTokens?: number | null;
}

export interface LlmAttemptPatch {
  responseJson?: string;
  responseHash?: string;
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
  /** Known succeeded or failed physical usage only; unknown is never represented as zero. */
  listRecentReasoningTokens(input: {
    modelProfileFingerprint: string;
    reasoningTier: ReasoningTier;
    requestKind: string;
    limit: number;
  }): Promise<number[]>;
  /** Attempt ids still in prepared/sent (interrupted dispatch candidates). */
  listInterruptedAttemptIds(): Promise<string[]>;
}

/** Exact, reviewable approval; recording it never dispatches or resumes work. */
export interface BuildReplaySnapshotV1 {
  runId: string;
  worldId: string;
  fencingToken: number;
  status: BuildRunStatus;
  sourceSnapshotHash: string;
  modelFingerprint: string;
  pauseRequested: boolean;
  cancelRequested: boolean;
  attemptIds: readonly string[];
  attempts: ReadonlyArray<Pick<LlmRequestAttemptRecord, 'attemptId' | 'requestKind' | 'startedAt' | 'wireOutputTokens'>>;
}

export interface LlmBuildRecoveryPort {
  readBuildUnknownRunIds(worldIds: readonly string[]): Promise<ReadonlySet<string>>;
  readBuildRequestOutcome(runId: string, worldId: string): Promise<'none' | 'prepared' | 'sent' | 'known' | 'outcome_unknown'>;
  readBuildReplay(runId: string): Promise<BuildReplaySnapshotV1 | null>;
  acknowledgeBuildReplay(snapshot: BuildReplaySnapshotV1): Promise<void>;
}

export interface LlmReplayApprovalPort {
  acknowledgePlayReplay(input: { campaignId: string; branchId: string; expectedStateVersion: number;
    attemptIds: readonly string[] }): Promise<void>;
  acknowledgeMemoryReplay(input: { campaignId: string; branchId: string;
    attemptIds: readonly string[] }): Promise<void>;
}

import type { LlmPhysicalRequestMetric } from '../llm/types';

/**
 * Persistent build-run storage (closeout C2, plan §6.2).
 *
 * One coordinator owns a run at a time. Ownership is a CAS lease with a
 * monotonically increasing fencing token: a stale owner (process recycled,
 * foreground/background double runner) can heartbeat-fail and its late unit
 * completions are rejected by token comparison, so two executors can never
 * both count the same work.
 */

export type BuildRunPhase =
  | 'reading' | 'normalizing' | 'indexing' | 'extracting'
  | 'merging' | 'mapping' | 'validating' | 'publishing';

export type BuildRunStatus =
  | 'queued' | 'running' | 'waiting_network' | 'waiting_unlock'
  | 'paused_system' | 'paused_user' | 'failed_retryable' | 'needs_review'
  | 'failed_terminal' | 'canceled' | 'completed';

export type BuildUnitKind = 'extract_group' | 'map_batch';

export type BuildUnitStatus =
  | 'queued' | 'running' | 'waiting_network' | 'waiting_unlock'
  | 'failed_retryable' | 'needs_review' | 'failed_terminal' | 'canceled' | 'completed';

export interface BuildRunRecord {
  runId: string;
  worldId: string;
  sourceId: string;
  sourceSnapshotHash: string;
  pipelineVersion: string;
  planVersion: string;
  modelFingerprint: string;
  phase: BuildRunPhase;
  status: BuildRunStatus;
  unitsTotal: number;
  unitsDone: number;
  unitsFailed: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  fencingToken: number;
  heartbeatAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BuildUnitRecord {
  unitId: string;
  runId: string;
  kind: BuildUnitKind;
  sourceRangesJson: string;
  inputHash: string;
  configFingerprint: string;
  parentUnitId: string | null;
  ord: number;
  status: BuildUnitStatus;
  attempt: number;
  retryAt: string | null;
  resultRef: string | null;
  usageJson: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BuildRunStore {
  createRun(run: BuildRunRecord, units: readonly BuildUnitRecord[]): Promise<void>;
  getRun(runId: string): Promise<BuildRunRecord | null>;
  listResumableRuns(): Promise<BuildRunRecord[]>;
  /**
   * CAS lease acquire. Fails when another live owner holds the lease or the
   * run is in a terminal state. On success the fencing token increments.
   */
  acquireLease(runId: string, owner: string, ttlMs: number, now: string): Promise<number | null>;
  renewLease(runId: string, owner: string, fencingToken: number, ttlMs: number, now: string): Promise<boolean>;
  releaseLease(runId: string, owner: string, fencingToken: number, now: string): Promise<boolean>;
  heartbeat(runId: string, owner: string, now: string): Promise<boolean>;
  setRunStatus(runId: string, status: BuildRunStatus, now: string, errorCode?: string | null, errorMessage?: string | null): Promise<void>;
  setRunPhase(runId: string, phase: BuildRunPhase, now: string): Promise<void>;

  listUnits(runId: string): Promise<BuildUnitRecord[]>;
  listExecutableUnits(runId: string, now: string): Promise<BuildUnitRecord[]>;
  claimUnit(unitId: string, now: string): Promise<boolean>;
  /** Fenced completion: rejected when the run's token moved on. */
  completeUnit(input: {
    unitId: string;
    fencingToken: number;
    status: BuildUnitStatus;
    resultRef?: string | null;
    usageJson?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    retryAt?: string | null;
    now: string;
  }): Promise<boolean>;
  /** Appends sanitized physical-attempt measurements to the unit checkpoint. */
  appendUnitRequestMetrics(
    unitId: string,
    fencingToken: number,
    metrics: readonly LlmPhysicalRequestMetric[],
    now: string,
  ): Promise<boolean>;
  /** Replaces a unit with child units (C3 split); fenced by token. */
  replaceUnitWithChildren(input: {
    unitId: string;
    fencingToken: number;
    children: readonly Omit<BuildUnitRecord, 'runId'>[];
    now: string;
  }): Promise<boolean>;
}

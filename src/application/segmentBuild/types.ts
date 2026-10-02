import type { BuildIntentV1, IndexCoverageV1, PublishedArtifactV1, SegmentRecordV1, SourceRangeV1, SourceSetBindingV1 } from '../../domain/build/phase6';
import type { ReadinessViewV1 } from '../ports/phase6';

export type SegmentPauseReason = ReadinessViewV1['pauseReason'];
export type SegmentDemandRef = BuildIntentV1['demandRefs'][number];
export interface SegmentPlanV1 {
  planId: string;
  worldId: string;
  planVersion: 'segment-plan-1';
  sourceBinding: SourceSetBindingV1;
  executionConfigFingerprint: string;
  pauseReason: SegmentPauseReason;
  createdAt: string;
  updatedAt: string;
}
export interface SegmentDemandV1 {
  demandId: string;
  worldId: string;
  segmentId: string;
  generation: number;
  ref: SegmentDemandRef | null;
  reason: BuildIntentV1['reason'];
  priority: BuildIntentV1['priority'];
  active: boolean;
  createdAt: string;
}
/** M3 owns only plans, demand references, and rebuildable status projections. */
export interface SegmentPlanStoreV1 {
  ensurePlan(plan: SegmentPlanV1): Promise<SegmentPlanV1>;
  getPlan(worldId: string): Promise<SegmentPlanV1 | null>;
  listSegments(worldId: string): Promise<SegmentRecordV1[]>;
  findSegmentByRunId(runId: string): Promise<SegmentRecordV1 | null>;
  registerDemand(segment: SegmentRecordV1, workFingerprint: string, demand: SegmentDemandV1): Promise<SegmentRecordV1>;
  saveProjection(segment: SegmentRecordV1): Promise<boolean>;
  attachRuns(segmentId: string, generation: number, runIds: readonly string[], now: string): Promise<boolean>;
  listDemands(worldId: string): Promise<SegmentDemandV1[]>;
  setPause(worldId: string, reason: SegmentPauseReason, now: string): Promise<boolean>;
  cancelDemand(demandId: string): Promise<void>;
}
export interface PublishedArtifactCatalogV1 {
  listPublishedArtifacts(worldId: string): Promise<readonly PublishedArtifactV1[]>;
}
export interface SegmentIndexCoverageReaderV1 {
  readIndexCoverage(worldId: string): Promise<readonly IndexCoverageV1[]>;
}
export interface BranchArtifactReadinessV1 {
  artifactId: string;
  status: 'adopted' | 'available' | 'pending_adoption';
}
export interface SegmentReadinessV1 extends ReadinessViewV1 {
  branchArtifacts: readonly BranchArtifactReadinessV1[];
  indexCoverage: readonly IndexCoverageV1[];
  executingRanges: readonly SourceRangeV1[];
  recentCandidates: readonly SegmentRecordV1[];
  diagnostics: ReadonlyArray<{ segmentId: string; code: string; retryAt: string | null }>;
}

import type { BuildRunPhase, BuildRunStatus, BuildRunStore } from '../worldBuildStore';
import type { ContentDependencyBinding } from '../../../domain/content/types';
import type { BuildIntentV1, SourceCatalogMemberV1, SourceRangeV1, SourceSetBindingV1,
  SearchScopeV1, SourceSearchResultV1, PublishedArtifactV1, SegmentRecordV1, RequestPriority } from '../../../domain/build/phase6';
import type { EffectiveStyleSnapshotV1, ProjectStyleEditV1, ProjectStyleViewV1 } from '../../../domain/style/types';
export * from '../../../domain/build/phase6';
export * from '../../../domain/style/types';
export interface SourceCatalogPortV1 {
  snapshot(worldId: string): Promise<{ binding: SourceSetBindingV1; members: readonly SourceCatalogMemberV1[] }>;
  readRange(range: SourceRangeV1): Promise<string>;
  createRange(sourceId: string, startCp: number, endCp: number): Promise<SourceRangeV1>;
  isBindingCompatible(worldId: string, binding: SourceSetBindingV1): Promise<boolean>;
}
export interface SourceSearchPortV1 {
  search(input: { worldId: string; query: string; scope: SearchScopeV1; topK?: number }): Promise<SourceSearchResultV1>;
  ensureIndexed(ranges: readonly SourceRangeV1[]): Promise<void>;
}
export interface BuildExecutionViewV1 {
  runId: string; phase: BuildRunPhase; status: BuildRunStatus;
  completedUnits: number; failedUnits: number; totalUnits: number;
  requestOutcome: 'none' | 'prepared' | 'sent' | 'known' | 'outcome_unknown';
  lastErrorCode: string | null; retryAt: string | null; fencingToken: number;
}
export interface BuildExecutorPortV1 {
  ensureRun(intent: BuildIntentV1): Promise<{ runIds: readonly string[] }>;
  requestControl(runId: string, command: 'pause' | 'resume' | 'cancel'): Promise<void>;
  readExecution(runId: string): Promise<BuildExecutionViewV1>;
}
/** The single existing lease owner; Android must use this port rather than another lease table. */
export type BuildLeasePortV1 = Pick<BuildRunStore, 'acquireLease' | 'renewLease' | 'releaseLease'>;
export interface ContentBindingV1 extends ContentDependencyBinding {
  artifactIds: readonly string[];
  artifactManifestHash?: string;
}
export interface AdoptionReceiptV1 {
  status: 'adopted' | 'pending' | 'rejected';
  reason: 'ok' | 'already_adopted' | 'interaction_running' | 'state_changed' | 'manifest_changed'
    | 'missing_branch' | 'invalid_artifact' | 'missing_dependency' | 'source_changed';
  binding: ContentBindingV1 | null;
}
export interface BranchContentPortV1 {
  adoptAtSafeBoundary(input: { campaignId: string; branchId: string; expectedStateVersion: number;
    expectedManifestHash: string; artifactIds: readonly string[] }): Promise<AdoptionReceiptV1>;
  freezeBinding(campaignId: string, branchId: string): Promise<ContentBindingV1>;
}
export interface ReadinessViewV1 {
  worldId: string; segments: readonly SegmentRecordV1[]; availableArtifacts: readonly PublishedArtifactV1[];
  currentBinding: ContentBindingV1 | null; unmetDemandIds: readonly string[];
  pauseReason: 'user' | 'system' | 'budget' | 'network' | 'unlock' | null;
}
export interface ProjectStylePortV1 {
  getProjectStyle(projectId: string): Promise<ProjectStyleViewV1>;
  updateProjectStyle(input: ProjectStyleEditV1): Promise<{ styleVersion: string }>;
  freezeEffectiveStyle(input: { projectId: string; branchId: string; turnId: string;
    sceneKind: string; participantIds: readonly string[]; tokenAllowance: number }): Promise<EffectiveStyleSnapshotV1>;
}
export interface RequestSchedulingMetadataV1 {
  logicalTaskId: string;
  role: 'planner' | 'narrator' | 'extractor' | 'mapper' | 'style_analyzer' | 'summarizer'
    | 'goal_recommender' | 'other_existing';
  priority: RequestPriority; endpointBucketId: string; requestPlanHash: string;
  estimatedInputTokens: number; reservedOutputTokens: number; queueDeadlineAt?: string;
}
export interface ExecutionHostPortV1 {
  start(runId: string): Promise<void>;
  control(runId: string, command: 'pause' | 'resume' | 'cancel'): Promise<void>;
}

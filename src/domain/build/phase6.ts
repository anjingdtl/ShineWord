/** Frozen phase6-contracts-1. Source coordinates are ALWAYS source-local code points. */
export const PHASE6_CONTRACT_VERSION = 'phase6-contracts-1' as const;
export const SEGMENT_PLAN_VERSION = 'segment-plan-1' as const;
export type RequestPriority = 'P0' | 'P1' | 'P2' | 'P3';
export interface SourceRangeV1 {
  sourceId: string;
  normalizedTreeHash: string;
  startCp: number;
  endCp: number;
  rangeContentHash: string;
}
export interface SourceSetBindingV1 {
  sourceSetHash: string;
  members: ReadonlyArray<{ sourceId: string; sourceOrdinal: number; normalizedTreeHash: string }>;
}
export type SourceCatalogMemberV1 = SourceSetBindingV1['members'][number] & {
  codePointCount: number;
  rawSha256Hex: string;
  chapters: ReadonlyArray<{ chapterId: string; startCp: number; endCp: number; title: string }>;
}
export type SearchScopeV1 =
  | { kind: 'player_known'; branchId: string; stateVersion: number; knowledgeSnapshotHash: string;
      contentManifestHash: string; allowedRanges: readonly SourceRangeV1[] }
  | { kind: 'build_internal'; worldId: string; intentId: string; sourceBinding: SourceSetBindingV1;
      allowedRanges: readonly SourceRangeV1[] }
  | { kind: 'explicit_source_lookup'; branchId: string; userCommandId: string;
      sourceBinding: SourceSetBindingV1; allowedRanges: readonly SourceRangeV1[] };
export interface BuildIntentV1 {
  intentId: string; worldId: string; planVersion: string; segmentId: string; generation: number;
  sourceBinding: SourceSetBindingV1; ranges: readonly SourceRangeV1[];
  reason: 'bootstrap' | 'action_dependency' | 'near_domain' | 'buffer' | 'user_full';
  priority: RequestPriority; executionConfigFingerprint: string;
  demandRefs: ReadonlyArray<{ campaignId: string; branchId: string; stateVersion: number; userCommandId?: string }>;
}
export type SegmentStatusV1 = 'planned' | 'extracting' | 'mapping' | 'validating' | 'ready'
  | 'needs_review' | 'paused' | 'failed_retryable' | 'failed_terminal' | 'canceled' | 'stale';
export interface SegmentRecordV1 {
  intent: BuildIntentV1; runIds: readonly string[]; artifactIds: readonly string[];
  publishedCoverage: readonly SourceRangeV1[]; status: SegmentStatusV1;
  lastErrorCode: string | null; updatedAt: string;
}
export interface PublishedArtifactV1 {
  artifactId: string; worldId: string; segmentId: string; generation: number;
  sourceBinding: SourceSetBindingV1; coverage: readonly SourceRangeV1[];
  canonSnapshotHash: string; contentHash: string; validationVersion: string;
}
export interface IndexCoverageV1 {
  sourceId: string; normalizedTreeHash: string; indexVersion: string;
  indexedRanges: ReadonlyArray<{ startCp: number; endCp: number }>;
  complete: boolean; lastCheckpoint: number; corrupt: boolean;
}
export interface SourceSearchHitV1 {
  range: SourceRangeV1; chapterId: string; score: number; text: string;
}
export interface SourceSearchResultV1 {
  hits: readonly SourceSearchHitV1[]; coverage: readonly IndexCoverageV1[];
  completeness: 'complete' | 'partial';
}
export interface OpeningRequirementsV1 {
  requiredEntityIds: readonly string[]; requiredFactIds: readonly string[];
  requiredEventIds: readonly string[]; requiredEntryIds: readonly string[];
  ranges: readonly SourceRangeV1[];
}
export interface CanonDeltaV1 {
  worldId: string; factIds: readonly string[]; entityIds: readonly string[]; eventIds: readonly string[];
  canonSnapshotHash: string; executionConfigFingerprint: string;
}
export type Phase6EventPayloads = {
  SourceActivated: { sourceId: string; normalizedTreeHash: string };
  SourceMembershipChanged: { sourceBinding: SourceSetBindingV1 };
  IndexCoverageAdvanced: { sourceId: string; lastCheckpoint: number };
  CanonDeltaCommitted: CanonDeltaV1;
  BuildExecutionChanged: { runId: string; status: string; fencingToken: number };
  SegmentArtifactPublished: { artifactId: string; contentHash: string };
  BranchContentAdopted: { branchId: string; stateVersion: number; manifestHash: string };
  ProjectStyleChanged: { projectId: string; styleVersion: string };
};
export type Phase6EventV1 = { [K in keyof Phase6EventPayloads]: {
  eventId: string; eventType: K; contractVersion: typeof PHASE6_CONTRACT_VERSION;
  worldId: string; aggregateId: string; generation: number; payloadHash: string;
  occurredAt: string; payload: Phase6EventPayloads[K];
} }[keyof Phase6EventPayloads];

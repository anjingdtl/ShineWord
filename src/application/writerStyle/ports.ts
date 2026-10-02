import type { EffectiveStyleSnapshotV1, ProjectStyleViewV1, StyleSemanticV1 } from '../../domain/style/types';
import type { SourceRangeV1 } from '../../domain/build/phase6';

export interface ProjectStyleBindingRecord extends ProjectStyleViewV1 {
  revision: number;
  /** Pinned baseline is kept separate from effective semantic and user edits. */
  baseline: StyleSemanticV1;
}
export interface SourceStyleSample { range: SourceRangeV1; text: string }
export interface SourceStyleProfile {
  profileId: string; projectId: string; cacheKey: string; profileVersion: string;
  sampleHash: string; samplerVersion: string; analyzerVersion: string; configFingerprint: string;
  semantic: StyleSemanticV1; confidence: number; coverageDescription: string;
  evidence: readonly SourceRangeV1[]; createdAt: string;
}
export interface SourceStyleAnalysisRecord {
  projectId: string; cacheKey: string; logicalRequestId: string;
  status: 'running' | 'ready' | 'failed'; errorCode: string | null; updatedAt: string;
}
/** M8 is the sole writer for these four durable data domains. */
export interface WriterStyleStore {
  putAsset(asset: { assetId: string; assetVersion: string; semantic: StyleSemanticV1 }): Promise<StyleSemanticV1>;
  getBinding(projectId: string): Promise<ProjectStyleBindingRecord | null>;
  initializeBinding(binding: ProjectStyleBindingRecord): Promise<ProjectStyleBindingRecord>;
  compareAndSetBinding(binding: ProjectStyleBindingRecord, expectedVersion: string): Promise<boolean>;
  getProfile(projectId: string, cacheKey: string): Promise<SourceStyleProfile | null>;
  listProfiles(projectId: string): Promise<SourceStyleProfile[]>;
  getAnalysis(projectId: string, cacheKey: string): Promise<SourceStyleAnalysisRecord | null>;
  /** Atomic claim prevents simultaneous analyzers from sending the same paid task. */
  claimAnalysis(record: SourceStyleAnalysisRecord): Promise<boolean>;
  /** Explicitly requested retry only; the existing ledger still rejects outcome_unknown. */
  retryFailedAnalysis(record: SourceStyleAnalysisRecord): Promise<boolean>;
  finishAnalysis(record: SourceStyleAnalysisRecord, profile?: SourceStyleProfile): Promise<void>;
  getSnapshot(projectId: string, branchId: string, turnId: string): Promise<EffectiveStyleSnapshotV1 | null>;
  /** Insert only; a frozen turn must never be rewritten. Returns a concurrent winner. */
  putSnapshot(snapshot: EffectiveStyleSnapshotV1): Promise<EffectiveStyleSnapshotV1>;
  listSnapshots(projectId: string, branchId?: string): Promise<EffectiveStyleSnapshotV1[]>;
}
export type VoiceExpression = Partial<Pick<StyleSemanticV1, 'characterVoice' | 'dialogue' | 'syntax' | 'vocabulary'>>;
export interface KnownParticipantVoice {
  participantId: string;
  /** Resolver must derive this from the frozen branch's player-known projection. */
  knownToPlayer: true;
  expression: VoiceExpression;
}
export interface ParticipantVoicePort {
  resolveKnownVoices(input: { projectId: string; branchId: string; participantIds: readonly string[] }): Promise<readonly KnownParticipantVoice[]>;
}

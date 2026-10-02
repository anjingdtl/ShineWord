import type { PublishedArtifactV1, SourceRangeV1 } from '../build/phase6';
import type { BookSection, ContentDependencyBinding, ContentEntry } from './types';

export const SEGMENT_ARTIFACT_VERSION = 'shineword-segment-artifact-1' as const;
export const SEGMENT_VALIDATION_VERSION = 'segment-validation-1' as const;
/** Initial limits deliberately match the old delta bounds. A logical segment
 * may publish several units; neither protocol accepts a 20k-character unit. */
export const SEGMENT_ARTIFACT_LIMITS = Object.freeze({ ranges: 64, codePoints: 12_000, entries: 500,
  sections: 100, dependencies: 64, citations: 4_000, jsonBytes: 2_000_000 });
export interface ArtifactReferenceV1 { artifactId: string; contentHash: string }
/** Source identities are explicit even though entries keep the legacy book
 * projection. Each provenance field has its own independently checked proof. */
export interface SegmentCitationV1 {
  entryId: string;
  field: 'provenance' | `fieldProvenance.${string}`;
  sourceFactIds: readonly string[];
  ranges: readonly SourceRangeV1[];
}
export interface SegmentArtifactV1 extends PublishedArtifactV1 {
  schemaVersion: typeof SEGMENT_ARTIFACT_VERSION;
  validationVersion: typeof SEGMENT_VALIDATION_VERSION;
  basePackage: { revision: number; contentHash: string };
  ruleset: { id: string; version: string };
  mappingVersion: string;
  dependencies: readonly ArtifactReferenceV1[];
  entries: readonly ContentEntry[];
  sections: readonly BookSection[];
  citations: readonly SegmentCitationV1[];
  validation: { warnings: readonly string[] };
  createdAt: string;
}
/** Legacy manifest stays intact. The second digest fences world artifact
 * references, and is covered by new action contracts and save snapshots. */
export interface SegmentContentBindingV1 extends ContentDependencyBinding {
  artifactIds: readonly string[];
  artifactManifestHash?: string;
}
export interface SegmentArtifactManifestV1 {
  schemaVersion: 'shineword-artifact-manifest-1';
  worldId: string;
  branchId: string;
  stateVersion: number;
  legacyManifestHash: string;
  artifacts: readonly ArtifactReferenceV1[];
  artifactManifestHash: string;
}

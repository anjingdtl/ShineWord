import type { SegmentArtifactV1, SegmentContentBindingV1 } from '../../domain/content/segmentArtifact';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import { createSegmentArtifactManifest, isSegmentContentBindingV1, verifySegmentArtifact } from '../segmentPublication/protocol';
import { verifyEffectiveStyleSnapshotHash } from '../writerStyle/projectStyleService';
import type { ProjectStyleBindingRecord } from '../writerStyle/ports';
import type { SqliteTransaction } from '../ports/sqlite';
import { canonicalStringify, type CanonicalJson } from '../../domain/turns/canonical';
import { validateStyleId, validateStyleOverrides, validateStyleSemantic } from '../../domain/style/validation';
import { resolveStyleSemantic } from '../writerStyle/compiler';

/** M8 owns restoring this binding. Profiles and unfinished paid analyses are
 * not portable; the pinned baseline makes source mode locally recoverable. */
export interface PortableProjectStyleV1 {
  schemaVersion: 'shineword-project-style-1';
  binding: ProjectStyleBindingRecord;
  contentHash: string;
}
export interface ProjectStyleArchivePortV1 {
  exportProjectStyle(projectId: string): Promise<PortableProjectStyleV1 | null>;
  restoreProjectStyle(tx: SqliteTransaction, targetProjectId: string, style: PortableProjectStyleV1): Promise<void>;
}
export async function computePortableProjectStyleHash(binding: ProjectStyleBindingRecord,
  sha256Hex: Sha256HexProvider['sha256Hex']): Promise<string> {
  return (await sha256Hex(canonicalStringify({ schemaVersion: 'shineword-project-style-1', binding } as unknown as CanonicalJson))).toLowerCase();
}
export async function validatePortableProjectStyle(value: unknown, projectId: string,
  sha256Hex: Sha256HexProvider['sha256Hex']): Promise<boolean> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const style = value as PortableProjectStyleV1;
    if (Object.keys(style).some(key => !['schemaVersion', 'binding', 'contentHash'].includes(key))
      || style.schemaVersion !== 'shineword-project-style-1' || !/^[a-f0-9]{64}$/.test(style.contentHash)
      || !style.binding || typeof style.binding !== 'object' || Array.isArray(style.binding)) return false;
    const b = style.binding;
    if (Object.keys(b).some(key => !['projectId', 'mode', 'styleId', 'styleVersion', 'sourceProfileVersion',
      'userOverrideVersion', 'semantic', 'overrides', 'analysisStatus', 'revision', 'baseline'].includes(key))
      || b.projectId !== projectId || !['source', 'preset', 'custom'].includes(b.mode)
      || !['pending', 'running', 'ready', 'failed', 'suggestion'].includes(b.analysisStatus)
      || !Number.isSafeInteger(b.revision) || b.revision < 1
      || !Number.isSafeInteger(b.userOverrideVersion) || b.userOverrideVersion < 0) return false;
    validateStyleId(b.projectId); validateStyleId(b.styleId); validateStyleId(b.styleVersion);
    if (b.sourceProfileVersion !== null) validateStyleId(b.sourceProfileVersion);
    validateStyleSemantic(b.baseline); validateStyleSemantic(b.semantic); validateStyleOverrides(b.overrides);
    if (canonicalStringify(b.semantic as unknown as CanonicalJson) !== canonicalStringify(resolveStyleSemantic(b.baseline, b.overrides) as unknown as CanonicalJson)) return false;
    return await computePortableProjectStyleHash(b, sha256Hex) === style.contentHash;
  } catch { return false; }
}

export interface FrozenContractBundleEntry {
  json: string; hash: string; turnId: string; expectedStateVersion: number; status: string;
}

/** Full validation before an import writes any row. Source text and credentials are excluded. */
export async function validatePhase6Bundle(input: {
  worldId: string; baseRevision: number; baseHash: string; artifacts: readonly SegmentArtifactV1[];
  snapshots: readonly GameStateSnapshot[]; contracts: readonly FrozenContractBundleEntry[];
}, sha256Hex: Sha256HexProvider['sha256Hex']): Promise<string[]> {
  const errors: string[] = [];
  if (!Array.isArray(input.artifacts) || input.artifacts.length > 512) return ['Invalid segment artifact bundle.'];
  const byId = new Map<string, SegmentArtifactV1>();
  for (const artifact of input.artifacts) {
    if (!await verifySegmentArtifact(artifact, sha256Hex) || artifact.worldId !== input.worldId
      || artifact.basePackage.revision !== input.baseRevision || artifact.basePackage.contentHash !== input.baseHash
      || byId.has(artifact.artifactId)) { errors.push('Invalid, duplicate or incompatible segment artifact.'); continue; }
    byId.set(artifact.artifactId, artifact);
  }
  for (const artifact of byId.values()) for (const ref of artifact.dependencies)
    if (byId.get(ref.artifactId)?.contentHash !== ref.contentHash) errors.push('Missing segment artifact dependency.');
  const checkBinding = async (binding: SegmentContentBindingV1, state: GameStateSnapshot) => {
    if (!isSegmentContentBindingV1(binding) || binding.branchId !== state.branchId || binding.stateVersion !== state.stateVersion
      || state.contentManifest?.worldId !== input.worldId || binding.manifestHash !== state.contentManifest.manifestHash
      || binding.contentVersion !== state.contentManifest.contentVersion
      || JSON.stringify(binding.deltaIds) !== JSON.stringify(state.contentManifest.deltas.map(d => d.deltaId))
      || binding.basePackageRevision !== input.baseRevision)
      { errors.push('Invalid snapshot segment binding.'); return; }
    const refs = binding.artifactIds.map(id => ({ artifactId: id, contentHash: byId.get(id)?.contentHash ?? '' }));
    if (refs.some(ref => !ref.contentHash)) { errors.push('Snapshot segment artifact is absent.'); return; }
    const included = new Set(binding.artifactIds);
    if (binding.artifactIds.some(id => byId.get(id)?.dependencies.some(ref => !included.has(ref.artifactId)))) errors.push('Snapshot artifact dependency is not adopted.');
    if (refs.length || binding.artifactManifestHash !== undefined) {
      const m = await createSegmentArtifactManifest({ worldId: input.worldId, branchId: state.branchId,
        stateVersion: state.stateVersion, legacyManifestHash: binding.manifestHash, artifacts: refs }, sha256Hex);
      if (m.artifactManifestHash !== binding.artifactManifestHash) errors.push('Snapshot segment manifest digest mismatch.');
    }
  };
  for (const state of input.snapshots) {
    if (state.segmentContentBinding) await checkBinding(state.segmentContentBinding, state);
    if (state.styleSnapshot && (state.styleSnapshot.projectId !== input.worldId
      || !await verifyEffectiveStyleSnapshotHash(state.styleSnapshot, { sha256Hex }))) errors.push('Invalid recoverable style snapshot.');
  }
  for (const saved of input.contracts) {
    let value: unknown; try { value = JSON.parse(saved.json); } catch { errors.push('Invalid frozen contract JSON.'); continue; }
    if (value && typeof value === 'object') {
      const contract = value as { turnId?: unknown; expectedStateVersion?: unknown;
        styleSnapshot?: GameStateSnapshot['styleSnapshot']; contentDependency?: SegmentContentBindingV1 };
      const dependency = contract.contentDependency;
      const hasPhase6 = contract.styleSnapshot !== undefined || dependency?.artifactIds !== undefined || dependency?.artifactManifestHash !== undefined;
      if (!hasPhase6) continue;
      try {
        if (!/^[a-f0-9]{64}$/i.test(saved.hash) || (await sha256Hex(canonicalStringify(value as CanonicalJson))).toLowerCase() !== saved.hash.toLowerCase()) errors.push('Frozen phase6 contract digest mismatch.');
      } catch { errors.push('Invalid frozen phase6 contract digest.'); }
      if (contract.turnId !== saved.turnId || contract.expectedStateVersion !== saved.expectedStateVersion) errors.push('Frozen contract turn/state binding mismatch.');
      if (contract.styleSnapshot && (contract.styleSnapshot.projectId !== input.worldId
        || contract.styleSnapshot.turnId !== saved.turnId || (dependency && contract.styleSnapshot.branchId !== dependency.branchId)
        || !await verifyEffectiveStyleSnapshotHash(contract.styleSnapshot, { sha256Hex }))) errors.push('Invalid frozen contract style snapshot.');
      if (dependency) {
        const state = input.snapshots.find(s => s.stateVersion === saved.expectedStateVersion
          && s.contentManifest?.manifestHash === dependency.manifestHash);
        if (!state || dependency.stateVersion !== saved.expectedStateVersion || dependency.basePackageRevision !== input.baseRevision
          || dependency.contentVersion !== state.contentManifest?.contentVersion
          || JSON.stringify(dependency.deltaIds) !== JSON.stringify(state.contentManifest.deltas.map(d => d.deltaId))) {
          errors.push('Frozen contract content binding has no matching historical snapshot.'); continue;
        }
        if (dependency.artifactIds !== undefined || dependency.artifactManifestHash !== undefined) {
          // Frozen contracts retain their original branch on fork/restore;
          // the digest deliberately excludes that routing coordinate.
          await checkBinding(dependency, { ...state, branchId: dependency.branchId });
          const adopted = state.segmentContentBinding;
          if (!adopted || adopted.artifactManifestHash !== dependency.artifactManifestHash
            || JSON.stringify(adopted.artifactIds) !== JSON.stringify(dependency.artifactIds)) errors.push('Frozen contract artifacts differ from its historical snapshot.');
        }
      }
    } else {
      errors.push('Invalid frozen contract JSON object.');
    }
  }
  return [...new Set(errors)];
}

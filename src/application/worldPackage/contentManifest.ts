import type {
  BranchContentManifest,
  ContentDependencyBinding,
  ProgressiveDeltaPackage,
} from '../../domain/content/types';
import { canonicalStringify, type CanonicalJson, type Sha256HexProvider } from '../../domain/turns/canonical';

export interface ContentManifestInput {
  worldId: string;
  branchId: string;
  stateVersion: number;
  contentVersion: number;
  basePackage: BranchContentManifest['basePackage'];
  deltas: BranchContentManifest['deltas'];
}

/** Runtime guard for data loaded from save/archive JSON or SQLite. */
export function isBranchContentManifestStructure(value: unknown): value is BranchContentManifest {
  if (!isRecord(value) || value.schemaVersion !== 'shineword-content-manifest-1' ||
      typeof value.worldId !== 'string' || !value.worldId.trim() ||
      typeof value.branchId !== 'string' || !value.branchId.trim() ||
      !Number.isSafeInteger(value.stateVersion) || Number(value.stateVersion) < 0 ||
      !Number.isSafeInteger(value.contentVersion) || Number(value.contentVersion) < 0 ||
      typeof value.manifestHash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.manifestHash) ||
      !isRecord(value.basePackage) || !Number.isSafeInteger(value.basePackage.revision) ||
      Number(value.basePackage.revision) < 1 || typeof value.basePackage.contentHash !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(value.basePackage.contentHash) || !Array.isArray(value.deltas) ||
      Number(value.contentVersion) !== value.deltas.length) return false;
  const ids = new Set<string>();
  return value.deltas.every(ref => {
    if (!isRecord(ref) || typeof ref.deltaId !== 'string' || !ref.deltaId.trim() || ids.has(ref.deltaId) ||
        typeof ref.originBranchId !== 'string' || !ref.originBranchId.trim() ||
        !/^[a-f0-9]{64}$/i.test(String(ref.contentHash)) ||
        !Number.isSafeInteger(ref.publishedAtStateVersion) || Number(ref.publishedAtStateVersion) < 0 ||
        Number(ref.publishedAtStateVersion) > Number(value.stateVersion)) return false;
    ids.add(ref.deltaId);
    return true;
  });
}

/** Runtime shape check before integrity validation of an imported delta. */
export function isProgressiveDeltaPackageStructure(value: unknown): value is ProgressiveDeltaPackage {
  if (!isRecord(value) || value.schemaVersion !== 'shineword-progressive-delta-1' ||
      typeof value.deltaId !== 'string' || !value.deltaId.trim() || typeof value.worldId !== 'string' ||
      !value.worldId.trim() || typeof value.originBranchId !== 'string' || !value.originBranchId.trim() ||
      !Number.isSafeInteger(value.publishedAtStateVersion) || Number(value.publishedAtStateVersion) < 0 ||
      !isRecord(value.basePackage) || !Number.isSafeInteger(value.basePackage.revision) ||
      Number(value.basePackage.revision) < 1 || typeof value.basePackage.contentHash !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(value.basePackage.contentHash) ||
      typeof value.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.sourceSha256) ||
      typeof value.mappingVersion !== 'string' || !value.mappingVersion.trim() ||
      (value.status !== 'published' && value.status !== 'needs_review') ||
      typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.contentHash) ||
      typeof value.createdAt !== 'string' || !isRecord(value.buildScope) ||
      !Array.isArray(value.entries) || value.entries.length === 0 || value.entries.length > 500 ||
      !Array.isArray(value.sections) || value.sections.length > 100 || !isRecord(value.validation) ||
      !Array.isArray(value.validation.errors) || !Array.isArray(value.validation.warnings)) return false;
  const scope = value.buildScope;
  if (scope.strategy !== 'progressive' || scope.scope !== 'incremental' || scope.completeness !== 'partial' ||
      !Array.isArray(scope.sourceRanges) || scope.sourceRanges.length === 0 || scope.sourceRanges.length > 64 ||
      !isRecord(scope.packageLineage) || scope.packageLineage.kind !== 'delta' ||
      scope.packageLineage.baseRevision !== value.basePackage.revision ||
      scope.packageLineage.branchId !== value.originBranchId ||
      scope.packageLineage.stateVersion !== value.publishedAtStateVersion) return false;
  let totalRange = 0;
  for (const range of scope.sourceRanges) {
    if (!isRecord(range) || !Number.isSafeInteger(range.startCodePoint) ||
        !Number.isSafeInteger(range.endCodePoint) || Number(range.startCodePoint) < 0 ||
        Number(range.endCodePoint) <= Number(range.startCodePoint) ||
        typeof range.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(range.contentSha256)) return false;
    totalRange += Number(range.endCodePoint) - Number(range.startCodePoint);
  }
  return totalRange <= 12_000 && value.entries.every(isRecord) && value.sections.every(isRecord);
}

/** Base-only manifests reuse the already-verified immutable package hash. */
export function createBaseContentManifest(input: Omit<ContentManifestInput, 'contentVersion' | 'deltas'>): BranchContentManifest {
  validateManifestCoordinates(input);
  if (!/^[a-f0-9]{64}$/i.test(input.basePackage.contentHash)) throw new Error('Base package content hash is invalid.');
  return {
    schemaVersion: 'shineword-content-manifest-1',
    ...input,
    contentVersion: 0,
    deltas: [],
    manifestHash: input.basePackage.contentHash.toLowerCase(),
  };
}

/** Content digest deliberately excludes branch and state coordinates. Those
 * are independently bound by the immutable projection row and contract. */
export async function createContentManifest(input: ContentManifestInput, sha256Hex: Sha256HexProvider['sha256Hex']): Promise<BranchContentManifest> {
  validateManifestCoordinates(input);
  if (!Number.isSafeInteger(input.contentVersion) || input.contentVersion < 0 || input.contentVersion > 100_000) {
    throw new Error('Content manifest version is invalid.');
  }
  if (!Array.isArray(input.deltas) || input.contentVersion !== input.deltas.length) {
    throw new Error('Content manifest version must match its append-only delta list.');
  }
  if (!/^[a-f0-9]{64}$/i.test(input.basePackage.contentHash) ||
      input.deltas.length > 512 || input.deltas.some(ref =>
        !ref.deltaId.trim() || !/^[a-f0-9]{64}$/i.test(ref.contentHash) ||
        !Number.isSafeInteger(ref.publishedAtStateVersion) || ref.publishedAtStateVersion < 0 || !ref.originBranchId.trim())) {
    throw new Error('Content manifest package references are invalid.');
  }
  const digestInput = {
    schemaVersion: 'shineword-content-manifest-1',
    basePackage: input.basePackage,
    deltas: input.deltas,
    contentVersion: input.contentVersion,
  } as unknown as CanonicalJson;
  const manifestHash = (await sha256Hex(canonicalStringify(digestInput))).toLowerCase();
  return { schemaVersion: 'shineword-content-manifest-1', ...input, manifestHash };
}

export async function verifyContentManifest(manifest: BranchContentManifest, sha256Hex: Sha256HexProvider['sha256Hex']): Promise<boolean> {
  if (!isBranchContentManifestStructure(manifest)) return false;
  if (manifest.contentVersion === 0 && manifest.deltas.length === 0) {
    return manifest.manifestHash.toLowerCase() === manifest.basePackage.contentHash.toLowerCase();
  }
  try {
    const verified = await createContentManifest(manifest, sha256Hex);
    return verified.manifestHash.toLowerCase() === manifest.manifestHash.toLowerCase();
  } catch {
    return false;
  }
}

export function contentDependencyBinding(manifest: BranchContentManifest): ContentDependencyBinding {
  return {
    manifestHash: manifest.manifestHash,
    contentVersion: manifest.contentVersion,
    branchId: manifest.branchId,
    stateVersion: manifest.stateVersion,
    basePackageRevision: manifest.basePackage.revision,
    deltaIds: manifest.deltas.map(ref => ref.deltaId),
  };
}

export async function verifyDeltaPackage(
  delta: ProgressiveDeltaPackage,
  expected: { deltaId: string; contentHash: string; baseContentHash: string },
  sha256Hex: Sha256HexProvider['sha256Hex'],
): Promise<boolean> {
  if (!isProgressiveDeltaPackageStructure(delta) || delta.status !== 'published' ||
      delta.deltaId !== expected.deltaId || delta.contentHash.toLowerCase() !== expected.contentHash.toLowerCase() ||
      delta.basePackage.contentHash.toLowerCase() !== expected.baseContentHash.toLowerCase()) return false;
  if (delta.validation.errors.length !== 0) return false;
  try {
    const { computePackageContentHash } = await import('./validate');
    return (await computePackageContentHash(delta.entries, delta.sections, sha256Hex, delta.buildScope))
      .toLowerCase() === delta.contentHash.toLowerCase();
  } catch {
    return false;
  }
}

export async function loadBranchDeltaEntries(input: {
  manifest: BranchContentManifest;
  worldId: string;
  branchId: string;
  stateVersion: number;
  baseRevision: number;
  baseContentHash: string;
  getDelta(deltaId: string): Promise<ProgressiveDeltaPackage | null>;
  sha256Hex: Sha256HexProvider['sha256Hex'];
}): Promise<ProgressiveDeltaPackage[]> {
  const manifest = input.manifest;
  if (manifest.worldId !== input.worldId || manifest.branchId !== input.branchId ||
      manifest.stateVersion !== input.stateVersion || manifest.basePackage.revision !== input.baseRevision ||
      manifest.basePackage.contentHash.toLowerCase() !== input.baseContentHash.toLowerCase() ||
      !await verifyContentManifest(manifest, input.sha256Hex)) {
    throw new Error('Branch content manifest does not match the locked package snapshot.');
  }
  const result: ProgressiveDeltaPackage[] = [];
  const ids = new Set<string>();
  for (const ref of manifest.deltas) {
    if (ids.has(ref.deltaId)) throw new Error('Branch content manifest contains a duplicate delta reference.');
    ids.add(ref.deltaId);
    const delta = await input.getDelta(ref.deltaId);
    if (!delta || delta.basePackage.revision !== manifest.basePackage.revision ||
        delta.originBranchId !== ref.originBranchId ||
        delta.publishedAtStateVersion !== ref.publishedAtStateVersion || !await verifyDeltaPackage(delta, {
          deltaId: ref.deltaId, contentHash: ref.contentHash, baseContentHash: input.baseContentHash,
        }, input.sha256Hex)) {
      throw new Error(`Published content delta ${ref.deltaId} is missing, review-only or failed hash verification.`);
    }
    result.push(delta);
  }
  return result;
}

function validateManifestCoordinates(input: Pick<ContentManifestInput, 'worldId' | 'branchId' | 'stateVersion' | 'basePackage'>): void {
  if (!input.worldId.trim() || !input.branchId.trim() || !Number.isSafeInteger(input.stateVersion) || input.stateVersion < 0 ||
      !input.basePackage || !Number.isSafeInteger(input.basePackage.revision) || input.basePackage.revision < 1) {
    throw new Error('Content manifest branch, state or base package coordinates are invalid.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

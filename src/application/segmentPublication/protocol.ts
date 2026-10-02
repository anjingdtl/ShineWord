import { isSourceRangeV1, isSourceSetBindingV1 } from '../../domain/build/validation';
import type { SourceCatalogMemberV1, SourceRangeV1, SourceSetBindingV1 } from '../../domain/build/phase6';
import { SEGMENT_ARTIFACT_LIMITS as LIMITS, SEGMENT_ARTIFACT_VERSION, SEGMENT_VALIDATION_VERSION,
  type SegmentArtifactManifestV1, type SegmentArtifactV1, type SegmentCitationV1,
  type SegmentContentBindingV1 } from '../../domain/content/segmentArtifact';
import { validateDefinition, type ContentEntry, type Provenance, type WorldPackageBuildScope } from '../../domain/content/types';
import { canonicalStringify, type CanonicalJson, type Sha256HexProvider } from '../../domain/turns/canonical';
import type { SourceCatalogPortV1 } from '../ports/phase6';
import type { StoredFact } from '../ports/worldStore';

const HASH = /^[a-f0-9]{64}$/i;
const TOKEN = /^[a-zA-Z0-9._:-]{1,256}$/;
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === 'string' && HASH.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && TOKEN.test(v);
const natural = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
function provenance(v: unknown): v is Provenance {
  return isRecord(v) && ['explicit','inferred','rule_mapping','design_fill','user_override'].includes(String(v.kind))
    && strings(v.sourceFactIds) && v.sourceFactIds.length <= 500 && v.sourceFactIds.every(id)
    && typeof v.rationale === 'string' && v.rationale.trim().length > 0 && v.rationale.length <= 12_000
    && (v.policyId === undefined || id(v.policyId)) && (v.sourceRanges === undefined ||
      (Array.isArray(v.sourceRanges) && v.sourceRanges.length <= LIMITS.ranges && v.sourceRanges.every(r =>
        isRecord(r) && id(r.chapterId) && natural(r.startCodePoint) && natural(r.endCodePoint)
        && Number(r.endCodePoint) > Number(r.startCodePoint) && hash(r.contentSha256))));
}
function entry(v: unknown): v is ContentEntry {
  return isRecord(v) && id(v.entryId) && natural(v.revision) && Number(v.revision) > 0
    && ['skill','ability','item','condition','actor_template','origin','path','scene','quest','lore','constraint'].includes(String(v.kind))
    && provenance(v.provenance) && isRecord(v.fieldProvenance) && Object.keys(v.fieldProvenance).length <= 100
    && Object.values(v.fieldProvenance).every(provenance) && ['public','gm','discoverable'].includes(String(v.visibility))
    && (v.revealPolicyId === undefined || id(v.revealPolicyId)) && strings(v.dependencyIds)
    && v.dependencyIds.length <= 500 && v.dependencyIds.every(id) && new Set(v.dependencyIds).size === v.dependencyIds.length
    && isRecord(v.definition) && validateDefinition(v.kind as ContentEntry['kind'], v.definition).length === 0;
}
export function assertArtifactNoSecrets(v: unknown, depth = 0): void {
  if (depth > 48) throw new Error('artifact_json_depth');
  if (Array.isArray(v)) { for (const item of v) assertArtifactNoSecrets(item, depth + 1); return; }
  if (!isRecord(v)) return;
  for (const [key, value] of Object.entries(v)) {
    if (['apikey','api_key','key','secret','token','authorization'].includes(key.toLowerCase())
      && typeof value === 'string' && value.trim()) throw new Error('artifact_forbidden_key');
    assertArtifactNoSecrets(value, depth + 1);
  }
}
export function isSegmentArtifactV1(v: unknown): v is SegmentArtifactV1 {
  if (!isRecord(v) || v.schemaVersion !== SEGMENT_ARTIFACT_VERSION || v.validationVersion !== SEGMENT_VALIDATION_VERSION
    || !id(v.artifactId) || !id(v.worldId) || !id(v.segmentId) || !natural(v.generation) || Number(v.generation) < 1
    || !isSourceSetBindingV1(v.sourceBinding) || v.sourceBinding.members.length > LIMITS.ranges
    || !hash(v.canonSnapshotHash) || !hash(v.contentHash) || !isRecord(v.basePackage)
    || !natural(v.basePackage.revision) || Number(v.basePackage.revision) < 1 || !hash(v.basePackage.contentHash)
    || !isRecord(v.ruleset) || !id(v.ruleset.id) || !id(v.ruleset.version) || !id(v.mappingVersion)
    || !Array.isArray(v.coverage) || !v.coverage.length || v.coverage.length > LIMITS.ranges
    || !v.coverage.every(isSourceRangeV1) || v.coverage.reduce((n,r) => n + r.endCp - r.startCp,0) > LIMITS.codePoints
    || !Array.isArray(v.entries) || !v.entries.length || v.entries.length > LIMITS.entries || !v.entries.every(entry)
    || !Array.isArray(v.sections) || v.sections.length > LIMITS.sections || !v.sections.every(s => isRecord(s)
      && ['player_handbook','gm_guide','monster_manual'].includes(String(s.book)) && id(s.sectionKey)
      && typeof s.title === 'string' && s.title.trim().length > 0 && s.title.length <= 1000
      && natural(s.position) && strings(s.entryIds) && s.entryIds.length <= LIMITS.entries && s.entryIds.every(id))
    || !Array.isArray(v.dependencies) || v.dependencies.length > LIMITS.dependencies
    || !v.dependencies.every(r => isRecord(r) && id(r.artifactId) && hash(r.contentHash))
    || !Array.isArray(v.citations) || v.citations.length > LIMITS.citations
    || !v.citations.every(c => isRecord(c) && id(c.entryId) && typeof c.field === 'string'
      && (c.field === 'provenance' || /^fieldProvenance\.[\w.:-]{1,128}$/.test(c.field))
      && strings(c.sourceFactIds) && c.sourceFactIds.length <= LIMITS.entries && c.sourceFactIds.every(id)
      && Array.isArray(c.ranges) && c.ranges.length <= LIMITS.ranges && c.ranges.every(isSourceRangeV1))
    || !isRecord(v.validation) || !strings(v.validation.warnings) || v.validation.warnings.length > 1000
    || typeof v.createdAt !== 'string' || !Number.isFinite(Date.parse(v.createdAt))) return false;
  const a = v as unknown as SegmentArtifactV1;
  if (new Set(a.entries.map(e => e.entryId)).size !== a.entries.length
    || new Set(a.dependencies.map(r => r.artifactId)).size !== a.dependencies.length
    || new Set(a.citations.map(c => `${c.entryId}:${c.field}`)).size !== a.citations.length) return false;
  const members = a.sourceBinding.members;
  if (!a.coverage.every(r => members.some(m => m.sourceId === r.sourceId && m.normalizedTreeHash === r.normalizedTreeHash))) return false;
  const expectedCount = a.entries.reduce((n,e) => n + 1 + Object.keys(e.fieldProvenance).length, 0);
  if (a.citations.length !== expectedCount) return false;
  for (const e of a.entries) for (const [field,p] of [['provenance',e.provenance],
    ...Object.entries(e.fieldProvenance).map(([k,p]) => [`fieldProvenance.${k}`,p] as const)] as const) {
    const c = a.citations.find(c => c.entryId === e.entryId && c.field === field);
    if (!c || p.kind === 'user_override' || c.sourceFactIds.length !== p.sourceFactIds.length
      || !p.sourceFactIds.every(f => c.sourceFactIds.includes(f))
      || (['explicit','inferred'].includes(p.kind) && c.ranges.length === 0)
      || !c.ranges.every(r => rangeCovered(r,a.coverage))) return false;
  }
  try { assertArtifactNoSecrets(a); return JSON.stringify(a).length <= LIMITS.jsonBytes; } catch { return false; }
}
export async function computeSegmentArtifactHash(a: Omit<SegmentArtifactV1, 'artifactId' | 'contentHash' | 'createdAt'>,
  sha256Hex: Sha256HexProvider['sha256Hex']): Promise<string> {
  const sorted = { ...a, coverage: [...a.coverage].sort(compareRange),
    dependencies: [...a.dependencies].sort((x,y) => x.artifactId.localeCompare(y.artifactId)),
    entries: [...a.entries].sort((x,y) => x.entryId.localeCompare(y.entryId)),
    sections: [...a.sections].sort((x,y) => `${x.book}:${x.sectionKey}`.localeCompare(`${y.book}:${y.sectionKey}`)),
    citations: [...a.citations].map(c => ({...c, sourceFactIds: [...c.sourceFactIds].sort(), ranges: [...c.ranges].sort(compareRange)}))
      .sort((x,y) => `${x.entryId}:${x.field}`.localeCompare(`${y.entryId}:${y.field}`)) };
  return (await sha256Hex(canonicalStringify(sorted as unknown as CanonicalJson))).toLowerCase();
}
export async function verifySegmentArtifact(a: unknown, sha256Hex: Sha256HexProvider['sha256Hex']): Promise<boolean> {
  if (!isSegmentArtifactV1(a)) return false;
  const { artifactId, contentHash, createdAt, ...payload } = a;
  const actual = await computeSegmentArtifactHash(payload, sha256Hex);
  return contentHash === actual && artifactId === `segment-artifact-${actual}`;
}
export function serializeSegmentArtifact(a: SegmentArtifactV1): string {
  if (!isSegmentArtifactV1(a)) throw new Error('invalid_artifact');
  return canonicalStringify(a as unknown as CanonicalJson);
}
export async function parseSegmentArtifact(json: string, sha256Hex: Sha256HexProvider['sha256Hex']): Promise<SegmentArtifactV1> {
  if (json.length > LIMITS.jsonBytes) throw new Error('artifact_size_limit');
  const value: unknown = JSON.parse(json);
  if (!await verifySegmentArtifact(value, sha256Hex)) throw new Error('invalid_artifact');
  return value as SegmentArtifactV1;
}
export function isSegmentContentBindingV1(v: unknown): v is SegmentContentBindingV1 {
  return isRecord(v) && hash(v.manifestHash) && natural(v.contentVersion) && id(v.branchId) && natural(v.stateVersion)
    && natural(v.basePackageRevision) && Number(v.basePackageRevision) > 0 && strings(v.deltaIds) && v.deltaIds.every(id)
    && strings(v.artifactIds) && v.artifactIds.length <= 512 && v.artifactIds.every(id)
    && new Set(v.artifactIds).size === v.artifactIds.length
    && (v.artifactIds.length === 0 ? v.artifactManifestHash === undefined || hash(v.artifactManifestHash) : hash(v.artifactManifestHash));
}
export function rebindSegmentContentBinding(binding: SegmentContentBindingV1, branchId: string, stateVersion: number): SegmentContentBindingV1 {
  if (!isSegmentContentBindingV1(binding) || !id(branchId) || !natural(stateVersion)) throw new Error('invalid_artifact_binding');
  return { ...binding, branchId, stateVersion, deltaIds: [...binding.deltaIds], artifactIds: [...binding.artifactIds] };
}
export function isSegmentArtifactManifestV1(v: unknown): v is SegmentArtifactManifestV1 {
  return isRecord(v) && v.schemaVersion === 'shineword-artifact-manifest-1' && id(v.worldId) && id(v.branchId)
    && natural(v.stateVersion) && hash(v.legacyManifestHash) && hash(v.artifactManifestHash) && Array.isArray(v.artifacts)
    && v.artifacts.length <= 512 && v.artifacts.every(r => isRecord(r) && id(r.artifactId) && hash(r.contentHash))
    && new Set(v.artifacts.map(r => r.artifactId)).size === v.artifacts.length;
}
export async function createSegmentArtifactManifest(input: Omit<SegmentArtifactManifestV1,'schemaVersion'|'artifactManifestHash'>,
  sha256Hex: Sha256HexProvider['sha256Hex']): Promise<SegmentArtifactManifestV1> {
  const artifactManifestHash = (await sha256Hex(canonicalStringify({ schemaVersion:'shineword-artifact-manifest-1',
    worldId:input.worldId,legacyManifestHash:input.legacyManifestHash,artifacts:input.artifacts } as unknown as CanonicalJson))).toLowerCase();
  const manifest: SegmentArtifactManifestV1 = {schemaVersion:'shineword-artifact-manifest-1',...input,artifactManifestHash};
  if (!isSegmentArtifactManifestV1(manifest)) throw new Error('invalid_artifact_manifest');
  return manifest;
}
export async function verifySegmentArtifactManifest(v: unknown, sha256Hex: Sha256HexProvider['sha256Hex']): Promise<boolean> {
  if (!isSegmentArtifactManifestV1(v)) return false;
  return (await createSegmentArtifactManifest(v,sha256Hex)).artifactManifestHash === v.artifactManifestHash;
}
function compareRange(a: SourceRangeV1,b: SourceRangeV1): number { return a.sourceId.localeCompare(b.sourceId) || a.startCp-b.startCp || a.endCp-b.endCp; }
export function rangeCovered(range: SourceRangeV1, coverage: readonly SourceRangeV1[]): boolean {
  // Exact evidence hash is checked by source reads, then contiguous coverage
  // may span multiple units. Gaps and source substitutions never count.
  let end = range.startCp;
  for (const candidate of coverage.filter(r => r.sourceId === range.sourceId && r.normalizedTreeHash === range.normalizedTreeHash)
    .sort((a,b) => a.startCp-b.startCp)) {
    if (candidate.startCp > end) break;
    if (candidate.endCp > end) end = candidate.endCp;
    if (end >= range.endCp) return true;
  }
  return false;
}
/** Resolve old citations only through the persisted world/source mirror IDs.
 * Coordinates in source_chapters have always remained source-local. */
export async function resolveLegacyEvidenceRange(catalog: SourceCatalogPortV1,
  members: readonly SourceCatalogMemberV1[], legacy: {chapterId:string;startCodePoint:number;endCodePoint:number;contentSha256:string}): Promise<SourceRangeV1> {
  const matches = members.filter(m => m.chapters.some(c => c.chapterId === legacy.chapterId
    && c.startCp <= legacy.startCodePoint && c.endCp >= legacy.endCodePoint));
  if (matches.length !== 1) throw new Error('legacy_source_ambiguous');
  const range = await catalog.createRange(matches[0]!.sourceId,legacy.startCodePoint,legacy.endCodePoint);
  if (range.normalizedTreeHash !== matches[0]!.normalizedTreeHash || range.rangeContentHash !== legacy.contentSha256.toLowerCase())
    throw new Error('legacy_source_evidence_changed');
  return range;
}
export async function resolveLegacyPackageRanges(catalog: SourceCatalogPortV1, worldId:string, sourceSha256:string,
  ranges:WorldPackageBuildScope['sourceRanges']):Promise<SourceRangeV1[]> {
  const snapshot = await catalog.snapshot(worldId);
  const matches = snapshot.members.filter(m => m.rawSha256Hex.toLowerCase() === sourceSha256.toLowerCase());
  if (matches.length !== 1) throw new Error('legacy_source_ambiguous');
  const result:SourceRangeV1[]=[];
  for(const legacy of ranges) {
    const range=await catalog.createRange(matches[0]!.sourceId,legacy.startCodePoint,legacy.endCodePoint);
    if(range.rangeContentHash!==legacy.contentSha256.toLowerCase()) throw new Error('legacy_source_evidence_changed');
    result.push(range);
  }
  return result;
}
export async function buildSegmentCitations(input:{worldId:string;entries:readonly ContentEntry[];facts:readonly StoredFact[];
  catalog:SourceCatalogPortV1;sourceBinding:SourceSetBindingV1}):Promise<SegmentCitationV1[]> {
  const snapshot=await input.catalog.snapshot(input.worldId);
  if(!await input.catalog.isBindingCompatible(input.worldId,input.sourceBinding)) throw new Error('source_changed');
  const byFact=new Map(input.facts.map(f=>[f.factId,f])); const result:SegmentCitationV1[]=[];
  for(const e of input.entries) for(const [field,p] of [['provenance',e.provenance],
    ...Object.entries(e.fieldProvenance).map(([key,p])=>[`fieldProvenance.${key}`,p] as const)] as const) {
    const ranges:SourceRangeV1[]=[];
    for(const factId of p.sourceFactIds) {
      const fact=byFact.get(factId);
      if(!fact || fact.worldId!==input.worldId || !['explicit','inference','user_supplement'].includes(fact.status)) throw new Error('invalid_fact_evidence');
      for(const s of fact.sources) ranges.push(await resolveLegacyEvidenceRange(input.catalog,snapshot.members,
        {chapterId:s.chapterId,startCodePoint:s.startOffset,endCodePoint:s.endOffset,contentSha256:s.quoteSha256}));
    }
    for(const r of p.sourceRanges??[]) ranges.push(await resolveLegacyEvidenceRange(input.catalog,snapshot.members,r));
    const unique=new Map(ranges.map(r=>[`${r.sourceId}:${r.startCp}:${r.endCp}:${r.rangeContentHash}`,r]));
    result.push({entryId:e.entryId,field:field as SegmentCitationV1['field'],sourceFactIds:[...p.sourceFactIds],ranges:[...unique.values()]});
  }
  return result;
}
/** Splits old ranges without guessing subrange hashes. Only single-source
 * deltas may consume the returned units; their originBranchId stays fixed. */
export async function splitLegacyPublicationRanges(catalog:SourceCatalogPortV1,ranges:readonly SourceRangeV1[]):Promise<SourceRangeV1[][]> {
  if(new Set(ranges.map(r=>r.sourceId)).size!==1) throw new Error('legacy_single_source_required');
  const units:SourceRangeV1[][]=[];let current:SourceRangeV1[]=[];let length=0;
  for(const range of ranges) {
    if(!isSourceRangeV1(range))throw new Error('invalid_source_range');
    for(let start=range.startCp;start<range.endCp;) {
      if(length===LIMITS.codePoints||current.length===LIMITS.ranges){units.push(current);current=[];length=0;}
      const end=Math.min(range.endCp,start+LIMITS.codePoints-length);
      current.push(await catalog.createRange(range.sourceId,start,end));length+=end-start;start=end;
    }
  }
  if(current.length)units.push(current);return units;
}

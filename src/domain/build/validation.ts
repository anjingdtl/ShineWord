import type { BuildIntentV1, SourceRangeV1, SourceSetBindingV1 } from './phase6';
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/i.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 256;
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export function isSourceRangeV1(v: unknown): v is SourceRangeV1 {
  return record(v) && id(v.sourceId) && hash(v.normalizedTreeHash) && hash(v.rangeContentHash)
    && Number.isSafeInteger(v.startCp) && Number(v.startCp) >= 0
    && Number.isSafeInteger(v.endCp) && Number(v.endCp) > Number(v.startCp);
}
export function isSourceSetBindingV1(v: unknown): v is SourceSetBindingV1 {
  if (!record(v) || !hash(v.sourceSetHash) || !Array.isArray(v.members) || !v.members.length) return false;
  const ids = new Set<string>(); const ordinals = new Set<number>();
  return v.members.every(m => {
    if (!record(m) || !id(m.sourceId) || ids.has(m.sourceId) || !hash(m.normalizedTreeHash)
      || !Number.isSafeInteger(m.sourceOrdinal) || Number(m.sourceOrdinal) < 1 || ordinals.has(Number(m.sourceOrdinal))) return false;
    ids.add(m.sourceId); ordinals.add(Number(m.sourceOrdinal)); return true;
  });
}
export function isBuildIntentV1(v: unknown): v is BuildIntentV1 {
  if (!record(v) || !id(v.intentId) || !id(v.worldId) || !id(v.segmentId) || v.planVersion !== 'segment-plan-1'
    || !Number.isSafeInteger(v.generation) || Number(v.generation) < 1 || !isSourceSetBindingV1(v.sourceBinding)
    || !hash(v.executionConfigFingerprint) || !['P0','P1','P2','P3'].includes(String(v.priority))
    || !['bootstrap','action_dependency','near_domain','buffer','user_full'].includes(String(v.reason))
    || !Array.isArray(v.ranges) || !v.ranges.length || v.ranges.length > 64 || !Array.isArray(v.demandRefs)) return false;
  const binding = v.sourceBinding;
  return v.ranges.every(r => isSourceRangeV1(r) && binding.members.some(m => m.sourceId === r.sourceId
    && m.normalizedTreeHash === r.normalizedTreeHash)) && v.demandRefs.every(d => record(d)
    && id(d.campaignId) && id(d.branchId) && Number.isSafeInteger(d.stateVersion) && Number(d.stateVersion) >= 0
    && (d.userCommandId === undefined || id(d.userCommandId)));
}
/** Append-only source membership is compatible; removal/replacement/renumbering is not. */
export function isSourceBindingCompatible(previous: SourceSetBindingV1, current: SourceSetBindingV1): boolean {
  return isSourceSetBindingV1(previous) && isSourceSetBindingV1(current)
    && previous.members.every(old => current.members.some(now => old.sourceId === now.sourceId
      && old.sourceOrdinal === now.sourceOrdinal && old.normalizedTreeHash === now.normalizedTreeHash));
}
export function assertSourceRange(range: SourceRangeV1, source: { sourceId: string; normalizedTreeHash: string; codePointCount: number }): void {
  if (!isSourceRangeV1(range) || range.sourceId !== source.sourceId || range.normalizedTreeHash !== source.normalizedTreeHash
    || range.endCp > source.codePointCount) throw new Error('invalid_source_range');
}

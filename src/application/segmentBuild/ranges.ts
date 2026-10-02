import type { SourceRangeV1, SourceSetBindingV1 } from '../../domain/build/phase6';
import type { SourceCatalogPortV1 } from '../ports/phase6';
import { assertSourceRange } from '../../domain/build/validation';

const sameSource = (a: SourceRangeV1, b: SourceRangeV1): boolean => a.sourceId === b.sourceId && a.normalizedTreeHash === b.normalizedTreeHash;
export function rangesCover(required: readonly SourceRangeV1[], coverage: readonly SourceRangeV1[]): boolean {
  return required.every(range => {
    let cursor = range.startCp;
    for (const span of coverage.filter(v => sameSource(range, v)).sort((a,b) => a.startCp-b.startCp)) {
      if (span.endCp <= cursor) continue;
      if (span.startCp > cursor) return false;
      cursor = span.endCp;
      if (cursor >= range.endCp) return true;
    }
    return false;
  });
}
/** Only referenced members affect a piece of original-source work. Appending a volume is harmless. */
export function referencedMembersCompatible(ranges: readonly SourceRangeV1[], previous: SourceSetBindingV1, current: SourceSetBindingV1): boolean {
  return ranges.every(range => {
    const old = previous.members.find(v => v.sourceId === range.sourceId);
    return old !== undefined && old.normalizedTreeHash === range.normalizedTreeHash && current.members.some(v =>
      v.sourceId === old.sourceId && v.normalizedTreeHash === old.normalizedTreeHash && v.sourceOrdinal === old.sourceOrdinal);
  });
}
/** Coordinates and content hashes are checked before planning, then overlapping/adjacent intervals are re-hashed by M1. */
export async function normalizePlanningRanges(catalog: SourceCatalogPortV1, worldId: string, ranges: readonly SourceRangeV1[]): Promise<SourceRangeV1[]> {
  if (!ranges.length || ranges.length > 64) throw new Error('invalid_segment_ranges');
  const snapshot = await catalog.snapshot(worldId);
  const sorted = [...ranges].sort((a,b) => (a.sourceId<b.sourceId ? -1 : a.sourceId>b.sourceId ? 1 : 0) || a.startCp-b.startCp || a.endCp-b.endCp);
  const result: SourceRangeV1[] = [];
  for (const range of sorted) {
    const member = snapshot.members.find(v => v.sourceId === range.sourceId);
    if (!member) throw new Error('source_not_active');
    assertSourceRange(range, member);
    const verified = await catalog.createRange(range.sourceId, range.startCp, range.endCp);
    if (verified.rangeContentHash !== range.rangeContentHash) throw new Error('range_content_changed');
    const last = result[result.length-1];
    if (last && sameSource(last, range) && range.startCp <= last.endCp) {
      result[result.length-1] = await catalog.createRange(last.sourceId, last.startCp, Math.max(last.endCp, range.endCp));
    } else result.push(verified);
  }
  return result;
}

export async function subtractPlanningCoverage(catalog: SourceCatalogPortV1, ranges: readonly SourceRangeV1[], coverage: readonly SourceRangeV1[]): Promise<SourceRangeV1[]> {
  const result: SourceRangeV1[] = [];
  for (const range of ranges) {
    let cursor = range.startCp;
    for (const span of coverage.filter(v => sameSource(range,v)).sort((a,b) => a.startCp-b.startCp)) {
      if (span.endCp <= cursor || span.startCp >= range.endCp) continue;
      if (span.startCp > cursor) result.push(await catalog.createRange(range.sourceId,cursor,Math.min(span.startCp,range.endCp)));
      cursor = Math.max(cursor,span.endCp);
      if (cursor >= range.endCp) break;
    }
    if (cursor < range.endCp) result.push(await catalog.createRange(range.sourceId,cursor,range.endCp));
  }
  return result;
}

export function planningRangesOverlap(a: readonly SourceRangeV1[], b: readonly SourceRangeV1[]): boolean {
  return a.some(x => b.some(y => sameSource(x,y) && x.startCp < y.endCp && y.startCp < x.endCp));
}

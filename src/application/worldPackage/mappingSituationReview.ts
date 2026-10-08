import type { StoredFact } from '../ports/worldStore';
import { canonicalStringify, type CanonicalJson } from '../../domain/turns/canonical';

export const MAPPING_SITUATION_REVIEW_KIND = 'mapping_situation';
export function mappedSituationId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = (raw as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? `situation-${id.trim().toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-')}` : null;
}
export function createMappingSituationReview(raw: unknown, worldId: string, sourceSha256: string, facts: readonly StoredFact[]) {
  if (!mappedSituationId(raw)) throw new Error('invalid_situation_proposal');
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'evidenceFactIds' && Array.isArray(item)) {
        for (const id of item) if (typeof id === 'string') ids.add(id);
      }
      visit(item);
    }
  };
  visit(raw);
  const byId = new Map(facts.filter(f => f.worldId === worldId).map(f => [f.factId, f]));
  return { kind: MAPPING_SITUATION_REVIEW_KIND, version: 1, worldId, sourceSha256,
    proposal: JSON.parse(JSON.stringify(raw)) as Record<string, CanonicalJson>,
    evidence: [...ids].sort().map(factId => {
      const fact = byId.get(factId);
      return { factId, fact: fact ? { ...fact, sources: [...fact.sources].sort((a, b) =>
        canonicalStringify(a as unknown as CanonicalJson).localeCompare(canonicalStringify(b as unknown as CanonicalJson))) } : null };
    }) };
}
export type MappingSituationReview = ReturnType<typeof createMappingSituationReview>;

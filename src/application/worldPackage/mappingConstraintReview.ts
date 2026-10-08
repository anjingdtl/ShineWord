import type { StoredFact } from '../ports/worldStore';
import { canonicalStringify, type CanonicalJson } from '../../domain/turns/canonical';

export const MAPPING_CONSTRAINT_REVIEW_KIND = 'mapping_constraint';

/** The decision excludes this exact proposal; it never changes source facts or adds a rule. */
export interface MappingConstraintReview {
  kind: typeof MAPPING_CONSTRAINT_REVIEW_KIND;
  version: 1;
  worldId: string;
  sourceSha256: string;
  summary: string;
  proposal: Record<string, CanonicalJson>;
  evidence: Array<{ factId: string; fact: StoredFact | null }>;
}

export function createUnsupportedConstraintReview(
  raw: unknown, worldId: string, sourceSha256: string, facts: readonly StoredFact[],
): MappingConstraintReview | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.enforcement !== 'block_action' && record.enforcement !== 'block_effect') return null;
  if (typeof record.id !== 'string' || !record.id.trim() || typeof record.name !== 'string' || !record.name.trim()) return null;
  const ids = Array.isArray(record.evidenceFactIds)
    ? [...new Set(record.evidenceFactIds.filter((id): id is string => typeof id === 'string'))].sort() : [];
  const byId = new Map(facts.filter(f => f.worldId === worldId).map(f => [f.factId, f]));
  return {
    kind: MAPPING_CONSTRAINT_REVIEW_KIND, version: 1, worldId, sourceSha256,
    summary: '这条提案要求自动禁止行动或效果，但缺少可执行的规则条件。请核对证据后拒绝该提案；原著事实会保留。',
    proposal: JSON.parse(JSON.stringify(record)) as Record<string, CanonicalJson>,
    evidence: ids.map(factId => {
      const fact = byId.get(factId);
      return { factId, fact: fact ? { ...fact, sources: [...fact.sources]
        .sort((a, b) => canonicalStringify(a as unknown as CanonicalJson).localeCompare(canonicalStringify(b as unknown as CanonicalJson))) } : null };
    }),
  };
}

export function readMappingConstraintReview(detailJson: string): MappingConstraintReview | null {
  try {
    const detail = JSON.parse(detailJson) as MappingConstraintReview;
    if (detail.kind !== MAPPING_CONSTRAINT_REVIEW_KIND || detail.version !== 1
      || typeof detail.worldId !== 'string' || typeof detail.sourceSha256 !== 'string'
      || !detail.proposal || !Array.isArray(detail.evidence)
      || !['block_action', 'block_effect'].includes(String(detail.proposal.enforcement))) return null;
    return detail;
  } catch { return null; }
}

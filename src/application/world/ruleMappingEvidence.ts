import type { StoredFact } from '../ports/worldStore';

/** Extraction proposals use quotes; durable mappings use fact identities.
 * Resolve against the accepted, deduplicated facts in the owning world. A
 * repeated quote retains every matching fact, so no visibility gate is lost. */
export function resolveRuleMappingEvidenceRefs(refs: readonly string[], facts: readonly StoredFact[],
  format: 'quotes' | 'ids_or_legacy_quotes' = 'ids_or_legacy_quotes'): string[] | null {
  if (!refs.length) return null;
  const byId = new Map(facts.map(fact => [fact.factId, fact]));
  const resolved = new Set<string>();
  for (const ref of refs) {
    if (format !== 'quotes' && byId.has(ref)) { resolved.add(ref); continue; }
    const matches = facts.filter(fact => fact.sources.some(source => source.quote === ref));
    if (!matches.length) return null;
    for (const fact of matches) resolved.add(fact.factId);
  }
  return [...resolved].sort();
}

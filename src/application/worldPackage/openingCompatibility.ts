import type { WorldPackageManifest } from '../../domain/content/types';
import type { StoredFact } from '../ports/worldStore';

/**
 * The first progressive-opening build stored its four dossier facts with
 * revealAt='1'. On an anchorless world, the runtime uses time 0 and hid the
 * opening scene. Project only those exact facts as visible for reads and
 * creation; never rewrite the immutable fact or package rows.
 */
export function projectLegacyAnchorlessOpeningFacts(
  worldId: string,
  manifest: WorldPackageManifest | null,
  facts: readonly StoredFact[],
  anchorlessWorld: boolean,
): StoredFact[] {
  const scope = manifest?.buildScope;
  if (!anchorlessWorld || manifest?.status !== 'published' || !scope
    || scope.strategy !== 'progressive' || scope.scope !== 'opening'
    || scope.completeness !== 'partial' || scope.sourceRanges.length === 0) {
    return [...facts];
  }

  const predicates = new Set([
    'opening_location',
    'opening_setting',
    'opening_situation',
    'opening_goal',
  ]);
  const ranges = scope.sourceRanges;

  return facts.map(fact => {
    // Portable imports retain fact/entity identities so package references
    // stay immutable. Recognize the same exact legacy pair after world-id
    // rebinding, without projecting other facts with a future reveal time.
    const sourceWorldId = /^ent-(.+)-opening-location$/.exec(fact.subjectEntityId)?.[1];
    const expectedId = sourceWorldId ? `fact-${sourceWorldId}-${fact.predicate.replace('_', '-')}` : null;
    if (fact.worldId !== worldId || fact.factId !== expectedId || !predicates.has(fact.predicate)
      || fact.scope !== 'opening' || fact.status === 'speculation' || fact.status === 'conflict'
      || fact.validFrom !== null || fact.validTo !== null || fact.revealAt !== '1') {
      return fact;
    }
    const evidencedInsidePublishedScope = fact.sources.some(source =>
      ranges.some(range => source.startOffset >= range.startCodePoint
        && source.endOffset <= range.endCodePoint
        && source.endOffset > source.startOffset));
    return evidencedInsidePublishedScope ? { ...fact, revealAt: null } : fact;
  });
}

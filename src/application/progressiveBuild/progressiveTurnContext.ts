import type { ContentEntry } from '../../domain/content/types';
import type { SourceStore } from '../ports/sourceStore';
import type { StoredFact } from '../ports/worldStore';
import { isFactVisibleAtAnchor } from '../world/opening';
import { LocalSourceSearchService, type LocalSourceLookupResult, type LocalSourceRange } from '../search/localSourceSearch';
import { ProgressiveBuildQueue } from './progressiveBuildQueue';

export interface ProgressiveTurnLookupInput {
  campaignId: string;
  branchId: string;
  worldId: string;
  sourceSha256: string;
  stateVersion: number;
  query: string;
  /** Evidence cited by already player-visible package entries only. */
  sourceRanges: readonly LocalSourceRange[];
  isCurrent: () => boolean | Promise<boolean>;
}

/** Coordinates safe source lookup and lower-priority local prefetch work. */
export class ProgressiveTurnContextService {
  constructor(
    private readonly sources: Pick<SourceStore, 'findActiveByRawHash'>,
    private readonly search: LocalSourceSearchService,
    private readonly queue: ProgressiveBuildQueue,
  ) {}

  setForegroundBusy(busy: boolean): void {
    this.queue.setForegroundBusy(busy);
  }

  async currentAction(input: ProgressiveTurnLookupInput): Promise<LocalSourceLookupResult | null> {
    return this.enqueueLookup(input, 'current_action', 3);
  }

  async nearDomainPrefetch(input: ProgressiveTurnLookupInput): Promise<void> {
    await this.enqueueLookup(input, 'near_domain', 2);
  }

  async activeBookLookup(input: ProgressiveTurnLookupInput): Promise<LocalSourceLookupResult | null> {
    return this.enqueueLookup(input, 'active_book_lookup', 3);
  }

  private async enqueueLookup(
    input: ProgressiveTurnLookupInput,
    priority: 'current_action' | 'near_domain' | 'active_book_lookup',
    topK: number,
  ): Promise<LocalSourceLookupResult | null> {
    if (input.sourceRanges.length === 0 || !input.query.trim()) return null;
    const dedupeKey = JSON.stringify([
      priority,
      input.worldId,
      input.sourceSha256,
      input.stateVersion,
      input.query.trim(),
      [...input.sourceRanges]
        .map(range => [range.chapterId, range.startCodePoint, range.endCodePoint])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1])),
    ]);
    return this.queue.enqueue({
      campaignId: input.campaignId,
      branchId: input.branchId,
      stateVersion: input.stateVersion,
      priority,
      dedupeKey,
      // Search indexes have their own source/alias/scope fingerprints. Do not
      // let a generic queue result cache bypass those invalidation checks.
      cacheResult: false,
      isCurrent: input.isCurrent,
      run: async ({ signal }) => {
        const source = await this.sources.findActiveByRawHash(input.sourceSha256);
        if (signal.aborted) {
          const error = new Error('Progressive source lookup was canceled.');
          error.name = 'AbortError';
          throw error;
        }
        if (!source || source.status !== 'active') return null;
        return this.search.search({
          sourceId: source.sourceId,
          worldId: input.worldId,
          query: input.query,
          topK,
          sourceRanges: input.sourceRanges,
          signal,
        });
      },
    });
  }
}

/**
 * Build search scope exclusively from citations already referenced by
 * player-visible package entries. It does not scan the novel for a new fact;
 * unseen chapters and unreferenced future evidence stay outside Planner input.
 */
export function visibleEvidenceRanges(
  entries: readonly ContentEntry[],
  facts: readonly StoredFact[],
  worldTimeOrder: number,
): LocalSourceRange[] {
  const referencedFactIds = new Set<string>();
  const directEvidenceRanges: LocalSourceRange[] = [];
  const addFactIds = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const ids = (value as { sourceFactIds?: unknown }).sourceFactIds;
    if (Array.isArray(ids)) {
      for (const id of ids) if (typeof id === 'string' && id.length > 0) referencedFactIds.add(id);
    }
    const ranges = (value as { sourceRanges?: unknown }).sourceRanges;
    if (Array.isArray(ranges)) {
      for (const range of ranges) {
        if (!range || typeof range !== 'object') continue;
        const evidence = range as { chapterId?: unknown; startCodePoint?: unknown; endCodePoint?: unknown };
        if (typeof evidence.chapterId === 'string' && typeof evidence.startCodePoint === 'number'
            && typeof evidence.endCodePoint === 'number' && Number.isSafeInteger(evidence.startCodePoint)
            && Number.isSafeInteger(evidence.endCodePoint) && evidence.startCodePoint >= 0
            && evidence.endCodePoint > evidence.startCodePoint) {
          directEvidenceRanges.push({ chapterId: evidence.chapterId,
            startCodePoint: evidence.startCodePoint as number, endCodePoint: evidence.endCodePoint as number });
        }
      }
    }
  };
  for (const entry of entries) {
    if (entry.visibility === 'gm') continue;
    addFactIds(entry.provenance);
    for (const provenance of Object.values(entry.fieldProvenance ?? {})) addFactIds(provenance);
  }
  const unique = new Map<string, LocalSourceRange>();
  for (const range of directEvidenceRanges) {
    unique.set(`${range.chapterId}:${range.startCodePoint}:${range.endCodePoint}`, range);
  }
  for (const fact of facts) {
    if (!referencedFactIds.has(fact.factId) || fact.status === 'speculation' || fact.status === 'conflict'
      || !isFactVisibleAtAnchor(fact, worldTimeOrder)) continue;
    for (const evidence of fact.sources) {
      if (!evidence.chapterId || evidence.endOffset <= evidence.startOffset) continue;
      const range = {
        chapterId: evidence.chapterId,
        startCodePoint: evidence.startOffset,
        endCodePoint: evidence.endOffset,
      };
      unique.set(`${range.chapterId}:${range.startCodePoint}:${range.endCodePoint}`, range);
    }
  }
  return [...unique.values()]
    .sort((a, b) => a.chapterId.localeCompare(b.chapterId) || a.startCodePoint - b.startCodePoint)
    .slice(0, 64);
}

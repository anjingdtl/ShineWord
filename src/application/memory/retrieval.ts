export interface RetrievableItem {
  id: string;
  /** Canonical text used for relevance ranking (summary or fact text). */
  text: string;
  scope: 'world' | 'branch';
  branchId: string | null;
  /** World-time window; null bounds are open. */
  validFrom: number | null;
  validTo: number | null;
  /** Actor visibility: null = world-visible (public canon). */
  visibleToActors: string[] | null;
  /** Facts the viewer has been told about even without world visibility. */
  status: 'explicit' | 'inference' | 'speculation' | 'conflict' | 'user_supplement' | 'event' | 'summary';
  knownToActors: string[] | null;
}

export interface RetrievalQuery {
  viewerActorId: string;
  branchId: string;
  /** Current world-time order for temporal filtering. */
  worldTimeOrder: number;
  queryText: string;
  limit: number;
}

export interface FilterStats {
  total: number;
  afterVisibility: number;
  afterTime: number;
  afterStatus: number;
  returned: number;
}

export interface RetrievalResult {
  items: Array<RetrievableItem & { score: number }>;
  stats: FilterStats;
}

const AUTHORITATIVE_STATUSES = new Set(['explicit', 'user_supplement', 'event', 'summary']);

function charBigrams(text: string | null | undefined): Set<string> {
  // Older/imported turn rows can have both publicSummary and narrativeText
  // absent. Treat that record as non-searchable rather than failing the turn.
  const normalized = (text ?? '').toLowerCase().replace(/\s+/g, '');
  const grams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i += 1) {
    grams.add(normalized.slice(i, i + 2));
  }
  if (normalized.length === 1) grams.add(normalized);
  return grams;
}

/**
 * Retrieval order is mandatory: visibility → temporal window → status
 * validity → and only then relevance ranking. Semantic similarity must never
 * resurrect a secret the viewer cannot know (construction plan §11).
 */
export function retrieveContext(
  candidates: readonly RetrievableItem[],
  query: RetrievalQuery,
): RetrievalResult {
  const stats: FilterStats = { total: candidates.length, afterVisibility: 0, afterTime: 0, afterStatus: 0, returned: 0 };

  const visible = candidates.filter(item => {
    const worldVisible = item.visibleToActors === null;
    const personallyKnown = item.knownToActors?.includes(query.viewerActorId) ?? false;
    return worldVisible || personallyKnown;
  });
  stats.afterVisibility = visible.length;

  const temporal = visible.filter(item => {
    if (item.validFrom !== null && query.worldTimeOrder < item.validFrom) return false;
    if (item.validTo !== null && query.worldTimeOrder > item.validTo) return false;
    return true;
  });
  stats.afterTime = temporal.length;

  const valid = temporal.filter(item => {
    if (item.scope === 'branch' && item.branchId !== query.branchId) return false;
    // Conflicts and speculation never enter Narrator context; they remain
    // visible to restricted adjudication paths only.
    return AUTHORITATIVE_STATUSES.has(item.status);
  });
  stats.afterStatus = valid.length;

  const queryGrams = charBigrams(query.queryText);
  const ranked = valid
    .map(item => {
      const grams = charBigrams(item.text);
      let overlap = 0;
      for (const gram of queryGrams) {
        if (grams.has(gram)) overlap += 1;
      }
      const score = queryGrams.size === 0 ? 0 : overlap / queryGrams.size;
      return { ...item, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, query.limit);
  stats.returned = ranked.length;

  return { items: ranked, stats };
}

export const SUMMARY_INTERVAL_TURNS = 8;

export function shouldSummarize(stateVersion: number, lastSummarizedVersion: number): boolean {
  return stateVersion - lastSummarizedVersion >= SUMMARY_INTERVAL_TURNS;
}

export interface SummaryRequestPayload {
  role: 'Summarizer';
  fromStateVersion: number;
  toStateVersion: number;
  turnSummaries: Array<{ turnId: string; publicSummary: string }>;
}

export function buildSummaryRequest(
  fromStateVersion: number,
  toStateVersion: number,
  turnSummaries: Array<{ turnId: string; publicSummary: string }>,
): SummaryRequestPayload {
  if (toStateVersion <= fromStateVersion) {
    throw new Error('Summary range must advance: toStateVersion > fromStateVersion.');
  }
  return { role: 'Summarizer', fromStateVersion, toStateVersion, turnSummaries };
}

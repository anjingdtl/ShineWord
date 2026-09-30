/**
 * Episodic index V2 (infrastructure plan §30-§34): fully local retrieval over
 * committed turns - no embedding API, no per-recall LLM call.
 *
 * Tokenizer: CJK unigram+bigram+trigram plus English word tokens
 * (tavo-mini-proven recipe). Scoring: IDF-weighted term overlap plus entity
 * boosts resolved through actorId - names are only recall entry points, and
 * ambiguous aliases never boost a single actor.
 */

export interface EpisodicTurnRecord {
  branchId: string;
  turnId: string;
  stateVersion: number;
  publicSummary: string;
  narrativeText: string;
  actorIds: string[];
  locationIds: string[];
  questIds: string[];
  entryIds: string[];
  itemIds: string[];
  keywords: string[];
  invalidAtStateVersion: number | null;
}

const CJK_RANGE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN_WORD = /[a-zA-Z][a-zA-Z0-9_-]*/g;

/** CJK n-grams (1..3) + lowercase latin word tokens. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const chars: string[] = [];
  const flush = (): void => {
    if (chars.length === 0) return;
    tokens.push(chars.join(''));
    if (chars.length >= 2) tokens.push(`${chars[0]}${chars[1]}`);
    if (chars.length >= 3) tokens.push(`${chars[0]}${chars[1]}${chars[2]}`);
    // Slide the window so every position contributes n-grams.
    for (let i = 1; i + 1 < chars.length; i += 1) {
      tokens.push(`${chars[i]}${chars[i + 1]}`);
      if (i + 2 < chars.length) tokens.push(`${chars[i]}${chars[i + 1]}${chars[i + 2]}`);
    }
    chars.length = 0;
  };
  for (const ch of text) {
    if (CJK_RANGE.test(ch)) {
      chars.push(ch);
      continue;
    }
    flush();
  }
  flush();
  for (const match of text.toLowerCase().matchAll(LATIN_WORD)) {
    tokens.push(match[0]);
  }
  return tokens;
}

function tokenSet(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

export interface IndexedTurn {
  record: EpisodicTurnRecord;
  termCounts: Map<string, number>;
  maxTermCount: number;
}

export interface EpisodicIndex {
  turns: IndexedTurn[];
  /** document frequency per term */
  documentFrequency: Map<string, number>;
}

export function buildEpisodicIndex(records: readonly EpisodicTurnRecord[]): EpisodicIndex {
  const turns: IndexedTurn[] = [];
  const documentFrequency = new Map<string, number>();
  for (const record of records) {
    if (record.invalidAtStateVersion !== null) continue;
    const termCounts = tokenSet(searchTextOf(record));
    for (const term of termCounts.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
    let maxTermCount = 0;
    for (const count of termCounts.values()) maxTermCount = Math.max(maxTermCount, count);
    turns.push({ record, termCounts, maxTermCount: Math.max(1, maxTermCount) });
  }
  return { turns, documentFrequency };
}

/** Deterministic, pre-alias search text: summary + narrative + entity names. */
export function searchTextOf(record: EpisodicTurnRecord): string {
  return [
    record.publicSummary,
    record.narrativeText,
    record.actorIds.join(' '),
    record.locationIds.join(' '),
    record.questIds.join(' '),
    record.itemIds.join(' '),
    record.keywords.join(' '),
  ].filter(Boolean).join('\n');
}

export function idfOf(index: EpisodicIndex, term: string): number {
  const n = Math.max(1, index.turns.length);
  const df = index.documentFrequency.get(term) ?? 0;
  return Math.log(1 + n / (1 + df));
}

/** IDF-weighted overlap of the query against one turn, length-normalized. */
export function semanticScore(index: EpisodicIndex, queryTokens: readonly string[], turn: IndexedTurn): number {
  if (queryTokens.length === 0 || index.turns.length === 0) return 0;
  let score = 0;
  const seen = new Set<string>();
  for (const term of queryTokens) {
    if (seen.has(term)) continue;
    seen.add(term);
    const tf = turn.termCounts.get(term);
    if (!tf) continue;
    score += idfOf(index, term) * (tf / turn.maxTermCount);
  }
  // Normalize by query breadth so long queries do not dominate.
  return score / Math.sqrt(seen.size);
}

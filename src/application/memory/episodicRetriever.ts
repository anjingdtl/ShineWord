/**
 * Episodic retriever V2 (infrastructure plan §34-§37).
 *
 *   visibility -> time -> branch -> status FIRST, relevance second (§89)
 *   hybrid top-K: 60% relevance, 20% actor history, 20% recent (§35)
 *   selection by relevance, packing to a token budget, render chronological
 *
 * Actor identity is always actorId; a name/alias resolves to at most one
 * actor and ambiguous aliases boost nobody (§34).
 */

import type { EpisodicTurnRecord } from './episodicIndex';
import { buildEpisodicIndex, semanticScore, tokenize, type EpisodicIndex } from './episodicIndex';

export interface EpisodicActorHint {
  actorId: string;
  name: string;
  aliases?: readonly string[];
}

export interface EpisodicQuery {
  viewerActorId?: string;
  branchId: string;
  /** Only turns committed at or before this version are eligible. */
  maxStateVersion: number;
  queryText: string;
  actors: readonly EpisodicActorHint[];
}

export interface ScoredEpisode {
  record: EpisodicTurnRecord;
  score: number;
  reasons: string[];
}

export interface RecallSelection {
  selected: ScoredEpisode[];
  droppedByBudget: ScoredEpisode[];
  resolvedActorIds: string[];
  ambiguousAliases: string[];
}

export interface RecallOptions {
  topK?: number;
  /** Whole-item token budget for packed rendering. */
  tokenBudget?: number;
  estimateTokens?: (text: string) => number;
}

const DEFAULT_TOP_K = 10;

export function resolveQueryActors(queryText: string, actors: readonly EpisodicActorHint[]): {
  resolved: string[];
  ambiguous: string[];
} {
  const resolved = new Set<string>();
  const ambiguous: string[] = [];
  for (const actor of actors) {
    if (queryText.includes(actor.name)) resolved.add(actor.actorId);
    if (!actor.aliases) continue;
    for (const alias of actor.aliases) {
      if (!queryText.includes(alias)) continue;
      const owners = actors.filter(other =>
        other.actorId === actor.actorId || other.name === alias || other.aliases?.includes(alias));
      // The alias belongs to this actor only when no OTHER actor claims it.
      const distinctOwners = new Set(owners.map(owner => owner.actorId));
      if (distinctOwners.size > 1) {
        ambiguous.push(alias);
      } else {
        resolved.add(actor.actorId);
      }
    }
  }
  return { resolved: [...resolved], ambiguous };
}

/** Filters BEFORE any relevance work (plan §89 ordering is a hard gate). */
export function eligibleEpisodes(
  records: readonly EpisodicTurnRecord[],
  query: Pick<EpisodicQuery, 'branchId' | 'maxStateVersion'>,
): EpisodicTurnRecord[] {
  return records.filter(record =>
    record.branchId === query.branchId
    && record.stateVersion <= query.maxStateVersion
    && record.invalidAtStateVersion === null);
}

export function scoreEpisodes(
  index: EpisodicIndex,
  query: EpisodicQuery,
  queryTokens: readonly string[],
  resolvedActorIds: readonly string[],
): ScoredEpisode[] {
  const queryItems = query.queryText.toLowerCase();
  const scored: ScoredEpisode[] = index.turns.map(turn => {
    const record = turn.record;
    const reasons: string[] = [];
    let score = semanticScore(index, queryTokens, turn);
    if (score > 0) reasons.push('relevance');

    const actors = new Set(record.actorIds);
    const queryActors = resolvedActorIds.filter(id => actors.has(id));
    if (queryActors.length === 1) {
      score += 2.0;
      reasons.push('actor');
    } else if (queryActors.length >= 2) {
      score += 3.0; // pair beats single
      reasons.push('actor-pair');
    }
    // Item/quest boosts ride on the query text mentioning their ids or the
    // keywords the commit path recorded for them.
    for (const itemId of record.itemIds) {
      if (queryItems.includes(itemId)) {
        score += 1.5;
        reasons.push('item');
        break;
      }
    }
    for (const questId of record.questIds) {
      if (queryItems.includes(questId)) {
        score += 1.5;
        reasons.push('quest');
        break;
      }
    }
    for (const keyword of record.keywords) {
      if (keyword && queryItems.includes(keyword.toLowerCase())) {
        score += 1.0;
        reasons.push('keyword');
        break;
      }
    }
    return { record, score, reasons };
  });
  // Deterministic total order: score desc, then earlier turn, then turnId.
  scored.sort((a, b) =>
    b.score - a.score
    || a.record.stateVersion - b.record.stateVersion
    || (a.record.turnId < b.record.turnId ? -1 : 1));
  return scored;
}

/**
 * Hybrid selection (plan §35): relevance quota, actor-history quota, recent
 * quota - then whole-item budget packing. Selection is by relevance;
 * rendering order is decided by the caller (chronological).
 */
export function recallEpisodes(
  records: readonly EpisodicTurnRecord[],
  query: EpisodicQuery,
  options: RecallOptions = {},
): RecallSelection {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const estimate = options.estimateTokens ?? defaultEstimateTokens;
  const eligible = eligibleEpisodes(records, query);
  if (eligible.length === 0) {
    return { selected: [], droppedByBudget: [], resolvedActorIds: [], ambiguousAliases: [] };
  }
  const index = buildEpisodicIndex(eligible);
  const queryTokens = tokenize(query.queryText);
  const { resolved, ambiguous } = resolveQueryActors(query.queryText, query.actors);
  const scored = scoreEpisodes(index, query, queryTokens, resolved)
    .filter(episode => episode.score > 0);

  const relevanceQuota = Math.max(1, Math.round(topK * 0.6));
  const actorQuota = Math.max(1, Math.round(topK * 0.2));
  const recentQuota = Math.max(1, topK - relevanceQuota - actorQuota);

  const picked: ScoredEpisode[] = [];
  const pickedIds = new Set<string>();
  const takeWhile = (quota: number, predicate: (episode: ScoredEpisode) => boolean): void => {
    let used = 0;
    for (const episode of scored) {
      if (used >= quota) break;
      if (pickedIds.has(episode.record.turnId)) continue;
      if (!predicate(episode)) continue;
      picked.push(episode);
      pickedIds.add(episode.record.turnId);
      used += 1;
    }
  };

  const topScored = scored[0];
  const minRelevance = topScored ? topScored.score * 0.15 : 0;
  takeWhile(relevanceQuota, episode => episode.score >= minRelevance);
  const actorSet = new Set(resolved);
  takeWhile(actorQuota, episode =>
    episode.record.actorIds.some(id => actorSet.has(id)));
  // Small result sets keep pure relevance but guarantee one recent turn so
  // the story bridge never snaps (plan §35).
  if (picked.length < 5) {
    const newest = [...eligible].sort((a, b) => b.stateVersion - a.stateVersion)[0];
    if (newest && !pickedIds.has(newest.turnId)) {
      const episode = scored.find(item => item.record.turnId === newest.turnId)
        ?? { record: newest, score: 0, reasons: ['recent-fallback'] };
      picked.push(episode);
      pickedIds.add(newest.turnId);
    }
  }
  takeWhile(recentQuota, () => true);

  // Whole-item packing under the token budget (plan §36).
  const budget = options.tokenBudget;
  if (budget === undefined) {
    return { selected: picked, droppedByBudget: [], resolvedActorIds: resolved, ambiguousAliases: ambiguous };
  }
  const selected: ScoredEpisode[] = [];
  const dropped: ScoredEpisode[] = [];
  let used = 0;
  for (const episode of picked) {
    const cost = estimate(episodeText(episode));
    if (used + cost > budget) {
      dropped.push(episode);
      continue;
    }
    selected.push(episode);
    used += cost;
  }
  return { selected, droppedByBudget: dropped, resolvedActorIds: resolved, ambiguousAliases: ambiguous };
}

export function episodeText(episode: ScoredEpisode): string {
  return `${episode.record.publicSummary}\n${episode.record.narrativeText}`;
}

/** CJK ~1 token/code point, other ~0.3 (matches worldBuild estimateTokens). */
export function defaultEstimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0x3400 && code <= 0x9fff) cjk += 1;
    else other += 1;
  }
  return cjk + Math.floor(other * 0.3);
}

/** Render selected episodes chronologically (selection ≠ display order). */
export function renderEpisodicRecall(selection: RecallSelection): string {
  const ordered = [...selection.selected].sort((a, b) =>
    a.record.stateVersion - b.record.stateVersion
    || (a.record.turnId < b.record.turnId ? -1 : 1));
  return ordered
    .map(episode => `${episode.record.turnId}: ${episode.record.publicSummary}`)
    .join('\n');
}

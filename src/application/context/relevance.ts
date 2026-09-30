/**
 * Relevance scoring for context candidates (plan §14): a 0..1 overlap of
 * the turn's query terms against candidate text, reusing the episodic
 * tokenizer so recall and context speak the same token language.
 */

import { tokenize } from '../memory/episodicIndex';

export function textRelevance(queryText: string, candidateText: string): number {
  const queryTerms = new Set(tokenize(queryText));
  if (queryTerms.size === 0) return 0;
  const candidateTerms = new Set(tokenize(candidateText));
  let overlap = 0;
  for (const term of queryTerms) {
    if (candidateTerms.has(term)) overlap += 1;
  }
  return overlap / queryTerms.size;
}

/** Current-scene terms: location id + nearby actor ids + explicit intents. */
export function buildSceneQuery(parts: readonly string[]): string {
  return parts.filter(Boolean).join(' ');
}

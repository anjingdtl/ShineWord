/**
 * High-confidence free-input → method matcher (convergence plan W4a).
 *
 * Player free text that does not exactly match a method's first step still
 * often names the method outright ("我要查看现场" for the method titled
 * "查看现场"). This matcher binds such input to a published method ONLY at
 * high confidence, before the Planner is consulted; anything ambiguous goes
 * back to the Planner — one extra request is always cheaper than a mis-bind
 * (mis-binding is a correctness violation, not a latency tradeoff).
 *
 * Confidence tiers, all evaluated over the CURRENT candidate set only:
 * 1. exact — normalized equality with a method's first step (the existing
 *    resolvePlayerMethodIndex behavior).
 * 2. title — the player's normalized input contains a method's normalized
 *    title (≥2 chars) as a contiguous substring.
 * 3. keyword — a distinctive shared fragment: the input and the method's
 *    title+goal share a contiguous run of ≥4 characters not shared with any
 *    other candidate method.
 * A tier result is used only when EXACTLY ONE method matches at that tier.
 * Pure function; no clock, no randomness, no I/O.
 */
import type { MethodTemplateV1 } from '../../domain/situations/types';

export interface FreeformMethodMatch {
  index: number;
  confidence: 'exact' | 'title' | 'keyword';
}

function normalize(text: string): string {
  return text.replace(/[\s，。！？、；：,.!?;:'"「」『』（）()]/g, '').toLowerCase();
}

function longestCommonRun(a: string, b: string): number {
  let best = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      let run = 0;
      while (i + run < a.length && j + run < b.length && a[i + run] === b[j + run]) run += 1;
      if (run > best) best = run;
    }
  }
  return best;
}

export function matchFreeformIntentToMethod(input: {
  intent: string;
  methods: readonly MethodTemplateV1[];
}): FreeformMethodMatch | null {
  const intent = normalize(input.intent);
  if (intent.length < 2) return null;
  const exact: number[] = [];
  const title: number[] = [];
  for (const [index, method] of input.methods.entries()) {
    if (intent === normalize(method.firstStep.intent)) exact.push(index);
    const titleNorm = normalize(method.title);
    if (titleNorm.length >= 2 && intent.includes(titleNorm)) title.push(index);
  }
  if (exact.length === 1) return { index: exact[0]!, confidence: 'exact' };
  if (title.length === 1) return { index: title[0]!, confidence: 'title' };
  if (title.length > 1) return null; // ambiguous naming across methods — never guess
  // Distinctive keyword: a ≥4-char run shared with one method and with no other.
  let keywordBest: { index: number; run: number } | null = null;
  let tie = false;
  for (const [index, method] of input.methods.entries()) {
    const run = Math.max(longestCommonRun(intent, normalize(method.title)),
      longestCommonRun(intent, normalize(method.goal)));
    if (run < 4) continue;
    if (!keywordBest || run > keywordBest.run) { keywordBest = { index, run }; tie = false; }
    else if (run === keywordBest.run) tie = true;
  }
  if (keywordBest && !tie) return { index: keywordBest.index, confidence: 'keyword' };
  return null;
}

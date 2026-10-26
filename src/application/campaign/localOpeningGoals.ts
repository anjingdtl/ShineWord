/**
 * Local opening-goal suggestions (startup convergence plan W2).
 *
 * The wizard's "这次想做什么" chips are now generated locally from the same
 * inputs the LLM suggestion used to receive: deterministic templates over the
 * anchor title, start location, canon character names and the player name.
 * No request, no cache, no ledger — mount and anchor changes cost 0 LLM
 * calls (K2/K3). The AI suggestion remains available behind an explicit
 * "AI 换一批" tap (suggestOpeningGoals, unchanged governance).
 *
 * Product honesty (plan §5.3.4): these are template goals, not claims of
 * understanding the player's free text; that stays the LLM path's job.
 */
import type { OpeningGoalSuggestionInput } from './openingGoalSuggestions';

const MAX_GOAL_LENGTH = 28;
const MAX_GOALS = 2;

/** Anchors are titled like "序0 · 程岩穿越为四王子罗兰"; goals read better without the ordinal. */
function anchorCore(anchorTitle: string): string {
  const stripped = anchorTitle.replace(/^序\d+\s*·\s*/, '').trim();
  return stripped.length > 0 ? stripped : anchorTitle.trim();
}

/** Truncates by code points so CJK-extended text never splits a surrogate pair. */
function clamp(text: string, budget: number): string {
  const chars = Array.from(text);
  return chars.length <= budget ? text : `${chars.slice(0, Math.max(0, budget - 1)).join('')}…`;
}

function fit(template: (part: string) => string, prefixLen: number, suffixLen: number, raw: string): string {
  const budget = MAX_GOAL_LENGTH - prefixLen - suffixLen;
  if (budget < 4) return '';
  return template(clamp(raw, budget));
}

/**
 * Returns 1-2 deterministic goal suggestions, each ≤28 code points,
 * deduplicated. Pure: same input, same output, no clock or randomness.
 */
export function localOpeningGoals(input: OpeningGoalSuggestionInput): string[] {
  const goals: string[] = [];
  const core = anchorCore(input.anchorTitle);
  const investigate = core
    ? fit(text => `查明${text}的来龙去脉`, '查明'.length, '的来龙去脉'.length, core)
    : '查明开局事件的来龙去脉';
  goals.push(investigate);
  const character = (input.characterNames.find(name => name.trim().length > 0) ?? '').trim();
  const ally = character
    ? fit(text => `与${text}结盟，改善处境`, '与'.length, '结盟，改善处境'.length, character)
    : (input.locationName?.trim()
      ? fit(text => `在${text}站稳脚跟`, '在'.length, '站稳脚跟'.length, input.locationName.trim())
      : '改善当前的处境');
  if (ally) goals.push(ally);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const goal of goals) {
    if (goal && Array.from(goal).length <= MAX_GOAL_LENGTH && !seen.has(goal)) {
      seen.add(goal);
      unique.push(goal);
    }
    if (unique.length >= MAX_GOALS) break;
  }
  return unique;
}

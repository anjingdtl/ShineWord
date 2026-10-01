/**
 * AI-suggested opening goals (2026-10-01 product ask #3).
 *
 * The opening wizard's "这次想做什么" field is easy to leave blank for
 * players who have not read the source novel. One cheap JSON request over
 * the published world package proposes two concrete goals tied to the
 * chosen anchor moment, place and cast; a third option always remains the
 * player's own words. Failures degrade silently to "no suggestions" - the
 * wizard must never block on this.
 */
import type { LlmProvider } from '../llm/types';
import { DEFAULT_OUTPUT_DEMANDS } from '../llm/requestDemands';

const MAX_GOAL_LENGTH = 40;
const MAX_GOALS = 2;

export interface OpeningGoalSuggestionInput {
  worldTitle: string;
  /** Narrative moment the campaign will start at, e.g. "序0 · 程岩穿越为四王子罗兰". */
  anchorTitle: string;
  /** Start location display name, when known. */
  locationName?: string;
  /** A few canon character names for flavour (already display-safe). */
  characterNames: readonly string[];
  /** The player's character name (original or canon). */
  playerName: string;
}

function sanitizeGoal(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_GOAL_LENGTH);
  return trimmed.length >= 4 ? trimmed : null;
}

/**
 * Returns 0-2 short goal suggestions. NEVER throws: any provider/parse
 * failure resolves to [] so the caller can render suggestions as a pure
 * enhancement.
 */
export async function suggestOpeningGoals(
  provider: LlmProvider,
  input: OpeningGoalSuggestionInput,
): Promise<string[]> {
  const systemLines = [
    '你是文字冒险游戏的开局目标策划。根据给定的开局时刻、地点与人物，提出两个具体、可玩性强的开局目标。',
    '要求：',
    '- 每个目标不超过 28 个字，一句话，动词开头；',
    '- 两个目标方向不同（例如一个调查谜团、一个改善处境/结盟）；',
    `- 贴合开局时刻的局势与地点，可以引用人物（如「${input.playerName}」）`,
  ];
  if (input.characterNames.length > 0) {
    systemLines.push(`- 世界已知人物示例：${input.characterNames.slice(0, 6).join('、')}`);
  }
  systemLines.push('- 只输出 JSON：{"goals":["目标一","目标二"]}');
  const system = systemLines.join('\n');

  const user = [
    `作品：${input.worldTitle}`,
    `开局时刻：${input.anchorTitle}`,
    input.locationName ? `开局地点：${input.locationName}` : null,
    `玩家角色：${input.playerName}`,
  ]
    .filter(line => line !== null)
    .join('\n');

  try {
    const response = await provider.complete({
      role: 'Planner',
      system,
      user,
      maxOutputTokens: DEFAULT_OUTPUT_DEMANDS.opening_goal.maximum,
      jsonMode: true,
      requestKind: 'opening_goal',
    });
    const parsed = JSON.parse(response.text) as { goals?: unknown };
    if (!Array.isArray(parsed.goals)) return [];
    const seen = new Set<string>();
    const goals: string[] = [];
    for (const raw of parsed.goals) {
      const goal = sanitizeGoal(raw);
      if (goal && !seen.has(goal)) {
        seen.add(goal);
        goals.push(goal);
      }
      if (goals.length >= MAX_GOALS) break;
    }
    return goals;
  } catch {
    return [];
  }
}

import type { RollGrade } from '../../domain/rules/types';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { ActionContract } from '../../domain/turns/types';

export interface StoryEntryInput {
  turnId: string;
  narrativeText: string | null;
  narrativeStatus: string | null;
  outcomeGrade: RollGrade;
  action?: Pick<ActionContract, 'actorId' | 'actionType' | 'intent'> | null;
  beforeState?: GameStateSnapshot | null;
  afterState?: GameStateSnapshot | null;
}

export interface StoryEntry {
  /** Internal list key only; never render in the story body. */
  turnId: string;
  text: string;
  grade: RollGrade;
  mechanicalOnly: boolean;
  choice?: string;
  result?: string;
  resultDetails?: string;
}

const PLAYER_ACTIONS = new Set([
  'observe', 'interact', 'talk', 'move', 'skill_check', 'ability',
  'short_rest', 'long_rest', 'train', 'attack', 'guard', 'retreat', 'rescue', 'dash', 'encounter_begin',
]);

const GRADE_LABELS: Readonly<Record<string, string>> = {
  full_success: '大成功', success: '成功', failure: '未能成功', severe_failure: '遭遇挫折',
};

function clockSeconds(state: GameStateSnapshot | null | undefined): number | undefined {
  const value = state?.clockSeconds ?? (state?.clockMinutes !== undefined ? state.clockMinutes * 60 : undefined);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function duration(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} 小时`;
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

/** Only the player's own persisted changes, never contract promises or NPC reasoning. */
function projectActionFeedback(input: StoryEntryInput): Pick<StoryEntry, 'choice' | 'result' | 'resultDetails'> {
  const cards = input.beforeState?.cards ?? input.afterState?.cards;
  const player = Array.isArray(cards) ? cards.find(entry => entry
    && typeof entry.actorId === 'string'
    && (entry.card as { controller?: string } | null)?.controller === 'player') : undefined;
  const action = input.action;
  if (!player || !action || action.actorId !== player.actorId || !PLAYER_ACTIONS.has(action.actionType)) return {};

  const choice = action.actionType === 'short_rest' ? '原地短休'
    : action.actionType === 'long_rest' ? '进行长休'
      : action.actionType === 'train' ? '进行技能训练'
        : action.actionType === 'encounter_begin' ? '进入冲突'
          : typeof action.intent === 'string' ? action.intent.trim() : '';
  if (!choice) return {};
  const succeeded = input.outcomeGrade === 'full_success' || input.outcomeGrade === 'success';
  const resting = action.actionType === 'short_rest' || action.actionType === 'long_rest';
  const result = succeeded && resting ? '休整完成'
    : succeeded && action.actionType === 'train' ? '训练完成'
      : GRADE_LABELS[input.outcomeGrade] ?? '行动完成';
  const details: string[] = [];
  const beforeClock = clockSeconds(input.beforeState);
  const afterClock = clockSeconds(input.afterState);
  if (beforeClock !== undefined && afterClock !== undefined && afterClock > beforeClock) {
    details.push(`耗时 ${duration(afterClock - beforeClock)}`);
  }
  const before = input.beforeState?.actors?.[player.actorId];
  const after = input.afterState?.actors?.[player.actorId];
  for (const [resourceId, name] of [['stamina', '体力'], ['hp', '生命']] as const) {
    const previous = before?.resources?.[resourceId];
    const current = after?.resources?.[resourceId];
    if (typeof previous !== 'number' || typeof current !== 'number'
      || !Number.isFinite(previous) || !Number.isFinite(current)) continue;
    const delta = current - previous;
    if (delta > 0) details.push(`${name}恢复 ${delta} 点`);
    else if (delta < 0) details.push(`${name}消耗 ${-delta} 点`);
    else if (resting && resourceId === 'stamina') details.push(`${name}保持 ${current} 点`);
  }
  if (before && after && before.locationId !== after.locationId) details.push('抵达新的地点');
  if (after?.lifeStatus !== before?.lifeStatus) {
    if (after?.lifeStatus === 'critical') details.push('你已陷入濒危');
    else if (after?.lifeStatus === 'dead') details.push('你的旅程走到了终点');
  }
  return { choice, result, ...(details.length ? { resultDetails: details.join(' · ') } : {}) };
}

/**
 * Only committed narration is story prose. Action feedback uses the player's
 * frozen choice and actual before/after snapshots. Raw public summaries,
 * effect strings, NPC rationale and internal setup turns never become prose.
 */
export function projectStoryEntry(input: StoryEntryInput): StoryEntry {
  const narrative = input.narrativeStatus === 'Committed' && typeof input.narrativeText === 'string'
    ? input.narrativeText.trim()
    : '';
  return {
    turnId: input.turnId,
    text: narrative,
    grade: input.outcomeGrade,
    mechanicalOnly: narrative.length === 0,
    ...projectActionFeedback(input),
  };
}

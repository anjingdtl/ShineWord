/**
 * useContextualActions — 情境快捷行动 (plan §14.5).
 *
 * These are NOT planner suggestions: nothing calls an LLM, and the list is
 * derived purely from local state (active encounter, visible hostiles, party
 * status, quests). Clicking one only fills the composer — it never submits.
 */
import { useMemo } from 'react';
import type { PlayUiProjection } from '../../../../../src/application/campaign/playProjection';
import type { EncounterView } from '../../../../runtime';

/** Explorer-state actions; always available while not in combat. */
const EXPLORE_ACTIONS = ['观察四周', '查看人物', '与同伴交谈', '查看任务', '原地整理装备'];

export function useContextualActions(input: {
  projection: PlayUiProjection | null;
  encounter: EncounterView | null;
}): string[] {
  const { projection, encounter } = input;
  return useMemo(() => {
    const active = encounter && encounter.status === 'active' ? encounter : null;
    if (active) {
      const actions: string[] = [];
      const target = active.actors.find(actor => actor.side === 'hostile' && actor.hp > 0);
      if (target) actions.push(`攻击 ${target.name}`);
      const ally = active.actors.find(actor => actor.side === 'party' && actor.conditions.includes('disabled'));
      if (ally) actions.push(`援救 ${ally.name}`);
      const current = active.actors.find(actor => actor.actorId === active.currentActorId);
      if (current) {
        const reachable = active.zones.filter(
          zone => zone.zoneId !== current.zoneId && zone.exits.includes(current.zoneId),
        );
        for (const zone of reachable.slice(0, 2)) actions.push(`移动到 ${zone.zoneId}`);
      }
      actions.push('戒备', '撤退');
      return actions;
    }
    const quest = projection?.quests.find(item => item.status === 'active');
    return [
      ...EXPLORE_ACTIONS.filter(action => action !== '查看任务' || Boolean(quest)),
      ...(quest ? [`推进任务：${quest.name}`] : []),
    ];
  }, [projection, encounter]);
}
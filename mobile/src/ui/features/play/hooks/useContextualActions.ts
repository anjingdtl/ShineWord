import { useMemo } from 'react';
import type { PlayUiProjection } from '../../../../../../src/application/campaign/playProjection';
import type { EncounterView } from '../../../../runtime';
import type { SceneEncounterOption } from '../../../../../../src/application/campaign/session';
import type { ActionChoice } from '../ActionChoices';

/** Player-facing choices are explicit actions or read-only destinations. */
export function useContextualActions(input: {
  projection: PlayUiProjection | null;
  encounter: EncounterView | null;
  sceneEncounters: SceneEncounterOption[];
}): ActionChoice[] {
  const { projection, encounter, sceneEncounters } = input;
  return useMemo(() => {
    const active = encounter?.status === 'active' ? encounter : null;
    if (active) {
      if (!active.currentActorIsPlayer) return [];
      const hostiles = active.actors.filter(actor => actor.side === 'hostile' && actor.hp > 0);
      const choices: ActionChoice[] = [];
      if (hostiles.length === 1) {
        const target = hostiles[0]!;
        choices.push({ id: 'attack-target', kind: 'attack', label: `攻击 ${target.name}`, targetActorId: target.actorId });
      } else if (hostiles.length > 1) {
        choices.push({ id: 'choose-target', kind: 'inspect', label: '选择攻击目标', target: 'combatants' });
      }
      const ally = active.actors.find(actor => actor.side === 'party' && actor.hp > 0
        && actor.conditions.includes('disabled'));
      if (ally) choices.push({ id: 'rescue-ally', kind: 'rescue', label: `援救 ${ally.name}`, targetActorId: ally.actorId });
      choices.push({ id: 'retreat', kind: 'retreat', label: '撤离这场冲突' });
      return choices;
    }

    const choices: ActionChoice[] = [
      { id: 'observe', kind: 'act', label: '观察周围环境', intent: '观察周围环境' },
    ];
    if (sceneEncounters.length === 1) {
      choices.push({
        id: 'enter-scene-conflict', kind: 'start_encounter',
        label: `进入冲突：${sceneEncounters[0]!.sceneName}`,
        sceneEntryId: sceneEncounters[0]!.sceneEntryId,
      });
    } else if (sceneEncounters.length > 1) {
      choices.push({ id: 'choose-scene-conflict', kind: 'inspect', label: '查看当前场景的冲突选项', target: 'scene_encounters' });
    }
    if (projection?.party.length) {
      choices.push({ id: 'talk-companions', kind: 'act', label: '和同伴聊聊', intent: '和同伴聊聊眼下的处境' });
    }
    if (projection?.discoveries.length) {
      choices.push({ id: 'known-clues', kind: 'inspect', label: '回看已发现线索', target: 'knowledge' });
    }
    if (projection?.quests.some(quest => quest.status === 'active')) {
      choices.push({ id: 'active-quests', kind: 'inspect', label: '查看当前目标', target: 'quests' });
    }
    return choices;
  }, [projection, encounter, sceneEncounters]);
}

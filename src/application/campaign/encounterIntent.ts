import type { EncounterView } from './encounterService';

export type EncounterIntentProposal =
  | { kind: 'attack'; targetActorId: string }
  | { kind: 'rescue'; targetActorId: string }
  | { kind: 'retreat' }
  | { kind: 'pass' }
  | { kind: 'clarify'; explanation: string };

/**
 * Restricted text intent parser for active encounters. It may name only an
 * actor already present in the player-visible encounter view and never
 * proposes distance, damage, rolls, items, skills, or hidden targets.
 */
export function proposeEncounterIntent(text: string, encounter: EncounterView): EncounterIntentProposal {
  const value = normalize(text).replace(/[。.!！?？]+$/u, '').trim();
  if (/^(?:我)?(?:撤退|撤离|退出战斗|retreat)$/iu.test(value)) return { kind: 'retreat' };
  if (/^(?:我)?(?:戒备|跳过行动|保持戒备|pass|guard)$/iu.test(value)) return { kind: 'pass' };

  const attack = value.match(/^(?:我)?(?:攻击|袭击|attack)\s*(.*)$/iu);
  if (attack) {
    const targetText = stripTargetPunctuation(attack[1] ?? '');
    if (!targetText) {
      return { kind: 'clarify', explanation: '请明确点选攻击目标；系统不会替你选择目标。' };
    }
    const targets = encounter.actors.filter(actor => actor.side === 'hostile' && actor.hp > 0
      && normalize(actor.name) === targetText);
    if (targets.length === 1) return { kind: 'attack', targetActorId: targets[0]!.actorId };
    return {
      kind: 'clarify',
      explanation: targets.length > 1
        ? '有多个目标使用这个名字，请从目标列表中点选。'
        : '没有找到同名的公开敌对目标；请从列出的目标中选择，不会创建新目标。',
    };
  }

  const rescue = value.match(/^(?:我)?(?:援救|救援|救助|rescue)\s*(.*)$/iu);
  if (rescue) {
    const targetText = stripTargetPunctuation(rescue[1] ?? '');
    if (!targetText) return { kind: 'clarify', explanation: '请明确点选需要援救的同伴。' };
    const targets = encounter.actors.filter(actor => actor.side === 'party'
      && actor.conditions.includes('disabled') && normalize(actor.name) === targetText);
    if (targets.length === 1) return { kind: 'rescue', targetActorId: targets[0]!.actorId };
    return {
      kind: 'clarify',
      explanation: targets.length > 1
        ? '有多个失能同伴使用这个名字，请从列表中点选。'
        : '没有找到同名且处于失能状态的同伴。',
    };
  }

  if (/^(?:我)?(?:移动|疾行|冲刺|move|dash)\b/iu.test(value)) {
    return { kind: 'clarify', explanation: '请使用当前列出的区域选择；系统不会从自由文本猜测地点或路线。' };
  }
  return {
    kind: 'clarify',
    explanation: '冲突中的文字行动可识别明确的攻击目标、援救对象、戒备或撤退；其他行动请从当前选择中点选。',
  };
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('zh-CN');
}

function stripTargetPunctuation(value: string): string {
  return normalize(value).replace(/^[\s:：,，]+|[\s。.!！?？,，]+$/gu, '');
}

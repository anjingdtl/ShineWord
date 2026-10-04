import type { ContentEntry } from '../../domain/content/types';
import { validateDefinition } from '../../domain/content/types';

/**
 * Local opening-situation compiler (P7-2, plan §5.4/§5.5). Produces exactly
 * ONE conservative design_fill situation so a fast opening (startup_local,
 * progressive opening — zero mapping calls) still exposes an intervenable
 * situation with distinct methods. No invented people, secrets or lore: the
 * situation references only entries that already exist in the package.
 */

export interface OpeningSituationInput {
  entries: readonly ContentEntry[];
  /** Opening situation/goal dossier text (player-safe). */
  situationText?: string;
  goalText?: string;
  locationName?: string;
}

export const OPENING_SITUATION_ENTRY_ID = 'situation-opening';

export function compileOpeningSituation(input: OpeningSituationInput): ContentEntry | null {
  const scene = input.entries.find(entry => entry.kind === 'scene' && entry.visibility === 'public');
  if (!scene) return null;
  const sceneDefinition = scene.definition as {
    name: string;
    actors?: string[];
    clues?: string[];
  };
  const skillIds = new Set(input.entries.filter(entry => entry.kind === 'skill').map(entry => entry.entryId));
  const interactTarget = sceneDefinition.actors?.[0];

  const methods: Array<Record<string, unknown>> = [];
  if (skillIds.has('skill-observation')) {
    methods.push({
      methodId: 'survey',
      title: '查看现场',
      goal: '弄清眼前的局面和可用的线索',
      firstStep: { intent: '仔细查看现场，寻找值得注意的细节与线索', actionKind: 'skill_check', skillId: 'skill-observation' },
      requires: { skillId: 'skill-observation', minRank: 'untrained' },
      tradeoffs: '花费时间；结论取决于检定',
      preparation: '无',
    });
  }
  if (interactTarget && skillIds.has('skill-diplomacy')) {
    methods.push({
      methodId: 'ask-around',
      title: '向在场者打听',
      goal: '从在场的人那里了解发生了什么',
      firstStep: { intent: `向在场的人打听${sceneDefinition.name}的情形`, actionKind: 'skill_check', skillId: 'skill-diplomacy', targetEntryId: interactTarget },
      requires: { skillId: 'skill-diplomacy', minRank: 'untrained' },
      tradeoffs: '对方不一定愿意多说；态度会影响关系',
      preparation: '无',
    });
  }
  methods.push({
    methodId: 'get-moving',
    title: '着手处理眼前的事',
    goal: input.goalText ? `推进：${input.goalText}` : '着手处理眼前最紧要的事',
    firstStep: { intent: input.situationText ? `着手处理：${input.situationText}` : '着手处理眼前最紧要的事', actionKind: 'interact' },
    requires: {},
    tradeoffs: '没有先摸清情况，风险自负',
    preparation: '无',
  });

  if (methods.length < 2) return null;
  const clueSign = (sceneDefinition.clues?.length ?? 0) > 0
    ? [{ text: '现场留有尚未查明的细节' }]
    : [];
  const definition = {
    title: sceneDefinition.name ? `${sceneDefinition.name}的局势` : '眼前的局势',
    summary: input.situationText
      ? `${input.situationText}`
      : `${sceneDefinition.name}正有事情发生，值得弄清并介入。`,
    gmBrief: '开局引导局面（设计补全）：无隐藏秘密；后续深挖由分内容映射补齐。',
    locationId: (scene.definition as { locationId?: string }).locationId,
    participantEntryIds: (sceneDefinition.actors ?? []).slice(0, 5),
    activation: { kind: 'world_time_at_least', order: 0 },
    signs: clueSign,
    pressure: { description: '局势会随着时间与你的行动变化。' },
    methods,
    transitions: {},
  };
  const errors = validateDefinition('situation', definition);
  if (errors.length > 0) return null;
  const sceneFacts = scene.provenance.sourceFactIds;
  return {
    entryId: OPENING_SITUATION_ENTRY_ID,
    kind: 'situation',
    // Keep revision 0 like every other pre-publish entry: the publisher hashes
    // the incoming revisions and the archive verifier probes uniform bases.
    revision: 0,
    provenance: {
      kind: 'design_fill',
      sourceFactIds: sceneFacts,
      rationale: '开局局面：为可玩性组织的介入点，行动引用均来自已发布条目。',
    },
    fieldProvenance: {},
    visibility: 'gm',
    dependencyIds: [
      scene.entryId,
      ...methods.flatMap(method => [
        (method.firstStep as { skillId?: string }).skillId,
        (method.requires as { skillId?: string }).skillId,
      ]).filter((id): id is string => typeof id === 'string'),
    ].filter((id, index, all) => all.indexOf(id) === index),
    definition,
  };
}

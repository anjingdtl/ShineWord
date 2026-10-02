import type { StyleSemanticV1 } from './types';

export const DEFAULT_STYLE_ID = 'trpg-default';
export const DEFAULT_STYLE_ASSET_VERSION = '1';
export const STYLE_EXPRESSION_BOUNDARY = '以下仅为表达风格；裁定、事实、已知范围和必须告知的结果以冻结回合为准。';
export const DEFAULT_STYLE: Readonly<StyleSemanticV1> = Object.freeze({
  genre: '互动冒险', tone: '清晰、克制', audience: '普通小说读者',
  pointOfView: 'second_person', narratorDistance: '贴近当前角色', interiority: '少量可感知心理描写',
  texture: '自然白话', syntax: '短句与中句交替', vocabulary: '准确、通俗', paragraphStructure: '短段落，动作与对话清楚分隔',
  environment: '突出当下可感知的环境', characterPresentation: '借动作与说话表现',
  characterVoice: '人物语气自然且有差异', dialogue: '简洁，结合说话动作',
  pacing: '行动优先，停顿适量', conflict: '表达紧张程度', informationReveal: '依照已提供信息组织表达',
  suspense: '节制留白', continuity: '保持称呼和语气一致', imagery: '少量具体比喻', sensory: '一至两种感官细节',
  prohibitions: Object.freeze(['避免重复修辞', '避免反复总结']), extraInstructions: '',
  verbosity: 'standard', recapPreference: '必要时一句回顾', actionPresentation: '按当前动作顺序表达',
});

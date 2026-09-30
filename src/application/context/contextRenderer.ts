/**
 * Renderer for frozen contexts (plan §18): readable 【】 sections instead of
 * one giant JSON blob. Only genuinely machine-processed ids stay inline.
 */

import type { FrozenTurnContext } from './contextSnapshot';

const BOARD_ORDER: ReadonlyArray<FrozenTurnContext['included'][number]['board']> = [
  'authority',
  'currentState',
  'worldKnowledge',
  'storyMemory',
  'recentHistory',
  'sourceEvidence',
];

const BOARD_HEADINGS: Record<string, string> = {
  authority: '【行动协议】',
  currentState: '【当前局面】',
  worldKnowledge: '【世界与人物】',
  storyMemory: '【长期故事状态】',
  recentHistory: '【最近的经历】',
  sourceEvidence: '【原著证据】',
};

export function renderFrozenContext(context: FrozenTurnContext): string {
  const sections: string[] = [];
  for (const board of BOARD_ORDER) {
    const items = context.included.filter(item => item.board === board);
    if (items.length === 0) continue;
    const body = items
      .map(item => (item.heading && items.length > 1 ? `${item.heading}｜${item.text}` : item.text))
      .join('\n');
    sections.push(`${BOARD_HEADINGS[board] ?? '【补充】'}\n${body}`);
  }
  return sections.join('\n\n');
}

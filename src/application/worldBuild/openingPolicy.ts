import type { ModelBudget } from './groupPlanner';

export const OPENING_POLICY_VERSION = 'opening-90s-3' as const;
export const OPENING_TARGET_MS = 90_000;
/** One bounded request; 10% is an upper bound, not a requirement to fill a huge model window. */
export function openingInputCodePoints(budget: ModelBudget): number {
  const safe = Math.min(Math.floor(budget.contextWindowTokens * 0.10),
    budget.contextWindowTokens - budget.maxContentOutputTokens - budget.reasoningReserveTokens - budget.reserveTokens - 1500);
  if (safe < 1) throw new Error('opening_input_budget_insufficient');
  return Math.min(6400, safe);
}
export const OPENING_EXTRACTION_FOCUS = [
  '开局专项精准阅读：只从这些授权前部正文抽取可玩起始内容所必需的人物、地点、发生的事件、时间顺序、人物关系和行动条件。',
  '优先最早可玩事件及同一时点的人物和场所，保留真实引用闭包。尽量提供24～32条不同的原子事实，但不得凑数、拆句制造事实或编造。',
  '首先完成地点与行动闭包：至少一个开局场所必须有以该地点为subject的事实和逐字quote；至少一名该场所中的人物必须有current_location事实，quote要含场所名称或别名，且确实证明该人物当时身处该处。引用可以覆盖必要的相邻原文句，不能以场景提案或事件摘要代替引用。',
  '先输出上述地点与人物所在证据，再输出人物身份、关系和其他事实。记忆、传闻中的所在地只记为事件或历史，不是当前开局地点。',
  '每个实体（包括事件提及的派系）至少一条有原文引用的事实，记录文中明确的别名。关系值使用人物名称与关系，不要复制整句作值。',
  '当前地点只在原文明示时以 current_location:{location:"已列出地点名称"} 编码，quote必须含该地点的名称或别名；不要把回忆/未来所在当作当前所在。',
  '列出实际发生的起始事件及依赖；无法证明的时序使用null，不把小说前部出现的未来信息当作开局已知。',
  '正文输出以紧凑JSON为准，保留完整逐字引用。后续世界观、远域细节和深度数值设计可以留给后续构建。',
].join('\n');

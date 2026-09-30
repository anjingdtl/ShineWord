/**
 * Candidate collection (plan §15): turns already-permission-filtered
 * material into board-shaped ContextCandidates. The collector never decides
 * visibility itself - callers pass only what the player may see.
 */

import type { ContextBoard, ContextCandidate, ContextRequirement } from './contextTypes';
import { estimateTokens } from './tokenEstimate';
import { textRelevance } from './relevance';

export interface CandidateSpec {
  id: string;
  board: ContextBoard;
  text: string;
  /** Human-readable heading used by the renderer. */
  heading?: string;
  requirement?: ContextRequirement;
  priority?: number;
  relevance?: number;
  minTokens?: number;
  targetTokens?: number;
  clipMode?: ContextCandidate['clipMode'];
  provenance?: ContextCandidate['provenance'];
}

export function buildCandidate(spec: CandidateSpec, queryText: string): ContextCandidate | null {
  const text = spec.text.trim();
  if (!text) return null;
  const estimated = estimateTokens(text);
  const relevance = spec.relevance ?? textRelevance(queryText, text);
  const mandatory = (spec.requirement ?? defaultRequirement(spec.board)) === 'mandatory';
  return {
    id: spec.id,
    board: spec.board,
    heading: spec.heading,
    text,
    estimatedTokens: estimated,
    requirement: spec.requirement ?? defaultRequirement(spec.board),
    priority: spec.priority ?? defaultPriority(spec.board),
    relevance,
    // Mandatory boards keep the whole item as their floor; everything else
    // can shrink (the allocator still protects preferred targets).
    minTokens: spec.minTokens ?? (mandatory ? estimated : 0),
    targetTokens: spec.targetTokens ?? estimated,
    clipMode: spec.clipMode ?? (spec.board === 'recentHistory' || spec.board === 'sourceEvidence'
      ? 'text'
      : 'whole_item'),
    provenance: spec.provenance ?? { sourceType: 'turn_context', sourceId: spec.id },
  };
}

function defaultRequirement(board: ContextBoard): ContextRequirement {
  return board === 'authority' || board === 'currentState' ? 'mandatory' : 'preferred';
}

function defaultPriority(board: ContextBoard): number {
  switch (board) {
    case 'authority': return 100;
    case 'currentState': return 95;
    case 'storyMemory': return 85;
    case 'worldKnowledge': return 80;
    case 'sourceEvidence': return 75;
    case 'recentHistory': return 70;
    default: return 50;
  }
}

/**
 * Maps the legacy buildWorldContext 【label】 parts onto board candidates.
 * Labels are the existing permission-filtered sections, so no visibility
 * logic is duplicated here.
 */
const LABEL_BOARDS: ReadonlyArray<{ prefix: string; board: ContextBoard; heading: string }> = [
  { prefix: '【世界】', board: 'worldKnowledge', heading: '世界设定' },
  { prefix: '【世界规则】', board: 'worldKnowledge', heading: '世界规则' },
  { prefix: '【当前位置可调查的隐藏线索引用】', board: 'worldKnowledge', heading: '可调查线索' },
  { prefix: '【可见人物】', board: 'worldKnowledge', heading: '相关人物' },
  { prefix: '【角色】', board: 'currentState', heading: '队伍' },
  { prefix: '【主目标】', board: 'currentState', heading: '当前目标' },
  { prefix: '【相关长期记忆】', board: 'storyMemory', heading: '长期故事状态' },
  { prefix: '【角色已知线索】', board: 'worldKnowledge', heading: '已知线索' },
  { prefix: '【最近的经历】', board: 'recentHistory', heading: '最近的经历' },
  { prefix: '【可用技能】', board: 'authority', heading: '可用技能' },
];

export function candidatesFromParts(
  parts: readonly string[],
  queryText: string,
): ContextCandidate[] {
  const candidates: ContextCandidate[] = [];
  let index = 0;
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const mapped = LABEL_BOARDS.find(item => trimmed.startsWith(item.prefix));
    if (mapped) {
      const candidate = buildCandidate({
        id: `part-${index}`,
        board: mapped.board,
        heading: mapped.heading,
        text: trimmed,
        provenance: { sourceType: 'world_context_part', sourceId: `part-${index}` },
      }, queryText);
      if (candidate) candidates.push(candidate);
    } else if (trimmed.startsWith('使用队伍中存在的')) {
      const candidate = buildCandidate({
        id: `authority-protocol`,
        board: 'authority',
        heading: '行动协议',
        text: trimmed,
        provenance: { sourceType: 'world_context_part', sourceId: 'authority-protocol' },
      }, queryText);
      if (candidate) candidates.push(candidate);
    }
    index += 1;
  }
  return candidates;
}

/**
 * First-version context policy defaults (infrastructure plan §13-§14).
 * Soft shares and priorities are calibration starting points, not protocol:
 * unused share always returns to the elastic pool (the allocator works off
 * real demand, not fixed percentages).
 */

import type { ContextBoard, ContextDemand, ContextRequirement } from './contextTypes';

export interface BoardPolicy {
  board: ContextBoard;
  softShare: number;
  priority: number;
  requirement: ContextRequirement;
}

export const DEFAULT_BOARD_POLICIES: readonly BoardPolicy[] = [
  { board: 'authority', softShare: 0.12, priority: 100, requirement: 'mandatory' },
  { board: 'currentState', softShare: 0.18, priority: 95, requirement: 'mandatory' },
  { board: 'worldKnowledge', softShare: 0.22, priority: 80, requirement: 'preferred' },
  { board: 'storyMemory', softShare: 0.20, priority: 85, requirement: 'preferred' },
  { board: 'recentHistory', softShare: 0.16, priority: 70, requirement: 'preferred' },
  { board: 'sourceEvidence', softShare: 0.12, priority: 75, requirement: 'optional' },
];

const POLICY_BY_BOARD = new Map(DEFAULT_BOARD_POLICIES.map(policy => [policy.board, policy]));

export function boardPolicy(board: ContextBoard): BoardPolicy {
  const policy = POLICY_BY_BOARD.get(board);
  if (!policy) throw new Error(`Unknown context board: ${board}.`);
  return policy;
}

/** Whole-item boards never character-clip their entries (plan §16). */
export const WHOLE_ITEM_BOARDS: ReadonlySet<ContextBoard> = new Set([
  'worldKnowledge',
  'storyMemory',
]);

/**
 * Builds a board-shaped demand from measured material. minTokens/targetTokens
 * default to floor=whole item, target=a board-calibrated portion of the
 * estimate; callers with concrete clip behaviour override them.
 */
export function boardDemand(input: {
  id: string;
  board: ContextBoard;
  estimatedTokens: number;
  relevance?: number;
  requirement?: ContextRequirement;
  priority?: number;
  minTokens?: number;
  targetTokens?: number;
  clipMode?: ContextDemand['clipMode'];
}): ContextDemand {
  const policy = boardPolicy(input.board);
  const estimated = Math.max(0, Math.floor(input.estimatedTokens));
  return {
    id: input.id,
    board: input.board,
    requirement: input.requirement ?? policy.requirement,
    priority: input.priority ?? policy.priority,
    relevance: Math.min(1, Math.max(0, input.relevance ?? 1)),
    estimatedTokens: estimated,
    // Mandatory floors default to the whole item (authority material is
    // unclippable); preferred/optional floors default to zero so pressure
    // can shrink them all the way down.
    minTokens: input.minTokens ?? (policy.requirement === 'mandatory' ? estimated : 0),
    targetTokens: input.targetTokens ?? estimated,
    clipMode: input.clipMode ?? (WHOLE_ITEM_BOARDS.has(input.board) ? 'whole_item' : 'text'),
  };
}

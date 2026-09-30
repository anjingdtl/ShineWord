/**
 * Context-candidate primitives shared by the elastic context planner
 * (infrastructure plan §12-§16). M1 introduces the demand/allocation shapes;
 * candidate collection, relevance and rendering arrive with M5.
 */

export type ContextBoard =
  | 'authority'
  | 'currentState'
  | 'worldKnowledge'
  | 'storyMemory'
  | 'recentHistory'
  | 'sourceEvidence';

export type ContextRequirement = 'mandatory' | 'preferred' | 'optional';

export type ContextClipMode =
  | 'none'
  | 'whole_item'
  | 'sentence'
  | 'text';

/** Board-agnostic budget demand handed to the elastic allocator. */
export interface ContextDemand {
  id: string;
  board: ContextBoard;
  /** Short human label for traces; defaults to the id. */
  label?: string;
  requirement: ContextRequirement;
  /** 0-100; higher wins allocation priority inside a requirement class. */
  priority: number;
  /** 0-1 relevance to the current turn; tie-breaks priority. */
  relevance: number;
  /** Full rendered size of the underlying material, in tokens. */
  estimatedTokens: number;
  /** Guaranteed floor under pressure; never exceeds estimatedTokens. */
  minTokens: number;
  /** Desired allocation when budget is plentiful. */
  targetTokens: number;
  /** How the renderer may cut the item when it gets less than it wants. */
  clipMode: ContextClipMode;
}

export interface ContextAllocationEntry {
  id: string;
  demanded: number;
  allocated: number;
  /** Allocation phases that contributed, in order. */
  phases: Array<'minimum' | 'target' | 'burst' | 'max'>;
  /** True when even the minimum floor could not be granted. */
  starved: boolean;
}

export interface ElasticAllocationResult {
  status: 'allocated' | 'infeasible';
  hardInputLimit: number;
  softInputLimit: number;
  burstInputLimit: number;
  totalAllocated: number;
  allocations: readonly ContextAllocationEntry[];
  /** Set when status='infeasible'. */
  infeasibleReason?: 'mandatory_exceeds_hard';
}

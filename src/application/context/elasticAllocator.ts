/**
 * Deterministic elastic context allocator (infrastructure plan §11, §16).
 *
 * Allocation order:
 *   mandatory floor -> minimum allocation -> priority x relevance fill ->
 *   burst borrowing (mandatory/preferred only) -> mandatory max-fill ->
 *   hard limit.
 *
 * Hard conditions:
 *   - sum(allocation) <= hardInputLimit
 *   - mandatory floors fit or the whole allocation is infeasible
 *   - identical inputs produce byte-identical results (stable ordering with
 *     an id tie-break; integer arithmetic only)
 */

import type {
  ContextAllocationEntry,
  ContextDemand,
  ElasticAllocationResult,
} from './contextTypes';

interface NormalizedDemand {
  demand: ContextDemand;
  /** floor = min(minTokens, estimatedTokens) - a floor never exceeds demand. */
  floor: number;
  /** target clamped into [floor, estimatedTokens]. */
  target: number;
  rank: number;
}

const REQUIREMENT_RANK: Record<ContextDemand['requirement'], number> = {
  mandatory: 0,
  preferred: 1,
  optional: 2,
};

function normalizeDemand(demand: ContextDemand): NormalizedDemand {
  if (!Number.isInteger(demand.estimatedTokens) || demand.estimatedTokens < 0) {
    throw new Error(`Context demand ${demand.id}: estimatedTokens must be a non-negative integer.`);
  }
  const floor = Math.min(Math.max(0, Math.floor(demand.minTokens)), demand.estimatedTokens);
  const target = Math.min(
    Math.max(Math.floor(demand.targetTokens), floor),
    demand.estimatedTokens,
  );
  return {
    demand,
    floor,
    target,
    rank: REQUIREMENT_RANK[demand.requirement],
  };
}

function sortDemands(items: NormalizedDemand[]): NormalizedDemand[] {
  return [...items].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.demand.priority !== b.demand.priority) return b.demand.priority - a.demand.priority;
    if (a.demand.relevance !== b.demand.relevance) return b.demand.relevance - a.demand.relevance;
    return a.demand.id < b.demand.id ? -1 : a.demand.id > b.demand.id ? 1 : 0;
  });
}

export interface ElasticAllocatorOptions {
  /** Overrides the 0.80 soft ratio (tests / explicit policy only). */
  softRatio?: number;
  /** Overrides the 0.95 burst ratio (tests / explicit policy only). */
  burstRatio?: number;
}

export function allocateElasticContext(
  demands: readonly ContextDemand[],
  hardInputLimit: number,
  options: ElasticAllocatorOptions = {},
): ElasticAllocationResult {
  if (!Number.isInteger(hardInputLimit) || hardInputLimit < 0) {
    throw new Error('allocateElasticContext requires a non-negative integer hard limit.');
  }
  const softLimit = Math.floor(hardInputLimit * (options.softRatio ?? 0.8));
  const burstLimit = Math.max(
    softLimit,
    Math.floor(hardInputLimit * (options.burstRatio ?? 0.95)),
  );

  const normalized = demands.map(normalizeDemand);
  const ordered = sortDemands(normalized);

  const allocated = new Map<string, number>();
  const phases = new Map<string, ContextAllocationEntry['phases']>();
  for (const item of ordered) {
    allocated.set(item.demand.id, 0);
    phases.set(item.demand.id, []);
  }
  let total = 0;

  const grant = (item: NormalizedDemand, tokens: number, phase: ContextAllocationEntry['phases'][number]): number => {
    if (tokens <= 0) return 0;
    allocated.set(item.demand.id, (allocated.get(item.demand.id) ?? 0) + tokens);
    phases.get(item.demand.id)?.push(phase);
    total += tokens;
    return tokens;
  };

  // Phase 1 - minimum allocation. Mandatory floors are unconditional (their
  // sum was proven feasible); preferred/optional floors are soft-gated and
  // may be deferred under pressure.
  const mandatoryFloorSum = ordered
    .filter(item => item.demand.requirement === 'mandatory')
    .reduce((sum, item) => sum + item.floor, 0);
  if (mandatoryFloorSum > hardInputLimit) {
    return {
      status: 'infeasible',
      hardInputLimit,
      softInputLimit: softLimit,
      burstInputLimit: burstLimit,
      totalAllocated: 0,
      allocations: ordered.map(item => ({
        id: item.demand.id,
        demanded: item.demand.estimatedTokens,
        allocated: 0,
        phases: [],
        starved: item.demand.requirement === 'mandatory',
      })),
      infeasibleReason: 'mandatory_exceeds_hard',
    };
  }
  for (const item of ordered) {
    if (item.floor === 0) continue;
    if (item.demand.requirement === 'mandatory') {
      grant(item, item.floor, 'minimum');
    } else if (total + item.floor <= softLimit) {
      grant(item, item.floor, 'minimum');
    }
  }

  // Phase 2 - target fill for every demand, inside the soft zone.
  for (const item of ordered) {
    const current = allocated.get(item.demand.id) ?? 0;
    const want = Math.min(item.target - current, softLimit - total);
    if (want > 0) grant(item, want, 'target');
  }

  // Phase 3 - burst borrowing: the (soft, burst] zone is reserved for
  // mandatory and preferred material; optional never borrows.
  for (const item of ordered) {
    if (item.demand.requirement === 'optional') continue;
    const current = allocated.get(item.demand.id) ?? 0;
    const want = Math.min(item.target - current, burstLimit - total);
    if (want > 0) grant(item, want, 'burst');
  }

  // Phase 4 - mandatory max-fill into the (burst, hard] zone so unclippable
  // authority material is never truncated while optional content survives.
  for (const item of ordered) {
    if (item.demand.requirement !== 'mandatory') continue;
    const current = allocated.get(item.demand.id) ?? 0;
    const want = Math.min(item.demand.estimatedTokens - current, hardInputLimit - total);
    if (want > 0) grant(item, want, 'max');
  }

  if (total > hardInputLimit) {
    // Defensive: the phased grants above are each budget-gated, so this can
    // only fire on integer-arithmetic regressions - fail loudly rather than
    // ship an over-budget context.
    throw new Error('Elastic allocator exceeded the hard limit; ordering regression.');
  }

  const allocations: ContextAllocationEntry[] = ordered.map(item => ({
    id: item.demand.id,
    demanded: item.demand.estimatedTokens,
    allocated: allocated.get(item.demand.id) ?? 0,
    phases: phases.get(item.demand.id) ?? [],
    starved: item.demand.requirement !== 'mandatory'
      && (allocated.get(item.demand.id) ?? 0) < item.floor,
  }));

  return {
    status: 'allocated',
    hardInputLimit,
    softInputLimit: softLimit,
    burstInputLimit: burstLimit,
    totalAllocated: total,
    allocations,
  };
}

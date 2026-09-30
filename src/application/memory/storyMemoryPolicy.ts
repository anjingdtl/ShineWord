/**
 * Smart-cadence memory policy (infrastructure plan §23-§24, §29).
 *
 * "When to checkpoint" and "how much per request" are separate decisions:
 * the trigger fires on interval OR meaningful narrative events; the batch
 * size is then capped and split so one request never swallows an unbounded
 * range.
 */

export type MemoryTriggerReason =
  | 'interval'
  | 'high_importance_event'
  | 'relationship_change'
  | 'conflict_open'
  | 'conflict_resolved'
  | 'quest_change'
  | 'party_change'
  | 'dirty_rebuild'
  | 'manual';

export interface MemoryCadenceInput {
  currentStateVersion: number;
  /** Memory throughStateVersion; 0/null = never built. */
  memoryThroughVersion: number;
  memoryStatus: 'empty' | 'clean' | 'dirty' | 'rebuilding' | 'failed';
  /** Signals extracted from committed turns AFTER memoryThroughVersion. */
  signals: readonly MemorySignal[];
}

export interface MemorySignal {
  kind: 'high_importance' | 'relationship_change' | 'conflict_open' | 'conflict_resolved' | 'quest_change' | 'party_change';
  stateVersion: number;
  detail?: string;
}

export interface MemoryCadenceDecision {
  shouldCheckpoint: boolean;
  reasons: MemoryTriggerReason[];
}

/** Default turn interval between checkpoints (plan §23 A). */
export const MEMORY_CHECKPOINT_INTERVAL_TURNS = 8;
/** Max committed turns folded into ONE checkpoint request (plan §24). */
export const MEMORY_MAX_BATCH_TURNS = 8;
/** Physical request cap per maintenance run (plan §11.3). */
export const MEMORY_MAX_ATTEMPTS_PER_RUN = 3;

export function evaluateMemoryCadence(input: MemoryCadenceInput): MemoryCadenceDecision {
  const reasons: MemoryTriggerReason[] = [];
  const through = input.memoryThroughVersion ?? 0;

  if (input.memoryStatus === 'dirty' || input.memoryStatus === 'rebuilding' || input.memoryStatus === 'failed') {
    reasons.push('dirty_rebuild');
  }
  if (input.currentStateVersion - through >= MEMORY_CHECKPOINT_INTERVAL_TURNS) {
    reasons.push('interval');
  }
  const signalKinds = new Set(input.signals.map(signal => signal.kind));
  if (signalKinds.has('high_importance')) reasons.push('high_importance_event');
  if (signalKinds.has('relationship_change')) reasons.push('relationship_change');
  if (signalKinds.has('conflict_open')) reasons.push('conflict_open');
  if (signalKinds.has('conflict_resolved')) reasons.push('conflict_resolved');
  if (signalKinds.has('quest_change')) reasons.push('quest_change');
  if (signalKinds.has('party_change')) reasons.push('party_change');

  // Fresh campaigns with meaningful events checkpoint early even before the
  // interval elapses; pure filler turns wait for the interval.
  const meaningful = reasons.some(reason => reason !== 'interval' && reason !== 'dirty_rebuild');
  const enoughNewTurns = input.currentStateVersion - through >= 2;
  return {
    shouldCheckpoint: reasons.includes('interval')
      || reasons.includes('dirty_rebuild')
      || (meaningful && enoughNewTurns),
    reasons,
  };
}

export type MemoryGapMode = 'clean' | 'safe_lag' | 'hard_gap';

export interface MemoryGapPlan {
  mode: MemoryGapMode;
  /** Memory coverage the planner may rely on. */
  memoryThroughVersion: number;
  /** Turns after memory coverage that bridge the gap with raw history. */
  bridgeTurns: Array<{ stateVersion: number; turnId: string }>;
}

/**
 * No-stall planner (plan §29): memory may lag while raw committed turns are
 * intact (safe_lag); missing/corrupt history in the gap is a hard_gap and the
 * caller must fail closed instead of fabricating continuity.
 */
export function planMemoryCoverage(input: {
  currentStateVersion: number;
  memoryThroughVersion: number;
  /** Committed turns available after memory coverage (sorted by version). */
  committedTurns: ReadonlyArray<{ stateVersion: number; turnId: string }>;
}): MemoryGapPlan {
  const through = Math.min(input.memoryThroughVersion, input.currentStateVersion);
  const bridge = input.committedTurns.filter(turn => turn.stateVersion > through);
  if (through >= input.currentStateVersion) {
    return { mode: 'clean', memoryThroughVersion: through, bridgeTurns: [] };
  }
  // Every version in (through, current] must exist in committed history.
  const covered = new Set(bridge.map(turn => turn.stateVersion));
  for (let version = through + 1; version <= input.currentStateVersion; version += 1) {
    if (!covered.has(version)) {
      return { mode: 'hard_gap', memoryThroughVersion: through, bridgeTurns: [] };
    }
  }
  return { mode: 'safe_lag', memoryThroughVersion: through, bridgeTurns: bridge };
}

export type MemorySignalSource = {
  stateVersion: number;
  outcomeGrade: string | null;
  effects: ReadonlyArray<{ op?: string; [key: string]: unknown }>;
};

/**
 * Deterministic signal extraction from a committed turn (no free-text
 * guessing): effect ops and outcome grade carry the structure; narrative
 * interpretation belongs to the checkpoint LLM, not to the trigger.
 */
export function extractMemorySignals(turn: MemorySignalSource): MemorySignal[] {
  const signals: MemorySignal[] = [];
  const push = (kind: MemorySignal['kind']): void => {
    signals.push({ kind, stateVersion: turn.stateVersion });
  };
  if (turn.outcomeGrade === 'critical_failure' || turn.outcomeGrade === 'full_success') {
    push('high_importance');
  }
  for (const effect of turn.effects) {
    if (!effect || typeof effect !== 'object') continue;
    switch (effect.op) {
      case 'recordEvent': {
        const eventType = String((effect as { eventType?: unknown }).eventType ?? '');
        if (eventType === 'relationship_changed') push('relationship_change');
        if (eventType.includes('quest')) push('quest_change');
        if (eventType.includes('party') || eventType.includes('death')
          || eventType.includes('join') || eventType.includes('leave')) {
          push('party_change');
        }
        break;
      }
      case 'transferItem':
        push('high_importance');
        break;
      case 'changeLocation':
      case 'consumeResource':
      case 'restoreResource':
      case 'applyCondition':
      case 'removeCondition':
      case 'advanceClock':
      case 'grantItem':
      default:
        break;
    }
  }
  return signals;
}

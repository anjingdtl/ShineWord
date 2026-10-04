import type { TurnGuidanceV1 } from '../guidance/types';

/**
 * Guidance persistence (P7 §3.8). Guidance is derived content bound to one
 * decision point: it may be replaced by a FRESH local rebuild for the same
 * decision point, but a stored record never crosses branches and never gets
 * silently mutated into a different decision point. History keeps whatever
 * was displayed; historical steps are never executable.
 */
export interface GuidanceStore {
  readonly dedupScope?: object;
  save(record: TurnGuidanceV1, now?: string): Promise<void>;
  /** Atomic replacement while the branch and the stored binding stay current. */
  replaceIfCurrent?(record: TurnGuidanceV1, expected: TurnGuidanceV1): Promise<boolean>;
  get(branchId: string, decisionPointId: string): Promise<TurnGuidanceV1 | null>;
  /** Latest guidance at or before the given state version (for UI refresh). */
  latestForVersion(branchId: string, stateVersion: number): Promise<TurnGuidanceV1 | null>;
  listAll(branchId: string): Promise<TurnGuidanceV1[]>;
}

import type { RollGrade, RollRecord } from '../../domain/rules/types';
import type { EffectOperation } from '../../domain/turns/types';
import type {
  GameStateSnapshot,
  RelationshipSnapshotEntry,
  SkillSnapshotEntry,
} from '../../domain/state/types';

export interface CommittedTurn {
  branchId: string;
  turnId: string;
  previousStateVersion: number;
  stateVersion: number;
  outcomeGrade: RollGrade;
  publicSummary: string;
  effects: EffectOperation[];
  rollRecord?: RollRecord;
  committedAt: string;
}

/**
 * Growth and relationship settlement applied inside the SAME transaction as
 * the committed turn. Phase 2 plan §13.3: growth, relationships, items and
 * quests must never settle through independent post-commit writes.
 */
export interface TurnSettlementPlan {
  encounterId: string;
  skillUpserts: Array<SkillSnapshotEntry & { stateVersion: number }>;
  /** Hard dedup rows; an existing row aborts the commit (double reward). */
  rewardLedger: Array<{
    encounterId: string;
    actorId: string;
    skillId: string;
    rewardKind: 'practice' | 'milestone';
  }>;
  relationships: RelationshipSnapshotEntry[];
  /** Engine-side loot grants (encounter end); applied before the snapshot. */
  loot?: Array<{ itemId: string; actorId: string }>;
}

export interface AtomicCommitInput {
  branchId: string;
  turnId: string;
  expectedStateVersion: number;
  nextState: GameStateSnapshot;
  actionContractJson: string;
  actionContractHash: string;
  committedTurn: CommittedTurn;
  settlement?: TurnSettlementPlan;
}

export interface TurnStore {
  getState(branchId: string): Promise<GameStateSnapshot | null>;
  getCommittedTurn(branchId: string, turnId: string): Promise<CommittedTurn | null>;
  commitAtomic(input: AtomicCommitInput): Promise<CommittedTurn>;
  /**
   * Discards an UNRESOLVED staged turn that has no persisted roll. A refused
   * planner proposal (unknown skill, failed qualification) may be abandoned
   * cleanly - no dice existed, so nothing is re-rolled. Committed turns and
   * turns with persisted rolls can never be discarded.
   */
  discardUnrolledTurn(branchId: string, turnId: string): Promise<boolean>;
}

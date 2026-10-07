import type { RollGrade, RollRecord } from '../../domain/rules/types';
import type { EffectOperation } from '../../domain/turns/types';
import type {
  GameStateSnapshot,
  PartySnapshotEntry,
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
  /**
   * Card projections updated in the SAME transaction (training, equipment,
   * ability preparation). The card lands in actor_cards and in the snapshot
   * stamped by this commit (P2 acceptance A02/A03).
   */
  cardUpserts?: Array<{ actorId: string; card: unknown }>;
  /** Remove temporary projections in the same commit that ends an encounter. */
  cardDeletes?: string[];
  /** Explicit party lifecycle changes share the turn transaction and snapshot. */
  partyUpserts?: PartySnapshotEntry[];
  partyDeletes?: string[];
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
  /** Optional cross-branch operation fence checked inside the same SQLite transaction. */
  coordinationFence?: { campaignId: string; fenceToken: number };
  settlement?: TurnSettlementPlan;
  /** Additional engine events produced by authoritative projections in this transaction. */
  events?: Array<{ eventType: string; payload: unknown }>;
  /** Fenced management changes must share the state/event/outbox transaction. */
  transactionChanges?: (tx: import('./sqlite').SqliteTransaction) => Promise<void>;
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

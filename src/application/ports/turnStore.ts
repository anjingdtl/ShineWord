import type { RollGrade, RollRecord } from '../../domain/rules/types';
import type { EffectOperation } from '../../domain/turns/types';
import type { GameStateSnapshot } from '../../domain/state/types';

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

export interface AtomicCommitInput {
  branchId: string;
  turnId: string;
  expectedStateVersion: number;
  nextState: GameStateSnapshot;
  actionContractJson: string;
  actionContractHash: string;
  committedTurn: CommittedTurn;
}

export interface TurnStore {
  getState(branchId: string): Promise<GameStateSnapshot | null>;
  getCommittedTurn(branchId: string, turnId: string): Promise<CommittedTurn | null>;
  commitAtomic(input: AtomicCommitInput): Promise<CommittedTurn>;
}

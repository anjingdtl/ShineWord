import type { RollRecord, RollSpec } from '../../domain/rules/types';
import type { RandomSource } from '../../domain/rules/random';
import type { TurnState } from '../../domain/turns/types';

export type StagedTurnStatus = 'Planned' | 'AwaitRoll' | 'Resolved' | 'Narrated' | 'Validated' | 'Repair' | 'Paused';

export interface StageRollTurnInput {
  branchId: string;
  turnId: string;
  expectedStateVersion: number;
  actionContractJson: string;
  actionContractHash: string;
  createdAt: string;
  status?: StagedTurnStatus;
}

export interface StagedTurnRecord {
  branchId: string;
  turnId: string;
  expectedStateVersion: number;
  actionContractJson: string;
  actionContractHash: string;
  createdAt: string;
  status: TurnState;
}

export interface TurnRollJournal {
  stageRollTurn(input: StageRollTurnInput): Promise<void>;
  getStagedTurn(branchId: string, turnId: string): Promise<StagedTurnRecord | null>;
  getRollRecord(branchId: string, turnId: string, rollIndex: number): Promise<RollRecord | null>;
  recordRoll(branchId: string, record: RollRecord): Promise<RollRecord>;
}

export interface ResolveOrReuseRollInput {
  journal: TurnRollJournal;
  branchId: string;
  turnId: string;
  expectedStateVersion: number;
  actionContractJson: string;
  actionContractHash: string;
  spec: RollSpec;
  random: RandomSource;
  rollIndex?: number;
  createdAt?: string;
}

import type { RollRecord, RollSpec } from '../../domain/rules/types';
import type { RandomSource } from '../../domain/rules/random';

export interface StageRollTurnInput {
  branchId: string;
  turnId: string;
  expectedStateVersion: number;
  actionContractJson: string;
  actionContractHash: string;
  createdAt: string;
}

export interface TurnRollJournal {
  stageRollTurn(input: StageRollTurnInput): Promise<void>;
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

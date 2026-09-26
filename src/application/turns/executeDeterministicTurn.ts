import type { RandomSource } from '../../domain/rules/random';
import type { RollRecord, RollSpec } from '../../domain/rules/types';
import {
  hashActionContract,
  serializeActionContract,
  type Sha256HexProvider,
} from '../../domain/turns/canonical';
import type { ActionContract } from '../../domain/turns/types';
import type { TurnRollJournal } from '../ports/turnRollJournal';
import type { CommittedTurn, TurnStore } from '../ports/turnStore';
import { commitResolvedTurn } from './commitTurn';
import { resolveOrReuseRoll } from './resolveOrReuseRoll';

export interface ExecuteDeterministicTurnInput {
  store: TurnStore;
  journal?: TurnRollJournal;
  branchId: string;
  contract: ActionContract;
  hashProvider: Sha256HexProvider;
  rollSpec?: RollSpec;
  random?: RandomSource;
  rollCreatedAt?: string;
  committedAt?: string;
}

export interface ExecuteDeterministicTurnResult {
  contractHash: string;
  rollRecord?: RollRecord;
  rollReused: boolean;
  committedTurn: CommittedTurn;
  commitReplayed: boolean;
}

export async function executeDeterministicTurn({
  store,
  journal,
  branchId,
  contract,
  hashProvider,
  rollSpec,
  random,
  rollCreatedAt,
  committedAt,
}: ExecuteDeterministicTurnInput): Promise<ExecuteDeterministicTurnResult> {
  const contractHash = await hashActionContract(contract, hashProvider);

  let rollRecord: RollRecord | undefined;
  let rollReused = false;
  let outcomeGrade: RollRecord['grade'] = 'success';

  if (contract.requiresRoll) {
    if (!journal) throw new Error('A roll journal is required for risk actions.');
    if (!rollSpec) throw new Error('rollSpec is required for risk actions.');
    if (!random) throw new Error('random is required for risk actions.');

    const resolved = await resolveOrReuseRoll({
      journal,
      branchId,
      turnId: contract.turnId,
      expectedStateVersion: contract.expectedStateVersion,
      actionContractJson: serializeActionContract(contract),
      actionContractHash: contractHash,
      spec: rollSpec,
      random,
      createdAt: rollCreatedAt,
    });
    rollRecord = resolved.rollRecord;
    rollReused = resolved.reused;
    outcomeGrade = rollRecord.grade;
  }

  const committed = await commitResolvedTurn({
    store,
    branchId,
    contract,
    contractHash,
    outcomeGrade,
    rollRecord,
    committedAt,
  });

  return {
    contractHash,
    rollRecord,
    rollReused,
    committedTurn: committed.committedTurn,
    commitReplayed: committed.replayed,
  };
}

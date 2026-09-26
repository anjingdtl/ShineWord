import { resolveRoll } from '../../domain/rules/roll';
import type { RollRecord } from '../../domain/rules/types';
import type { ResolveOrReuseRollInput } from '../ports/turnRollJournal';

export interface ResolveOrReuseRollResult {
  rollRecord: RollRecord;
  reused: boolean;
}

export async function resolveOrReuseRoll({
  journal,
  branchId,
  turnId,
  expectedStateVersion,
  actionContractJson,
  actionContractHash,
  spec,
  random,
  rollIndex = 0,
  createdAt = new Date().toISOString(),
}: ResolveOrReuseRollInput): Promise<ResolveOrReuseRollResult> {
  await journal.stageRollTurn({
    branchId,
    turnId,
    expectedStateVersion,
    actionContractJson,
    actionContractHash,
    createdAt,
  });

  const existing = await journal.getRollRecord(branchId, turnId, rollIndex);
  if (existing) {
    if (existing.contractHash !== actionContractHash) {
      throw new Error('Persisted roll contractHash mismatch.');
    }
    return { rollRecord: existing, reused: true };
  }

  const candidate = resolveRoll({
    turnId,
    rollIndex,
    contractHash: actionContractHash,
    spec,
    random,
    createdAt,
  });

  const stored = await journal.recordRoll(branchId, candidate);
  if (stored.contractHash !== actionContractHash) {
    throw new Error('Stored roll contractHash mismatch.');
  }
  return {
    rollRecord: stored,
    reused: stored.createdAt !== candidate.createdAt || stored.rolls.join(',') !== candidate.rolls.join(','),
  };
}

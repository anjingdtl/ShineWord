import type { RollGrade, RollRecord } from '../../domain/rules/types';
import { applyEffects, assertResourcePreconditions } from '../../domain/state/effects';
import { assertValidActionContract } from '../../domain/turns/contracts';
import { serializeActionContract } from '../../domain/turns/canonical';
import type { ActionContract } from '../../domain/turns/types';
import type { CommittedTurn, TurnStore, TurnSettlementPlan } from '../ports/turnStore';

export interface CommitResolvedTurnInput {
  store: TurnStore;
  branchId: string;
  contract: ActionContract;
  contractHash: string;
  outcomeGrade: RollGrade;
  rollRecord?: RollRecord;
  /**
   * Growth/relationship settlement committed in the same transaction. Must be
   * computed from the CURRENT progress state before this call; the store
   * enforces ledger dedup so a replayed encounter cannot double-award.
   */
  settlement?: TurnSettlementPlan;
  /** Domain-specific authoritative projection changes applied before the same snapshot is committed. */
  updateNextState?: (nextState: import('../../domain/state/types').GameStateSnapshot) => void;
  /** Additional domain state and event projections produced by this exact action. */
  applyAuthoritativeState?: (
    nextState: import('../../domain/state/types').GameStateSnapshot,
  ) => Array<{ eventType: string; payload: unknown }> | void;
  events?: Array<{ eventType: string; payload: unknown }>;
  /** 'engine' contracts are local-built (rest/training) and may carry caps. */
  contractOrigin?: 'planner' | 'engine';
  committedAt?: string;
}

export interface CommitResolvedTurnResult {
  committedTurn: CommittedTurn;
  replayed: boolean;
}

export async function commitResolvedTurn({
  store,
  branchId,
  contract,
  contractHash,
  outcomeGrade,
  rollRecord,
  settlement,
  updateNextState,
  applyAuthoritativeState,
  events,
  contractOrigin = 'planner',
  committedAt = new Date().toISOString(),
}: CommitResolvedTurnInput): Promise<CommitResolvedTurnResult> {
  assertValidActionContract(contract, contractOrigin);

  const existing = await store.getCommittedTurn(branchId, contract.turnId);
  if (existing) {
    return { committedTurn: existing, replayed: true };
  }

  const state = await store.getState(branchId);
  if (!state) throw new Error(`Unknown branch: ${branchId}.`);
  if (state.stateVersion !== contract.expectedStateVersion) {
    throw new Error(
      `State version mismatch: expected ${contract.expectedStateVersion}, ` +
        `actual ${state.stateVersion}.`,
    );
  }

  if (contract.requiresRoll) {
    if (!rollRecord) throw new Error('A roll record is required for this action.');
    if (rollRecord.turnId !== contract.turnId) throw new Error('Roll turnId mismatch.');
    if (rollRecord.contractHash !== contractHash) throw new Error('Roll contractHash mismatch.');
    if (rollRecord.grade !== outcomeGrade) throw new Error('Roll grade does not match outcomeGrade.');
  } else if (rollRecord) {
    throw new Error('Automatic action must not attach a roll record.');
  }

  assertResourcePreconditions(state, contract.resourcePreconditions);
  const outcome = contract.outcomes[outcomeGrade];
  const nextState = applyEffects(state, outcome.effects, contract.timeCostMinutes);
  updateNextState?.(nextState);
  const domainEvents = applyAuthoritativeState?.(nextState) ?? [];
  nextState.stateVersion = state.stateVersion + 1;

  const committedTurn: CommittedTurn = {
    branchId,
    turnId: contract.turnId,
    previousStateVersion: state.stateVersion,
    stateVersion: nextState.stateVersion,
    outcomeGrade,
    publicSummary: outcome.publicSummary,
    effects: outcome.effects.map(effect => ({ ...effect })),
    rollRecord,
    committedAt,
  };

  const stored = await store.commitAtomic({
    branchId,
    turnId: contract.turnId,
    expectedStateVersion: state.stateVersion,
    nextState,
    actionContractJson: serializeActionContract(contract),
    actionContractHash: contractHash,
    committedTurn,
    settlement,
    events: [...(events ?? []), ...domainEvents],
  });

  return { committedTurn: stored, replayed: false };
}

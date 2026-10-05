import type { RollGrade, RollRecord } from '../../domain/rules/types';
import { applyEffects, assertResourcePreconditions } from '../../domain/state/effects';
import { assertValidActionContract } from '../../domain/turns/contracts';
import { serializeActionContract } from '../../domain/turns/canonical';
import type { ActionContract } from '../../domain/turns/types';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { CommittedTurn, TurnStore, TurnSettlementPlan } from '../ports/turnStore';
import { assertRuleAction, requireCompiledRules } from '../content/runtimeRules';
import { stableFingerprint } from '../llm/requestPlan';

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
  coordinationFence?: { campaignId: string; fenceToken: number };
  committedAt?: string;
}

export interface CommitResolvedTurnResult {
  committedTurn: CommittedTurn;
  replayed: boolean;
}

export interface ReducedTurnResolution {
  /** Fully reduced next state with the version already advanced by one. */
  nextState: GameStateSnapshot;
  committedTurn: CommittedTurn;
  domainEvents: Array<{ eventType: string; payload: unknown }>;
  lifeEvents: Array<{ eventType: string; payload: unknown }>;
}

export interface ReduceTurnResolutionInput {
  state: GameStateSnapshot;
  contract: ActionContract;
  contractHash: string;
  outcomeGrade: RollGrade;
  rollRecord?: RollRecord;
  updateNextState?: (nextState: GameStateSnapshot) => void;
  applyAuthoritativeState?: (
    nextState: GameStateSnapshot,
  ) => Array<{ eventType: string; payload: unknown }> | void;
  events?: Array<{ eventType: string; payload: unknown }>;
  contractOrigin?: 'planner' | 'engine';
  committedAt?: string;
}

/**
 * The single deterministic turn reduction shared by the immediate commit
 * path (commitResolvedTurn) and the P7 prepared path (prepareTurnResolution).
 * It never writes: state reduction, authoritative projections and life-event
 * derivation happen on an applyEffects clone, so preparing guidance before
 * the Narrator and committing after it cannot diverge (plan §8.2).
 */
export function reduceTurnResolution(input: ReduceTurnResolutionInput): ReducedTurnResolution {
  const { state, contract, contractHash, outcomeGrade, rollRecord } = input;
  assertValidActionContract(contract, input.contractOrigin ?? 'planner');
  assertRuleAction(state, contract.actionType, contract.actorId);
  if (state.ruleConfiguration) {
    const binding = requireCompiledRules(state.ruleConfiguration).binding;
    if (!contract.ruleBinding || stableFingerprint(contract.ruleBinding) !== stableFingerprint(binding)) throw new Error('Action contract does not match the locked rule binding.');
  }
  if (contract.contentDependency && contract.contentDependency.branchId !== state.branchId) {
    throw new Error('Frozen content dependency belongs to a different campaign branch.');
  }
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
  input.updateNextState?.(nextState);
  const domainEvents = input.applyAuthoritativeState?.(nextState) ?? [];
  const lifeEvents: Array<{ eventType: string; payload: unknown }> = [];
  const actorIds = new Set([...Object.keys(state.actors), ...Object.keys(nextState.actors)]);
  for (const actorId of actorIds) {
    const before = state.actors[actorId];
    const after = nextState.actors[actorId];
    if (!after) continue;
    const beforeStatus = before?.lifeStatus ?? ((before?.resources.hp ?? 1) <= 0 ? 'critical' : 'active');
    const afterStatus = after.lifeStatus ?? ((after.resources.hp ?? 1) <= 0 ? 'critical' : 'active');
    if (beforeStatus !== 'critical' && afterStatus === 'critical') {
      lifeEvents.push({ eventType: 'actor_entered_critical_state', payload: {
        actorId, actionType: contract.actionType, sourceTurnId: contract.turnId,
      } });
    } else if (beforeStatus === 'critical' && afterStatus === 'active') {
      lifeEvents.push({ eventType: 'actor_recovered_from_critical', payload: {
        actorId, actionType: contract.actionType, sourceTurnId: contract.turnId,
      } });
    } else if (beforeStatus !== 'dead' && afterStatus === 'dead') {
      lifeEvents.push({ eventType: 'actor_death_resolved', payload: {
        actorId, actionType: contract.actionType, sourceTurnId: contract.turnId,
      } });
    }
  }
  nextState.stateVersion = state.stateVersion + 1;

  const committedTurn: CommittedTurn = {
    branchId: state.branchId,
    turnId: contract.turnId,
    previousStateVersion: state.stateVersion,
    stateVersion: nextState.stateVersion,
    outcomeGrade,
    publicSummary: outcome.publicSummary,
    effects: outcome.effects.map(effect => ({ ...effect })),
    rollRecord,
    committedAt: input.committedAt ?? new Date().toISOString(),
  };
  return {
    nextState,
    committedTurn,
    domainEvents,
    lifeEvents,
  };
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
  coordinationFence,
  committedAt = new Date().toISOString(),
}: CommitResolvedTurnInput): Promise<CommitResolvedTurnResult> {
  const existing = await store.getCommittedTurn(branchId, contract.turnId);
  if (existing) {
    return { committedTurn: existing, replayed: true };
  }

  const state = await store.getState(branchId);
  if (!state) throw new Error(`Unknown branch: ${branchId}.`);

  const reduced = reduceTurnResolution({
    state,
    contract,
    contractHash,
    outcomeGrade,
    rollRecord,
    updateNextState,
    applyAuthoritativeState,
    events,
    contractOrigin,
    committedAt,
  });

  const stored = await store.commitAtomic({
    branchId,
    turnId: contract.turnId,
    expectedStateVersion: state.stateVersion,
    nextState: reduced.nextState,
    actionContractJson: serializeActionContract(contract),
    actionContractHash: contractHash,
    committedTurn: reduced.committedTurn,
    coordinationFence,
    settlement,
    events: [...(events ?? []), ...reduced.domainEvents, ...reduced.lifeEvents],
  });

  return { committedTurn: stored, replayed: false };
}

export interface CommitPreparedTurnInput {
  store: TurnStore;
  prepared: PreparedTurnResolution;
  coordinationFence?: { campaignId: string; fenceToken: number };
}

export interface PreparedTurnResolutionInput {
  branchId: string;
  contract: ActionContract;
  contractHash: string;
  outcomeGrade: RollGrade;
  rollRecord?: RollRecord;
  settlement?: TurnSettlementPlan;
  updateNextState?: (nextState: GameStateSnapshot) => void;
  applyAuthoritativeState?: (
    nextState: GameStateSnapshot,
  ) => Array<{ eventType: string; payload: unknown }> | void;
  events?: Array<{ eventType: string; payload: unknown }>;
  contractOrigin?: 'planner' | 'engine';
  committedAt?: string;
}

export interface PreparedTurnResolution {
  branchId: string;
  contract: ActionContract;
  contractHash: string;
  outcomeGrade: RollGrade;
  rollRecord?: RollRecord;
  settlement?: TurnSettlementPlan;
  nextState: GameStateSnapshot;
  committedTurn: CommittedTurn;
  domainEvents: Array<{ eventType: string; payload: unknown }>;
  lifeEvents: Array<{ eventType: string; payload: unknown }>;
  extraEvents: Array<{ eventType: string; payload: unknown }>;
}

/**
 * Prepare the FULL turn resolution before the Narrator runs (plan §8.2):
 * deterministic reduction over the current state with all authoritative
 * projections applied, nothing written. The commit path later applies this
 * exact object — the same reduction never runs twice with live effects.
 * Recovery: recomputable from the frozen contract + persisted roll + bound
 * rules; dice are never re-rolled.
 */
export async function prepareTurnResolution(
  store: TurnStore,
  input: PreparedTurnResolutionInput,
): Promise<PreparedTurnResolution> {
  const state = await store.getState(input.branchId);
  if (!state) throw new Error(`Unknown branch: ${input.branchId}.`);
  const reduced = reduceTurnResolution({
    state,
    contract: input.contract,
    contractHash: input.contractHash,
    outcomeGrade: input.outcomeGrade,
    rollRecord: input.rollRecord,
    updateNextState: input.updateNextState,
    applyAuthoritativeState: input.applyAuthoritativeState,
    events: input.events,
    contractOrigin: input.contractOrigin,
    committedAt: input.committedAt,
  });
  return {
    branchId: input.branchId,
    contract: input.contract,
    contractHash: input.contractHash,
    outcomeGrade: input.outcomeGrade,
    rollRecord: input.rollRecord,
    settlement: input.settlement,
    nextState: reduced.nextState,
    committedTurn: reduced.committedTurn,
    domainEvents: reduced.domainEvents,
    lifeEvents: reduced.lifeEvents,
    extraEvents: input.events ?? [],
  };
}

/**
 * Commit an already prepared resolution object verbatim. The store's atomic
 * transaction re-checks the stateVersion CAS and the coordination fence; the
 * prepared nextState is applied as-is (no second reduction).
 */
export async function commitPreparedTurn({
  store,
  prepared,
  coordinationFence,
}: CommitPreparedTurnInput): Promise<CommitResolvedTurnResult> {
  const { contract } = prepared;
  const existing = await store.getCommittedTurn(prepared.branchId, contract.turnId);
  if (existing) {
    return { committedTurn: existing, replayed: true };
  }
  const stored = await store.commitAtomic({
    branchId: prepared.branchId,
    turnId: contract.turnId,
    expectedStateVersion: contract.expectedStateVersion,
    nextState: prepared.nextState,
    actionContractJson: serializeActionContract(contract),
    actionContractHash: prepared.contractHash,
    committedTurn: prepared.committedTurn,
    coordinationFence,
    settlement: prepared.settlement,
    events: [...prepared.extraEvents, ...prepared.domainEvents, ...prepared.lifeEvents],
  });
  return { committedTurn: stored, replayed: false };
}

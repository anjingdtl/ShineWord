import type {
  AtomicCommitInput,
  CommittedTurn,
  TurnStore,
} from '../../application/ports/turnStore';
import { cloneGameState, type GameStateSnapshot } from '../../domain/state/types';

interface StagedTurnMemory {
  expectedStateVersion: number;
  hasRoll: boolean;
}

export class InMemoryTurnStore implements TurnStore {
  private readonly states = new Map<string, GameStateSnapshot>();
  private readonly turns = new Map<string, CommittedTurn>();
  private readonly staged = new Map<string, StagedTurnMemory>();

  constructor(initialStates: readonly GameStateSnapshot[]) {
    for (const state of initialStates) {
      this.states.set(state.branchId, cloneGameState(state));
    }
  }

  /** Test helper mirroring stageRollTurn; tracks roll existence for discard rules. */
  stageTurnForTest(branchId: string, turnId: string, expectedStateVersion: number, hasRoll = false): void {
    this.staged.set(`${branchId}:${turnId}`, { expectedStateVersion, hasRoll });
  }

  async getState(branchId: string): Promise<GameStateSnapshot | null> {
    const state = this.states.get(branchId);
    return state ? cloneGameState(state) : null;
  }

  async getCommittedTurn(branchId: string, turnId: string): Promise<CommittedTurn | null> {
    return this.turns.get(`${branchId}:${turnId}`) ?? null;
  }

  async discardUnrolledTurn(branchId: string, turnId: string): Promise<boolean> {
    const key = `${branchId}:${turnId}`;
    if (this.turns.has(key)) throw new Error('Cannot discard a committed turn.');
    const staged = this.staged.get(key);
    if (!staged) return false;
    if (staged.hasRoll) {
      throw new Error('Cannot discard a turn with a persisted roll; resume it instead.');
    }
    this.staged.delete(key);
    return true;
  }

  async commitAtomic(input: AtomicCommitInput): Promise<CommittedTurn> {
    const key = `${input.branchId}:${input.turnId}`;
    const priorTurn = this.turns.get(key);
    if (priorTurn) return priorTurn;

    const current = this.states.get(input.branchId);
    if (!current) throw new Error(`Unknown branch: ${input.branchId}.`);
    if (current.stateVersion !== input.expectedStateVersion) {
      throw new Error(
        `Atomic commit conflict: expected stateVersion ${input.expectedStateVersion}, ` +
          `actual ${current.stateVersion}.`,
      );
    }
    if (input.nextState.branchId !== input.branchId) {
      throw new Error('Atomic commit cannot move a state to another branch.');
    }
    if (input.nextState.stateVersion !== input.expectedStateVersion + 1) {
      throw new Error('Atomic commit must advance stateVersion exactly once.');
    }

    this.states.set(input.branchId, cloneGameState(input.nextState));
    this.turns.set(key, input.committedTurn);
    return input.committedTurn;
  }
}

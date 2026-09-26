import type {
  AtomicCommitInput,
  CommittedTurn,
  TurnStore,
} from '../../application/ports/turnStore';
import type { SqliteDatabase, SqliteRow, SqliteTransaction } from '../../application/ports/sqlite';
import { cloneGameState, type GameStateSnapshot } from '../../domain/state/types';
import type { EffectOperation } from '../../domain/turns/types';
import type { RollRecord } from '../../domain/rules/types';

interface BranchRow extends SqliteRow {
  branch_id: string;
  state_version: number;
}

interface ActorRow extends SqliteRow {
  actor_id: string;
  location_id: string;
  resources_json: string;
  conditions_json: string;
}

interface InventoryRow extends SqliteRow {
  item_id: string;
  owner_actor_id: string;
}

interface TurnRow extends SqliteRow {
  branch_id: string;
  turn_id: string;
  expected_state_version: number;
  committed_state_version: number;
  outcome_grade: string;
  public_summary: string;
  effects_json: string;
  committed_at: string;
}

interface RollRow extends SqliteRow {
  ruleset_id: string;
  ruleset_version: string;
  turn_id: string;
  roll_index: number;
  contract_hash: string;
  dice_count: number;
  die_sides: number;
  rolls_json: string;
  highest: number;
  difficulty: number;
  margin: number;
  grade: string;
  created_at: string;
}

function parseJson<T>(raw: string, field: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Invalid JSON stored in ${field}.`);
  }
}

function requireString(row: SqliteRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Expected string column ${key}.`);
  return value;
}

function requireNumber(row: SqliteRow, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected numeric column ${key}.`);
  }
  return value;
}

export class SqliteTurnStore implements TurnStore {
  constructor(private readonly db: SqliteDatabase) {}

  async getState(branchId: string): Promise<GameStateSnapshot | null> {
    return this.readState(this.db, branchId);
  }

  async getCommittedTurn(branchId: string, turnId: string): Promise<CommittedTurn | null> {
    return this.readCommittedTurn(this.db, branchId, turnId);
  }

  async commitAtomic(input: AtomicCommitInput): Promise<CommittedTurn> {
    return this.db.transaction(async tx => {
      const existing = await this.readCommittedTurn(tx, input.branchId, input.turnId);
      if (existing) return existing;

      const branch = await tx.queryOne<BranchRow>(
        'SELECT branch_id, state_version FROM branches WHERE branch_id = ?',
        [input.branchId],
      );
      if (!branch) throw new Error(`Unknown branch: ${input.branchId}.`);
      if (branch.state_version !== input.expectedStateVersion) {
        throw new Error(
          `Atomic commit conflict: expected stateVersion ${input.expectedStateVersion}, actual ${branch.state_version}.`,
        );
      }
      if (input.nextState.branchId !== input.branchId) {
        throw new Error('Atomic commit cannot move a state to another branch.');
      }
      if (input.nextState.stateVersion !== input.expectedStateVersion + 1) {
        throw new Error('Atomic commit must advance stateVersion exactly once.');
      }

      await this.persistState(tx, input.nextState, input.expectedStateVersion, input.committedTurn.committedAt);
      await this.persistCommittedTurn(tx, input);
      return input.committedTurn;
    });
  }

  private async readState(
    db: Pick<SqliteDatabase, 'queryOne' | 'queryAll'> | Pick<SqliteTransaction, 'queryOne' | 'queryAll'>,
    branchId: string,
  ): Promise<GameStateSnapshot | null> {
    const branch = await db.queryOne<BranchRow>(
      'SELECT branch_id, state_version FROM branches WHERE branch_id = ?',
      [branchId],
    );
    if (!branch) return null;

    const actors = await db.queryAll<ActorRow>(
      'SELECT actor_id, location_id, resources_json, conditions_json FROM actor_states WHERE branch_id = ? ORDER BY actor_id',
      [branchId],
    );
    const inventory = await db.queryAll<InventoryRow>(
      'SELECT item_id, owner_actor_id FROM inventory WHERE branch_id = ? ORDER BY item_id',
      [branchId],
    );
    const snapshot = await db.queryOne<SqliteRow>(
      'SELECT snapshot_json FROM snapshots WHERE branch_id = ? AND state_version = ?',
      [branchId, branch.state_version],
    );
    const clockMinutes = snapshot
      ? requireNumber(parseJson<SqliteRow>(requireString(snapshot, 'snapshot_json'), 'snapshots.snapshot_json'), 'clockMinutes')
      : 0;

    const state: GameStateSnapshot = {
      branchId,
      stateVersion: branch.state_version,
      clockMinutes,
      actors: {},
      itemOwners: {},
    };
    for (const row of actors) {
      state.actors[row.actor_id] = {
        actorId: row.actor_id,
        locationId: row.location_id,
        resources: parseJson<Record<string, number>>(row.resources_json, 'actor_states.resources_json'),
        conditions: parseJson<string[]>(row.conditions_json, 'actor_states.conditions_json'),
      };
    }
    for (const row of inventory) state.itemOwners[row.item_id] = row.owner_actor_id;
    return cloneGameState(state);
  }

  private async readCommittedTurn(
    db: Pick<SqliteDatabase, 'queryOne'> | Pick<SqliteTransaction, 'queryOne'>,
    branchId: string,
    turnId: string,
  ): Promise<CommittedTurn | null> {
    const row = await db.queryOne<TurnRow>(
      `SELECT branch_id, turn_id, expected_state_version, committed_state_version,
              outcome_grade, public_summary, effects_json, committed_at
         FROM turns
        WHERE branch_id = ? AND turn_id = ? AND status = 'Committed'`,
      [branchId, turnId],
    );
    if (!row) return null;
    const roll = await db.queryOne<RollRow>(
      `SELECT ruleset_id, ruleset_version, turn_id, roll_index, contract_hash, dice_count,
              die_sides, rolls_json, highest, difficulty, margin, grade, created_at
         FROM roll_records
        WHERE branch_id = ? AND turn_id = ? AND roll_index = 0`,
      [branchId, turnId],
    );
    const committed: CommittedTurn = {
      branchId: row.branch_id,
      turnId: row.turn_id,
      previousStateVersion: row.expected_state_version,
      stateVersion: row.committed_state_version,
      outcomeGrade: row.outcome_grade as CommittedTurn['outcomeGrade'],
      publicSummary: row.public_summary,
      effects: parseJson<EffectOperation[]>(row.effects_json, 'turns.effects_json'),
      committedAt: row.committed_at,
    };
    if (roll) {
      committed.rollRecord = {
        rulesetId: roll.ruleset_id,
        rulesetVersion: roll.ruleset_version,
        turnId: roll.turn_id,
        rollIndex: roll.roll_index,
        contractHash: roll.contract_hash,
        diceCount: roll.dice_count,
        dieSides: roll.die_sides as RollRecord['dieSides'],
        rolls: parseJson<number[]>(roll.rolls_json, 'roll_records.rolls_json'),
        highest: roll.highest,
        difficulty: roll.difficulty,
        margin: roll.margin,
        grade: roll.grade as RollRecord['grade'],
        createdAt: roll.created_at,
      };
    }
    return committed;
  }

  private async persistState(
    tx: SqliteTransaction,
    state: GameStateSnapshot,
    expectedStateVersion: number,
    committedAt: string,
  ): Promise<void> {
    await tx.execute(
      'UPDATE branches SET state_version = ? WHERE branch_id = ? AND state_version = ?',
      [state.stateVersion, state.branchId, expectedStateVersion],
    );
    const branch = await tx.queryOne<BranchRow>(
      'SELECT branch_id, state_version FROM branches WHERE branch_id = ?',
      [state.branchId],
    );
    if (!branch || branch.state_version !== state.stateVersion) {
      throw new Error('Atomic branch version update failed.');
    }

    await tx.execute('DELETE FROM actor_states WHERE branch_id = ?', [state.branchId]);
    for (const actor of Object.values(state.actors)) {
      await tx.execute(
        `INSERT INTO actor_states
          (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          state.branchId,
          actor.actorId,
          state.stateVersion,
          actor.locationId,
          JSON.stringify(actor.resources),
          JSON.stringify(actor.conditions),
        ],
      );
    }

    await tx.execute('DELETE FROM inventory WHERE branch_id = ?', [state.branchId]);
    for (const [itemId, ownerActorId] of Object.entries(state.itemOwners)) {
      await tx.execute(
        'INSERT INTO inventory (branch_id, item_id, owner_actor_id, state_version) VALUES (?, ?, ?, ?)',
        [state.branchId, itemId, ownerActorId, state.stateVersion],
      );
    }

    const serialized = JSON.stringify(state);
    await tx.execute(
      `INSERT INTO snapshots (branch_id, state_version, snapshot_json, state_hash, created_at)
       VALUES (?, ?, ?, NULL, ?)`,
      [state.branchId, state.stateVersion, serialized, committedAt],
    );
  }

  private async persistCommittedTurn(tx: SqliteTransaction, input: AtomicCommitInput): Promise<void> {
    const turn = input.committedTurn;
    await tx.execute(
      `INSERT INTO turns
        (branch_id, turn_id, status, expected_state_version, committed_state_version,
         action_contract_json, action_contract_hash, outcome_grade, public_summary,
         effects_json, created_at, committed_at)
       VALUES (?, ?, 'Committed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        turn.branchId,
        turn.turnId,
        turn.previousStateVersion,
        turn.stateVersion,
        input.actionContractJson,
        input.actionContractHash,
        turn.outcomeGrade,
        turn.publicSummary,
        JSON.stringify(turn.effects),
        turn.committedAt,
        turn.committedAt,
      ],
    );

    if (turn.rollRecord) {
      const roll = turn.rollRecord;
      await tx.execute(
        `INSERT INTO roll_records
          (branch_id, turn_id, roll_index, ruleset_id, ruleset_version, contract_hash,
           dice_count, die_sides, rolls_json, highest, difficulty, margin, grade, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          turn.branchId,
          turn.turnId,
          roll.rollIndex,
          roll.rulesetId,
          roll.rulesetVersion,
          roll.contractHash,
          roll.diceCount,
          roll.dieSides,
          JSON.stringify(roll.rolls),
          roll.highest,
          roll.difficulty,
          roll.margin,
          roll.grade,
          roll.createdAt,
        ],
      );
    }

    let eventSeqRow = await tx.queryOne<SqliteRow>(
      'SELECT COALESCE(MAX(event_seq), 0) AS max_seq FROM branch_events WHERE branch_id = ?',
      [turn.branchId],
    );
    let eventSeq = eventSeqRow ? requireNumber(eventSeqRow, 'max_seq') : 0;
    for (const effect of turn.effects) {
      eventSeq += 1;
      await tx.execute(
        `INSERT INTO branch_events
          (branch_id, event_seq, turn_id, state_version, event_type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [turn.branchId, eventSeq, turn.turnId, turn.stateVersion, effect.op, JSON.stringify(effect), turn.committedAt],
      );
    }
  }
}

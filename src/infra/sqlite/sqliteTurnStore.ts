import type {
  AtomicCommitInput,
  CommittedTurn,
  TurnStore,
} from '../../application/ports/turnStore';
import type { TurnRollJournal, StageRollTurnInput } from '../../application/ports/turnRollJournal';
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

interface StagedTurnRow extends SqliteRow {
  status: string;
  expected_state_version: number;
  action_contract_hash: string;
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

function rollFromRow(row: RollRow): RollRecord {
  return {
    rulesetId: row.ruleset_id,
    rulesetVersion: row.ruleset_version,
    turnId: row.turn_id,
    rollIndex: row.roll_index,
    contractHash: row.contract_hash,
    diceCount: row.dice_count,
    dieSides: row.die_sides as RollRecord['dieSides'],
    rolls: parseJson<number[]>(row.rolls_json, 'roll_records.rolls_json'),
    highest: row.highest,
    difficulty: row.difficulty,
    margin: row.margin,
    grade: row.grade as RollRecord['grade'],
    createdAt: row.created_at,
  };
}

export class SqliteTurnStore implements TurnStore, TurnRollJournal {
  constructor(private readonly db: SqliteDatabase) {}

  async getState(branchId: string): Promise<GameStateSnapshot | null> {
    return this.readState(this.db, branchId);
  }

  async getCommittedTurn(branchId: string, turnId: string): Promise<CommittedTurn | null> {
    return this.readCommittedTurn(this.db, branchId, turnId);
  }

  async stageRollTurn(input: StageRollTurnInput): Promise<void> {
    await this.db.transaction(async tx => {
      const existing = await tx.queryOne<StagedTurnRow>(
        `SELECT status, expected_state_version, action_contract_hash
           FROM turns
          WHERE branch_id = ? AND turn_id = ?`,
        [input.branchId, input.turnId],
      );
      if (existing) {
        if (existing.expected_state_version !== input.expectedStateVersion) {
          throw new Error('Staged turn stateVersion mismatch.');
        }
        if (existing.action_contract_hash !== input.actionContractHash) {
          throw new Error('Staged turn contractHash mismatch.');
        }
        return;
      }

      const branch = await tx.queryOne<BranchRow>(
        'SELECT branch_id, state_version FROM branches WHERE branch_id = ?',
        [input.branchId],
      );
      if (!branch) throw new Error(`Unknown branch: ${input.branchId}.`);
      if (branch.state_version !== input.expectedStateVersion) {
        throw new Error(
          `State version mismatch while staging roll: expected ${input.expectedStateVersion}, actual ${branch.state_version}.`,
        );
      }

      await tx.execute(
        `INSERT INTO turns
          (branch_id, turn_id, status, expected_state_version, committed_state_version,
           action_contract_json, action_contract_hash, outcome_grade, public_summary,
           effects_json, created_at, committed_at)
         VALUES (?, ?, 'AwaitRoll', ?, NULL, ?, ?, NULL, NULL, '[]', ?, NULL)`,
        [
          input.branchId,
          input.turnId,
          input.expectedStateVersion,
          input.actionContractJson,
          input.actionContractHash,
          input.createdAt,
        ],
      );
    });
  }

  async getRollRecord(branchId: string, turnId: string, rollIndex: number): Promise<RollRecord | null> {
    const row = await this.db.queryOne<RollRow>(
      `SELECT ruleset_id, ruleset_version, turn_id, roll_index, contract_hash, dice_count,
              die_sides, rolls_json, highest, difficulty, margin, grade, created_at
         FROM roll_records
        WHERE branch_id = ? AND turn_id = ? AND roll_index = ?`,
      [branchId, turnId, rollIndex],
    );
    return row ? rollFromRow(row) : null;
  }

  async recordRoll(branchId: string, record: RollRecord): Promise<RollRecord> {
    return this.db.transaction(async tx => {
      const existing = await tx.queryOne<RollRow>(
        `SELECT ruleset_id, ruleset_version, turn_id, roll_index, contract_hash, dice_count,
                die_sides, rolls_json, highest, difficulty, margin, grade, created_at
           FROM roll_records
          WHERE branch_id = ? AND turn_id = ? AND roll_index = ?`,
        [branchId, record.turnId, record.rollIndex],
      );
      if (existing) {
        const stored = rollFromRow(existing);
        if (stored.contractHash !== record.contractHash) {
          throw new Error('Persisted roll belongs to a different action contract.');
        }
        return stored;
      }

      const staged = await tx.queryOne<StagedTurnRow>(
        `SELECT status, expected_state_version, action_contract_hash
           FROM turns
          WHERE branch_id = ? AND turn_id = ?`,
        [branchId, record.turnId],
      );
      if (!staged) throw new Error('Cannot record a roll before staging its turn.');
      if (staged.action_contract_hash !== record.contractHash) {
        throw new Error('Roll contractHash does not match staged turn.');
      }
      if (staged.status === 'Committed') {
        throw new Error('Cannot add a new roll to a committed turn.');
      }

      await this.insertRoll(tx, branchId, record);
      await tx.execute(
        `UPDATE turns SET status = 'Resolved'
          WHERE branch_id = ? AND turn_id = ? AND status <> 'Committed'`,
        [branchId, record.turnId],
      );
      return record;
    });
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

      await this.persistState(
        tx,
        input.nextState,
        input.expectedStateVersion,
        input.committedTurn.committedAt,
      );
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
      ? requireNumber(
          parseJson<SqliteRow>(
            requireString(snapshot, 'snapshot_json'),
            'snapshots.snapshot_json',
          ),
          'clockMinutes',
        )
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
        resources: parseJson<Record<string, number>>(
          row.resources_json,
          'actor_states.resources_json',
        ),
        conditions: parseJson<string[]>(
          row.conditions_json,
          'actor_states.conditions_json',
        ),
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
    const roll = await db.queryOne<RollRow>(
      `SELECT ruleset_id, ruleset_version, turn_id, roll_index, contract_hash, dice_count,
              die_sides, rolls_json, highest, difficulty, margin, grade, created_at
         FROM roll_records
        WHERE branch_id = ? AND turn_id = ? AND roll_index = 0`,
      [branchId, turnId],
    );
    if (roll) committed.rollRecord = rollFromRow(roll);
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

    await tx.execute(
      `INSERT INTO snapshots (branch_id, state_version, snapshot_json, state_hash, created_at)
       VALUES (?, ?, ?, NULL, ?)`,
      [state.branchId, state.stateVersion, JSON.stringify(state), committedAt],
    );
  }

  private async persistCommittedTurn(
    tx: SqliteTransaction,
    input: AtomicCommitInput,
  ): Promise<void> {
    const turn = input.committedTurn;
    const staged = await tx.queryOne<StagedTurnRow>(
      `SELECT status, expected_state_version, action_contract_hash
         FROM turns
        WHERE branch_id = ? AND turn_id = ?`,
      [turn.branchId, turn.turnId],
    );

    if (staged) {
      if (staged.expected_state_version !== turn.previousStateVersion) {
        throw new Error('Staged turn stateVersion changed before commit.');
      }
      if (staged.action_contract_hash !== input.actionContractHash) {
        throw new Error('Staged turn contractHash changed before commit.');
      }
      await tx.execute(
        `UPDATE turns
            SET status = 'Committed',
                committed_state_version = ?,
                outcome_grade = ?,
                public_summary = ?,
                effects_json = ?,
                committed_at = ?
          WHERE branch_id = ? AND turn_id = ?`,
        [
          turn.stateVersion,
          turn.outcomeGrade,
          turn.publicSummary,
          JSON.stringify(turn.effects),
          turn.committedAt,
          turn.branchId,
          turn.turnId,
        ],
      );
    } else {
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
    }

    if (turn.rollRecord) {
      const existingRoll = await tx.queryOne<RollRow>(
        `SELECT ruleset_id, ruleset_version, turn_id, roll_index, contract_hash, dice_count,
                die_sides, rolls_json, highest, difficulty, margin, grade, created_at
           FROM roll_records
          WHERE branch_id = ? AND turn_id = ? AND roll_index = ?`,
        [turn.branchId, turn.turnId, turn.rollRecord.rollIndex],
      );
      if (existingRoll) {
        const stored = rollFromRow(existingRoll);
        if (stored.contractHash !== turn.rollRecord.contractHash) {
          throw new Error('Committed turn roll does not match persisted roll.');
        }
        if (stored.rolls.join(',') !== turn.rollRecord.rolls.join(',')) {
          throw new Error('Committed turn attempted to replace persisted dice.');
        }
      } else {
        await this.insertRoll(tx, turn.branchId, turn.rollRecord);
      }
    }

    const eventSeqRow = await tx.queryOne<SqliteRow>(
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
        [
          turn.branchId,
          eventSeq,
          turn.turnId,
          turn.stateVersion,
          effect.op,
          JSON.stringify(effect),
          turn.committedAt,
        ],
      );
    }
  }

  private async insertRoll(
    tx: SqliteTransaction,
    branchId: string,
    roll: RollRecord,
  ): Promise<void> {
    await tx.execute(
      `INSERT INTO roll_records
        (branch_id, turn_id, roll_index, ruleset_id, ruleset_version, contract_hash,
         dice_count, die_sides, rolls_json, highest, difficulty, margin, grade, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        branchId,
        roll.turnId,
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
}

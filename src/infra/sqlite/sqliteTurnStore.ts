import type {
  AtomicCommitInput,
  CommittedTurn,
  TurnSettlementPlan,
  TurnStore,
} from '../../application/ports/turnStore';
import type { TurnRollJournal, StageRollTurnInput, StagedTurnRecord } from '../../application/ports/turnRollJournal';
import type { SqliteDatabase, SqliteRow, SqliteTransaction } from '../../application/ports/sqlite';
import { cloneGameState, type EncounterSnapshotEntry, type GameStateSnapshot } from '../../domain/state/types';
import type { SituationSnapshotEntry } from '../../domain/situations/types';
import type { EncounterState } from '../../domain/combat/encounter';
import { replaceEncounterSnapshots } from './encounterPersistence';
import type { EffectOperation } from '../../domain/turns/types';
import type { RollGrade, RollRecord, SkillRank } from '../../domain/rules/types';
import { hasBranchContentManifestTable, insertBranchContentManifest, readBranchContentManifest, rebindBranchContentManifest } from '../../application/worldPackage/branchContentStore';

interface BranchRow extends SqliteRow {
  branch_id: string;
  campaign_id: string;
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
  action_contract_json: string;
  action_contract_hash: string;
  created_at: string;
}

type NarrativeStatus = 'Candidate' | 'Committed';

interface CommittedTurnRow extends SqliteRow {
  branch_id: string;
  turn_id: string;
  expected_state_version: number;
  committed_state_version: number;
  outcome_grade: string;
  public_summary: string;
  effects_json: string;
  committed_at: string;
}

interface CommittedTurnHistoryRow extends CommittedTurnRow {
  narrative_text: string | null;
  narrative_status: string | null;
  ruleset_id: string | null;
  ruleset_version: string | null;
  roll_index: number | null;
  contract_hash: string | null;
  dice_count: number | null;
  die_sides: number | null;
  rolls_json: string | null;
  highest: number | null;
  difficulty: number | null;
  margin: number | null;
  grade: string | null;
  roll_created_at: string | null;
}

export interface CommittedTurnHistoryEntry {
  branchId: string;
  turnId: string;
  stateVersion: number;
  outcomeGrade: RollGrade;
  publicSummary: string;
  narrativeText: string | null;
  narrativeStatus: NarrativeStatus | null;
  rollRecord: RollRecord | null;
  /** Effects actually committed for this turn (memory-signal extraction). */
  effects: EffectOperation[];
  committedAt: string;
}

interface CommittedTurnHistoryRowWithRoll extends CommittedTurnHistoryRow {
  ruleset_id: string;
  ruleset_version: string;
  roll_index: number;
  contract_hash: string;
  dice_count: number;
  die_sides: number;
  rolls_json: string;
  highest: number;
  difficulty: number;
  margin: number;
  grade: string;
  roll_created_at: string;
}

function hasRollColumns(row: CommittedTurnHistoryRow): row is CommittedTurnHistoryRowWithRoll {
  return (
    row.ruleset_id !== null &&
    row.ruleset_version !== null &&
    row.roll_index !== null &&
    row.contract_hash !== null &&
    row.dice_count !== null &&
    row.die_sides !== null &&
    row.rolls_json !== null &&
    row.highest !== null &&
    row.difficulty !== null &&
    row.margin !== null &&
    row.grade !== null &&
    row.roll_created_at !== null
  );
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
  /** Null until probed: legacy DBs may predate the game projection tables. */
  private projectionTablesAvailable: boolean | null = null;
  private encounterTablesAvailable: boolean | null = null;
  private knowledgeTablesAvailable: boolean | null = null;
  private contentManifestTablesAvailable: boolean | null = null;

  constructor(private readonly db: SqliteDatabase) {}

  private async hasProjectionTables(reader: Pick<SqliteTransaction, 'queryOne'> = this.db): Promise<boolean> {
    if (this.projectionTablesAvailable === null) {
      const row = await reader.queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('actor_skills', 'relationships', 'actor_cards', 'party_members')`,
      );
      this.projectionTablesAvailable = (row?.n ?? 0) === 4;
    }
    return this.projectionTablesAvailable;
  }

  private async hasEncounterTables(reader: Pick<SqliteTransaction, 'queryOne'> = this.db): Promise<boolean> {
    if (this.encounterTablesAvailable === null) {
      const row = await reader.queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('encounters', 'encounter_actors')`,
      );
      this.encounterTablesAvailable = (row?.n ?? 0) === 2;
    }
    return this.encounterTablesAvailable;
  }

  private async hasKnowledgeTables(reader: Pick<SqliteTransaction, 'queryOne'> = this.db): Promise<boolean> {
    if (this.knowledgeTablesAvailable === null) {
      const row = await reader.queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('branch_knowledge', 'quest_states', 'quest_reward_ledger')`,
      );
      this.knowledgeTablesAvailable = (row?.n ?? 0) === 3;
    }
    return this.knowledgeTablesAvailable;
  }

  private async hasContentManifestTables(reader: Pick<SqliteTransaction, 'queryOne'> = this.db): Promise<boolean> {
    if (this.contentManifestTablesAvailable === null) {
      this.contentManifestTablesAvailable = await hasBranchContentManifestTable(reader);
    }
    return this.contentManifestTablesAvailable;
  }

  private situationTablesAvailable: boolean | null = null;

  private async hasSituationTables(reader: Pick<SqliteTransaction, 'queryOne'> = this.db): Promise<boolean> {
    if (this.situationTablesAvailable === null) {
      const row = await reader.queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'branch_situations'`,
      );
      this.situationTablesAvailable = (row?.n ?? 0) === 1;
    }
    return this.situationTablesAvailable;
  }

  async getState(branchId: string): Promise<GameStateSnapshot | null> {
    return this.readState(this.db, branchId);
  }

  async getCommittedTurn(branchId: string, turnId: string): Promise<CommittedTurn | null> {
    return this.readCommittedTurn(this.db, branchId, turnId);
  }

  async listCommittedTurns(branchId: string): Promise<CommittedTurnHistoryEntry[]> {
    const rows = await this.db.queryAll<CommittedTurnHistoryRow>(
      `SELECT t.branch_id, t.turn_id, t.expected_state_version, t.committed_state_version,
              t.outcome_grade, t.public_summary, t.effects_json, t.committed_at,
              n.text AS narrative_text, n.status AS narrative_status,
              r.ruleset_id, r.ruleset_version, r.roll_index, r.contract_hash, r.dice_count,
              r.die_sides, r.rolls_json, r.highest, r.difficulty, r.margin, r.grade,
              r.created_at AS roll_created_at
         FROM turns t
         LEFT JOIN turn_narratives n
           ON n.branch_id = t.branch_id AND n.turn_id = t.turn_id
         LEFT JOIN roll_records r
           ON r.branch_id = t.branch_id AND r.turn_id = t.turn_id AND r.roll_index = 0
        WHERE t.branch_id = ? AND t.status = 'Committed'
        ORDER BY t.committed_state_version ASC`,
      [branchId],
    );
    return rows.map(row => {
      const roll = hasRollColumns(row)
        ? rollFromRow({
            ruleset_id: row.ruleset_id,
            ruleset_version: row.ruleset_version,
            turn_id: row.turn_id,
            roll_index: row.roll_index,
            contract_hash: row.contract_hash,
            dice_count: row.dice_count,
            die_sides: row.die_sides,
            rolls_json: row.rolls_json,
            highest: row.highest,
            difficulty: row.difficulty,
            margin: row.margin,
            grade: row.grade,
            created_at: row.roll_created_at,
          })
        : null;
      return {
        branchId: row.branch_id,
        turnId: row.turn_id,
        stateVersion: row.committed_state_version,
        outcomeGrade: row.outcome_grade as CommittedTurnHistoryEntry['outcomeGrade'],
        publicSummary: row.public_summary,
        narrativeText: row.narrative_text,
        narrativeStatus: row.narrative_status === null
          ? null
          : (row.narrative_status as NarrativeStatus),
        rollRecord: roll,
        effects: parseJson<EffectOperation[]>(row.effects_json, 'turns.effects_json'),
        committedAt: row.committed_at,
      };
    });
  }

  async getStagedTurn(branchId: string, turnId: string): Promise<StagedTurnRecord | null> {
    const row = await this.db.queryOne<StagedTurnRow>(
      `SELECT status, expected_state_version, action_contract_json, action_contract_hash, created_at
         FROM turns
        WHERE branch_id = ? AND turn_id = ?`,
      [branchId, turnId],
    );
    if (!row) return null;
    return {
      branchId,
      turnId,
      expectedStateVersion: row.expected_state_version,
      actionContractJson: row.action_contract_json,
      actionContractHash: row.action_contract_hash,
      createdAt: row.created_at,
      status: row.status as StagedTurnRecord['status'],
    };
  }

  async stageRollTurn(input: StageRollTurnInput): Promise<void> {
    await this.db.transaction(async tx => {
      const existing = await tx.queryOne<StagedTurnRow>(
        `SELECT status, expected_state_version, action_contract_json, action_contract_hash, created_at
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
        'SELECT branch_id, campaign_id, state_version FROM branches WHERE branch_id = ?',
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
         VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL, '[]', ?, NULL)`,
        [
          input.branchId,
          input.turnId,
          input.status ?? 'AwaitRoll',
          input.expectedStateVersion,
          input.actionContractJson,
          input.actionContractHash,
          input.createdAt,
        ],
      );
    });
  }

  async discardUnrolledTurn(branchId: string, turnId: string): Promise<boolean> {
    return this.db.transaction(async tx => {
      const row = await tx.queryOne<{ status: string }>(
        'SELECT status FROM turns WHERE branch_id = ? AND turn_id = ?',
        [branchId, turnId],
      );
      if (!row) return false;
      if (row.status === 'Committed') {
        throw new Error('Cannot discard a committed turn.');
      }
      const roll = await tx.queryOne<SqliteRow>(
        'SELECT roll_index FROM roll_records WHERE branch_id = ? AND turn_id = ? LIMIT 1',
        [branchId, turnId],
      );
      if (roll) {
        throw new Error('Cannot discard a turn with a persisted roll; resume it instead.');
      }
      await tx.execute('DELETE FROM turns WHERE branch_id = ? AND turn_id = ?', [branchId, turnId]);
      return true;
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
        `SELECT status, expected_state_version, action_contract_json, action_contract_hash, created_at
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
        'SELECT branch_id, campaign_id, state_version FROM branches WHERE branch_id = ?',
        [input.branchId],
      );
      if (!branch) throw new Error(`Unknown branch: ${input.branchId}.`);
      if (branch.state_version !== input.expectedStateVersion) {
        throw new Error(
          `Atomic commit conflict: expected stateVersion ${input.expectedStateVersion}, actual ${branch.state_version}.`,
        );
      }
      if (input.coordinationFence) {
        const fence = await tx.queryOne<{ fence_token: number }>(
          'SELECT fence_token FROM interaction_campaign_fences WHERE campaign_id = ?',
          [branch.campaign_id],
        );
        if (branch.campaign_id !== input.coordinationFence.campaignId
          || fence?.fence_token !== input.coordinationFence.fenceToken) {
          throw new Error('Interaction operation fence expired before the atomic game commit.');
        }
      }
      if (input.nextState.branchId !== input.branchId) {
        throw new Error('Atomic commit cannot move a state to another branch.');
      }
      if (input.nextState.stateVersion !== input.expectedStateVersion + 1) {
        throw new Error('Atomic commit must advance stateVersion exactly once.');
      }

      // Growth/relationship settlement happens BEFORE persistState so the
      // snapshot stamped below is complete and reflects this turn's awards.
      if (input.settlement) {
        await this.applySettlement(tx, input, input.nextState.stateVersion);
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

  /**
   * Applies settlement inside the caller's transaction. The reward ledger is
   * the hard dedup gate: an existing (branch, encounter, actor, skill, kind)
   * row aborts the whole commit — no double rewards, no partial state.
   */
  private async applySettlement(
    tx: SqliteTransaction,
    input: AtomicCommitInput,
    stateVersion: number,
  ): Promise<void> {
    const branchId = input.branchId;
    const settlement = input.settlement!;
    for (const entry of settlement.rewardLedger) {
      const dup = await tx.queryOne<SqliteRow>(
        `SELECT skill_id FROM reward_ledger
          WHERE branch_id = ? AND encounter_id = ? AND actor_id = ? AND skill_id = ? AND reward_kind = ?`,
        [branchId, entry.encounterId, entry.actorId, entry.skillId, entry.rewardKind],
      );
      if (dup) {
        throw new Error(
          `Reward already granted for encounter ${entry.encounterId} ` +
            `(actor ${entry.actorId}, skill ${entry.skillId}, ${entry.rewardKind}); refusing double award.`,
        );
      }
      await tx.execute(
        `INSERT INTO reward_ledger (branch_id, encounter_id, actor_id, skill_id, reward_kind, granted_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [branchId, entry.encounterId, entry.actorId, entry.skillId, entry.rewardKind, new Date().toISOString()],
      );
    }
    for (const skill of settlement.skillUpserts) {
      await tx.execute(
        `INSERT INTO actor_skills (branch_id, actor_id, skill_id, rank, practice_points, awarded_turns_json, state_version)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(branch_id, actor_id, skill_id) DO UPDATE SET
           rank = excluded.rank,
           practice_points = excluded.practice_points,
           awarded_turns_json = excluded.awarded_turns_json,
           state_version = excluded.state_version`,
        [branchId, skill.actorId, skill.skillId, skill.rank, skill.practicePoints, JSON.stringify(skill.awardedKeys), skill.stateVersion],
      );
    }
    for (const rel of settlement.relationships) {
      await tx.execute(
        `INSERT INTO relationships (branch_id, rel_id, from_actor_id, to_actor_id, stance, closeness, updated_turn_id, state_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(branch_id, from_actor_id, to_actor_id) DO UPDATE SET
           rel_id = excluded.rel_id,
           stance = excluded.stance,
           closeness = excluded.closeness,
           updated_turn_id = excluded.updated_turn_id,
           state_version = excluded.state_version`,
        [branchId, rel.relId, rel.fromActorId, rel.toActorId, rel.stance, rel.closeness, rel.updatedTurnId, stateVersion],
      );
    }
    if (await this.hasProjectionTables(tx)) {
      for (const actorId of settlement.partyDeletes ?? []) {
        await tx.execute('DELETE FROM party_members WHERE branch_id = ? AND actor_id = ?', [branchId, actorId]);
      }
      for (const member of settlement.partyUpserts ?? []) {
        await tx.execute(
          `INSERT INTO party_members (branch_id, actor_id, controller, role, joined_at, party_group_id)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(branch_id, actor_id) DO UPDATE SET
             controller = excluded.controller,
             role = excluded.role,
             joined_at = excluded.joined_at,
             party_group_id = excluded.party_group_id`,
          [branchId, member.actorId, member.controller, member.role, member.joinedAt, member.groupId ?? 'main'],
        );
      }
    }
    // Card projections (training/equipment changes) land in the same
    // transaction so the snapshot stamped below is consistent with the card
    // table (P2 acceptance A02/A03).
    if (await this.hasProjectionTables(tx)) {
      for (const actorId of settlement.cardDeletes ?? []) {
        await tx.execute('DELETE FROM actor_cards WHERE branch_id = ? AND actor_id = ?', [branchId, actorId]);
      }
      for (const upsert of settlement.cardUpserts ?? []) {
        const committedAt = new Date().toISOString();
        await tx.execute(
          `INSERT INTO actor_cards (branch_id, actor_id, card_json, created_at, updated_at, updated_state_version)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(branch_id, actor_id) DO UPDATE SET
             card_json = excluded.card_json,
             updated_at = excluded.updated_at,
             updated_state_version = excluded.updated_state_version`,
          [branchId, upsert.actorId, JSON.stringify(upsert.card), committedAt, committedAt, stateVersion],
        );
      }
    }
    // Engine-side loot: ownership lands in the state BEFORE persistState, so
    // the snapshot and the inventory table capture it atomically.
    if (settlement.loot) {
      for (const grant of settlement.loot) {
        if (!input.nextState.actors[grant.actorId]) {
          throw new Error(`Loot grant references unknown actor ${grant.actorId}.`);
        }
        const existingOwner = input.nextState.itemOwners[grant.itemId];
        if (existingOwner !== undefined) {
          throw new Error(`Item ${grant.itemId} already has an owner (${existingOwner}); unique items grant once.`);
        }
        input.nextState.itemOwners[grant.itemId] = grant.actorId;
        input.nextState.itemSources ??= {};
        input.nextState.itemSources[grant.itemId] = {
          kind: 'encounter_loot',
          sourceId: settlement.encounterId,
          obtainedAtStateVersion: input.nextState.stateVersion,
        };
      }
    }
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
    const snapshotPayload = snapshot
      ? parseJson<GameStateSnapshot>(requireString(snapshot, 'snapshot_json'), 'snapshots.snapshot_json')
      : null;
    let clockSeconds = 0;
    if (snapshotPayload) {
      if (typeof snapshotPayload.clockSeconds === 'number') {
        clockSeconds = snapshotPayload.clockSeconds;
      } else {
        clockSeconds = requireNumber(snapshotPayload as unknown as SqliteRow, 'clockMinutes') * 60;
      }
    }

    const state: GameStateSnapshot = {
      branchId,
      stateVersion: branch.state_version,
      clockSeconds,
      clockMinutes: Math.floor(clockSeconds / 60),
      actors: {},
      itemOwners: {},
    };
    if (snapshotPayload?.cards) state.cards = snapshotPayload.cards;
    if (snapshotPayload?.party) state.party = snapshotPayload.party;
    if (snapshotPayload?.itemSources) state.itemSources = snapshotPayload.itemSources;
    if (snapshotPayload?.encounters) state.encounters = snapshotPayload.encounters;
    if (snapshotPayload?.discoveries) state.discoveries = snapshotPayload.discoveries;
    if (snapshotPayload?.questProgress) state.questProgress = snapshotPayload.questProgress;
    if (snapshotPayload?.questRewards) state.questRewards = snapshotPayload.questRewards;
    if (snapshotPayload?.contentManifest) state.contentManifest = snapshotPayload.contentManifest;
    if (snapshotPayload?.segmentContentBinding) state.segmentContentBinding = snapshotPayload.segmentContentBinding;
    if (snapshotPayload?.styleSnapshot) state.styleSnapshot = snapshotPayload.styleSnapshot;
    if (snapshotPayload?.situations) state.situations = snapshotPayload.situations;
    if (typeof snapshotPayload?.causalWorldTimeOrder === 'number') {
      state.causalWorldTimeOrder = snapshotPayload.causalWorldTimeOrder;
    }
    if (await this.hasContentManifestTables(db)) {
      const manifest = await readBranchContentManifest(db, branchId, branch.state_version);
      if (manifest) state.contentManifest = manifest;
    }
    for (const row of actors) {
      const abilityCooldowns = snapshotPayload?.actors?.[row.actor_id]?.abilityCooldowns;
      const zoneId = snapshotPayload?.actors?.[row.actor_id]?.zoneId;
      state.actors[row.actor_id] = {
        actorId: row.actor_id,
        locationId: row.location_id,
        ...(zoneId ? { zoneId } : {}),
        resources: parseJson<Record<string, number>>(
          row.resources_json,
          'actor_states.resources_json',
        ),
        conditions: parseJson<string[]>(
          row.conditions_json,
          'actor_states.conditions_json',
        ),
        ...(snapshotPayload?.actors?.[row.actor_id]?.lifeStatus
          ? { lifeStatus: snapshotPayload.actors[row.actor_id]!.lifeStatus }
          : {}),
        ...(abilityCooldowns
          ? { abilityCooldowns: { ...abilityCooldowns } }
          : {}),
      };
    }
    for (const row of inventory) state.itemOwners[row.item_id] = row.owner_actor_id;

    // Older P2 snapshots predate authoritative encounter history. Hydrate the
    // current head from its live projection for recovery; historical forks
    // still refuse incomplete encounter snapshots in forkBranch.
    if (!state.encounters && await this.hasEncounterTables(db)) {
      state.encounters = await this.readEncounterSnapshots(db, branchId);
    }
    // Situation projections are authoritative branch history (P7); hydrate
    // the head when the snapshot predates them or omits the array.
    if (!state.situations && await this.hasSituationTables(db)) {
      const situationRows = await db.queryAll<{ situation_id: string; situation_json: string }>(
        'SELECT situation_id, situation_json FROM branch_situations WHERE branch_id = ? ORDER BY situation_id',
        [branchId],
      );
      if (situationRows.length > 0) {
        state.situations = situationRows.map(row =>
          parseJson<SituationSnapshotEntry>(row.situation_json, 'branch_situations.situation_json'));
      }
    }
    const projectionsAvailable = await this.hasProjectionTables(db);
    if (projectionsAvailable && !state.cards) {
      const cardRows = await db.queryAll<{ actor_id: string; card_json: string }>(
        'SELECT actor_id, card_json FROM actor_cards WHERE branch_id = ? ORDER BY actor_id',
        [branchId],
      );
      state.cards = cardRows.map(row => ({ actorId: row.actor_id, card: parseJson<unknown>(row.card_json, 'actor_cards.card_json') }));
    }
    if (projectionsAvailable && !state.party) {
      const partyRows = await db.queryAll<{ actor_id: string; controller: string; role: string; joined_at: string; party_group_id: string }>(
        'SELECT actor_id, controller, role, joined_at, party_group_id FROM party_members WHERE branch_id = ? ORDER BY actor_id',
        [branchId],
      );
      state.party = partyRows.map(row => ({ actorId: row.actor_id, controller: row.controller, role: row.role, joinedAt: row.joined_at, groupId: row.party_group_id }));
    }

    // Hydrate the current skill and relationship projections so consumers
    // (card-driven roll specs, historical forks) see one consistent state.
    // Legacy DBs without the game tables keep working (P2-0: old mode stays
    // readable), they just carry no skill/relationship projections.
    if (await this.hasProjectionTables(db)) {
      const skillRows = await db.queryAll<SqliteRow>(
        'SELECT actor_id, skill_id, rank, practice_points, awarded_turns_json FROM actor_skills WHERE branch_id = ? ORDER BY actor_id, skill_id',
        [branchId],
      );
      if (skillRows.length > 0) {
        state.skills = skillRows.map(row => ({
          actorId: requireString(row, 'actor_id'),
          skillId: requireString(row, 'skill_id'),
          rank: requireString(row, 'rank') as SkillRank,
          practicePoints: requireNumber(row, 'practice_points'),
          awardedKeys: parseJson<string[]>(requireString(row, 'awarded_turns_json'), 'actor_skills.awarded_turns_json'),
        }));
      }
      const relationshipRows = await db.queryAll<SqliteRow>(
        'SELECT rel_id, from_actor_id, to_actor_id, stance, closeness, updated_turn_id FROM relationships WHERE branch_id = ? ORDER BY rel_id',
        [branchId],
      );
      if (relationshipRows.length > 0) {
        state.relationships = relationshipRows.map(row => ({
          relId: requireString(row, 'rel_id'),
          fromActorId: requireString(row, 'from_actor_id'),
          toActorId: requireString(row, 'to_actor_id'),
          stance: requireString(row, 'stance'),
          closeness: requireNumber(row, 'closeness'),
          updatedTurnId: typeof row.updated_turn_id === 'string' ? row.updated_turn_id : null,
        }));
      }
    }
    return cloneGameState(state);
  }

  private async readEncounterSnapshots(
    db: Pick<SqliteDatabase, 'queryOne' | 'queryAll'> | Pick<SqliteTransaction, 'queryOne' | 'queryAll'>,
    branchId: string,
  ): Promise<EncounterSnapshotEntry[]> {
    const rows = await db.queryAll<SqliteRow>(
      `SELECT encounter_id, status, scene_id, distance_bands_json, initiative_json,
              turn_cursor, round, created_at, resolved_at
         FROM encounters WHERE branch_id = ? ORDER BY created_at, encounter_id`,
      [branchId],
    );
    const actors = await db.queryAll<SqliteRow>(
      `SELECT encounter_id, actor_id, side, hp, max_hp, stamina, conditions_json,
              distance_band, acted_this_round, moved_this_round
         FROM encounter_actors WHERE branch_id = ? ORDER BY encounter_id, actor_id`,
      [branchId],
    );
    const actorsByEncounter = new Map<string, EncounterState['actors']>();
    for (const row of actors) {
      const encounterId = requireString(row, 'encounter_id');
      const items = actorsByEncounter.get(encounterId) ?? {};
      items[requireString(row, 'actor_id')] = {
        actorId: requireString(row, 'actor_id'),
        side: requireString(row, 'side') as EncounterState['actors'][string]['side'],
        hp: requireNumber(row, 'hp'),
        maxHp: requireNumber(row, 'max_hp'),
        stamina: requireNumber(row, 'stamina'),
        conditions: parseJson<string[]>(requireString(row, 'conditions_json'), 'encounter_actors.conditions_json'),
        distanceBand: requireString(row, 'distance_band') as EncounterState['actors'][string]['distanceBand'],
        actedThisRound: requireNumber(row, 'acted_this_round') === 1,
        movedThisRound: row.moved_this_round === undefined ? false : requireNumber(row, 'moved_this_round') === 1,
      };
      actorsByEncounter.set(encounterId, items);
    }
    return rows.map(row => {
      const envelope = parseJson<Record<string, unknown>>(requireString(row, 'distance_bands_json'), 'encounters.distance_bands_json');
      const scene = (envelope.scene && typeof envelope.scene === 'object'
        ? envelope.scene
        : { sceneId: requireString(row, 'scene_id'), coverSpotIds: [], exitIds: [] }) as EncounterState['scene'];
      const zones = Array.isArray(envelope.sceneZones) ? envelope.sceneZones as Array<{ zoneId: string; exits: string[] }> : [];
      const exits = Array.isArray(envelope.exits) ? envelope.exits as string[] : [...scene.exitIds];
      const encounterState: EncounterState = {
        encounterId: requireString(row, 'encounter_id'),
        status: requireString(row, 'status') as EncounterState['status'],
        scene,
        actors: actorsByEncounter.get(requireString(row, 'encounter_id')) ?? {},
        initiative: parseJson<string[]>(requireString(row, 'initiative_json'), 'encounters.initiative_json'),
        pendingActorIds: Array.isArray(envelope.pendingActorIds)
          ? envelope.pendingActorIds.filter((id): id is string => typeof id === 'string')
          : [],
        turnCursor: requireNumber(row, 'turn_cursor'),
        round: requireNumber(row, 'round'),
      };
      return {
        state: encounterState,
        zones,
        zoneMap: envelope.zones && typeof envelope.zones === 'object' ? envelope.zones as Record<string, string> : {},
        exits,
        createdAt: requireString(row, 'created_at'),
        resolvedAt: typeof row.resolved_at === 'string' ? row.resolved_at : null,
      };
    });
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
    // Adoption can change a snapshot without advancing its game version. A
    // lifecycle action captured before that boundary must retry, rather than
    // replacing adopted content with its stale clone.
    if (state.segmentContentBinding) {
      const binding = state.segmentContentBinding;
      if (binding.branchId !== state.branchId || binding.stateVersion !== expectedStateVersion
        || binding.manifestHash !== state.contentManifest?.manifestHash) {
        throw new Error('Atomic commit segment binding is not bound to the expected branch snapshot.');
      }
    }
    const oldSnapshot = await tx.queryOne<{ snapshot_json: string }>(
      'SELECT snapshot_json FROM snapshots WHERE branch_id = ? AND state_version = ?',
      [state.branchId, expectedStateVersion],
    );
    const oldBinding = oldSnapshot ? (JSON.parse(oldSnapshot.snapshot_json) as GameStateSnapshot).segmentContentBinding : undefined;
    if (JSON.stringify(oldBinding) !== JSON.stringify(state.segmentContentBinding)) {
      throw new Error('Atomic commit segment content changed while the action was being prepared.');
    }
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

    if (state.encounters && await this.hasEncounterTables(tx)) {
      await replaceEncounterSnapshots(tx, state.branchId, state.encounters);
    }

    if (state.contentManifest && await this.hasContentManifestTables(tx)) {
      if (state.contentManifest.branchId !== state.branchId || state.contentManifest.stateVersion !== expectedStateVersion) {
        throw new Error('Atomic commit content manifest is not bound to the expected branch snapshot.');
      }
      const nextManifest = rebindBranchContentManifest(state.contentManifest, state.branchId, state.stateVersion);
      await insertBranchContentManifest(tx, nextManifest, committedAt);
      state.contentManifest = nextManifest;
    }
    if (state.segmentContentBinding) state.segmentContentBinding = {
      ...state.segmentContentBinding, branchId: state.branchId, stateVersion: state.stateVersion,
    };

    if (await this.hasKnowledgeTables(tx)) {
      await tx.execute('DELETE FROM branch_knowledge WHERE branch_id = ?', [state.branchId]);
      for (const discovery of state.discoveries ?? []) {
        await tx.execute(
          `INSERT INTO branch_knowledge
            (branch_id, actor_id, entry_id, known_via, source_turn_id, known_state_version)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [state.branchId, discovery.actorId, discovery.entryId, discovery.knownVia,
            discovery.sourceTurnId, discovery.knownAtStateVersion],
        );
      }
      await tx.execute('DELETE FROM quest_states WHERE branch_id = ?', [state.branchId]);
      for (const quest of state.questProgress ?? []) {
        await tx.execute(
          `INSERT INTO quest_states
            (branch_id, quest_id, status, counters_json, updated_state_version, completed_state_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [state.branchId, quest.questId, quest.status, JSON.stringify(quest.counters),
            quest.updatedStateVersion, quest.completedStateVersion,
            committedAt, committedAt],
        );
      }
      await tx.execute('DELETE FROM quest_reward_ledger WHERE branch_id = ?', [state.branchId]);
      for (const reward of state.questRewards ?? []) {
        await tx.execute(
          `INSERT INTO quest_reward_ledger
            (branch_id, quest_id, reward_id, actor_id, granted_state_version)
           VALUES (?, ?, ?, ?, ?)`,
          [state.branchId, reward.questId, reward.rewardId, reward.actorId, reward.grantedStateVersion],
        );
      }
    }

    // Situation state shares the same transaction and snapshot boundary; the
    // DELETE+reINSERT keeps the projection identical to nextState.situations.
    if (await this.hasSituationTables(tx)) {
      await tx.execute('DELETE FROM branch_situations WHERE branch_id = ?', [state.branchId]);
      for (const situation of state.situations ?? []) {
        await tx.execute(
          `INSERT INTO branch_situations
            (branch_id, situation_id, state_version, status, situation_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            state.branchId,
            situation.situationId,
            state.stateVersion,
            situation.status,
            JSON.stringify(situation),
            committedAt,
          ],
        );
      }
    }

    // Complete snapshot: stamp the authoritative skill, relationship, card and
    // party rows (already settled, if this turn carried growth) into the
    // snapshot so a historical fork restores THIS version's values, never the
    // source branch's current rows. Legacy DBs without projection tables keep
    // the pre-Phase-2 snapshot shape (historyComplete=false on fork).
    let snapshotPayload: GameStateSnapshot = state;
    if (await this.hasProjectionTables(tx)) {
      const skillRows = await tx.queryAll<SqliteRow>(
        'SELECT actor_id, skill_id, rank, practice_points, awarded_turns_json FROM actor_skills WHERE branch_id = ? ORDER BY actor_id, skill_id',
        [state.branchId],
      );
      const snapSkills = skillRows.map(row => ({
        actorId: requireString(row, 'actor_id'),
        skillId: requireString(row, 'skill_id'),
        rank: requireString(row, 'rank') as SkillRank,
        practicePoints: requireNumber(row, 'practice_points'),
        awardedKeys: parseJson<string[]>(requireString(row, 'awarded_turns_json'), 'actor_skills.awarded_turns_json'),
      }));
      const relationshipRows = await tx.queryAll<SqliteRow>(
        'SELECT rel_id, from_actor_id, to_actor_id, stance, closeness, updated_turn_id FROM relationships WHERE branch_id = ? ORDER BY rel_id',
        [state.branchId],
      );
      const snapRelationships = relationshipRows.map(row => ({
        relId: requireString(row, 'rel_id'),
        fromActorId: requireString(row, 'from_actor_id'),
        toActorId: requireString(row, 'to_actor_id'),
        stance: requireString(row, 'stance'),
        closeness: requireNumber(row, 'closeness'),
        updatedTurnId: typeof row.updated_turn_id === 'string' ? row.updated_turn_id : null,
      }));
      const cardRows = await tx.queryAll<{ actor_id: string; card_json: string }>(
        'SELECT actor_id, card_json FROM actor_cards WHERE branch_id = ? ORDER BY actor_id',
        [state.branchId],
      );
      const snapCards = cardRows.map(row => ({
        actorId: row.actor_id,
        card: parseJson<SqliteRow>(row.card_json, 'actor_cards.card_json'),
      }));
      const partyRows = await tx.queryAll<{ actor_id: string; controller: string; role: string; joined_at: string; party_group_id: string }>(
        'SELECT actor_id, controller, role, joined_at, party_group_id FROM party_members WHERE branch_id = ? ORDER BY actor_id',
        [state.branchId],
      );
      const snapParty = partyRows.map(row => ({
        actorId: row.actor_id,
        controller: row.controller,
        role: row.role,
        joinedAt: row.joined_at,
        groupId: row.party_group_id,
      }));
      snapshotPayload = {
        ...state,
        skills: snapSkills,
        relationships: snapRelationships,
        cards: snapCards,
        party: snapParty,
      };
    }
    await tx.execute(
      `INSERT INTO snapshots (branch_id, state_version, snapshot_json, state_hash, created_at)
       VALUES (?, ?, ?, NULL, ?)`,
      [state.branchId, state.stateVersion, JSON.stringify(snapshotPayload), committedAt],
    );
  }

  private async persistCommittedTurn(
    tx: SqliteTransaction,
    input: AtomicCommitInput,
  ): Promise<void> {
    const turn = input.committedTurn;
    const staged = await tx.queryOne<StagedTurnRow>(
      `SELECT status, expected_state_version, action_contract_json, action_contract_hash, created_at
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
    for (const event of input.events ?? []) {
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
          event.eventType,
          JSON.stringify(event.payload),
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

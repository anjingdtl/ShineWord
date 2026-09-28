import type { SkillRank } from '../../domain/rules/types';
import type { SqliteDatabase, SqliteRow } from '../../application/ports/sqlite';
import type { SkillProgress } from '../../domain/progression/growth';
import type { EncounterState, DistanceBand } from '../../domain/combat/encounter';

interface SkillRow extends SqliteRow {
  actor_id: string;
  skill_id: string;
  rank: string;
  practice_points: number;
  awarded_turns_json: string;
}

interface RelationshipRow extends SqliteRow {
  rel_id: string;
  from_actor_id: string;
  to_actor_id: string;
  stance: string;
  closeness: number;
  updated_turn_id: string | null;
}

interface EncounterRow extends SqliteRow {
  encounter_id: string;
  status: string;
  scene_id: string;
  distance_bands_json: string;
  initiative_json: string;
  turn_cursor: number;
  round: number;
  created_at: string;
  resolved_at: string | null;
}

interface EncounterActorRow extends SqliteRow {
  actor_id: string;
  side: string;
  hp: number;
  max_hp: number;
  stamina: number;
  conditions_json: string;
  distance_band: string;
  acted_this_round: number;
  moved_this_round: number;
}

interface MemoryRow extends SqliteRow {
  memory_id: string;
  kind: string;
  summary: string;
  from_state_version: number;
  to_state_version: number;
  invalid_at: number | null;
  created_at: string;
}

export interface RelationshipRecord {
  branchId: string;
  relId: string;
  fromActorId: string;
  toActorId: string;
  stance: string;
  closeness: number;
  updatedTurnId: string | null;
}

export interface MemoryRecord {
  branchId: string;
  memoryId: string;
  kind: 'turn_range_summary' | 'scene_summary' | 'snapshot_note';
  summary: string;
  fromStateVersion: number;
  toStateVersion: number;
  invalidAt: number | null;
  createdAt: string;
}

export interface LlmUsageRecord {
  branchId: string;
  turnId: string;
  role: string;
  requestSeq: number;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimated: boolean;
  createdAt: string;
}

export class SqliteGameStore {
  constructor(private readonly db: SqliteDatabase) {}

  // ---- actor skills ----------------------------------------------------

  async getSkillProgress(branchId: string, actorId: string, skillId: string): Promise<SkillProgress | null> {
    const row = await this.db.queryOne<SkillRow>(
      'SELECT actor_id, skill_id, rank, practice_points, awarded_turns_json FROM actor_skills WHERE branch_id = ? AND actor_id = ? AND skill_id = ?',
      [branchId, actorId, skillId],
    );
    if (!row) return null;
    return {
      skillId: row.skill_id,
      rank: row.rank as SkillRank,
      practicePoints: row.practice_points,
      awardedKeys: JSON.parse(row.awarded_turns_json) as string[],
    };
  }

  async listSkillProgress(branchId: string, actorId: string): Promise<SkillProgress[]> {
    const rows = await this.db.queryAll<SkillRow>(
      'SELECT actor_id, skill_id, rank, practice_points, awarded_turns_json FROM actor_skills WHERE branch_id = ? AND actor_id = ? ORDER BY skill_id',
      [branchId, actorId],
    );
    return rows.map(row => ({
      skillId: row.skill_id,
      rank: row.rank as SkillRank,
      practicePoints: row.practice_points,
      awardedKeys: JSON.parse(row.awarded_turns_json) as string[],
    }));
  }

  async upsertSkillProgress(branchId: string, actorId: string, progress: SkillProgress, stateVersion: number): Promise<void> {
    await this.db.execute(
      `INSERT INTO actor_skills (branch_id, actor_id, skill_id, rank, practice_points, awarded_turns_json, state_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(branch_id, actor_id, skill_id) DO UPDATE SET
         rank = excluded.rank,
         practice_points = excluded.practice_points,
         awarded_turns_json = excluded.awarded_turns_json,
         state_version = excluded.state_version`,
      [branchId, actorId, progress.skillId, progress.rank, progress.practicePoints, JSON.stringify(progress.awardedKeys), stateVersion],
    );
  }

  /** Copies all skill rows from one branch to another (fork/rewind). */
  async copySkills(fromBranchId: string, toBranchId: string): Promise<number> {
    const result = await this.db.execute(
      `INSERT INTO actor_skills (branch_id, actor_id, skill_id, rank, practice_points, awarded_turns_json, state_version)
       SELECT ?, actor_id, skill_id, rank, practice_points, awarded_turns_json, state_version
         FROM actor_skills WHERE branch_id = ?`,
      [toBranchId, fromBranchId],
    );
    void result;
    const count = await this.db.queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM actor_skills WHERE branch_id = ?',
      [toBranchId],
    );
    return count?.n ?? 0;
  }

  // ---- relationships ---------------------------------------------------

  async upsertRelationship(record: RelationshipRecord, stateVersion: number): Promise<void> {
    await this.db.execute(
      `INSERT INTO relationships (branch_id, rel_id, from_actor_id, to_actor_id, stance, closeness, updated_turn_id, state_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(branch_id, from_actor_id, to_actor_id) DO UPDATE SET
         rel_id = excluded.rel_id,
         stance = excluded.stance,
         closeness = excluded.closeness,
         updated_turn_id = excluded.updated_turn_id,
         state_version = excluded.state_version`,
      [record.branchId, record.relId, record.fromActorId, record.toActorId, record.stance, record.closeness, record.updatedTurnId, stateVersion],
    );
  }

  async listRelationships(branchId: string, fromActorId?: string): Promise<RelationshipRecord[]> {
    const rows = fromActorId
      ? await this.db.queryAll<RelationshipRow>(
        'SELECT rel_id, from_actor_id, to_actor_id, stance, closeness, updated_turn_id FROM relationships WHERE branch_id = ? AND from_actor_id = ? ORDER BY rel_id',
        [branchId, fromActorId],
      )
      : await this.db.queryAll<RelationshipRow>(
        'SELECT rel_id, from_actor_id, to_actor_id, stance, closeness, updated_turn_id FROM relationships WHERE branch_id = ? ORDER BY rel_id',
        [branchId],
      );
    return rows.map(row => ({
      branchId,
      relId: row.rel_id,
      fromActorId: row.from_actor_id,
      toActorId: row.to_actor_id,
      stance: row.stance,
      closeness: row.closeness,
      updatedTurnId: row.updated_turn_id,
    }));
  }

  async copyRelationships(fromBranchId: string, toBranchId: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO relationships (branch_id, rel_id, from_actor_id, to_actor_id, stance, closeness, updated_turn_id, state_version)
       SELECT ?, rel_id, from_actor_id, to_actor_id, stance, closeness, updated_turn_id, state_version
         FROM relationships WHERE branch_id = ?`,
      [toBranchId, fromBranchId],
    );
  }

  // ---- encounters --------------------------------------------------------

  async saveEncounter(branchId: string, state: EncounterState, createdAt: string, resolvedAt: string | null, round: number): Promise<void> {
    await this.db.transaction(async tx => {
      const distanceBands: Record<string, string> = {};
      for (const [actorId, actor] of Object.entries(state.actors)) {
        distanceBands[actorId] = actor.distanceBand;
      }
      await tx.execute(
        `INSERT INTO encounters (branch_id, encounter_id, status, scene_id, distance_bands_json,
           initiative_json, turn_cursor, round, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(branch_id, encounter_id) DO UPDATE SET
           status = excluded.status,
           distance_bands_json = excluded.distance_bands_json,
           initiative_json = excluded.initiative_json,
           turn_cursor = excluded.turn_cursor,
           round = excluded.round,
           resolved_at = excluded.resolved_at`,
        [
          branchId,
          state.encounterId,
          state.status,
          state.scene.sceneId,
          // Closeout C6: structured envelope so the scene (with its fate
          // contract), fate states and any ending marker survive reloads.
          JSON.stringify({
            bands: distanceBands,
            zones: {},
            sceneZones: [],
            exits: state.scene.exitIds,
            scene: state.scene,
            pendingActorIds: state.pendingActorIds ?? [],
            fates: state.fates ?? {},
            endingTriggered: state.endingTriggered ?? null,
          }),
          JSON.stringify(state.initiative),
          state.turnCursor,
          round,
          createdAt,
          resolvedAt,
        ],
      );
      for (const actor of Object.values(state.actors)) {
        await tx.execute(
        `INSERT INTO encounter_actors (branch_id, encounter_id, actor_id, side, hp, max_hp, stamina,
             conditions_json, distance_band, acted_this_round, moved_this_round)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(branch_id, encounter_id, actor_id) DO UPDATE SET
             hp = excluded.hp,
             stamina = excluded.stamina,
             conditions_json = excluded.conditions_json,
             distance_band = excluded.distance_band,
             acted_this_round = excluded.acted_this_round,
             moved_this_round = excluded.moved_this_round`,
          [
            branchId,
            state.encounterId,
            actor.actorId,
            actor.side,
            actor.hp,
            actor.maxHp,
            actor.stamina,
            JSON.stringify(actor.conditions),
            actor.distanceBand,
            actor.actedThisRound ? 1 : 0,
            actor.movedThisRound ? 1 : 0,
          ],
        );
      }
    });
  }

  async loadEncounter(branchId: string, encounterId: string): Promise<EncounterState | null> {
    const row = await this.db.queryOne<EncounterRow>(
      'SELECT encounter_id, status, scene_id, distance_bands_json, initiative_json, turn_cursor, round, created_at, resolved_at FROM encounters WHERE branch_id = ? AND encounter_id = ?',
      [branchId, encounterId],
    );
    if (!row) return null;
    const actorRows = await this.db.queryAll<EncounterActorRow>(
      'SELECT actor_id, side, hp, max_hp, stamina, conditions_json, distance_band, acted_this_round, moved_this_round FROM encounter_actors WHERE branch_id = ? AND encounter_id = ?',
      [branchId, encounterId],
    );
    const actors: EncounterState['actors'] = {};
    for (const actor of actorRows) {
      actors[actor.actor_id] = {
        actorId: actor.actor_id,
        side: actor.side as EncounterState['actors'][string]['side'],
        hp: actor.hp,
        maxHp: actor.max_hp,
        stamina: actor.stamina,
        conditions: JSON.parse(actor.conditions_json) as string[],
        distanceBand: actor.distance_band as DistanceBand,
        actedThisRound: actor.acted_this_round === 1,
        movedThisRound: actor.moved_this_round === 1,
      };
    }
    const envelope = JSON.parse(row.distance_bands_json) as Record<string, unknown>;
    const distanceBands = envelope.bands && typeof envelope.bands === 'object'
      ? envelope.bands as Record<string, string>
      : envelope as Record<string, string>;
    for (const [actorId, band] of Object.entries(distanceBands)) {
      if (actors[actorId]) actors[actorId].distanceBand = band as DistanceBand;
    }
    return {
      encounterId: row.encounter_id,
      status: row.status as EncounterState['status'],
      scene: envelope.scene && typeof envelope.scene === 'object'
        ? envelope.scene as EncounterState['scene']
        : { sceneId: row.scene_id, coverSpotIds: [], exitIds: [] },
      actors,
      initiative: JSON.parse(row.initiative_json) as string[],
      pendingActorIds: Array.isArray(envelope.pendingActorIds)
        ? envelope.pendingActorIds.filter((id): id is string => typeof id === 'string')
        : [],
      ...(envelope.fates && typeof envelope.fates === 'object'
        ? { fates: envelope.fates as EncounterState['fates'] }
        : {}),
      ...(typeof envelope.endingTriggered === 'string' && envelope.endingTriggered
        ? { endingTriggered: envelope.endingTriggered }
        : {}),
      turnCursor: row.turn_cursor,
      round: row.round,
    };
  }

  // ---- memories ----------------------------------------------------------

  async saveMemory(record: MemoryRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO memories (branch_id, memory_id, kind, summary, from_state_version, to_state_version, invalid_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(branch_id, memory_id) DO UPDATE SET
         summary = excluded.summary,
         invalid_at = excluded.invalid_at`,
      [record.branchId, record.memoryId, record.kind, record.summary, record.fromStateVersion, record.toStateVersion, record.invalidAt, record.createdAt],
    );
  }

  async listMemories(branchId: string): Promise<MemoryRecord[]> {
    const rows = await this.db.queryAll<MemoryRow>(
      `SELECT memory_id, kind, summary, from_state_version, to_state_version, invalid_at, created_at
         FROM memories WHERE branch_id = ? ORDER BY to_state_version`,
      [branchId],
    );
    return rows.map(row => ({
      branchId,
      memoryId: row.memory_id,
      kind: row.kind as MemoryRecord['kind'],
      summary: row.summary,
      fromStateVersion: row.from_state_version,
      toStateVersion: row.to_state_version,
      invalidAt: row.invalid_at,
      createdAt: row.created_at,
    }));
  }

  // ---- llm usage ---------------------------------------------------------

  async recordLlmUsage(record: LlmUsageRecord): Promise<void> {
    await this.db.execute(
      `INSERT OR IGNORE INTO llm_requests
        (branch_id, turn_id, role, request_seq, model, input_tokens, output_tokens, estimated, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.branchId, record.turnId, record.role, record.requestSeq, record.model, record.inputTokens, record.outputTokens, record.estimated ? 1 : 0, record.createdAt],
    );
  }
}


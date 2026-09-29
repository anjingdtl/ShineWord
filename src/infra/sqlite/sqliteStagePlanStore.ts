/**
 * Persistent stage plan/state storage and campaign package advances
 * (unified build P3). Stage state transitions are CAS-style single UPDATEs:
 * a trigger claims 'untriggered' -> 'queued' exactly once (dedupe), and the
 * build/activation lifecycle moves forward monotonically.
 */
import type { SqliteDatabase } from '../../application/ports/sqlite';
import {
  STAGE_PLAN_VERSION,
  type StagePlan,
  type StageStateRecord,
  type StageStatus,
} from '../../application/worldBuild/stagePlan';

export interface StoredStagePlan {
  planId: string;
  worldId: string;
  sourceId: string;
  sourceHash: string;
  strategy: 'full' | 'progressive';
  stages: StagePlan['stages'];
  configFingerprint: string;
  createdAt: string;
  updatedAt: string;
}

interface PlanRow { [key: string]: string | number | null;
  plan_id: string;
  world_id: string;
  source_id: string;
  source_hash: string;
  strategy: string;
  stages_json: string;
  config_fingerprint: string;
  created_at: string;
  updated_at: string;
}

interface StateRow { [key: string]: string | number | null;
  plan_id: string;
  stage_index: number;
  status: string;
  run_id: string | null;
  package_revision: number | null;
  trigger_reason: string | null;
  trigger_dedupe_key: string | null;
  triggered_at: string | null;
  updated_at: string;
}

export class SqliteStagePlanStore {
  constructor(private readonly db: SqliteDatabase) {}

  async createStagePlan(input: {
    planId: string;
    worldId: string;
    sourceId: string;
    sourceHash: string;
    plan: StagePlan;
    configFingerprint: string;
    now: string;
  }): Promise<void> {
    if (input.plan.planVersion !== STAGE_PLAN_VERSION) {
      throw new Error(`Unsupported stage plan version ${input.plan.planVersion}.`);
    }
    await this.db.transaction(async tx => {
      await tx.execute(
        `INSERT INTO world_stage_plans
          (plan_id, world_id, source_id, source_hash, strategy, stages_json, config_fingerprint, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.planId, input.worldId, input.sourceId, input.sourceHash, input.plan.strategy,
          JSON.stringify({ planVersion: input.plan.planVersion, codePointCount: input.plan.codePointCount, stages: input.plan.stages }),
          input.configFingerprint, input.now, input.now,
        ],
      );
      for (const stage of input.plan.stages) {
        await tx.execute(
          `INSERT INTO world_stage_states
            (plan_id, stage_index, status, run_id, package_revision, trigger_reason, trigger_dedupe_key, triggered_at, updated_at)
           VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)`,
          [input.planId, stage.index, 'untriggered', input.now],
        );
      }
    });
  }

  async getStagePlanByWorld(worldId: string): Promise<StoredStagePlan | null> {
    const row = await this.db.queryOne<PlanRow>(
      'SELECT * FROM world_stage_plans WHERE world_id = ? ORDER BY created_at DESC LIMIT 1',
      [worldId],
    );
    return row ? planFromRow(row) : null;
  }

  async getStagePlan(planId: string): Promise<StoredStagePlan | null> {
    const row = await this.db.queryOne<PlanRow>(
      'SELECT * FROM world_stage_plans WHERE plan_id = ?', [planId],
    );
    return row ? planFromRow(row) : null;
  }

  async listStageStates(planId: string): Promise<StageStateRecord[]> {
    const rows = await this.db.queryAll<StateRow>(
      'SELECT * FROM world_stage_states WHERE plan_id = ? ORDER BY stage_index', [planId],
    );
    return rows.map(stateFromRow);
  }

  /**
   * Trigger claim (dedupe): 'untriggered' -> 'queued' happens at most once per
   * stage; repeated triggers with any key are absorbed (one compatible task).
   */
  async claimStageTrigger(input: {
    planId: string;
    stageIndex: number;
    reason: string;
    dedupeKey: string;
    now: string;
  }): Promise<boolean> {
    // Claims an untriggered (or previously failed) stage exactly once. A
    // stage whose run reached a TERMINAL state (canceled / failed_terminal)
    // can be re-claimed - a canceled build must not wedge the stage forever;
    // a live or queued run keeps the claim (dedupe).
    const changed = await this.db.execute(
      `UPDATE world_stage_states SET
         status = 'queued', trigger_reason = ?, trigger_dedupe_key = ?, triggered_at = ?, updated_at = ?
       WHERE plan_id = ? AND stage_index = ? AND (
         status IN ('untriggered', 'failed')
         OR (run_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM world_build_runs r
            WHERE r.run_id = world_stage_states.run_id
              AND r.status IN ('canceled', 'failed_terminal'))))`,
      [input.reason, input.dedupeKey, input.now, input.now, input.planId, input.stageIndex],
    );
    return changed > 0;
  }

  /** Forward-only lifecycle transition; no return to earlier states. */
  async setStageStatus(input: {
    planId: string;
    stageIndex: number;
    status: StageStatus;
    runId?: string | null;
    packageRevision?: number | null;
    now: string;
  }): Promise<boolean> {
    const changed = await this.db.execute(
      `UPDATE world_stage_states SET
         status = ?, run_id = COALESCE(?, run_id),
         package_revision = COALESCE(?, package_revision), updated_at = ?
       WHERE plan_id = ? AND stage_index = ?`,
      [
        input.status, input.runId ?? null, input.packageRevision ?? null, input.now,
        input.planId, input.stageIndex,
      ],
    );
    return changed > 0;
  }

  // -------------------------------------------------------------------
  // Campaign package advances (activation at safe boundaries)
  // -------------------------------------------------------------------

  /**
   * Records a package-revision advance for a campaign branch at a specific
   * state version (the safe boundary where the turn contract was frozen).
   * Idempotent per (campaign, branch, state_version).
   */
  async recordPackageAdvance(input: {
    campaignId: string;
    branchId: string;
    stateVersion: number;
    fromRevision: number;
    toRevision: number;
    reason: string;
    now: string;
  }): Promise<void> {
    await this.db.execute(
      `INSERT INTO campaign_package_advances
        (campaign_id, branch_id, state_version, from_revision, to_revision, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id, branch_id, state_version) DO NOTHING`,
      [
        input.campaignId, input.branchId, input.stateVersion,
        input.fromRevision, input.toRevision, input.reason, input.now,
      ],
    );
  }

  /**
   * The package revision a branch effectively plays with: the base locked
   * revision advanced by every recorded advance at or before the branch's
   * current state version. Old saves without advances keep their base.
   */
  async resolveEffectiveRevision(input: {
    campaignId: string;
    branchId: string;
    stateVersion: number;
  }): Promise<number | null> {
    const row = await this.db.queryOne<{ to_revision: number }>(
      `SELECT to_revision FROM campaign_package_advances
        WHERE campaign_id = ? AND branch_id = ? AND state_version <= ?
        ORDER BY state_version DESC LIMIT 1`,
      [input.campaignId, input.branchId, input.stateVersion],
    );
    return row ? row.to_revision : null;
  }

  async listPackageAdvances(input: {
    campaignId: string;
    branchId: string;
  }): Promise<Array<{
    stateVersion: number; fromRevision: number; toRevision: number; reason: string; createdAt: string;
  }>> {
    const rows = await this.db.queryAll<{
      state_version: number; from_revision: number; to_revision: number; reason: string; created_at: string;
    }>(
      `SELECT state_version, from_revision, to_revision, reason, created_at
         FROM campaign_package_advances
        WHERE campaign_id = ? AND branch_id = ? ORDER BY state_version`,
      [input.campaignId, input.branchId],
    );
    return rows.map(row => ({
      stateVersion: row.state_version,
      fromRevision: row.from_revision,
      toRevision: row.to_revision,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }
}

function planFromRow(row: PlanRow): StoredStagePlan {
  const parsed = JSON.parse(row.stages_json) as { planVersion: string; stages: StagePlan['stages'] };
  if (parsed.planVersion !== STAGE_PLAN_VERSION) {
    throw new Error(`Unsupported persisted stage plan version ${parsed.planVersion}.`);
  }
  return {
    planId: row.plan_id,
    worldId: row.world_id,
    sourceId: row.source_id,
    sourceHash: row.source_hash,
    strategy: row.strategy as 'full' | 'progressive',
    stages: parsed.stages,
    configFingerprint: row.config_fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stateFromRow(row: StateRow): StageStateRecord {
  return {
    planId: row.plan_id,
    stageIndex: row.stage_index,
    status: row.status as StageStatus,
    runId: row.run_id,
    packageRevision: row.package_revision,
    triggerReason: row.trigger_reason,
    triggerDedupeKey: row.trigger_dedupe_key,
    triggeredAt: row.triggered_at,
    updatedAt: row.updated_at,
  };
}

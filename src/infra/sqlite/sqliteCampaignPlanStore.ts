import type { SqliteDatabase, SqliteTransaction } from '../../application/ports/sqlite';
import type {
  CampaignContentArtifactV1,
  CampaignIntentV1,
  CampaignPlanV1,
} from '../../domain/campaignPlan/types';

/**
 * Campaign plan persistence (P9-2, PROTOCOL_BASELINE.md §4): setups, jobs
 * (lease/fence/CAS), candidates, immutable plan revisions and content
 * artifacts. Backgrond workers only write candidates; adopting a plan
 * revision happens inside the caller's campaign transaction via `guard`.
 */

export type CampaignSetupStatus = 'draft' | 'planning' | 'proposal_ready' | 'adopted' | 'failed' | 'cancelled';
export type CampaignJobStatus =
  | 'queued' | 'running' | 'candidate_ready' | 'adopted'
  | 'retryable_failed' | 'outcome_unknown' | 'invalid' | 'stale' | 'cancelled';
export type CampaignCandidateStage =
  | 'raw_response' | 'parsed' | 'validated' | 'compiled' | 'ready' | 'rejected' | 'repairing';

export interface CampaignSetupRecord {
  setupId: string;
  worldId: string;
  packageRevision: number;
  intent: CampaignIntentV1;
  intentHistory: CampaignIntentV1[];
  currentCandidateId: string | null;
  status: CampaignSetupStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignPlanJobRecord {
  jobId: string;
  setupId: string;
  campaignId: string | null;
  branchId: string | null;
  jobKind: 'opening_plan' | 'replan';
  triggerReasons: string[];
  baseStateVersion: number | null;
  basePlanId: string | null;
  basePlanRevision: number | null;
  intentHash: string;
  contentManifestHash: string | null;
  knowledgePolicyHash: string | null;
  triggerEventRefs: string[];
  status: CampaignJobStatus;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  fencingToken: number;
  attemptCount: number;
  nextRetryAt: string | null;
  physicalRequestBudget: number;
  freezeRootId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignPlanCandidateRecord {
  candidateId: string;
  jobId: string;
  setupId: string;
  attemptGroup: string;
  attemptNo: number;
  stage: CampaignCandidateStage;
  rawResponseRef: string | null;
  rawResponseText: string | null;
  parseResultJson: string | null;
  validationErrors: string[];
  repairUsed: boolean;
  candidateHash: string;
  plan: CampaignPlanV1 | null;
  artifact: CampaignContentArtifactV1 | null;
  createdAt: string;
  updatedAt: string;
}

interface SetupRow extends Record<string, string | number | null> {
  setup_id: string; world_id: string; package_revision: number;
  intent_json: string; intent_history_json: string; current_candidate_id: string | null;
  status: string; created_at: string; updated_at: string;
}

interface JobRow extends Record<string, string | number | null> {
  job_id: string; setup_id: string; campaign_id: string | null; branch_id: string | null;
  job_kind: string; trigger_reasons_json: string; base_state_version: number | null;
  base_plan_id: string | null; base_plan_revision: number | null; intent_hash: string;
  content_manifest_hash: string | null; knowledge_policy_hash: string | null;
  trigger_event_refs_json: string; status: string; lease_owner: string | null;
  lease_expires_at: string | null; fencing_token: number; attempt_count: number;
  next_retry_at: string | null; physical_request_budget: number; freeze_root_id: string | null;
  last_error: string | null; created_at: string; updated_at: string;
}

interface CandidateRow extends Record<string, string | number | null> {
  candidate_id: string; job_id: string; setup_id: string; attempt_group: string;
  attempt_no: number; stage: string; raw_response_ref: string | null; raw_response_text: string | null;
  parse_result_json: string | null; validation_errors_json: string; repair_used: number;
  candidate_hash: string; plan_json: string | null; artifact_json: string | null;
  created_at: string; updated_at: string;
}

function parseIntentJson(json: string): CampaignIntentV1 {
  return JSON.parse(json) as CampaignIntentV1;
}

export class SqliteCampaignPlanStore {
  constructor(private readonly db: SqliteDatabase) {}

  // ---------------- setups ----------------

  async upsertSetup(setup: CampaignSetupRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO campaign_setups
        (setup_id, world_id, package_revision, intent_json, intent_history_json, current_candidate_id, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(setup_id) DO UPDATE SET
         intent_json=excluded.intent_json, intent_history_json=excluded.intent_history_json,
         current_candidate_id=excluded.current_candidate_id, status=excluded.status, updated_at=excluded.updated_at`,
      [setup.setupId, setup.worldId, setup.packageRevision,
        JSON.stringify(setup.intent), JSON.stringify(setup.intentHistory),
        setup.currentCandidateId, setup.status, setup.createdAt, setup.updatedAt],
    );
  }

  async getSetup(setupId: string): Promise<CampaignSetupRecord | null> {
    const row = await this.db.queryOne<SetupRow>(
      'SELECT * FROM campaign_setups WHERE setup_id = ?', [setupId]);
    if (!row) return null;
    return {
      setupId: row.setup_id, worldId: row.world_id, packageRevision: row.package_revision,
      intent: parseIntentJson(row.intent_json),
      intentHistory: JSON.parse(row.intent_history_json) as CampaignIntentV1[],
      currentCandidateId: row.current_candidate_id,
      status: row.status as CampaignSetupStatus,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  /** Invalidates a ready proposal when the user edits intent/protagonist/anchor. */
  async invalidateSetupCandidate(setupId: string, now: string): Promise<boolean> {
    return (await this.db.execute(
      `UPDATE campaign_setups SET status='planning', current_candidate_id=NULL, updated_at=?
       WHERE setup_id=? AND status='proposal_ready'`,
      [now, setupId],
    )) === 1;
  }

  async deleteSetup(setupId: string): Promise<void> {
    await this.db.transaction(async tx => {
      await tx.execute(
        'UPDATE campaign_plan_jobs SET status=\'cancelled\', updated_at=? WHERE setup_id=? AND status IN (\'queued\',\'running\',\'candidate_ready\')',
        [new Date().toISOString(), setupId]);
      await tx.execute('DELETE FROM campaign_setups WHERE setup_id=?', [setupId]);
    });
  }

  // ---------------- jobs (lease + fence + single-flight) ----------------

  async insertJob(job: CampaignPlanJobRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO campaign_plan_jobs
        (job_id, setup_id, campaign_id, branch_id, job_kind, trigger_reasons_json, base_state_version,
         base_plan_id, base_plan_revision, intent_hash, content_manifest_hash, knowledge_policy_hash,
         trigger_event_refs_json, status, lease_owner, lease_expires_at, fencing_token, attempt_count,
         next_retry_at, physical_request_budget, freeze_root_id, last_error, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [job.jobId, job.setupId, job.campaignId, job.branchId, job.jobKind,
        JSON.stringify(job.triggerReasons), job.baseStateVersion, job.basePlanId, job.basePlanRevision,
        job.intentHash, job.contentManifestHash, job.knowledgePolicyHash,
        JSON.stringify(job.triggerEventRefs), job.status, null, null, 0, 0,
        null, job.physicalRequestBudget, null, null, job.createdAt, job.updatedAt],
    );
  }

  /**
   * Merges a duplicate trigger into an existing in-flight job for the same
   * branch+kind (single-flight), or inserts a new queued job. Returns the
   * surviving job id and whether an existing job absorbed the trigger.
   */
  async enqueueJobMergingTriggers(job: CampaignPlanJobRecord, newReasons: string[], now: string): Promise<{ jobId: string; merged: boolean }> {
    if (job.branchId) {
      const existing = await this.db.queryOne<{ job_id: string; trigger_reasons_json: string }>(
        `SELECT job_id, trigger_reasons_json FROM campaign_plan_jobs
         WHERE branch_id=? AND job_kind=? AND status IN ('queued','running','candidate_ready')
         ORDER BY created_at DESC LIMIT 1`,
        [job.branchId, job.jobKind]);
      if (existing) {
        const reasons = JSON.parse(existing.trigger_reasons_json) as string[];
        const mergedReasons = [...new Set([...reasons, ...newReasons])];
        await this.db.execute(
          'UPDATE campaign_plan_jobs SET trigger_reasons_json=?, updated_at=? WHERE job_id=?',
          [JSON.stringify(mergedReasons), now, existing.job_id]);
        return { jobId: existing.job_id, merged: true };
      }
    }
    await this.insertJob(job);
    return { jobId: job.jobId, merged: false };
  }

  async getJob(jobId: string): Promise<CampaignPlanJobRecord | null> {
    const row = await this.db.queryOne<JobRow>('SELECT * FROM campaign_plan_jobs WHERE job_id=?', [jobId]);
    return row ? rowToJob(row) : null;
  }

  async findActiveJob(branchId: string, kind: 'opening_plan' | 'replan'): Promise<CampaignPlanJobRecord | null> {
    const row = await this.db.queryOne<JobRow>(
      `SELECT * FROM campaign_plan_jobs WHERE branch_id=? AND job_kind=? AND status IN ('queued','running','candidate_ready')
       ORDER BY created_at DESC LIMIT 1`, [branchId, kind]);
    return row ? rowToJob(row) : null;
  }

  async claimJob(jobId: string, leaseOwner: string, leaseExpiresAt: string, now: string): Promise<CampaignPlanJobRecord | null> {
    const updated = await this.db.execute(
      `UPDATE campaign_plan_jobs
       SET status='running', lease_owner=?, lease_expires_at=?, fencing_token=fencing_token+1, updated_at=?
       WHERE job_id=? AND status IN ('queued','retryable_failed') AND (next_retry_at IS NULL OR next_retry_at<=?)`,
      [leaseOwner, leaseExpiresAt, now, jobId, now],
    );
    if (updated !== 1) return null;
    return this.getJob(jobId);
  }

  /** Take-over of an expired lease — fenced by a new token. */
  async reclaimExpiredJob(jobId: string, leaseOwner: string, leaseExpiresAt: string, now: string): Promise<CampaignPlanJobRecord | null> {
    const updated = await this.db.execute(
      `UPDATE campaign_plan_jobs
       SET lease_owner=?, lease_expires_at=?, fencing_token=fencing_token+1, updated_at=?
       WHERE job_id=? AND status='running' AND lease_expires_at<=?`,
      [leaseOwner, leaseExpiresAt, now, jobId, now],
    );
    if (updated !== 1) return null;
    return this.getJob(jobId);
  }

  /** All job status transitions are fenced: only the current token owner wins. */
  async transitionJob(jobId: string, expectedFencingToken: number, next: CampaignJobStatus,
    patch: { lastError?: string | null; nextRetryAt?: string | null; freezeRootId?: string | null; attemptCount?: number } = {},
    now = new Date().toISOString()): Promise<boolean> {
    const updated = await this.db.execute(
      `UPDATE campaign_plan_jobs SET status=?, last_error=?, next_retry_at=?, freeze_root_id=?, attempt_count=?,
         lease_owner=NULL, lease_expires_at=NULL, updated_at=?
       WHERE job_id=? AND fencing_token=?`,
      [next, patch.lastError ?? null, patch.nextRetryAt ?? null, patch.freezeRootId ?? null,
        patch.attemptCount ?? 0, now, jobId, expectedFencingToken],
    );
    return updated === 1;
  }

  // ---------------- candidates ----------------

  async upsertCandidate(candidate: CampaignPlanCandidateRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO campaign_plan_candidates
        (candidate_id, job_id, setup_id, attempt_group, attempt_no, stage, raw_response_ref, raw_response_text,
         parse_result_json, validation_errors_json, repair_used, candidate_hash, plan_json, artifact_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(job_id, attempt_group, attempt_no) DO UPDATE SET
         stage=excluded.stage, raw_response_ref=excluded.raw_response_ref, raw_response_text=excluded.raw_response_text,
         parse_result_json=excluded.parse_result_json, validation_errors_json=excluded.validation_errors_json,
         repair_used=excluded.repair_used, candidate_hash=excluded.candidate_hash, plan_json=excluded.plan_json,
         artifact_json=excluded.artifact_json, updated_at=excluded.updated_at`,
      [candidate.candidateId, candidate.jobId, candidate.setupId, candidate.attemptGroup, candidate.attemptNo,
        candidate.stage, candidate.rawResponseRef, candidate.rawResponseText, candidate.parseResultJson,
        JSON.stringify(candidate.validationErrors), candidate.repairUsed ? 1 : 0, candidate.candidateHash,
        candidate.plan ? JSON.stringify(candidate.plan) : null,
        candidate.artifact ? JSON.stringify(candidate.artifact) : null,
        candidate.createdAt, candidate.updatedAt],
    );
  }

  async getCandidate(candidateId: string): Promise<CampaignPlanCandidateRecord | null> {
    const row = await this.db.queryOne<CandidateRow>(
      'SELECT * FROM campaign_plan_candidates WHERE candidate_id=?', [candidateId]);
    return row ? rowToCandidate(row) : null;
  }

  async latestCandidateForJob(jobId: string): Promise<CampaignPlanCandidateRecord | null> {
    const row = await this.db.queryOne<CandidateRow>(
      'SELECT * FROM campaign_plan_candidates WHERE job_id=? ORDER BY attempt_no DESC, updated_at DESC LIMIT 1', [jobId]);
    return row ? rowToCandidate(row) : null;
  }

  async markCandidateStage(candidateId: string, stage: CampaignCandidateStage, validationErrors: string[], now: string): Promise<void> {
    await this.db.execute(
      'UPDATE campaign_plan_candidates SET stage=?, validation_errors_json=?, updated_at=? WHERE candidate_id=?',
      [stage, JSON.stringify(validationErrors), now, candidateId]);
  }

  // ---------------- revisions & artifacts (immutable archives) ----------------

  async archivePlanRevision(tx: SqliteTransaction, input: {
    plan: CampaignPlanV1; intent: CampaignIntentV1; setupId: string | null; campaignId: string | null; sourceTrigger: string;
    intentHash: string; adoptedAt: string;
  }): Promise<void> {
    await tx.execute(
      `INSERT OR REPLACE INTO campaign_plan_revisions
        (plan_id, revision, parent_revision, setup_id, campaign_id, source_trigger, intent_json, plan_json, intent_hash, content_hash, adopted_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [input.plan.planId, input.plan.revision, input.plan.parentRevision, input.setupId, input.campaignId,
        input.sourceTrigger, JSON.stringify(input.intent), JSON.stringify(input.plan), input.intentHash, input.plan.contentHash, input.adoptedAt, input.adoptedAt],
    );
  }

  async getPlanRevision(planId: string, revision: number): Promise<{ plan: CampaignPlanV1; intent: CampaignIntentV1 } | null> {
    const row = await this.db.queryOne<{ plan_json: string; intent_json: string }>(
      'SELECT plan_json, intent_json FROM campaign_plan_revisions WHERE plan_id=? AND revision=?', [planId, revision]);
    if (!row) return null;
    return { plan: JSON.parse(row.plan_json) as CampaignPlanV1, intent: JSON.parse(row.intent_json) as CampaignIntentV1 };
  }

  async archiveArtifact(tx: SqliteTransaction, artifact: CampaignContentArtifactV1, now: string): Promise<void> {
    await tx.execute(
      `INSERT OR REPLACE INTO campaign_content_artifacts
        (artifact_id, campaign_id, plan_id, plan_revision, scope, artifact_json, content_hash, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [artifact.artifactId, artifact.campaignId, artifact.planId, artifact.planRevision,
        artifact.scope, JSON.stringify(artifact), artifact.contentHash, now],
    );
  }

  async getArtifact(artifactId: string): Promise<CampaignContentArtifactV1 | null> {
    const row = await this.db.queryOne<{ artifact_json: string }>(
      'SELECT artifact_json FROM campaign_content_artifacts WHERE artifact_id=?', [artifactId]);
    return row ? JSON.parse(row.artifact_json) as CampaignContentArtifactV1 : null;
  }

  async listArtifactsForCampaign(campaignId: string): Promise<CampaignContentArtifactV1[]> {
    const rows = await this.db.queryAll<{ artifact_json: string }>(
      'SELECT artifact_json FROM campaign_content_artifacts WHERE campaign_id=? ORDER BY created_at ASC', [campaignId]);
    return rows.map(row => JSON.parse(row.artifact_json) as CampaignContentArtifactV1);
  }
}

function rowToJob(row: JobRow): CampaignPlanJobRecord {
  return {
    jobId: row.job_id, setupId: row.setup_id, campaignId: row.campaign_id, branchId: row.branch_id,
    jobKind: row.job_kind as CampaignPlanJobRecord['jobKind'],
    triggerReasons: JSON.parse(row.trigger_reasons_json) as string[],
    baseStateVersion: row.base_state_version, basePlanId: row.base_plan_id, basePlanRevision: row.base_plan_revision,
    intentHash: row.intent_hash, contentManifestHash: row.content_manifest_hash,
    knowledgePolicyHash: row.knowledge_policy_hash,
    triggerEventRefs: JSON.parse(row.trigger_event_refs_json) as string[],
    status: row.status as CampaignJobStatus,
    leaseOwner: row.lease_owner, leaseExpiresAt: row.lease_expires_at,
    fencingToken: row.fencing_token, attemptCount: row.attempt_count,
    nextRetryAt: row.next_retry_at, physicalRequestBudget: row.physical_request_budget,
    freezeRootId: row.freeze_root_id, lastError: row.last_error,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function rowToCandidate(row: CandidateRow): CampaignPlanCandidateRecord {
  return {
    candidateId: row.candidate_id, jobId: row.job_id, setupId: row.setup_id,
    attemptGroup: row.attempt_group, attemptNo: row.attempt_no,
    stage: row.stage as CampaignCandidateStage,
    rawResponseRef: row.raw_response_ref, rawResponseText: row.raw_response_text,
    parseResultJson: row.parse_result_json,
    validationErrors: JSON.parse(row.validation_errors_json) as string[],
    repairUsed: row.repair_used === 1,
    candidateHash: row.candidate_hash,
    plan: row.plan_json ? JSON.parse(row.plan_json) as CampaignPlanV1 : null,
    artifact: row.artifact_json ? JSON.parse(row.artifact_json) as CampaignContentArtifactV1 : null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

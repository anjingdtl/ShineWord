import type { ApiProfile } from '../llm/types';
import { llmModelProfileFingerprint } from '../llm/profileFingerprint';
import type { SqliteDatabase, SqliteTransaction } from '../ports/sqlite';
import { SqliteCampaignPlanStore, type CampaignPlanJobRecord } from '../../infra/sqlite/sqliteCampaignPlanStore';
import { canonicalJsonOf, sha256HexOf } from './hashing';
import { readPlanFreeze } from './jobFreeze';

type Db = SqliteDatabase | SqliteTransaction;
interface FreezeRow extends Record<string, string | number | null> { root_id: string; campaign_id: string; branch_id: string; turn_id: string; logical_request_id: string; payload_json: string; content_hash: string }
interface AttemptRow extends Record<string, string | number | null> { attempt_id: string; attempt_no: number; status: string; request_kind: string | null; campaign_id: string | null; branch_id: string | null; world_id: string | null; state_version: number | null; replay_approved_at: number | null; model_profile_fingerprint: string | null }
interface CandidateRow extends Record<string, string | number | null> { attempt_no: number; stage: string; raw_response_text: string | null; candidate_hash: string; repair_used: number }
interface ExistingApproval extends Record<string, string | number | null> {
  source_job_id: string; linked_job_id: string; source_freeze_root_id: string; linked_freeze_root_id: string;
  fence_hash: string; profile_fingerprint: string; freeze_content_hash: string; attempt_ids_json: string;
}

export interface CampaignPlanUnknownReplayPreview {
  sourceJobId: string;
  linkedJobId: string | null;
  setupId: string;
  jobKind: 'opening_plan' | 'replan';
  campaignId: string | null;
  branchId: string | null;
  freezeRootId: string;
  freezeContentHash: string;
  profileFingerprint: string;
  attemptIds: string[];
  remainingPhysicalRequestBudget: number;
  approvalFingerprint: string | null;
  alreadyApproved: boolean;
}

async function validateExistingApproval(db: Db, sourceJobId: string, profileFingerprint: string): Promise<{
  approval: ExistingApproval; linkedJob: CampaignPlanJobRecord; attemptIds: string[];
}> {
  const approval = await db.queryOne<ExistingApproval>(
    'SELECT source_job_id,linked_job_id,source_freeze_root_id,linked_freeze_root_id,fence_hash,profile_fingerprint,freeze_content_hash,attempt_ids_json FROM campaign_plan_replay_approvals WHERE source_job_id=?', [sourceJobId]);
  if (!approval) throw new Error('campaign_plan_replay_approval_missing');
  if (approval.profile_fingerprint !== profileFingerprint || approval.source_freeze_root_id !== `campaign-job:${sourceJobId}`
    || approval.linked_freeze_root_id !== `campaign-job:${approval.linked_job_id}`) throw new Error('campaign_plan_replay_approval_binding_changed');
  let attemptIds: string[];
  try {
    const parsed: unknown = JSON.parse(approval.attempt_ids_json);
    if (!Array.isArray(parsed) || parsed.some(id => typeof id !== 'string')) throw new Error();
    attemptIds = parsed;
  } catch { throw new Error('campaign_plan_replay_approval_attempts_corrupt'); }
  const source = await db.queryOne<{ payload_json: string; content_hash: string }>(
    'SELECT payload_json,content_hash FROM frozen_turn_material_roots WHERE root_id=?', [approval.source_freeze_root_id]);
  const linked = await db.queryOne<{ payload_json: string; content_hash: string }>(
    'SELECT payload_json,content_hash FROM frozen_turn_material_roots WHERE root_id=?', [approval.linked_freeze_root_id]);
  if (!source || !linked || source.content_hash !== approval.freeze_content_hash || linked.content_hash !== approval.freeze_content_hash
    || sha256HexOf(source.payload_json) !== approval.freeze_content_hash || source.payload_json !== linked.payload_json) {
    throw new Error('campaign_plan_replay_approval_freeze_changed');
  }
  const store = new SqliteCampaignPlanStore(db as SqliteDatabase);
  const sourceJob = await store.getJob(sourceJobId);
  const linkedJob = await store.getJob(approval.linked_job_id);
  if (!sourceJob || sourceJob.status !== 'outcome_unknown' || sourceJob.freezeRootId !== approval.source_freeze_root_id
    || !linkedJob || linkedJob.freezeRootId !== approval.linked_freeze_root_id) throw new Error('campaign_plan_replay_approval_job_changed');
  const attempts = await db.queryAll<AttemptRow>(
    `SELECT attempt_id,attempt_no,status,request_kind,campaign_id,branch_id,world_id,state_version,replay_approved_at,model_profile_fingerprint
     FROM llm_request_attempts WHERE logical_request_id=? ORDER BY attempt_no`, [planLogicalId(sourceJobId)]);
  if (canonicalJsonOf(attempts.map(attempt => attempt.attempt_id)) !== canonicalJsonOf(attemptIds)
    || attempts.some(attempt => attempt.status === 'outcome_unknown'
      ? attempt.replay_approved_at === null || attempt.request_kind !== 'campaign_plan' || attempt.model_profile_fingerprint !== profileFingerprint
      : attempt.status === 'prepared' || attempt.status === 'sent' || attempt.replay_approved_at !== null)) {
    throw new Error('campaign_plan_replay_approval_attempt_changed');
  }
  return { approval, linkedJob, attemptIds };
}

interface InspectedSource {
  job: CampaignPlanJobRecord;
  freezeRow: FreezeRow;
  freeze: NonNullable<Awaited<ReturnType<typeof readPlanFreeze>>>;
  profileFingerprint: string;
  attemptRows: AttemptRow[];
  unapprovedUnknownIds: string[];
  candidate: CandidateRow | null;
  remainingBudget: number;
  fence: Record<string, unknown>;
  fenceHash: string;
}

function planLogicalId(jobId: string): string { return `campaign-plan:${jobId}`; }
function parseSnapshot(value: string): Record<string, unknown> {
  try { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed as Record<string, unknown>; }
  catch { throw new Error('campaign_plan_replay_state_corrupt'); }
}

async function inspectSource(db: Db, sourceJobId: string, activeProfile: ApiProfile): Promise<InspectedSource> {
  const store = new SqliteCampaignPlanStore(db as SqliteDatabase);
  const job = await store.getJob(sourceJobId);
  if (!job || job.status !== 'outcome_unknown') throw new Error('campaign_plan_replay_source_not_unknown');
  if (job.jobKind !== 'opening_plan' && job.jobKind !== 'replan') throw new Error('campaign_plan_replay_kind_invalid');
  const expectedRoot = `campaign-job:${sourceJobId}`;
  if (job.freezeRootId !== expectedRoot) throw new Error('campaign_plan_replay_freeze_root_mismatch');
  const freezeRow = await db.queryOne<FreezeRow>(
    'SELECT root_id,campaign_id,branch_id,turn_id,logical_request_id,payload_json,content_hash FROM frozen_turn_material_roots WHERE root_id=?', [expectedRoot]);
  if (!freezeRow || freezeRow.turn_id !== sourceJobId || freezeRow.logical_request_id !== planLogicalId(sourceJobId)
    // Plan freezes use a stable setup namespace for both opening plans and
    // replans. Replan jobs intentionally point at `replan:<campaignId>` and
    // their live campaign/branch bindings are checked below against the job
    // and frozen state, rather than being substituted into these provenance
    // columns.
    || freezeRow.campaign_id !== `setup:${job.setupId}`
    || freezeRow.branch_id !== job.setupId
    || sha256HexOf(freezeRow.payload_json) !== freezeRow.content_hash) throw new Error('campaign_plan_replay_freeze_invalid');
  const freeze = await readPlanFreeze(db as SqliteDatabase, sourceJobId);
  if (!freeze) throw new Error('campaign_plan_replay_freeze_missing');
  const frozenProfileFingerprint = llmModelProfileFingerprint(freeze.profile);
  const activeProfileFingerprint = llmModelProfileFingerprint(activeProfile);
  if (frozenProfileFingerprint !== activeProfileFingerprint) throw new Error('campaign_plan_replay_profile_changed');
  if (sha256HexOf(canonicalJsonOf(freeze.intent)) !== job.intentHash) throw new Error('campaign_plan_replay_intent_hash_mismatch');

  if (job.jobKind === 'opening_plan') {
    const setup = await store.getSetup(job.setupId);
    if (!setup || ['cancelled', 'adopted'].includes(setup.status)
      || sha256HexOf(canonicalJsonOf(setup.intent)) !== job.intentHash
      || setup.intent.setupId !== freeze.intent.setupId
      || setup.worldId !== freeze.intent.sourceCoverageBinding.worldId
      || setup.packageRevision !== freeze.intent.sourceCoverageBinding.packageRevision
      || job.campaignId !== null || job.branchId !== null) {
      throw new Error('campaign_plan_replay_setup_fence_changed');
    }
  } else {
    // Replan jobs use a synthetic setup namespace and therefore have no row in
    // campaign_setups. Bind them to the live adopted campaign, branch, runtime
    // intent and plan revision below instead of requiring an opening setup.
    if (!job.campaignId || !job.branchId || job.setupId !== `replan:${job.campaignId}`) {
      throw new Error('campaign_plan_replay_setup_fence_changed');
    }
    const binding = await db.queryOne<{ campaign_id: string; world_id: string }>(
      `SELECT c.campaign_id,c.world_id FROM campaigns c JOIN branches b ON b.campaign_id=c.campaign_id
       WHERE c.campaign_id=? AND b.branch_id=?`, [job.campaignId, job.branchId]);
    if (!binding || binding.campaign_id !== job.campaignId
      || binding.world_id !== freeze.intent.sourceCoverageBinding.worldId) {
      throw new Error('campaign_plan_replay_setup_fence_changed');
    }
  }
  const packageRow = await db.queryOne<{ content_hash: string }>(
    'SELECT content_hash FROM world_packages WHERE world_id=? AND revision=?',
    [freeze.intent.sourceCoverageBinding.worldId, freeze.intent.sourceCoverageBinding.packageRevision]);
  if (!packageRow || packageRow.content_hash !== freeze.intent.sourceCoverageBinding.packageContentHash) {
    throw new Error('campaign_plan_replay_source_package_changed');
  }

  let stateFence: Record<string, unknown> | null = null;
  if (job.jobKind === 'replan') {
    if (!job.branchId || !job.campaignId || !Number.isInteger(job.baseStateVersion) || !freeze.baseState?.campaignRuntime
      || !freeze.basePlan || !job.basePlanId || !Number.isInteger(job.basePlanRevision)) {
      throw new Error('campaign_plan_replay_base_binding_missing');
    }
    const current = await db.queryOne<{ state_version: number; snapshot_json: string; state_hash: string | null }>(
      'SELECT state_version,snapshot_json,state_hash FROM snapshots WHERE branch_id=? ORDER BY state_version DESC LIMIT 1', [job.branchId]);
    if (!current || current.state_version !== job.baseStateVersion || freeze.baseState.stateVersion !== current.state_version) {
      throw new Error('campaign_plan_replay_state_version_changed');
    }
    const liveState = parseSnapshot(current.snapshot_json);
    const runtime = liveState.campaignRuntime as { planBinding?: { planId?: string; revision?: number }; intent?: unknown } | undefined;
    if (!runtime?.planBinding || runtime.planBinding.planId !== job.basePlanId || runtime.planBinding.revision !== job.basePlanRevision
      || runtime.planBinding.planId !== freeze.basePlan.planId || runtime.planBinding.revision !== freeze.basePlan.revision
      || canonicalJsonOf(liveState) !== canonicalJsonOf(freeze.baseState)) {
      throw new Error('campaign_plan_replay_state_or_plan_changed');
    }
    const liveIntent = runtime.intent ?? freeze.intent;
    if (sha256HexOf(canonicalJsonOf(liveIntent)) !== job.intentHash) throw new Error('campaign_plan_replay_intent_changed');
    stateFence = { branchId: job.branchId, campaignId: job.campaignId, stateVersion: current.state_version,
      stateHash: current.state_hash, basePlanId: job.basePlanId, basePlanRevision: job.basePlanRevision };
  }

  const attemptRows = await db.queryAll<AttemptRow>(
    `SELECT attempt_id,attempt_no,status,request_kind,campaign_id,branch_id,world_id,state_version,replay_approved_at,model_profile_fingerprint
     FROM llm_request_attempts WHERE logical_request_id=? ORDER BY attempt_no`, [planLogicalId(sourceJobId)]);
  const unknown = attemptRows.filter(attempt => attempt.status === 'outcome_unknown' && attempt.replay_approved_at === null);
  if (unknown.length === 0 || attemptRows.some(attempt => attempt.request_kind !== 'campaign_plan'
    || attempt.model_profile_fingerprint !== frozenProfileFingerprint || attempt.replay_approved_at !== null
    || attempt.world_id !== freeze.intent.sourceCoverageBinding.worldId || attempt.branch_id !== job.branchId
    || (attempt.campaign_id !== null && attempt.campaign_id !== job.campaignId)
    || (attempt.state_version !== null && attempt.state_version !== job.baseStateVersion)
    || !Number.isInteger(attempt.attempt_no) || !attempt.attempt_id)) {
    throw new Error('campaign_plan_replay_attempt_binding_invalid');
  }
  if (attemptRows.some(attempt => ['prepared', 'sent'].includes(attempt.status))) throw new Error('campaign_plan_replay_attempt_still_running');
  const remainingBudget = Math.max(0, job.physicalRequestBudget - attemptRows.length);
  if (remainingBudget < 1) throw new Error('campaign_plan_replay_physical_budget_exhausted');

  const candidate = await db.queryOne<CandidateRow>(
    'SELECT attempt_no,stage,raw_response_text,candidate_hash,repair_used FROM campaign_plan_candidates WHERE job_id=? ORDER BY attempt_no DESC,updated_at DESC LIMIT 1', [sourceJobId]);
  if (candidate && (candidate.stage !== 'raw_response' || candidate.raw_response_text === null
    || sha256HexOf(candidate.raw_response_text) !== candidate.candidate_hash)) {
    throw new Error('campaign_plan_replay_candidate_not_resumable');
  }
  if (candidate && remainingBudget < 1) throw new Error('campaign_plan_replay_physical_budget_exhausted');

  const attemptIds = attemptRows.map(attempt => attempt.attempt_id);
  const fence = {
    sourceJobId, setupId: job.setupId, jobKind: job.jobKind, campaignId: job.campaignId, branchId: job.branchId,
    baseStateVersion: job.baseStateVersion, basePlanId: job.basePlanId, basePlanRevision: job.basePlanRevision,
    intentHash: job.intentHash, freezeRootId: expectedRoot, freezeContentHash: freezeRow.content_hash,
    profileFingerprint: frozenProfileFingerprint, attemptIds,
    attemptStates: attemptRows.map(attempt => [attempt.attempt_id, attempt.attempt_no, attempt.status,
      attempt.campaign_id, attempt.branch_id, attempt.world_id, attempt.state_version]),
    remainingBudget, stateFence,
  };
  const fenceHash = sha256HexOf(canonicalJsonOf(fence));
  return { job, freezeRow, freeze, profileFingerprint: frozenProfileFingerprint, attemptRows,
    unapprovedUnknownIds: unknown.map(attempt => attempt.attempt_id), candidate, remainingBudget, fence, fenceHash };
}

export async function previewCampaignPlanUnknownReplay(db: SqliteDatabase, sourceJobId: string, activeProfile: ApiProfile): Promise<CampaignPlanUnknownReplayPreview> {
  const profileFingerprint = llmModelProfileFingerprint(activeProfile);
  const approval = await db.queryOne<ExistingApproval>('SELECT source_job_id,linked_job_id,source_freeze_root_id,linked_freeze_root_id,fence_hash,profile_fingerprint,freeze_content_hash,attempt_ids_json FROM campaign_plan_replay_approvals WHERE source_job_id=?', [sourceJobId]);
  if (approval) {
    const validated = await validateExistingApproval(db, sourceJobId, profileFingerprint);
    const linked = validated.linkedJob;
    return { sourceJobId, linkedJobId: linked.jobId, setupId: linked.setupId, jobKind: linked.jobKind,
      campaignId: linked.campaignId, branchId: linked.branchId, freezeRootId: `campaign-job:${sourceJobId}`,
      freezeContentHash: validated.approval.freeze_content_hash, profileFingerprint, attemptIds: validated.attemptIds,
      remainingPhysicalRequestBudget: linked.physicalRequestBudget, approvalFingerprint: validated.approval.fence_hash, alreadyApproved: true };
  }
  const source = await inspectSource(db, sourceJobId, activeProfile);
  return { sourceJobId, linkedJobId: null, setupId: source.job.setupId, jobKind: source.job.jobKind,
    campaignId: source.job.campaignId, branchId: source.job.branchId, freezeRootId: source.freezeRow.root_id,
    freezeContentHash: source.freezeRow.content_hash, profileFingerprint: source.profileFingerprint,
    attemptIds: source.attemptRows.map(attempt => attempt.attempt_id), remainingPhysicalRequestBudget: source.remainingBudget,
    approvalFingerprint: source.fenceHash, alreadyApproved: false };
}

export async function confirmCampaignPlanUnknownReplay(db: SqliteDatabase, input: {
  sourceJobId: string; approvalFingerprint: string; activeProfile: ApiProfile; now?: () => string;
}): Promise<{ linkedJobId: string; alreadyApproved: boolean }> {
  const now = input.now ?? (() => new Date().toISOString());
  const activeProfileFingerprint = llmModelProfileFingerprint(input.activeProfile);
  return db.transaction(async tx => {
    const existing = await tx.queryOne<ExistingApproval>(
      'SELECT source_job_id,linked_job_id,source_freeze_root_id,linked_freeze_root_id,fence_hash,profile_fingerprint,freeze_content_hash,attempt_ids_json FROM campaign_plan_replay_approvals WHERE source_job_id=?', [input.sourceJobId]);
    if (existing) {
      if (existing.fence_hash !== input.approvalFingerprint || existing.profile_fingerprint !== activeProfileFingerprint) {
        throw new Error('campaign_plan_replay_approval_stale');
      }
      const validated = await validateExistingApproval(tx, input.sourceJobId, activeProfileFingerprint);
      return { linkedJobId: validated.linkedJob.jobId, alreadyApproved: true };
    }

    const source = await inspectSource(tx, input.sourceJobId, input.activeProfile);
    if (source.fenceHash !== input.approvalFingerprint) throw new Error('campaign_plan_replay_preview_stale');
    const linkedJobId = `${input.sourceJobId}-approved-${source.fenceHash.slice(0, 12)}`;
    const sourceJob = source.job;
    const linkedRootId = `campaign-job:${linkedJobId}`;
    const confirmedAt = now();
    const audit = await tx.execute(`INSERT INTO campaign_plan_replay_approvals
      (source_job_id,linked_job_id,source_freeze_root_id,linked_freeze_root_id,freeze_content_hash,profile_fingerprint,attempt_ids_json,fence_json,fence_hash,confirmed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [sourceJob.jobId, linkedJobId, source.freezeRow.root_id, linkedRootId,
        source.freezeRow.content_hash, source.profileFingerprint, JSON.stringify(source.attemptRows.map(attempt => attempt.attempt_id)),
        canonicalJsonOf(source.fence), source.fenceHash, confirmedAt]);
    if (audit !== 1) throw new Error('campaign_plan_replay_audit_write_failed');

    const jobInserted = await tx.execute(`INSERT INTO campaign_plan_jobs
      (job_id,setup_id,campaign_id,branch_id,job_kind,trigger_reasons_json,base_state_version,base_plan_id,base_plan_revision,
       intent_hash,content_manifest_hash,knowledge_policy_hash,trigger_event_refs_json,status,lease_owner,lease_expires_at,
       fencing_token,attempt_count,next_retry_at,physical_request_budget,freeze_root_id,last_error,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',NULL,NULL,0,0,NULL,?,?,NULL,?,?)`, [
      linkedJobId, sourceJob.setupId, sourceJob.campaignId, sourceJob.branchId, sourceJob.jobKind,
      JSON.stringify([`approved_unknown_replay:${sourceJob.jobId}`]), sourceJob.baseStateVersion, sourceJob.basePlanId,
      sourceJob.basePlanRevision, sourceJob.intentHash, sourceJob.contentManifestHash, sourceJob.knowledgePolicyHash,
      JSON.stringify(sourceJob.triggerEventRefs), source.remainingBudget, linkedRootId, confirmedAt, confirmedAt,
    ]);
    if (jobInserted !== 1) throw new Error('campaign_plan_replay_linked_job_write_failed');

    const freezeInserted = await tx.execute(`INSERT INTO frozen_turn_material_roots
      (root_id,campaign_id,branch_id,turn_id,logical_request_id,role,stage,attempt,payload_json,content_hash,created_at)
      SELECT ?,campaign_id,branch_id,?, ?,role,stage,attempt,payload_json,content_hash,?
      FROM frozen_turn_material_roots WHERE root_id=?`, [linkedRootId, linkedJobId, planLogicalId(linkedJobId), confirmedAt, source.freezeRow.root_id]);
    if (freezeInserted !== 1) throw new Error('campaign_plan_replay_linked_freeze_write_failed');
    if (source.candidate) {
      const candidateId = `${linkedJobId}:a1:${source.candidate.attempt_no}`;
      const cloned = await tx.execute(`INSERT INTO campaign_plan_candidates
        (candidate_id,job_id,setup_id,attempt_group,attempt_no,stage,raw_response_ref,raw_response_text,parse_result_json,
         validation_errors_json,repair_used,candidate_hash,plan_json,artifact_json,created_at,updated_at)
        SELECT ?,?,setup_id,attempt_group,attempt_no,stage,?,raw_response_text,parse_result_json,
         validation_errors_json,repair_used,candidate_hash,plan_json,artifact_json,created_at,?
        FROM campaign_plan_candidates WHERE job_id=? ORDER BY attempt_no DESC,updated_at DESC LIMIT 1`,
      [candidateId, linkedJobId, linkedRootId, confirmedAt, sourceJob.jobId]);
      if (cloned !== 1) throw new Error('campaign_plan_replay_candidate_copy_failed');
    }
    for (const attemptId of source.unapprovedUnknownIds) {
      const approved = await tx.execute(`UPDATE llm_request_attempts SET replay_approved_at=?
        WHERE attempt_id=? AND logical_request_id=? AND status='outcome_unknown' AND replay_approved_at IS NULL`,
      [Date.parse(confirmedAt), attemptId, planLogicalId(sourceJob.jobId)]);
      if (approved !== 1) throw new Error('campaign_plan_replay_attempt_changed');
    }
    return { linkedJobId, alreadyApproved: false };
  });
}

export async function approvedCampaignPlanReplayJob(db: SqliteDatabase, sourceJobId: string): Promise<string | null> {
  const row = await db.queryOne<{ linked_job_id: string }>(
    'SELECT linked_job_id FROM campaign_plan_replay_approvals WHERE source_job_id=?', [sourceJobId]);
  return row?.linked_job_id ?? null;
}

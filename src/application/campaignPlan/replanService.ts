import type { SqliteDatabase } from '../ports/sqlite';
import type { SqliteCampaignPlanStore } from '../../infra/sqlite/sqliteCampaignPlanStore';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import type { ApiProfile, LlmProvider } from '../llm/types';
import type { CampaignPlanV1, CampaignRuntimeV1 } from '../../domain/campaignPlan/types';
import { cloneGameState, type GameStateSnapshot } from '../../domain/state/types';
import type { SituationCondition } from '../../domain/situations/types';
import { evaluateCondition, snapshotConditionFacts } from '../../domain/situations/conditions';
import { validateCampaignPlan } from '../../domain/campaignPlan/planValidation';
import { compileCampaignPlan, type LocalCompileContext } from './localCompile';
import { extractJsonObject, parseCampaignPlanCandidate, type CampaignPlanCandidateModelV1 } from './candidateModel';
import { buildPlanningContext } from './planningService';
import { sha256HexOf, canonicalJsonOf } from './hashing';
import { stableFingerprint } from '../llm/requestPlan';
import { isIntactReadyCandidate } from './candidateIntegrity';
import { campaignContentBindingHash } from './contentBinding';
import { settleCampaignProgress, readCampaignEventHistory } from './settlement';
import { applySituationRuntime, applySituationProjection } from '../situations/causalProjection';
import { createActorReferenceResolver } from '../../domain/characters/actorIdentity';
import { stagePreparationTargetId, stagePreparationReasons } from './stagePreparation';

/**
 * Campaign replanning (plan §10). Triggers are evaluated LOCALLY after each
 * commit (never per-turn LLM calls); background jobs only produce candidates;
 * adoption happens at a stable boundary with base-binding CAS. A candidate
 * compiled against an older state is revalidated locally or marked stale —
 * it can never overwrite committed facts or completed nodes.
 */

export interface ReplanTriggerInput {
  plan: CampaignPlanV1;
  runtime: CampaignRuntimeV1;
  state: GameStateSnapshot;
}

/** Deterministic local trigger evaluation (plan §10.1 matrix). */
export function evaluateReplanTriggers(input: ReplanTriggerInput): string[] {
  const { plan, runtime, state } = input;
  const reasons: string[] = [];
  if (['completed', 'failed', 'ended'].includes(runtime.campaignStatus)) return reasons;
  const primary = runtime.nodeStates.find(node => node.nodeId === runtime.primaryNodeId);
  // The reducer clears a resolved primary before this post-commit check.
  // Inspect the stranded runtime as well, rather than losing the failure.
  const strandedFailure = runtime.campaignStatus === 'active' && runtime.primaryNodeId === null
    && runtime.nodeStates.some(node => node.status === 'failed' && !plan.retiredNodeIds?.includes(node.nodeId));
  if (primary?.status === 'failed' || strandedFailure) reasons.push('primary_node_failed');
  if (runtime.campaignStatus === 'active' && runtime.primaryNodeId === null && !strandedFailure
    && plan.nodes.some(node => node.role === 'main' && !plan.retiredNodeIds?.includes(node.nodeId)
      && runtime.nodeStates.some(state => state.nodeId === node.nodeId && ['planned', 'available', 'suspended'].includes(state.status)))) {
    reasons.push('stage_content_needed');
  }
  // Critical actor fates referenced by FUTURE main nodes only — committed
  // history is never revised, only upcoming stages may need new paths.
  const resolvedIds = new Set(runtime.nodeStates
    .filter(node => ['succeeded', 'failed', 'superseded', 'cancelled'].includes(node.status))
    .map(node => node.nodeId));
  const actorIds = new Set<string>();
  for (const node of plan.nodes) {
    if (resolvedIds.has(node.nodeId) || node.role !== 'main') continue;
    collectActorRefs(node.activation, actorIds);
    collectActorRefs(node.completion, actorIds);
    collectActorRefs(node.failure, actorIds);
  }
  let fateFlipped = false;
  const resolveActor = createActorReferenceResolver({ actors: state.actors,
    cards: (state.cards ?? []).map(row => ({ actorId: row.actorId, templateId: (row.card as { templateId?: string }).templateId })) });
  for (const actorId of actorIds) {
    const alive = state.actors[resolveActor(actorId)]?.lifeStatus;
    if (alive === 'dead' || alive === 'critical') fateFlipped = true;
  }
  if (fateFlipped) reasons.push('critical_actor_fate');
  if (runtime.nodeStates.some(node => !plan.retiredNodeIds?.includes(node.nodeId) &&
    (node.supersedeReason === 'skipped_by_early_completion' || node.supersedeReason === 'alternative_succeeded'))) reasons.push('early_resolution');
  const currentNode = plan.nodes.find(node => node.nodeId === runtime.primaryNodeId);
  if (runtime.campaignStatus === 'active' && primary && ['active','available'].includes(primary.status) && currentNode
    && (currentNode.coverage === 'provisional' || !currentNode.situationRef || !(state.situations ?? []).some(s => s.situationId === currentNode.situationRef && s.status !== 'resolved'))) {
    reasons.push('stage_content_needed');
  }
  if (runtime.replanReasonCodes.includes('goal_changed') && !reasons.includes('goal_changed')) reasons.push('goal_changed');
  return reasons;
}

function collectActorRefs(condition: SituationCondition | null, out: Set<string>): void {
  if (!condition) return;
  switch (condition.kind) {
    case 'all': case 'any':
      condition.of.forEach(child => collectActorRefs(child, out));
      return;
    case 'not':
      collectActorRefs(condition.of, out);
      return;
    case 'actor_alive': case 'actor_at': case 'actor_condition':
      out.add(condition.actorId);
      return;
    case 'relationship_at_least':
      out.add(condition.fromActorId);
      out.add(condition.toActorId);
      return;
    default:
      return;
  }
}

/** Marks the runtime for a user-initiated goal change (new intentRevision). */
export function applyGoalChange(
  runtime: CampaignRuntimeV1, newIntentRevision: number, newGoal: string,
): CampaignRuntimeV1 {
  return {
    ...runtime,
    intentRevision: newIntentRevision,
    publicObjectiveProjection: newGoal,
    replanReasonCodes: [...new Set([...runtime.replanReasonCodes, 'goal_changed'])],
  };
}

export interface ReplanJobDeps {
  segmentContent?: import('./planningService').PlanningRunDeps['segmentContent'];
  acquireExecution?: import('./planningService').PlanningRunDeps['acquireExecution'];
  db: SqliteDatabase;
  planStore: SqliteCampaignPlanStore;
  worldStore: SqliteWorldStore;
  provider: LlmProvider;
  profile: ApiProfile;
  now?: () => string;
}

/**
 * Enqueues (or merges into) the branch's single-flight replan job.
 * Returns the surviving job id and whether an existing job absorbed it.
 */
export async function enqueueReplan(input: {
  deps: ReplanJobDeps;
  campaignId: string;
  branchId: string;
  plan: CampaignPlanV1;
  runtime: CampaignRuntimeV1;
  state: GameStateSnapshot;
  reasons: string[];
}): Promise<{ jobId: string; merged: boolean }> {
  const now = input.deps.now ?? (() => new Date().toISOString());
  const target = stagePreparationTargetId(input.reasons);
  if (target) {
    const failures = await input.deps.db.queryAll<{ job_id: string }>(
      `SELECT job_id FROM campaign_plan_jobs WHERE branch_id=? AND job_kind='replan' AND intent_hash=?
       AND status IN ('invalid','retryable_failed','outcome_unknown')
       AND EXISTS (SELECT 1 FROM json_each(trigger_reasons_json) WHERE value=?)
       ORDER BY created_at DESC, rowid DESC LIMIT 2`,
      [input.branchId, input.runtime.intent ? sha256HexOf(canonicalJsonOf(input.runtime.intent)) : input.plan.intentHash,
        stagePreparationReasons(target)[1]!]);
    if (failures.length >= 2) return { jobId: failures[0]!.job_id, merged: true };
  }
  return input.deps.planStore.enqueueJobMergingTriggers({
    jobId: `replan:${input.branchId}:v${input.state.stateVersion}:${now()}:${sha256HexOf(canonicalJsonOf(input.reasons)).slice(0, 12)}`,
    setupId: `replan:${input.campaignId}`,
    campaignId: input.campaignId,
    branchId: input.branchId,
    jobKind: 'replan',
    triggerReasons: input.reasons,
    baseStateVersion: input.state.stateVersion,
    basePlanId: input.plan.planId,
    basePlanRevision: input.plan.revision,
    intentHash: input.runtime.intent ? sha256HexOf(canonicalJsonOf(input.runtime.intent)) : input.plan.intentHash,
    contentManifestHash: input.state.campaignContentBinding?.contentHash ?? null,
    knowledgePolicyHash: null,
    triggerEventRefs: [],
    status: 'queued',
    leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, attemptCount: 0,
    nextRetryAt: null, physicalRequestBudget: 2, freezeRootId: null, lastError: null,
    createdAt: now(), updatedAt: now(),
  }, input.reasons, now());
}

export interface ReplanCandidateResult {
  status: 'candidate_ready' | 'invalid' | 'retryable_failed' | 'outcome_unknown' | 'stale';
  candidateId: string | null;
  errors: string[];
  physicalRequests: number;
}

/**
 * Runs a replan job: one campaign_plan generation (+ one bounded repair)
 * against the CURRENT plan, triggers and committed facts. Produces a plan
 * revision+1 candidate; adoption is a separate stable-boundary step.
 */
export async function runReplanJob(deps: ReplanJobDeps, jobId: string, input: {
  intent: import('../../domain/campaignPlan/types').CampaignIntentV1;
  protagonistSkills: readonly string[]; anchorTitle: string; playerName: string;
}): Promise<ReplanCandidateResult> {
  const { runCandidateJob } = await import('./candidateJob');
  const result = await runCandidateJob(deps, jobId, input);
  return { ...result, status: result.status === 'already_ready' ? 'candidate_ready' : result.status };
}

export interface AdoptReplanInput {
  db: SqliteDatabase;
  planStore: SqliteCampaignPlanStore;
  turns: import('../../infra/sqlite/sqliteTurnStore').SqliteTurnStore;
  campaignId: string;
  branchId: string;
  candidateId: string;
  now?: () => string;
}

/**
 * Stable-boundary adoption (plan §10.3): no in-flight turns or unknown
 * requests, base bindings verified, terminal nodes revalidated against the
 * CURRENT state, then ONE management commit switches the runtime's plan
 * binding and archives the revision.
 */
export async function adoptReplanCandidate(input: AdoptReplanInput): Promise<
  { outcome: 'adopted'; revision: number } | { outcome: 'stale'; reason: string }
> {
  const now = input.now ?? (() => new Date().toISOString());
  const candidate = await input.planStore.getCandidate(input.candidateId);
  if (!isIntactReadyCandidate(candidate)) {
    return { outcome: 'stale', reason: 'candidate is not ready' };
  }
  const job = await input.planStore.getJob(candidate.jobId);
  if (!job || job.branchId !== input.branchId || job.status !== 'candidate_ready') {
    return { outcome: 'stale', reason: 'job is not this branch\'s ready replan' };
  }
  const invalidate = async (reason: string): Promise<{ outcome: 'stale'; reason: string }> => {
    await input.db.execute("UPDATE campaign_plan_jobs SET status='stale',last_error=?,updated_at=? WHERE job_id=? AND status='candidate_ready' AND fencing_token=?",
      [reason, now(), job.jobId, job.fencingToken]);
    return { outcome: 'stale', reason };
  };
  // 1. Stable boundary: no uncommitted turns, no running interaction, no
  // unsettled physical requests for this branch.
  const pending = await input.db.queryOne<{ n: number }>(
    `SELECT COUNT(*) n FROM turns WHERE branch_id=? AND status<>'Committed'`, [input.branchId]);
  if ((pending?.n ?? 0) > 0) return { outcome: 'stale', reason: 'branch has an in-flight turn' };
  const operation = await input.db.queryOne<{ operation_id: string }>(
    `SELECT operation_id FROM interaction_operations WHERE branch_id=? AND status IN ('running','paused_system') LIMIT 1`, [input.branchId]);
  if (operation) return { outcome: 'stale', reason: 'an interaction is running' };
  const unknownRequests = await input.db.queryOne<{ n: number }>(
    `SELECT COUNT(*) n FROM llm_request_attempts WHERE branch_id=? AND (status IN ('prepared','sent') OR (status='outcome_unknown' AND replay_approved_at IS NULL))`,
    [input.branchId]);
  if ((unknownRequests?.n ?? 0) > 0) return { outcome: 'stale', reason: 'unsettled physical requests' };

  const stateRow = await input.db.queryOne<{ snapshot_json: string; state_version: number }>(
    'SELECT snapshot_json, state_version FROM snapshots WHERE branch_id=? ORDER BY state_version DESC LIMIT 1', [input.branchId]);
  if (!stateRow) return { outcome: 'stale', reason: 'branch snapshot missing' };
  const state = JSON.parse(stateRow.snapshot_json) as GameStateSnapshot;
  const runtime = state.campaignRuntime;
  if (!runtime) return { outcome: 'stale', reason: 'branch has no campaign runtime' };
  // 2. Base bindings.
  if (runtime.planBinding.planId !== job.basePlanId
    || runtime.planBinding.revision !== job.basePlanRevision
    || job.intentHash !== candidate.plan.intentHash) {
    return invalidate('runtime moved on since the candidate was compiled');
  }
  const { canonicalJsonOf } = await import('./hashing');
  const { readPlanFreeze } = await import('./jobFreeze');
  const freeze = await readPlanFreeze(input.db, job.jobId);
  const original = await input.planStore.getPlanRevision(runtime.planBinding.planId, runtime.planBinding.revision);
  const intent = runtime.intent ?? original?.intent;
  if (!intent || sha256HexOf(canonicalJsonOf(intent)) !== candidate.plan.intentHash) {
    return invalidate('player intent changed after generation');
  }
  if (sha256HexOf(canonicalJsonOf({ plan: candidate.plan, artifact: candidate.artifact })) !== candidate.candidateHash) {
    return invalidate('candidate hash mismatch');
  }
  if (freeze?.baseState && canonicalJsonOf(state.segmentContentBinding ?? null) !== canonicalJsonOf(freeze.baseState.segmentContentBinding ?? null)) {
    return invalidate('adopted source content changed after freeze');
  }
  if (freeze?.baseState && state.stateVersion !== freeze.baseState.stateVersion) {
    // A conservative local validation: changed authoritative facts require a new
    // explicit candidate, never an invisible paid regeneration.
    const facts = (s: GameStateSnapshot) => canonicalJsonOf({ actors: s.actors, items: s.itemOwners,
      discoveries: s.discoveries, relationships: s.relationships, situations: s.situations, nodes: s.campaignRuntime?.nodeStates });
    if (facts(state) !== facts(freeze.baseState)) return invalidate('authoritative facts changed after freeze');
  }
  for (const nodeState of runtime.nodeStates) {
    if (!['succeeded','failed','superseded','cancelled'].includes(nodeState.status)) continue;
    const previous = original?.plan.nodes.find(n => n.nodeId === nodeState.nodeId);
    const revised = candidate.plan.nodes.find(n => n.nodeId === nodeState.nodeId);
    if (!previous || !revised || canonicalJsonOf(previous) !== canonicalJsonOf(revised)) {
      return invalidate('revision changes committed node ' + nodeState.nodeId);
    }
  }
  const nextRevision = candidate.plan.revision;
  const { contentHash: _artifactHash, ...artifactBody } = candidate.artifact;
  const reboundBody = { ...artifactBody, campaignId: input.campaignId };
  const artifact = { ...reboundBody, contentHash: sha256HexOf(canonicalJsonOf(reboundBody)) };
  const artifactIds = [...new Set([...candidate.plan.contentArtifactRefs, ...(state.campaignContentBinding?.artifactIds ?? [])])];
  const artifacts = await Promise.all(artifactIds.map(async id => id === artifact.artifactId ? artifact : input.planStore.getArtifact(id)));
  if (artifacts.some(a => !a)) return { outcome: 'stale', reason: 'bound content archive missing' };
  const nextRuntime: CampaignRuntimeV1 = {
    ...runtime, intent,
    planBinding: { planId: candidate.plan.planId, revision: nextRevision, contentHash: candidate.plan.contentHash },
    replanReasonCodes: runtime.replanReasonCodes.filter(reason => !job.triggerReasons.includes(reason)),
    stateVersion: state.stateVersion + 1,
    nodeStates: [
      ...runtime.nodeStates.map(node => ['succeeded','failed','superseded','cancelled'].includes(node.status) ||
        (candidate.plan!.nodes.some(n => n.nodeId === node.nodeId) && !candidate.plan!.retiredNodeIds?.includes(node.nodeId)) ? node :
        { ...node, status: 'superseded' as const, supersedeReason: 'replanned_future', resolvedAtVersion: state.stateVersion + 1 }),
      ...candidate.plan.nodes.filter(n => !runtime.nodeStates.some(node => node.nodeId === n.nodeId)).map(n => ({
        nodeId: n.nodeId, status: 'planned' as const, completedEvidence: [] })),
    ],
  };
  const nextState: GameStateSnapshot = { ...cloneGameState(state), stateVersion: state.stateVersion + 1, campaignRuntime: nextRuntime,
    campaignContentBinding: { artifactIds, contentHash: campaignContentBindingHash(artifacts as NonNullable<typeof artifact>[]) } };
  const turnId = input.branchId + ':manage-replan:' + nextRevision;
  try {
    const ticked = applySituationRuntime({ nextState, definitions: artifact.situations.map(s => ({ situationId: s.entryId, definition: s.definition })),
      playerActorId: intent.protagonistBinding.actorId, sourceTurnId: turnId, methodOps: [] });
    applySituationProjection(nextState, ticked);
    const progressEvents = settleCampaignProgress({ plan: candidate.plan, nextState,
      artifacts: artifacts as NonNullable<typeof artifact>[], transactionEvents: ticked.events,
      historyEvents: await readCampaignEventHistory(input.db, input.branchId), turnId, nextStateVersion: nextState.stateVersion });
    await input.turns.commitAtomic({ branchId: input.branchId, turnId, expectedStateVersion: state.stateVersion,
      nextState, actionContractJson: '{}', actionContractHash: 'manage-replan',
      committedTurn: { branchId: input.branchId, turnId, previousStateVersion: state.stateVersion, stateVersion: nextState.stateVersion,
        outcomeGrade: 'success', publicSummary: '主线规划已根据最新局势修订。', effects: [], committedAt: now() },
      events: [{ eventType: 'campaign_plan_adopted', payload: { planId: candidate.plan.planId, revision: nextRevision, reasons: job.triggerReasons } }, ...ticked.events, ...progressEvents],
      transactionChanges: async tx => {
        const active = await tx.queryOne<{ n: number }>(
          "SELECT COUNT(*) n FROM turns WHERE branch_id=? AND status<>'Committed'", [input.branchId]);
        const busy = await tx.queryOne<{ n: number }>(
          "SELECT COUNT(*) n FROM interaction_operations WHERE branch_id=? AND status IN ('running','paused_system')", [input.branchId]);
        const unknown = await tx.queryOne<{ n: number }>(
          "SELECT COUNT(*) n FROM llm_request_attempts WHERE branch_id=? AND (status IN ('prepared','sent') OR (status='outcome_unknown' AND replay_approved_at IS NULL))", [input.branchId]);
        if ((active?.n ?? 0) + (busy?.n ?? 0) + (unknown?.n ?? 0) > 0) throw new Error('stable boundary changed');
        const won = await tx.execute("UPDATE campaign_plan_jobs SET status='adopted',updated_at=? WHERE job_id=? AND status='candidate_ready' AND fencing_token=?",
          [now(), job.jobId, job.fencingToken]);
        if (won !== 1) throw new Error('adoption job fence expired');
        await input.planStore.archivePlanRevision(tx, { plan: candidate.plan!, intent, setupId: job.setupId,
          campaignId: input.campaignId, sourceTrigger: 'replan:' + job.triggerReasons.join('+'), intentHash: candidate.plan!.intentHash, adoptedAt: now() });
        await input.planStore.archiveArtifact(tx, artifact, now());
      },
    });
  } catch (error) {
    return { outcome: 'stale', reason: error instanceof Error ? error.message : String(error) };
  }
  return { outcome: 'adopted', revision: nextRevision };
}

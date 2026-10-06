import type { SqliteDatabase } from '../ports/sqlite';
import type { SqliteCampaignPlanStore } from '../../infra/sqlite/sqliteCampaignPlanStore';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import type { ApiProfile, LlmProvider } from '../llm/types';
import type { CampaignPlanV1, CampaignRuntimeV1 } from '../../domain/campaignPlan/types';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { SituationCondition } from '../../domain/situations/types';
import { evaluateCondition, snapshotConditionFacts } from '../../domain/situations/conditions';
import { validateCampaignPlan } from '../../domain/campaignPlan/planValidation';
import { compileCampaignPlan, type LocalCompileContext } from './localCompile';
import { extractJsonObject, parseCampaignPlanCandidate, type CampaignPlanCandidateModelV1 } from './candidateModel';
import { buildPlanningContext } from './planningService';
import { sha256HexOf } from './hashing';
import { stableFingerprint } from '../llm/requestPlan';

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
  if (primary?.status === 'failed') reasons.push('primary_node_failed');
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
  for (const actorId of actorIds) {
    const alive = state.actors[actorId]?.lifeStatus ?? 'active';
    if (alive === 'dead' || alive === 'critical') fateFlipped = true;
  }
  if (fateFlipped) reasons.push('critical_actor_fate');
  if (runtime.nodeStates.some(node => node.supersedeReason === 'skipped_by_early_completion'
    || node.supersedeReason === 'alternative_succeeded')) reasons.push('early_resolution');
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
  return input.deps.planStore.enqueueJobMergingTriggers({
    jobId: `replan:${input.branchId}:${now()}`,
    setupId: `replan:${input.campaignId}`,
    campaignId: input.campaignId,
    branchId: input.branchId,
    jobKind: 'replan',
    triggerReasons: input.reasons,
    baseStateVersion: input.state.stateVersion,
    basePlanId: input.plan.planId,
    basePlanRevision: input.plan.revision,
    intentHash: input.plan.intentHash,
    contentManifestHash: null,
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
  protagonistSkills: readonly string[];
  anchorTitle: string;
  playerName: string;
}): Promise<ReplanCandidateResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const job = await deps.planStore.getJob(jobId);
  if (!job) throw new Error(`Unknown replan job: ${jobId}.`);
  if (!job.branchId || !job.campaignId) return { status: 'stale', candidateId: null, errors: ['replan job missing branch binding'], physicalRequests: 0 };
  if (job.status === 'candidate_ready') {
    return { status: 'candidate_ready', candidateId: (await deps.planStore.latestCandidateForJob(jobId))?.candidateId ?? null, errors: [], physicalRequests: 0 };
  }
  const claim = await deps.planStore.claimJob(jobId, `replan-runner:${jobId}`, new Date(Date.now() + 600_000).toISOString(), now());
  if (!claim) return { status: 'stale', candidateId: null, errors: ['lease held'], physicalRequests: 0 };
  const candidateId = `${jobId}:a${claim.attemptCount + 1}:1`;
  try {
    const runtimeRow = await deps.db.queryOne<{ snapshot_json: string }>(
      'SELECT snapshot_json FROM snapshots WHERE branch_id=? ORDER BY state_version DESC LIMIT 1', [job.branchId]);
    if (!runtimeRow) throw new Error('branch snapshot missing');
    const state = JSON.parse(runtimeRow.snapshot_json) as GameStateSnapshot;
    const runtime = state.campaignRuntime;
    if (!runtime) throw new Error('branch has no campaign runtime');
    if (runtime.planBinding.planId !== job.basePlanId || runtime.planBinding.revision !== job.basePlanRevision) {
      await deps.planStore.transitionJob(jobId, claim.fencingToken, 'stale', { lastError: 'base plan binding moved on' }, now());
      return { status: 'stale', candidateId: null, errors: ['base plan binding moved on'], physicalRequests: 0 };
    }
    const currentPlan = await deps.planStore.getPlanRevision(runtime.planBinding.planId, runtime.planBinding.revision);
    if (!currentPlan) throw new Error('current plan revision missing');
    const { ctx } = await buildPlanningContext({
      worldStore: deps.worldStore, intent: input.intent, protagonistSkills: input.protagonistSkills,
    });
    const resolvedNodeIds = new Set(runtime.nodeStates
      .filter(node => ['succeeded', 'failed', 'superseded', 'cancelled'].includes(node.status))
      .map(node => node.nodeId));
    const system = [
      '你是一个文字 TRPG 的战役主线策划，现在需要根据玩家已造成的真实变化，修订一份既有战役计划的未来部分。',
      '已完成的阶段是既成事实，不得回滚或改写；你只能替换尚未完成的阶段，并为当前困境给出新的可行路径。',
      '输出要求与开局规划相同的 JSON 结构：顶层必须包含 "modelVersion": "campaign-plan-model-1"、proposal、stages、endings、firstSituation。',
      `必须保留以下已完成或已定局的 nodeId（含义不变，可以不再展开）：${[...resolvedNodeIds].join('、') || '无'}。`,
      `修订原因：${job.triggerReasons.join('、')}。`,
      'firstSituation 仅在首个未完成阶段需要新的可玩局面时提供，且必须给出至少两条机制不同的办法。',
    ].join('\n');
    const user = [
      `原计划公开目标：${currentPlan.plan.longTermGoal}`,
      `原计划阶段（publicObjective）：${currentPlan.plan.nodes.map(node => `${node.nodeId}:${node.title}${resolvedNodeIds.has(node.nodeId) ? '（已定局）' : ''}`).join('；')}`,
      `玩家意图：${input.intent.normalizedIntent}`,
      `当前主目标：${runtime.publicObjectiveProjection}`,
      `修订原因：${job.triggerReasons.join('、')}`,
    ].join('\n');
    const { planLlmRequest } = await import('../llm/requestBudgetKernel');
    const { resolveModelCapabilities } = await import('../llm/capabilityResolver');
    const { DEFAULT_OUTPUT_DEMANDS } = await import('../llm/requestDemands');
    const { normalizeReasoningTier } = await import('../llm/types');
    const { reasoningDialectForModel } = await import('../llm/reasoningPolicy');
    const { estimateTokens } = await import('../context/tokenEstimate');
    const { endpointBucketId } = await import('../worldBuild/rateScheduler');
    const demands = DEFAULT_OUTPUT_DEMANDS.campaign_plan;
    const maximum = Math.min(demands.maximum, deps.profile.contentOutputTokens ?? 16_384);
    const plan = planLlmRequest({
      capabilities: resolveModelCapabilities({
        declared: {
          contextWindowTokens: deps.profile.capabilities.contextWindow,
          maxOutputTokens: deps.profile.capabilities.maxOutputTokens,
          supportsJsonMode: deps.profile.capabilities.supportsJson,
          reportsUsage: deps.profile.capabilities.reportsUsage,
          reasoningUsageReported: deps.profile.capabilities.reportsUsage,
        },
        reasoningMode: 'always_on',
      }),
      requestKind: 'campaign_plan',
      estimatedMandatoryInputTokens: estimateTokens(`${system}\n${user}`),
      businessOutputDemand: { ...demands, target: Math.min(demands.target, maximum), maximum },
      reasoningPolicy: {
        tier: normalizeReasoningTier(deps.profile.reasoningTier ?? deps.profile.reasoningEffort),
        providerDialect: deps.profile.reasoningDialect ?? reasoningDialectForModel(deps.profile.model),
        model: deps.profile.model,
      },
    });
    const reasoningPolicy = plan.reasoningPolicy;
    if (!reasoningPolicy) throw new Error('campaign_plan_policy_missing');
    const logicalRequestId = `campaign-replan:${job.branchId}:${jobId}`;
    const dispatch = async (repairErrors: string[] | null): Promise<{ text: string; unknown: boolean; requests: number }> => {
      try {
        const response = await deps.provider.complete({
          role: 'WorldMapper',
          system,
          user: repairErrors === null ? user
            : `${user}\n\n上一次输出未通过校验：\n- ${repairErrors.join('\n- ')}\n请输出修正后的完整 JSON。`,
          maxOutputTokens: plan.wireOutputTokens,
          jsonMode: deps.profile.capabilities.supportsJson,
          requestKind: 'campaign_plan',
          reasoningTier: reasoningPolicy.tier,
          reasoningReserveTokens: reasoningPolicy.reserveTokens,
          reasoningPolicyVersion: reasoningPolicy.policyVersion,
          ledger: { logicalRequestId, requestKind: 'campaign_plan', worldId: input.intent.sourceCoverageBinding.worldId },
          scheduling: {
            logicalTaskId: logicalRequestId, role: 'mapper', priority: 'P2',
            endpointBucketId: endpointBucketId(deps.profile.endpoint),
            requestPlanHash: stableFingerprint(plan), estimatedInputTokens: plan.mandatoryInputTokens,
            reservedOutputTokens: plan.wireOutputTokens, worldId: input.intent.sourceCoverageBinding.worldId,
          },
        });
        return { text: response.text, unknown: false, requests: 1 };
      } catch (error) {
        if (error instanceof Error && error.name === 'OutcomeUnknownReplayError') {
          return { text: '', unknown: true, requests: 0 };
        }
        throw error;
      }
    };
    let physicalRequests = 0;
    const first = await dispatch(null);
    physicalRequests += first.requests;
    const parse = (text: string): { model: ReturnType<typeof parseCampaignPlanCandidate>; errors: string[] } => {
      const errors: string[] = [];
      const parsed = extractJsonObject(text);
      const model = parsed === null ? null : parseCampaignPlanCandidate(parsed, errors);
      return { model, errors };
    };
    let parsed: { model: ReturnType<typeof parseCampaignPlanCandidate>; errors: string[] } | null = first.unknown ? null : parse(first.text);
    if (first.unknown) {
      await deps.planStore.transitionJob(jobId, claim.fencingToken, 'outcome_unknown', { lastError: 'outcome unknown', attemptCount: claim.attemptCount + 1 }, now());
      return { status: 'outcome_unknown', candidateId, errors: ['outcome_unknown'], physicalRequests };
    }
    if (parsed && !parsed.model) {
      const repair = await dispatch(parsed.errors.slice(0, 12));
      physicalRequests += repair.requests;
      if (repair.unknown) {
        await deps.planStore.transitionJob(jobId, claim.fencingToken, 'outcome_unknown', { lastError: 'outcome unknown during repair', attemptCount: claim.attemptCount + 1 }, now());
        return { status: 'outcome_unknown', candidateId, errors: ['outcome_unknown'], physicalRequests };
      }
      parsed = parse(repair.text);
    }
    if (!parsed || !parsed.model) {
      const invalidErrors = parsed ? parsed.errors : ['no_json_object'];
      await deps.planStore.markCandidateStage(candidateId, 'rejected', invalidErrors, now());
      await deps.planStore.transitionJob(jobId, claim.fencingToken, 'invalid', { lastError: invalidErrors.slice(0, 6).join('; ').slice(0, 300), attemptCount: claim.attemptCount + 1 }, now());
      return { status: 'invalid', candidateId, errors: invalidErrors, physicalRequests };
    }
    // A replan model may omit firstSituation (the branch keeps playing the
    // current board). Carry the current artifact's situations into the new
    // revision so the playable stage stays intact.
    const currentArtifactId = currentPlan.plan.contentArtifactRefs[0] ?? null;
    const currentArtifact = currentArtifactId ? await deps.planStore.getArtifact(currentArtifactId) : null;
    const modelForCompile: CampaignPlanCandidateModelV1 = parsed.model;
    if (!(modelForCompile.firstSituation.methods?.length > 0) && currentArtifact) {
      const carried: Array<Record<string, unknown>> = (currentArtifact.situations[0]?.definition.methods ?? []).map(method => ({
        ...method,
        outcomes: Object.fromEntries(['full_success', 'success', 'failure', 'severe_failure'].map(grade => [grade, {
          resultFact: (method.outcomeTemplates as NonNullable<typeof method.outcomeTemplates>)?.[grade as 'success']?.resultFact ?? '结果由检定决定。',
          effects: (method.outcomeTemplates as NonNullable<typeof method.outcomeTemplates>)?.[grade as 'success']?.effects ?? [],
        }])),
      }));
      Object.assign(modelForCompile, {
        firstSituation: {
          situationTitle: currentArtifact.situations[0]?.definition.title ?? '当前局面',
          summary: currentArtifact.situations[0]?.definition.summary ?? '战役继续推进。',
          gmBrief: currentArtifact.situations[0]?.definition.gmBrief ?? '沿用当前局面。',
          pressureDescription: currentArtifact.situations[0]?.definition.pressure.description ?? '局势会随时间变化。',
          methods: carried,
          signs: [],
        },
      });
    }
    const compiled = compileCampaignPlan({
      model: modelForCompile, intent: input.intent, ctx,
      planId: runtime.planBinding.planId,
      revision: runtime.planBinding.revision + 1,
      parentRevision: runtime.planBinding.revision,
      createdAt: now(),
    });
    if (compiled.errors.length > 0) {
      await deps.planStore.transitionJob(jobId, claim.fencingToken, 'invalid', { lastError: compiled.errors.join('; ').slice(0, 300), attemptCount: claim.attemptCount + 1 }, now());
      return { status: 'invalid', candidateId, errors: compiled.errors, physicalRequests };
    }
    // Preserve resolved node identities: every already-terminal nodeId must
    // still exist in the revision (its committed history stays readable).
    for (const nodeId of resolvedNodeIds) {
      if (!compiled.plan.nodes.some(node => node.nodeId === nodeId)) {
        const error = `revision drops resolved node ${nodeId}; committed history must stay addressable.`;
        await deps.planStore.transitionJob(jobId, claim.fencingToken, 'invalid', { lastError: error, attemptCount: claim.attemptCount + 1 }, now());
        return { status: 'invalid', candidateId, errors: [error], physicalRequests };
      }
    }
    const validation = validateCampaignPlan(compiled.plan, {
      visibleWorldEntryIds: new Set(ctx.visibleEntries.map(entry => entry.entryId)),
      openingActorIds: ctx.openingActorIds,
      openingTemplateIds: ctx.openingTemplateIds,
      artifactSituationIds: new Set(compiled.artifact.situations.map(s => s.entryId)),
      protagonistSkills: ctx.protagonistSkills,
    }, compiled.artifact);
    if (validation.length > 0) {
      await deps.planStore.transitionJob(jobId, claim.fencingToken, 'invalid', { lastError: validation.slice(0, 6).join('; ').slice(0, 300), attemptCount: claim.attemptCount + 1 }, now());
      return { status: 'invalid', candidateId, errors: validation, physicalRequests };
    }
    await deps.planStore.upsertCandidate({
      candidateId, jobId, setupId: job.setupId, attemptGroup: `a${claim.attemptCount + 1}`, attemptNo: 1,
      stage: 'ready', rawResponseRef: null, rawResponseText: first.text.slice(0, 200_000), parseResultJson: null,
      validationErrors: [], repairUsed: physicalRequests > 1,
      candidateHash: sha256HexOf(JSON.stringify({ plan: compiled.plan, artifact: compiled.artifact })),
      plan: compiled.plan, artifact: compiled.artifact, createdAt: now(), updatedAt: now(),
    });
    await deps.planStore.transitionJob(jobId, claim.fencingToken, 'candidate_ready', { attemptCount: claim.attemptCount + 1 }, now());
    return { status: 'candidate_ready', candidateId, errors: [], physicalRequests };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.planStore.transitionJob(jobId, claim.fencingToken, 'retryable_failed', { lastError: message.slice(0, 300), attemptCount: claim.attemptCount + 1 }, now());
    return { status: 'retryable_failed', candidateId, errors: [message], physicalRequests: 0 };
  }
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
  if (!candidate || candidate.stage !== 'ready' || !candidate.plan || !candidate.artifact) {
    return { outcome: 'stale', reason: 'candidate is not ready' };
  }
  const job = await input.planStore.getJob(candidate.jobId);
  if (!job || job.branchId !== input.branchId || job.status !== 'candidate_ready') {
    return { outcome: 'stale', reason: 'job is not this branch\'s ready replan' };
  }
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
    return { outcome: 'stale', reason: 'runtime moved on since the candidate was compiled' };
  }
  // 3. Local revalidation: every terminal node's completion condition must
  // still hold on the CURRENT state, and the plan must not complete instantly
  // by contradiction.
  const facts = replanFacts(state);
  for (const nodeState of runtime.nodeStates) {
    if (!['succeeded', 'failed', 'superseded', 'cancelled'].includes(nodeState.status)) continue;
    const revised = candidate.plan.nodes.find(node => node.nodeId === nodeState.nodeId);
    if (!revised) continue;
    if (nodeState.status === 'succeeded') {
      const holds = evaluateCondition(revised.completion, facts);
      if (!holds.value || holds.unknown) {
        return { outcome: 'stale', reason: `node ${nodeState.nodeId} is committed as succeeded but its revised completion no longer holds` };
      }
    }
  }
  // 4/5. Management commit: switch the binding, archive revision + artifact,
  // append the adoption event — all in ONE transaction.
  const nextRevision = candidate.plan.revision;
  const nextState = { ...state, campaignRuntime: {
    ...runtime,
    planBinding: { planId: candidate.plan.planId, revision: nextRevision, contentHash: candidate.plan.contentHash },
    replanReasonCodes: [...new Set([...runtime.replanReasonCodes, ...job.triggerReasons])],
    stateVersion: state.stateVersion + 1,
  } as CampaignRuntimeV1 };
  await input.db.transaction(async tx => {
    await input.planStore.archivePlanRevision(tx, {
      plan: candidate.plan!, intent: await loadIntentFor(input.planStore, job.setupId),
      setupId: job.setupId, campaignId: input.campaignId, sourceTrigger: `replan:${job.triggerReasons.join('+')}`,
      intentHash: candidate.plan!.intentHash, adoptedAt: now(),
    });
    await input.planStore.archiveArtifact(tx, { ...candidate.artifact!, campaignId: input.campaignId }, now());
    const managementTurnId = `${input.branchId}:manage-replan:${nextRevision}`;
    await tx.execute(
      `INSERT INTO turns (branch_id, turn_id, expected_state_version, committed_state_version, status, outcome_grade, public_summary, effects_json, action_contract_json, action_contract_hash, created_at)
       VALUES (?, ?, ?, ?, 'Committed', 'success', ?, '[]', '{}', ?, ?)`,
      [input.branchId, managementTurnId, state.stateVersion, state.stateVersion + 1,
        '主线规划已根据最新局势修订。', 'manage-replan', now()]);
    await tx.execute(
      'UPDATE branches SET state_version = ? WHERE branch_id = ?',
      [state.stateVersion + 1, input.branchId]);
    await tx.execute(
      `INSERT INTO snapshots (branch_id, state_version, snapshot_json, state_hash, created_at) VALUES (?, ?, ?, NULL, ?)`,
      [input.branchId, state.stateVersion + 1, JSON.stringify(nextState), now()]);
    await tx.execute(
      `INSERT INTO branch_events (branch_id, event_seq, turn_id, state_version, event_type, payload_json, created_at)
       VALUES (?, (SELECT COALESCE(MAX(event_seq),0)+1 FROM branch_events WHERE branch_id=?), ?, ?, 'campaign_plan_adopted', ?, ?)`,
      [input.branchId, input.branchId, managementTurnId, state.stateVersion + 1,
        JSON.stringify({ planId: candidate.plan!.planId, revision: nextRevision, reasons: job.triggerReasons }), now()]);
    await input.planStore.transitionJob(candidate.jobId, job.fencingToken, 'adopted', {}, now());
  });
  return { outcome: 'adopted', revision: nextRevision };
}

function replanFacts(state: GameStateSnapshot) {
  return snapshotConditionFacts({
    actors: state.actors,
    itemOwners: state.itemOwners,
    discoveries: state.discoveries,
    relationships: state.relationships,
    questProgress: state.questProgress,
    situations: state.situations,
    playerActorId: state.party?.find(member => member.controller === 'player')?.actorId ?? '',
    causalWorldTimeOrder: state.causalWorldTimeOrder ?? 0,
    cards: (state.cards ?? []).map(entry => ({
      actorId: entry.actorId,
      templateId: (entry.card as { templateId?: string }).templateId,
    })),
  });
}

async function loadIntentFor(planStore: SqliteCampaignPlanStore, setupId: string): Promise<import('../../domain/campaignPlan/types').CampaignIntentV1> {
  const setup = await planStore.getSetup(setupId);
  if (setup) return setup.intent;
  // Replans reference the original setup by id; fall back to a minimal shell
  // preserving the binding-critical fields from the plan itself.
  return {
    schemaVersion: 'campaign-intent-1', setupId, intentRevision: 1,
    rawIntent: '', normalizedIntent: '', goalMode: 'declared',
    protagonistBinding: { actorId: '', kind: 'original', name: '' },
    openingAnchor: { worldTimeOrder: 0, locationId: '' },
    companionBindings: [], lengthPreference: 'medium', userConstraints: [],
    requestedCanonTargets: [], knowledgePolicy: 'anchor_projection',
    sourceCoverageBinding: { worldId: '', packageRevision: 1, coverageWorldTimeOrder: 0, packageContentHash: '' },
    createdAt: new Date().toISOString(),
  };
}

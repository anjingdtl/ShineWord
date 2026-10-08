import type { PlanningRunDeps, PlanningRunResult } from './planningService';
import { buildPlanningContext } from './planningService';
import { buildPlanRequestMaterials, generateCampaignPlanCandidate, llmModelProfileFingerprint } from './generationService';
import { frozenPlanJob, readPlanFreeze, writePlanFreeze, thawPlanContext } from './jobFreeze';
import { canonicalJsonOf, sha256HexOf } from './hashing';
import { compileCampaignPlan } from './localCompile';
import { validateCampaignIntent, validateCampaignPlan, validateOrdinarySuccessCompletion } from '../../domain/campaignPlan/planValidation';
import { validateEndingCompletionOrder } from '../../domain/campaignPlan/endingValidation';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { CampaignIntentV1 } from '../../domain/campaignPlan/types';
import { isIntactReadyCandidate } from './candidateIntegrity';
import { assessMethod } from '../guidance/candidates';
import { openingRelationshipFor } from '../campaign/recruitment';
import { REASONING_ONLY_RESERVE_MULTIPLIER } from '../llm/reasoningPolicy';
import { reasoningDialectForModel } from '../llm/reasoningPolicy';
import { normalizeReasoningTier } from '../llm/types';
import { freezeReasoningUsageFeedback } from '../llm/reasoningFeedback';
import { readBoundCampaignArtifacts } from './boundArtifacts';
import { resolveCampaignContent, campaignContentEntries } from './contentResolver';

/** Both planning modes share durable generation, bounded repair and fencing. */
export async function runCandidateJob(deps: PlanningRunDeps, jobId: string, input: {
  anchorTitle: string; playerName: string; protagonistSkills: readonly string[]; openingGoalSuggestions?: readonly string[];
}): Promise<PlanningRunResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const job = await deps.planStore.getJob(jobId);
  if (!job) throw new Error(`Unknown campaign plan job: ${jobId}.`);
  const result = (status: PlanningRunResult['status'], candidateId: string | null, errors: string[] = [], physicalRequests = 0): PlanningRunResult =>
    ({ jobId, status, candidateId, errors, physicalRequests });
  if (['candidate_ready','adopted'].includes(job.status)) {
    const candidate = await deps.planStore.latestCandidateForJob(jobId);
    return isIntactReadyCandidate(candidate)
      ? result('already_ready', candidate.candidateId) : result('invalid', null, ['ready job has no validated candidate']);
  }
  if (!['queued','running','retryable_failed'].includes(job.status)) return result(
    job.status === 'outcome_unknown' ? 'outcome_unknown' : 'stale', null, [`job ${job.status}`]);
  const leaseTtlMs = 600_000;
  const owner = `plan:${jobId}`;
  const expiresAt = () => new Date(new Date(now()).getTime() + leaseTtlMs).toISOString();
  const claim = await deps.planStore.claimJob(jobId, owner, expiresAt(), now())
    ?? await deps.planStore.reclaimExpiredJob(jobId, owner, expiresAt(), now());
  if (!claim) return result('stale', null, ['lease held']);
  const existing = await deps.planStore.latestCandidateForJob(jobId);
  const candidateId = existing?.candidateId ?? `${jobId}:a1:1`;
  const attemptsBefore = (await deps.db.queryOne<{ n: number }>(
    'SELECT COUNT(*) n FROM llm_request_attempts WHERE logical_request_id=?', [`campaign-plan:${jobId}`]))?.n ?? 0;
  let physicalRequests = 0;
  const countDispatchedRequests = async (): Promise<void> => {
    const count = (await deps.db.queryOne<{ n: number }>(
      'SELECT COUNT(*) n FROM llm_request_attempts WHERE logical_request_id=?', [`campaign-plan:${jobId}`]))?.n ?? 0;
    // Ledger-backed runs count actual admitted attempts, including thrown
    // transports; boundary-only fixtures have no physical ledger rows.
    if (count || attemptsBefore) physicalRequests = Math.max(0, count - attemptsBefore);
  };
  let lostLease = false;
  let releaseExecution: (() => void) | undefined;
  let renewalInFlight: Promise<void> | null = null;
  const renew = async (): Promise<void> => {
    if (lostLease) return;
    if (!await deps.planStore.renewJobLease(jobId, owner, claim.fencingToken, expiresAt(), now())) lostLease = true;
  };
  // Cover provider queueing, generation and bounded repair, not only local stage boundaries.
  const leaseTimer = setInterval(() => {
    if (renewalInFlight || lostLease) return;
    renewalInFlight = renew().catch(() => { lostLease = true; }).finally(() => { renewalInFlight = null; });
  }, Math.floor(leaseTtlMs / 3));
  const assertCurrent = async (): Promise<void> => {
    if (renewalInFlight) await renewalInFlight;
    await renew();
    if (lostLease) throw new Error('campaign_job_fence_expired');
    const current = await deps.planStore.getJob(jobId);
    if (!current || current.status !== 'running' || current.fencingToken !== claim.fencingToken) throw new Error('campaign_job_fence_expired');
    if (job.jobKind === 'opening_plan') {
      const setup = await deps.planStore.getSetup(job.setupId);
      if (!setup || ['cancelled','adopted'].includes(setup.status)) throw new Error('campaign_setup_cancelled');
      if (sha256HexOf(canonicalJsonOf(setup.intent)) !== current.intentHash) throw new Error('campaign_intent_stale');
    }
  };
  try {
    // Read the original root BEFORE consulting live world/state/profile data.
    let frozen = await readPlanFreeze(deps.db, jobId);
    if (!frozen) {
      if (job.freezeRootId) throw Object.assign(new Error('规划冻结根缺失，停止请求。'), { name: 'FrozenMaterialsCorruptedError' });
      let intent: CampaignIntentV1;
      let state: GameStateSnapshot | undefined;
      let basePlan: import('../../domain/campaignPlan/types').CampaignPlanV1 | undefined;
      if (job.jobKind === 'opening_plan') {
        const setup = await deps.planStore.getSetup(job.setupId);
        if (!setup) throw new Error('setup missing');
        intent = setup.intent;
      } else {
        const row = await deps.db.queryOne<{ snapshot_json: string }>(
          'SELECT snapshot_json FROM snapshots WHERE branch_id=? ORDER BY state_version DESC LIMIT 1', [job.branchId]);
        if (!row) throw new Error('branch snapshot missing');
        state = JSON.parse(row.snapshot_json) as GameStateSnapshot;
        const runtime = state.campaignRuntime;
        if (!runtime || runtime.planBinding.planId !== job.basePlanId || runtime.planBinding.revision !== job.basePlanRevision) throw new Error('base_plan_stale');
        const revision = await deps.planStore.getPlanRevision(runtime.planBinding.planId, runtime.planBinding.revision);
        if (!revision) throw new Error('current plan missing');
        basePlan = revision.plan;
        intent = runtime.intent ?? revision.intent;
      }
      const errors = validateCampaignIntent(intent);
      if (errors.length) throw new Error(errors.join('; '));
      const effectiveEntries = state?.segmentContentBinding && deps.segmentContent && job.campaignId && job.branchId
        ? (await deps.segmentContent.loadEffectiveCatalog({ campaignId: job.campaignId, branchId: job.branchId, binding: state.segmentContentBinding })).entries : undefined;
      const { ctx, visibleEntries, worldTitle } = await buildPlanningContext({ worldStore: deps.worldStore, intent, protagonistSkills: input.protagonistSkills,
        effectiveEntries, ...(state ? { projectionOrder: Math.max(intent.openingAnchor.worldTimeOrder, state.causalWorldTimeOrder ?? 0) } : {}) });
      if (state) {
        const artifacts = await readBoundCampaignArtifacts(deps.db, job.campaignId!,
          state.campaignContentBinding ?? { artifactIds: basePlan!.contentArtifactRefs });
        const campaignEntries = campaignContentEntries(artifacts);
        ctx.campaignEntryIds = new Set(campaignEntries.map(entry => entry.entryId));
        ctx.visibleEntries = resolveCampaignContent(visibleEntries, artifacts);
        visibleEntries.splice(0, visibleEntries.length, ...ctx.visibleEntries);
        ctx.openingActorIds = new Set(Object.keys(state.actors));
        ctx.openingLocationId = state.actors[intent.protagonistBinding.actorId]?.locationId ?? ctx.openingLocationId;
        ctx.protagonistSkills = new Set((state.skills ?? []).filter(s => s.actorId === intent.protagonistBinding.actorId).map(s => s.skillId));
        ctx.protagonistSkillRanks = Object.fromEntries((state.skills ?? []).filter(s => s.actorId === intent.protagonistBinding.actorId).map(s => [s.skillId, s.rank]));
        ctx.presentActorRefs = (state.cards ?? []).flatMap(({ actorId, card: raw }) => {
          const card = raw as import('../../domain/characters/card').ActorCard;
          const actor = state!.actors[actorId];
          return actor?.locationId === ctx.openingLocationId && actor.lifeStatus !== 'dead'
            && (actorId === intent.protagonistBinding.actorId || card.controller === 'companion'
              || ctx.visibleEntries.some(e => e.kind === 'actor_template' && e.entryId === card.templateId))
            ? [actorId, ...(card.templateId ? [card.templateId] : [])] : [];
        });
      }
      const materials = buildPlanRequestMaterials({ intent, ctx, visibleEntries, worldTitle,
        knownKnowledgeEntryIds: new Set((state?.discoveries ?? []).filter(d => d.actorId === intent.protagonistBinding.actorId).map(d => d.entryId)),
        anchorTitle: input.anchorTitle, playerName: input.playerName, openingGoalSuggestions: input.openingGoalSuggestions ?? [] });
      if (state && basePlan) {
        materials.system += '\n这是修订任务：严格沿用上述完整 JSON 合同与 ID 白名单。必须提供 firstSituation（所有必需字段和四档后果），用于当前尚未完成的问题。已定局节点由本地保留，不得改写或复活；新阶段的 nodeId 不得复用已定局节点。玩家合法结果优先于原计划。';
        materials.user += `\n修订原因：${job.triggerReasons.join('、')}\n原计划：${JSON.stringify(basePlan)}\n已提交当前状态：${JSON.stringify({
          actors: state.actors, items: state.itemOwners, discoveries: state.discoveries, relationships: state.relationships,
          situations: state.situations, nodes: state.campaignRuntime?.nodeStates, currentGoal: state.campaignRuntime?.publicObjectiveProjection })}`;
      }
      const reasoningPolicy = await freezeReasoningUsageFeedback(deps.provider, 'campaign_plan', {
        tier: normalizeReasoningTier(deps.profile.reasoningTier ?? deps.profile.reasoningEffort),
        providerDialect: deps.profile.reasoningDialect ?? reasoningDialectForModel(deps.profile.model), model: deps.profile.model });
      frozen = { ...frozenPlanJob(intent, deps.profile, materials, ctx), reasoningPolicy, ...(state ? { baseState: state, basePlan } : {}) };
      await assertCurrent();
      await writePlanFreeze(deps.db, jobId, job.setupId, frozen, now());
      await deps.db.execute('UPDATE campaign_plan_jobs SET freeze_root_id=?, intent_hash=? WHERE job_id=? AND status=\'running\' AND fencing_token=?',
        [`campaign-job:${jobId}`, sha256HexOf(canonicalJsonOf(intent)), jobId, claim.fencingToken]);
    }
    if (!frozen) throw new Error('freeze missing');
    if (llmModelProfileFingerprint(frozen.profile) !== llmModelProfileFingerprint(deps.profile)) throw new Error('模型配置已改变，请恢复原配置后继续此规划。');
    await assertCurrent();
    if (existing?.stage === 'ready' || existing?.stage === 'rejected') {
      const ready = isIntactReadyCandidate(existing);
      const status = ready ? 'candidate_ready' : 'invalid';
      await deps.planStore.transitionJob(jobId, claim.fencingToken, status, {}, now());
      if (ready && job.jobKind === 'opening_plan') await deps.db.execute(
        "UPDATE campaign_setups SET status='proposal_ready',current_candidate_id=?,updated_at=? WHERE setup_id=? AND status<>'cancelled'", [candidateId, now(), job.setupId]);
      return result(status, candidateId, existing.validationErrors);
    }
    if (existing?.stage === 'raw_response' && existing.rawResponseText !== null
      && sha256HexOf(existing.rawResponseText) !== existing.candidateHash) {
      throw Object.assign(new Error('规划原始响应 hash 损坏，停止请求。'), { name: 'FrozenMaterialsCorruptedError' });
    }
    const ledger = await deps.db.queryOne<{ n: number }>(
      'SELECT COUNT(*) n FROM llm_request_attempts WHERE logical_request_id=?', [`campaign-plan:${jobId}`]);
    const used = Math.max(existing?.rawResponseText !== null && existing?.rawResponseText !== undefined ? (existing.repairUsed ? 2 : 1) : 0, ledger?.n ?? 0);
    const lastAttempt = await deps.db.queryOne<{ failure_class: string | null; reasoning_tokens: number | null; estimated_usage: number }>(
      'SELECT failure_class,reasoning_tokens,estimated_usage FROM llm_request_attempts WHERE logical_request_id=? ORDER BY attempt_no DESC LIMIT 1', [`campaign-plan:${jobId}`]);
    const persistResponse = async (text: string, repairUsed: boolean): Promise<void> => {
      deps.onStage?.('validating');
      await deps.db.transaction(async tx => {
        const row = await tx.queryOne<{ status: string; fencing_token: number }>('SELECT status,fencing_token FROM campaign_plan_jobs WHERE job_id=?', [jobId]);
        if (!row || row.status !== 'running' || row.fencing_token !== claim.fencingToken) throw new Error('campaign_job_fence_expired');
        await deps.planStore.upsertCandidate({ candidateId, jobId, setupId: job.setupId, attemptGroup: 'a1', attemptNo: 1,
        stage: 'raw_response', rawResponseRef: `campaign-job:${jobId}`, rawResponseText: text,
        parseResultJson: null, validationErrors: [], repairUsed, candidateHash: sha256HexOf(text), plan: null, artifact: null,
        createdAt: existing?.createdAt ?? now(), updatedAt: now() }, tx);
      });
    };
    const compile = (model: import('./candidateModel').CampaignPlanCandidateModelV1) => {
      const ctx = thawPlanContext(frozen!);
      const baseRuntime = frozen!.baseState?.campaignRuntime;
    const compiled = compileCampaignPlan({ model, intent: frozen!.intent, ctx,
      planId: baseRuntime ? `plan-replan-${sha256HexOf(job.branchId!).slice(0, 24)}` : `plan-${job.setupId}`,
      revision: baseRuntime ? baseRuntime.planBinding.revision + 1 : 1,
      parentRevision: baseRuntime?.planBinding.revision ?? null, createdAt: now(),
      ...(baseRuntime ? { situationId: `camp-sit-${sha256HexOf(jobId).slice(0, 16)}` } : {}) });
    if (baseRuntime && frozen!.basePlan) {
      const terminal = new Set(baseRuntime.nodeStates.filter(n => ['succeeded','failed','superseded','cancelled'].includes(n.status)).map(n => n.nodeId));
      const retired = new Set(frozen!.basePlan.retiredNodeIds ?? []);
      for (const situation of compiled.artifact.situations) {
        if (terminal.has(situation.nodeId) || retired.has(situation.nodeId)) {
          compiled.errors.push(`firstSituation targets committed or retired node ${situation.nodeId}; provide a current unfinished stage`);
        }
      }
      const newNodeIds = new Set(compiled.plan.nodes.filter(n => !terminal.has(n.nodeId)).map(n => n.nodeId));
      compiled.plan.retiredNodeIds = frozen!.basePlan.nodes.filter(n => !newNodeIds.has(n.nodeId)).map(n => n.nodeId);
      compiled.plan.nodes = [...frozen!.basePlan.nodes.filter(n => !newNodeIds.has(n.nodeId)), ...compiled.plan.nodes.filter(n => !terminal.has(n.nodeId))];
      compiled.plan.startNodeIds = compiled.plan.startNodeIds.filter(id => !terminal.has(id));
      compiled.plan.contentArtifactRefs = [...compiled.plan.contentArtifactRefs, ...frozen!.basePlan.contentArtifactRefs];
      const { contentHash: _hash, ...body } = compiled.plan;
      compiled.plan.contentHash = sha256HexOf(canonicalJsonOf(body));
    }
    const state = frozen!.baseState;
    const cards = (state?.cards ?? []).map(row => row.card as import('../../domain/characters/card').ActorCard);
    const playerCard = cards.find(card => card.actorId === frozen!.intent.protagonistBinding.actorId);
    const openingRelationships = frozen!.intent.companionBindings.flatMap(companion => {
      const entry = ctx.visibleEntries.find(e => e.entryId === companion.templateId && e.kind === 'actor_template');
      const relationship = entry ? openingRelationshipFor(entry, frozen!.intent.openingAnchor.worldTimeOrder) : null;
      return relationship ? [{ fromActorId: companion.actorId, toActorId: frozen!.intent.protagonistBinding.actorId,
        closeness: relationship.closeness }] : [];
    });
    const executableMethodIds = state && playerCard ? new Set(compiled.artifact.situations.flatMap(s => s.definition.methods
      .filter(method => assessMethod(s.entryId, method, { state, playerCard,
        cardsByName: new Map(cards.filter(c => ctx.presentActorRefs?.includes(c.actorId)).map(c => [c.actorId, c])),
        entries: ctx.visibleEntries, situationStatuses: new Map((state.situations ?? []).map(s => [s.situationId, s])),
        causalWorldTimeOrder: ctx.coverageWorldTimeOrder }).eligible).map(method => method.methodId))) : undefined;
    const errors = [...compiled.errors, ...validateCampaignPlan(compiled.plan, {
      visibleWorldEntryIds: new Set(ctx.visibleEntries.filter(e => !ctx.campaignEntryIds?.has(e.entryId)).map(e => e.entryId)),
      campaignKnowledgeEntryIds: new Set(ctx.visibleEntries.filter(e => e.kind === 'lore' && ctx.campaignEntryIds?.has(e.entryId)).map(e => e.entryId)),
      adoptedCampaignEntryIds: ctx.campaignEntryIds, availableFactIds: ctx.availableFactIds, openingActorIds: ctx.openingActorIds,
      openingTemplateIds: ctx.openingTemplateIds, artifactSituationIds: new Set([...compiled.artifact.situations.map(s => s.entryId), ...(frozen!.baseState?.situations ?? []).map(s => s.situationId)]), protagonistSkills: ctx.protagonistSkills,
      presentActorRefs: ctx.presentActorRefs, protagonistSkillRanks: ctx.protagonistSkillRanks,
      executableMethodIds,
      knownPromiseRefs: (frozen!.baseState?.situations ?? []).flatMap(s => (s.promises ?? []).map(p => ({ situationId: s.situationId, promiseId: p.promiseId }))),
      knownLocationIds: new Set(ctx.visibleEntries.filter(e => e.kind === 'scene').map(e => (e.definition as { locationId: string }).locationId)) }, compiled.artifact),
      ...validateOrdinarySuccessCompletion(compiled.plan, compiled.artifact, {
        playerActorId: frozen!.intent.protagonistBinding.actorId,
        relationships: state?.relationships ?? openingRelationships, discoveries: state?.discoveries,
        actorAliases: state ? cards : frozen!.intent.companionBindings,
        situations: state?.situations,
      }), ...validateEndingCompletionOrder(compiled.plan, compiled.artifact)];
      return { compiled, errors };
    };
    // One scope spans scheduler waiting, all bounded dispatches, validation and
    // publication; physical transport protection alone leaves gaps at repair.
    releaseExecution = await deps.acquireExecution?.();
    await assertCurrent();
    const generation = await generateCampaignPlanCandidate({ provider: deps.provider, profile: frozen.profile,
      materials: frozen.materials, logicalRequestId: `campaign-plan:${jobId}`, worldId: frozen.intent.sourceCoverageBinding.worldId,
      reasoningPolicy: frozen.reasoningPolicy,
      ...(job.branchId ? { branchId: job.branchId } : {}),
      ...(existing?.rawResponseText !== null && existing?.rawResponseText !== undefined ? { resume: { text: existing.rawResponseText, repairUsed: existing.repairUsed } } : {}),
      ...(lastAttempt && ['reasoning_only', 'length'].includes(lastAttempt.failure_class ?? '')
        ? { reasoningReserveMultiplier: REASONING_ONLY_RESERVE_MULTIPLIER,
          observedReasoningTokens: lastAttempt.estimated_usage === 0 ? lastAttempt.reasoning_tokens : null } : {}),
      validateModel: model => compile(model).errors, physicalRequestBudget: Math.max(0, claim.physicalRequestBudget - used), onResponse: persistResponse, beforeDispatch: async () => { await assertCurrent(); deps.onStage?.('planning'); } });
    physicalRequests = generation.physicalRequests;
    await countDispatchedRequests();
    await assertCurrent();
    if (generation.status === 'outcome_unknown') {
      await deps.planStore.transitionJob(jobId, claim.fencingToken, 'outcome_unknown', { lastError: 'explicit replay approval required' }, now());
      return result('outcome_unknown', candidateId, ['outcome_unknown'], physicalRequests);
    }
    if (!generation.model) throw Object.assign(new Error(generation.parseErrors.join('; ') || 'candidate invalid'), { name: 'CandidateInvalidError' });
    const { compiled, errors } = compile(generation.model);
    if (errors.length) throw Object.assign(new Error(errors.join('; ')), { name: 'CandidateInvalidError' });
    await assertCurrent();
    // Publishing candidate + ready/setup state is fenced and atomic.
    await deps.db.transaction(async tx => {
      if (job.jobKind === 'opening_plan') {
        const setup = await tx.queryOne<{ status: string; intent_json: string }>('SELECT status,intent_json FROM campaign_setups WHERE setup_id=?', [job.setupId]);
        if (!setup || ['cancelled','adopted'].includes(setup.status) || sha256HexOf(canonicalJsonOf(JSON.parse(setup.intent_json))) !== compiled.plan.intentHash) throw new Error('campaign_intent_stale');
      }
      const won = await tx.execute("UPDATE campaign_plan_jobs SET status='candidate_ready',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND status='running' AND fencing_token=?", [now(), jobId, claim.fencingToken]);
      if (won !== 1) throw new Error('campaign_job_fence_expired');
      await deps.planStore.upsertCandidate({ candidateId, jobId, setupId: job.setupId, attemptGroup: 'a1', attemptNo: 1,
        stage: 'ready', rawResponseRef: `campaign-job:${jobId}`, rawResponseText: generation.rawText,
        parseResultJson: JSON.stringify(generation.model), validationErrors: [], repairUsed: existing?.repairUsed || physicalRequests > (existing?.rawResponseText ? 0 : 1),
        candidateHash: sha256HexOf(canonicalJsonOf({ plan: compiled.plan, artifact: compiled.artifact })),
        plan: compiled.plan, artifact: compiled.artifact, createdAt: existing?.createdAt ?? now(), updatedAt: now() }, tx);
      if (job.jobKind === 'opening_plan') await tx.execute("UPDATE campaign_setups SET status='proposal_ready',current_candidate_id=?,updated_at=? WHERE setup_id=? AND status NOT IN ('cancelled','adopted')", [candidateId, now(), job.setupId]);
    });
    return result('candidate_ready', candidateId, [], physicalRequests);
  } catch (error) {
    await countDispatchedRequests();
    const message = error instanceof Error ? error.message : String(error);
    const unknown = await deps.db.queryOne<{ n: number }>("SELECT COUNT(*) n FROM llm_request_attempts WHERE logical_request_id=? AND status='outcome_unknown' AND replay_approved_at IS NULL", [`campaign-plan:${jobId}`]);
    const status = /fence_expired|cancelled|base_plan_stale|intent_stale/.test(message) ? 'stale'
      : unknown?.n ? 'outcome_unknown'
      : error instanceof Error && ['CandidateInvalidError','FrozenMaterialsCorruptedError'].includes(error.name) ? 'invalid' : 'retryable_failed';
    const current = await deps.planStore.getJob(jobId);
    if (current?.status === 'running' && current.fencingToken === claim.fencingToken) {
      await deps.planStore.transitionJob(jobId, claim.fencingToken, status, { lastError: message.slice(0, 800) }, now());
      if (status === 'invalid') await deps.planStore.markCandidateStage(candidateId, 'rejected', [message], now());
      if (job.jobKind === 'opening_plan' && status === 'invalid') await deps.db.execute(
        "UPDATE campaign_setups SET status='failed',updated_at=? WHERE setup_id=? AND status NOT IN ('cancelled','adopted')", [now(), job.setupId]);
    }
    return result(status, candidateId, [message], physicalRequests);
  } finally {
    clearInterval(leaseTimer);
    releaseExecution?.();
    if (renewalInFlight) await renewalInFlight;
  }
}

import type { SqliteDatabase } from '../ports/sqlite';
import type { SqliteCampaignPlanStore } from '../../infra/sqlite/sqliteCampaignPlanStore';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import type { ApiProfile, LlmProvider } from '../llm/types';
import type { CampaignIntentV1 } from '../../domain/campaignPlan/types';
import { validateCampaignPlan, validateCampaignIntent } from '../../domain/campaignPlan/planValidation';
import type { ContentEntry } from '../../domain/content/types';
import { isEntryVisibleAtAnchor, isTemplateValidAtAnchor } from '../campaign/recruitment';
import { isFactVisibleAtAnchor } from '../world/opening';
import { compileCampaignPlan, firstSituationEntryId, type LocalCompileContext } from './localCompile';
import { buildPlanRequestMaterials, generateCampaignPlanCandidate } from './generationService';
import { canonicalJsonOf, sha256HexOf } from './hashing';
import { requireCompiledRules } from '../content/runtimeRules';

/**
 * Campaign planning job runner (P9-3, PROTOCOL_BASELINE.md §3). State machine:
 * queued → running → candidate_ready | invalid | retryable_failed |
 * outcome_unknown. Recovery points (A29): a candidate persisted at any stage
 * resumes from its durable artifact — raw responses are never re-requested
 * after a successful dispatch, and an outcome-unknown attempt requires the
 * explicit replay approval path before any new dispatch.
 */

export const CAMPAIGN_PLAN_FREEZE_SCHEMA = 'campaign-plan-freeze-1';

export interface PlanningRunDeps {
  db: SqliteDatabase;
  planStore: SqliteCampaignPlanStore;
  worldStore: SqliteWorldStore;
  provider: LlmProvider;
  profile: ApiProfile;
  now?: () => string;
}

export interface PlanningRunResult {
  jobId: string;
  status: 'candidate_ready' | 'invalid' | 'retryable_failed' | 'outcome_unknown' | 'stale' | 'already_ready';
  candidateId: string | null;
  errors: string[];
  physicalRequests: number;
}

interface FrozenPlanEnvelope {
  schema: typeof CAMPAIGN_PLAN_FREEZE_SCHEMA;
  setupId: string;
  jobId: string;
  intentHash: string;
  system: string;
  user: string;
}

async function saveFrozenMaterials(
  db: SqliteDatabase, envelope: FrozenPlanEnvelope, createdAt: string,
): Promise<void> {
  const payloadJson = JSON.stringify(envelope);
  await db.execute(
    `INSERT INTO frozen_turn_material_roots
      (root_id, campaign_id, branch_id, turn_id, logical_request_id, role, stage, attempt, payload_json, content_hash, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(root_id) DO NOTHING`,
    [`${envelope.setupId}:${envelope.jobId}:plan`, `setup:${envelope.setupId}`, envelope.setupId,
      envelope.jobId, `campaign-plan:${envelope.setupId}`, 'WorldMapper', 'plan', 1,
      payloadJson, sha256HexOf(payloadJson), createdAt],
  );
}

async function loadFrozenMaterials(
  db: SqliteDatabase, setupId: string, jobId: string,
): Promise<FrozenPlanEnvelope | null> {
  const row = await db.queryOne<{ payload_json: string; content_hash: string }>(
    'SELECT payload_json, content_hash FROM frozen_turn_material_roots WHERE root_id = ?',
    [`${setupId}:${jobId}:plan`]);
  if (!row) return null;
  if (sha256HexOf(row.payload_json) !== row.content_hash) {
    // T05/REG-001 semantics: keep the corrupt envelope, refuse re-freeze from live data.
    const err = new Error('campaign plan frozen materials corrupted (hash mismatch); refusing to re-derive from live data.');
    err.name = 'FrozenMaterialsCorruptedError';
    throw err;
  }
  return JSON.parse(row.payload_json) as FrozenPlanEnvelope;
}

/** Builds the local compile context from the published package + anchor. */
export async function buildPlanningContext(input: {
  worldStore: SqliteWorldStore;
  intent: CampaignIntentV1;
  protagonistSkills: readonly string[];
}): Promise<{ ctx: LocalCompileContext; visibleEntries: ContentEntry[]; worldTitle: string }> {
  const { worldStore, intent } = input;
  const pkg = await worldStore.getWorldPackage(intent.sourceCoverageBinding.worldId, intent.sourceCoverageBinding.packageRevision);
  if (!pkg) throw new Error(`World package not found: ${intent.sourceCoverageBinding.worldId} r${intent.sourceCoverageBinding.packageRevision}.`);
  const rules = requireCompiledRules(pkg.manifest.ruleConfiguration);
  const world = await worldStore.getWorld(intent.sourceCoverageBinding.worldId);
  const facts = await worldStore.listFacts(intent.sourceCoverageBinding.worldId);
  const anchorOrder = intent.openingAnchor.worldTimeOrder;
  const visibleEntries = pkg.entries.filter(entry =>
    entry.visibility === 'public' && isEntryVisibleAtAnchor(entry, facts, anchorOrder));
  const templates = pkg.entries.filter(entry => entry.kind === 'actor_template');
  const openingTemplates = new Set(templates
    .filter(entry => isTemplateValidAtAnchor(entry, anchorOrder))
    .map(entry => entry.entryId));
  const ruleBindingHash = sha256HexOf(canonicalJsonOf(rules.binding as unknown as Record<string, unknown>));
  const ctx: LocalCompileContext = {
    worldId: intent.sourceCoverageBinding.worldId,
    packageRevision: intent.sourceCoverageBinding.packageRevision,
    packageContentHash: pkg.manifest.contentHash,
    coverageWorldTimeOrder: Math.max(anchorOrder, intent.sourceCoverageBinding.coverageWorldTimeOrder),
    ruleBindingHash,
    visibleEntries,
    openingActorIds: new Set<string>([intent.protagonistBinding.actorId]),
    openingTemplateIds: openingTemplates,
    openingLocationId: intent.openingAnchor.locationId,
    protagonistSkills: new Set(input.protagonistSkills),
    availableFactIds: new Set(facts.filter(fact => fact.status !== 'speculation' && isFactVisibleAtAnchor(fact, anchorOrder)).map(fact => fact.factId)),
  };
  return { ctx, visibleEntries, worldTitle: world?.title ?? intent.sourceCoverageBinding.worldId };
}

export async function runOpeningPlanJob(deps: PlanningRunDeps, jobId: string, input: {
  anchorTitle: string;
  playerName: string;
  protagonistSkills: readonly string[];
  openingGoalSuggestions: readonly string[];
}): Promise<PlanningRunResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const job = await deps.planStore.getJob(jobId);
  if (!job) throw new Error(`Unknown campaign plan job: ${jobId}.`);
  if (job.status === 'candidate_ready') {
    return { jobId, status: 'already_ready', candidateId: (await deps.planStore.latestCandidateForJob(jobId))?.candidateId ?? null, errors: [], physicalRequests: 0 };
  }
  if (!['queued', 'running', 'retryable_failed'].includes(job.status)) {
    return { jobId, status: job.status === 'adopted' ? 'already_ready' : 'stale', candidateId: null, errors: [`job status ${job.status} is not runnable`], physicalRequests: 0 };
  }
  const leaseOwner = `plan-runner:${jobId}`;
  const leaseExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const claimed = await deps.planStore.claimJob(jobId, leaseOwner, leaseExpiry, now())
    ?? await deps.planStore.reclaimExpiredJob(jobId, leaseOwner, leaseExpiry, now());
  if (!claimed) {
    return { jobId, status: 'stale', candidateId: null, errors: ['job could not be claimed (lease held or not runnable)'], physicalRequests: 0 };
  }
  const fence = claimed.fencingToken;
  const setup = await deps.planStore.getSetup(job.setupId);
  if (!setup) {
    await deps.planStore.transitionJob(jobId, fence, 'invalid', { lastError: 'setup missing' }, now());
    return { jobId, status: 'invalid', candidateId: null, errors: ['setup missing'], physicalRequests: 0 };
  }
  const intentErrors = validateCampaignIntent(setup.intent);
  if (intentErrors.length > 0) {
    await deps.planStore.transitionJob(jobId, fence, 'invalid', { lastError: intentErrors.join('; ') }, now());
    return { jobId, status: 'invalid', candidateId: null, errors: intentErrors, physicalRequests: 0 };
  }
  const attemptGroup = `a${claimed.attemptCount + 1}`;
  const candidateId = `${jobId}:${attemptGroup}:1`;
  try {
    const { ctx, visibleEntries, worldTitle } = await buildPlanningContext({
      worldStore: deps.worldStore, intent: setup.intent, protagonistSkills: input.protagonistSkills,
    });
    const materials = buildPlanRequestMaterials({
      intent: setup.intent, ctx, visibleEntries, worldTitle,
      anchorTitle: input.anchorTitle, playerName: input.playerName,
      openingGoalSuggestions: input.openingGoalSuggestions,
    });
    const intentHash = sha256HexOf(canonicalJsonOf(setup.intent as unknown as Record<string, unknown>));
    const envelope: FrozenPlanEnvelope = {
      schema: CAMPAIGN_PLAN_FREEZE_SCHEMA, setupId: setup.setupId, jobId, intentHash,
      system: materials.system, user: materials.user,
    };
    // Recovery point: materials frozen BEFORE any dispatch; a re-run loads
    // the original envelope instead of re-deriving from live DB (A24).
    await saveFrozenMaterials(deps.db, envelope, now());
    const frozen = await loadFrozenMaterials(deps.db, setup.setupId, jobId);
    if (!frozen || frozen.intentHash !== intentHash) {
      throw new Error('frozen planning materials missing or intent drifted after freeze.');
    }
    // Recovery point: a durable ready/rejected candidate means no new dispatch.
    const existing = await deps.planStore.latestCandidateForJob(jobId);
    if (existing && (existing.stage === 'ready' || existing.stage === 'rejected')) {
      const nextStatus = existing.stage === 'ready' ? 'candidate_ready' : 'invalid';
      await deps.planStore.transitionJob(jobId, fence, nextStatus, { attemptCount: claimed.attemptCount + 1, lastError: existing.stage === 'ready' ? null : existing.validationErrors.join('; ').slice(0, 400) }, now());
      return { jobId, status: nextStatus === 'candidate_ready' ? 'candidate_ready' : 'invalid', candidateId: existing.candidateId, errors: existing.validationErrors, physicalRequests: 0 };
    }

    await deps.planStore.upsertCandidate({
      candidateId, jobId, setupId: setup.setupId, attemptGroup, attemptNo: 1,
      stage: 'repairing', rawResponseRef: `${setup.setupId}:${jobId}:plan`, rawResponseText: null,
      parseResultJson: null, validationErrors: [], repairUsed: false,
      candidateHash: '', plan: null, artifact: null, createdAt: now(), updatedAt: now(),
    });
    const generation = await generateCampaignPlanCandidate({
      provider: deps.provider, profile: deps.profile,
      materials: { system: envelope.system, user: envelope.user },
      logicalRequestId: `campaign-plan:${setup.setupId}:${jobId}`,
      worldId: setup.intent.sourceCoverageBinding.worldId,
    });
    // Recovery point: raw response persisted before validation (A29).
    await deps.planStore.upsertCandidate({
      candidateId, jobId, setupId: setup.setupId, attemptGroup, attemptNo: 1,
      stage: 'raw_response', rawResponseRef: `${setup.setupId}:${jobId}:plan`, rawResponseText: generation.rawText.slice(0, 200_000),
      parseResultJson: null, validationErrors: generation.parseErrors, repairUsed: generation.physicalRequests > 1,
      candidateHash: sha256HexOf(generation.rawText), plan: null, artifact: null, createdAt: now(), updatedAt: now(),
    });
    if (generation.status === 'outcome_unknown') {
      await deps.planStore.transitionJob(jobId, fence, 'outcome_unknown', { lastError: 'physical outcome unknown; explicit replay approval required', attemptCount: claimed.attemptCount + 1 }, now());
      return { jobId, status: 'outcome_unknown', candidateId, errors: ['outcome_unknown'], physicalRequests: generation.physicalRequests };
    }
    if (generation.status !== 'ready' || generation.model === null) {
      await deps.planStore.markCandidateStage(candidateId, 'rejected', generation.parseErrors, now());
      await deps.planStore.transitionJob(jobId, fence, 'invalid', { lastError: generation.parseErrors.slice(0, 8).join('; ').slice(0, 400), attemptCount: claimed.attemptCount + 1 }, now());
      await deps.db.execute("UPDATE campaign_setups SET status='failed', updated_at=? WHERE setup_id=?", [now(), setup.setupId]);
      return { jobId, status: 'invalid', candidateId, errors: generation.parseErrors, physicalRequests: generation.physicalRequests };
    }
    const compiled = compileCampaignPlan({
      model: generation.model, intent: setup.intent, ctx,
      planId: `plan-${setup.setupId}`, revision: 1, parentRevision: null, createdAt: now(),
    });
    if (compiled.errors.length > 0) {
      await deps.planStore.markCandidateStage(candidateId, 'rejected', compiled.errors, now());
      await deps.planStore.transitionJob(jobId, fence, 'invalid', { lastError: compiled.errors.slice(0, 8).join('; ').slice(0, 400), attemptCount: claimed.attemptCount + 1 }, now());
      await deps.db.execute("UPDATE campaign_setups SET status='failed', updated_at=? WHERE setup_id=?", [now(), setup.setupId]);
      return { jobId, status: 'invalid', candidateId, errors: compiled.errors, physicalRequests: generation.physicalRequests };
    }
    const artifactSituationIds = new Set(compiled.artifact.situations.map(s => s.entryId));
    const validation = validateCampaignPlan(compiled.plan, {
      visibleWorldEntryIds: new Set(visibleEntries.map(entry => entry.entryId)),
      openingActorIds: ctx.openingActorIds,
      openingTemplateIds: ctx.openingTemplateIds,
      artifactSituationIds,
      knownLocationIds: undefined,
      protagonistSkills: ctx.protagonistSkills,
    }, compiled.artifact);
    if (validation.length > 0) {
      await deps.planStore.markCandidateStage(candidateId, 'rejected', validation, now());
      await deps.planStore.transitionJob(jobId, fence, 'invalid', { lastError: validation.slice(0, 8).join('; ').slice(0, 400), attemptCount: claimed.attemptCount + 1 }, now());
      await deps.db.execute("UPDATE campaign_setups SET status='failed', updated_at=? WHERE setup_id=?", [now(), setup.setupId]);
      return { jobId, status: 'invalid', candidateId, errors: validation, physicalRequests: generation.physicalRequests };
    }
    await deps.planStore.upsertCandidate({
      candidateId, jobId, setupId: setup.setupId, attemptGroup, attemptNo: 1,
      stage: 'ready', rawResponseRef: `${setup.setupId}:${jobId}:plan`, rawResponseText: generation.rawText.slice(0, 200_000),
      parseResultJson: null, validationErrors: [], repairUsed: generation.physicalRequests > 1,
      candidateHash: sha256HexOf(canonicalJsonOf({ plan: compiled.plan, artifact: compiled.artifact })),
      plan: compiled.plan, artifact: compiled.artifact, createdAt: now(), updatedAt: now(),
    });
    await deps.planStore.transitionJob(jobId, fence, 'candidate_ready', { attemptCount: claimed.attemptCount + 1 }, now());
    await deps.db.execute(
      `UPDATE campaign_setups SET status='proposal_ready', current_candidate_id=?, updated_at=? WHERE setup_id=?`,
      [candidateId, now(), setup.setupId],
    );
    return { jobId, status: 'candidate_ready', candidateId, errors: [], physicalRequests: generation.physicalRequests };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = !['FrozenMaterialsCorruptedError'].includes(error instanceof Error ? error.name : '');
    await deps.planStore.transitionJob(jobId, fence, retryable ? 'retryable_failed' : 'invalid',
      { lastError: message.slice(0, 400), attemptCount: claimed.attemptCount + 1 }, now());
    return { jobId, status: retryable ? 'retryable_failed' : 'invalid', candidateId, errors: [message], physicalRequests: 0 };
  }
}

export { firstSituationEntryId };

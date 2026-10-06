/**
 * P9 campaign planning bridge (plan §13): the opening wizard's "这次冒险"
 * step. All flows — quick opening and the advanced wizard — go through the
 * SAME production services (setup/job store, ledgered provider, atomic
 * adoption); the UI only reads status and renders the proposal card.
 */
import type { ApiProfile, LlmProvider } from '../../src/application/llm/types';
import type { CampaignIntentV1 } from '../../src/domain/campaignPlan/types';
import { SqliteCampaignPlanStore } from '../../src/infra/sqlite/sqliteCampaignPlanStore';
import { runOpeningPlanJob } from '../../src/application/campaignPlan/planningService';
import { adoptOpeningPlan } from '../../src/application/campaignPlan/adoption';
import { getDatabaseRuntime } from './database';
import { buildProvider } from './runtime';
import { resolveSkillKey } from '../../src/domain/characters/card';

export type PlanningPhase =
  | 'preparing'      // 准备相关资料
  | 'planning'       // 规划冒险
  | 'validating'     // 校验可玩性
  | 'ready'          // 已准备好
  | 'failed'
  | 'outcome_unknown';

export interface PreparePlanInput {
  profile: ApiProfile;
  worldId: string;
  worldTitle: string;
  packageRevision: number;
  packageContentHash: string;
  anchor: { worldTimeOrder: number; anchorEventId?: string; locationId: string };
  anchorTitle: string;
  protagonist: { actorId: string; kind: 'original' | 'canon'; name: string; canonEntityId?: string };
  protagonistSkills: readonly string[];
  companions: ReadonlyArray<{ actorId: string; templateId: string; directive?: string }>;
  goal: string;
  goalMode?: 'declared' | 'exploration_pending';
  lengthPreference?: 'short' | 'medium' | 'long';
  tone?: string;
  userConstraints?: readonly string[];
  goalSuggestions?: readonly string[];
  coverageWorldTimeOrder?: number;
}

export interface PreparePlanResult {
  setupId: string;
  jobId: string;
  phase: PlanningPhase;
  candidateId: string | null;
  error?: string;
}

export function makeCampaignIntent(input: PreparePlanInput): CampaignIntentV1 {
  const now = new Date().toISOString();
  return {
    schemaVersion: 'campaign-intent-1',
    setupId: `setup-${input.worldId}-${Date.now().toString(36)}`,
    intentRevision: 1,
    rawIntent: input.goal,
    normalizedIntent: input.goal.trim().slice(0, 300),
    goalMode: input.goalMode ?? (input.goal.trim().length > 0 ? 'declared' : 'exploration_pending'),
    protagonistBinding: {
      actorId: input.protagonist.actorId,
      kind: input.protagonist.kind,
      name: input.protagonist.name,
      ...(input.protagonist.canonEntityId ? { canonEntityId: input.protagonist.canonEntityId } : {}),
    },
    openingAnchor: {
      worldTimeOrder: input.anchor.worldTimeOrder,
      ...(input.anchor.anchorEventId ? { anchorEventId: input.anchor.anchorEventId } : {}),
      locationId: input.anchor.locationId,
    },
    companionBindings: input.companions.map(companion => ({
      actorId: companion.actorId,
      templateId: companion.templateId,
      ...(companion.directive ? { directive: companion.directive as import('../../src/domain/characters/card').CompanionDirective } : {}),
    })),
    ...(input.tone ? { tone: input.tone } : {}),
    lengthPreference: input.lengthPreference ?? 'medium',
    userConstraints: [...(input.userConstraints ?? [])].slice(0, 8),
    requestedCanonTargets: [],
    knowledgePolicy: 'anchor_projection',
    sourceCoverageBinding: {
      worldId: input.worldId,
      packageRevision: input.packageRevision,
      coverageWorldTimeOrder: input.coverageWorldTimeOrder ?? input.anchor.worldTimeOrder,
      packageContentHash: input.packageContentHash,
    },
    createdAt: now,
  };
}

/** Creates the setup + job and runs planning to a terminal phase. */
export async function prepareCampaignPlan(
  input: PreparePlanInput,
  onPhase?: (phase: PlanningPhase) => void,
): Promise<PreparePlanResult> {
  const runtime = await getDatabaseRuntime();
  const planStore = new SqliteCampaignPlanStore(runtime.db);
  const intent = makeCampaignIntent(input);
  const now = new Date().toISOString();
  onPhase?.('preparing');
  await planStore.upsertSetup({
    setupId: intent.setupId, worldId: input.worldId, packageRevision: input.packageRevision,
    intent, intentHistory: [intent], currentCandidateId: null, status: 'planning', createdAt: now, updatedAt: now,
  });
  const jobId = `job-${intent.setupId}`;
  // Cancel any stale in-flight job for a previous setup of this wizard entry.
  await planStore.insertJob({
    jobId, setupId: intent.setupId, campaignId: null, branchId: null, jobKind: 'opening_plan',
    triggerReasons: ['user_requested'], baseStateVersion: null, basePlanId: null, basePlanRevision: null,
    intentHash: 'i'.repeat(64), contentManifestHash: null, knowledgePolicyHash: null, triggerEventRefs: [],
    status: 'queued', leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, attemptCount: 0,
    nextRetryAt: null, physicalRequestBudget: 2, freezeRootId: null, lastError: null, createdAt: now, updatedAt: now,
  });
  onPhase?.('planning');
  const provider: LlmProvider = await buildProvider(input.profile);
  const run = await runOpeningPlanJob({
    db: runtime.db, planStore, worldStore: runtime.worldStore, provider, profile: input.profile,
  }, jobId, {
    anchorTitle: input.anchorTitle,
    playerName: input.protagonist.name,
    protagonistSkills: input.protagonistSkills.filter(skill => typeof skill === 'string'),
    openingGoalSuggestions: input.goalSuggestions ?? [],
  });
  if (run.status === 'candidate_ready') {
    onPhase?.('validating');
    onPhase?.('ready');
    return { setupId: intent.setupId, jobId, phase: 'ready', candidateId: run.candidateId };
  }
  if (run.status === 'outcome_unknown') {
    return { setupId: intent.setupId, jobId, phase: 'outcome_unknown', candidateId: run.candidateId,
      error: '云端结果未知，可能已计费；请在网络稳定后重试。' };
  }
  return { setupId: intent.setupId, jobId, phase: 'failed', candidateId: run.candidateId,
    error: run.errors.slice(0, 3).join('；') || '提案校验未通过。' };
}

export interface ProposalView {
  setupId: string;
  candidateId: string;
  title: string;
  longTermGoal: string;
  publicPitch: string;
  tone: string;
  lengthPreference: string;
  firstStageTitle: string;
  firstStageObjective: string;
  stageCount: number;
}

/** Reads a persisted proposal for wizard resume (A08: placeholder never ready). */
export async function readReadyProposal(setupId: string): Promise<ProposalView | null> {
  const runtime = await getDatabaseRuntime();
  const planStore = new SqliteCampaignPlanStore(runtime.db);
  const setup = await planStore.getSetup(setupId);
  if (!setup || setup.status !== 'proposal_ready' || !setup.currentCandidateId) return null;
  const candidate = await planStore.getCandidate(setup.currentCandidateId);
  if (!candidate || candidate.stage !== 'ready' || !candidate.plan) return null;
  const plan = candidate.plan;
  const firstStage = plan.nodes.find(node => plan.startNodeIds.includes(node.nodeId))
    ?? plan.nodes[0];
  return {
    setupId, candidateId: candidate.candidateId,
    title: plan.publicPitch.slice(0, 24),
    longTermGoal: plan.longTermGoal,
    publicPitch: plan.publicPitch,
    tone: plan.tone,
    lengthPreference: plan.lengthPreference,
    firstStageTitle: firstStage?.title ?? '',
    firstStageObjective: firstStage?.publicObjective ?? '',
    stageCount: plan.nodes.filter(node => node.role === 'main').length,
  };
}

/** Finds the latest ready proposal for a world (wizard resume after restart). */
export async function findReadyProposalForWorld(worldId: string): Promise<ProposalView | null> {
  const runtime = await getDatabaseRuntime();
  const rows = await runtime.db.queryAll<{ setup_id: string }>(
    "SELECT setup_id FROM campaign_setups WHERE world_id=? AND status='proposal_ready' ORDER BY updated_at DESC LIMIT 1",
    [worldId]);
  const setupId = rows[0]?.setup_id;
  return setupId ? readReadyProposal(setupId) : null;
}

export interface AdoptPlanInput {
  profile: ApiProfile;
  setupId: string;
  candidateId: string;
  campaignId: string;
  title: string;
  worldId: string;
  packageRevision: number;
  anchor: { worldTimeOrder: number; anchorEventId?: string; locationId: string };
  protagonist: {
    actorId: string;
    kind: 'original' | 'canon';
    name: string;
    description?: string;
    attributes?: Record<string, number>;
    initialSkills?: readonly string[];
    canonEntityId?: string;
  };
  companions: ReadonlyArray<{ actorId: string; templateId: string; directive?: string }>;
}

/** One click starts the adventure: idempotent atomic adoption (A09). */
export async function adoptCampaignPlan(input: AdoptPlanInput): Promise<{ campaignId: string; branchId: string }> {
  const runtime = await getDatabaseRuntime();
  const planStore = new SqliteCampaignPlanStore(runtime.db);
  const result = await adoptOpeningPlan({
    db: runtime.db,
    planStore,
    setupId: input.setupId,
    candidateId: input.candidateId,
    create: {
      db: runtime.db,
      worldStore: runtime.worldStore,
      campaignId: input.campaignId,
      title: input.title,
      worldId: input.worldId,
      packageRevision: input.packageRevision,
      anchor: input.anchor,
      protagonist: {
        actorId: input.protagonist.actorId,
        kind: input.protagonist.kind,
        name: input.protagonist.name,
        description: input.protagonist.description,
        ...(input.protagonist.kind === 'original'
          ? { attributes: input.protagonist.attributes, initialSkills: [...(input.protagonist.initialSkills ?? [])] }
          : { canonEntityId: input.protagonist.canonEntityId }),
      },
      companions: input.companions.map(companion => ({
        actorId: companion.actorId,
        templateId: companion.templateId,
        ...(companion.directive ? { directive: companion.directive as import('../../src/domain/characters/card').CompanionDirective } : {}),
      })),
      goal: '战役主线',
      createdAt: new Date().toISOString(),
    },
  });
  return { campaignId: result.campaign.campaignId, branchId: result.campaign.branchId };
}

/** Player-known opening skill ids for the plan context (public projection). */
export function normalizedOpeningSkills(skills: readonly string[]): string[] {
  return skills.map(skill => skill.replace(/^skill-/, ''));
}

export { resolveSkillKey };

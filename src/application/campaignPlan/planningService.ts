import type { SqliteDatabase } from '../ports/sqlite';
import type { SqliteCampaignPlanStore } from '../../infra/sqlite/sqliteCampaignPlanStore';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import type { ApiProfile, LlmProvider } from '../llm/types';
import type { CampaignIntentV1 } from '../../domain/campaignPlan/types';
import type { ContentEntry } from '../../domain/content/types';
import { isEntryVisibleAtAnchor, isTemplateValidAtAnchor } from '../campaign/recruitment';
import { buildOpening, isFactVisibleAtAnchor } from '../world/opening';
import { firstSituationEntryId, type LocalCompileContext } from './localCompile';
import { canonicalJsonOf, sha256HexOf } from './hashing';
import { requireCompiledRules } from '../content/runtimeRules';


export { CAMPAIGN_PLAN_FREEZE_SCHEMA } from "./jobFreeze";
export interface PlanningRunDeps {
  db: SqliteDatabase;
  planStore: SqliteCampaignPlanStore;
  worldStore: SqliteWorldStore;
  provider: LlmProvider;
  profile: ApiProfile;
  now?: () => string;
  onStage?: (phase: 'planning' | 'validating') => void;
  segmentContent?: { loadEffectiveCatalog(input: { campaignId: string; branchId: string;
    binding?: import('../../domain/content/segmentArtifact').SegmentContentBindingV1 }): Promise<{ entries: ContentEntry[] }> };
}

export interface PlanningRunResult {
  jobId: string;
  status: 'candidate_ready' | 'invalid' | 'retryable_failed' | 'outcome_unknown' | 'stale' | 'already_ready';
  candidateId: string | null;
  errors: string[];
  physicalRequests: number;
}

/** Builds the local compile context from the published package + anchor. */
export async function buildPlanningContext(input: {
  worldStore: SqliteWorldStore;
  intent: CampaignIntentV1;
  protagonistSkills: readonly string[];
  effectiveEntries?: readonly ContentEntry[];
  projectionOrder?: number;
}): Promise<{ ctx: LocalCompileContext; visibleEntries: ContentEntry[]; worldTitle: string }> {
  const { worldStore, intent } = input;
  const pkg = await worldStore.getWorldPackage(intent.sourceCoverageBinding.worldId, intent.sourceCoverageBinding.packageRevision);
  if (!pkg) throw new Error(`World package not found: ${intent.sourceCoverageBinding.worldId} r${intent.sourceCoverageBinding.packageRevision}.`);
  if (pkg.manifest.status !== 'published' || pkg.manifest.contentHash !== intent.sourceCoverageBinding.packageContentHash) {
    throw new Error('规划所绑定的世界版本已改变，请重新准备开局。');
  }
  const rules = requireCompiledRules(pkg.manifest.ruleConfiguration);
  const world = await worldStore.getWorld(intent.sourceCoverageBinding.worldId);
  const facts = await worldStore.listFacts(intent.sourceCoverageBinding.worldId);
  const entities = await worldStore.listEntities(intent.sourceCoverageBinding.worldId);
  const anchorOrder = input.projectionOrder ?? intent.openingAnchor.worldTimeOrder;
  const entries = input.effectiveEntries ?? pkg.entries;
  const visibleEntries = entries.filter(entry =>
    entry.visibility === 'public' && isEntryVisibleAtAnchor(entry, facts, anchorOrder));
  const templates = entries.filter(entry => entry.kind === 'actor_template' && isEntryVisibleAtAnchor(entry, facts, anchorOrder));
  const openingTemplates = new Set(templates
    .filter(entry => isTemplateValidAtAnchor(entry, anchorOrder))
    .map(entry => entry.entryId));
  const ruleBindingHash = sha256HexOf(canonicalJsonOf(rules.binding as unknown as Record<string, unknown>));
  let skills = intent.protagonistBinding.initialSkills ?? input.protagonistSkills;
  let skillRanks: Record<string, string> = Object.fromEntries(skills.map(id => [id, 'novice']));
  let locationId = intent.openingAnchor.locationId;
  if (intent.protagonistBinding.kind === 'canon') {
    const entity = intent.protagonistBinding.canonEntityId
      ? await worldStore.getEntity(intent.sourceCoverageBinding.worldId, intent.protagonistBinding.canonEntityId) : null;
    if (!entity || !facts.some(f => f.subjectEntityId === entity.entityId && !['speculation','conflict'].includes(f.status)
      && isFactVisibleAtAnchor(f, anchorOrder))) throw new Error('原著角色在该开局锚点没有可用身份。');
    const opening = buildOpening({ kind: 'canon', actorId: intent.protagonistBinding.actorId,
      displayName: intent.protagonistBinding.name, branchId: `setup:${intent.setupId}`, worldTimeOrder: anchorOrder,
      canonEntity: entity, fallbackLocationId: locationId }, { facts, mappings: await worldStore.listRuleMappings(intent.sourceCoverageBinding.worldId) });
    skills = Object.entries(opening.profile.skillRanks).filter(([, rank]) => rank !== 'untrained').map(([id]) => id);
    skillRanks = opening.profile.skillRanks;
    locationId = opening.startLocation;
  }
  const ctx: LocalCompileContext = {
    worldId: intent.sourceCoverageBinding.worldId,
    packageRevision: intent.sourceCoverageBinding.packageRevision,
    packageContentHash: pkg.manifest.contentHash,
    coverageWorldTimeOrder: Math.max(anchorOrder, intent.sourceCoverageBinding.coverageWorldTimeOrder),
    ruleBindingHash,
    visibleEntries,
    openingActorIds: new Set<string>([intent.protagonistBinding.actorId, ...intent.companionBindings.map(c => c.actorId)]),
    openingTemplateIds: openingTemplates,
    openingLocationId: locationId,
    protagonistSkills: new Set(skills),
    protagonistActorId: intent.protagonistBinding.actorId,
    protagonistSkillRanks: skillRanks,
    presentActorRefs: [intent.protagonistBinding.actorId, ...intent.companionBindings.map(c => c.actorId),
      ...visibleEntries.filter(e => e.kind === 'scene' && (e.definition as { locationId?: string }).locationId === locationId)
        .flatMap(e => (e.definition as { actors: string[] }).actors)
        .filter(id => visibleEntries.some(e => e.kind === 'actor_template' && e.entryId === id) && openingTemplates.has(id))
        .flatMap(id => [id, `npc-${id}`])],
    actorMaterials: templates.filter(t => openingTemplates.has(t.entryId)).map(t => {
      const d = t.definition as { name?: string; description?: string; behavior?: { goal?: string } };
      return { actorId: t.entryId, name: d.name ?? t.entryId, description: d.description ?? '', goal: d.behavior?.goal ?? '' };
    }),
    openingFacts: facts.filter(f => !['speculation','conflict'].includes(f.status) && isFactVisibleAtAnchor(f, anchorOrder)).slice(0, 40)
      .map(f => ({ factId: f.factId, subject: entities.find(e => e.entityId === f.subjectEntityId)?.name ?? f.subjectEntityId, predicate: f.predicate, value: f.value })),
    availableFactIds: new Set(facts.filter(fact => !['speculation','conflict'].includes(fact.status) && isFactVisibleAtAnchor(fact, anchorOrder)).map(fact => fact.factId)),
  };
  return { ctx, visibleEntries, worldTitle: world?.title ?? intent.sourceCoverageBinding.worldId };
}

export async function runOpeningPlanJob(deps: PlanningRunDeps, jobId: string, input: {
  anchorTitle: string; playerName: string; protagonistSkills: readonly string[]; openingGoalSuggestions: readonly string[];
}): Promise<PlanningRunResult> {
  const { runCandidateJob } = await import('./candidateJob');
  return runCandidateJob(deps, jobId, input);
}
export { firstSituationEntryId };

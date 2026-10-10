import type { SqliteDatabase } from '../ports/sqlite';
import type { SqliteCampaignPlanStore } from '../../infra/sqlite/sqliteCampaignPlanStore';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import type { ApiProfile, LlmProvider } from '../llm/types';
import type { CampaignIntentV1 } from '../../domain/campaignPlan/types';
import type { ContentEntry } from '../../domain/content/types';
import type { StoredFact } from '../ports/worldStore';
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
  /** Composition-root lifetime protection; SQL leases/ledger own execution. */
  acquireExecution?: () => Promise<() => void>;
  segmentContent?: { loadEffectiveCatalog(input: { campaignId: string; branchId: string;
    binding?: import('../../domain/content/segmentArtifact').SegmentContentBindingV1 }): Promise<{ entries: ContentEntry[] }> };
}

async function anchorSourceChapterIndex(input: {
  worldStore: SqliteWorldStore;
  worldId: string;
  anchorEventId?: string;
  openingAnchorOrder: number;
  requestedProjectionOrder: number;
}): Promise<{ chapterIndexById: ReadonlyMap<string, number>; maximumVisibleChapterIndex: number | null }> {
  const chapters = await input.worldStore.getChapters(input.worldId);
  const chapterIndexById = new Map(chapters.map(chapter => [chapter.chapterId, chapter.index]));
  if (chapters.length === 0) {
    if (input.anchorEventId) throw new Error('campaign_anchor_source_chapter_unresolved');
    return { chapterIndexById, maximumVisibleChapterIndex: null };
  }
  if (input.anchorEventId) {
    const [proposals, events] = await Promise.all([
      input.worldStore.listEventProposals(input.worldId),
      input.worldStore.listEvents(input.worldId),
    ]);
    const anchor = [...proposals, ...events].find(event => event.eventId === input.anchorEventId);
    const index = anchor?.narrativeChapterId ? chapterIndexById.get(anchor.narrativeChapterId) : undefined;
    if (index === undefined) throw new Error('campaign_anchor_source_chapter_unresolved');
    const projectionChapterIndexes = input.requestedProjectionOrder > input.openingAnchorOrder
      ? [...proposals, ...events]
        .filter(event => event.worldTimeOrder !== null && event.worldTimeOrder <= input.requestedProjectionOrder)
        .map(event => event.narrativeChapterId ? chapterIndexById.get(event.narrativeChapterId) : undefined)
        .filter((chapterIndex): chapterIndex is number => chapterIndex !== undefined)
      : [];
    return { chapterIndexById,
      maximumVisibleChapterIndex: Math.max(index, ...projectionChapterIndexes) };
  }
  // Without a canon event binding, use the earliest source chapter. This is a
  // conservative opening projection; a later chapter must be selected through
  // its anchored event before its source facts can enter a new plan.
  const firstChapterIndex = Math.min(...chapters.map(chapter => chapter.index));
  if (input.requestedProjectionOrder <= input.openingAnchorOrder) {
    return { chapterIndexById, maximumVisibleChapterIndex: firstChapterIndex };
  }
  const [proposals, events] = await Promise.all([
    input.worldStore.listEventProposals(input.worldId),
    input.worldStore.listEvents(input.worldId),
  ]);
  const projectionChapterIndexes = [...proposals, ...events]
    .filter(event => event.worldTimeOrder !== null && event.worldTimeOrder <= input.requestedProjectionOrder)
    .map(event => event.narrativeChapterId ? chapterIndexById.get(event.narrativeChapterId) : undefined)
    .filter((chapterIndex): chapterIndex is number => chapterIndex !== undefined);
  return { chapterIndexById,
    maximumVisibleChapterIndex: Math.max(firstChapterIndex, ...projectionChapterIndexes) };
}

function factSourceVisibleAtAnchor(
  fact: StoredFact,
  chapterIndexById: ReadonlyMap<string, number>,
  maximumVisibleChapterIndex: number | null,
): boolean {
  if (maximumVisibleChapterIndex === null) return true;
  const sourceIndexes = fact.sources.map(source => chapterIndexById.get(source.chapterId))
    .filter((index): index is number => index !== undefined);
  return sourceIndexes.length > 0 && Math.min(...sourceIndexes) <= maximumVisibleChapterIndex;
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
  const sourceChapter = await anchorSourceChapterIndex({ worldStore, worldId: intent.sourceCoverageBinding.worldId,
    anchorEventId: intent.openingAnchor.anchorEventId, openingAnchorOrder: intent.openingAnchor.worldTimeOrder,
    requestedProjectionOrder: anchorOrder });
  const anchorFacts = facts.filter(fact => !['speculation','conflict'].includes(fact.status)
    && isFactVisibleAtAnchor(fact, anchorOrder)
    && factSourceVisibleAtAnchor(fact, sourceChapter.chapterIndexById, sourceChapter.maximumVisibleChapterIndex));
  const entries = input.effectiveEntries ?? pkg.entries;
  const visibleEntries = entries.filter(entry =>
    entry.visibility === 'public' && isEntryVisibleAtAnchor(entry, anchorFacts, anchorOrder));
  const templates = entries.filter(entry => entry.kind === 'actor_template' && isEntryVisibleAtAnchor(entry, anchorFacts, anchorOrder));
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
    if (!entity || !anchorFacts.some(f => f.subjectEntityId === entity.entityId)) throw new Error('原著角色在该开局锚点没有可用身份。');
    const opening = buildOpening({ kind: 'canon', actorId: intent.protagonistBinding.actorId,
      displayName: intent.protagonistBinding.name, branchId: `setup:${intent.setupId}`, worldTimeOrder: anchorOrder,
      canonEntity: entity, fallbackLocationId: locationId }, { facts: anchorFacts, mappings: await worldStore.listRuleMappings(intent.sourceCoverageBinding.worldId) });
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
    openingFacts: anchorFacts
      .map(f => ({ factId: f.factId, subject: entities.find(e => e.entityId === f.subjectEntityId)?.name ?? f.subjectEntityId, predicate: f.predicate, value: f.value })),
    availableFactIds: new Set(anchorFacts.map(fact => fact.factId)),
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

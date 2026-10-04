import { SqliteInteractionOperationJournal } from './interactionOrchestrator';
import { RejectionSamplingRandomSource } from '../../domain/rules/random';
import type { DifficultyBand, RollGrade, SkillRank } from '../../domain/rules/types';
import type { ActionContract } from '../../domain/turns/types';
import type { LlmProvider } from '../llm/types';
import { LedgeredProvider } from '../llm/requestLedger';
import { RateScheduledProvider } from '../llm/scheduledProvider';
import { llmModelProfileFingerprint } from '../llm/profileFingerprint';
import type { LlmRequestLedgerStore } from '../ports/llmLedger';
import type { SqliteStoryMemoryStore } from '../memory/storyMemoryRepository';
import type { SqliteEpisodicStore } from '../memory/episodicStore';
import { episodicRecordFromTurn } from '../memory/episodicStore';
import { runStoryMemoryMaintenance, shouldRunMaintenance } from '../memory/storyMemoryMaintenance';
import { recallEpisodes, renderEpisodicRecall } from '../memory/episodicRetriever';
import { compilePreviousMemoryView } from '../memory/storyMemoryCompiler';
import { resolveModelCapabilities } from '../llm/capabilityResolver';
import { DEFAULT_OUTPUT_DEMANDS } from '../llm/requestBudgetKernel';
import { normalizeReasoningTier } from '../llm/types';
import {
  reasoningDialectForModel,
  REASONING_ONLY_RESERVE_MULTIPLIER,
  REASONING_POLICY_VERSION,
} from '../llm/reasoningPolicy';
import type { FrozenModelCapabilities } from '../llm/requestPlan';
import {
  buildCandidate,
  candidatesFromParts,
} from '../context/candidateCollector';
import type { ContextCandidate } from '../context/contextTypes';
import { planTurnContext } from '../context/contextPlanner';
import { renderFrozenContext } from '../context/contextRenderer';
import type { FrozenTurnContext } from '../context/contextSnapshot';
import { estimateTokens } from '../context/tokenEstimate';
import { runV2Turn } from '../game/v2Turn';
import { packageIndexes } from '../game/v2Compile';
import type { ApiProfile } from '../llm/types';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import type { RandomSource } from '../../domain/rules/random';
import type { GameStateSnapshot } from '../../domain/state/types';
import { describeWorldClock } from '../../domain/state/worldClock';
import type { SqliteDatabase, SqliteRow } from '../ports/sqlite';
import type { SqliteTurnStore } from '../../infra/sqlite/sqliteTurnStore';
import type { SqliteGameStore } from '../../infra/sqlite/sqliteGameStore';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import type { SqliteNarrativeStore } from '../../infra/sqlite/sqliteNarrativeStore';
import type { TurnSettlementPlan } from '../ports/turnStore';
import type { ProgressiveTurnContextService } from '../progressiveBuild/progressiveTurnContext';
import type { SourceStore } from '../ports/sourceStore';
import { visibleEvidenceRanges } from '../progressiveBuild/progressiveTurnContext';
import { segmentKnowledgeFromConfirmedEvidence } from './segmentKnowledge';
import {
  assertTrainingAllowed,
  awardPractice,
  challengeClosedKey,
  isTrainable,
  openChallengeId,
  applyMilestonePractice,
  rewardKey,
  SKILL_RANK_ORDER,
  trainSkill,
  type SkillProgress,
  type TrainingConditions,
} from '../../domain/progression/growth';
import {
  createTemplateCard,
  rollSpecForSkill,
  resolveSkillKey,
  SkillNotDefinedError,
  SkillNotTrainedError,
  type ActorCard,
  type SkillCatalog,
} from '../../domain/characters/card';
import type {
  ActorTemplateDefinition,
  AbilityDefinition,
  BookSection,
  BranchContentManifest,
  ContentEntry,
  LoreDefinition,
  ConstraintDefinition,
  SceneDefinition,
  SkillDefinition,
  QuestDefinition,
} from '../../domain/content/types';
import type { CompanionDirective } from '../../domain/characters/card';
import type { PartySnapshotEntry, RelationshipSnapshotEntry } from '../../domain/state/types';
import { assembleBook } from '../worldPackage/publish';
import { isEntryVisibleAtAnchor, isPlayerRecruitmentCandidate, isTemplateValidAtAnchor, openingRelationshipFor, meetsRecruitmentRelationship } from './recruitment';
import { isFactVisibleAtAnchor } from '../world/opening';
import { retrieveContext } from '../memory/retrieval';
import { commitResolvedTurn, prepareTurnResolution, type PreparedTurnResolution } from '../turns/commitTurn';
import { applySituationRuntime } from '../situations/causalProjection';
import type {
  MethodTemplateV1,
  SituationDefinitionV1,
  SituationTransitionOp,
} from '../../domain/situations/types';
import { buildSituationPacket } from '../guidance/packet';
import { assessMethod, baseActionCandidates } from '../guidance/candidates';
import { SHORT_REST_MINUTES, SHORT_REST_STAMINA_RESTORE } from '../../domain/rules/restPolicy';
import { decisionPointIdFor, guidanceContentBindingHash } from '../guidance/types';
import type { AllowedCandidateV1 } from '../guidance/types';
import { assembleTurnGuidance } from '../guidance/validate';
import { buildLocalAncillaryGuidance, upgradeAncillaryGuidance } from '../guidance/ancillary';
import type { PublicSituationPacketV1, TurnGuidanceV1, GuidanceDecisionPointBinding } from '../guidance/types';
import type { GuidanceStore } from '../ports/guidanceStore';
import { canonicalStringify } from '../../domain/turns/canonical';
import { forkBranch } from '../branch/fork';
import { hasBranchContentManifestTable, ensureBaseBranchContentManifest } from '../worldPackage/branchContentStore';
import { contentDependencyBinding, createBaseContentManifest, loadBranchDeltaEntries } from '../worldPackage/contentManifest';
import { projectLegacyAnchorlessOpeningFacts } from '../worldPackage/openingCompatibility';
import { publishSourceEvidenceExcerptDelta } from '../worldPackage/progressiveDelta';
import {
  EncounterService,
  type BeginEncounterInput,
  type EncounterView,
} from './encounterService';

export interface SessionDeps {
  db: SqliteDatabase;
  turns: SqliteTurnStore;
  game: SqliteGameStore;
  worldStore: SqliteWorldStore;
  narratives: SqliteNarrativeStore;
  progressiveTurnContext?: ProgressiveTurnContextService;
  sourceStore?: SourceStore;
  projectStyle?: import('../ports/phase6').ProjectStylePortV1;
  /** Composition-root resource signal; does not alter rule authority. */
  onForegroundActivity?(busy: boolean): void;
  segmentContent?: {
    loadEffectiveCatalog(input: { campaignId: string; branchId: string; binding?: import('../../domain/content/segmentArtifact').SegmentContentBindingV1 }): Promise<{ entries: ContentEntry[]; sections: BookSection[] }>;
  };
  /** Durable physical-request ledger (infrastructure plan M2); optional so
   * pure-domain tests can omit it, but production always provides it. */
  llmLedger?: LlmRequestLedgerStore;
  /** Story Memory V2 dual-track maintenance (infrastructure plan M3). */
  storyMemory?: { store: SqliteStoryMemoryStore };
  /** Episodic recall index (infrastructure plan M4). */
  episodic?: { store: SqliteEpisodicStore };
  /** P7 turn-guidance persistence; absent in pure-domain tests. */
  guidance?: GuidanceStore;
  hashProvider: Sha256HexProvider;
  random: RandomSource;
}

/** V0.2 default training costs (plan §8.4; tunable game defaults, not facts). */
export const TRAINING_MINUTES = 240;
export const TRAINING_STAMINA_COST = 2;

export interface CampaignSummary {
  campaignId: string;
  branchId: string;
  title: string;
  worldId: string;
  packageRevision: number;
  goal: string;
  rulesetVersion: string;
  anchorWorldTimeOrder: number | null;
  state: GameStateSnapshot;
  cards: ActorCard[];
}

export interface PlayTurnResult {
  turnId: string;
  text: string;
  grade: string;
  dice?: string;
  resumed: boolean;
  stateVersion: number;
  practiceAwarded: boolean;
  /** P7: committed guidance for the decision point this turn created. */
  guidance?: TurnGuidanceV1;
}

export interface PlayTurnOptions {
  campaignId: string;
  branchId: string;
  intent: string;
  encounterId?: string;
  /** Explicit replay target (recovery flows); defaults to head+1. */
  turnIdOverride?: string;
  onProgress?: (phase: 'planning' | 'rolling' | 'narrating' | 'committing') => void;
  coordinationFence?: { campaignId: string; fenceToken: number };
  guidanceChoice?: { decisionPoint: GuidanceDecisionPointBinding; candidateRef: string };
}

/**
 * CampaignSession (plan §17.2): every call carries explicit campaignId /
 * branchId; nothing reads a hidden "current game". The demo-main path is
 * gone - world context comes from the locked world package, and roll specs
 * come from the character cards.
 */
export class CampaignSession {
  /** Encounter scheduling (G01) shares the session's stores and provider. */
  readonly encounters: EncounterService;
  /**
   * Provider as used by every internal LLM call: wrapped with the durable
   * ledger when deps supply a store, the raw provider otherwise.
   */
  private readonly provider: LlmProvider;
  /** Kernel-ready capabilities from the saved profile (built lazily). */
  private cachedTurnCapabilities: FrozenModelCapabilities | null = null;
  /** Last frozen contexts for debugging (plan §71); never persisted raw. */
  lastTurnContexts: { planner?: FrozenTurnContext; narrator?: FrozenTurnContext } = {};

  constructor(
    private readonly deps: SessionDeps,
    provider: LlmProvider,
    private readonly profile: ApiProfile,
  ) {
    this.encounters = new EncounterService(deps);
    this.provider = deps.llmLedger
      ? provider instanceof RateScheduledProvider ? provider.withLedger(deps.llmLedger, {
          modelProfileFingerprint: llmModelProfileFingerprint(profile),
        }) : new LedgeredProvider(provider, deps.llmLedger, {
        modelProfileFingerprint: llmModelProfileFingerprint(profile),
      })
      : provider;
  }

  async listCampaigns(): Promise<Array<{ campaignId: string; title: string; worldId: string; status: string; createdAt: string }>> {
    const rows = await this.deps.db.queryAll<SqliteRow>(
      'SELECT campaign_id, title, world_id, status, created_at FROM campaigns ORDER BY created_at DESC',
    );
    return rows.map(row => ({
      campaignId: String(row.campaign_id),
      title: String(row.title),
      worldId: String(row.world_id),
      status: String(row.status),
      createdAt: String(row.created_at),
    }));
  }

  async getPrimaryBranchId(campaignId: string): Promise<string> {
    const row = await this.deps.db.queryOne<{ branch_id: string }>(
      'SELECT branch_id FROM branches WHERE campaign_id = ? ORDER BY created_at ASC LIMIT 1',
      [campaignId],
    );
    if (!row) throw new Error(`Campaign has no branch: ${campaignId}.`);
    return row.branch_id;
  }

  async listBranches(campaignId: string): Promise<Array<{ branchId: string; parentBranchId: string | null; stateVersion: number; createdAt: string }>> {
    const rows = await this.deps.db.queryAll<SqliteRow>(
      'SELECT branch_id, parent_branch_id, state_version, created_at FROM branches WHERE campaign_id = ? ORDER BY created_at ASC',
      [campaignId],
    );
    return rows.map(row => ({
      branchId: String(row.branch_id),
      parentBranchId: row.parent_branch_id === null ? null : String(row.parent_branch_id),
      stateVersion: Number(row.state_version),
      createdAt: String(row.created_at),
    }));
  }

  async getSummary(campaignId: string, branchId: string): Promise<CampaignSummary> {
    const row = await this.deps.db.queryOne<SqliteRow>(
      'SELECT campaign_id, title, world_id, package_revision, ruleset_version, opening_json, anchor_json FROM campaigns WHERE campaign_id = ?',
      [campaignId],
    );
    if (!row) throw new Error(`Unknown campaign: ${campaignId}.`);
    await this.assertCampaignBranch(campaignId, branchId);
    const state = await this.deps.turns.getState(branchId);
    if (!state) throw new Error(`Branch has no state: ${branchId}.`);
    const allCards = await this.loadAllCards(branchId);
    const leaderId = (state.party ?? []).find(member => member.role === 'protagonist')?.actorId;
    const viewerGroupId = (state.party ?? []).find(member => member.actorId === leaderId)?.groupId ?? 'main';
    const partyIds = new Set((state.party ?? []).filter(member => (member.groupId ?? 'main') === viewerGroupId)
      .map(member => member.actorId));
    const cards = !state.party
      ? allCards // legacy records remain readable
      : allCards.filter(card => partyIds.has(card.actorId));
    if (state.party && state.encounters) {
      const activeEncounterIds = new Set(state.encounters.filter(item => item.state.status === 'active')
        .flatMap(item => Object.keys(item.state.actors)));
      for (const card of allCards) {
        if (partyIds.has(card.actorId) || !activeEncounterIds.has(card.actorId)) continue;
        // Encounter participants are present to the player, but hidden combat
        // parameters remain server-only. The live EncounterView owns combat UI.
        cards.push({
          actorId: card.actorId,
          name: card.name,
          kind: 'creature',
          controller: 'gm',
          attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 },
          skills: {}, abilities: [], preparedAbilities: [], resourceMax: {}, defense: 1,
          powerTier: 'ordinary', rulesetId: card.rulesetId, rulesetVersion: card.rulesetVersion,
          worldId: card.worldId, worldPackageRevision: card.worldPackageRevision, cardRevision: 0,
        });
      }
    }
    const opening = JSON.parse(String(row.opening_json ?? '{}')) as { goal?: string };
    return {
      campaignId: String(row.campaign_id),
      branchId,
      title: String(row.title),
      worldId: String(row.world_id),
      packageRevision: row.package_revision === null || row.package_revision === undefined
        ? 0
        : Number(row.package_revision),
      rulesetVersion: String(row.ruleset_version ?? ''),
      anchorWorldTimeOrder: (() => {
        try {
          const anchor = JSON.parse(String(row.anchor_json ?? '{}')) as { worldTimeOrder?: number };
          return Number.isFinite(anchor.worldTimeOrder) ? Number(anchor.worldTimeOrder) : null;
        } catch { return null; }
      })(),
      goal: opening.goal ?? '',
      state,
      cards,
    };
  }

  async listCards(branchId: string): Promise<ActorCard[]> {
    const state = await this.deps.turns.getState(branchId);
    if (!state?.party) return this.loadAllCards(branchId); // readable legacy projection
    const leaderId = state.party.find(member => member.role === 'protagonist')?.actorId;
    const viewerGroupId = state.party.find(member => member.actorId === leaderId)?.groupId ?? 'main';
    const partyIds = new Set(state.party.filter(member => (member.groupId ?? 'main') === viewerGroupId)
      .map(member => member.actorId));
    return (await this.loadAllCards(branchId)).filter(card => partyIds.has(card.actorId));
  }

  private async loadAllCards(branchId: string): Promise<ActorCard[]> {
    const rows = await this.deps.db.queryAll<{ card_json: string }>(
      'SELECT card_json FROM actor_cards WHERE branch_id = ? ORDER BY actor_id',
      [branchId],
    );
    return rows.map(row => JSON.parse(row.card_json) as ActorCard);
  }

  async getCard(branchId: string, actorId: string): Promise<ActorCard> {
    const state = await this.deps.turns.getState(branchId);
    const leaderId = state?.party?.find(member => member.role === 'protagonist')?.actorId;
    const viewerGroupId = state?.party?.find(member => member.actorId === leaderId)?.groupId ?? 'main';
    if (state?.party && !state.party.some(member => member.actorId === actorId
      && (member.groupId ?? 'main') === viewerGroupId)) {
      throw new Error(`角色 ${actorId} 不在当前队伍的玩家可见投影中。`);
    }
    const row = await this.deps.db.queryOne<{ card_json: string }>(
      'SELECT card_json FROM actor_cards WHERE branch_id = ? AND actor_id = ?',
      [branchId, actorId],
    );
    if (!row) throw new Error(`Actor card not found: ${branchId}/${actorId}.`);
    return JSON.parse(row.card_json) as ActorCard;
  }

  private async commitLifecycleAction(input: {
    campaignId: string;
    branchId: string;
    actorId: string;
    actionType: string;
    intent: string;
    settlement?: Partial<TurnSettlementPlan>;
    expectedStateVersion?: number;
    coordinationFence?: { campaignId: string; fenceToken: number };
    updateState?: (state: GameStateSnapshot) => void;
    events?: Array<{ eventType: string; payload: unknown }>;
  }): Promise<void> {
    await this.assertCampaignBranch(input.campaignId, input.branchId);
    const state = await this.deps.turns.getState(input.branchId);
    if (!state) throw new Error(`Unknown branch: ${input.branchId}.`);
    if (input.expectedStateVersion !== undefined && state.stateVersion !== input.expectedStateVersion) {
      throw new Error('战役状态已变化，请重新确认这批主动查书摘录。');
    }
    const turnId = `system-${input.actionType}-${String(state.stateVersion + 1).padStart(6, '0')}`;
    const emptyOutcome = { achieved: true, publicSummary: input.intent, effects: [] };
    const contract: ActionContract = {
      protocolVersion: '1.0',
      turnId,
      expectedStateVersion: state.stateVersion,
      actorId: input.actorId,
      actionType: input.actionType,
      evidenceIds: [],
      requiresRoll: false,
      intent: input.intent,
      timeCostMinutes: 0,
      resourcePreconditions: [],
      outcomes: {
        full_success: emptyOutcome,
        success: emptyOutcome,
        failure: emptyOutcome,
        severe_failure: emptyOutcome,
      },
    };
    const settlement: TurnSettlementPlan = {
      encounterId: `${input.actionType}:${input.branchId}:${state.stateVersion + 1}`,
      skillUpserts: [],
      rewardLedger: [],
      relationships: [],
      ...input.settlement,
    };
    const applySituations = await this.localSituationReducer(input.campaignId, input.branchId, state, turnId, input.actorId);
    await commitResolvedTurn({
      store: this.deps.turns,
      branchId: input.branchId,
      contract,
      contractHash: await this.deps.hashProvider.sha256Hex(JSON.stringify(contract)),
      contractOrigin: 'engine',
      coordinationFence: input.coordinationFence,
      outcomeGrade: 'success',
      settlement,
      updateNextState: input.updateState,
      applyAuthoritativeState: applySituations,
      events: input.events,
      committedAt: new Date().toISOString(),
    });
    if (input.actionType !== 'scene_actors') await this.ensureDecisionPointGuidance({
      campaignId: input.campaignId, branchId: input.branchId, sourceTurnId: turnId,
    });
  }

  private async campaignAnchor(campaignId: string): Promise<{ worldId: string; packageRevision: number; worldTimeOrder: number }> {
    const row = await this.deps.db.queryOne<SqliteRow>(
      'SELECT world_id, package_revision, anchor_json FROM campaigns WHERE campaign_id = ?', [campaignId],
    );
    if (!row) throw new Error(`Unknown campaign: ${campaignId}.`);
    const anchor = JSON.parse(String(row.anchor_json ?? '{}')) as { worldTimeOrder?: number };
    return {
      worldId: String(row.world_id),
      packageRevision: Number(row.package_revision ?? 0),
      worldTimeOrder: Number.isFinite(anchor.worldTimeOrder) ? Number(anchor.worldTimeOrder) : 0,
    };
  }

  private async assertCampaignBranch(campaignId: string, branchId: string): Promise<void> {
    const row = await this.deps.db.queryOne<{ campaign_id: string }>(
      'SELECT campaign_id FROM branches WHERE branch_id = ?', [branchId],
    );
    if (!row || row.campaign_id !== campaignId) {
      throw new Error(`Branch ${branchId} does not belong to campaign ${campaignId}.`);
    }
  }

  private async recruitmentReason(
    campaignId: string,
    state: GameStateSnapshot,
    cards: readonly ActorCard[],
    actorId: string,
  ): Promise<{ entry: ContentEntry; card: ActorCard; partyEntry: PartySnapshotEntry; relationship: RelationshipSnapshotEntry } | { reason: string }> {
    const actorCard = cards.find(card => card.actorId === actorId);
    const partyEntry = state.party?.find(member => member.actorId === actorId);
    if (!actorCard || actorCard.kind !== 'npc' || actorCard.controller !== 'gm' || partyEntry) {
      return { reason: '目标不是当前可招募的在场人物。' };
    }
    const anchor = await this.campaignAnchor(campaignId);
    const entries = await this.loadPackageEntries(anchor.worldId, anchor.packageRevision, { campaignId, state });
    const facts = await this.deps.worldStore.listFacts(anchor.worldId);
    const entry = entries.find(item => item.kind === 'actor_template' && item.entryId === actorCard.templateId);
    const leader = cards.find(card => card.controller === 'player');
    if (!entry || entry.visibility !== 'public' || !leader) return { reason: '目标不可公开招募。' };
    const discovered = (state.discoveries ?? []).some(item => item.actorId === leader.actorId && item.entryId === entry.entryId);
    if (!isPlayerRecruitmentCandidate(entry, facts, anchor.worldTimeOrder, discovered)) {
      return { reason: '目标缺少当前锚点有效的公开招募资格。' };
    }
    const actorState = state.actors[actorId];
    const leaderState = state.actors[leader.actorId];
    if (!leaderState || leaderState.lifeStatus === 'critical' || leaderState.lifeStatus === 'dead'
      || leaderState.conditions.includes('disabled')) {
      return { reason: '队伍领队目前失能或濒危，不能确认招募。' };
    }
    if (!actorState || !leaderState || actorState.locationId !== leaderState.locationId) {
      return { reason: '招募需要目标与队伍领队位于同一地点。' };
    }
    if (actorState.lifeStatus === 'critical' || actorState.lifeStatus === 'dead' || actorState.conditions.includes('disabled')) {
      return { reason: '目标目前失能，不能执行招募。' };
    }
    const definition = entry.definition as import('../../domain/content/types').ActorTemplateDefinition;
    const policy = definition.recruitment!;
    for (const questId of policy.requiredQuestIds ?? []) {
      if (state.questProgress?.find(progress => progress.questId === questId)?.status !== 'succeeded') {
        return { reason: `尚未完成招募前置任务 ${questId}。` };
      }
    }
    const relationship = state.relationships?.find(rel => rel.fromActorId === actorId && rel.toActorId === leader.actorId);
    if (!relationship || !meetsRecruitmentRelationship(entry, state.relationships ?? [], actorId, leader.actorId)) {
      return { reason: `关系尚不足：当前 ${relationship?.closeness ?? 0}，要求至少 ${policy.minimumCloseness ?? 0}。` };
    }
    const companionCount = (state.party ?? []).filter(member => member.role === 'companion').length;
    if (companionCount >= 2) return { reason: '队伍已达到最多两名同伴的上限。' };
    return { entry, card: actorCard, partyEntry: {
      actorId,
      controller: 'companion',
      role: 'companion',
      joinedAt: new Date().toISOString(),
      groupId: 'main',
    }, relationship };
  }

  /** Safe player-facing roster of publicly present NPCs and current eligibility basis. */
  async getRecruitmentOptions(campaignId: string, branchId: string): Promise<Array<{
    actorId: string; name: string; eligible: boolean; reason: string | null;
  }>> {
    await this.assertCampaignBranch(campaignId, branchId);
    const state = await this.deps.turns.getState(branchId);
    if (!state) throw new Error(`Unknown branch: ${branchId}.`);
    const cards = await this.loadAllCards(branchId);
    const anchor = await this.campaignAnchor(campaignId);
    const entries = await this.loadPackageEntries(anchor.worldId, anchor.packageRevision, { campaignId, state });
    const facts = await this.deps.worldStore.listFacts(anchor.worldId);
    const leader = cards.find(card => card.controller === 'player');
    if (!leader) return [];
    const leaderState = state.actors[leader.actorId];
    const templates = new Map(entries.filter(entry => entry.kind === 'actor_template').map(entry => [entry.entryId, entry]));
    const output = [];
    for (const card of cards.filter(item => item.kind === 'npc' && item.controller === 'gm')) {
      const template = templates.get(card.templateId ?? '');
      const actorState = state.actors[card.actorId];
      if (!template || template.visibility !== 'public' || !actorState || actorState.locationId !== leaderState?.locationId) continue;
      const result = await this.recruitmentReason(campaignId, state, cards, card.actorId);
      output.push({ actorId: card.actorId, name: card.name,
        eligible: !('reason' in result), reason: 'reason' in result ? result.reason : null });
    }
    return output;
  }

  async getRejoinOptions(campaignId: string, branchId: string): Promise<Array<{
    actorId: string; name: string; eligible: boolean; reason: string | null;
  }>> {
    await this.assertCampaignBranch(campaignId, branchId);
    const state = await this.deps.turns.getState(branchId);
    if (!state) throw new Error(`Unknown branch: ${branchId}.`);
    const cards = await this.loadAllCards(branchId);
    const anchor = await this.campaignAnchor(campaignId);
    const entries = await this.loadPackageEntries(anchor.worldId, anchor.packageRevision, { campaignId, state });
    const facts = await this.deps.worldStore.listFacts(anchor.worldId);
    const leader = cards.find(card => card.controller === 'player');
    const leaderState = leader ? state.actors[leader.actorId] : undefined;
    const companionCount = (state.party ?? []).filter(member => member.role === 'companion').length;
    const result = [];
    for (const card of cards.filter(item => item.kind === 'companion')) {
      const member = state.party?.find(item => item.actorId === card.actorId);
      if (member?.groupId === 'main') continue;
      const template = entries.find(item => item.kind === 'actor_template' && item.entryId === card.templateId);
      const actor = state.actors[card.actorId];
      if (!template || template.visibility !== 'public' || !actor || !leader || !leaderState) continue;
      const discovered = (state.discoveries ?? []).some(item => item.actorId === leader.actorId && item.entryId === template.entryId);
      const visible = isPlayerRecruitmentCandidate(template, facts, anchor.worldTimeOrder, discovered);
      const relationship = meetsRecruitmentRelationship(template, state.relationships ?? [], card.actorId, leader.actorId);
      const atRisk = actor.lifeStatus === 'critical' || actor.lifeStatus === 'dead' || actor.conditions.includes('disabled');
      const leaderAtRisk = leaderState.lifeStatus === 'critical' || leaderState.lifeStatus === 'dead'
        || leaderState.conditions.includes('disabled');
      const colocated = actor.locationId === leaderState.locationId;
      const definition = template.definition as import('../../domain/content/types').ActorTemplateDefinition;
      const questsOk = (definition.recruitment?.requiredQuestIds ?? []).every(questId =>
        state.questProgress?.find(progress => progress.questId === questId)?.status === 'succeeded');
      const reason = !visible ? '当前锚点的公开资格不再有效。'
        : atRisk ? '失能或濒危状态尚未解除。'
          : leaderAtRisk ? '队伍领队目前失能或濒危。'
          : !colocated ? '需要先在同一地点重逢。'
            : !relationship ? '关系条件不再满足。'
              : !questsOk ? '招募前置任务尚未完成。'
                : companionCount >= 2 && !member ? '主队已达到最多两名同伴的上限。' : null;
      result.push({ actorId: card.actorId, name: card.name, eligible: reason === null, reason });
    }
    return result;
  }

  /** Recruitment is an engine decision; template IDs alone cannot bypass presence, time, quest, relationship or roster checks. */
  async recruitCompanion(options: {
    campaignId: string; branchId: string; actorId: string; directive?: CompanionDirective;
  }): Promise<void> {
    await this.assertNoActiveEncounter(options.branchId);
    if (options.directive && !['follow', 'support', 'protect', 'conserve', 'retreat'].includes(options.directive)) {
      throw new Error(`未知的同伴指令：${String(options.directive)}。`);
    }
    const state = await this.deps.turns.getState(options.branchId);
    if (!state) throw new Error(`Unknown branch: ${options.branchId}.`);
    const cards = await this.loadAllCards(options.branchId);
    const qualification = await this.recruitmentReason(options.campaignId, state, cards, options.actorId);
    if ('reason' in qualification) throw new Error(`招募被拒绝：${qualification.reason}`);
    const card = { ...qualification.card, kind: 'companion' as const, controller: 'companion' as const,
      companionLeaderActorId: cards.find(item => item.controller === 'player')!.actorId,
      ...(options.directive ? { companionDirective: options.directive } : {}) };
    const entry = qualification.entry;
    const definition = entry.definition as import('../../domain/content/types').ActorTemplateDefinition;
    const world = await this.campaignAnchor(options.campaignId);
    const pkgEntries = await this.loadPackageEntries(world.worldId, world.packageRevision, { campaignId: options.campaignId, state });
    const worldFacts = await this.deps.worldStore.listFacts(world.worldId);
    const itemOwners = { ...state.itemOwners };
    const itemSources = { ...(state.itemSources ?? {}) };
    for (const itemId of definition.startingItems ?? []) {
      const item = pkgEntries.find(candidate => candidate.entryId === itemId);
      if (!item || item.kind !== 'item' || item.visibility !== 'public'
        || !isEntryVisibleAtAnchor(item, worldFacts, world.worldTimeOrder)) {
        throw new Error(`招募被拒绝：起始物品 ${itemId} 不存在或不可公开。`);
      }
      if (itemOwners[itemId] !== undefined) throw new Error(`招募被拒绝：起始物品 ${itemId} 已归属 ${itemOwners[itemId]}。`);
      itemOwners[itemId] = options.actorId;
      itemSources[itemId] = { kind: 'recruitment', sourceId: options.actorId, obtainedAtStateVersion: state.stateVersion + 1 };
    }
    await this.commitLifecycleAction({
      ...options,
      actorId: cards.find(item => item.controller === 'player')!.actorId,
      actionType: 'companion_recruited',
      intent: `${card.name} 加入队伍。`,
      settlement: {
        partyUpserts: [qualification.partyEntry],
        cardUpserts: [{ actorId: card.actorId, card }],
      },
      updateState: next => {
        next.party = [...(next.party ?? []), qualification.partyEntry];
        next.cards = [...(next.cards ?? []).filter(item => item.actorId !== card.actorId), { actorId: card.actorId, card }];
        next.itemOwners = itemOwners;
        next.itemSources = itemSources;
      },
      events: [{ eventType: 'companion_recruited', payload: {
        actorId: card.actorId, templateId: card.templateId, relationshipId: qualification.relationship.relId,
      } }],
    });
  }

  async setCompanionDirective(options: {
    campaignId: string; branchId: string; actorId: string; directive: CompanionDirective;
  }): Promise<void> {
    await this.assertNoActiveEncounter(options.branchId);
    if (!['follow', 'support', 'protect', 'conserve', 'retreat'].includes(options.directive)) {
      throw new Error(`未知的同伴指令：${String(options.directive)}。`);
    }
    const state = await this.deps.turns.getState(options.branchId);
    const card = await this.getCard(options.branchId, options.actorId);
    const member = state?.party?.find(item => item.actorId === options.actorId);
    if (!state || card.kind !== 'companion' || !member) throw new Error('只能为当前队伍中的同伴设置指令。');
    const nextCard = { ...card, companionDirective: options.directive };
    const nextMember = { ...member };
    await this.commitLifecycleAction({
      ...options,
      actorId: state.party?.find(item => item.role === 'protagonist')?.actorId ?? options.actorId,
      actionType: 'companion_directive_changed',
      intent: `${card.name} 的指令改为 ${options.directive}。`,
      settlement: { cardUpserts: [{ actorId: card.actorId, card: nextCard }], partyUpserts: [nextMember] },
      updateState: next => { next.cards = [...(next.cards ?? []).filter(item => item.actorId !== card.actorId), { actorId: card.actorId, card: nextCard }]; },
      events: [{ eventType: 'companion_directive_changed', payload: { actorId: card.actorId, directive: options.directive } }],
    });
  }

  async leaveCompanion(options: { campaignId: string; branchId: string; actorId: string }): Promise<void> {
    await this.assertNoActiveEncounter(options.branchId);
    const state = await this.deps.turns.getState(options.branchId);
    const member = state?.party?.find(item => item.actorId === options.actorId);
    const actor = state?.actors[options.actorId];
    if (!state || !member || member.role !== 'companion') throw new Error('目标不是当前队伍同伴。');
    if (actor?.lifeStatus === 'critical' || actor?.lifeStatus === 'dead' || actor?.conditions.includes('disabled')) {
      throw new Error('拒绝让失能或濒危同伴退出队伍；需要先处理援救/结局风险。');
    }
    const card = await this.getCard(options.branchId, options.actorId);
    if (card.kind !== 'companion') throw new Error('目标不是当前队伍同伴。');
    await this.commitLifecycleAction({
      ...options,
      actorId: (state.party ?? []).find(item => item.role === 'protagonist')?.actorId ?? options.actorId,
      actionType: 'companion_left', intent: `${card.name} 退出队伍。`,
      settlement: { partyDeletes: [card.actorId] },
      updateState: next => { next.party = (next.party ?? []).filter(item => item.actorId !== card.actorId); },
      events: [{ eventType: 'companion_left', payload: { actorId: card.actorId, reason: 'player_decision' } }],
    });
  }

  async splitCompanions(options: {
    campaignId: string; branchId: string; actorIds: string[]; groupId: string;
  }): Promise<void> {
    await this.assertNoActiveEncounter(options.branchId);
    if (!/^group-[A-Za-z0-9_-]{1,32}$/.test(options.groupId) || options.groupId === 'group-main') {
      throw new Error('分队 ID 必须是安全的 group- 前缀标识，且不能使用主队标识。');
    }
    if (options.actorIds.length === 0 || new Set(options.actorIds).size !== options.actorIds.length) {
      throw new Error('分队必须包含至少一名不重复同伴。');
    }
    const state = await this.deps.turns.getState(options.branchId);
    if (!state) throw new Error(`Unknown branch: ${options.branchId}.`);
    const cards = await this.loadAllCards(options.branchId);
    const members = options.actorIds.map(actorId => state.party?.find(item => item.actorId === actorId));
    if (members.some(member => !member || member.role !== 'companion' || (member.groupId ?? 'main') !== 'main')) {
      throw new Error('只能从主队中选择当前在队的同伴分队。');
    }
    for (const actorId of options.actorIds) {
      const actor = state.actors[actorId];
      if (!actor || actor.lifeStatus === 'critical' || actor.lifeStatus === 'dead' || actor.conditions.includes('disabled')) {
        throw new Error(`拒绝让失能/濒危同伴 ${actorId} 执行分队。`);
      }
    }
    const upserts = members.map(member => ({ ...member!, groupId: options.groupId }));
    const actorId = (state.party ?? []).find(item => item.role === 'protagonist')?.actorId ?? options.actorIds[0]!;
    await this.commitLifecycleAction({
      ...options, actorId, actionType: 'party_split', intent: `同伴分队：${options.actorIds.join(', ')}。`,
      settlement: { partyUpserts: upserts },
      updateState: next => { next.party = (next.party ?? []).map(member => upserts.find(item => item.actorId === member.actorId) ?? member); },
      events: [{ eventType: 'party_split', payload: { actorIds: options.actorIds, groupId: options.groupId } }],
    });
    void cards;
  }

  async rejoinCompanion(options: { campaignId: string; branchId: string; actorId: string }): Promise<void> {
    await this.assertNoActiveEncounter(options.branchId);
    const state = await this.deps.turns.getState(options.branchId);
    if (!state) throw new Error(`Unknown branch: ${options.branchId}.`);
    const cards = await this.loadAllCards(options.branchId);
    const card = cards.find(item => item.actorId === options.actorId);
    if (!card || card.kind !== 'companion') throw new Error('目标不是已建立关系的同伴。');
    const currentMember = state.party?.find(member => member.actorId === options.actorId);
    if (currentMember?.groupId === 'main') throw new Error('同伴已经在主队中。');
    const actor = state.actors[options.actorId];
    if (!actor || actor.lifeStatus === 'critical' || actor.lifeStatus === 'dead' || actor.conditions.includes('disabled')) {
      throw new Error('失能或濒危同伴不能自行重入队伍；需要先处理援救/结局风险。');
    }
    // Existing companion cards are not NPC candidates; re-entry uses the
    // original recruitment relationship and the same locked template policy.
    const anchor = await this.campaignAnchor(options.campaignId);
    const entries = await this.loadPackageEntries(anchor.worldId, anchor.packageRevision, { campaignId: options.campaignId, state });
    const facts = await this.deps.worldStore.listFacts(anchor.worldId);
    const template = entries.find(item => item.kind === 'actor_template' && item.entryId === card.templateId);
    const leader = cards.find(item => item.controller === 'player');
    const visible = template && template.visibility === 'public'
      && isPlayerRecruitmentCandidate(template, facts, anchor.worldTimeOrder,
        (state.discoveries ?? []).some(item => item.actorId === leader?.actorId && item.entryId === template.entryId));
    const leaderState = leader ? state.actors[leader.actorId] : undefined;
    const leaderAtRisk = !leaderState || leaderState.lifeStatus === 'critical' || leaderState.lifeStatus === 'dead'
      || leaderState.conditions.includes('disabled');
    const relationshipOk = template && leader && meetsRecruitmentRelationship(template, state.relationships ?? [], card.actorId, leader.actorId);
    const policy = template?.definition as import('../../domain/content/types').ActorTemplateDefinition | undefined;
    const questsOk = (policy?.recruitment?.requiredQuestIds ?? []).every(questId =>
      state.questProgress?.find(progress => progress.questId === questId)?.status === 'succeeded');
    if (!visible || !relationshipOk || !questsOk || !leader || !leaderState || leaderAtRisk
      || leaderState.locationId !== actor.locationId) {
      throw new Error('同伴重入被拒绝：公开招募资格或关系条件已不满足。');
    }
    if (!currentMember && (state.party ?? []).filter(member => member.role === 'companion').length >= 2) {
      throw new Error('主队已达到最多两名同伴的上限。');
    }
    const member: PartySnapshotEntry = {
      actorId: card.actorId, controller: 'companion', role: 'companion',
      joinedAt: new Date().toISOString(), groupId: 'main',
    };
    const nextCard = { ...card, controller: 'companion' as const, companionLeaderActorId: leader!.actorId };
    await this.commitLifecycleAction({
      ...options, actorId: leader!.actorId, actionType: 'companion_rejoined', intent: `${card.name} 重回主队。`,
      settlement: { partyUpserts: [member], cardUpserts: [{ actorId: card.actorId, card: nextCard }] },
      updateState: next => {
        next.party = [...(next.party ?? []).filter(item => item.actorId !== card.actorId), member];
        next.cards = [...(next.cards ?? []).filter(item => item.actorId !== card.actorId), { actorId: card.actorId, card: nextCard }];
      },
      events: [{ eventType: 'companion_rejoined', payload: { actorId: card.actorId } }],
    });
  }

  async shareKnowledge(options: {
    campaignId: string; branchId: string; sourceActorId: string; recipientActorId: string;
    entryId: string; channel: 'conversation' | 'signal';
  }): Promise<void> {
    await this.assertCampaignBranch(options.campaignId, options.branchId);
    await this.assertNoActiveEncounter(options.branchId);
    if (options.channel !== 'conversation' && options.channel !== 'signal') {
      throw new Error('通信方式必须明确选择 conversation 或 signal。');
    }
    const state = await this.deps.turns.getState(options.branchId);
    if (!state) throw new Error(`Unknown branch: ${options.branchId}.`);
    const partyIds = new Set((state.party ?? []).map(member => member.actorId));
    if (!partyIds.has(options.sourceActorId) || !partyIds.has(options.recipientActorId)) {
      throw new Error('知识传播只允许由当前战役中的队伍角色显式传递；NPC 与敌人的知识不会被直接改写。');
    }
    const source = state.actors[options.sourceActorId];
    const recipient = state.actors[options.recipientActorId];
    if (!source || !recipient) throw new Error('通信对象不在当前战役。');
    for (const [actorId, actor] of [[options.sourceActorId, source], [options.recipientActorId, recipient]] as const) {
      if (actor.lifeStatus === 'critical' || actor.lifeStatus === 'dead' || actor.conditions.includes('disabled')) {
        throw new Error(`角色 ${actorId} 失能，无法完成通信。`);
      }
    }
    let communicationPath = false;
    if (options.channel === 'conversation') {
      communicationPath = source.locationId === recipient.locationId;
      if (!communicationPath) throw new Error('交谈通信要求双方位于同一地点。');
    } else {
      const anchor = await this.campaignAnchor(options.campaignId);
      const facts = await this.deps.worldStore.listFacts(anchor.worldId);
      const scenes = (await this.loadPackageEntries(anchor.worldId, anchor.packageRevision, { campaignId: options.campaignId, state }))
        .filter(entry => entry.kind === 'scene' && entry.visibility === 'public'
          && isEntryVisibleAtAnchor(entry, facts, anchor.worldTimeOrder))
        .map(entry => entry.definition as SceneDefinition);
      if (source.locationId !== recipient.locationId) throw new Error('信号通信要求双方位于同一地点的可连通场景。');
      const scene = scenes.find(item => item.locationId === source.locationId);
      const sourceZone = source.zoneId;
      const recipientZone = recipient.zoneId;
      const zone = scene?.zones.find(item => item.zoneId === sourceZone);
      communicationPath = sourceZone === recipientZone || Boolean(zone?.exits.includes(recipientZone ?? ''));
      if (!communicationPath) throw new Error('信号通信要求同区或相邻区域，且场景定义中有明确出口。');
    }
    const anchor = await this.campaignAnchor(options.campaignId);
    const entries = await this.loadPackageEntries(anchor.worldId, anchor.packageRevision, { campaignId: options.campaignId, state });
    const facts = await this.deps.worldStore.listFacts(anchor.worldId);
    const targetEntry = entries.find(item => item.entryId === options.entryId);
    if (!targetEntry || targetEntry.visibility === 'gm' || !isEntryVisibleAtAnchor(targetEntry, facts, anchor.worldTimeOrder)) {
      throw new Error('不能传递不存在、GM 专属或时间锚点尚不可见的信息。');
    }
    if (!(state.discoveries ?? []).some(item => item.actorId === options.sourceActorId && item.entryId === options.entryId)) {
      throw new Error('信息来源角色尚未获知该条目，不能传递。');
    }
    if ((state.discoveries ?? []).some(item => item.actorId === options.recipientActorId && item.entryId === options.entryId)) {
      throw new Error('接收角色已经知道该条目。');
    }
    await this.commitLifecycleAction({
      ...options, actorId: options.sourceActorId, actionType: 'knowledge_shared', intent: `通过${options.channel}将 ${options.entryId} 传递给指定角色。`,
      updateState: next => {
        next.discoveries ??= [];
        next.discoveries.push({
          entryId: options.entryId, actorId: options.recipientActorId,
          knownAtStateVersion: next.stateVersion + 1,
          sourceTurnId: `system-knowledge_shared-${String(next.stateVersion + 1).padStart(6, '0')}`,
          knownVia: 'told',
        });
      },
      events: [{ eventType: 'knowledge_shared', payload: {
        entryId: options.entryId, sourceActorId: options.sourceActorId,
        recipientActorId: options.recipientActorId, channel: options.channel,
      } }],
    });
    void communicationPath;
  }

  /** Record exact, user-confirmed local book-search excerpts as protagonist knowledge. */
  async recordProgressiveSourceKnowledge(options: {
    campaignId: string;
    branchId: string;
    entryIds: readonly string[];
  }): Promise<void> {
    const ids = [...new Set(options.entryIds)];
    if (ids.length < 1 || ids.length > 3 || ids.length !== options.entryIds.length) {
      throw new Error('一次只能确认一至三条不同的主动查书摘录。');
    }
    await this.assertCampaignBranch(options.campaignId, options.branchId);
    await this.assertNoActiveEncounter(options.branchId);
    const summary = await this.getSummary(options.campaignId, options.branchId);
    const state = summary.state;
    const protagonist = state.party?.find(member => member.role === 'protagonist');
    const player = summary.cards.find(card => card.controller === 'player');
    if (!protagonist || !player || protagonist.actorId !== player.actorId) {
      throw new Error('当前战役没有可记录主动查书知识的玩家角色。');
    }
    const playerState = state.actors[player.actorId];
    if (!playerState || playerState.lifeStatus === 'critical' || playerState.lifeStatus === 'dead'
        || playerState.conditions.includes('disabled')) {
      throw new Error('角色当前无法接收新的已知资料。');
    }
    if ((state.discoveries ?? []).some(discovery => discovery.actorId === player.actorId
        && ids.includes(discovery.entryId))) {
      throw new Error('所选主动查书摘录已在当前分支记录为角色已知。');
    }
    const base = await this.deps.worldStore.getWorldPackage(summary.worldId, summary.packageRevision);
    if (!base || base.manifest.status !== 'published') throw new Error('战役锁定的已发布世界包无法读取。');
    let manifest = state.contentManifest;
    if (!manifest && await hasBranchContentManifestTable(this.deps.db)) {
      manifest = await ensureBaseBranchContentManifest({
        db: this.deps.db,
        branchId: options.branchId,
        worldId: summary.worldId,
        stateVersion: state.stateVersion,
        packageRevision: summary.packageRevision,
        packageContentHash: base.manifest.contentHash,
        createdAt: new Date().toISOString(),
      });
    }
    if (!manifest) throw new Error('当前存档不支持渐进内容清单，无法安全记录摘录。');
    const deltas = await loadBranchDeltaEntries({
      manifest,
      worldId: summary.worldId,
      branchId: options.branchId,
      stateVersion: state.stateVersion,
      baseRevision: summary.packageRevision,
      baseContentHash: base.manifest.contentHash,
      getDelta: deltaId => this.deps.worldStore.getProgressiveDeltaPackage(deltaId),
      sha256Hex: this.deps.hashProvider.sha256Hex,
    });
    const entries = await this.loadPackageEntries(summary.worldId, summary.packageRevision, { campaignId: options.campaignId, state });
    const byId = new Map(entries.map(entry => [entry.entryId, entry]));
    const source = this.deps.sourceStore
      ? await this.deps.sourceStore.findActiveByRawHash(base.manifest.sourceSha256)
      : null;
    if (!source || source.status !== 'active') throw new Error('主动查书原文来源当前不可用。');
    const chapters = await this.deps.sourceStore!.getChapters(source.sourceId);
    for (const entryId of ids) {
      const entry = byId.get(entryId);
      const text = (entry?.definition as { text?: unknown } | undefined)?.text;
      const provenance = entry?.provenance;
      const field = entry?.fieldProvenance?.['definition.text'];
      const reference = provenance?.sourceRanges?.length === 1 ? provenance.sourceRanges[0] : undefined;
      const fieldReference = field?.sourceRanges?.length === 1 ? field.sourceRanges[0] : undefined;
      if (!entry || entry.kind !== 'lore' || entry.visibility !== 'discoverable'
          || entry.revealPolicyId !== 'source-lookup-confirmation'
          || provenance?.kind !== 'explicit' || provenance.policyId !== 'user-requested-source-lookup'
          || provenance.sourceFactIds.length !== 0 || field?.policyId !== 'user-requested-source-lookup'
          || !reference || !fieldReference || typeof text !== 'string'
          || reference.chapterId !== fieldReference.chapterId
          || reference.startCodePoint !== fieldReference.startCodePoint
          || reference.endCodePoint !== fieldReference.endCodePoint
          || reference.contentSha256.toLowerCase() !== fieldReference.contentSha256.toLowerCase()) {
        throw new Error('所选条目不是经过验证的主动查书原文摘录。');
      }
      const chapter = chapters.find(item => item.chapterId === reference.chapterId);
      if (!chapter || reference.startCodePoint < chapter.startOffset
          || reference.endCodePoint > chapter.endOffset
          || Array.from(text).length !== reference.endCodePoint - reference.startCodePoint) {
        throw new Error('主动查书摘录的原文范围与章节不匹配。');
      }
      const exact = await this.deps.sourceStore!.readRange(source.sourceId,
        reference.startCodePoint, reference.endCodePoint);
      if (exact !== text || (await this.deps.hashProvider.sha256Hex(exact)).toLowerCase()
          !== reference.contentSha256.toLowerCase()) {
        throw new Error('主动查书摘录未通过原文完整性复核。');
      }
    }
    const nextVersion = state.stateVersion + 1;
    const knowledgeAnchor = await this.campaignAnchor(options.campaignId);
    const knowledgeFacts = await this.deps.worldStore.listFacts(summary.worldId);
    const knownIds = new Set((state.discoveries ?? []).filter(d=>d.actorId===player.actorId).map(d=>d.entryId));
    const newlyKnown = segmentKnowledgeFromConfirmedEvidence({ entries, facts: knowledgeFacts, worldTimeOrder: knowledgeAnchor.worldTimeOrder,
      knownEntryIds: knownIds, knownRanges: [...visibleEvidenceRanges(projectPlayerEntriesAtAnchor(entries,knowledgeFacts,knowledgeAnchor.worldTimeOrder,knownIds),knowledgeFacts,knowledgeAnchor.worldTimeOrder,knownIds),
        ...ids.flatMap(id=>byId.get(id)!.provenance.sourceRanges ?? [])] });
    await new SqliteInteractionOperationJournal(this.deps.db).guardTurn({ campaignId: options.campaignId, branchId: options.branchId,
      turnId: `system-source_knowledge_recorded-${String(nextVersion).padStart(6,'0')}`, expectedStateVersion: state.stateVersion }, async fence => {
    await this.commitLifecycleAction({
      campaignId: options.campaignId,
      branchId: options.branchId,
      actorId: player.actorId,
      actionType: 'source_knowledge_recorded',
      coordinationFence: fence,
      intent: `玩家确认 ${ids.length} 条主动查书摘录为角色已知资料。`,
      expectedStateVersion: state.stateVersion,
      updateState: next => {
        next.discoveries ??= [];
        for (const entryId of [...ids,...newlyKnown]) {
          next.discoveries.push({
            entryId,
            actorId: player.actorId,
            knownAtStateVersion: nextVersion,
            sourceTurnId: `system-source_knowledge_recorded-${String(nextVersion).padStart(6, '0')}`,
            knownVia: 'told',
          });
        }
      },
      events: [...ids,...newlyKnown].map(entryId => ({ eventType: 'knowledge_discovered', payload: {
        entryId,
        actorId: player.actorId,
        knownVia: 'told',
        source: newlyKnown.includes(entryId) ? 'confirmed_segment_evidence' : 'user_confirmed_source_lookup',
      } })),
    });
    });
  }

  async transferItem(options: {
    campaignId: string; branchId: string; itemId: string; fromActorId: string; toActorId: string;
  }): Promise<void> {
    await this.assertCampaignBranch(options.campaignId, options.branchId);
    await this.assertNoActiveEncounter(options.branchId);
    const state = await this.deps.turns.getState(options.branchId);
    if (!state) throw new Error(`Unknown branch: ${options.branchId}.`);
    if (options.fromActorId === options.toActorId) throw new Error('物品转移必须改变持有人。');
    if (state.itemOwners[options.itemId] !== options.fromActorId) {
      throw new Error(`物品转移被拒绝：${options.itemId} 当前归属 ${state.itemOwners[options.itemId] ?? '无人'}。`);
    }
    const members = new Map((state.party ?? []).map(member => [member.actorId, member]));
    const fromMember = members.get(options.fromActorId);
    const toMember = members.get(options.toActorId);
    const fromState = state.actors[options.fromActorId];
    const toState = state.actors[options.toActorId];
    const leader = state.party?.find(member => member.role === 'protagonist');
    const leaderGroup = leader?.groupId ?? 'main';
    if (!fromMember || !toMember || (fromMember.groupId ?? 'main') !== leaderGroup
      || (toMember.groupId ?? 'main') !== leaderGroup || !fromState || !toState
      || fromState.locationId !== toState.locationId) {
      throw new Error('物品转移要求双方都在主队、同一地点且通信/交接可达。');
    }
    for (const actor of [fromState, toState]) {
      if (actor.lifeStatus === 'critical' || actor.lifeStatus === 'dead' || actor.conditions.includes('disabled')) {
        throw new Error('物品转移要求双方清醒且未失能。');
      }
    }
    const anchor = await this.campaignAnchor(options.campaignId);
    const entries = await this.loadPackageEntries(anchor.worldId, anchor.packageRevision, { campaignId: options.campaignId, state });
    const item = entries.find(entry => entry.entryId === options.itemId);
    const facts = await this.deps.worldStore.listFacts(anchor.worldId);
    if (!item || item.kind !== 'item' || item.visibility !== 'public'
      || !isEntryVisibleAtAnchor(item, facts, anchor.worldTimeOrder)) {
      throw new Error('物品转移被拒绝：物品不存在、未公开或在开局时间尚不可用。');
    }
    const nextOwners = { ...state.itemOwners, [options.itemId]: options.toActorId };
    const nextSources = { ...(state.itemSources ?? {}), [options.itemId]: {
      kind: 'transfer' as const,
      sourceId: `system-item_transferred-${String(state.stateVersion + 1).padStart(6, '0')}`,
      obtainedAtStateVersion: state.stateVersion + 1,
    } };
    await this.commitLifecycleAction({
      ...options, actorId: leader?.actorId ?? options.fromActorId,
      actionType: 'item_transferred', intent: `${options.itemId} 从 ${options.fromActorId} 转给 ${options.toActorId}。`,
      updateState: next => { next.itemOwners = nextOwners; next.itemSources = nextSources; },
      events: [{ eventType: 'item_transferred', payload: {
        itemId: options.itemId, fromActorId: options.fromActorId, toActorId: options.toActorId,
        sourceId: nextSources[options.itemId]!.sourceId,
      } }],
    });
  }

  private async loadPackageEntries(
    worldId: string,
    packageRevision: number,
    branch?: { campaignId: string; state: GameStateSnapshot },
  ): Promise<ContentEntry[]> {
    const pkg = await this.deps.worldStore.getWorldPackage(worldId, packageRevision);
    if (!pkg) {
      throw new Error(
        `Locked world package is missing: ${worldId} r${packageRevision}. ` +
          'The campaign cannot continue without its dependency.',
      );
    }
    if (!branch) return pkg.entries;
    if (branch.state.segmentContentBinding) {
      if (!this.deps.segmentContent) throw new Error('Segment content owner is unavailable for the adopted branch.');
      return (await this.deps.segmentContent.loadEffectiveCatalog({
        campaignId: branch.campaignId, branchId: branch.state.branchId, binding: branch.state.segmentContentBinding,
      })).entries;
    }
    if (!branch.state.contentManifest) return pkg.entries;
    const deltas = await loadBranchDeltaEntries({
      manifest: branch.state.contentManifest, worldId, branchId: branch.state.branchId,
      stateVersion: branch.state.stateVersion, baseRevision: packageRevision,
      baseContentHash: pkg.manifest.contentHash,
      getDelta: deltaId => this.deps.worldStore.getProgressiveDeltaPackage(deltaId),
      sha256Hex: this.deps.hashProvider.sha256Hex,
    });
    return [...pkg.entries, ...deltas.flatMap(delta => delta.entries)];
  }

  private async localSituationReducer(campaignId: string, branchId: string, state: GameStateSnapshot, turnId: string, actingActorId: string): Promise<(next: GameStateSnapshot) => Array<{ eventType: string; payload: unknown }>> {
    const anchor = await this.campaignAnchor(campaignId);
    if (anchor.packageRevision < 1) return () => [];
    const entries = await this.loadPackageEntries(anchor.worldId, anchor.packageRevision, { campaignId, state });
    const facts = await this.deps.worldStore.listFacts(anchor.worldId);
    const order = Math.max(anchor.worldTimeOrder, state.causalWorldTimeOrder ?? 0);
    const definitions = entries.filter(entry => entry.kind === 'situation' && isEntryVisibleAtAnchor(entry, facts, order))
      .map(entry => ({ situationId: entry.entryId, definition: entry.definition as SituationDefinitionV1 }));
    const playerActorId = state.party?.find(member => member.role === 'protagonist')?.actorId ?? actingActorId;
    return next => {
      if (definitions.length === 0) return [];
      next.causalWorldTimeOrder = order;
      const runtime = applySituationRuntime({ definitions, nextState: next, sourceTurnId: turnId, playerActorId, methodOps: [] });
      next.situations = runtime.situations;
      for (const fate of runtime.actorFates) { if (next.actors[fate.actorId]) next.actors[fate.actorId]!.lifeStatus = fate.lifeStatus; }
      return runtime.events;
    };
  }

  private async assertNoActiveEncounter(branchId: string): Promise<void> {
    const table = await this.deps.db.queryOne<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'encounters'",
    );
    if (!table) return;
    const active = await this.deps.db.queryOne<{ encounter_id: string }>(
      "SELECT encounter_id FROM encounters WHERE branch_id = ? AND status = 'active' LIMIT 1",
      [branchId],
    );
    if (active) {
      throw new Error(`战斗 ${active.encounter_id} 仍在进行，请先通过战斗行动推进或撤退。`);
    }
  }

  private skillCatalog(entries: readonly ContentEntry[]): SkillCatalog {
    const catalog: SkillCatalog = {};
    for (const entry of entries) {
      if (entry.kind !== 'skill') continue;
      const definition = entry.definition as SkillCatalog[string];
      catalog[entry.entryId] = definition;
      // Planners speak the short name ("stealth"); package entry ids carry
      // the kind prefix ("skill-stealth"). Register both so a valid action
      // is never refused over naming, while unknown skills stay unknown.
      const bare = entry.entryId.replace(/^skill-/, '');
      if (bare !== entry.entryId && catalog[bare] === undefined) {
        catalog[bare] = definition;
      }
    }
    return catalog;
  }

  /**
   * Player-visible world context compiled from the locked package (plan
   * §13.1 step 3, G03): public lore/constraints, the party's CURRENT state
   * (resources/conditions/locations), and the recent committed story — all
   * permission-filtered (public projections only; GM secrets never enter).
   */
  private buildWorldContext(
    entries: readonly ContentEntry[],
    cards: readonly ActorCard[],
    state: GameStateSnapshot,
    goal: string,
    recentHistory?: ReadonlyArray<{ turnId: string; publicSummary: string; narrativeText: string | null }>,
    memories: ReadonlyArray<{ memoryId: string; summary: string; fromStateVersion: number; toStateVersion: number; invalidAt: number | null }> = [],
    queryText = '',
    viewerActorId = '',
    worldTimeOrder = 0,
    facts: Awaited<ReturnType<SqliteWorldStore['listFacts']>> = [],
  ): string {
    return this.collectWorldContextParts(
      entries, cards, state, goal, recentHistory, memories, queryText, viewerActorId, worldTimeOrder, facts,
    ).join('\n');
  }

  /** Kernel-ready capabilities resolved once from the saved profile. */
  private turnCapabilities(): FrozenModelCapabilities {
    if (!this.cachedTurnCapabilities) {
      const caps = this.profile.capabilities as Partial<ApiProfile['capabilities']> | undefined;
      this.cachedTurnCapabilities = resolveModelCapabilities({
        declared: {
          contextWindowTokens: caps?.contextWindow,
          maxOutputTokens: caps?.maxOutputTokens,
          supportsJsonMode: caps?.supportsJson,
          reportsUsage: caps?.reportsUsage,
          supportsPromptCache: caps?.supportsPromptCache,
        },
        // Reasoning is a product preference for every new request. Legacy
        // `off` values normalize to low at the profile boundary.
        reasoningMode: 'always_on',
      });
    }
    return this.cachedTurnCapabilities;
  }

  /**
   * Builds the frozen planner + narrator contexts (plan §57-§60). The
   * planner sees the full six-board view; the narrator gets a deliberately
   * smaller set (current scene, party, recent story, story memory) - never
   * the whole planner context.
   */
  private async buildTurnContextBundle(input: {
    branchId: string;
    stateVersion: number;
    parts: readonly string[];
    sourceEvidenceText: string;
    intent: string;
    goal: string;
    plannerCards: readonly ActorCard[];
    recentHistory: ReadonlyArray<{ turnId: string; publicSummary: string; narrativeText: string | null; stateVersion?: number }>;
    styleText?: string;
  }): Promise<{
    plannerText: string;
    plannerWireOutputTokens: number;
    narratorText: string;
    narratorWireOutputTokens: number;
    reasoningTier: ReturnType<typeof normalizeReasoningTier>;
    plannerReasoningReserveTokens: number | null;
    narratorReasoningReserveTokens: number | null;
    plannerReasoningRecovery?: { worldContext: string; wireOutputTokens: number; reserveTokens: number; context: FrozenTurnContext };
    narratorReasoningRecovery?: { worldContext: string; wireOutputTokens: number; reserveTokens: number; context: FrozenTurnContext };
    reasoningPolicyVersion: string;
    plannerContext: FrozenTurnContext;
    narratorContext: FrozenTurnContext;
  }> {
    const queryText = `${input.intent} ${input.goal}`.trim();
    const capabilities = this.turnCapabilities();
    const reasoningTier = normalizeReasoningTier(this.profile.reasoningTier ?? this.profile.reasoningEffort);
    const reasoningPolicy = {
      tier: reasoningTier,
      providerDialect: this.profile.reasoningDialect ?? reasoningDialectForModel(this.profile.model),
      model: this.profile.model,
    };

    const plannerCandidates = candidatesFromParts(input.parts, queryText);

    // Story Memory V2 read gate (plan §99): only a clean state with recent
    // enough coverage replaces the legacy summary track.
    let storyMemoryText = '';
    if (this.deps.storyMemory) {
      const memoryState = await this.deps.storyMemory.store.getState(input.branchId);
      if (memoryState && memoryState.metadata.status === 'clean'
        && memoryState.throughStateVersion >= input.stateVersion - 8) {
        storyMemoryText = compilePreviousMemoryView(memoryState);
      }
    }
    if (storyMemoryText) {
      const candidate = buildCandidate({
        id: 'story-memory-v2',
        board: 'storyMemory',
        heading: '长期故事状态',
        text: storyMemoryText,
        priority: 90,
        provenance: { sourceType: 'story_memory_v2', sourceId: input.branchId, stateVersion: input.stateVersion },
      }, queryText);
      if (candidate) plannerCandidates.push(candidate);
    }

    // Episodic recall (M4) rides the storyMemory board as 相关往事.
    if (this.deps.episodic) {
      const records = await this.deps.episodic.store.listRecords(input.branchId, input.stateVersion);
      if (records.length > 0) {
        const selection = recallEpisodes(records, {
          branchId: input.branchId,
          maxStateVersion: input.stateVersion,
          queryText,
          actors: input.plannerCards.map(card => ({ actorId: card.actorId, name: card.name })),
        }, { topK: 6 });
        const recallText = renderEpisodicRecall(selection);
        if (recallText) {
          const candidate = buildCandidate({
            id: 'episodic-recall',
            board: 'storyMemory',
            heading: '相关往事',
            text: `【相关往事】\n${recallText}`,
            priority: 82,
            provenance: { sourceType: 'episodic_recall', sourceId: input.branchId, stateVersion: input.stateVersion },
          }, queryText);
          if (candidate) plannerCandidates.push(candidate);
        }
      }
    }

    if (input.sourceEvidenceText.trim()) {
      const candidate = buildCandidate({
        id: 'source-evidence',
        board: 'sourceEvidence',
        heading: '原著证据',
        text: input.sourceEvidenceText.trim(),
        requirement: 'optional',
        clipMode: 'text',
        provenance: { sourceType: 'source_evidence', sourceId: input.branchId, stateVersion: input.stateVersion },
      }, queryText);
      if (candidate) plannerCandidates.push(candidate);
    }

    // Turn payload (turnId/stateVersion/intent JSON wrapper) always rides
    // along outside the boards; reserve its tokens as mandatory protocol.
    const mandatoryProtocolTokens = estimateTokens(
      JSON.stringify({ turnId: 'turn-0000', expectedStateVersion: 999999, playerIntent: input.intent }),
    );

    const plannerPlan = planTurnContext({
      requestKind: 'planner',
      branchId: input.branchId,
      stateVersion: input.stateVersion,
      candidates: plannerCandidates,
      capabilities,
      businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.planner,
      estimatedMandatoryInputTokens: mandatoryProtocolTokens + 200,
      reasoningPolicy,
    });

    // Narrator context (plan §59): scene + party + recent story + memory.
    const narratorCandidates: ContextCandidate[] = plannerCandidates
      .filter(candidate => candidate.board === 'currentState' || candidate.board === 'storyMemory')
      .map(candidate => ({
        ...candidate,
        id: `narrator-${candidate.id}`,
        // The narrator never needs the action-protocol line; currentState
        // stays mandatory, memory stays preferred.
        requirement: candidate.board === 'currentState' ? 'mandatory' as const : 'preferred' as const,
      }));
    const recentStory = input.recentHistory.slice(-3).map(turn =>
      `${turn.turnId}: ${(turn.narrativeText ?? turn.publicSummary ?? '').slice(0, 200)}`).join('\n');
    if (recentStory) {
      const candidate = buildCandidate({
        id: 'narrator-recent-story',
        board: 'recentHistory',
        heading: '最近故事',
        text: recentStory,
        clipMode: 'text',
        provenance: { sourceType: 'recent_history', sourceId: input.branchId },
      }, queryText);
      if (candidate) narratorCandidates.push(candidate);
    }
    const narratorPlan = planTurnContext({
      requestKind: 'narrator',
      branchId: input.branchId,
      stateVersion: input.stateVersion,
      candidates: narratorCandidates,
      capabilities,
      businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.narrator,
      estimatedMandatoryInputTokens: mandatoryProtocolTokens + 200 + estimateTokens(JSON.stringify({ styleExpression: input.styleText ?? '' })),
      reasoningPolicy,
    });

    // A reasoning_only response gets one application-level retry. Its frozen
    // policy keeps the same tier while reserving 50% more reasoning, which
    // lets the elastic planner shed optional context before dispatch.
    const recoveryPolicy = {
      ...reasoningPolicy,
      reserveMultiplier: REASONING_ONLY_RESERVE_MULTIPLIER,
    };
    const plannerRecoveryPlan = planTurnContext({
      requestKind: 'planner', branchId: input.branchId, stateVersion: input.stateVersion,
      candidates: plannerCandidates, capabilities,
      businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.planner,
      estimatedMandatoryInputTokens: mandatoryProtocolTokens + 200,
      reasoningPolicy: recoveryPolicy,
    });
    const narratorRecoveryPlan = planTurnContext({
      requestKind: 'narrator', branchId: input.branchId, stateVersion: input.stateVersion,
      candidates: narratorCandidates, capabilities,
      businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.narrator,
      estimatedMandatoryInputTokens: mandatoryProtocolTokens + 200 + estimateTokens(JSON.stringify({ styleExpression: input.styleText ?? '' })),
      reasoningPolicy: recoveryPolicy,
    });
    const plannerReasoningRecovery = !plannerRecoveryPlan.context.legacyFallback
      && typeof plannerRecoveryPlan.context.reasoning?.reserveTokens === 'number'
      && typeof plannerPlan.context.reasoning?.reserveTokens === 'number'
      && plannerRecoveryPlan.context.reasoning.reserveTokens > plannerPlan.context.reasoning.reserveTokens
      ? {
          worldContext: renderFrozenContext(plannerRecoveryPlan.context),
          wireOutputTokens: plannerRecoveryPlan.wireOutputTokens,
          reserveTokens: plannerRecoveryPlan.context.reasoning.reserveTokens,
          context: plannerRecoveryPlan.context,
        }
      : undefined;
    const narratorReasoningRecovery = !narratorRecoveryPlan.context.legacyFallback
      && typeof narratorRecoveryPlan.context.reasoning?.reserveTokens === 'number'
      && typeof narratorPlan.context.reasoning?.reserveTokens === 'number'
      && narratorRecoveryPlan.context.reasoning.reserveTokens > narratorPlan.context.reasoning.reserveTokens
      ? {
          worldContext: renderFrozenContext(narratorRecoveryPlan.context),
          wireOutputTokens: narratorRecoveryPlan.wireOutputTokens,
          reserveTokens: narratorRecoveryPlan.context.reasoning.reserveTokens,
          context: narratorRecoveryPlan.context,
        }
      : undefined;

    return {
      plannerText: renderFrozenContext(plannerPlan.context),
      plannerWireOutputTokens: plannerPlan.wireOutputTokens,
      narratorText: renderFrozenContext(narratorPlan.context),
      narratorWireOutputTokens: narratorPlan.wireOutputTokens,
      reasoningTier,
      plannerReasoningReserveTokens: plannerPlan.context.reasoning?.reserveTokens ?? null,
      narratorReasoningReserveTokens: narratorPlan.context.reasoning?.reserveTokens ?? null,
      plannerReasoningRecovery,
      narratorReasoningRecovery,
      reasoningPolicyVersion: plannerPlan.context.reasoning?.policyVersion
        ?? narratorPlan.context.reasoning?.policyVersion
        ?? REASONING_POLICY_VERSION,
      plannerContext: plannerPlan.context,
      narratorContext: narratorPlan.context,
    };
  }

  /**
   * Permission-filtered world context as labeled parts (M5): each 【】 part
   * becomes an elastic-allocator candidate; labels map onto the six boards.
   */
  private collectWorldContextParts(
    entries: readonly ContentEntry[],
    cards: readonly ActorCard[],
    state: GameStateSnapshot,
    goal: string,
    recentHistory?: ReadonlyArray<{ turnId: string; publicSummary: string; narrativeText: string | null }>,
    memories: ReadonlyArray<{ memoryId: string; summary: string; fromStateVersion: number; toStateVersion: number; invalidAt: number | null }> = [],
    queryText = '',
    viewerActorId = '',
    worldTimeOrder = 0,
    facts: Awaited<ReturnType<SqliteWorldStore['listFacts']>> = [],
  ): string[] {
    const parts: string[] = [];
    parts.push(`【当前时刻】${describeWorldClock(state.clockSeconds ?? state.clockMinutes * 60)}。世界时钟由本地规则推进，不得自行跳到另一时段。`);
    for (const entry of entries) {
      if (!isEntryVisibleAtAnchor(entry, facts, worldTimeOrder)) continue;
      if (entry.kind === 'lore' && entry.visibility === 'public') {
        const lore = entry.definition as LoreDefinition;
        parts.push(`【世界】${lore.name}: ${lore.text}`);
      }
      if (entry.kind === 'constraint' && entry.visibility === 'public') {
        const constraint = entry.definition as ConstraintDefinition;
        parts.push(`【世界规则】${constraint.name}: ${constraint.description}`);
      }
    }
    const currentLocation = state.actors[viewerActorId]?.locationId;
    const clueIds = new Set(entries.filter(entry => entry.kind === 'scene')
      .map(entry => entry.definition as SceneDefinition)
      .filter(scene => scene.locationId === currentLocation)
      .flatMap(scene => scene.clues));
    const discoverableClues = entries.filter(entry => clueIds.has(entry.entryId) && entry.visibility === 'discoverable');
    if (discoverableClues.length > 0) {
      parts.push(`【当前位置可调查的隐藏线索引用】${discoverableClues.map(entry => {
        const clue = entry.definition as { name?: string; title?: string };
        return `${entry.entryId}:${clue.name ?? clue.title ?? entry.entryId}`;
      }).join('、')}。仅在观察、交互或相关检定成功且引用对应 ID 时记录为角色已知。`);
    }
    const viewerGroupId = (state.party ?? []).find(member => member.actorId === viewerActorId)?.groupId ?? 'main';
    const visiblePartyIds = new Set((state.party ?? [])
      .filter(member => (member.groupId ?? 'main') === viewerGroupId)
      .map(member => member.actorId));
    const visibleNpcTemplateIds = new Set(entries.filter(entry => entry.kind === 'actor_template'
      && (entry.visibility === 'public' || (state.discoveries ?? []).some(d=>d.actorId===viewerActorId&&d.entryId===entry.entryId)) && isEntryVisibleAtAnchor(entry, facts, worldTimeOrder)
      && isTemplateValidAtAnchor(entry, worldTimeOrder))
      .map(entry => entry.entryId));
    for (const card of cards) {
      const actor = state.actors[card.actorId];
      if (!actor) continue;
      if (!visiblePartyIds.has(card.actorId)) {
        if (card.kind !== 'npc' || !visibleNpcTemplateIds.has(card.templateId ?? '') || actor.locationId !== currentLocation) continue;
        parts.push(`【可见人物】${card.actorId}(${card.name}) 位于当前位置。`);
        continue;
      }
      if (actor.lifeStatus === 'critical' || actor.lifeStatus === 'dead' || actor.conditions.includes('disabled')) continue;
      const resources = Object.entries(actor.resources)
        .map(([key, value]) => `${key}:${value}/${card.resourceMax[key] ?? '?'}`)
        .join(' ');
      const conditions = actor.conditions.length > 0 ? `，状态:${actor.conditions.join(',')}` : '';
      parts.push(`【角色】${card.actorId}(${card.name}) 位于 ${actor.locationId}，${resources}${conditions}`);
    }
    if (goal) parts.push(`【主目标】${goal}`);
    const retrievalCandidates = [
      ...(recentHistory ?? []).map(turn => ({
        id: turn.turnId,
        text: turn.narrativeText ?? turn.publicSummary,
        scope: 'branch' as const,
        branchId: state.branchId,
        validFrom: null,
        validTo: null,
        visibleToActors: null,
        status: 'event' as const,
        knownToActors: null,
      })),
      ...memories.filter(memory => memory.invalidAt === null).map(memory => ({
        id: memory.memoryId,
        text: memory.summary,
        scope: 'branch' as const,
        branchId: state.branchId,
        validFrom: memory.fromStateVersion,
        validTo: memory.toStateVersion,
        visibleToActors: null,
        status: 'summary' as const,
        knownToActors: null,
      })),
    ];
    const retrieved = retrieveContext(retrievalCandidates, {
      viewerActorId,
      branchId: state.branchId,
      worldTimeOrder: state.stateVersion,
      queryText: `${queryText} ${goal} ${currentLocation ?? ''}`,
      limit: 8,
    });
    if (retrieved.items.length > 0) {
      parts.push(`【相关长期记忆】\n${retrieved.items.map(item => `${item.id}: ${item.text.slice(0, 900)}`).join('\n')}`);
    }
    const discoveredIds = new Set((state.discoveries ?? [])
      .filter(item => item.actorId === viewerActorId).map(item => item.entryId));
    const learnedEntries = entries.filter(entry => discoveredIds.has(entry.entryId));
    for (const entry of learnedEntries) {
      const definition = entry.definition as { name?: string; title?: string; text?: string; description?: string };
      parts.push(`【角色已知线索】${entry.entryId} ${definition.name ?? definition.title ?? entry.entryId}: ${definition.text ?? definition.description ?? ''}`);
    }
    if (recentHistory && recentHistory.length > 0) {
      const recent = recentHistory.slice(-6).map(turn => {
        const story = (turn.narrativeText ?? turn.publicSummary ?? '').slice(0, 120);
        return `${turn.turnId}: ${story}`;
      });
      parts.push(`【最近的经历】\n${recent.join('\n')}`);
    }
    parts.push('使用队伍中存在的 actorId。只提出提案允许的动作（skill_check/ability/observe/talk/interact/move）；检定与数值由本地规则引擎编译。');
    return parts;
  }

  /**
   * P7 campaign-causal progress (plan §4.2): the highest canon worldTimeOrder
   * the branch has actually reached. Sources: the opening anchor, orders of
   * canon facts cited by this turn's evidence or newly discovered entries,
   * and reference events that fired on this branch. Turn numbers and
   * world-clock minutes never advance this order.
   */
  private advanceCausalOrder(
    nextState: GameStateSnapshot,
    contract: ActionContract,
    entries: readonly ContentEntry[],
    factsById: ReadonlyMap<string, { validFrom: string | null }>,
    situationDefinitions: ReadonlyArray<{ situationId: string; definition: SituationDefinitionV1 }>,
    runtimeEvents: ReadonlyArray<{ eventType: string; payload: unknown }> = [],
    /** Full catalog for discovery-driven lifts (discovery is the permission). */
    allEntries: readonly ContentEntry[] = entries,
    /** Opening anchor only; loading content never advances branch time. */
    catalogFloor = 0,
  ): void {
    let order = Math.max(nextState.causalWorldTimeOrder ?? 0, catalogFloor);
    const entryById = new Map(entries.map(entry => [entry.entryId, entry] as const));
    const catalogById = new Map(allEntries.map(entry => [entry.entryId, entry] as const));
    const liftFromFactIds = (factIds: Iterable<string>): void => {
      for (const factId of factIds) {
        const fact = factsById.get(factId);
        if (!fact || fact.validFrom === null) continue;
        const from = Number(fact.validFrom);
        if (Number.isFinite(from) && from > order) order = from;
      }
    };
    // Evidence citations lift only over player-visible entries (foresight
    // stays blocked); DISCOVERED clues lift over the full catalog because the
    // discovery pipeline itself gates what is reachable (scene clues).
    for (const entryId of contract.evidenceIds) {
      liftFromFactIds(entryById.get(entryId)?.provenance.sourceFactIds ?? []);
    }
    for (const discovery of nextState.discoveries ?? []) {
      if (discovery.sourceTurnId !== contract.turnId) continue;
      liftFromFactIds(catalogById.get(discovery.entryId)?.provenance.sourceFactIds ?? []);
    }
    for (const event of runtimeEvents) {
      if (event.eventType !== 'reference_event_due') continue;
      const eventKey = String((event.payload as { eventKey?: unknown } | null)?.eventKey ?? '');
      for (const situation of situationDefinitions) {
        const projection = (situation.definition.referenceEvents ?? [])
          .find(item => item.eventKey === eventKey);
        if (projection && projection.worldTimeOrder > order) order = projection.worldTimeOrder;
      }
    }
    nextState.causalWorldTimeOrder = order;
  }

  /** Latest committed guidance at or before the given version (UI refresh). */
  async getGuidanceAtVersion(branchId: string, stateVersion: number): Promise<TurnGuidanceV1 | null> {
    if (!this.deps.guidance) return null;
    try {
      return await this.deps.guidance.latestForVersion(branchId, stateVersion);
    } catch {
      // Guidance is derived content; a read failure degrades to none.
      return null;
    }
  }

  async assertGuidanceChoiceCurrent(branchId: string, choice: NonNullable<PlayTurnOptions['guidanceChoice']>, intent?: string): Promise<void> {
    const state = await this.deps.turns.getState(branchId);
    const stored = await this.deps.guidance?.get(branchId, choice.decisionPoint.decisionPointId);
    const step = stored?.steps.find(item => item.candidateRef === choice.candidateRef);
    const knownIds = (state?.discoveries ?? []).filter(d => d.actorId === choice.decisionPoint.playerActorId).map(d => d.entryId);
    const knowledgeHash = await this.deps.hashProvider.sha256Hex([...new Set(knownIds)].sort().join('\n'));
    if (!state || !stored || !step || step.availability !== 'available'
      || branchId !== choice.decisionPoint.branchId || state.stateVersion !== choice.decisionPoint.stateVersion
      || JSON.stringify(stored.decisionPoint) !== JSON.stringify(choice.decisionPoint)
      || guidanceContentBindingHash(state) !== choice.decisionPoint.contentBindingHash
      || knowledgeHash !== choice.decisionPoint.knowledgeHash
      || (intent !== undefined && step.firstStepIntent !== intent)) {
      throw new Error('局面已经变化，这条路径已失效；请刷新后选择最新路径。');
    }
  }

  /**
   * P7 §8.3: attach guidance to a decision point created by a LOCAL action
   * (rest/training/transfer) or an NPC auto-step boundary. Local guidance is
   * saved synchronously; an async LLM upgrade may replace it for the SAME
   * decision point (deduped by the guidance store, P1 priority, never
   * blocking the player, never re-settling the committed action).
   */
  async ensureDecisionPointGuidance(options: {
    campaignId: string;
    branchId: string;
    sourceTurnId: string;
    committedEvents?: ReadonlyArray<{ eventType: string; payload: unknown }>;
    /** Skip the async LLM upgrade (offline / budget-constrained callers). */
    localOnly?: boolean;
    /** Preserve an already selected legal candidate across NPC setup. */
    preferredCandidateRef?: string;
  }): Promise<TurnGuidanceV1 | null> {
    if (!this.deps.guidance) return null;
    try {
      const summary = await this.getSummary(options.campaignId, options.branchId);
      const playerCard = summary.cards.find(card => card.controller === 'player');
      if (!playerCard || summary.packageRevision < 1) return null;
      const basePackage = await this.deps.worldStore.getWorldPackage(summary.worldId, summary.packageRevision);
      if (!basePackage) return null;
      const manifest = summary.state.contentManifest;
      const deltas = manifest
        ? await loadBranchDeltaEntries({
          manifest, worldId: summary.worldId, branchId: options.branchId,
          stateVersion: summary.state.stateVersion, baseRevision: summary.packageRevision,
          baseContentHash: basePackage.manifest.contentHash,
          getDelta: deltaId => this.deps.worldStore.getProgressiveDeltaPackage(deltaId),
          sha256Hex: this.deps.hashProvider.sha256Hex,
        })
        : [];
      const allEntries = this.deps.segmentContent && summary.state.segmentContentBinding
        ? (await this.deps.segmentContent.loadEffectiveCatalog({
          campaignId: options.campaignId, branchId: options.branchId, binding: summary.state.segmentContentBinding,
        })).entries
        : [...basePackage.entries, ...deltas.flatMap(delta => delta.entries)];
      const situationDefinitions = allEntries
        .filter(entry => entry.kind === 'situation')
        .map(entry => ({ situationId: entry.entryId, definition: entry.definition as SituationDefinitionV1 }));

      const knownEntryIds = new Set((summary.state.discoveries ?? [])
        .filter(item => item.actorId === playerCard.actorId).map(item => item.entryId));
      const allCards = await this.loadAllCards(options.branchId);
      const anchorRow = await this.deps.db.queryOne<{ anchor_json: string }>('SELECT anchor_json FROM campaigns WHERE campaign_id = ?', [options.campaignId]);
      const anchorOrder = anchorRow ? Number((JSON.parse(anchorRow.anchor_json) as { worldTimeOrder?: number }).worldTimeOrder ?? 0) : 0;
      const facts = await this.deps.worldStore.listFacts(summary.worldId);
      const publicEntries = projectPlayerEntriesAtAnchor(allEntries, facts, Math.max(anchorOrder, summary.state.causalWorldTimeOrder ?? 0), knownEntryIds);
      const currentDefinitions = situationDefinitions.filter(situation => {
        const entry = allEntries.find(item => item.entryId === situation.situationId)!;
        return isEntryVisibleAtAnchor(entry, facts, Math.max(anchorOrder, summary.state.causalWorldTimeOrder ?? 0));
      });
      const sourceTurns = await this.deps.turns.listCommittedTurns(options.branchId);
      const sourceTurnId = sourceTurns.find(turn => turn.stateVersion === summary.state.stateVersion)?.turnId ?? options.sourceTurnId;
      const committedRows = await this.deps.db.queryAll<{ event_type: string; payload_json: string }>(
        'SELECT event_type, payload_json FROM branch_events WHERE branch_id = ? AND turn_id = ? ORDER BY event_seq', [options.branchId, sourceTurnId]);
      const committedEvents = [...committedRows.map(row => ({ eventType: row.event_type, payload: JSON.parse(row.payload_json) as unknown })), ...(options.committedEvents ?? [])];
      const activeEncounter = await this.getActiveEncounter(options.campaignId, options.branchId);
      let combatCandidates: AllowedCandidateV1[] | undefined;
      if (activeEncounter?.status === 'active') {
        if (!activeEncounter.currentActorIsPlayer) return null;
        combatCandidates = [];
        for (const target of activeEncounter.actors.filter(actor => actor.side === 'hostile' && actor.hp > 0)) {
          const available = await this.getPlayerAttackAvailability({ campaignId: options.campaignId, branchId: options.branchId, encounterId: activeEncounter.encounterId, targetId: target.actorId });
          combatCandidates.push({ ref: `action:combat_attack:${target.actorId}`, actionId: 'combat_attack',
            title: `攻击${target.name}`.slice(0, 24), goal: '尝试压制当前对手', firstStepIntent: `攻击${target.name}`,
            actionKind: 'interact', tradeoffs: '进行战斗检定，消耗当前行动；结果由规则结算', preparation: '确认攻击条件',
            availability: available.allowed ? 'available' : 'needs_preparation', blockers: available.allowed ? [] : [available.explanation ?? '攻击条件尚未满足'] });
        }
        combatCandidates.push({ ref: 'action:combat_guard', actionId: 'combat_guard', title: '保持戒备', goal: '观察战局，保留判断空间',
          firstStepIntent: '保持戒备', actionKind: 'interact', tradeoffs: '本次主行动用于戒备，冲突继续推进', preparation: '无', availability: 'available', blockers: [] });
        if (activeEncounter.exitIds.length > 0) combatCandidates.push({ ref: 'action:combat_retreat', actionId: 'combat_retreat', title: '尝试撤退', goal: '争取脱离冲突',
          firstStepIntent: '撤退', actionKind: 'interact', tradeoffs: '撤退需要规则检定，可能失败', preparation: '存在可用出口', availability: 'available', blockers: [] });
      }
      const visibleActorNames = new Map(allCards
        .filter(card => card.actorId !== playerCard.actorId
          && summary.state.actors[card.actorId]?.locationId === summary.state.actors[playerCard.actorId]?.locationId
          && (card.controller === 'companion' || publicEntries.some(entry => entry.entryId === card.templateId)))
        .map(card => [card.actorId, card.name] as const));
      const input = {
        provider: this.provider,
        guidanceStore: this.deps.guidance,
        sha256Hex: this.deps.hashProvider.sha256Hex,
        campaignId: options.campaignId,
        branchId: options.branchId,
        playerCard,
        cards: allCards.filter(card => card.actorId === playerCard.actorId || visibleActorNames.has(card.actorId)),
        state: summary.state,
        sourceTurnId,
        committedEvents,
        situationDefinitions: combatCandidates ? [] : currentDefinitions,
        allowedCandidates: combatCandidates,
        preferredCandidateRef: options.preferredCandidateRef,
        entries: publicEntries,
        blockedEntries: allEntries.filter(entry => !publicEntries.some(publicEntry => publicEntry.entryId === entry.entryId)),
        knownEntryIds,
        visibleActorNames,
        ...(options.localOnly ? { localOnly: true } : {}),
        wireOutputTokens: 1600,
        reasoningTier: normalizeReasoningTier(this.profile.reasoningTier ?? this.profile.reasoningEffort),
        reasoningReserveTokens: this.profile.reasoningReserveTokens ?? null,
        reasoningPolicyVersion: REASONING_POLICY_VERSION,
        capabilities: this.turnCapabilities(),
        reasoningPolicy: {
          tier: normalizeReasoningTier(this.profile.reasoningTier ?? this.profile.reasoningEffort),
          providerDialect: this.profile.reasoningDialect ?? reasoningDialectForModel(this.profile.model),
          model: this.profile.model,
        },
        knowledgeHash: await this.deps.hashProvider.sha256Hex([...knownEntryIds].sort().join('\n')),
        getCurrentState: () => this.deps.turns.getState(options.branchId),
      };
      const local = buildLocalAncillaryGuidance(input);
      const existing = await this.deps.guidance.get(options.branchId, decisionPointIdFor(options.branchId, summary.state.stateVersion));
      if (existing && JSON.stringify(existing.decisionPoint) === JSON.stringify(local.decisionPoint)) {
        if (!options.localOnly && !existing.upgradeStatus && !existing.steps.some(step => step.source === 'llm')) {
          void upgradeAncillaryGuidance(input).catch(() => undefined);
        }
        return existing;
      }
      await this.deps.guidance.save(local);
      if (options.localOnly) return local;
      void upgradeAncillaryGuidance(input).catch(() => undefined);
      return local;
    } catch {
      // Guidance is derived; its failure must never fail a committed action.
      return null;
    }
  }

  private applyDiscoveryAndQuestProgress(
    nextState: GameStateSnapshot,
    contract: ActionContract,
    grade: RollGrade,
    entries: readonly ContentEntry[],
    cards: readonly ActorCard[],
    sourceLocationId: string,
  ): Array<{ eventType: string; payload: unknown }> {
    const events: Array<{ eventType: string; payload: unknown }> = [];
    const actingState = nextState.actors[contract.actorId];
    if (actingState && actingState.locationId !== sourceLocationId) {
      const destinationScene = entries.find(entry => entry.kind === 'scene' &&
        (entry.definition as SceneDefinition).locationId === actingState.locationId);
      const firstZone = destinationScene
        ? (destinationScene.definition as SceneDefinition).zones[0]?.zoneId
        : undefined;
      if (firstZone) actingState.zoneId = firstZone;
      else delete actingState.zoneId;
    }
    if (contract.actionType === 'ability' && contract.abilityId) {
      const definition = entries.find(entry => entry.entryId === contract.abilityId || entry.entryId === `ability-${contract.abilityId}`);
      const cooldownRounds = definition?.kind === 'ability'
        ? Number((definition.definition as { cooldownRounds?: number }).cooldownRounds ?? 0)
        : 0;
      const actor = nextState.actors[contract.actorId];
      if (cooldownRounds > 0) {
        if (!actor) throw new Error(`Cooldown actor missing: ${contract.actorId}.`);
        actor.abilityCooldowns ??= {};
        actor.abilityCooldowns[contract.abilityId] = nextState.stateVersion + 1 + cooldownRounds;
      }
    }

    const relationship = this.socialRelationshipDelta(nextState, contract, grade, entries, cards);
    if (relationship) {
      nextState.relationships = [...(nextState.relationships ?? []).filter(item =>
        !(item.fromActorId === relationship.fromActorId && item.toActorId === relationship.toActorId)), relationship];
      events.push({ eventType: 'relationship_changed', payload: {
        relId: relationship.relId, fromActorId: relationship.fromActorId,
        toActorId: relationship.toActorId, closeness: relationship.closeness,
        sourceTurnId: contract.turnId,
      } });
    }

    for (const effect of contract.outcomes[grade]?.effects ?? []) {
      if (effect.op !== 'transferItem') continue;
      const fromMember = nextState.party?.find(member => member.actorId === effect.fromActorId);
      const toMember = nextState.party?.find(member => member.actorId === effect.toActorId);
      const fromState = nextState.actors[effect.fromActorId];
      const toState = nextState.actors[effect.toActorId];
      if (!fromMember || !toMember || (fromMember.groupId ?? 'main') !== (toMember.groupId ?? 'main')
        || !fromState || !toState || fromState.locationId !== toState.locationId
        || fromState.lifeStatus === 'critical' || fromState.lifeStatus === 'dead'
        || toState.lifeStatus === 'critical' || toState.lifeStatus === 'dead'
        || nextState.itemOwners[effect.itemId] !== effect.toActorId) {
        throw new Error('物品转移被拒绝：双方必须同组、同地且清醒，物品归属必须匹配。');
      }
      nextState.itemSources ??= {};
      nextState.itemSources[effect.itemId] = {
        kind: 'transfer', sourceId: contract.turnId, obtainedAtStateVersion: nextState.stateVersion + 1,
      };
    }

    if (grade !== 'success' && grade !== 'full_success') return events;
    if (!['observe', 'interact', 'skill_check'].includes(contract.actionType)) return events;

    const entryById = new Map(entries.map(entry => [entry.entryId, entry]));
    const scenes = entries.filter(entry => entry.kind === 'scene')
      .map(entry => entry.definition as SceneDefinition)
      .filter(scene => scene.locationId === sourceLocationId);
    const candidateIds = new Set(scenes.flatMap(scene => scene.clues));
    const discovered = contract.evidenceIds
      .filter(entryId => candidateIds.has(entryId))
      .map(entryId => entryById.get(entryId))
      .filter((entry): entry is ContentEntry => entry?.visibility === 'discoverable');
    if (discovered.length === 0) return events;

    nextState.discoveries ??= [];
    nextState.questProgress ??= [];
    nextState.questRewards ??= [];
    const eventVersion = nextState.stateVersion + 1;
    for (const clue of discovered) {
      if (nextState.discoveries.some(record => record.actorId === contract.actorId && record.entryId === clue.entryId)) continue;
      nextState.discoveries.push({
        entryId: clue.entryId,
        actorId: contract.actorId,
        knownAtStateVersion: eventVersion,
        sourceTurnId: contract.turnId,
        knownVia: 'witnessed',
      });
      const clueDefinition = clue.definition as { name?: string; title?: string };
      const clueLabel = `${clue.entryId} ${clueDefinition.name ?? clueDefinition.title ?? clue.entryId}`;
      events.push({ eventType: 'knowledge_discovered', payload: {
        entryId: clue.entryId,
        actorId: contract.actorId,
        sourceTurnId: contract.turnId,
        knownVia: 'witnessed',
      } });

      for (const questEntry of entries.filter(entry => entry.kind === 'quest')) {
        const quest = questEntry.definition as QuestDefinition;
        if (quest.trigger.eventType !== 'knowledge_discovered') continue;
        const pattern = quest.trigger.summaryPattern?.trim().toLocaleLowerCase();
        if (pattern && !clueLabel.toLocaleLowerCase().includes(pattern)) continue;
        let progress = nextState.questProgress.find(item => item.questId === questEntry.entryId);
        if (!progress) {
          progress = {
            questId: questEntry.entryId,
            status: 'available',
            counters: {},
            processedEventIds: [],
            updatedStateVersion: nextState.stateVersion,
            completedStateVersion: null,
          };
          nextState.questProgress.push(progress);
        }
        if (progress.status === 'succeeded' || progress.status === 'failed' || progress.status === 'abandoned') continue;
        const justActivated = progress.status === 'available';
        if (justActivated) {
          progress.status = 'active';
          events.push({ eventType: 'quest_activated', payload: { questId: questEntry.entryId, sourceTurnId: contract.turnId } });
        }
        const processed = progress.processedEventIds ??= [];
        if (processed.includes(clue.entryId)) continue;
        processed.push(clue.entryId);
        for (const objective of quest.objectives) {
          if (objective.counter !== 'knowledge_discovered' && objective.counter !== clue.entryId && objective.counter !== `discover:${clue.entryId}`) continue;
          progress.counters[objective.counter] = (progress.counters[objective.counter] ?? 0) + 1;
        }
        progress.updatedStateVersion = eventVersion;
        events.push({ eventType: 'quest_progressed', payload: {
          questId: questEntry.entryId, entryId: clue.entryId, counters: { ...progress.counters }, sourceTurnId: contract.turnId,
        } });
        if (quest.objectives.length === 0 || !quest.objectives.every(objective =>
          (progress!.counters[objective.counter] ?? 0) >= objective.target)) continue;

        progress.status = 'succeeded';
        progress.completedStateVersion = eventVersion;
        events.push({ eventType: 'quest_succeeded', payload: { questId: questEntry.entryId, sourceTurnId: contract.turnId } });
        const protagonist = nextState.actors[contract.actorId];
        if (!protagonist) throw new Error(`Quest reward actor missing: ${contract.actorId}.`);
        for (const itemId of quest.rewards.items ?? []) {
          const rewardId = `item:${itemId}`;
          if (nextState.questRewards.some(reward => reward.questId === questEntry.entryId && reward.rewardId === rewardId)) continue;
          const itemEntry = entryById.get(itemId);
          if (!itemEntry || itemEntry.kind !== 'item') {
            throw new Error(`Quest ${questEntry.entryId} has an invalid item reward ${itemId}.`);
          }
          const existingOwner = nextState.itemOwners[itemId];
          const granted = existingOwner === undefined;
          if (granted) nextState.itemOwners[itemId] = contract.actorId;
          if (granted) {
            nextState.itemSources ??= {};
            nextState.itemSources[itemId] = {
              kind: 'quest_reward', sourceId: questEntry.entryId, obtainedAtStateVersion: eventVersion,
            };
          }
          nextState.questRewards.push({
            questId: questEntry.entryId,
            rewardId,
            actorId: contract.actorId,
            grantedStateVersion: eventVersion,
          });
          events.push({ eventType: 'quest_reward_granted', payload: {
            questId: questEntry.entryId, rewardId, itemId, actorId: contract.actorId, granted, sourceTurnId: contract.turnId,
          } });
        }
      }
    }
    return events;
  }

  private socialRelationshipDelta(
    state: GameStateSnapshot,
    contract: ActionContract,
    grade: RollGrade,
    entries: readonly ContentEntry[],
    cards: readonly ActorCard[],
  ): RelationshipSnapshotEntry | null {
    if (contract.actionType !== 'skill_check' || !contract.targetId || !contract.skillId) return null;
    const skillId = contract.skillId.replace(/^skill-/, '');
    const skill = entries.find(entry => entry.kind === 'skill'
      && (entry.entryId === contract.skillId || entry.entryId.replace(/^skill-/, '') === skillId));
    if (!skill || (skill.definition as SkillDefinition).usage !== 'social') return null;
    const target = cards.find(card => card.actorId === contract.targetId);
    const sourceState = state.actors[contract.actorId];
    const targetState = state.actors[contract.targetId];
    if (!target || (target.kind !== 'npc' && target.kind !== 'companion') || !sourceState || !targetState
      || sourceState.locationId !== targetState.locationId) return null;
    const relation = state.relationships?.find(item => item.fromActorId === target.actorId && item.toActorId === contract.actorId);
    if (!relation) return null;
    const delta = grade === 'full_success' ? 2 : grade === 'success' ? 1 : grade === 'severe_failure' ? -1 : 0;
    if (delta === 0) return null;
    return {
      ...relation,
      closeness: Math.max(0, Math.min(100, relation.closeness + delta)),
      updatedTurnId: contract.turnId,
    };
  }

  /**
   * Plays one player intent through the V2 turn loop (plan §13.1/§13.2): the
   * Planner returns a RESTRICTED PROPOSAL; the local compiler freezes the
   * authoritative engine contract (difficulty, costs, effects, caps); dice
   * are card-driven; the Narrator only words the frozen outcome.
   *
   * `encounterId` dedups practice per independent challenge. When omitted,
   * free-exploration challenges derive a STABLE id per open skill challenge:
   * an unachieved pursuit keeps its id across retries (re-typed input cannot
   * farm points); a new challenge opens only after the previous one was
   * achieved (see domain/progression/growth.ts).
   */
  async playTurn(options: PlayTurnOptions): Promise<PlayTurnResult> {
    this.deps.onForegroundActivity?.(true);
    this.deps.progressiveTurnContext?.setForegroundBusy(true);
    try {
      const available = await this.deps.db.queryOne("SELECT name FROM sqlite_master WHERE type='table' AND name='interaction_operations'");
      if (!available) return await this.playTurnInForeground(options);
      if (options.guidanceChoice) await this.assertGuidanceChoiceCurrent(options.branchId, options.guidanceChoice, options.intent);
      const materialized = !options.turnIdOverride && await this.prepareAdoptedSceneActors(options);
      if (materialized && options.guidanceChoice) {
        // Loading current-scene NPCs is part of this foreground action. Keep
        // the selected intent only if the SAME candidate is still legal.
        const refreshed = await this.ensureDecisionPointGuidance({ ...options, sourceTurnId: 'scene-actors', localOnly: true,
          preferredCandidateRef: options.guidanceChoice.candidateRef });
        const step = refreshed?.steps.find(s => s.candidateRef === options.guidanceChoice!.candidateRef);
        if (!refreshed || !step || step.availability !== 'available' || step.firstStepIntent !== options.intent) {
          throw new Error('局面已经变化，这条路径已失效；请刷新后选择最新路径。');
        }
        options = { ...options, guidanceChoice: { decisionPoint: refreshed.decisionPoint, candidateRef: step.candidateRef } };
      }
      const state = await this.deps.turns.getState(options.branchId);
      if (!state) throw new Error('Unknown branch.');
      const turnId = options.turnIdOverride ?? `turn-${String(state.stateVersion+1).padStart(4,'0')}`;
      return await new SqliteInteractionOperationJournal(this.deps.db).guardTurn({ ...options, turnId,
        expectedStateVersion: state.stateVersion }, fence => this.playTurnInForeground({ ...options, coordinationFence: fence }));
    } finally {
      this.deps.progressiveTurnContext?.setForegroundBusy(false);
      this.deps.onForegroundActivity?.(false);
    }
  }

  /** Materialize adopted scene templates only at a new player-action boundary.
   * Background publication/adoption never writes cards or actor state. */
  private async prepareAdoptedSceneActors(options: PlayTurnOptions): Promise<boolean> {
    if (!this.deps.segmentContent) return false;
    const pending = await this.deps.db.queryOne(`SELECT turn_id FROM turns WHERE branch_id=? AND status<>'Committed' LIMIT 1`, [options.branchId]);
    const operation = await this.deps.db.queryOne(`SELECT operation_id FROM interaction_operations WHERE branch_id=? AND status IN ('running','paused_system') LIMIT 1`, [options.branchId]);
    if (pending || operation) return false;
    const summary = await this.getSummary(options.campaignId, options.branchId);
    if (!summary.state.segmentContentBinding) return false;
    const player = summary.cards.find(card => card.controller === 'player');
    const playerState = player && summary.state.actors[player.actorId];
    if (!player || !playerState?.locationId || playerState.lifeStatus === 'dead' || playerState.lifeStatus === 'critical') return false;
    await this.assertNoActiveEncounter(options.branchId);
    const { worldTimeOrder } = await this.campaignAnchor(options.campaignId);
    const catalog = await this.deps.segmentContent.loadEffectiveCatalog({ campaignId: options.campaignId, branchId: options.branchId, binding: summary.state.segmentContentBinding });
    const facts = await this.deps.worldStore.listFacts(summary.worldId);
    const known = new Set((summary.state.discoveries ?? []).filter(d => d.actorId === player.actorId).map(d => d.entryId));
    const visible = projectPlayerEntriesAtAnchor(catalog.entries, facts, worldTimeOrder, known);
    const scenes = visible.filter(entry => entry.kind === 'scene' && (entry.definition as SceneDefinition).locationId === playerState.locationId);
    const templateIds = new Set(scenes.flatMap(entry => (entry.definition as SceneDefinition).actors));
    const existing = await this.loadAllCards(options.branchId);
    const cards = visible.filter(entry => entry.kind === 'actor_template' && templateIds.has(entry.entryId)
      && isTemplateValidAtAnchor(entry, worldTimeOrder)
      && !existing.some(card => card.templateId === entry.entryId || card.name === (entry.definition as ActorTemplateDefinition).name))
      .map(entry => createTemplateCard({ actorId: `npc-${entry.entryId}`, worldId: summary.worldId, worldPackageRevision: summary.packageRevision,
        templateId: entry.entryId, definition: entry.definition as ActorTemplateDefinition, controller: 'gm', kind: 'npc' }));
    if (!cards.length) return false;
    const loadout: Array<{ itemId: string; actorId: string; templateId: string }> = [];
    for (const card of cards) {
      const template = visible.find(entry => entry.entryId === card.templateId)!;
      for (const itemId of (template.definition as ActorTemplateDefinition).startingItems ?? []) {
        if (!visible.some(entry => entry.entryId === itemId && entry.kind === 'item')) throw new Error(`场景人物起始物品不可用：${itemId}`);
        if (summary.state.itemOwners[itemId] !== undefined || loadout.some(item => item.itemId === itemId)) throw new Error(`场景人物起始物品已归属：${itemId}`);
        loadout.push({ itemId, actorId: card.actorId, templateId: template.entryId });
      }
    }
    const version = summary.state.stateVersion;
    const turnId = `system-scene_actors-${String(version + 1).padStart(6,'0')}`;
    await new SqliteInteractionOperationJournal(this.deps.db).guardTurn({ ...options, turnId, expectedStateVersion: version }, async fence => {
      await this.commitLifecycleAction({ ...options, actorId: player.actorId, actionType: 'scene_actors',
        intent: '当前场景已采用的人物资料载入', expectedStateVersion: version, coordinationFence: fence,
        settlement: { cardUpserts: cards.map(card => ({ actorId: card.actorId, card })), relationships: cards.map(card => ({
          relId: `rel-${card.actorId}-${player.actorId}`, fromActorId: card.actorId, toActorId: player.actorId,
          stance: 'neutral', closeness: 0, updatedTurnId: turnId,
        })) },
        updateState: state => { for (const card of cards) {
          if (state.actors[card.actorId]) throw new Error('scene_actor_already_exists');
          state.actors[card.actorId] = { actorId: card.actorId, locationId: playerState.locationId,
            ...(playerState.zoneId ? { zoneId: playerState.zoneId } : {}), resources: { ...card.resourceMax }, conditions: [], lifeStatus: 'active' };
        }
          for (const item of loadout) {
            state.itemOwners[item.itemId] = item.actorId;
            state.itemSources ??= {};
            state.itemSources[item.itemId] = { kind: 'starting_loadout', sourceId: item.templateId, obtainedAtStateVersion: version + 1 };
          }
        }, events: [{ eventType: 'adopted_scene_actors_instantiated', payload: { templateIds: cards.map(card => card.templateId) } }] });
    });
    return true;
  }

  private async playTurnInForeground(options: PlayTurnOptions): Promise<PlayTurnResult> {
    await this.assertNoActiveEncounter(options.branchId);
    const summary = await this.getSummary(options.campaignId, options.branchId);
    if (options.guidanceChoice) await this.assertGuidanceChoiceCurrent(options.branchId, options.guidanceChoice, options.intent);
    // Rule dispatch (plan §9 / G05): legacy V0.1 campaigns carry no package
    // lock; they stay readable but cannot play forward on V0.2 mechanics.
    if (summary.packageRevision < 1) {
      throw new Error(
        '这是一个旧版（V0.1）战役：它没有锁定世界包，无法用 V0.2 规则继续。' +
          '历史与存档保持可读；请从世界书架用当前三宝书重新开局。',
      );
    }
    const basePackage = await this.deps.worldStore.getWorldPackage(summary.worldId, summary.packageRevision);
    if (!basePackage || basePackage.manifest.status !== 'published') {
      throw new Error(`Locked published world package is missing: ${summary.worldId} r${summary.packageRevision}.`);
    }
    let contentManifest: BranchContentManifest | undefined = summary.state.contentManifest;
    if (!contentManifest && await hasBranchContentManifestTable(this.deps.db)) {
      contentManifest = await ensureBaseBranchContentManifest({
        db: this.deps.db,
        branchId: options.branchId,
        worldId: summary.worldId,
        stateVersion: summary.state.stateVersion,
        packageRevision: summary.packageRevision,
        packageContentHash: basePackage.manifest.contentHash,
        createdAt: new Date().toISOString(),
      });
      summary.state.contentManifest = contentManifest;
    }
    const activeDeltas = contentManifest
      ? await loadBranchDeltaEntries({
          manifest: contentManifest,
          worldId: summary.worldId,
          branchId: options.branchId,
          stateVersion: summary.state.stateVersion,
          baseRevision: summary.packageRevision,
          baseContentHash: basePackage.manifest.contentHash,
          getDelta: deltaId => this.deps.worldStore.getProgressiveDeltaPackage(deltaId),
          sha256Hex: this.deps.hashProvider.sha256Hex,
        })
      : [];
    const allEntries = this.deps.segmentContent && summary.state.segmentContentBinding
      ? (await this.deps.segmentContent.loadEffectiveCatalog({ campaignId: options.campaignId, branchId: options.branchId, binding: summary.state.segmentContentBinding })).entries
      : [...basePackage.entries, ...activeDeltas.flatMap(delta => delta.entries)];
    if (new Set(allEntries.map(entry => entry.entryId)).size !== allEntries.length) {
      throw new Error('The active branch content manifest contains conflicting immutable entry ids.');
    }
    const playerCard = summary.cards.find(card => card.controller === 'player');
    if (!playerCard) throw new Error('Campaign has no player character card.');
    const playerState = summary.state.actors[playerCard.actorId];
    if (!playerState || playerState.lifeStatus === 'critical' || playerState.lifeStatus === 'dead'
      || playerState.conditions.includes('disabled')) {
      throw new Error('失能或濒危角色不能提交新的自由行动；需要先处理援救或结局风险。');
    }
    const allCards = await this.loadAllCards(options.branchId);
    const campaignAnchorRow = await this.deps.db.queryOne<{ anchor_json: string }>(
      'SELECT anchor_json FROM campaigns WHERE campaign_id = ?', [options.campaignId],
    );
    const anchor = campaignAnchorRow
      ? JSON.parse(campaignAnchorRow.anchor_json) as { worldTimeOrder?: number; anchorEventId?: string }
      : {};
    const anchorOrder = Number.isFinite(anchor.worldTimeOrder) ? Number(anchor.worldTimeOrder) : 0;
    const facts = await this.deps.worldStore.listFacts(summary.worldId);
    // P7 §4.2: only the anchor and committed causal progress advance story
    // order. Loading later catalog entries does not prove a player reached
    // their events and cannot execute a future fate.
    const catalogCausalFloor = anchorOrder;
    const worldTimeOrder = Math.max(anchorOrder, summary.state.causalWorldTimeOrder ?? 0, catalogCausalFloor);
    const anchorEvents = (await this.deps.worldStore.listEvents(summary.worldId))
      .filter(event => event.status === 'canon' && event.worldTimeOrder !== null);
    const projectionFacts = projectLegacyAnchorlessOpeningFacts(
      summary.worldId,
      basePackage.manifest,
      facts,
      !anchor.anchorEventId && anchorEvents.length === 0,
    );
    const knownEntryIds = new Set((summary.state.discoveries ?? [])
      .filter(item => item.actorId === playerCard.actorId).map(item => item.entryId));
    const entries = projectPlayerEntriesAtAnchor(allEntries, projectionFacts, worldTimeOrder, knownEntryIds);
    // The local authority may resolve hidden clue/quest references, but this
    // full time-valid package projection is never passed to the planner.
    const authoritativeEntries = allEntries.filter(entry => isEntryVisibleAtAnchor(entry, projectionFacts, worldTimeOrder)
      && (entry.kind !== 'actor_template' || isTemplateValidAtAnchor(entry, worldTimeOrder)));
    const { catalog, abilities, scenes, constraints } = packageIndexes(entries);
    const partyGroupId = (summary.state.party ?? []).find(member => member.actorId === playerCard.actorId)?.groupId ?? 'main';
    const sameGroupIds = new Set((summary.state.party ?? [])
      .filter(member => (member.groupId ?? 'main') === partyGroupId).map(member => member.actorId));
    const publicLocalNpcIds = new Set(allCards.filter(card => card.kind === 'npc'
      && card.templateId && entries.some(entry => entry.kind === 'actor_template'
        && entry.entryId === card.templateId
        && isTemplateValidAtAnchor(entry, worldTimeOrder))
      && summary.state.actors[card.actorId]?.locationId === summary.state.actors[playerCard.actorId]?.locationId)
      .map(card => card.actorId));
    const plannerCards = allCards.filter(card => sameGroupIds.has(card.actorId) || publicLocalNpcIds.has(card.actorId));

    // P7: situation definitions bound to this branch's content. Old packages
    // (world-package-2/3) carry none and keep the pre-P7 play loop intact.
    const situationDefinitions = authoritativeEntries
      .filter(entry => entry.kind === 'situation')
      .map(entry => ({
        situationId: entry.entryId,
        definition: entry.definition as SituationDefinitionV1,
      }));
    const situationStatusById = new Map((summary.state.situations ?? [])
      .map(entry => [entry.situationId, entry] as const));
    const activeMethods: MethodTemplateV1[] = [];
    const activeMethodSituations: string[] = [];
    for (const situation of situationDefinitions) {
      if (situation.definition.locationId && situation.definition.locationId !== playerState.locationId) continue;
      if (situationStatusById.get(situation.situationId)?.status === 'active') {
        for (const method of situation.definition.methods) {
          const assessed = assessMethod(situation.situationId, method, {
            state: summary.state, playerCard, entries,
            cardsByName: new Map(plannerCards.map(card => [card.actorId, card])),
            situationStatuses: situationStatusById, causalWorldTimeOrder: worldTimeOrder,
          });
          if (!assessed.visible) continue;
          if (!assessed.eligible) {
            const normalizeIntent = (text: string): string => text.replace(/[\s，。！？、,.!?；;：:]/g, '');
            if (normalizeIntent(options.intent) === normalizeIntent(method.firstStep.intent)) {
              throw new Error(`尚未掌握技能或补齐行动前提：${assessed.blockers.join('；')}`);
            }
            continue;
          }
          activeMethods.push(method);
          activeMethodSituations.push(situation.situationId);
        }
      }
    }
    const factsById = new Map(facts.map(fact => [fact.factId, fact] as const));
    const methodOpsForContract = (contract: ActionContract, grade: RollGrade): SituationTransitionOp[] => {
      const ref = contract.methodRef;
      if (!ref) return [];
      const definition = situationDefinitions.find(situation => situation.situationId === ref.situationId);
      const method = definition?.definition.methods.find(item => item.methodId === ref.methodId);
      if (!method) return [];
      return grade === 'success' || grade === 'full_success'
        ? [...(method.onSuccess ?? [])]
        : [...(method.onFailure ?? [])];
    };
    // Names that must never surface in player guidance text (A09): GM-only
    // entries and undiscovered discoverable entries.
    const blockedNames: string[] = [];
    for (const entry of allEntries) {
      if (entry.kind === 'situation') continue;
      if (!entries.some(visible => visible.entryId === entry.entryId) || entry.visibility === 'gm'
        || (entry.visibility === 'discoverable' && !knownEntryIds.has(entry.entryId))) {
        const definition = entry.definition as { name?: string; title?: string };
        const name = definition.name ?? definition.title;
        if (name && name.trim()) blockedNames.push(name.trim());
      }
    }
    const visibleActorNames = new Map(plannerCards
      .filter(card => card.actorId !== playerCard.actorId)
      .map(card => [card.actorId, card.name] as const));
    const keyItemIds = new Set<string>();
    for (const situation of situationDefinitions) {
      for (const method of situation.definition.methods) {
        if (method.requires.itemId) keyItemIds.add(method.requires.itemId);
        if (method.firstStep.itemId) keyItemIds.add(method.firstStep.itemId);
      }
    }

    const stateVersion = options.turnIdOverride
      ? Number.parseInt(options.turnIdOverride.replace(/^turn-/, ''), 10)
      : summary.state.stateVersion + 1;
    const turnId = options.turnIdOverride ?? `turn-${String(stateVersion).padStart(4, '0')}`;
    const recentHistory = await this.deps.turns.listCommittedTurns(options.branchId);
    const memories = await this.deps.game.listMemories(options.branchId);
    const contextParts = this.collectWorldContextParts(
      entries, plannerCards, summary.state, summary.goal, recentHistory, memories, options.intent, playerCard.actorId,
      worldTimeOrder, projectionFacts,
    );
    // P7: active situations and their method first steps (player-safe only —
    // gmBrief and hidden conditions never enter any model context). Situation
    // entries are gm-visibility, so this reads the authoritative projection.
    for (const situation of situationDefinitions) {
      if (situationStatusById.get(situation.situationId)?.status !== 'active'
        || (situation.definition.locationId && situation.definition.locationId !== playerState.locationId)) continue;
      const methodLines = activeMethods.filter((_, index) => activeMethodSituations[index] === situation.situationId)
        .map(method => `- ${method.title}：${method.firstStep.intent}`)
        .slice(0, 4)
        .join('\n');
      contextParts.push(`【当前局面】${situation.definition.summary}（压力：${situation.definition.pressure.description}）\n可选介入办法（均为首步尝试，玩家也可能自行描述其他做法）：\n${methodLines}`);
    }
    // Legal skill ids for skill_check proposals (plan §40 mandatory): the
    // planner may only reference skills the actor actually knows.
    const actorSkillIds = Object.keys(playerCard.skills ?? {});
    if (actorSkillIds.length > 0) {
      const skillSummary = actorSkillIds
        .map(key => {
          const definition = catalog[key] ?? catalog[key.replace(/^skill-/, '')];
          return definition ? `${key}(${definition.name})` : key;
        })
        .join('、');
      contextParts.push(`【可用技能】${skillSummary}。skill_check 的 skillId 只能从中选择。`);
    }
    const visibleSourceRanges = visibleEvidenceRanges(entries, projectionFacts, worldTimeOrder, knownEntryIds);
    let sourceHash: string | null = null;
    let safeSourceContext = '';
    if (this.deps.progressiveTurnContext && visibleSourceRanges.length > 0) {
      try {
        const world = await this.deps.worldStore.getWorld(summary.worldId);
        sourceHash = world?.sourceSha256 ?? null;
        if (sourceHash) {
          const lookup = await this.deps.progressiveTurnContext.currentAction({
            campaignId: options.campaignId,
            branchId: options.branchId,
            worldId: summary.worldId,
            sourceSha256: sourceHash,
            stateVersion: summary.state.stateVersion,
            query: options.intent,
            sourceRanges: visibleSourceRanges,
            isCurrent: async () => (await this.deps.turns.getState(options.branchId))?.stateVersion === summary.state.stateVersion,
          });
          if (lookup && lookup.passages.length > 0) {
            safeSourceContext = `\n【已发布且当前时间锚点可见的原著证据】\n${lookup.passages
              .slice(0, 3)
              .map(passage => `${passage.chapterId} [${passage.startCodePoint},${passage.endCodePoint}): ${passage.text}`)
              .join('\n')}\n以上仅为已整理资料引用的原文片段；没有提供的情节仍属未知。`;
            if (this.deps.sourceStore && contentManifest && !summary.state.segmentContentBinding) {
              const excerptDelta = await publishSourceEvidenceExcerptDelta({
                db: this.deps.db,
                worldStore: this.deps.worldStore,
                sourceStore: this.deps.sourceStore,
                sha256Hex: this.deps.hashProvider.sha256Hex,
                worldId: summary.worldId,
                branchId: options.branchId,
                stateVersion: summary.state.stateVersion,
                baseRevision: summary.packageRevision,
                sourceSha256: sourceHash,
                passages: lookup.passages,
                existingEntryIds: new Set(allEntries.map(entry => entry.entryId)),
                createdAt: new Date().toISOString(),
              });
              if (excerptDelta?.status === 'published' && excerptDelta.activeManifest) {
                contentManifest = excerptDelta.activeManifest;
                summary.state.contentManifest = excerptDelta.activeManifest;
                allEntries.push(...excerptDelta.delta.entries);
                entries.push(...projectPlayerEntriesAtAnchor(
                  excerptDelta.delta.entries, projectionFacts, worldTimeOrder, knownEntryIds,
                ));
                authoritativeEntries.push(...excerptDelta.delta.entries);
              }
            }
          }
        }
      } catch {
        // Local retrieval is optional; it must never hold a playable turn
        // hostage or replace an unknown with invented canon.
      }
    }
    // Turn-context pipeline (infrastructure plan M5): parts + story memory
    // V2 + episodic recall + source evidence -> elastic allocation against
    // the model's REAL capabilities -> frozen planner/narrator contexts.
    const stagedStyleTurn = await this.deps.turns.getStagedTurn(options.branchId, turnId);
    let styleSnapshot: import('../../domain/style/types').EffectiveStyleSnapshotV1 | undefined;
    if (stagedStyleTurn) {
      styleSnapshot = (JSON.parse(stagedStyleTurn.actionContractJson) as ActionContract).styleSnapshot;
    } else if (this.deps.projectStyle) {
      styleSnapshot = await this.deps.projectStyle.freezeEffectiveStyle({
        projectId: summary.worldId, branchId: options.branchId, turnId, sceneKind: 'exploration',
        participantIds: plannerCards.slice(0, 5).map(card => card.actorId),
        tokenAllowance: Math.max(0, Math.min(600, Math.floor((this.turnCapabilities().contextWindowTokens ?? 12000) * 0.025))),
      });
    }
    const turnBundle = await this.buildTurnContextBundle({
      branchId: options.branchId,
      stateVersion: summary.state.stateVersion,
      parts: contextParts,
      sourceEvidenceText: safeSourceContext,
      intent: options.intent,
      goal: summary.goal,
      plannerCards,
      recentHistory,
      styleText: styleSnapshot?.compiledText,
    });
    const plannerWorldContext = turnBundle.plannerText;
    this.lastTurnContexts = {
      planner: turnBundle.plannerContext,
      narrator: turnBundle.narratorContext,
    };

    let usageSeq = 0;
    const gameStore = this.deps.game;
    const actorId = playerCard.actorId;
    const settlementPlanFor = async (grade: RollGrade, contract: ActionContract): Promise<TurnSettlementPlan> => {
      const actingActorId = contractActorId(contract, plannerCards);
      const actingCard = plannerCards.find(card => card.actorId === (actingActorId ?? actorId));
      const storedSkillKey = contract.skillId && actingCard
        ? (resolveSkillKey(actingCard, contract.skillId) ?? contract.skillId)
        : contract.skillId;
      let plan: TurnSettlementPlan;
      if (!contract.requiresRoll || !storedSkillKey) {
        plan = emptySettlement(options.encounterId ?? `auto-${options.branchId}-${turnId}`);
      } else {
        const challengeId = options.encounterId
          ?? await deriveChallengeId(gameStore, options.branchId, actingActorId ?? actorId, storedSkillKey);
        plan = await buildTurnSettlement({
          gameStore,
          branchId: options.branchId,
          turnId,
          encounterId: challengeId,
          actorId: actingActorId ?? actorId,
          skillId: storedSkillKey,
          outcomeGrade: grade,
          stateVersion,
          closeChallenge: !options.encounterId && (grade === 'full_success' || grade === 'success'),
        });
      }
      const relationship = this.socialRelationshipDelta(summary.state, contract, grade, entries, plannerCards);
      if (relationship) plan.relationships = [relationship];
      return plan;
    };
    let result;
    try {
      result = await runV2Turn({
        provider: this.provider,
        store: this.deps.turns,
        journal: this.deps.turns,
        narratives: this.deps.narratives,
        branchId: options.branchId,
        turnId,
        playerIntent: options.intent,
        worldContext: plannerWorldContext,
        plannerWireOutputTokens: turnBundle.plannerWireOutputTokens,
        reasoningTier: turnBundle.reasoningTier,
        plannerReasoningReserveTokens: turnBundle.plannerReasoningReserveTokens,
        narratorReasoningReserveTokens: turnBundle.narratorReasoningReserveTokens,
        plannerReasoningRecovery: turnBundle.plannerReasoningRecovery,
        narratorReasoningRecovery: turnBundle.narratorReasoningRecovery,
        reasoningPolicyVersion: turnBundle.reasoningPolicyVersion,
        narratorWorldContext: turnBundle.narratorText,
        narratorBudget: { capabilities: this.turnCapabilities(), reasoningPolicy: {
          tier: normalizeReasoningTier(this.profile.reasoningTier ?? this.profile.reasoningEffort),
          providerDialect: this.profile.reasoningDialect ?? reasoningDialectForModel(this.profile.model), model: this.profile.model,
        } },
        narratorWireOutputTokens: turnBundle.narratorWireOutputTokens,
        styleSnapshot,
        coordinationFence: options.coordinationFence,
        onReasoningRecovery: (role, context) => {
          if (role === 'planner') this.lastTurnContexts.planner = context;
          else this.lastTurnContexts.narrator = context;
        },
        ...(contentManifest ? { expectedContentDependency: summary.state.segmentContentBinding ?? contentDependencyBinding(contentManifest) } : {}),
        hashProvider: this.deps.hashProvider,
        random: this.deps.random,
        actingCard: playerCard,
        cards: plannerCards,
        catalog,
        abilities,
        scenes,
        constraints,
        selectedBaseAction: baseActionCandidates(summary.state, playerCard, new Set(plannerCards.map(card => card.actorId)), entries,
          situationDefinitions.filter(s => situationStatusById.get(s.situationId)?.status === 'active')
            .map(s => s.definition.locationId).filter((id): id is string => typeof id === 'string'))
          .find(candidate => candidate.firstStepIntent === options.intent),
        ...(activeMethods.length > 0 ? { methods: activeMethods, methodSituations: activeMethodSituations } : {}),
        // P7 prepared pipeline: full local reduction BEFORE the Narrator, so
        // guidance reflects the post-settlement state and the commit applies
        // the exact prepared object (single reduction, single reward pass).
        ...(situationDefinitions.length > 0 ? {
          prepareResolution: async ({ contract, contractHash, grade, rollRecord }) => {
            const settlement = await settlementPlanFor(grade, contract);
            return prepareTurnResolution(this.deps.turns, {
              branchId: options.branchId,
              contract,
              contractHash,
              outcomeGrade: grade,
              rollRecord,
              settlement,
              contractOrigin: 'engine' as const,
              updateNextState: nextState => {
                if (contract.styleSnapshot) nextState.styleSnapshot = contract.styleSnapshot;
                this.advanceCausalOrder(nextState, contract, authoritativeEntries, factsById, situationDefinitions, [], allEntries, catalogCausalFloor);
              },
              applyAuthoritativeState: nextState => {
                const sourceLocationId = summary.state.actors[contract.actorId]?.locationId ?? '';
                const discoveryEvents = this.applyDiscoveryAndQuestProgress(
                  nextState, contract, grade, authoritativeEntries, plannerCards, sourceLocationId);
                const runtime = applySituationRuntime({
                  definitions: situationDefinitions,
                  nextState,
                  sourceTurnId: contract.turnId,
                  playerActorId: playerCard.actorId,
                  methodOps: methodOpsForContract(contract, grade),
                });
                nextState.situations = runtime.situations;
                for (const fate of runtime.actorFates) {
                  const actorState = nextState.actors[fate.actorId];
                  if (actorState) actorState.lifeStatus = fate.lifeStatus;
                }
                this.advanceCausalOrder(nextState, contract, authoritativeEntries, factsById, situationDefinitions, runtime.events, allEntries, catalogCausalFloor);
                return [...discoveryEvents, ...runtime.events];
              },
            });
          },
          buildSituationPacket: (prepared: PreparedTurnResolution) => buildSituationPacket({
            prepared,
            situationDefinitions,
            playerCard,
            visibleActorNames,
            keyItemIds,
            entries, cards: plannerCards,
          }),
          buildGuidance: async ({
            prepared, contract, grade, llmSteps, llmSummary,
          }) => {
            const packet = buildSituationPacket({
              prepared, situationDefinitions, playerCard, visibleActorNames, keyItemIds, entries, cards: plannerCards,
            });
            const knowledgeHash = await this.deps.hashProvider.sha256Hex(
              [...new Set((prepared.nextState.discoveries ?? []).filter(d => d.actorId === playerCard.actorId).map(d => d.entryId))].sort().join('\n'));
            const contentBindingHash = guidanceContentBindingHash(prepared.nextState);
            const contextHash = await this.deps.hashProvider.sha256Hex(
              canonicalStringify((packet ?? { none: true }) as unknown as import('../../domain/turns/canonical').CanonicalJson));
            return assembleTurnGuidance({
              prepared,
              contract,
              grade,
              llmSteps,
              llmSummary,
              packet,
              campaignId: options.campaignId,
              playerActorId: playerCard.actorId,
              blockedNames,
              situationDefinitions,
              playerCard,
              visibleActorNames,
              keyItemIds,
              contentBindingHash,
              knowledgeHash,
              contextHash,
            });
          },
          saveGuidance: async guidance => {
            if (this.deps.guidance) await this.deps.guidance.save(guidance);
          },
        } : {
          updateCommittedState: (nextState: GameStateSnapshot, contract: ActionContract, grade: RollGrade) => {
            if (contract.styleSnapshot) nextState.styleSnapshot = contract.styleSnapshot;
            const sourceLocationId = summary.state.actors[contract.actorId]?.locationId ?? '';
            return this.applyDiscoveryAndQuestProgress(nextState, contract, grade, authoritativeEntries, plannerCards, sourceLocationId);
          },
        }),
        resolveRollSpec(contract: ActionContract) {
          // Card-driven: attributes and dice come from the character card and
          // the world skill catalog - never from model output.
          if (!contract.skillId) {
            return { attribute: 1, skillRank: 'untrained' as SkillRank, difficulty: 4 };
          }
          return rollSpecForSkill(
            playerCard,
            catalog,
            contract.skillId,
            (contract.difficultyBand ?? 'normal') as DifficultyBand,
          );
        },
        settlementFor: (grade, contract) => settlementPlanFor(grade, contract),
        usageRecorder: record => {
          void this.deps.game.recordLlmUsage({
            branchId: options.branchId,
            turnId,
            role: record.role,
            requestSeq: ++usageSeq,
            model: this.profile.model,
            inputTokens: record.inputTokens,
            outputTokens: record.outputTokens,
            estimated: record.estimated,
            createdAt: new Date().toISOString(),
          }).catch(() => undefined);
        },
      });
    } catch (error) {
      // A refused planner proposal (world-unknown skill, untrained attempt)
      // with NO persisted roll may be abandoned cleanly: no dice existed, so
      // nothing is re-rolled. The staged contract is discarded and the user
      // gets an actionable explanation instead of a stuck turn.
      if (error instanceof SkillNotDefinedError || error instanceof SkillNotTrainedError) {
        const rolled = await this.deps.turns.getRollRecord(options.branchId, turnId, 0);
        if (!rolled) {
          await this.deps.turns.discardUnrolledTurn(options.branchId, turnId);
          const reason = error instanceof SkillNotDefinedError
            ? `提议的技能「${error.skillId}」在这个世界不存在`
            : `角色尚未掌握技能「${error.skillId}」，且它不允许无训练尝试`;
          throw new Error(
            `主持人的提案被本地规则拒绝：${reason}。回合已安全回退（未消耗任何检定），请换一种行动描述再试。`,
          );
        }
      }
      throw error;
    }

    if (sourceHash && this.deps.progressiveTurnContext && visibleSourceRanges.length > 0) {
      const nextState = await this.deps.turns.getState(options.branchId);
      const nextLocationId = nextState?.actors[playerCard.actorId]?.locationId;
      if (nextState && nextLocationId) {
        const nextScene = entries.find(entry => entry.kind === 'scene'
          && (entry.definition as SceneDefinition).locationId === nextLocationId)?.definition as SceneDefinition | undefined;
        void this.deps.progressiveTurnContext.nearDomainPrefetch({
          campaignId: options.campaignId,
          branchId: options.branchId,
          worldId: summary.worldId,
          sourceSha256: sourceHash,
          stateVersion: nextState.stateVersion,
          query: `${nextScene?.name ?? nextLocationId} ${summary.goal}`,
          sourceRanges: visibleSourceRanges,
          isCurrent: async () => (await this.deps.turns.getState(options.branchId))?.stateVersion === nextState.stateVersion,
        }).catch(() => undefined);
      }
    }

    // Story Memory V2 dual-track maintenance (infrastructure plan M3) +
    // episodic index write (M4): return-first - the cadence gate, the index
    // row write and any checkpoint LLM run in the background and can never
    // block or fail this committed turn.
    void (async () => {
      try {
        const committed = await this.deps.turns.listCommittedTurns(options.branchId);
        const latest = committed.find(turn => turn.stateVersion === result.stateVersion);
        if (latest && this.deps.episodic) {
          const record = episodicRecordFromTurn({ entry: latest });
          const namesById = new Map(plannerCards.map(card => [card.actorId, card.name]));
          record.keywords = record.actorIds
            .map(actorId => namesById.get(actorId))
            .filter((name): name is string => Boolean(name));
          await this.deps.episodic.store.saveTurnRecord(record);
        }
        if (this.deps.storyMemory) {
          const decision = await shouldRunMaintenance({
            store: this.deps.storyMemory.store,
            turnStore: this.deps.turns,
            branchId: options.branchId,
            currentStateVersion: result.stateVersion,
          });
          if (decision.should) {
            await runStoryMemoryMaintenance({
              provider: this.provider,
              store: this.deps.storyMemory.store,
              turnStore: this.deps.turns,
              branchId: options.branchId,
              currentStateVersion: result.stateVersion,
              actors: plannerCards.map(card => ({ actorId: card.actorId, name: card.name })),
              capabilities: this.turnCapabilities(),
              reasoningPolicy: {
                tier: normalizeReasoningTier(this.profile.reasoningTier ?? this.profile.reasoningEffort),
                providerDialect: this.profile.reasoningDialect ?? reasoningDialectForModel(this.profile.model),
                model: this.profile.model,
              },
            });
          }
        }
      } catch {
        // Background memory/index maintenance must never fail a played turn.
      }
    })();

    return {
      turnId,
      text: result.narrative.text,
      grade: result.rollRecord?.grade ?? 'automatic',
      dice: result.rollRecord
        ? `${result.rollRecord.diceCount}d${result.rollRecord.dieSides}: [${result.rollRecord.rolls.join(', ')}]`
        : undefined,
      resumed: result.resumed,
      stateVersion: result.stateVersion,
      practiceAwarded: false,
      ...(result.guidance ? { guidance: result.guidance } : {}),
    };
  }

  /** Deterministic rest (plan §12.5): short 30min stamina+2, long 8h full stamina + hp 2. */
  async rest(options: {
    campaignId: string;
    branchId: string;
    kind: 'short' | 'long';
    guidanceChoice?: PlayTurnOptions['guidanceChoice'];
  }): Promise<{ committed: boolean; clockSecondsAdvanced: number }> {
    await this.assertNoActiveEncounter(options.branchId);
    const summary = await this.getSummary(options.campaignId, options.branchId);
    if (options.guidanceChoice) {
      await this.assertGuidanceChoiceCurrent(options.branchId, options.guidanceChoice);
      if (options.kind !== 'short' || options.guidanceChoice.candidateRef !== 'action:short_rest') throw new Error('休息路径与当前动作不一致。');
    }
    const playerCard = summary.cards.find(card => card.controller === 'player');
    if (!playerCard) throw new Error('Campaign has no player character card.');
    const actor = summary.state.actors[playerCard.actorId];
    if (!actor) throw new Error('Player actor is missing from state.');
    if (actor.lifeStatus === 'critical' || actor.lifeStatus === 'dead' || actor.conditions.includes('disabled')) {
      throw new Error('失能或濒危角色不能自行休整；需要先处理援救或结局风险。');
    }

    const minutes = options.kind === 'short' ? SHORT_REST_MINUTES : 8 * 60;
    const staminaMax = playerCard.resourceMax.stamina ?? 10;
    const staminaRestore = options.kind === 'short' ? Math.min(SHORT_REST_STAMINA_RESTORE, staminaMax) : staminaMax;
    const hpRestore = options.kind === 'long' ? Math.min(2, playerCard.resourceMax.hp ?? 10) : 0;

    const turnId = `rest-${options.kind}-${summary.state.stateVersion + 1}`;
    const contract: ActionContract = {
      protocolVersion: '1.0',
      turnId,
      expectedStateVersion: summary.state.stateVersion,
      actorId: playerCard.actorId,
      actionType: options.kind === 'short' ? 'short_rest' : 'long_rest',
      evidenceIds: ['rest-policy-v02'],
      requiresRoll: false,
      intent: options.kind === 'short' ? '安全短休 30 分钟' : '安全长休 8 小时',
      timeCostMinutes: minutes,
      resourcePreconditions: [],
      outcomes: {
        full_success: restOutcome(playerCard.actorId, staminaRestore, hpRestore, minutes, staminaMax, playerCard.resourceMax.hp ?? 10),
        success: restOutcome(playerCard.actorId, staminaRestore, hpRestore, minutes, staminaMax, playerCard.resourceMax.hp ?? 10),
        failure: restOutcome(playerCard.actorId, staminaRestore, hpRestore, minutes, staminaMax, playerCard.resourceMax.hp ?? 10),
        severe_failure: restOutcome(playerCard.actorId, staminaRestore, hpRestore, minutes, staminaMax, playerCard.resourceMax.hp ?? 10),
      },
    };
    const applySituations = await this.localSituationReducer(options.campaignId, options.branchId, summary.state, turnId, playerCard.actorId);
    await commitResolvedTurn({
      store: this.deps.turns,
      branchId: options.branchId,
      contract,
      contractHash: await this.deps.hashProvider.sha256Hex(`${turnId}:rest`),
      applyAuthoritativeState: applySituations,
      contractOrigin: 'engine',
      outcomeGrade: 'success',
      committedAt: new Date().toISOString(),
    });
    await this.ensureDecisionPointGuidance({
      campaignId: options.campaignId,
      branchId: options.branchId,
      sourceTurnId: turnId,
      committedEvents: [{ eventType: 'rest_completed', payload: { kind: options.kind } }],
    }).catch(() => undefined);
    return {
      committed: true,
      clockSecondsAdvanced: minutes * 60,
    };
  }

  /**
   * Explicit rank training (plan §8.4) as ONE engine action transaction
   * (P2 acceptance A02): the engine queries the REAL training conditions —
   * the actor's authoritative stamina, the card's rank, the world skill
   * definition's training policy — and commits skill row, card projection,
   * time and stamina consumption, event and snapshot atomically. The UI never
   * supplies training booleans.
   */
  async trainSkill(options: {
    campaignId: string;
    branchId: string;
    actorId: string;
    skillId: string;
  }): Promise<{
    advanced: boolean;
    nextRank: SkillRank | null;
    pointsSpent: number;
    trainingMinutes: number;
    staminaSpent: number;
  }> {
    await this.assertNoActiveEncounter(options.branchId);
    const summary = await this.getSummary(options.campaignId, options.branchId);
    const state = summary.state;
    const card = await this.getCard(options.branchId, options.actorId);
    const storedSkillKey = resolveSkillKey(card, options.skillId) ?? options.skillId;
    const progress = await this.deps.game.getSkillProgress(options.branchId, options.actorId, storedSkillKey);
    if (!progress) throw new Error(`No progress record for skill ${options.skillId}.`);

    const actorState = state.actors[options.actorId];
    if (!actorState) throw new Error(`Actor ${options.actorId} is missing from the branch state.`);
    if (actorState.lifeStatus === 'critical' || actorState.lifeStatus === 'dead' || actorState.conditions.includes('disabled')) {
      throw new Error('失能或濒危角色不能训练；需要先处理援救或结局风险。');
    }

    // --- Real condition queries (never UI booleans) ---
    const entries = await this.loadPackageEntries(summary.worldId, summary.packageRevision, { campaignId: options.campaignId, state });
    const { catalog } = packageIndexes(entries);
    const definition = catalog[storedSkillKey] ?? catalog[options.skillId];
    // hasSource: ordinary-tier skills are self-trainable through practice
    // (V0.2 default); enhanced/supernatural tiers require a co-located
    // instructor whose rank exceeds the trainee's.
    const hasSource = trainingSourceSatisfied(storedSkillKey, definition, card, summary.cards, actorState, state);
    // hasResources: authoritative stamina, not a checkbox.
    const hasResources = (actorState.resources.stamina ?? 0) >= TRAINING_STAMINA_COST;
    // meetsPrerequisites: the card genuinely knows this skill below master.
    const meetsPrerequisites = resolveSkillKey(card, options.skillId) !== null && progress.rank !== 'master';
    const conditions: TrainingConditions = { hasSource, hasResources, meetsPrerequisites };
    assertTrainingAllowed(conditions);
    if (!isTrainable(progress)) {
      throw new Error(
        `Skill ${options.skillId} has not reached its practice threshold yet ` +
          `(${progress.practicePoints} points).`,
      );
    }
    const result = trainSkill(progress, conditions);
    if (!result.advanced || !result.nextRank) {
      return { advanced: false, nextRank: null, pointsSpent: 0, trainingMinutes: 0, staminaSpent: 0 };
    }

    const next: SkillProgress = {
      ...progress,
      rank: result.nextRank,
      practicePoints: result.pointsRemaining,
    };
    const nextCard: ActorCard = {
      ...card,
      skills: { ...card.skills, [storedSkillKey]: result.nextRank },
      cardRevision: card.cardRevision + 1,
    };

    const turnId = `train-${storedSkillKey}-v${state.stateVersion + 1}`;
    const contract: ActionContract = {
      protocolVersion: '1.0',
      turnId,
      expectedStateVersion: state.stateVersion,
      actorId: options.actorId,
      actionType: 'train',
      evidenceIds: [`training:${storedSkillKey}`],
      requiresRoll: false,
      intent: `训练 ${storedSkillKey} 至 ${result.nextRank}`,
      timeCostMinutes: TRAINING_MINUTES,
      resourcePreconditions: [
        { actorId: options.actorId, resourceId: 'stamina', minimum: TRAINING_STAMINA_COST },
      ],
      outcomes: {
        full_success: trainingOutcome(options.actorId, storedSkillKey, result.nextRank, TRAINING_MINUTES, TRAINING_STAMINA_COST),
        success: trainingOutcome(options.actorId, storedSkillKey, result.nextRank, TRAINING_MINUTES, TRAINING_STAMINA_COST),
        failure: trainingOutcome(options.actorId, storedSkillKey, result.nextRank, TRAINING_MINUTES, TRAINING_STAMINA_COST),
        severe_failure: trainingOutcome(options.actorId, storedSkillKey, result.nextRank, TRAINING_MINUTES, TRAINING_STAMINA_COST),
      },
    };
    const applySituations = await this.localSituationReducer(options.campaignId, options.branchId, state, turnId, options.actorId);
    await commitResolvedTurn({
      store: this.deps.turns,
      branchId: options.branchId,
      contract,
      contractHash: await this.deps.hashProvider.sha256Hex(`${turnId}:train`),
      applyAuthoritativeState: applySituations,
      contractOrigin: 'engine',
      outcomeGrade: 'success',
      settlement: {
        encounterId: `training-${options.branchId}-${options.actorId}-${storedSkillKey}`,
        skillUpserts: [{
          actorId: options.actorId,
          skillId: storedSkillKey,
          rank: next.rank,
          practicePoints: next.practicePoints,
          awardedKeys: [...next.awardedKeys],
          stateVersion: state.stateVersion + 1,
        }],
        rewardLedger: [],
        relationships: [],
        cardUpserts: [{ actorId: options.actorId, card: nextCard }],
      },
      committedAt: new Date().toISOString(),
    });
    await this.ensureDecisionPointGuidance({
      campaignId: options.campaignId,
      branchId: options.branchId,
      sourceTurnId: turnId,
      committedEvents: [{ eventType: 'training_completed', payload: { skillId: storedSkillKey } }],
    }).catch(() => undefined);
    return {
      advanced: true,
      nextRank: result.nextRank,
      pointsSpent: result.pointsSpent,
      trainingMinutes: TRAINING_MINUTES,
      staminaSpent: TRAINING_STAMINA_COST,
    };
  }

  /**
   * Milestone: 1-2 practice points onto an unlocked skill (never ranks),
   * committed through the SAME atomic machinery and IDEMPOTENT on the
   * milestone identity (P2 acceptance A04): replaying the same
   * encounterId+actor+skill milestone returns the recorded outcome without
   * adding a second point (ledger + awardedKeys double-gate).
   */
  async grantMilestone(options: {
    campaignId: string;
    branchId: string;
    actorId: string;
    skillId: string;
    points: number;
    encounterId: string;
  }): Promise<{ granted: number; replayed: boolean }> {
    await this.assertCampaignBranch(options.campaignId, options.branchId);
    await this.assertNoActiveEncounter(options.branchId);
    const card = await this.getCard(options.branchId, options.actorId);
    const storedSkillKey = resolveSkillKey(card, options.skillId) ?? options.skillId;
    const progress = await this.deps.game.getSkillProgress(options.branchId, options.actorId, storedSkillKey);
    if (!progress) throw new Error(`No progress record for skill ${options.skillId}.`);

    const milestoneKey = rewardKey(options.encounterId, 'milestone');
    if (progress.awardedKeys.includes(milestoneKey)) {
      return { granted: 0, replayed: true };
    }
    const granted = applyMilestonePractice({
      skillId: storedSkillKey,
      currentRank: progress.rank,
      grantedPoints: options.points,
    });
    if (granted === 0) return { granted: 0, replayed: false };

    const state = await this.deps.turns.getState(options.branchId);
    if (!state) throw new Error(`Branch has no state: ${options.branchId}.`);
    const turnId = `milestone-${options.encounterId}-${options.actorId}-${storedSkillKey}`;
    const awarded = awardPractice(progress, options.encounterId, 'milestone');
    const contract: ActionContract = {
      protocolVersion: '1.0',
      turnId,
      expectedStateVersion: state.stateVersion,
      actorId: options.actorId,
      actionType: 'milestone',
      evidenceIds: [`milestone:${options.encounterId}`],
      requiresRoll: false,
      intent: `里程碑奖励：${storedSkillKey} +${granted} 练习点`,
      timeCostMinutes: 0,
      resourcePreconditions: [],
      outcomes: {
        full_success: milestoneOutcome(options.actorId, storedSkillKey, granted),
        success: milestoneOutcome(options.actorId, storedSkillKey, granted),
        failure: milestoneOutcome(options.actorId, storedSkillKey, granted),
        severe_failure: milestoneOutcome(options.actorId, storedSkillKey, granted),
      },
    };
    const committed = await commitResolvedTurn({
      store: this.deps.turns,
      branchId: options.branchId,
      contract,
      contractHash: await this.deps.hashProvider.sha256Hex(`${turnId}:milestone`),
      contractOrigin: 'engine',
      outcomeGrade: 'success',
      settlement: {
        encounterId: options.encounterId,
        skillUpserts: [{
          actorId: options.actorId,
          skillId: storedSkillKey,
          rank: awarded.rank,
          practicePoints: progress.practicePoints + granted,
          awardedKeys: [...awarded.awardedKeys],
          stateVersion: state.stateVersion + 1,
        }],
        rewardLedger: [{
          encounterId: options.encounterId,
          actorId: options.actorId,
          skillId: storedSkillKey,
          rewardKind: 'milestone',
        }],
        relationships: [],
      },
      committedAt: new Date().toISOString(),
    });
    return { granted, replayed: committed.replayed };
  }

  /**
   * Opening-wizard data for one world (G02): its published package revision
   * plus the player-visible skill catalog, lore, canon anchor events, scene
   * locations, playable canon characters and companion templates. Used
   * before any campaign exists; read-only over immutable data.
   */
  async getWorldSetup(worldId: string, worldTimeOrder?: number, lockedPackageRevision?: number): Promise<{
    packageRevision: number | null;
    rulesetVersion: string;
    skills: Array<{ entryId: string; name: string; attribute: string; allowUntrained: boolean }>;
    lore: Array<{ name: string; text: string }>;
    anchorEvents: Array<{ eventId: string; title: string; summary: string; worldTimeOrder: number }>;
    locations: string[];
    locationOptions: Array<{ locationId: string; name: string }>;
    canonCharacters: Array<{ entityId: string; name: string }>;
    companionTemplates: Array<{ entryId: string; name: string; description: string }>;
    encounterTemplates: Array<{ entryId: string; name: string }>;
  }> {
    const revision = lockedPackageRevision ?? await this.deps.worldStore.getPublishedPackageRevision(worldId);
    if (revision === null) {
      return {
        packageRevision: null, rulesetVersion: '', skills: [], lore: [],
        anchorEvents: [], locations: [], locationOptions: [], canonCharacters: [], companionTemplates: [], encounterTemplates: [],
      };
    }
    const entries = await this.loadPackageEntries(worldId, revision);
    const pkg = await this.deps.worldStore.getWorldPackage(worldId, revision);
    const anchorEvents = await this.deps.worldStore.listEvents(worldId);
    const hasCanonTimeAnchor = anchorEvents.some(event => event.status === 'canon' && event.worldTimeOrder !== null);
    const rawFacts = await this.deps.worldStore.listFacts(worldId);
    const facts = projectLegacyAnchorlessOpeningFacts(
      worldId,
      pkg?.manifest ?? null,
      rawFacts,
      worldTimeOrder === undefined && !hasCanonTimeAnchor,
    );
    const skills = entries
      .filter(entry => entry.kind === 'skill' && entry.visibility === 'public'
        && isEntryVisibleAtAnchor(entry, facts, worldTimeOrder))
      .map(entry => {
        const def = entry.definition as { name?: string; attribute?: string; allowUntrained?: boolean };
        return {
          entryId: entry.entryId,
          name: def.name ?? entry.entryId,
          attribute: def.attribute ?? 'agility',
          allowUntrained: def.allowUntrained === true,
        };
      });
    const lore = entries
      .filter(entry => entry.kind === 'lore' && entry.visibility === 'public'
        && isEntryVisibleAtAnchor(entry, facts, worldTimeOrder))
      .map(entry => {
        const def = entry.definition as { name?: string; text?: string };
        return { name: def.name ?? entry.entryId, text: def.text ?? '' };
      });
    const sceneEntries = entries
      .filter(entry => entry.kind === 'scene' && entry.visibility === 'public'
        && isEntryVisibleAtAnchor(entry, facts, worldTimeOrder));
    const scenes = sceneEntries.map(entry => entry.definition as SceneDefinition);
    // Locations come from package scene entries AND the novel's canon
    // location entities (the extractor always produces those) - a package
    // without scene entries still offers real novel places to start at
    // instead of blocking the opening wizard (G02).
    const canonLocations = (await this.deps.worldStore.listEntities(worldId))
      .filter(entity => entity.type === 'location')
      .filter(entity => facts.some(fact => fact.subjectEntityId === entity.entityId
        && fact.status !== 'speculation' && fact.status !== 'conflict'
        && (worldTimeOrder === undefined
          ? fact.validFrom === null && fact.validTo === null && fact.revealAt === null
          : isFactVisibleAtAnchor(fact, worldTimeOrder))))
      .map(entity => ({ locationId: entity.name, name: entity.name }));
    const locations = [...new Set([...scenes.map(scene => scene.locationId), ...canonLocations.map(location => location.locationId)])];
    const locationOptionsById = new Map<string, { locationId: string; name: string }>();
    for (const entry of sceneEntries) {
      const definition = entry.definition as SceneDefinition;
      if (definition.locationId && !locationOptionsById.has(definition.locationId)) {
        locationOptionsById.set(definition.locationId, {
          locationId: definition.locationId,
          name: typeof definition.name === 'string' && definition.name.trim()
            ? definition.name.trim()
            : definition.locationId,
        });
      }
    }
    for (const location of canonLocations) {
      if (!locationOptionsById.has(location.locationId)) locationOptionsById.set(location.locationId, location);
    }
    const companionTemplates = entries
      .filter(entry => entry.visibility === 'public'
        && isPlayerRecruitmentCandidate(entry, facts, worldTimeOrder)
        && openingRelationshipFor(entry, worldTimeOrder ?? 0) !== null)
      .map(entry => {
        const def = entry.definition as { name?: string; description?: string };
        return {
          entryId: entry.entryId,
          name: def.name ?? entry.entryId,
          description: def.description ?? '',
        };
      });
    const encounterTemplates = entries
      .filter(entry => entry.kind === 'actor_template' && entry.visibility === 'public'
        && isEntryVisibleAtAnchor(entry, facts, worldTimeOrder)
        && isTemplateValidAtAnchor(entry, worldTimeOrder))
      .map(entry => ({
        entryId: entry.entryId,
        name: (entry.definition as { name?: string }).name ?? entry.entryId,
      }));

    // Anchor candidates: canon events in world-time order (the opening must
    // pick a REAL point in the story, not a fixed placeholder), plus the
    // world's person entities as canon-protagonist candidates.
    const anchors = [...anchorEvents]
      .filter(event => event.status === 'canon' && event.worldTimeOrder !== null
        && (pkg?.manifest.buildScope?.openingWorldTimeOrder === undefined || event.worldTimeOrder! >= pkg.manifest.buildScope.openingWorldTimeOrder))
      .filter(event => lockedPackageRevision === undefined || event.worldTimeOrder! <= (worldTimeOrder ?? 0))
      .sort((a, b) => (a.worldTimeOrder ?? 0) - (b.worldTimeOrder ?? 0))
      .slice(0, 40)
      .map(event => ({
        eventId: event.eventId,
        title: event.title,
        summary: event.summary,
        worldTimeOrder: event.worldTimeOrder ?? 1,
      }));
    const entities = await this.deps.worldStore.listEntities(worldId);
    const canonCharacters = entities
      .filter(entity => entity.type === 'character')
      .filter(entity => facts.some(fact => fact.subjectEntityId === entity.entityId
        && fact.status !== 'speculation' && fact.status !== 'conflict'
        && (worldTimeOrder === undefined
          ? fact.validFrom === null && fact.validTo === null && fact.revealAt === null
          : isFactVisibleAtAnchor(fact, worldTimeOrder))))
      .slice(0, 60)
      .map(entity => ({ entityId: entity.entityId, name: entity.name }));

    return {
      packageRevision: revision,
      rulesetVersion: pkg?.manifest.ruleset.version ?? '',
      skills,
      lore,
      anchorEvents: anchors,
      locations,
      locationOptions: [...locationOptionsById.values()],
      canonCharacters,
      companionTemplates,
      encounterTemplates,
    };
  }

  /**
   * Rewind = fork at an earlier snapshot + continue on the new branch. Cards,
   * party, skills, relationships and all authoritative projections come from
   * the fork-point snapshot INSIDE the fork transaction (P2 acceptance A03) —
   * the source branch's current rows are never copied into the past.
   */
  async rewind(options: {
    campaignId: string;
    sourceBranchId: string;
    atStateVersion: number;
    newBranchId: string;
  }): Promise<{ branchId: string; stateVersion: number }> {
    const forked = await forkBranch({
      db: this.deps.db,
      turnStore: this.deps.turns,
      gameStore: this.deps.game,
      sourceBranchId: options.sourceBranchId,
      targetBranchId: options.newBranchId,
      campaignId: options.campaignId,
      forkTurnId: null,
      atStateVersion: options.atStateVersion,
      createdAt: new Date().toISOString(),
    });
    return { branchId: options.newBranchId, stateVersion: forked.snapshot.stateVersion };
  }

  // -------------------------------------------------------------------------
  // Encounter scheduling (G01) — thin wrappers over EncounterService.
  // -------------------------------------------------------------------------

  beginEncounter(input: BeginEncounterInput): Promise<EncounterView> {
    return this.encounters.begin(input);
  }

  encounterQueueJoin(input: Parameters<EncounterService['queueParticipant']>[0]): Promise<EncounterView> {
    return this.encounters.queueParticipant(input);
  }

  getEncounterView(campaignId: string, branchId: string, encounterId: string): Promise<EncounterView> {
    return this.encounters.getView(campaignId, branchId, encounterId);
  }

  /** Return only explicitly authored conflict mappings for the player's current public scene. */
  async getCurrentSceneEncounterOptions(campaignId: string, branchId: string): Promise<SceneEncounterOption[]> {
    const summary = await this.getSummary(campaignId, branchId);
    if (summary.packageRevision < 1 || summary.state.encounters?.some(item => item.state.status === 'active')) return [];
    const player = summary.cards.find(card => card.controller === 'player');
    const locationId = player ? summary.state.actors[player.actorId]?.locationId : null;
    if (!player || !locationId) return [];

    const pkg = await this.deps.worldStore.getWorldPackage(summary.worldId, summary.packageRevision);
    if (!pkg || pkg.manifest.status !== 'published') return [];
    const manifest = summary.state.contentManifest ?? createBaseContentManifest({
      worldId: summary.worldId,
      branchId,
      stateVersion: summary.state.stateVersion,
      basePackage: { revision: summary.packageRevision, contentHash: pkg.manifest.contentHash },
    });
    const deltas = await loadBranchDeltaEntries({
      manifest,
      worldId: summary.worldId,
      branchId,
      stateVersion: summary.state.stateVersion,
      baseRevision: summary.packageRevision,
      baseContentHash: pkg.manifest.contentHash,
      getDelta: deltaId => this.deps.worldStore.getProgressiveDeltaPackage(deltaId),
      sha256Hex: this.deps.hashProvider.sha256Hex,
    });
    const entries = this.deps.segmentContent && summary.state.segmentContentBinding
      ? (await this.deps.segmentContent.loadEffectiveCatalog({ campaignId, branchId, binding: summary.state.segmentContentBinding })).entries
      : [...pkg.entries, ...deltas.flatMap(delta => delta.entries)];
    const anchorRow = await this.deps.db.queryOne<{ anchor_json: string }>(
      'SELECT anchor_json FROM campaigns WHERE campaign_id = ?', [campaignId],
    );
    let anchorEventId: string | undefined;
    try { anchorEventId = anchorRow ? (JSON.parse(anchorRow.anchor_json) as { anchorEventId?: string }).anchorEventId : undefined; }
    catch { return []; }
    const events = await this.deps.worldStore.listEvents(summary.worldId);
    const hasCanonTimeAnchor = events.some(event => event.status === 'canon' && event.worldTimeOrder !== null);
    const facts = projectLegacyAnchorlessOpeningFacts(
      summary.worldId,
      pkg.manifest,
      await this.deps.worldStore.listFacts(summary.worldId),
      summary.anchorWorldTimeOrder === null && !anchorEventId && !hasCanonTimeAnchor,
    );
    const templates = new Map(entries.filter(entry => entry.kind === 'actor_template').map(entry => [entry.entryId, entry]));
    const visibleScenes = entries.filter(entry => entry.kind === 'scene' && entry.visibility === 'public'
      && isEntryVisibleAtAnchor(entry, facts, summary.anchorWorldTimeOrder ?? undefined))
      .filter(entry => (entry.definition as SceneDefinition).locationId === locationId)
      .filter(entry => {
        const scene = entry.definition as SceneDefinition;
        const mapping = scene.encounterParticipants;
        if (!mapping || mapping.hostiles.length === 0) return false;
        return [...mapping.hostiles, ...(mapping.neutrals ?? [])].every(participant => {
          const template = templates.get(participant.templateId);
          return scene.actors.includes(participant.templateId) && template?.visibility === 'public'
            && isEntryVisibleAtAnchor(template, facts, summary.anchorWorldTimeOrder ?? undefined)
            && isTemplateValidAtAnchor(template, summary.anchorWorldTimeOrder ?? undefined);
        });
      });
    return visibleScenes.map(entry => {
      const scene = entry.definition as SceneDefinition;
      const mapping = scene.encounterParticipants!;
      return {
        sceneEntryId: entry.entryId,
        sceneName: scene.name,
        hostiles: mapping.hostiles.map(item => ({ ...item })),
        neutrals: (mapping.neutrals ?? []).map(item => ({ ...item })),
      };
    });
  }

  /** Revalidates scene and template qualification immediately before encounter creation. */
  async beginSceneEncounter(input: {
    campaignId: string; branchId: string; sceneEntryId: string; requestId: string;
  }): Promise<EncounterView> {
    if (!input.requestId || input.requestId.length > 96) throw new Error('遭遇请求编号无效。');
    const replayEncounterId = `enc-${input.branchId}-${encodeURIComponent(input.requestId)}`;
    if (await this.deps.game.loadEncounter(input.branchId, replayEncounterId)) {
      return this.encounters.getView(input.campaignId, input.branchId, replayEncounterId);
    }
    const option = (await this.getCurrentSceneEncounterOptions(input.campaignId, input.branchId))
      .find(item => item.sceneEntryId === input.sceneEntryId);
    if (!option) throw new Error('当前场景没有这组明确公开的冲突资格，未开始遭遇。');
    return this.encounters.begin({
      campaignId: input.campaignId,
      branchId: input.branchId,
      hostiles: option.hostiles,
      neutrals: option.neutrals,
      requestId: input.requestId,
    });
  }

  getActiveEncounter(campaignId: string, branchId: string): Promise<EncounterView | null> {
    return this.encounters.getActiveEncounter(campaignId, branchId);
  }

  encounterAttack(input: Parameters<EncounterService['playerAttack']>[0]): Promise<EncounterView> {
    return this.encounters.playerAttack(input);
  }

  getPlayerAttackAvailability(input: Parameters<EncounterService['getPlayerAttackAvailability']>[0]):
    Promise<{ allowed: boolean; explanation: string | null }> {
    return this.encounters.getPlayerAttackAvailability(input);
  }

  encounterNpcTurn(input: Parameters<EncounterService['npcTurn']>[0]): Promise<EncounterView> {
    return this.encounters.npcTurn(input);
  }

  encounterMove(input: Parameters<EncounterService['playerMove']>[0]): Promise<EncounterView> {
    return this.encounters.playerMove(input);
  }

  encounterDash(input: Parameters<EncounterService['playerDash']>[0]): Promise<EncounterView> {
    return this.encounters.playerDash(input);
  }

  encounterRescue(input: Parameters<EncounterService['rescueAlly']>[0]): Promise<EncounterView> {
    return this.encounters.rescueAlly(input);
  }

  encounterRetreat(input: Parameters<EncounterService['retreat']>[0]): Promise<EncounterView> {
    return this.encounters.retreat(input);
  }

  encounterPassTurn(input: Parameters<EncounterService['passTurn']>[0]): Promise<EncounterView> {
    return this.encounters.passTurn(input);
  }
}

function restOutcome(
  actorId: string,
  staminaRestore: number,
  hpRestore: number,
  minutes: number,
  staminaMax: number,
  hpMax: number,
): ActionContract['outcomes']['success'] {
  void minutes; // clock advance flows through timeCostMinutes exactly once
  // Restores carry the card's effective maxima (engine-injected cap): rest
  // never pushes a resource above its cap (plan §8.2).
  const effects: ActionContract['outcomes']['success']['effects'] = [
    {
      op: 'restoreResource',
      actorId,
      resourceId: 'stamina',
      amount: staminaRestore,
      cap: staminaMax,
    },
  ];
  if (hpRestore > 0) {
    effects.push({ op: 'restoreResource', actorId, resourceId: 'hp', amount: hpRestore, cap: hpMax });
  }
  return { achieved: true, publicSummary: '休息了一段时间。', effects };
}

function trainingOutcome(
  actorId: string,
  skillId: string,
  nextRank: SkillRank,
  minutes: number,
  staminaCost: number,
): ActionContract['outcomes']['success'] {
  void minutes; // clock advance flows through timeCostMinutes exactly once
  return {
    achieved: true,
    publicSummary: `完成训练：${skillId} 晋升至 ${nextRank}。`,
    effects: [
      { op: 'consumeResource', actorId, resourceId: 'stamina', amount: staminaCost },
      { op: 'recordEvent', eventType: 'training', summary: `${actorId} 训练 ${skillId} 至 ${nextRank}` },
    ],
  };
}

function milestoneOutcome(actorId: string, skillId: string, points: number): ActionContract['outcomes']['success'] {
  return {
    achieved: true,
    publicSummary: `里程碑达成：${skillId} +${points} 练习点。`,
    effects: [
      { op: 'recordEvent', eventType: 'milestone', summary: `${actorId} 的 ${skillId} 获得里程碑 ${points} 点` },
    ],
  };
}

/**
 * V0.2 training-source policy (plan §8.4). Ordinary-tier skills are
 * self-trainable through deliberate practice — the engine still verifies the
 * card KNOWS the skill. Enhanced/supernatural tiers require a co-located
 * instructor whose rank strictly exceeds the trainee's.
 */
function trainingSourceSatisfied(
  skillId: string,
  definition: SkillDefinition | undefined,
  card: ActorCard,
  cards: readonly ActorCard[],
  actorState: { locationId: string },
  state: GameStateSnapshot,
): boolean {
  if (!definition || (definition.powerTier ?? 'ordinary') === 'ordinary') return true;
  const currentRank = card.skills[skillId] ?? 'untrained';
  const traineeGroup = (state.party ?? []).find(member => member.actorId === card.actorId)?.groupId ?? 'main';
  return cards.some(other => {
    if (other.actorId === card.actorId) return false;
    if (other.controller === 'gm') return false;
    const member = (state.party ?? []).find(item => item.actorId === other.actorId);
    if (!member || (member.groupId ?? 'main') !== traineeGroup) return false;
    const otherState = state.actors[other.actorId];
    if (!otherState || otherState.locationId !== actorState.locationId
      || otherState.lifeStatus === 'critical' || otherState.lifeStatus === 'dead'
      || otherState.conditions.includes('disabled')) return false;
    const otherRank = other.skills[skillId] ?? 'untrained';
    return SKILL_RANK_ORDER.indexOf(otherRank) > SKILL_RANK_ORDER.indexOf(currentRank);
  });
}

/** Filter package entries and nested scene references before constructing any
 * player or planner projection. A public scene must not reveal a private,
 * undiscovered, or not-yet-valid actor/item/clue by embedding its id. */
export function projectPlayerEntriesAtAnchor(
  allEntries: readonly ContentEntry[],
  facts: readonly import('../ports/worldStore').StoredFact[],
  worldTimeOrder: number | undefined,
  discoveredEntryIds: ReadonlySet<string>,
): ContentEntry[] {
  const visible = allEntries.filter(entry => (entry.visibility === 'public'
      || (entry.visibility === 'discoverable' && discoveredEntryIds.has(entry.entryId)))
    && isEntryVisibleAtAnchor(entry, facts, worldTimeOrder)
    && (entry.kind !== 'actor_template' || isTemplateValidAtAnchor(entry, worldTimeOrder)));
  const visibleById = new Map(visible.map(entry => [entry.entryId, entry]));
  return visible.map(entry => {
    if (entry.kind !== 'scene') return entry;
    const scene = entry.definition as SceneDefinition;
    const refs = (ids: readonly string[] | undefined, kind?: ContentEntry['kind']): string[] =>
      (ids ?? []).filter(id => {
        const target = visibleById.get(id);
        return Boolean(target && (kind === undefined || target.kind === kind));
      });
    return {
      ...entry,
      definition: {
        ...scene,
        actors: refs(scene.actors, 'actor_template'),
        visibleItems: refs(scene.visibleItems, 'item'),
        hazards: refs(scene.hazards),
        clues: refs(scene.clues),
      } satisfies SceneDefinition,
    };
  });
}

export interface SceneEncounterOption {
  sceneEntryId: string;
  sceneName: string;
  hostiles: Array<{ templateId: string; count: number }>;
  neutrals: Array<{ templateId: string; count: number }>;
}

/**
 * Read-only compatibility for worlds published before the r7 D3 correction.
 * Those exact partial-opening builds stored their four dossier facts with
 * revealAt=1. On a campaign with no canon anchor, the runtime uses time 0,
 * hiding the scene that was explicitly compiled as the opening. Re-expose
 * only the four versioned opening facts in the matching published partial
 * package; do not rewrite the immutable fact or package rows.
 */
function contractActorId(contract: ActionContract, cards: readonly ActorCard[]): string {
  // The acting card must exist; unknown ids never silently remap to the player.
  if (cards.some(card => card.actorId === contract.actorId)) return contract.actorId;
  throw new Error(`Contract actor ${contract.actorId} has no card in this campaign.`);
}

function emptySettlement(encounterId: string): TurnSettlementPlan {
  return { encounterId, skillUpserts: [], rewardLedger: [], relationships: [] };
}

async function deriveChallengeId(
  gameStore: SqliteGameStore,
  branchId: string,
  actorId: string,
  skillId: string,
): Promise<string> {
  const progress = await gameStore.getSkillProgress(branchId, actorId, skillId);
  return openChallengeId(branchId, actorId, skillId, progress);
}

/**
 * Builds the settlement plan for one committed turn: one practice point per
 * skill per independent encounter, ledger-enforced, applied in the same
 * transaction as the turn (plan §13.3). `closeChallenge` stamps the
 * challenge-closed marker so retried unachieved attempts cannot farm points
 * while a genuinely achieved pursuit opens the next challenge.
 */
export async function buildTurnSettlement(input: {
  gameStore: SqliteGameStore;
  branchId: string;
  turnId: string;
  encounterId: string;
  actorId: string;
  skillId?: string;
  outcomeGrade: string;
  stateVersion: number;
  closeChallenge?: boolean;
}): Promise<TurnSettlementPlan> {
  const plan: TurnSettlementPlan = {
    encounterId: input.encounterId,
    skillUpserts: [],
    rewardLedger: [],
    relationships: [],
  };
  if (!input.skillId) return plan;

  const existing = await input.gameStore.getSkillProgress(input.branchId, input.actorId, input.skillId);
  const progress: SkillProgress = existing ?? {
    skillId: input.skillId,
    rank: 'untrained',
    practicePoints: 0,
    awardedKeys: [],
  };
  const awarded = awardPractice(progress, input.encounterId, 'practice');
  const keys = [...awarded.awardedKeys];
  if (input.closeChallenge && !keys.includes(challengeClosedKey(input.encounterId))) {
    keys.push(challengeClosedKey(input.encounterId));
  }
  if (keys.length !== progress.awardedKeys.length || awarded !== progress) {
    plan.skillUpserts.push({
      actorId: input.actorId,
      skillId: input.skillId,
      rank: awarded.rank,
      practicePoints: awarded.practicePoints,
      awardedKeys: keys,
      stateVersion: input.stateVersion,
    });
  }
  if (awarded !== progress) {
    plan.rewardLedger.push({
      encounterId: input.encounterId,
      actorId: input.actorId,
      skillId: input.skillId,
      rewardKind: 'practice',
    });
  }
  return plan;
}

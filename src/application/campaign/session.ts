import { RejectionSamplingRandomSource } from '../../domain/rules/random';
import type { DifficultyBand, SkillRank } from '../../domain/rules/types';
import type { ActionContract } from '../../domain/turns/types';
import type { OpenAICompatibleProvider } from '../llm/openAICompatible';
import { runV2Turn } from '../game/v2Turn';
import { packageIndexes } from '../game/v2Compile';
import type { ApiProfile } from '../llm/types';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import type { RandomSource } from '../../domain/rules/random';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { SqliteDatabase, SqliteRow } from '../ports/sqlite';
import type { SqliteTurnStore } from '../../infra/sqlite/sqliteTurnStore';
import type { SqliteGameStore } from '../../infra/sqlite/sqliteGameStore';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import type { SqliteNarrativeStore } from '../../infra/sqlite/sqliteNarrativeStore';
import type { TurnSettlementPlan } from '../ports/turnStore';
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
  rollSpecForSkill,
  resolveSkillKey,
  SkillNotDefinedError,
  SkillNotTrainedError,
  type ActorCard,
  type SkillCatalog,
} from '../../domain/characters/card';
import type {
  AbilityDefinition,
  ContentEntry,
  LoreDefinition,
  ConstraintDefinition,
  SceneDefinition,
  SkillDefinition,
} from '../../domain/content/types';
import { assembleBook } from '../worldPackage/publish';
import { commitResolvedTurn } from '../turns/commitTurn';
import { forkBranch } from '../branch/fork';
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

  constructor(
    private readonly deps: SessionDeps,
    private readonly provider: OpenAICompatibleProvider,
    private readonly profile: ApiProfile,
  ) {
    this.encounters = new EncounterService(deps);
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
      'SELECT campaign_id, title, world_id, package_revision, ruleset_version, opening_json FROM campaigns WHERE campaign_id = ?',
      [campaignId],
    );
    if (!row) throw new Error(`Unknown campaign: ${campaignId}.`);
    const state = await this.deps.turns.getState(branchId);
    if (!state) throw new Error(`Branch has no state: ${branchId}.`);
    const cards = await this.listCards(branchId);
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
      goal: opening.goal ?? '',
      state,
      cards,
    };
  }

  async listCards(branchId: string): Promise<ActorCard[]> {
    const rows = await this.deps.db.queryAll<{ card_json: string }>(
      'SELECT card_json FROM actor_cards WHERE branch_id = ? ORDER BY actor_id',
      [branchId],
    );
    return rows.map(row => JSON.parse(row.card_json) as ActorCard);
  }

  async getCard(branchId: string, actorId: string): Promise<ActorCard> {
    const row = await this.deps.db.queryOne<{ card_json: string }>(
      'SELECT card_json FROM actor_cards WHERE branch_id = ? AND actor_id = ?',
      [branchId, actorId],
    );
    if (!row) throw new Error(`Actor card not found: ${branchId}/${actorId}.`);
    return JSON.parse(row.card_json) as ActorCard;
  }

  private async loadPackageEntries(
    worldId: string,
    packageRevision: number,
  ): Promise<ContentEntry[]> {
    const pkg = await this.deps.worldStore.getWorldPackage(worldId, packageRevision);
    if (!pkg) {
      throw new Error(
        `Locked world package is missing: ${worldId} r${packageRevision}. ` +
          'The campaign cannot continue without its dependency.',
      );
    }
    return pkg.entries;
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
  ): string {
    const parts: string[] = [];
    for (const entry of entries) {
      if (entry.kind === 'lore' && entry.visibility === 'public') {
        const lore = entry.definition as LoreDefinition;
        parts.push(`【世界】${lore.name}: ${lore.text}`);
      }
      if (entry.kind === 'constraint' && entry.visibility !== 'gm') {
        const constraint = entry.definition as ConstraintDefinition;
        parts.push(`【世界规则】${constraint.name}: ${constraint.description}`);
      }
    }
    for (const card of cards) {
      const actor = state.actors[card.actorId];
      if (!actor) continue;
      const resources = Object.entries(actor.resources)
        .map(([key, value]) => `${key}:${value}/${card.resourceMax[key] ?? '?'}`)
        .join(' ');
      const conditions = actor.conditions.length > 0 ? `，状态:${actor.conditions.join(',')}` : '';
      parts.push(`【角色】${card.actorId}(${card.name}) 位于 ${actor.locationId}，${resources}${conditions}`);
    }
    if (goal) parts.push(`【主目标】${goal}`);
    if (recentHistory && recentHistory.length > 0) {
      const recent = recentHistory.slice(-6).map(turn => {
        const story = (turn.narrativeText ?? turn.publicSummary ?? '').slice(0, 120);
        return `${turn.turnId}: ${story}`;
      });
      parts.push(`【最近的经历】\n${recent.join('\n')}`);
    }
    parts.push('使用队伍中存在的 actorId。只提出提案允许的动作（skill_check/ability/observe/talk/interact/move）；检定与数值由本地规则引擎编译。');
    return parts.join('\n');
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
  async playTurn(options: {
    campaignId: string;
    branchId: string;
    intent: string;
    encounterId?: string;
    /** Explicit replay target (recovery flows); defaults to head+1. */
    turnIdOverride?: string;
    onProgress?: (phase: 'planning' | 'rolling' | 'narrating' | 'committing') => void;
  }): Promise<PlayTurnResult> {
    const summary = await this.getSummary(options.campaignId, options.branchId);
    // Rule dispatch (plan §9 / G05): legacy V0.1 campaigns carry no package
    // lock; they stay readable but cannot play forward on V0.2 mechanics.
    if (summary.packageRevision < 1) {
      throw new Error(
        '这是一个旧版（V0.1）战役：它没有锁定世界包，无法用 V0.2 规则继续。' +
          '历史与存档保持可读；请从世界书架用当前三宝书重新开局。',
      );
    }
    const entries = await this.loadPackageEntries(summary.worldId, summary.packageRevision);
    const { catalog, abilities, scenes } = packageIndexes(entries);
    const playerCard = summary.cards.find(card => card.controller === 'player');
    if (!playerCard) throw new Error('Campaign has no player character card.');

    const stateVersion = options.turnIdOverride
      ? Number.parseInt(options.turnIdOverride.replace(/^turn-/, ''), 10)
      : summary.state.stateVersion + 1;
    const turnId = options.turnIdOverride ?? `turn-${String(stateVersion).padStart(4, '0')}`;
    const recentHistory = await this.deps.turns.listCommittedTurns(options.branchId);
    const worldContext = this.buildWorldContext(
      entries, summary.cards, summary.state, summary.goal, recentHistory,
    );

    let usageSeq = 0;
    const gameStore = this.deps.game;
    const actorId = playerCard.actorId;
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
        worldContext,
        hashProvider: this.deps.hashProvider,
        random: this.deps.random,
        actingCard: playerCard,
        cards: summary.cards,
        catalog,
        abilities,
        scenes,
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
      async settlementFor(grade, contract) {
        const actingActorId = contractActorId(contract, summary.cards);
        const actingCard = summary.cards.find(card => card.actorId === (actingActorId ?? actorId));
        const storedSkillKey = contract.skillId && actingCard
          ? (resolveSkillKey(actingCard, contract.skillId) ?? contract.skillId)
          : contract.skillId;
        // Practice only for risky checks; automatic actions never award.
        if (!contract.requiresRoll || !storedSkillKey) {
          return emptySettlement(options.encounterId ?? `auto-${options.branchId}-${turnId}`);
        }
        const challengeId = options.encounterId
          ?? await deriveChallengeId(gameStore, options.branchId, actingActorId ?? actorId, storedSkillKey);
        return buildTurnSettlement({
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
      },
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
    };
  }

  /** Deterministic rest (plan §12.5): short 30min stamina+2, long 8h full stamina + hp 2. */
  async rest(options: {
    campaignId: string;
    branchId: string;
    kind: 'short' | 'long';
  }): Promise<{ committed: boolean; clockSecondsAdvanced: number }> {
    const summary = await this.getSummary(options.campaignId, options.branchId);
    const playerCard = summary.cards.find(card => card.controller === 'player');
    if (!playerCard) throw new Error('Campaign has no player character card.');
    const actor = summary.state.actors[playerCard.actorId];
    if (!actor) throw new Error('Player actor is missing from state.');
    if (actor.conditions.includes('disabled')) {
      throw new Error('A disabled character cannot rest; resolve the encounter first.');
    }

    const minutes = options.kind === 'short' ? 30 : 8 * 60;
    const staminaMax = playerCard.resourceMax.stamina ?? 10;
    const staminaRestore = options.kind === 'short' ? Math.min(2, staminaMax) : staminaMax;
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
    await commitResolvedTurn({
      store: this.deps.turns,
      branchId: options.branchId,
      contract,
      contractHash: await this.deps.hashProvider.sha256Hex(`${turnId}:rest`),
      contractOrigin: 'engine',
      outcomeGrade: 'success',
      committedAt: new Date().toISOString(),
    });
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
    const summary = await this.getSummary(options.campaignId, options.branchId);
    const state = summary.state;
    const card = await this.getCard(options.branchId, options.actorId);
    const storedSkillKey = resolveSkillKey(card, options.skillId) ?? options.skillId;
    const progress = await this.deps.game.getSkillProgress(options.branchId, options.actorId, storedSkillKey);
    if (!progress) throw new Error(`No progress record for skill ${options.skillId}.`);

    const actorState = state.actors[options.actorId];
    if (!actorState) throw new Error(`Actor ${options.actorId} is missing from the branch state.`);
    if (actorState.conditions.includes('disabled')) {
      throw new Error('A disabled character cannot train; resolve the encounter first.');
    }

    // --- Real condition queries (never UI booleans) ---
    const entries = await this.loadPackageEntries(summary.worldId, summary.packageRevision);
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
    await commitResolvedTurn({
      store: this.deps.turns,
      branchId: options.branchId,
      contract,
      contractHash: await this.deps.hashProvider.sha256Hex(`${turnId}:train`),
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
  async getWorldSetup(worldId: string): Promise<{
    packageRevision: number | null;
    rulesetVersion: string;
    skills: Array<{ entryId: string; name: string; attribute: string; allowUntrained: boolean }>;
    lore: Array<{ name: string; text: string }>;
    anchorEvents: Array<{ eventId: string; title: string; summary: string; worldTimeOrder: number }>;
    locations: string[];
    canonCharacters: Array<{ entityId: string; name: string }>;
    companionTemplates: Array<{ entryId: string; name: string; description: string }>;
  }> {
    const revision = await this.deps.worldStore.getPublishedPackageRevision(worldId);
    if (revision === null) {
      return {
        packageRevision: null, rulesetVersion: '', skills: [], lore: [],
        anchorEvents: [], locations: [], canonCharacters: [], companionTemplates: [],
      };
    }
    const entries = await this.loadPackageEntries(worldId, revision);
    const skills = entries
      .filter(entry => entry.kind === 'skill')
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
      .filter(entry => entry.kind === 'lore' && entry.visibility !== 'gm')
      .map(entry => {
        const def = entry.definition as { name?: string; text?: string };
        return { name: def.name ?? entry.entryId, text: def.text ?? '' };
      });
    const scenes = entries
      .filter(entry => entry.kind === 'scene')
      .map(entry => entry.definition as SceneDefinition);
    // Locations come from package scene entries AND the novel's canon
    // location entities (the extractor always produces those) - a package
    // without scene entries still offers real novel places to start at
    // instead of blocking the opening wizard (G02).
    const canonLocations = (await this.deps.worldStore.listEntities(worldId))
      .filter(entity => entity.type === 'location')
      .map(entity => entity.name);
    const locations = [...new Set([...scenes.map(scene => scene.locationId), ...canonLocations])];
    const companionTemplates = entries
      .filter(entry => entry.kind === 'actor_template')
      .map(entry => {
        const def = entry.definition as { name?: string; description?: string };
        return {
          entryId: entry.entryId,
          name: def.name ?? entry.entryId,
          description: def.description ?? '',
        };
      });

    // Anchor candidates: canon events in world-time order (the opening must
    // pick a REAL point in the story, not a fixed placeholder), plus the
    // world's person entities as canon-protagonist candidates.
    const events = await this.deps.worldStore.listEvents(worldId);
    const anchorEvents = [...events]
      .filter(event => event.status === 'canon' && event.worldTimeOrder !== null)
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
      .slice(0, 60)
      .map(entity => ({ entityId: entity.entityId, name: entity.name }));

    const pkg = await this.deps.worldStore.getWorldPackage(worldId, revision);
    return {
      packageRevision: revision,
      rulesetVersion: pkg?.manifest.ruleset.version ?? '',
      skills,
      lore,
      anchorEvents,
      locations,
      canonCharacters,
      companionTemplates,
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

  getEncounterView(campaignId: string, branchId: string, encounterId: string): Promise<EncounterView> {
    return this.encounters.getView(campaignId, branchId, encounterId);
  }

  getActiveEncounter(campaignId: string, branchId: string): Promise<EncounterView | null> {
    return this.encounters.getActiveEncounter(campaignId, branchId);
  }

  encounterAttack(input: Parameters<EncounterService['playerAttack']>[0]): Promise<EncounterView> {
    return this.encounters.playerAttack(input);
  }

  encounterNpcTurn(input: Parameters<EncounterService['npcTurn']>[0]): Promise<EncounterView> {
    return this.encounters.npcTurn(input);
  }

  encounterMove(input: Parameters<EncounterService['playerMove']>[0]): Promise<EncounterView> {
    return this.encounters.playerMove(input);
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
  return cards.some(other => {
    if (other.actorId === card.actorId) return false;
    if (other.controller === 'gm') return false;
    const otherState = state.actors[other.actorId];
    if (!otherState || otherState.locationId !== actorState.locationId) return false;
    const otherRank = other.skills[skillId] ?? 'untrained';
    return SKILL_RANK_ORDER.indexOf(otherRank) > SKILL_RANK_ORDER.indexOf(currentRank);
  });
}

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

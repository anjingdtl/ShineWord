import { RejectionSamplingRandomSource } from '../../domain/rules/random';
import type { DifficultyBand, SkillRank } from '../../domain/rules/types';
import type { ActionContract } from '../../domain/turns/types';
import type { OpenAICompatibleProvider } from '../llm/openAICompatible';
import { runLlmTurn } from '../game/llmTurn';
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
  awardPractice,
  isTrainable,
  trainSkill,
  assertTrainingAllowed,
  applyMilestonePractice,
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
import type { ContentEntry, LoreDefinition, ConstraintDefinition } from '../../domain/content/types';
import { assembleBook } from '../worldPackage/publish';
import { commitResolvedTurn } from '../turns/commitTurn';
import { forkBranch } from '../branch/fork';

export interface SessionDeps {
  db: SqliteDatabase;
  turns: SqliteTurnStore;
  game: SqliteGameStore;
  worldStore: SqliteWorldStore;
  narratives: SqliteNarrativeStore;
  hashProvider: Sha256HexProvider;
  random: RandomSource;
}

export interface CampaignSummary {
  campaignId: string;
  branchId: string;
  title: string;
  worldId: string;
  packageRevision: number;
  goal: string;
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
  constructor(
    private readonly deps: SessionDeps,
    private readonly provider: OpenAICompatibleProvider,
    private readonly profile: ApiProfile,
  ) {}

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
      'SELECT campaign_id, title, world_id, package_revision, opening_json FROM campaigns WHERE campaign_id = ?',
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

  /** Player-visible world context compiled from the locked package (plan §13.1 step 3). */
  private buildWorldContext(
    entries: readonly ContentEntry[],
    cards: readonly ActorCard[],
    state: GameStateSnapshot,
    goal: string,
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
    const here = Object.values(state.actors)[0]?.locationId;
    if (here) parts.push(`【当前位置】${here}`);
    const party = cards
      .filter(card => card.controller !== 'gm')
      .map(card => `${card.actorId}(${card.name}, ${card.kind})`)
      .join(', ');
    if (party) parts.push(`【队伍】${party}`);
    if (goal) parts.push(`【主目标】${goal}`);
    parts.push('使用队伍中存在的 actorId。只提出合同允许的动作；检定由本地规则引擎执行。');
    return parts.join('\n');
  }

  /**
   * Plays one player intent through the V1 turn loop with card-driven
   * parameters and in-commit settlement. `encounterId` dedups practice per
   * independent challenge; the caller passes the active encounter id or
   * leaves it undefined for a stable per-turn challenge id.
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
    const entries = await this.loadPackageEntries(summary.worldId, summary.packageRevision);
    const catalog = this.skillCatalog(entries);
    const playerCard = summary.cards.find(card => card.controller === 'player');
    if (!playerCard) throw new Error('Campaign has no player character card.');

    const stateVersion = options.turnIdOverride
      ? Number.parseInt(options.turnIdOverride.replace(/^turn-/, ''), 10)
      : summary.state.stateVersion + 1;
    const turnId = options.turnIdOverride ?? `turn-${String(stateVersion).padStart(4, '0')}`;
    const encounterId = options.encounterId ?? `challenge-${options.branchId}-${turnId}`;
    const worldContext = this.buildWorldContext(entries, summary.cards, summary.state, summary.goal);

    let usageSeq = 0;
    const gameStore = this.deps.game;
    const actorId = playerCard.actorId;
    let result;
    try {
      result = await runLlmTurn({
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
      resolveRollSpec(contract: ActionContract) {
        // Card-driven: attributes and dice come from the character card and
        // the world skill catalog - never from fixed demo values.
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
        // Normalize the planner's short skill name onto the card's stored
        // key so practice lands on the same row the card rolls with.
        const actingCard = summary.cards.find(card => card.actorId === (actingActorId ?? actorId));
        const storedSkillKey = contract.skillId && actingCard
          ? (resolveSkillKey(actingCard, contract.skillId) ?? contract.skillId)
          : contract.skillId;
        return buildTurnSettlement({
          gameStore,
          branchId: options.branchId,
          turnId,
          encounterId,
          actorId: actingActorId ?? actorId,
          skillId: storedSkillKey,
          outcomeGrade: grade,
          stateVersion,
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
   * Explicit rank training (plan §8.4): reaching the threshold only makes a
   * skill trainable; advancement requires instructor/resources/prerequisites
   * and consumes the threshold here - atomically with an event.
   */
  async trainSkill(options: {
    campaignId: string;
    branchId: string;
    actorId: string;
    skillId: string;
    conditions: TrainingConditions;
  }): Promise<{ advanced: boolean; nextRank: SkillRank | null; pointsSpent: number }> {
    const summary = await this.getSummary(options.campaignId, options.branchId);
    const progress = await this.deps.game.getSkillProgress(options.branchId, options.actorId, options.skillId);
    if (!progress) throw new Error(`No progress record for skill ${options.skillId}.`);
    assertTrainingAllowed(options.conditions);
    if (!isTrainable(progress)) {
      throw new Error(
        `Skill ${options.skillId} has not reached its practice threshold yet ` +
          `(${progress.practicePoints} points).`,
      );
    }
    const result = trainSkill(progress, options.conditions);
    if (!result.advanced || !result.nextRank) {
      return { advanced: false, nextRank: null, pointsSpent: 0 };
    }
    const next: SkillProgress = {
      ...progress,
      rank: result.nextRank,
      practicePoints: result.pointsRemaining,
    };
    const state = await this.deps.turns.getState(options.branchId);
    await this.deps.game.upsertSkillProgress(
      options.branchId,
      options.actorId,
      next,
      (state?.stateVersion ?? 0) + 1,
    );
    // Update the card projection so the next roll uses the new rank.
    const card = await this.getCard(options.branchId, options.actorId);
    card.skills[options.skillId] = result.nextRank;
    await this.deps.db.execute(
      'UPDATE actor_cards SET card_json = ?, updated_at = ? WHERE branch_id = ? AND actor_id = ?',
      [JSON.stringify(card), new Date().toISOString(), options.branchId, options.actorId],
    );
    return { advanced: true, nextRank: result.nextRank, pointsSpent: result.pointsSpent };
  }

  /** Milestone: 1-2 practice points onto an unlocked skill (never ranks). */
  async grantMilestone(options: {
    campaignId: string;
    branchId: string;
    actorId: string;
    skillId: string;
    points: number;
    encounterId: string;
  }): Promise<{ granted: number }> {
    const progress = await this.deps.game.getSkillProgress(options.branchId, options.actorId, options.skillId);
    if (!progress) throw new Error(`No progress record for skill ${options.skillId}.`);
    const granted = applyMilestonePractice({
      skillId: options.skillId,
      currentRank: progress.rank,
      grantedPoints: options.points,
    });
    if (granted === 0) return { granted: 0 };
    const state = await this.deps.turns.getState(options.branchId);
    const next = awardPractice(progress, options.encounterId, 'milestone');
    await this.deps.game.upsertSkillProgress(
      options.branchId,
      options.actorId,
      { ...next, practicePoints: progress.practicePoints + granted },
      (state?.stateVersion ?? 0) + 1,
    );
    return { granted };
  }

  /**
   * Opening-wizard data for one world: its published package revision plus
   * the player-visible skill catalog and lore. Used before any campaign
   * exists; read-only over the immutable package.
   */
  async getWorldSetup(worldId: string): Promise<{
    packageRevision: number | null;
    skills: Array<{ entryId: string; name: string; attribute: string; allowUntrained: boolean }>;
    lore: Array<{ name: string; text: string }>;
  }> {
    const revision = await this.deps.worldStore.getPublishedPackageRevision(worldId);
    if (revision === null) {
      return { packageRevision: null, skills: [], lore: [] };
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
    return { packageRevision: revision, skills, lore };
  }

  /** Rewind = fork at an earlier snapshot + continue on the new branch. */
  async rewind(options: {
    campaignId: string;
    sourceBranchId: string;
    atStateVersion: number;
    newBranchId: string;
  }): Promise<{ branchId: string; stateVersion: number }> {
    const createdAt = new Date().toISOString();
    const forked = await forkBranch({
      db: this.deps.db,
      turnStore: this.deps.turns,
      gameStore: this.deps.game,
      sourceBranchId: options.sourceBranchId,
      targetBranchId: options.newBranchId,
      campaignId: options.campaignId,
      forkTurnId: null,
      atStateVersion: options.atStateVersion,
      createdAt,
    });
    // Copy cards into the new branch (cards are branch-scoped projections).
    const cards = await this.listCards(options.sourceBranchId);
    for (const card of cards) {
      await this.deps.db.execute(
        `INSERT OR IGNORE INTO actor_cards (branch_id, actor_id, card_json, created_at, updated_at, updated_state_version)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [options.newBranchId, card.actorId, JSON.stringify(card), createdAt, createdAt, forked.snapshot.stateVersion],
      );
      const member = await this.deps.db.queryOne(
        'SELECT actor_id FROM party_members WHERE branch_id = ? AND actor_id = ?',
        [options.sourceBranchId, card.actorId],
      );
      if (member) {
        await this.deps.db.execute(
          `INSERT OR IGNORE INTO party_members (branch_id, actor_id, controller, role, joined_at)
           SELECT ?, actor_id, controller, role, ? FROM party_members WHERE branch_id = ? AND actor_id = ?`,
          [options.newBranchId, createdAt, options.sourceBranchId, card.actorId],
        );
      }
    }
    return { branchId: options.newBranchId, stateVersion: forked.snapshot.stateVersion };
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

function contractActorId(contract: ActionContract, cards: readonly ActorCard[]): string {
  // The acting card must exist; unknown ids never silently remap to the player.
  if (cards.some(card => card.actorId === contract.actorId)) return contract.actorId;
  throw new Error(`Contract actor ${contract.actorId} has no card in this campaign.`);
}

/**
 * Builds the settlement plan for one committed turn: one practice point per
 * skill per independent encounter, ledger-enforced, applied in the same
 * transaction as the turn (plan §13.3).
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
  if (awarded !== progress) {
    plan.skillUpserts.push({
      actorId: input.actorId,
      skillId: input.skillId,
      rank: awarded.rank,
      practicePoints: awarded.practicePoints,
      awardedKeys: [...awarded.awardedKeys],
      stateVersion: input.stateVersion,
    });
    plan.rewardLedger.push({
      encounterId: input.encounterId,
      actorId: input.actorId,
      skillId: input.skillId,
      rewardKind: 'practice',
    });
  }
  return plan;
}

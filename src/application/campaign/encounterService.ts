import type { RollGrade, RollRecord } from '../../domain/rules/types';
import type { ActionContract } from '../../domain/turns/types';
import { cloneGameState, type EncounterSnapshotEntry, type GameStateSnapshot } from '../../domain/state/types';
import { applyEffects } from '../../domain/state/effects';
import type { SqliteRow } from '../ports/sqlite';
import type { SqliteTurnStore } from '../../infra/sqlite/sqliteTurnStore';
import type { SqliteGameStore } from '../../infra/sqlite/sqliteGameStore';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import type { SqliteNarrativeStore } from '../../infra/sqlite/sqliteNarrativeStore';
import type { SqliteDatabase } from '../ports/sqlite';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import type { RandomSource } from '../../domain/rules/random';
import type { ActorCard, SkillCatalog } from '../../domain/characters/card';
import { createTemplateCard, resolveSkillKey, rollSpecForSkill } from '../../domain/characters/card';
import type { ActorTemplateDefinition, ContentEntry, SceneDefinition } from '../../domain/content/types';
import {
  advanceInitiative,
  startEncounter,
  type EncounterState,
} from '../../domain/combat/encounter';
import { applyFateTransitions, type FateEvent } from '../../domain/combat/disabledFate';
import {
  compileAttack,
  buildEncounterRewards,
  decideNpcAction,
  explainNpcDecision,
  distanceBetweenZones,
  freezeInitiative,
  type Combatant,
} from './encounterFlow';
import { commitResolvedTurn } from '../turns/commitTurn';
import { resolveOrReuseRoll } from '../turns/resolveOrReuseRoll';
import { buildTurnSettlement } from './session';
import { packageIndexes } from '../game/v2Compile';

/**
 * Encounter scheduling (P2 acceptance G01): party + instantiated hostiles,
 * frozen initiative, zone moves, attacks with full local eligibility, NPC
 * deterministic turns, disable/rescue/retreat/end — all through the same
 * atomic commit machinery as story turns. No LLM call per mechanical action;
 * combat uses local result templates (plan §13.1 step 8). Zone assignments
 * persist inside the encounter envelope, so a killed process resumes the
 * exact battlefield.
 */

export interface EncounterDeps {
  db: SqliteDatabase;
  turns: SqliteTurnStore;
  game: SqliteGameStore;
  worldStore: SqliteWorldStore;
  narratives: SqliteNarrativeStore;
  hashProvider: Sha256HexProvider;
  random: RandomSource;
}

export interface ZoneNode {
  zoneId: string;
  exits: string[];
}

export interface EncounterActorView {
  actorId: string;
  name: string;
  side: 'party' | 'hostile' | 'neutral';
  hp: number;
  maxHp: number;
  zoneId: string;
  conditions: string[];
  isPlayer: boolean;
  actedThisRound: boolean;
  movedThisRound: boolean;
}

export interface EncounterView {
  encounterId: string;
  stateVersion: number;
  status: EncounterState['status'];
  round: number;
  currentActorId: string | null;
  currentActorIsPlayer: boolean;
  initiative: string[];
  pendingActorIds: string[];
  actors: EncounterActorView[];
  zones: ZoneNode[];
  exitIds: string[];
  lastAction: string | null;
  lastDice: string | null;
  /** Closeout C6: per-actor fate states selected by the scene contract. */
  fates: Record<string, import('../../domain/combat/disabledFate').DisabledFateState>;
  /** Ending id when the fate contract ended the campaign, else null. */
  endingTriggered: string | null;
}

/** Persisted alongside the encounter in distance_bands_json. */
interface EncounterEnvelope {
  bands: Record<string, string>;
  zones: Record<string, string>;
  sceneZones: ZoneNode[];
  exits: string[];
  scene?: EncounterState['scene'];
}

interface EncounterContext {
  campaignId: string;
  encounter: EncounterState;
  zones: ZoneNode[];
  exits: string[];
  zoneMap: Record<string, string>;
  cards: ActorCard[];
  entries: ContentEntry[];
  worldId: string;
  packageRevision: number;
  state: GameStateSnapshot;
}

interface ActionEconomy {
  consumeMainAction?: boolean;
  consumeMovement?: boolean;
  advanceActor?: boolean;
  moveActorTo?: string;
  endStatus?: EncounterState['status'];
  retreatActorId?: string;
}

export interface BeginEncounterInput {
  campaignId: string;
  branchId: string;
  encounterId?: string;
  requestId?: string;
  /** Hostile templates to instantiate, e.g. [{ templateId: 'guard', count: 2 }]. */
  hostiles: Array<{ templateId: string; count?: number }>;
  /** Optional neutral actors; they receive initiative but are not auto-targets. */
  neutrals?: Array<{ templateId: string; count?: number }>;
  /**
   * Closeout C6: disabled-fate contract for this scene. Stamp it at begin
   * time; it rides the encounter snapshot through clone/persist/rewind.
   */
  fateContract?: import('../../domain/combat/disabledFate').SceneFateContract;
}

const DEFAULT_ZONES: ZoneNode[] = [
  { zoneId: 'z-a', exits: ['z-b', 'withdraw'] },
  { zoneId: 'z-b', exits: ['z-a', 'withdraw'] },
];

export class EncounterService {
  constructor(private readonly deps: EncounterDeps) {}

  // ------------------------------------------------------------------ begin

  async begin(input: BeginEncounterInput): Promise<EncounterView> {
    const summary = await this.loadCampaign(input.campaignId, input.branchId);
    if (summary.packageRevision < 1) throw new Error('旧版战役无法进入遭遇。');
    const encounterId = input.encounterId ?? (input.requestId
      ? `enc-${input.branchId}-${safeRequestId(input.requestId)}`
      : `enc-${input.branchId}-${summary.state.stateVersion + 1}`);
    const existing = await this.deps.game.loadEncounter(input.branchId, encounterId);
    if (existing) return this.getView(input.campaignId, input.branchId, encounterId);
    const active = (summary.state.encounters ?? []).find(entry => entry.state.status === 'active');
    if (active) throw new Error(`当前已有活动遭遇：${active.state.encounterId}。`);
    const entries = await this.loadEntries(summary.worldId, summary.packageRevision);
    const templates = templateMap(entries);

    const state = summary.state;
    const createdAt = new Date().toISOString();
    const combatants: Combatant[] = [];
    const transientInserts: Array<{ actorId: string; card: ActorCard; side: 'hostile' | 'neutral' }> = [];

    for (const card of summary.cards) {
      if (card.controller === 'gm') continue;
      const actor = state.actors[card.actorId];
      if (!actor) continue;
      // Keep incapacitated party members in the participant record so allies
      // can rescue them. startEncounter skips their initiative slot until
      // they regain consciousness.
      combatants.push({
        actorId: card.actorId,
        card,
        side: 'party',
        zoneId: 'z-a',
        armor: 0,
        attackSkillIds: attackSkillsOf(card, templates, entries),
      });
    }
    if (combatants.length === 0) throw new Error('没有清醒的队伍成员可以参战。');

    let serial = 0;
    for (const request of input.hostiles) {
      const templateEntry = templates.get(request.templateId);
      if (!templateEntry) throw new Error(`未知的对手模板：${request.templateId}。`);
      const definition = templateEntry.definition as ActorTemplateDefinition;
      const count = Math.max(1, Math.min(6, request.count ?? 1));
      for (let i = 0; i < count; i += 1) {
        serial += 1;
        const actorId = `${request.templateId}-h${serial}`;
        const card = createTemplateCard({
          actorId,
          worldId: summary.worldId,
          worldPackageRevision: summary.packageRevision,
          templateId: request.templateId,
          definition,
          controller: 'gm',
          kind: definition.category === 'human' ? 'npc' : 'creature',
        });
        combatants.push({
          actorId,
          card,
          side: 'hostile',
          zoneId: 'z-b',
          armor: 0,
          attackSkillIds: attackSkillsOf(card, templates, entries),
        });
        transientInserts.push({ actorId, card, side: 'hostile' });
      }
    }

    let neutralSerial = 0;
    for (const request of input.neutrals ?? []) {
      const templateEntry = templates.get(request.templateId);
      if (!templateEntry) throw new Error(`未知的中立角色模板：${request.templateId}。`);
      const definition = templateEntry.definition as ActorTemplateDefinition;
      const count = Math.max(1, Math.min(6, request.count ?? 1));
      for (let i = 0; i < count; i += 1) {
        neutralSerial += 1;
        const actorId = `${request.templateId}-n${neutralSerial}`;
        const card = createTemplateCard({
          actorId,
          worldId: summary.worldId,
          worldPackageRevision: summary.packageRevision,
          templateId: request.templateId,
          definition,
          controller: 'gm',
          kind: definition.category === 'human' ? 'npc' : 'creature',
        });
        combatants.push({
          actorId,
          card,
          side: 'neutral',
          zoneId: 'z-b',
          armor: 0,
          attackSkillIds: attackSkillsOf(card, templates, entries),
        });
        transientInserts.push({ actorId, card, side: 'neutral' });
      }
    }

    if (combatants.length > 9) throw new Error('遭遇最多支持 9 名独立行动者。');

    const location = partyLocation(state, combatants);
    const scene = sceneForLocation(entries, location);
    const zones: ZoneNode[] = scene
      ? scene.zones.map(zone => ({ zoneId: zone.zoneId, exits: [...zone.exits] }))
      : DEFAULT_ZONES;
    const exitIds = scene ? sceneExitIds(zones) : ['withdraw'];
    const zoneMap: Record<string, string> = {};
    if (scene) {
      const partyZone = scene.zones[0]?.zoneId ?? 'z-a';
      const hostileZone = scene.zones[1]?.zoneId ?? partyZone;
      for (const combatant of combatants) {
        zoneMap[combatant.actorId] = combatant.side === 'party' ? partyZone : hostileZone;
      }
    } else {
      for (const combatant of combatants) {
        zoneMap[combatant.actorId] = combatant.side === 'party' ? 'z-a' : 'z-b';
      }
    }

    const encounter = startEncounter({
      encounterId,
      scene: {
        sceneId: scene?.locationId ?? 'improvised',
        coverSpotIds: scene?.zones.filter(zone => zone.cover).map(zone => zone.zoneId) ?? [],
        exitIds,
        ...(input.fateContract ? { fateContract: input.fateContract } : {}),
      },
      actors: combatants.map(combatant => ({
        actorId: combatant.actorId,
        side: combatant.side === 'party' ? 'player' : combatant.side === 'neutral' ? 'neutral' : 'npc',
        hp: state.actors[combatant.actorId]?.resources.hp ?? combatant.card.resourceMax.hp ?? 1,
        maxHp: combatant.card.resourceMax.hp ?? 1,
        stamina: state.actors[combatant.actorId]?.resources.stamina ?? combatant.card.resourceMax.stamina ?? 0,
        conditions: [...(state.actors[combatant.actorId]?.conditions ?? [])],
      })),
      initiative: freezeInitiative(combatants),
    }).state;

    const allCards = [...summary.cards, ...transientInserts.map(insert => insert.card)];
    const entry = makeEncounterSnapshot(encounter, zones, exitIds, zoneMap, createdAt, null);
    const turnId = requestTurnId(encounterId, input.requestId) ?? `enc:${encounterId}:begin`;
    const contract = engineActionContract({
      turnId,
      expectedStateVersion: state.stateVersion,
      actorId: combatants.find(actor => actor.side === 'party')!.actorId,
      actionType: 'encounter_begin',
      intent: `Begin encounter ${encounterId}`,
      eventType: 'encounter_started',
      summary: `遭遇 ${encounterId} 开始`,
    });
    const result = await commitResolvedTurn({
      store: this.deps.turns,
      branchId: input.branchId,
      contract,
      contractHash: await this.deps.hashProvider.sha256Hex(JSON.stringify(contract)),
      outcomeGrade: 'success',
      contractOrigin: 'engine',
      updateNextState: next => {
        for (const insert of transientInserts) {
          next.actors[insert.actorId] = {
            actorId: insert.actorId,
            locationId: location,
            zoneId: zoneMap[insert.actorId],
            resources: { ...insert.card.resourceMax },
            conditions: [],
          };
        }
        for (const [actorId, zoneId] of Object.entries(zoneMap)) {
          const actor = next.actors[actorId];
          if (actor) actor.zoneId = zoneId;
        }
        next.encounters = upsertEncounter(next.encounters ?? [], entry);
      },
      settlement: {
        encounterId,
        skillUpserts: [],
        rewardLedger: [],
        relationships: [],
        cardUpserts: transientInserts.map(insert => ({ actorId: insert.actorId, card: insert.card })),
      },
      committedAt: createdAt,
    });
    if (result.replayed) return this.getView(input.campaignId, input.branchId, encounterId);
    return this.buildView(encounter, zones, exitIds, zoneMap, null, null, allCards, state.stateVersion + 1);
  }

  /** Queue a party member arriving mid-encounter for the next round. */
  async queueParticipant(input: {
    campaignId: string;
    branchId: string;
    encounterId: string;
    actorId: string;
    requestId?: string;
  }): Promise<EncounterView> {
    const replay = await this.replayCommittedRequest(input.campaignId, input.branchId, input.encounterId, input.requestId);
    if (replay) return replay;
    const ctx = await this.context(input.campaignId, input.branchId, input.encounterId);
    if (ctx.encounter.status !== 'active') throw new Error('遭遇已经结束。');
    const card = ctx.cards.find(candidate => candidate.actorId === input.actorId);
    const actorState = ctx.state.actors[input.actorId];
    if (!card || card.controller === 'gm' || !actorState) throw new Error('加入者必须是本分支中已存在的队伍角色。');
    const membership = await this.deps.db.queryOne<{ actor_id: string }>(
      'SELECT actor_id FROM party_members WHERE branch_id = ? AND actor_id = ?',
      [input.branchId, input.actorId],
    );
    if (!membership) throw new Error('加入者尚未加入本分支队伍。');
    if (ctx.encounter.actors[input.actorId] || (ctx.encounter.pendingActorIds ?? []).includes(input.actorId)) {
      throw new Error('该角色已经参战或正在等待下一轮加入。');
    }
    if (Object.keys(ctx.encounter.actors).length + (ctx.encounter.pendingActorIds?.length ?? 0) >= 9) {
      throw new Error('遭遇最多支持 9 名独立行动者。');
    }
    const activeParty = Object.values(ctx.encounter.actors).find(actor => actor.side === 'player' && actor.hp > 0);
    const activePartyCard = activeParty ? ctx.cards.find(candidate => candidate.actorId === activeParty.actorId) : undefined;
    const currentLocation = activePartyCard ? ctx.state.actors[activePartyCard.actorId]?.locationId : undefined;
    if (currentLocation && actorState.locationId !== currentLocation) {
      throw new Error('加入者必须先到达当前遭遇地点。');
    }
    const partyZone = activeParty ? ctx.zoneMap[activeParty.actorId] : undefined;
    const actorZone = actorState.zoneId && ctx.zones.some(zone => zone.zoneId === actorState.zoneId)
      ? actorState.zoneId
      : partyZone ?? ctx.zones[0]?.zoneId ?? 'z-a';
    ctx.zoneMap[input.actorId] = actorZone;

    const turnId = requestTurnId(input.encounterId, input.requestId)
      ?? `enc:${input.encounterId}:join:${safeRequestId(input.actorId)}:${ctx.state.stateVersion}`;
    const contract = engineActionContract({
      turnId,
      expectedStateVersion: ctx.state.stateVersion,
      actorId: input.actorId,
      actionType: 'encounter_join_queue',
      intent: `${card.name} 加入正在进行的遭遇`,
      eventType: 'encounter_actor_join_queued',
      summary: `${card.name} 将在下一轮加入遭遇`,
    });
    const nextEncounter = cloneEncounter(ctx.encounter);
    nextEncounter.pendingActorIds = [...(nextEncounter.pendingActorIds ?? []), input.actorId];
    const existingEntry = (ctx.state.encounters ?? []).find(entry => entry.state.encounterId === input.encounterId);
    const now = new Date().toISOString();
    const entry = makeEncounterSnapshot(nextEncounter, ctx.zones, ctx.exits, ctx.zoneMap,
      existingEntry?.createdAt ?? now, null);
    await commitResolvedTurn({
      store: this.deps.turns,
      branchId: input.branchId,
      contract,
      contractHash: await this.deps.hashProvider.sha256Hex(JSON.stringify(contract)),
      outcomeGrade: 'success',
      contractOrigin: 'engine',
      committedAt: now,
      updateNextState: next => { next.encounters = upsertEncounter(next.encounters ?? [], entry); },
    });
    return this.getView(input.campaignId, input.branchId, input.encounterId);
  }

  // ------------------------------------------------------------- player turn

  /** Player attack with a legal attack skill against a target in range. */
  async playerAttack(input: {
    campaignId: string;
    branchId: string;
    encounterId: string;
    targetId: string;
    skillId?: string;
    requestId?: string;
  }): Promise<EncounterView> {
    const replay = await this.replayCommittedRequest(input.campaignId, input.branchId, input.encounterId, input.requestId);
    if (replay) return replay;
    const ctx = await this.context(input.campaignId, input.branchId, input.encounterId);
    if (ctx.encounter.status !== 'active') throw new Error('遭遇已经结束。');
    const { encounter, zoneMap, cards } = ctx;
    const currentActorId = currentActor(encounter);
    const actorCard = cards.find(card => card.actorId === currentActorId);
    if (!actorCard || actorCard.controller !== 'player') {
      throw new Error('当前行动者由自动策略控制；请先推进自动行动。');
    }
    const templates = templateMap(ctx.entries);
    const catalog = packageIndexes(ctx.entries).catalog;
    const attacker = combatantFor(currentActorId, encounter, cards, zoneMap, templates, ctx.entries);
    const target = combatantFor(input.targetId, encounter, cards, zoneMap, templates, ctx.entries);
    const skillId = input.skillId ?? bestAttackSkill(actorCard, attacker, catalog);
    if (!skillId) throw new Error(`${actorCard.name} 没有可用于攻击的技能。`);

    const { contract } = compileAttack({
      attacker,
      target,
      skillId,
      catalog,
      difficultyBand: 'normal',
      state: ctx.state,
      encounter,
      encounterId: input.encounterId,
      actionSeq: ctx.state.stateVersion,
      stateVersion: ctx.state.stateVersion,
      zones: ctx.zones,
      attackRange: attackRangeOf(attacker, skillId, templates),
    });
    contract.turnId = requestTurnId(input.encounterId, input.requestId) ?? contract.turnId;
    const rollRecord = await this.stageAndRoll(input.branchId, contract, actorCard, catalog, skillId);
    const settlement = await buildTurnSettlement({
      gameStore: this.deps.game,
      branchId: input.branchId,
      turnId: contract.turnId,
      encounterId: input.encounterId,
      actorId: currentActorId,
      skillId: resolveSkillKey(actorCard, skillId) ?? skillId,
      outcomeGrade: rollRecord.grade,
      stateVersion: ctx.state.stateVersion + 1,
    });
    const result = await this.applyAction(input.branchId, ctx, contract, rollRecord, settlement, {
      consumeMainAction: true,
      advanceActor: true,
    });
    return this.buildView(
      result.encounter, result.zones, result.exits, result.zoneMap,
      `${actorCard.name} 攻击 ${target.card.name}：${rollRecord.grade}`,
      diceText(rollRecord), result.cards, result.stateVersion,
    );
  }

  /**
   * Runs the CURRENT actor when it is NPC-controlled: deterministic policy —
   * attack the weakest enemy in range with a declared attack skill, close
   * distance, or retreat through a real exit. No LLM call.
   */
  async npcTurn(input: {
    campaignId: string;
    branchId: string;
    encounterId: string;
    requestId?: string;
  }): Promise<EncounterView> {
    const replay = await this.replayCommittedRequest(input.campaignId, input.branchId, input.encounterId, input.requestId);
    if (replay) return replay;
    const ctx = await this.context(input.campaignId, input.branchId, input.encounterId);
    if (ctx.encounter.status !== 'active') throw new Error('遭遇已经结束。');
    const { encounter, cards, zoneMap } = ctx;
    const currentActorId = currentActor(encounter);
    const actorCard = cards.find(card => card.actorId === currentActorId);
    if (!actorCard || actorCard.controller === 'player') {
      throw new Error('当前行动者由玩家控制；请由玩家选择行动。');
    }
    const templates = templateMap(ctx.entries);
    const catalog = packageIndexes(ctx.entries).catalog;
    const combatants = allCombatants(encounter, cards, zoneMap, templates, ctx.entries);
    const npcActor = combatantFor(currentActorId, encounter, cards, zoneMap, templates, ctx.entries);
    const decision = decideNpcAction({
      actor: npcActor,
      encounter,
      combatants,
      catalog,
      zones: ctx.zones,
    });
    const decisionBasis = explainNpcDecision({
      actor: npcActor,
      encounter,
      combatants,
      zones: ctx.zones,
      decision,
    });

    if (decision.kind === 'retreat') {
      const contract = engineActionContract({
        turnId: requestTurnId(input.encounterId, input.requestId) ?? `enc:${input.encounterId}:${currentActorId}:retreat:${ctx.state.stateVersion}`,
        expectedStateVersion: ctx.state.stateVersion,
        actorId: currentActorId,
        actionType: 'retreat',
        intent: `${actorCard.name} 撤离战斗。依据：${decisionBasis}`,
        eventType: 'encounter_actor_retreat',
        summary: `${actorCard.name} 撤离战斗。依据：${decisionBasis}`,
      });
      const result = await this.applyAction(input.branchId, ctx, contract, null, undefined, {
        consumeMainAction: true,
        advanceActor: true,
        retreatActorId: currentActorId,
      });
      return this.buildView(result.encounter, result.zones, result.exits, result.zoneMap,
        `${actorCard.name} 撤离了战斗。依据：${decisionBasis}`, null, result.cards, result.stateVersion);
    }
    if (decision.kind === 'guard') {
      const contract = engineActionContract({
        turnId: requestTurnId(input.encounterId, input.requestId) ?? `enc:${input.encounterId}:${currentActorId}:guard:${ctx.state.stateVersion}`,
        expectedStateVersion: ctx.state.stateVersion,
        actorId: currentActorId,
        actionType: 'guard',
        intent: `${actorCard.name} 保持戒备。依据：${decisionBasis}`,
        eventType: 'combat_action_passed',
        summary: `${actorCard.name} 依据当前策略保持戒备并结束行动。${decisionBasis}`,
      });
      const result = await this.applyAction(input.branchId, ctx, contract, null, undefined, {
        consumeMainAction: true,
        advanceActor: true,
      });
      return this.buildView(result.encounter, result.zones, result.exits, result.zoneMap,
        `${actorCard.name} 保持戒备，结束本回合。依据：${decisionBasis}`, null, result.cards, result.stateVersion);
    }
    if (decision.kind === 'rescue') {
      const targetCard = cards.find(card => card.actorId === decision.targetId);
      const target = encounter.actors[decision.targetId];
      if (!targetCard || !target || !target.conditions.includes('disabled')
        || zoneMap[decision.targetId] !== zoneMap[currentActorId]) {
        throw new Error('同伴支援目标已不满足援救条件。');
      }
      const contract: ActionContract = {
        protocolVersion: '1.0',
        turnId: requestTurnId(input.encounterId, input.requestId)
          ?? `enc:${input.encounterId}:${currentActorId}:rescue:${ctx.state.stateVersion}`,
        expectedStateVersion: ctx.state.stateVersion,
        actorId: currentActorId,
        actionType: 'rescue',
        targetId: decision.targetId,
        evidenceIds: [`encounter:${input.encounterId}`],
        requiresRoll: false,
        intent: `援救 ${targetCard.name}。依据：${decisionBasis}`,
        timeCostMinutes: 0,
        resourcePreconditions: [],
        outcomes: {
          full_success: rescueOutcome(decision.targetId, targetCard.resourceMax.hp ?? 10),
          success: rescueOutcome(decision.targetId, targetCard.resourceMax.hp ?? 10),
          failure: rescueOutcome(decision.targetId, targetCard.resourceMax.hp ?? 10),
          severe_failure: rescueOutcome(decision.targetId, targetCard.resourceMax.hp ?? 10),
        },
      };
      const result = await this.applyAction(input.branchId, ctx, contract, null, undefined, {
        consumeMainAction: true,
        advanceActor: true,
      });
      return this.buildView(result.encounter, result.zones, result.exits, result.zoneMap,
        `${actorCard.name} 支援并救回了 ${targetCard.name}。依据：${decisionBasis}`, null, result.cards, result.stateVersion);
    }
    if (decision.kind === 'move') {
      const mover = combatantFor(currentActorId, encounter, cards, zoneMap, templates, ctx.entries);
      const toward = combatantFor(decision.towardActorId, encounter, cards, zoneMap, templates, ctx.entries);
      const nextZone = stepToward(ctx.zones, mover.zoneId, toward.zoneId);
      const alreadyMoved = encounter.actors[currentActorId]?.movedThisRound === true;
      if (alreadyMoved || nextZone === mover.zoneId) {
        const contract = engineActionContract({
          turnId: requestTurnId(input.encounterId, input.requestId) ?? `enc:${input.encounterId}:${currentActorId}:pass:${ctx.state.stateVersion}`,
          expectedStateVersion: ctx.state.stateVersion,
          actorId: currentActorId,
          actionType: 'guard',
          intent: `${actorCard.name} 保持戒备。依据：${decisionBasis}`,
          eventType: 'combat_action_passed',
          summary: `${actorCard.name} 无可用移动，保持戒备。${decisionBasis}`,
        });
        const result = await this.applyAction(input.branchId, ctx, contract, null, undefined, {
          consumeMainAction: true,
          advanceActor: true,
        });
        return this.buildView(result.encounter, result.zones, result.exits, result.zoneMap,
          `${actorCard.name} 保持戒备，结束本回合。依据：${decisionBasis}`, null, result.cards, result.stateVersion);
      }
      const contract = engineActionContract({
        turnId: requestTurnId(input.encounterId, input.requestId) ?? `enc:${input.encounterId}:${currentActorId}:move:${ctx.state.stateVersion}`,
        expectedStateVersion: ctx.state.stateVersion,
        actorId: currentActorId,
        actionType: 'move',
        intent: `${actorCard.name} 向 ${toward.card.name} 逼近。依据：${decisionBasis}`,
        eventType: 'combat_moved',
        summary: `${actorCard.name} 移动到 ${nextZone}。${decisionBasis}`,
      });
      const result = await this.applyAction(input.branchId, ctx, contract, null, undefined, {
        consumeMovement: true,
        moveActorTo: nextZone,
      });
      return this.buildView(result.encounter, result.zones, result.exits, result.zoneMap,
        `${actorCard.name} 向 ${toward.card.name} 逼近。依据：${decisionBasis}`, null, result.cards, result.stateVersion);
    }

    const attacker = combatantFor(currentActorId, encounter, cards, zoneMap, templates, ctx.entries);
    const target = combatantFor(decision.targetId, encounter, cards, zoneMap, templates, ctx.entries);
    const skillId = decision.skillId;
    const { contract } = compileAttack({
      attacker,
      target,
      skillId,
      catalog,
      difficultyBand: 'normal',
      state: ctx.state,
      encounter,
      encounterId: input.encounterId,
      actionSeq: ctx.state.stateVersion,
      stateVersion: ctx.state.stateVersion,
      zones: ctx.zones,
      attackRange: attackRangeOf(attacker, skillId, templates),
    });
    contract.intent = `${contract.intent}。依据：${decisionBasis}`;
    contract.outcomes.full_success.publicSummary += `。${decisionBasis}`;
    contract.outcomes.success.publicSummary += `。${decisionBasis}`;
    contract.outcomes.failure.publicSummary += `。${decisionBasis}`;
    contract.outcomes.severe_failure.publicSummary += `。${decisionBasis}`;
    contract.turnId = requestTurnId(input.encounterId, input.requestId) ?? contract.turnId;
    const rollRecord = await this.stageAndRoll(input.branchId, contract, attacker.card, catalog, skillId);
    const settlement = actorCard.controller === 'companion'
      ? await buildTurnSettlement({
          gameStore: this.deps.game,
          branchId: input.branchId,
          turnId: contract.turnId,
          encounterId: input.encounterId,
          actorId: currentActorId,
          skillId: resolveSkillKey(actorCard, skillId) ?? skillId,
          outcomeGrade: rollRecord.grade,
          stateVersion: ctx.state.stateVersion + 1,
        })
      : undefined;
    const result = await this.applyAction(input.branchId, ctx, contract, rollRecord, settlement, {
      consumeMainAction: true,
      advanceActor: true,
    });
    return this.buildView(
      result.encounter, result.zones, result.exits, result.zoneMap,
      `${attacker.card.name} 攻击 ${target.card.name}：${rollRecord.grade}。依据：${decisionBasis}`,
      diceText(rollRecord), result.cards, result.stateVersion,
    );
  }

  /** Player standard move to an ADJACENT zone (does not burn the main action). */
  async playerMove(input: {
    campaignId: string;
    branchId: string;
    encounterId: string;
    toZoneId: string;
    actorId?: string;
    requestId?: string;
  }): Promise<EncounterView> {
    const replay = await this.replayCommittedRequest(input.campaignId, input.branchId, input.encounterId, input.requestId);
    if (replay) return replay;
    const ctx = await this.context(input.campaignId, input.branchId, input.encounterId);
    if (ctx.encounter.status !== 'active') throw new Error('遭遇已经结束。');
    const currentActorId = currentActor(ctx.encounter);
    const actorId = input.actorId ?? currentActorId;
    const actorCard = ctx.cards.find(card => card.actorId === actorId);
    if (!actorId || !actorCard || actorCard.controller !== 'player') {
      throw new Error('移动目标必须由玩家控制。');
    }
    const actor = ctx.encounter.actors[actorId];
    if (!actor || actor.hp <= 0 || actor.conditions.includes('disabled')) throw new Error('失能角色不能移动。');
    if (actorId !== currentActorId && !actor.actedThisRound) {
      throw new Error('只有本轮已经行动的角色可以在主要行动后补用标准移动。');
    }
    if (actor.movedThisRound) throw new Error('本轮的标准移动已经用尽。');
    const fromZone = ctx.zoneMap[actorId] ?? 'z-a';
    const band = distanceBetweenZones(ctx.zones, fromZone, input.toZoneId);
    if (band !== 'mid') throw new Error('标准移动只能进入相邻区域。');
    const contract = engineActionContract({
      turnId: requestTurnId(input.encounterId, input.requestId) ?? `enc:${input.encounterId}:${actorId}:move:${ctx.state.stateVersion}`,
      expectedStateVersion: ctx.state.stateVersion,
      actorId,
      actionType: 'move',
      intent: `${actorCard.name} 移动到 ${input.toZoneId}`,
      eventType: 'combat_moved',
      summary: `${actorCard.name} 移动到 ${input.toZoneId}`,
    });
    const result = await this.applyAction(input.branchId, ctx, contract, null, undefined, {
      consumeMovement: true,
      moveActorTo: input.toZoneId,
    });
    return this.buildView(result.encounter, result.zones, result.exits, result.zoneMap,
      `${actorCard.name} 移动到 ${input.toZoneId}。`, null, result.cards, result.stateVersion);
  }

  /** Dash is a major action that moves one additional adjacent zone. */
  async playerDash(input: {
    campaignId: string;
    branchId: string;
    encounterId: string;
    toZoneId: string;
    requestId?: string;
  }): Promise<EncounterView> {
    const replay = await this.replayCommittedRequest(input.campaignId, input.branchId, input.encounterId, input.requestId);
    if (replay) return replay;
    const ctx = await this.context(input.campaignId, input.branchId, input.encounterId);
    if (ctx.encounter.status !== 'active') throw new Error('遭遇已经结束。');
    const actorId = currentActor(ctx.encounter);
    if (!actorCanRetreat(ctx.zones, ctx.zoneMap[actorId], ctx.exits)) {
      throw new Error('当前区域没有可用的撤离出口。');
    }
    const actorCard = ctx.cards.find(card => card.actorId === actorId);
    const actor = ctx.encounter.actors[actorId];
    if (!actorCard || actorCard.controller !== 'player') throw new Error('当前行动者必须由玩家控制才能疾行。');
    if (!actor || actor.hp <= 0 || actor.conditions.includes('disabled')) throw new Error('失能角色不能疾行。');
    if (actor.actedThisRound) throw new Error('本回合的主要行动已用尽，不能疾行。');
    const fromZone = ctx.zoneMap[actorId] ?? 'z-a';
    if (distanceBetweenZones(ctx.zones, fromZone, input.toZoneId) !== 'mid') {
      throw new Error('疾行只能再进入一个相邻区域。');
    }
    const contract = engineActionContract({
      turnId: requestTurnId(input.encounterId, input.requestId) ?? `enc:${input.encounterId}:${actorId}:dash:${ctx.state.stateVersion}`,
      expectedStateVersion: ctx.state.stateVersion,
      actorId,
      actionType: 'dash',
      intent: `${actorCard.name} 疾行到 ${input.toZoneId}`,
      eventType: 'combat_dashed',
      summary: `${actorCard.name} 支付主要行动疾行到 ${input.toZoneId}`,
    });
    const result = await this.applyAction(input.branchId, ctx, contract, null, undefined, {
      consumeMainAction: true,
      advanceActor: true,
      moveActorTo: input.toZoneId,
    });
    return this.buildView(result.encounter, result.zones, result.exits, result.zoneMap,
      `${actorCard.name} 疾行到 ${input.toZoneId}，消耗了主要行动。`, null, result.cards, result.stateVersion);
  }

  /** Rescue a disabled ALLY in the same zone: restores 1 hp (plan §12.4). */
  async rescueAlly(input: {
    campaignId: string;
    branchId: string;
    encounterId: string;
    targetId: string;
    requestId?: string;
  }): Promise<EncounterView> {
    const replay = await this.replayCommittedRequest(input.campaignId, input.branchId, input.encounterId, input.requestId);
    if (replay) return replay;
    const ctx = await this.context(input.campaignId, input.branchId, input.encounterId);
    if (ctx.encounter.status !== 'active') throw new Error('遭遇已经结束。');
    const currentActorId = currentActor(ctx.encounter);
    const actorCard = ctx.cards.find(card => card.actorId === currentActorId);
    if (!currentActorId || !actorCard || actorCard.controller !== 'player') {
      throw new Error('当前行动者不是玩家方角色。');
    }
    if (ctx.encounter.actors[currentActorId]?.actedThisRound) {
      throw new Error('本回合的主要行动已用尽。');
    }
    const targetCard = ctx.cards.find(card => card.actorId === input.targetId);
    if (!targetCard || targetCard.controller === 'gm') throw new Error('援救目标必须是队伍成员。');
    const target = ctx.encounter.actors[input.targetId];
    if (!target || !target.conditions.includes('disabled')) throw new Error('目标并未失能。');
    if ((ctx.zoneMap[currentActorId] ?? '') !== (ctx.zoneMap[input.targetId] ?? '')) {
      throw new Error('援救需要与失能同伴处于同一区域。');
    }

    const turnId = requestTurnId(input.encounterId, input.requestId) ?? `enc:${input.encounterId}:${currentActorId}:rescue:${ctx.state.stateVersion}`;
    const hpCap = targetCard.resourceMax.hp ?? 10;
    const contract: ActionContract = {
      protocolVersion: '1.0',
      turnId,
      expectedStateVersion: ctx.state.stateVersion,
      actorId: currentActorId,
      actionType: 'rescue',
      targetId: input.targetId,
      evidenceIds: [`encounter:${input.encounterId}`],
      requiresRoll: false,
      intent: `援救 ${targetCard.name}`,
      timeCostMinutes: 0,
      resourcePreconditions: [],
      outcomes: {
        full_success: rescueOutcome(input.targetId, hpCap),
        success: rescueOutcome(input.targetId, hpCap),
        failure: rescueOutcome(input.targetId, hpCap),
        severe_failure: rescueOutcome(input.targetId, hpCap),
      },
    };
    const result = await this.applyAction(
      input.branchId, ctx, contract, null, undefined,
      { consumeMainAction: true, advanceActor: true },
    );
    return this.buildView(result.encounter, result.zones, result.exits, result.zoneMap,
      `${actorCard.name} 援救了 ${targetCard.name}（恢复意识）。`, null, result.cards, result.stateVersion);
  }

  /**
   * Pass the current player-side main action (guard/observe): consumes the
   * action economy and advances initiative. A character with no usable
   * attack must still be able to yield its slot instead of deadlocking
   * the round.
   */
  async passTurn(input: {
    campaignId: string;
    branchId: string;
    encounterId: string;
    requestId?: string;
  }): Promise<EncounterView> {
    const replay = await this.replayCommittedRequest(input.campaignId, input.branchId, input.encounterId, input.requestId);
    if (replay) return replay;
    const ctx = await this.context(input.campaignId, input.branchId, input.encounterId);
    if (ctx.encounter.status !== 'active') throw new Error('遭遇已经结束。');
    const currentActorId = currentActor(ctx.encounter);
    const actorCard = ctx.cards.find(card => card.actorId === currentActorId);
    if (!actorCard || actorCard.controller !== 'player') {
      throw new Error('当前行动者不是玩家方角色。');
    }
    const actor = ctx.encounter.actors[currentActorId];
    if (!actor || actor.hp <= 0 || actor.conditions.includes('disabled')) throw new Error('失能角色不能跳过行动。');
    if (actor.actedThisRound) throw new Error('本回合的主要行动已用尽。');
    const contract = engineActionContract({
      turnId: requestTurnId(input.encounterId, input.requestId) ?? `enc:${input.encounterId}:${currentActorId}:pass:${ctx.state.stateVersion}`,
      expectedStateVersion: ctx.state.stateVersion,
      actorId: currentActorId,
      actionType: 'guard',
      intent: `${actorCard.name} 保持戒备`,
      eventType: 'combat_action_passed',
      summary: `${actorCard.name} 保持戒备并让出本次主要行动`,
    });
    const result = await this.applyAction(input.branchId, ctx, contract, null, undefined, {
      consumeMainAction: true,
      advanceActor: true,
    });
    return this.buildView(result.encounter, result.zones, result.exits, result.zoneMap,
      `${actorCard.name} 保持戒备，让出了行动机会。`, null, result.cards, result.stateVersion);
  }

  /** Player retreat through a scene exit: the encounter ends as escaped. */
  async retreat(input: {
    campaignId: string;
    branchId: string;
    encounterId: string;
    requestId?: string;
  }): Promise<EncounterView> {
    const replay = await this.replayCommittedRequest(input.campaignId, input.branchId, input.encounterId, input.requestId);
    if (replay) return replay;
    const ctx = await this.context(input.campaignId, input.branchId, input.encounterId);
    if (ctx.encounter.status !== 'active') throw new Error('遭遇已经结束。');
    const actorId = currentActor(ctx.encounter);
    const contract = engineActionContract({
      turnId: requestTurnId(input.encounterId, input.requestId) ?? `enc:${input.encounterId}:retreat:${ctx.state.stateVersion}`,
      expectedStateVersion: ctx.state.stateVersion,
      actorId,
      actionType: 'retreat',
      intent: '队伍撤离战斗',
      eventType: 'encounter_retreated',
      summary: '队伍撤离战斗',
    });
    const result = await this.applyAction(input.branchId, ctx, contract, null, undefined, {
      endStatus: 'escaped',
    });
    return this.buildView(result.encounter, result.zones, result.exits, result.zoneMap,
      '队伍撤离了战斗。', null, result.cards, result.stateVersion);
  }

  /** Loads the current encounter view without acting. */
  async getView(campaignId: string, branchId: string, encounterId: string): Promise<EncounterView> {
    const ctx = await this.context(campaignId, branchId, encounterId);
    return this.buildView(ctx.encounter, ctx.zones, ctx.exits, ctx.zoneMap, null, null, ctx.cards, ctx.state.stateVersion);
  }

  /** The branch's ACTIVE encounter, if any (kill-process recovery for the UI). */
  async getActiveEncounter(campaignId: string, branchId: string): Promise<EncounterView | null> {
    const row = await this.deps.db.queryOne<{ encounter_id: string }>(
      "SELECT encounter_id FROM encounters WHERE branch_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
      [branchId],
    );
    if (!row) return null;
    return this.getView(campaignId, branchId, row.encounter_id);
  }

  private async replayCommittedRequest(
    campaignId: string,
    branchId: string,
    encounterId: string,
    requestId: string | undefined,
  ): Promise<EncounterView | null> {
    const turnId = requestTurnId(encounterId, requestId);
    if (!turnId) return null;
    const committed = await this.deps.turns.getCommittedTurn(branchId, turnId);
    return committed ? this.getView(campaignId, branchId, encounterId) : null;
  }

  // ----------------------------------------------------------------- helpers

  private async loadCampaign(campaignId: string, branchId: string) {
    const row = await this.deps.db.queryOne<SqliteRow>(
      `SELECT c.world_id, c.package_revision
         FROM campaigns c
         JOIN branches b ON b.campaign_id = c.campaign_id
        WHERE c.campaign_id = ? AND b.branch_id = ?`,
      [campaignId, branchId],
    );
    if (!row) throw new Error(`Branch ${branchId} does not belong to campaign ${campaignId}.`);
    const state = await this.deps.turns.getState(branchId);
    if (!state) throw new Error(`Branch has no state: ${branchId}.`);
    return {
      worldId: String(row.world_id),
      packageRevision: row.package_revision === null || row.package_revision === undefined ? 0 : Number(row.package_revision),
      state,
      cards: await this.listCards(branchId),
    };
  }

  private async listCards(branchId: string): Promise<ActorCard[]> {
    const rows = await this.deps.db.queryAll<{ card_json: string }>(
      'SELECT card_json FROM actor_cards WHERE branch_id = ? ORDER BY actor_id',
      [branchId],
    );
    return rows.map(row => JSON.parse(row.card_json) as ActorCard);
  }

  private async loadEntries(worldId: string, packageRevision: number): Promise<ContentEntry[]> {
    const pkg = await this.deps.worldStore.getWorldPackage(worldId, packageRevision);
    if (!pkg) throw new Error(`Locked world package is missing: ${worldId} r${packageRevision}.`);
    return pkg.entries;
  }

  private async context(
    campaignId: string,
    branchId: string,
    encounterId: string,
  ): Promise<EncounterContext> {
    const summary = await this.loadCampaign(campaignId, branchId);
    const encounter = await this.deps.game.loadEncounter(branchId, encounterId);
    if (!encounter) throw new Error(`Unknown encounter: ${encounterId}.`);
    const envelope = await this.loadEnvelope(branchId, encounterId);
    const entries = await this.loadEntries(summary.worldId, summary.packageRevision);
    return {
      campaignId,
      encounter,
      zones: envelope.sceneZones.length > 0 ? envelope.sceneZones : DEFAULT_ZONES,
      exits: envelope.exits,
      zoneMap: envelope.zones,
      cards: summary.cards,
      entries,
      worldId: summary.worldId,
      packageRevision: summary.packageRevision,
      state: summary.state,
    };
  }

  private async loadEnvelope(branchId: string, encounterId: string): Promise<EncounterEnvelope> {
    const row = await this.deps.db.queryOne<{ distance_bands_json: string }>(
      'SELECT distance_bands_json FROM encounters WHERE branch_id = ? AND encounter_id = ?',
      [branchId, encounterId],
    );
    if (!row) throw new Error(`Unknown encounter: ${encounterId}.`);
    const parsed = JSON.parse(row.distance_bands_json) as Record<string, unknown>;
    if (parsed.bands !== undefined && typeof parsed.bands === 'object') {
      return {
        bands: (parsed.bands as Record<string, string>) ?? {},
        zones: (parsed.zones as Record<string, string>) ?? {},
        sceneZones: (parsed.sceneZones as ZoneNode[]) ?? [],
        exits: Array.isArray(parsed.exits)
          ? parsed.exits.filter((exit): exit is string => typeof exit === 'string')
          : (parsed.scene && typeof parsed.scene === 'object'
            ? (parsed.scene as EncounterState['scene']).exitIds
            : ['withdraw']),
        scene: parsed.scene && typeof parsed.scene === 'object' ? parsed.scene as EncounterState['scene'] : undefined,
      };
    }
    const bands: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') bands[key] = value;
    }
    return { bands, zones: {}, sceneZones: [], exits: [] };
  }

  private async stageAndRoll(
    branchId: string,
    contract: ActionContract,
    card: ActorCard,
    catalog: SkillCatalog,
    skillId: string,
  ): Promise<RollRecord> {
    const contractHash = await this.deps.hashProvider.sha256Hex(JSON.stringify(contract));
    await this.deps.turns.stageRollTurn({
      branchId,
      turnId: contract.turnId,
      expectedStateVersion: contract.expectedStateVersion,
      actionContractJson: JSON.stringify(contract),
      actionContractHash: contractHash,
      createdAt: new Date().toISOString(),
      status: 'AwaitRoll',
    });
    const resolved = await resolveOrReuseRoll({
      journal: this.deps.turns,
      branchId,
      turnId: contract.turnId,
      expectedStateVersion: contract.expectedStateVersion,
      actionContractJson: JSON.stringify(contract),
      actionContractHash: contractHash,
      spec: rollSpecForSkill(card, catalog, skillId, 'normal'),
      random: this.deps.random,
      createdAt: new Date().toISOString(),
    });
    return resolved.rollRecord;
  }

  private async applyAction(
    branchId: string,
    ctx: EncounterContext,
    contract: ActionContract,
    rollRecord: RollRecord | null,
    settlement: Parameters<typeof commitResolvedTurn>[0]['settlement'],
    economy: ActionEconomy,
  ): Promise<{ encounter: EncounterState; zones: ZoneNode[]; exits: string[]; zoneMap: Record<string, string>; cards: ActorCard[]; stateVersion: number }> {
    const grade: RollGrade = rollRecord?.grade ?? 'success';
    const outcome = contract.outcomes[grade];
    let projected = applyEffects(ctx.state, outcome.effects, 0);
    const nextEncounter = cloneEncounter(ctx.encounter);
    if (economy.retreatActorId) markActorRetreated(projected, economy.retreatActorId);
    syncEncounterActors(nextEncounter, projected);
    if (economy.retreatActorId) {
      const retreating = nextEncounter.actors[economy.retreatActorId];
      if (!retreating) throw new Error(`Unknown retreating actor ${economy.retreatActorId}.`);
      retreating.hp = 0;
      if (!retreating.conditions.includes('retreated')) retreating.conditions.push('retreated');
    }
    if (economy.moveActorTo) ctx.zoneMap[contract.actorId] = economy.moveActorTo;
    if (economy.consumeMovement) {
      const actor = nextEncounter.actors[contract.actorId];
      if (!actor || actor.movedThisRound) throw new Error('本轮的标准移动已经用尽。');
      actor.movedThisRound = true;
    }
    if (economy.consumeMainAction) markActed(nextEncounter, contract.actorId);

    let terminalStatus = economy.endStatus;
    if (!terminalStatus) {
      const livingHostiles = Object.values(nextEncounter.actors).some(actor => actor.side === 'npc' && actor.hp > 0);
      const livingParty = Object.values(nextEncounter.actors).some(actor => actor.side === 'player' && actor.hp > 0);
      if (!livingHostiles || !livingParty) terminalStatus = livingParty ? 'resolved' : 'wiped';
    }

    let roundClockSeconds = 0;
    let newlyJoinedActorIds: string[] = [];
    if (!economy.endStatus && economy.advanceActor && Object.values(nextEncounter.actors).some(actor => actor.hp > 0)) {
      const roundBefore = nextEncounter.round;
      advanceInitiative(nextEncounter);
      roundClockSeconds = Math.max(0, nextEncounter.round - roundBefore) * 6;
      if (nextEncounter.round > roundBefore && (nextEncounter.pendingActorIds?.length ?? 0) > 0) {
        for (const actorId of nextEncounter.pendingActorIds ?? []) {
          const actorState = projected.actors[actorId];
          const card = ctx.cards.find(candidate => candidate.actorId === actorId);
          if (!actorState || !card || card.controller === 'gm') continue;
          nextEncounter.actors[actorId] = {
            actorId,
            side: 'player',
            hp: actorState.resources.hp ?? card.resourceMax.hp ?? 1,
            maxHp: card.resourceMax.hp ?? 1,
            stamina: actorState.resources.stamina ?? card.resourceMax.stamina ?? 0,
            conditions: [...actorState.conditions],
            distanceBand: 'near',
            actedThisRound: false,
            movedThisRound: false,
          };
          // Preserve the order frozen for existing actors; late entrants act
          // after them in their first round and are then part of the schedule.
          nextEncounter.initiative.push(actorId);
          newlyJoinedActorIds.push(actorId);
        }
        nextEncounter.pendingActorIds = [];
      }
      // Closeout C6: the scene's fate contract runs at every round boundary.
      const fateContract = nextEncounter.scene.fateContract;
      if (fateContract) {
        nextEncounter.fates = nextEncounter.fates ?? {};
        const fateActors = Object.values(nextEncounter.actors).map(actor => {
          const card = ctx.cards.find(candidate => candidate.actorId === actor.actorId);
          return {
            actorId: actor.actorId,
            side: actor.side === 'player' ? ('player' as const) : ('npc' as const),
            isCompanion: card?.kind === 'companion',
            disabled: actor.hp <= 0 || actor.conditions.includes('disabled'),
          };
        });
        const transition = applyFateTransitions(nextEncounter.round, fateActors, nextEncounter.fates, fateContract);
        if (transition.encounterOutcome) terminalStatus = transition.encounterOutcome;
        if (transition.endingId) nextEncounter.endingTriggered = transition.endingId;
        if (transition.events.length > 0) {
          projected = applyEffects(projected, transition.events.map(event => ({
            op: 'recordEvent' as const,
            eventType: `fate_${event.kind}`,
            summary: describeFateEvent(event),
          })), 0);
        }
      }
    }
    if (economy.retreatActorId) {
      const retreatingIndex = nextEncounter.initiative.indexOf(economy.retreatActorId);
      if (retreatingIndex >= 0) {
        nextEncounter.initiative.splice(retreatingIndex, 1);
        if (retreatingIndex < nextEncounter.turnCursor) nextEncounter.turnCursor -= 1;
        if (nextEncounter.initiative.length > 0 && nextEncounter.turnCursor >= nextEncounter.initiative.length) {
          nextEncounter.turnCursor = 0;
        }
      }
    }
    nextEncounter.status = terminalStatus ?? 'active';
    if (nextEncounter.status !== 'active' && (nextEncounter.pendingActorIds?.length ?? 0) > 0) {
      for (const actorId of nextEncounter.pendingActorIds ?? []) delete ctx.zoneMap[actorId];
      nextEncounter.pendingActorIds = [];
    }
    projected = applyEffects(ctx.state, outcome.effects, contract.timeCostMinutes);
    if (economy.retreatActorId) markActorRetreated(projected, economy.retreatActorId);
    syncEncounterActors(nextEncounter, projected);

    const existingEntry = (ctx.state.encounters ?? []).find(entry => entry.state.encounterId === ctx.encounter.encounterId);
    const now = new Date().toISOString();
    const entry = makeEncounterSnapshot(
      nextEncounter,
      ctx.zones,
      ctx.exits,
      ctx.zoneMap,
      existingEntry?.createdAt ?? now,
      nextEncounter.status === 'active' ? null : now,
    );
    const removedActorIds = [...new Set([
      ...(economy.retreatActorId ? [economy.retreatActorId] : []),
      ...(nextEncounter.status === 'active'
        ? []
        : Object.values(nextEncounter.actors)
            .filter(actor => actor.side !== 'player' && ctx.cards.some(card => card.actorId === actor.actorId && card.controller === 'gm'))
            .map(actor => actor.actorId)),
    ])];
    const lootItemIds = nextEncounter.status === 'resolved'
      ? lootForDefeatedHostiles(nextEncounter, ctx.cards, ctx.entries, ctx.state.itemOwners)
      : [];
    const rewardRecipientActorId = nextEncounter.status === 'resolved'
      ? lootRecipient(nextEncounter, ctx.cards)
      : undefined;
    const encounterRewards = buildEncounterRewards({
      branchId,
      encounterId: ctx.encounter.encounterId,
      encounter: nextEncounter,
      combatants: allCombatants(ctx.encounter, ctx.cards, ctx.zoneMap, templateMap(ctx.entries), ctx.entries),
      catalog: packageIndexes(ctx.entries).catalog,
      stateVersion: ctx.state.stateVersion + 1,
      lootItemIds,
      lootRecipientActorId: rewardRecipientActorId,
    });
    const effectiveSettlement = settlement || removedActorIds.length > 0 || (encounterRewards.loot?.length ?? 0) > 0
      ? {
          encounterId: settlement?.encounterId ?? ctx.encounter.encounterId,
          skillUpserts: settlement?.skillUpserts ?? [],
          rewardLedger: settlement?.rewardLedger ?? [],
          relationships: settlement?.relationships ?? [],
          cardUpserts: settlement?.cardUpserts,
          cardDeletes: [...(settlement?.cardDeletes ?? []), ...removedActorIds],
          loot: [...(settlement?.loot ?? []), ...(encounterRewards.loot ?? [])],
        }
      : undefined;
    const result = await commitResolvedTurn({
      store: this.deps.turns,
      branchId,
      contract,
      contractHash: await this.deps.hashProvider.sha256Hex(JSON.stringify(contract)),
      outcomeGrade: grade,
      rollRecord: rollRecord ?? undefined,
      settlement: effectiveSettlement,
      contractOrigin: 'engine',
      committedAt: now,
      updateNextState: nextState => {
        for (const actorId of removedActorIds) delete nextState.actors[actorId];
        const movedActor = nextState.actors[contract.actorId];
        if (economy.moveActorTo && movedActor) {
          movedActor.zoneId = economy.moveActorTo;
        }
        if (roundClockSeconds > 0) {
          const clockSeconds = (nextState.clockSeconds ?? nextState.clockMinutes * 60) + roundClockSeconds;
          nextState.clockSeconds = clockSeconds;
          nextState.clockMinutes = Math.floor(clockSeconds / 60);
        }
        nextState.encounters = upsertEncounter(nextState.encounters ?? [], entry);
      },
      events: [
        ...(roundClockSeconds > 0 ? [{
          eventType: 'combat_round_completed',
          payload: { encounterId: ctx.encounter.encounterId, round: nextEncounter.round, clockSeconds: roundClockSeconds },
        }] : []),
        ...(newlyJoinedActorIds.length > 0 ? [{
          eventType: 'combat_actors_joined',
          payload: { encounterId: ctx.encounter.encounterId, actorIds: newlyJoinedActorIds },
        }] : []),
      ],
    });
    void result;
    const refreshed = await this.context(ctx.campaignId, branchId, ctx.encounter.encounterId);
    return {
      encounter: refreshed.encounter,
      zones: refreshed.zones,
      exits: refreshed.exits,
      zoneMap: refreshed.zoneMap,
      cards: refreshed.cards,
      stateVersion: refreshed.state.stateVersion,
    };
  }

  private buildView(
    encounter: EncounterState,
    zones: ZoneNode[],
    exits: string[],
    zoneMap: Record<string, string>,
    lastAction: string | null,
    lastDice: string | null,
    cards: readonly ActorCard[],
    stateVersion: number,
  ): EncounterView {
    const currentActorId = encounter.status === 'active'
      ? encounter.initiative[encounter.turnCursor] ?? null
      : null;
    const currentCard = currentActorId ? cards.find(card => card.actorId === currentActorId) : undefined;
    return {
      encounterId: encounter.encounterId,
      stateVersion,
      status: encounter.status,
      round: encounter.round,
      fates: encounter.fates ?? {},
      endingTriggered: encounter.endingTriggered ?? null,
      currentActorId,
      currentActorIsPlayer: currentCard?.controller === 'player',
      initiative: [...encounter.initiative],
      pendingActorIds: [...(encounter.pendingActorIds ?? [])],
      actors: Object.values(encounter.actors).map(actor => {
        const card = cards.find(candidate => candidate.actorId === actor.actorId);
        return {
          actorId: actor.actorId,
          name: card?.name ?? actor.actorId,
          side: actor.side === 'player' ? 'party' : actor.side === 'neutral' ? 'neutral' : 'hostile',
          hp: actor.hp,
          maxHp: actor.maxHp,
          zoneId: zoneMap[actor.actorId] ?? zones[0]?.zoneId ?? 'z-a',
          conditions: [...actor.conditions],
          isPlayer: card?.controller === 'player',
          actedThisRound: actor.actedThisRound,
          movedThisRound: actor.movedThisRound,
        };
      }),
      zones,
      exitIds: exits,
      lastAction,
      lastDice,
    };
  }
}

function currentActor(encounter: EncounterState): string {
  const actorId = encounter.initiative[encounter.turnCursor];
  if (!actorId) throw new Error('The encounter has no current actor.');
  return actorId;
}

function safeRequestId(requestId: string): string {
  if (requestId.trim().length === 0 || requestId.length > 96) {
    throw new Error('Combat requestId must contain 1–96 characters.');
  }
  return encodeURIComponent(requestId);
}

function requestTurnId(encounterId: string, requestId: string | undefined): string | null {
  return requestId === undefined ? null : `enc:${encounterId}:request:${safeRequestId(requestId)}`;
}

function engineActionContract(input: {
  turnId: string;
  expectedStateVersion: number;
  actorId: string;
  actionType: string;
  intent: string;
  eventType: string;
  summary: string;
}): ActionContract {
  const event = { op: 'recordEvent' as const, eventType: input.eventType, summary: input.summary };
  const outcome: ActionContract['outcomes']['success'] = {
    achieved: true,
    publicSummary: input.summary,
    effects: [event],
  };
  return {
    protocolVersion: '1.0',
    turnId: input.turnId,
    expectedStateVersion: input.expectedStateVersion,
    actorId: input.actorId,
    actionType: input.actionType,
    evidenceIds: [],
    requiresRoll: false,
    intent: input.intent,
    timeCostMinutes: 0,
    resourcePreconditions: [],
    outcomes: {
      full_success: outcome,
      success: outcome,
      failure: outcome,
      severe_failure: outcome,
    },
  };
}


/** Deterministic, GM-free narration lines for fate authority events (C6). */
function describeFateEvent(event: FateEvent): string {
  switch (event.kind) {
    case 'fate_assigned':
      return `命运降临：${event.actorId} 进入 ${event.fate} 状态（第 ${event.round} 回合）。`;
    case 'death_risk_escalated':
      return `${event.actorId} 濒危加深（已失能 ${event.roundsDisabled} 回合）。`;
    case 'fate_resolved':
      return `${event.actorId} 的 ${event.fate} 命运以 ${event.resolution} 收场（第 ${event.round} 回合）。`;
    case 'ending_triggered':
      return `结局触发：${event.actorId} 引发结局 ${event.endingId}（第 ${event.round} 回合）。`;
    case 'encounter_end_by_fate':
      return `遭遇因 ${event.actorId} 的 ${event.fate} 以 ${event.outcome} 结束（第 ${event.round} 回合）。`;
    default:
      return `命运事件：${JSON.stringify(event)}`;
  }
}

function cloneEncounter(encounter: EncounterState): EncounterState {
  return {
    encounterId: encounter.encounterId,
    status: encounter.status,
    scene: {
      sceneId: encounter.scene.sceneId,
      coverSpotIds: [...encounter.scene.coverSpotIds],
      exitIds: [...encounter.scene.exitIds],
      ...(encounter.scene.fateContract ? { fateContract: encounter.scene.fateContract } : {}),
    },
    actors: Object.fromEntries(Object.entries(encounter.actors).map(([actorId, actor]) => [actorId, {
      ...actor,
      conditions: [...actor.conditions],
    }])),
    initiative: [...encounter.initiative],
    pendingActorIds: [...(encounter.pendingActorIds ?? [])],
    turnCursor: encounter.turnCursor,
    round: encounter.round,
    ...(encounter.fates ? { fates: encounter.fates } : {}),
    ...(encounter.endingTriggered ? { endingTriggered: encounter.endingTriggered } : {}),
  };
}

function makeEncounterSnapshot(
  encounter: EncounterState,
  zones: readonly ZoneNode[],
  exits: readonly string[],
  zoneMap: Record<string, string>,
  createdAt: string,
  resolvedAt: string | null,
): EncounterSnapshotEntry {
  return {
    state: cloneEncounter(encounter),
    zones: zones.map(zone => ({ zoneId: zone.zoneId, exits: [...zone.exits] })),
    zoneMap: { ...zoneMap },
    exits: [...exits],
    createdAt,
    resolvedAt,
  };
}

function upsertEncounter(
  current: readonly EncounterSnapshotEntry[],
  entry: EncounterSnapshotEntry,
): EncounterSnapshotEntry[] {
  return [
    ...current.filter(candidate => candidate.state.encounterId !== entry.state.encounterId),
    makeEncounterSnapshot(entry.state, entry.zones, entry.exits, entry.zoneMap, entry.createdAt, entry.resolvedAt),
  ];
}

function syncEncounterActors(encounter: EncounterState, state: GameStateSnapshot): void {
  for (const [actorId, actorState] of Object.entries(state.actors)) {
    const encounterActor = encounter.actors[actorId];
    if (!encounterActor) continue;
    encounterActor.hp = actorState.resources.hp ?? encounterActor.hp;
    encounterActor.stamina = actorState.resources.stamina ?? encounterActor.stamina;
    encounterActor.conditions = [...actorState.conditions];
  }
}

function markActorRetreated(state: GameStateSnapshot, actorId: string): void {
  const actor = state.actors[actorId];
  if (!actor) return;
  actor.resources.hp = 0;
  if (!actor.conditions.includes('retreated')) actor.conditions.push('retreated');
}

function markActed(encounter: EncounterState, actorId: string): void {
  const actor = encounter.actors[actorId];
  if (actor) actor.actedThisRound = true;
}

function partyLocation(state: GameStateSnapshot, combatants: readonly Combatant[]): string {
  const partyId = combatants.find(combatant => combatant.side === 'party')?.actorId;
  return (partyId && state.actors[partyId]?.locationId) || Object.values(state.actors)[0]?.locationId || 'unknown';
}

function sceneForLocation(entries: readonly ContentEntry[], locationId: string): SceneDefinition | null {
  for (const entry of entries) {
    if (entry.kind !== 'scene') continue;
    const scene = entry.definition as SceneDefinition;
    if (scene.locationId === locationId) return scene;
  }
  return null;
}

function sceneExitIds(zones: readonly ZoneNode[]): string[] {
  const zoneIds = new Set(zones.map(zone => zone.zoneId));
  return [...new Set(zones.flatMap(zone => zone.exits.filter(exitId => !zoneIds.has(exitId))))].sort();
}

function actorCanRetreat(zones: readonly ZoneNode[], zoneId: string | undefined, exits: readonly string[]): boolean {
  if (!zoneId) return false;
  const zone = zones.find(candidate => candidate.zoneId === zoneId);
  return zone?.exits.some(exitId => exits.includes(exitId)) ?? false;
}

function templateMap(entries: readonly ContentEntry[]): Map<string, ContentEntry> {
  const map = new Map<string, ContentEntry>();
  for (const entry of entries) {
    if (entry.kind === 'actor_template') map.set(entry.entryId, entry);
  }
  return map;
}

function lootForDefeatedHostiles(
  encounter: EncounterState,
  cards: readonly ActorCard[],
  entries: readonly ContentEntry[],
  currentOwners: Readonly<Record<string, string>>,
): string[] {
  const itemIds = new Set(entries.filter(entry => entry.kind === 'item').map(entry => entry.entryId));
  const templates = templateMap(entries);
  const loot = new Set<string>();
  for (const actor of Object.values(encounter.actors)) {
      if (actor.side !== 'npc' || actor.hp > 0 || actor.conditions.includes('retreated')) continue;
    const card = cards.find(candidate => candidate.actorId === actor.actorId);
    if (!card?.templateId) continue;
    const template = templates.get(card.templateId);
    if (!template) continue;
    const definition = template.definition as ActorTemplateDefinition;
    for (const itemId of definition.lootItemIds ?? []) {
      if (itemIds.has(itemId) && currentOwners[itemId] === undefined) loot.add(itemId);
    }
  }
  return [...loot].sort();
}

function lootRecipient(encounter: EncounterState, cards: readonly ActorCard[]): string | undefined {
  const livingPartyIds = Object.values(encounter.actors)
    .filter(actor => actor.side === 'player' && actor.hp > 0 && !actor.conditions.includes('retreated'))
    .map(actor => actor.actorId);
  const candidates = cards.filter(card => livingPartyIds.includes(card.actorId));
  return candidates.find(card => card.controller === 'player')?.actorId
    ?? candidates.find(card => card.controller !== 'gm')?.actorId;
}

/**
 * Legal attack skills: template-declared attacks, plus world skills the card
 * knows whose definition is explicitly usage='attack'. Medic/stealth/lore
 * skills never qualify (P2 acceptance A07).
 */
function attackSkillsOf(card: ActorCard, templates: Map<string, ContentEntry>, entries: readonly ContentEntry[]): string[] {
  const skills: string[] = [];
  if (card.templateId) {
    const template = templates.get(card.templateId);
    if (template) {
      const definition = template.definition as ActorTemplateDefinition;
      for (const attack of definition.attacks) {
        if (!skills.includes(attack.skillId)) skills.push(attack.skillId);
      }
    }
  }
  const attackUsage = new Set(
    entries
      .filter(entry => entry.kind === 'skill')
      .map(entry => [entry.entryId, entry.entryId.replace(/^skill-/, '')])
      .filter(([entryId, bare]) => {
        const definition = entries.find(candidate => candidate.entryId === entryId)?.definition as { usage?: string } | undefined;
        return definition?.usage === 'attack';
      })
      .flat(),
  );
  for (const skillId of Object.keys(card.skills)) {
    if (attackUsage.has(skillId) && !skills.includes(skillId)) skills.push(skillId);
  }
  return skills;
}

function bestAttackSkill(card: ActorCard, combatant: Combatant, catalog: SkillCatalog): string | null {
  const usable = combatant.attackSkillIds.filter(skillId => {
    const stored = resolveSkillKey(card, skillId);
    return stored !== null || catalog[skillId]?.allowUntrained === true;
  });
  return usable[0] ?? null;
}

function attackRangeOf(combatant: Combatant, skillId: string, templates: Map<string, ContentEntry>): 'touch' | 'near' | 'mid' | 'far' {
  if (combatant.card.templateId) {
    const template = templates.get(combatant.card.templateId);
    if (template) {
      const definition = template.definition as ActorTemplateDefinition;
      const attack = definition.attacks.find(candidate => candidate.skillId === skillId);
      if (attack) return attack.range;
    }
  }
  return 'touch';
}

function combatantFor(
  actorId: string,
  encounter: EncounterState,
  cards: readonly ActorCard[],
  zoneMap: Record<string, string>,
  templates: Map<string, ContentEntry>,
  entries: readonly ContentEntry[],
): Combatant {
  const actor = encounter.actors[actorId];
  if (!actor) throw new Error(`Unknown encounter actor: ${actorId}.`);
  const card = cards.find(candidate => candidate.actorId === actorId);
  if (!card) throw new Error(`Encounter actor has no card: ${actorId}.`);
  return {
    actorId,
    card,
    side: actor.side === 'player' ? 'party' : actor.side === 'neutral' ? 'neutral' : 'hostile',
    zoneId: zoneMap[actorId] ?? 'z-a',
    armor: 0,
    attackSkillIds: attackSkillsOf(card, templates, entries),
  };
}

function allCombatants(
  encounter: EncounterState,
  cards: readonly ActorCard[],
  zoneMap: Record<string, string>,
  templates: Map<string, ContentEntry>,
  entries: readonly ContentEntry[],
): Combatant[] {
  return Object.keys(encounter.actors).map(actorId => combatantFor(actorId, encounter, cards, zoneMap, templates, entries));
}

function stepToward(zones: readonly ZoneNode[], from: string, to: string): string {
  if (from === to) return from;
  const current = zones.find(zone => zone.zoneId === from);
  const direct = current?.exits.find(exit => exit === to);
  if (direct) return direct;
  return current?.exits[0] ?? from;
}

function diceText(roll: RollRecord): string {
  return `${roll.diceCount}d${roll.dieSides}: [${roll.rolls.join(', ')}]`;
}

function rescueOutcome(targetId: string, hpCap: number): ActionContract['outcomes']['success'] {
  return {
    achieved: true,
    publicSummary: '援救成功，同伴恢复了意识。',
    effects: [
      { op: 'restoreResource', actorId: targetId, resourceId: 'hp', amount: 1, cap: hpCap },
      { op: 'removeCondition', actorId: targetId, conditionId: 'disabled' },
      { op: 'recordEvent', eventType: 'ally_rescued', summary: `援救同伴 ${targetId}` },
    ],
  };
}

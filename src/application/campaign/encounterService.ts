import type { RollGrade, RollRecord } from '../../domain/rules/types';
import type { ActionContract } from '../../domain/turns/types';
import type { GameStateSnapshot } from '../../domain/state/types';
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
import {
  compileAttack,
  decideNpcAction,
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
}

export interface EncounterView {
  encounterId: string;
  status: EncounterState['status'];
  round: number;
  currentActorId: string | null;
  currentActorIsPlayer: boolean;
  initiative: string[];
  actors: EncounterActorView[];
  zones: ZoneNode[];
  exitIds: string[];
  lastAction: string | null;
  lastDice: string | null;
}

/** Persisted alongside the encounter in distance_bands_json. */
interface EncounterEnvelope {
  bands: Record<string, string>;
  zones: Record<string, string>;
  sceneZones: ZoneNode[];
  exits: string[];
}

interface EncounterContext {
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

export interface BeginEncounterInput {
  campaignId: string;
  branchId: string;
  encounterId?: string;
  /** Hostile templates to instantiate, e.g. [{ templateId: 'guard', count: 2 }]. */
  hostiles: Array<{ templateId: string; count?: number }>;
}

const DEFAULT_ZONES: ZoneNode[] = [
  { zoneId: 'z-a', exits: ['z-b'] },
  { zoneId: 'z-b', exits: ['z-a'] },
];

export class EncounterService {
  constructor(private readonly deps: EncounterDeps) {}

  // ------------------------------------------------------------------ begin

  async begin(input: BeginEncounterInput): Promise<EncounterView> {
    const summary = await this.loadCampaign(input.campaignId, input.branchId);
    if (summary.packageRevision < 1) throw new Error('旧版战役无法进入遭遇。');
    const entries = await this.loadEntries(summary.worldId, summary.packageRevision);
    const templates = templateMap(entries);

    const state = summary.state;
    const createdAt = new Date().toISOString();
    const combatants: Combatant[] = [];
    const hostileInserts: Array<{ actorId: string; card: ActorCard }> = [];

    for (const card of summary.cards) {
      if (card.controller === 'gm') continue;
      const actor = state.actors[card.actorId];
      if (!actor || actor.conditions.includes('disabled')) continue;
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
        hostileInserts.push({ actorId, card });
      }
    }

    const location = partyLocation(state, combatants);
    const scene = sceneForLocation(entries, location);
    const zones: ZoneNode[] = scene
      ? scene.zones.map(zone => ({ zoneId: zone.zoneId, exits: [...zone.exits] }))
      : DEFAULT_ZONES;
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

    const encounterId = input.encounterId ?? `enc-${input.branchId}-${state.stateVersion + 1}`;
    const encounter = startEncounter({
      encounterId,
      scene: {
        sceneId: scene?.locationId ?? 'improvised',
        coverSpotIds: scene?.zones.filter(zone => zone.cover).map(zone => zone.zoneId) ?? [],
        exitIds: ['withdraw'],
      },
      actors: combatants.map(combatant => ({
        actorId: combatant.actorId,
        side: combatant.side === 'party' ? 'player' : 'npc',
        hp: state.actors[combatant.actorId]?.resources.hp ?? combatant.card.resourceMax.hp ?? 1,
        maxHp: combatant.card.resourceMax.hp ?? 1,
        stamina: state.actors[combatant.actorId]?.resources.stamina ?? combatant.card.resourceMax.stamina ?? 0,
        conditions: [...(state.actors[combatant.actorId]?.conditions ?? [])],
      })),
      initiative: freezeInitiative(combatants),
    }).state;

    // Transient hostile projections land in branch scope so attacks compile
    // against real actors; they are removed when the encounter ends.
    await this.deps.db.transaction(async tx => {
      for (const insert of hostileInserts) {
        await tx.execute(
          `INSERT INTO actor_states (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
           VALUES (?, ?, ?, ?, ?, '[]')`,
          [input.branchId, insert.actorId, state.stateVersion, location, JSON.stringify({ ...insert.card.resourceMax })],
        );
        await tx.execute(
          `INSERT INTO actor_cards (branch_id, actor_id, card_json, created_at, updated_at, updated_state_version)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [input.branchId, insert.actorId, JSON.stringify(insert.card), createdAt, createdAt, state.stateVersion],
        );
      }
    });
    await this.persist(input.branchId, encounter, zones, ['withdraw'], zoneMap);
    return this.buildView(encounter, zones, ['withdraw'], zoneMap, null, null, summary.cards);
  }

  // ------------------------------------------------------------- player turn

  /** Player attack with a legal attack skill against a target in range. */
  async playerAttack(input: {
    campaignId: string;
    branchId: string;
    encounterId: string;
    targetId: string;
    skillId?: string;
  }): Promise<EncounterView> {
    const ctx = await this.context(input.campaignId, input.branchId, input.encounterId);
    const { encounter, zoneMap, cards } = ctx;
    const currentActorId = currentActor(encounter);
    const actorCard = cards.find(card => card.actorId === currentActorId);
    if (!actorCard || actorCard.controller === 'gm') {
      throw new Error('当前行动者不是玩家方角色；请先推进 NPC 回合。');
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
      actionSeq: encounter.round * 10 + encounter.turnCursor,
      stateVersion: ctx.state.stateVersion,
      zones: ctx.zones,
      attackRange: attackRangeOf(attacker, skillId, templates),
    });

    withRoundClock(contract, encounter);
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
    const result = await this.applyAction(input.branchId, ctx, contract, rollRecord, settlement);
    return this.buildView(
      result.encounter, result.zones, result.exits, result.zoneMap,
      `${actorCard.name} 攻击 ${target.card.name}：${rollRecord.grade}`,
      diceText(rollRecord), cards,
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
  }): Promise<EncounterView> {
    const ctx = await this.context(input.campaignId, input.branchId, input.encounterId);
    const { encounter, cards, zoneMap } = ctx;
    const currentActorId = currentActor(encounter);
    const actorCard = cards.find(card => card.actorId === currentActorId);
    if (!actorCard || actorCard.controller !== 'gm') {
      throw new Error('当前行动者是玩家角色；请由玩家选择行动。');
    }
    const templates = templateMap(ctx.entries);
    const catalog = packageIndexes(ctx.entries).catalog;
    const combatants = allCombatants(encounter, cards, zoneMap, templates, ctx.entries);
    const decision = decideNpcAction({
      actor: combatantFor(currentActorId, encounter, cards, zoneMap, templates, ctx.entries),
      encounter,
      combatants,
      catalog,
      zones: ctx.zones,
    });

    if (decision.kind === 'retreat') {
      encounter.status = 'escaped';
      await this.persist(input.branchId, encounter, ctx.zones, ctx.exits, zoneMap);
      await this.cleanupHostiles(input.branchId, encounter, cards);
      return this.buildView(encounter, ctx.zones, ctx.exits, zoneMap,
        `${actorCard.name} 撤离了战斗。`, null, cards);
    }
    if (decision.kind === 'move') {
      const mover = combatantFor(currentActorId, encounter, cards, zoneMap, templates, ctx.entries);
      const toward = combatantFor(decision.towardActorId, encounter, cards, zoneMap, templates, ctx.entries);
      const nextZone = stepToward(ctx.zones, mover.zoneId, toward.zoneId);
      zoneMap[currentActorId] = nextZone;
      markActed(encounter, currentActorId);
      advanceInitiative(encounter);
      await this.persist(input.branchId, encounter, ctx.zones, ctx.exits, zoneMap);
      return this.buildView(encounter, ctx.zones, ctx.exits, zoneMap,
        `${actorCard.name} 向 ${toward.card.name} 逼近。`, null, cards);
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
      actionSeq: encounter.round * 10 + encounter.turnCursor,
      stateVersion: ctx.state.stateVersion,
      zones: ctx.zones,
      attackRange: attackRangeOf(attacker, skillId, templates),
    });
    withRoundClock(contract, encounter);
    const rollRecord = await this.stageAndRoll(input.branchId, contract, attacker.card, catalog, skillId);
    const result = await this.applyAction(input.branchId, ctx, contract, rollRecord, undefined);
    return this.buildView(
      result.encounter, result.zones, result.exits, result.zoneMap,
      `${attacker.card.name} 攻击 ${target.card.name}：${rollRecord.grade}`,
      diceText(rollRecord), cards,
    );
  }

  /** Player standard move to an ADJACENT zone (does not burn the main action). */
  async playerMove(input: {
    campaignId: string;
    branchId: string;
    encounterId: string;
    toZoneId: string;
  }): Promise<EncounterView> {
    const ctx = await this.context(input.campaignId, input.branchId, input.encounterId);
    const currentActorId = currentActor(ctx.encounter);
    const actorCard = ctx.cards.find(card => card.actorId === currentActorId);
    if (!currentActorId || !actorCard || actorCard.controller === 'gm') {
      throw new Error('当前行动者不是玩家方角色。');
    }
    const fromZone = ctx.zoneMap[currentActorId] ?? 'z-a';
    const band = distanceBetweenZones(ctx.zones, fromZone, input.toZoneId);
    if (band !== 'mid') throw new Error('标准移动只能进入相邻区域。');
    ctx.zoneMap[currentActorId] = input.toZoneId;
    await this.persist(input.branchId, ctx.encounter, ctx.zones, ctx.exits, ctx.zoneMap);
    return this.buildView(ctx.encounter, ctx.zones, ctx.exits, ctx.zoneMap,
      `${actorCard.name} 移动到 ${input.toZoneId}。`, null, ctx.cards);
  }

  /** Rescue a disabled ALLY in the same zone: restores 1 hp (plan §12.4). */
  async rescueAlly(input: {
    campaignId: string;
    branchId: string;
    encounterId: string;
    targetId: string;
  }): Promise<EncounterView> {
    const ctx = await this.context(input.campaignId, input.branchId, input.encounterId);
    const currentActorId = currentActor(ctx.encounter);
    const actorCard = ctx.cards.find(card => card.actorId === currentActorId);
    if (!currentActorId || !actorCard || actorCard.controller === 'gm') {
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

    const turnId = `enc:${input.encounterId}:${currentActorId}:rescue${ctx.encounter.round}`;
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
    const contractHash = await this.deps.hashProvider.sha256Hex(`${turnId}:rescue`);
    const result = await this.applyAction(
      input.branchId, ctx, contract, null, undefined, contractHash,
    );
    return this.buildView(result.encounter, result.zones, result.exits, result.zoneMap,
      `${actorCard.name} 援救了 ${targetCard.name}（恢复意识）。`, null, ctx.cards);
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
  }): Promise<EncounterView> {
    const ctx = await this.context(input.campaignId, input.branchId, input.encounterId);
    const currentActorId = currentActor(ctx.encounter);
    const actorCard = ctx.cards.find(card => card.actorId === currentActorId);
    if (!actorCard || actorCard.controller === 'gm') {
      throw new Error('当前行动者不是玩家方角色。');
    }
    const actor = ctx.encounter.actors[currentActorId];
    if (!actor || actor.actedThisRound) throw new Error('本回合的主要行动已用尽。');
    markActed(ctx.encounter, currentActorId);
    advanceInitiative(ctx.encounter);
    await this.persist(input.branchId, ctx.encounter, ctx.zones, ctx.exits, ctx.zoneMap);
    return this.buildView(ctx.encounter, ctx.zones, ctx.exits, ctx.zoneMap,
      `${actorCard.name} 保持戒备，让出了行动机会。`, null, ctx.cards);
  }

  /** Player retreat through a scene exit: the encounter ends as escaped. */
  async retreat(input: {
    campaignId: string;
    branchId: string;
    encounterId: string;
  }): Promise<EncounterView> {
    const ctx = await this.context(input.campaignId, input.branchId, input.encounterId);
    if (ctx.encounter.status !== 'active') throw new Error('遭遇已经结束。');
    ctx.encounter.status = 'escaped';
    await this.persist(input.branchId, ctx.encounter, ctx.zones, ctx.exits, ctx.zoneMap);
    await this.cleanupHostiles(input.branchId, ctx.encounter, ctx.cards);
    return this.buildView(ctx.encounter, ctx.zones, ctx.exits, ctx.zoneMap,
      '队伍撤离了战斗。', null, ctx.cards);
  }

  /** Loads the current encounter view without acting. */
  async getView(campaignId: string, branchId: string, encounterId: string): Promise<EncounterView> {
    const ctx = await this.context(campaignId, branchId, encounterId);
    return this.buildView(ctx.encounter, ctx.zones, ctx.exits, ctx.zoneMap, null, null, ctx.cards);
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

  // ----------------------------------------------------------------- helpers

  private async loadCampaign(campaignId: string, branchId: string) {
    const row = await this.deps.db.queryOne<SqliteRow>(
      'SELECT world_id, package_revision FROM campaigns WHERE campaign_id = ?',
      [campaignId],
    );
    if (!row) throw new Error(`Unknown campaign: ${campaignId}.`);
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
      encounter,
      zones: envelope.sceneZones.length > 0 ? envelope.sceneZones : DEFAULT_ZONES,
      exits: envelope.exits.length > 0 ? envelope.exits : ['withdraw'],
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
        exits: (parsed.exits as string[]) ?? [],
      };
    }
    const bands: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') bands[key] = value;
    }
    return { bands, zones: {}, sceneZones: [], exits: [] };
  }

  private async persist(
    branchId: string,
    encounter: EncounterState,
    zones: ZoneNode[],
    exits: string[],
    zoneMap: Record<string, string>,
  ): Promise<void> {
    await this.deps.game.saveEncounter(
      branchId, encounter, new Date().toISOString(),
      encounter.status === 'active' ? null : new Date().toISOString(),
      encounter.round,
    );
    const envelope: EncounterEnvelope = {
      bands: Object.fromEntries(
        Object.entries(encounter.actors).map(([actorId, actor]) => [actorId, actor.distanceBand]),
      ),
      zones: zoneMap,
      sceneZones: zones,
      exits,
    };
    await this.deps.db.execute(
      'UPDATE encounters SET distance_bands_json = ? WHERE branch_id = ? AND encounter_id = ?',
      [JSON.stringify(envelope), branchId, encounter.encounterId],
    );
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
    explicitHash?: string,
  ): Promise<{ encounter: EncounterState; zones: ZoneNode[]; exits: string[]; zoneMap: Record<string, string> }> {
    const contractHash = explicitHash ?? await this.deps.hashProvider.sha256Hex(JSON.stringify(contract));
    const grade: RollGrade = rollRecord?.grade ?? 'success';
    await commitResolvedTurn({
      store: this.deps.turns,
      branchId,
      contract,
      contractHash,
      outcomeGrade: grade,
      rollRecord: rollRecord ?? undefined,
      settlement,
      contractOrigin: 'engine',
      committedAt: new Date().toISOString(),
    });
    // Sync the encounter projection from the committed state.
    const state = await this.deps.turns.getState(branchId);
    if (!state) throw new Error('Branch state vanished after commit.');
    const encounter = ctx.encounter;
    for (const [actorId, actorState] of Object.entries(state.actors)) {
      const encounterActor = encounter.actors[actorId];
      if (!encounterActor) continue;
      encounterActor.hp = actorState.resources.hp ?? encounterActor.hp;
      if (actorState.conditions.includes('disabled')) {
        if (!encounterActor.conditions.includes('disabled')) encounterActor.conditions.push('disabled');
      } else {
        encounterActor.conditions = encounterActor.conditions.filter(condition => condition !== 'disabled');
      }
    }
    markActed(encounter, contract.actorId);
    advanceInitiative(encounter);

    const consciousHostiles = Object.values(encounter.actors).filter(actor => actor.side === 'npc' && actor.hp > 0).length;
    const consciousParty = Object.values(encounter.actors).filter(actor => actor.side === 'player' && actor.hp > 0).length;
    if (consciousHostiles === 0 || consciousParty === 0) {
      encounter.status = consciousParty === 0 ? 'wiped' : 'resolved';
      await this.persist(branchId, encounter, ctx.zones, ctx.exits, ctx.zoneMap);
      await this.cleanupHostiles(branchId, encounter, ctx.cards);
      return { encounter, zones: ctx.zones, exits: ctx.exits, zoneMap: ctx.zoneMap };
    }
    await this.persist(branchId, encounter, ctx.zones, ctx.exits, ctx.zoneMap);
    return { encounter, zones: ctx.zones, exits: ctx.exits, zoneMap: ctx.zoneMap };
  }

  /** Removes transient hostile projections after the encounter ends. */
  private async cleanupHostiles(branchId: string, encounter: EncounterState, cards: readonly ActorCard[]): Promise<void> {
    await this.deps.db.transaction(async tx => {
      for (const [actorId, actor] of Object.entries(encounter.actors)) {
        if (actor.side !== 'npc') continue;
        const card = cards.find(candidate => candidate.actorId === actorId);
        if (!card || card.controller !== 'gm') continue;
        await tx.execute('DELETE FROM actor_states WHERE branch_id = ? AND actor_id = ?', [branchId, actorId]);
        await tx.execute('DELETE FROM actor_cards WHERE branch_id = ? AND actor_id = ?', [branchId, actorId]);
      }
    });
  }

  private buildView(
    encounter: EncounterState,
    zones: ZoneNode[],
    exits: string[],
    zoneMap: Record<string, string>,
    lastAction: string | null,
    lastDice: string | null,
    cards: readonly ActorCard[],
  ): EncounterView {
    const currentActorId = encounter.status === 'active'
      ? encounter.initiative[encounter.turnCursor] ?? null
      : null;
    const currentCard = currentActorId ? cards.find(card => card.actorId === currentActorId) : undefined;
    return {
      encounterId: encounter.encounterId,
      status: encounter.status,
      round: encounter.round,
      currentActorId,
      currentActorIsPlayer: currentCard !== undefined && currentCard.controller !== 'gm',
      initiative: [...encounter.initiative],
      actors: Object.values(encounter.actors).map(actor => {
        const card = cards.find(candidate => candidate.actorId === actor.actorId);
        return {
          actorId: actor.actorId,
          name: card?.name ?? actor.actorId,
          side: actor.side === 'player' ? 'party' : 'hostile',
          hp: actor.hp,
          maxHp: actor.maxHp,
          zoneId: zoneMap[actor.actorId] ?? zones[0]?.zoneId ?? 'z-a',
          conditions: [...actor.conditions],
          isPlayer: card !== undefined && card.controller === 'player',
          actedThisRound: actor.actedThisRound,
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

function templateMap(entries: readonly ContentEntry[]): Map<string, ContentEntry> {
  const map = new Map<string, ContentEntry>();
  for (const entry of entries) {
    if (entry.kind === 'actor_template') map.set(entry.entryId, entry);
  }
  return map;
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
    side: actor.side === 'player' ? 'party' : 'hostile',
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

/** The round's LAST actor carries the 6-second round clock (plan §10.3). */
function withRoundClock(contract: ActionContract, encounter: EncounterState): void {
  if (encounter.turnCursor === encounter.initiative.length - 1) {
    contract.timeCostMinutes = 0.1; // 6 seconds, advanced exactly once per round
  }
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
    ],
  };
}

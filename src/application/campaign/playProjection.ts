/**
 * Play UI projection (Phase 3 · P4.1) — read-only view models for 游玩页.
 *
 * Why this lives in the core: the projection is pure data shaping over the
 * branch snapshot, the actor cards and the locked world package. Keeping it
 * here makes the visibility policy testable by the node regression suite and
 * keeps the mobile bridge free of rules.
 *
 * Boundaries (plan §2.1 / §14 / §16):
 *   · READ-ONLY. Nothing here writes, and no existing read path changes.
 *   · No new database fields, no schema change: every value already exists in
 *     `GameStateSnapshot`, `ActorCard` or the world package entries.
 *   · Party projection covers the player and current party members only;
 *     actors who left the party are absent by construction (their rows are
 *     gone from `state.party`).
 *   · The NPC projection hides GM-only material (attributes, abilities,
 *     prepared slots, resource maxima, hidden skill ids) and only exposes what
 *     the player could have observed.
 */
import { PREPARED_ABILITY_SLOTS, SKILL_RANK_DIE, type ActorCard, type CompanionDirective } from '../../domain/characters/card';
import { PRACTICE_THRESHOLDS } from '../../domain/progression/growth';
import type { ContentEntry } from '../../domain/content/types';
import type { SkillRank } from '../../domain/rules/types';
import type {
  GameStateSnapshot,
  ItemSourceSnapshotEntry,
} from '../../domain/state/types';

/** One skill row of an actor, with the real practice-point threshold. */
export interface ActorSkillProgressView {
  actorId: string;
  skillId: string;
  /** Display name resolved from the world package (never a bare id in UI). */
  name: string;
  rank: SkillRank;
  /** Die sides for this rank (d4–d12), from the rule domain mapping. */
  dieSides: number;
  practicePoints: number;
  /** Points needed to reach the next rank; null at master (terminal rank). */
  threshold: number | null;
}

export interface PreparedAbilityView {
  abilityId: string;
  name: string;
  /** State version at which the cooldown expires; null when ready. */
  cooldownExpiresAtVersion: number | null;
}

/** One actor as the play UI may render them (player or party member). */
export interface ActorUiProjection {
  actorId: string;
  name: string;
  kind: ActorCard['kind'];
  controller: ActorCard['controller'];
  originId?: string;
  pathId?: string;
  powerTier: ActorCard['powerTier'];
  defense: number;
  attributes: Record<string, number>;
  companionDirective?: CompanionDirective;
  companionLeaderActorId?: string;
  /** Filled slots of the four prepared ability slots, in card order. */
  preparedAbilities: PreparedAbilityView[];
  /** Total slots the rule domain allows. */
  preparedAbilitySlots: number;
  resourceMax: Record<string, number>;
  resources: Record<string, number>;
  conditions: string[];
  lifeStatus: 'active' | 'incapacitated' | 'critical' | 'dead';
  locationId: string;
  zoneId?: string;
  /** `main` or a split group id; membership is branch state. */
  groupId: string;
}

export interface RelationshipView {
  relId: string;
  fromActorId: string;
  toActorId: string;
  stance: string;
  closeness: number;
  updatedTurnId: string | null;
}

export interface DiscoveryView {
  entryId: string;
  /** Display title resolved from the world package. */
  title: string;
  /** Known public/discoverable lore from the snapshot-bound catalog. */
  body?: string;
  knownVia: 'witnessed' | 'told' | 'inferred';
  knownAtStateVersion: number;
  sourceTurnId: string;
}

export interface QuestProgressView {
  questId: string;
  name: string;
  status: 'available' | 'active' | 'succeeded' | 'failed' | 'abandoned';
  counters: Record<string, number>;
  completedStateVersion: number | null;
}

export interface InventoryView {
  itemId: string;
  name: string;
  ownerActorId: string;
  ownerName: string;
  source: ItemSourceSnapshotEntry | null;
}

/**
 * The aggregate read-only projection (plan §14.2). Every field comes from one
 * `getSummary()` read, so all lists share one `stateVersion`.
 */
export interface PlayUiProjection {
  campaignId: string;
  branchId: string;
  stateVersion: number;
  worldId: string;
  packageRevision: number;
  /** Campaign title (`world · protagonist`), used by the play header. */
  title: string;
  /** Anchor world-time order the campaign was locked to (null = origin). */
  anchorWorldTimeOrder: number | null;
  /** Authoritative world clock (seconds); `clockMinutes` stays for compat. */
  clockSeconds: number;
  goal: string;
  player: ActorUiProjection | null;
  party: ActorUiProjection[];
  /**
   * Display names of every actor the player can currently see (party plus
   * active-encounter participants). Lets the UI label relationship rows
   * without ever printing a raw actor id.
   */
  actorNames: Record<string, string>;
  skills: ActorSkillProgressView[];
  relationships: RelationshipView[];
  discoveries: DiscoveryView[];
  quests: QuestProgressView[];
  inventory: InventoryView[];
}

export interface PlayProjectionInput {
  campaignId: string;
  branchId: string;
  worldId: string;
  packageRevision: number;
  title: string;
  anchorWorldTimeOrder: number | null;
  goal: string;
  state: GameStateSnapshot;
  cards: readonly ActorCard[];
  /** Entries of the locked world package revision (name + visibility source). */
  entries: readonly ContentEntry[];
}

/** Name/visibility index over the locked package entries. */
interface EntryIndex {
  nameOf(entryId: string): string;
  visibilityOf(entryId: string): ContentEntry['visibility'] | null;
  has(entryId: string): boolean;
  loreBodyOf(entryId: string): string | undefined;
}

function buildEntryIndex(entries: readonly ContentEntry[]): EntryIndex {
  const byId = new Map<string, ContentEntry>();
  for (const entry of entries) byId.set(entry.entryId, entry);
  return {
    has: entryId => byId.has(entryId),
    visibilityOf: entryId => byId.get(entryId)?.visibility ?? null,
    loreBodyOf(entryId) {
      const entry = byId.get(entryId);
      if (!entry || entry.kind !== 'lore' || !['public', 'discoverable'].includes(entry.visibility)) return undefined;
      const text = (entry.definition as { text?: unknown } | null)?.text;
      return typeof text === 'string' && text.trim() ? text : undefined;
    },
    nameOf(entryId) {
      const entry = byId.get(entryId);
      if (!entry) return entryId;
      const definition = entry.definition as { name?: unknown; title?: unknown } | null;
      const name = definition?.name ?? definition?.title;
      return typeof name === 'string' && name.trim().length > 0 ? name : entryId;
    },
  };
}

/**
 * Skill ids are stored with the `skill-` prefix on cards/entries; planners say
 * the bare id. Look both up so the UI always gets a display name.
 */
function skillEntryId(index: EntryIndex, skillId: string): string | null {
  if (index.has(skillId)) return skillId;
  const prefixed = `skill-${skillId}`;
  if (index.has(prefixed)) return prefixed;
  const bare = skillId.replace(/^skill-/, '');
  return index.has(bare) ? bare : null;
}

function thresholdForRank(rank: SkillRank): number | null {
  const threshold = PRACTICE_THRESHOLDS[rank];
  return Number.isFinite(threshold) ? threshold : null;
}

function preparedAbilities(
  card: ActorCard,
  state: GameStateSnapshot,
  index: EntryIndex,
): PreparedAbilityView[] {
  const cooldowns = state.actors[card.actorId]?.abilityCooldowns ?? {};
  return card.preparedAbilities.map(abilityId => ({
    abilityId,
    name: index.nameOf(abilityId),
    cooldownExpiresAtVersion: cooldowns[abilityId] ?? null,
  }));
}

function actorProjection(
  card: ActorCard,
  state: GameStateSnapshot,
  index: EntryIndex,
  groupId: string,
): ActorUiProjection {
  const actorState = state.actors[card.actorId];
  return {
    actorId: card.actorId,
    name: card.name,
    kind: card.kind,
    controller: card.controller,
    ...(card.originId ? { originId: card.originId } : {}),
    ...(card.pathId ? { pathId: card.pathId } : {}),
    powerTier: card.powerTier,
    defense: card.defense,
    attributes: { ...card.attributes },
    ...(card.companionDirective ? { companionDirective: card.companionDirective } : {}),
    ...(card.companionLeaderActorId ? { companionLeaderActorId: card.companionLeaderActorId } : {}),
    preparedAbilities: preparedAbilities(card, state, index),
    preparedAbilitySlots: PREPARED_ABILITY_SLOTS,
    resourceMax: { ...card.resourceMax },
    resources: { ...(actorState?.resources ?? {}) },
    conditions: [...(actorState?.conditions ?? [])],
    lifeStatus: actorState?.lifeStatus ?? 'active',
    locationId: actorState?.locationId ?? 'unknown',
    ...(actorState?.zoneId ? { zoneId: actorState.zoneId } : {}),
    groupId,
  };
}

export function buildPlayUiProjection(input: PlayProjectionInput): PlayUiProjection {
  const index = buildEntryIndex(input.entries);
  const { state } = input;
  const playerCard = input.cards.find(card => card.controller === 'player') ?? null;
  const partyRows = state.party ?? [];
  const memberByActor = new Map(partyRows.map(member => [member.actorId, member]));

  // Visible set = the player plus current party members. Actors who left the
  // party have no row here, so their state can never reach the UI.
  const visibleActorIds = new Set(partyRows.map(member => member.actorId));
  if (playerCard) visibleActorIds.add(playerCard.actorId);

  const player = playerCard
    ? actorProjection(playerCard, state, index, memberByActor.get(playerCard.actorId)?.groupId ?? 'main')
    : null;

  const party = input.cards
    .filter(card => card.actorId !== playerCard?.actorId && visibleActorIds.has(card.actorId))
    .map(card => actorProjection(card, state, index, memberByActor.get(card.actorId)?.groupId ?? 'main'));

  const skills: ActorSkillProgressView[] = [];
  for (const entry of state.skills ?? []) {
    if (!visibleActorIds.has(entry.actorId)) continue;
    const resolved = skillEntryId(index, entry.skillId);
    skills.push({
      actorId: entry.actorId,
      skillId: entry.skillId,
      name: resolved ? index.nameOf(resolved) : entry.skillId,
      rank: entry.rank,
      dieSides: SKILL_RANK_DIE[entry.rank],
      practicePoints: entry.practicePoints,
      threshold: thresholdForRank(entry.rank),
    });
  }
  // Legacy snapshots without a skill table: fall back to the card's ranks.
  if ((state.skills ?? []).length === 0) {
    for (const card of input.cards) {
      if (!visibleActorIds.has(card.actorId)) continue;
      for (const [skillId, rank] of Object.entries(card.skills)) {
        const resolved = skillEntryId(index, skillId);
        skills.push({
          actorId: card.actorId,
          skillId,
          name: resolved ? index.nameOf(resolved) : skillId,
          rank,
          dieSides: SKILL_RANK_DIE[rank],
          practicePoints: 0,
          threshold: thresholdForRank(rank),
        });
      }
    }
  }

  // Relationships: the player's own network only (the NPC sheet carries the
  // NPC's stance separately).
  const playerActorId = playerCard?.actorId ?? null;
  const relationships = (state.relationships ?? [])
    .filter(rel => playerActorId !== null && (rel.fromActorId === playerActorId || rel.toActorId === playerActorId))
    .map(rel => ({
      relId: rel.relId,
      fromActorId: rel.fromActorId,
      toActorId: rel.toActorId,
      stance: rel.stance,
      closeness: rel.closeness,
      updatedTurnId: rel.updatedTurnId,
    }));

  const discoveries = (state.discoveries ?? [])
    .filter(entry => playerActorId !== null && entry.actorId === playerActorId)
    .map(entry => ({
      entryId: entry.entryId,
      title: index.nameOf(entry.entryId),
      ...(index.loreBodyOf(entry.entryId) !== undefined ? { body: index.loreBodyOf(entry.entryId) } : {}),
      knownVia: entry.knownVia,
      knownAtStateVersion: entry.knownAtStateVersion,
      sourceTurnId: entry.sourceTurnId,
    }));

  const quests = (state.questProgress ?? []).map(entry => ({
    questId: entry.questId,
    name: index.nameOf(entry.questId),
    status: entry.status,
    counters: { ...entry.counters },
    completedStateVersion: entry.completedStateVersion,
  }));

  const nameByActor = new Map<string, string>();
  if (playerCard) nameByActor.set(playerCard.actorId, playerCard.name);
  for (const card of input.cards) nameByActor.set(card.actorId, card.name);

  const inventory = Object.entries(state.itemOwners)
    .filter(([, ownerActorId]) => visibleActorIds.has(ownerActorId))
    .map(([itemId, ownerActorId]) => ({
      itemId,
      name: index.nameOf(itemId),
      ownerActorId,
      ownerName: nameByActor.get(ownerActorId) ?? ownerActorId,
      source: state.itemSources?.[itemId] ?? null,
    }));

  return {
    campaignId: input.campaignId,
    branchId: input.branchId,
    stateVersion: state.stateVersion,
    worldId: input.worldId,
    packageRevision: input.packageRevision,
    title: input.title,
    anchorWorldTimeOrder: input.anchorWorldTimeOrder,
    clockSeconds: state.clockSeconds ?? state.clockMinutes * 60,
    goal: input.goal,
    player,
    party,
    actorNames: Object.fromEntries(nameByActor),
    skills,
    relationships,
    discoveries,
    quests,
    inventory,
  };
}

// ---------------------------------------------------------------------------
// NPC / creature public projection (plan §14.1 · 方案 B).
// ---------------------------------------------------------------------------

export interface NpcPublicProjection {
  actorId: string;
  name: string;
  kind: 'npc' | 'creature';
  /** Known impression: the card's public description. */
  description?: string;
  morale?: 'low' | 'steady' | 'fierce';
  retreatThreshold?: number;
  /** Skills whose package entry is public — the ones the player can know. */
  observedSkills: Array<{ skillId: string; name: string }>;
  /** How many card skills stayed hidden (rendered as 未探明 rows). */
  unknownSkillCount: number;
  /** Runtime facts, only when the actor is legitimately observable. */
  visibleConditions: string[];
  lifeStatus: 'active' | 'incapacitated' | 'critical' | 'dead' | null;
  /** The actor's relationship toward the player, when one exists. */
  relationship: RelationshipView | null;
  /** Sections that stay hidden; the UI renders these as 未探明. */
  unknownSections: string[];
}

export interface NpcProjectionInput {
  /** Raw card from `actor_cards` (never the degraded summary card). */
  actor: ActorCard;
  state: GameStateSnapshot;
  playerActorId: string | null;
  entries: readonly ContentEntry[];
}

/**
 * True when the player could legitimately observe this actor: it takes part in
 * an active encounter or it stands in the player's current location.
 */
export function isActorObservable(
  state: GameStateSnapshot,
  actorId: string,
  playerActorId: string | null,
): boolean {
  const inActiveEncounter = (state.encounters ?? []).some(
    entry =>
      entry.state.status === 'active' &&
      Object.prototype.hasOwnProperty.call(entry.state.actors, actorId),
  );
  if (inActiveEncounter) return true;
  if (!playerActorId) return false;
  const playerState = state.actors[playerActorId];
  const actorState = state.actors[actorId];
  return Boolean(playerState && actorState && playerState.locationId === actorState.locationId);
}

/**
 * Builds the public NPC view. Everything GM-only (attributes, abilities,
 * prepared slots, resource maxima, hidden skill ids/templates) is dropped, not
 * blanked — the UI shows "未探明" placeholders from `unknownSections`.
 */
export function buildNpcPublicProjection(input: NpcProjectionInput): NpcPublicProjection {
  const index = buildEntryIndex(input.entries);
  const { actor, state } = input;

  const observedSkills: Array<{ skillId: string; name: string }> = [];
  let unknownSkillCount = 0;
  for (const skillId of Object.keys(actor.skills)) {
    const resolved = skillEntryId(index, skillId);
    const visibility = resolved ? index.visibilityOf(resolved) : null;
    if (resolved && visibility === 'public') {
      observedSkills.push({ skillId: resolved, name: index.nameOf(resolved) });
    } else {
      unknownSkillCount += 1;
    }
  }

  const observable = isActorObservable(state, actor.actorId, input.playerActorId);
  const actorState = state.actors[actor.actorId];
  const relationship = input.playerActorId
    ? (state.relationships ?? []).find(
        rel =>
          (rel.fromActorId === actor.actorId && rel.toActorId === input.playerActorId) ||
          (rel.fromActorId === input.playerActorId && rel.toActorId === actor.actorId),
      ) ?? null
    : null;

  const unknownSections: string[] = ['attributes', 'abilities', 'equipment'];
  if (unknownSkillCount > 0) unknownSections.push('skills');
  if (!observable) unknownSections.push('conditions');

  return {
    actorId: actor.actorId,
    name: actor.name,
    kind: actor.kind === 'creature' ? 'creature' : 'npc',
    ...(actor.description ? { description: actor.description } : {}),
    ...(actor.combatBehavior
      ? { morale: actor.combatBehavior.morale, retreatThreshold: actor.combatBehavior.retreatThreshold }
      : {}),
    observedSkills,
    unknownSkillCount,
    visibleConditions: observable ? [...(actorState?.conditions ?? [])] : [],
    lifeStatus: observable ? actorState?.lifeStatus ?? 'active' : null,
    relationship: relationship
      ? {
          relId: relationship.relId,
          fromActorId: relationship.fromActorId,
          toActorId: relationship.toActorId,
          stance: relationship.stance,
          closeness: relationship.closeness,
          updatedTurnId: relationship.updatedTurnId,
        }
      : null,
    unknownSections,
  };
}

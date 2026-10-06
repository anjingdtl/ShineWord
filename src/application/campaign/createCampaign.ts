import type { AttributeName, SkillRank } from '../../domain/rules/types';
import { cloneGameState, type GameStateSnapshot } from '../../domain/state/types';
import type { ActorCard, CompanionDirective, SkillCatalog } from '../../domain/characters/card';
import type { ActorTemplateDefinition, ContentEntry, OriginDefinition, SkillDefinition } from '../../domain/content/types';
import type { SqliteDatabase } from '../ports/sqlite';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import { createOriginalCard, createTemplateCard } from '../../domain/characters/card';
import { buildOpening, isFactVisibleAtAnchor } from '../world/opening';
import { isEntryVisibleAtAnchor, isPlayerRecruitmentCandidate, isTemplateValidAtAnchor, openingRelationshipFor } from './recruitment';
import { createBaseContentManifest } from '../worldPackage/contentManifest';
import { hasBranchContentManifestTable, insertBranchContentManifest } from '../worldPackage/branchContentStore';
import { requireCompiledRules } from '../content/runtimeRules';
import type { CampaignContentArtifactV1, CampaignIntentV1, CampaignPlanV1 } from '../../domain/campaignPlan/types';
import { evaluateCampaignProgress } from '../../domain/campaignPlan/progressReducer';
import { applySituationRuntime } from '../situations/causalProjection';
import { emptyRuntimeForPlan } from '../../domain/campaignPlan/types';
import type { SqliteCampaignPlanStore } from '../../infra/sqlite/sqliteCampaignPlanStore';

export interface OpeningAnchor {
  /** World-time order the game starts at (canon events after this diverge). */
  worldTimeOrder: number;
  /** Anchor event id in the canon (optional for original-only worlds). */
  anchorEventId?: string;
  /** Start location id. */
  locationId: string;
}

export interface CompanionSpec {
  actorId: string;
  templateId: string;
  directive?: CompanionDirective;
}

export interface CreateCampaignInput {
  db: SqliteDatabase;
  worldStore: SqliteWorldStore;
  campaignId: string;
  title: string;
  worldId: string;
  /** Must reference a PUBLISHED package revision; the campaign locks it. */
  packageRevision: number;
  anchor: OpeningAnchor;
  protagonist: {
    actorId: string;
    kind: 'original' | 'canon';
    name: string;
    description?: string;
    attributes?: Record<AttributeName, number>;
    initialSkills?: string[];
    preparedAbilities?: string[];
    learnedAbilities?: string[];
    originId?: string;
    pathId?: string;
    /** Canon protagonist: the world entity to derive from. */
    canonEntityId?: string;
  };
  companions?: CompanionSpec[];
  goal: string;
  createdAt: string;
  /**
   * P9: adopt a validated campaign plan atomically with campaign creation
   * (plan §6.4). The plan/artifact/runtime land in the SAME transaction; the
   * adoption pass activates the start node before the v0 snapshot is written.
   */
  adoption?: {
    planStore: SqliteCampaignPlanStore;
    plan: CampaignPlanV1;
    intent: CampaignIntentV1;
    artifact: CampaignContentArtifactV1;
    sourceTrigger: string;
  };
}

export interface CreatedCampaign {
  campaignId: string;
  branchId: string;
  snapshot: GameStateSnapshot;
  cards: ActorCard[];
}

function branchIdFor(campaignId: string): string {
  return `${campaignId}-main`;
}

function cardSkillRows(card: ActorCard): Array<{ actorId: string; skillId: string; rank: SkillRank }> {
  return Object.entries(card.skills).map(([skillId, rank]) => ({
    actorId: card.actorId,
    skillId,
    rank,
  }));
}

/**
 * Creates a campaign in ONE transaction (plan §10.1): dependency lock,
 * opening anchor, party, cards, initial resources, known location, main
 * goal, first branch and the complete version-0 snapshot. Version
 * dependencies are validated up front - a missing package stops creation
 * instead of falling back to a demo world.
 */
export async function createCampaign(input: CreateCampaignInput): Promise<CreatedCampaign> {
  const companions = input.companions ?? [];
  if (companions.length > 2) throw new Error('每支队伍最多可招募两名同伴。');
  const companionActorIds = new Set<string>();
  for (const companion of companions) {
    if (companion.directive && !['follow', 'support', 'protect', 'conserve', 'retreat'].includes(companion.directive)) {
      throw new Error(`未知的同伴指令：${String(companion.directive)}。`);
    }
    if (!companion.actorId.trim() || companion.actorId === input.protagonist.actorId || companionActorIds.has(companion.actorId)) {
      throw new Error(`同伴角色 ID 无效或重复：${companion.actorId}。`);
    }
    companionActorIds.add(companion.actorId);
  }
  const pkg = await input.worldStore.getWorldPackage(input.worldId, input.packageRevision);
  if (!pkg) throw new Error(`World package not found: ${input.worldId} r${input.packageRevision}.`);
  const rules = requireCompiledRules(pkg.manifest.ruleConfiguration);
  if (pkg.manifest.status !== 'published') {
    throw new Error(`World package r${input.packageRevision} is ${pkg.manifest.status}, not published.`);
  }
  if (!Number.isFinite(input.anchor.worldTimeOrder)) {
    throw new Error('Campaign creation requires a finite story-time anchor.');
  }
  const anchorEvents = (await input.worldStore.listEvents(input.worldId))
    .filter(event => event.status === 'canon' && event.worldTimeOrder !== null);
  if (pkg.manifest.buildScope?.openingWorldTimeOrder !== undefined
    && input.anchor.worldTimeOrder < pkg.manifest.buildScope.openingWorldTimeOrder) {
    throw new Error('精准开局资料代表当前已读前部的状态，请选择本批资料最新的已验证事件锚点。');
  }

  if (input.anchor.anchorEventId) {
    const selectedAnchor = anchorEvents.find(event => event.eventId === input.anchor.anchorEventId);
    if (!selectedAnchor || selectedAnchor.worldTimeOrder !== input.anchor.worldTimeOrder) {
      throw new Error('开局锚点必须引用当前世界中对应时间顺序的原著事件。');
    }
  } else if (anchorEvents.length > 0) {
    throw new Error('这个世界已有原著时间锚点；开局必须选择一个真实事件。');
  }

  const world = await input.worldStore.getWorld(input.worldId);
  if (!world) throw new Error(`Unknown world: ${input.worldId}.`);
  const entities = await input.worldStore.listEntities(input.worldId);
  const facts = await input.worldStore.listFacts(input.worldId);
  const projectionFacts = facts;
  const visibleSceneEntries = pkg.entries.filter(entry => entry.kind === 'scene'
    && entry.visibility === 'public' && isEntryVisibleAtAnchor(entry, projectionFacts, input.anchor.worldTimeOrder));
  const visibleCanonLocations = entities.filter(entity => entity.type === 'location'
    && projectionFacts.some(fact => fact.subjectEntityId === entity.entityId && fact.status !== 'speculation'
      && fact.status !== 'conflict' && isFactVisibleAtAnchor(fact, input.anchor.worldTimeOrder)));
  const allowedLocations = new Set([
    ...visibleSceneEntries
      .map(entry => (entry.definition as { locationId?: string }).locationId)
      .filter((value): value is string => typeof value === 'string'),
    ...visibleCanonLocations.flatMap(entity => [entity.entityId, entity.name]),
  ]);
  if (allowedLocations.size === 0) {
    throw new Error('锁定世界包和原著都没有当前时间锚点可用的公开开局地点，拒绝创建战役。');
  }
  if (!allowedLocations.has(input.anchor.locationId)) {
    throw new Error(`开局地点「${input.anchor.locationId}」不属于锁定世界包或原著地点。`);
  }
  if ((input.companions?.length ?? 0) > 0 && !pkg.manifest.ruleConfiguration.modules.some(m => m.moduleId === 'social_relationships')) throw new Error('Initial companions require social_relationships.');
  // Opening projections and server-side factories share the same player-safe
  // catalog. A client cannot name a GM-only skill directly in createCampaign.
  const skillEntries = pkg.entries.filter(entry => entry.kind === 'skill' && entry.visibility === 'public'
    && isEntryVisibleAtAnchor(entry, projectionFacts, input.anchor.worldTimeOrder));
  const catalog: SkillCatalog = {};
  for (const entry of skillEntries) {
    catalog[entry.entryId] = entry.definition as SkillDefinition;
    const bare = entry.entryId.replace(/^skill-/, '');
    if (bare !== entry.entryId && catalog[bare] === undefined) catalog[bare] = entry.definition as SkillDefinition;
  }
  const publicAbilityIds = new Set(pkg.entries
    .filter(entry => entry.kind === 'ability' && entry.visibility === 'public'
      && isEntryVisibleAtAnchor(entry, projectionFacts, input.anchor.worldTimeOrder))
    .flatMap(entry => [entry.entryId, entry.entryId.replace(/^ability-/, '')]));
  const publicSkillIds = new Set(Object.keys(catalog));
  const publicOriginIds = new Set(pkg.entries.filter(entry => entry.kind === 'origin' && entry.visibility === 'public'
    && isEntryVisibleAtAnchor(entry, projectionFacts, input.anchor.worldTimeOrder)).map(entry => entry.entryId));
  const publicPathIds = new Set(pkg.entries.filter(entry => entry.kind === 'path' && entry.visibility === 'public'
    && isEntryVisibleAtAnchor(entry, projectionFacts, input.anchor.worldTimeOrder)).map(entry => entry.entryId));

  const templateEntries = new Map<string, ContentEntry>();
  for (const entry of pkg.entries) {
    if (entry.kind === 'actor_template') templateEntries.set(entry.entryId, entry);
  }

  const branchId = branchIdFor(input.campaignId);

  const actors: GameStateSnapshot['actors'] = {};
  const cards: ActorCard[] = [];

  // Protagonist card.
  let protagonistCard: ActorCard;
  if (input.protagonist.kind === 'original') {
    if (!input.protagonist.attributes || !input.protagonist.initialSkills) {
      throw new Error('Original protagonists require attributes and initial skills.');
    }
    if (input.protagonist.originId && !publicOriginIds.has(input.protagonist.originId)) {
      throw new Error(`开局出身 ${input.protagonist.originId} 不存在、不可公开或在该时间锚点尚不可用。`);
    }
    if (input.protagonist.pathId && !publicPathIds.has(input.protagonist.pathId)) {
      throw new Error(`开局路径 ${input.protagonist.pathId} 不存在、不可公开或在该时间锚点尚不可用。`);
    }
    for (const abilityId of [...(input.protagonist.learnedAbilities ?? []), ...(input.protagonist.preparedAbilities ?? [])]) {
      if (!publicAbilityIds.has(abilityId)) {
        throw new Error(`开局能力 ${abilityId} 不存在、不可公开或在该时间锚点尚不可用。`);
      }
    }
    protagonistCard = createOriginalCard({
      actorId: input.protagonist.actorId,
      name: input.protagonist.name,
      worldId: input.worldId,
      worldPackageRevision: input.packageRevision,
      attributes: input.protagonist.attributes,
      initialSkills: input.protagonist.initialSkills,
      description: input.protagonist.description,
      preparedAbilities: input.protagonist.preparedAbilities,
      learnedAbilities: input.protagonist.learnedAbilities,
      originId: input.protagonist.originId,
      pathId: input.protagonist.pathId,
    }, catalog);
    protagonistCard.abilities = protagonistCard.abilities.filter(abilityId => publicAbilityIds.has(abilityId));
    protagonistCard.preparedAbilities = protagonistCard.preparedAbilities.filter(abilityId => publicAbilityIds.has(abilityId));
  } else {
    if (!input.protagonist.canonEntityId) {
      throw new Error('Canon protagonists require a canon entity id.');
    }
    const entity = await input.worldStore.getEntity(input.worldId, input.protagonist.canonEntityId);
    if (!entity) throw new Error(`Canon entity not found: ${input.protagonist.canonEntityId}.`);
    if (!projectionFacts.some(fact => fact.subjectEntityId === entity.entityId && fact.status !== 'speculation'
      && fact.status !== 'conflict' && isFactVisibleAtAnchor(fact, input.anchor.worldTimeOrder))) {
      throw new Error(`原著角色 ${input.protagonist.canonEntityId} 在该时间锚点没有已揭露的支持事实。`);
    }
    const mappings = await input.worldStore.listRuleMappings(input.worldId);
    const opening = buildOpening({
      branchId,
      actorId: input.protagonist.actorId,
      displayName: input.protagonist.name,
      kind: 'canon',
      worldTimeOrder: input.anchor.worldTimeOrder,
      canonEntity: entity,
      fallbackLocationId: input.anchor.locationId,
    }, { facts: projectionFacts, mappings });
    protagonistCard = {
      actorId: input.protagonist.actorId,
      name: input.protagonist.name,
      kind: 'canon',
      controller: 'player',
      entityId: entity.entityId,
      attributes: opening.profile.attributes,
      skills: opening.profile.skillRanks,
      abilities: [],
      preparedAbilities: [],
      resourceMax: { hp: 10, stamina: 10 },
      defense: 2,
      powerTier: 'ordinary',
      rulesetId: opening.profile.rulesetId,
      rulesetVersion: opening.profile.rulesetVersion,
      worldId: input.worldId,
      worldPackageRevision: input.packageRevision,
      cardRevision: 1,
      description: input.protagonist.description?.trim() || entity.name,
    };
    protagonistCard.skills = Object.fromEntries(Object.entries(protagonistCard.skills)
      .filter(([skillId]) => publicSkillIds.has(skillId)));
  }
  cards.push(protagonistCard);

  // Companion cards from actor templates.
  const relationships: NonNullable<GameStateSnapshot['relationships']> = [];
  const itemOwners: Record<string, string> = {};
  const itemSources: NonNullable<GameStateSnapshot['itemSources']> = {};
  const entryById = new Map(pkg.entries.map(entry => [entry.entryId, entry]));
  if (input.protagonist.kind === 'original' && input.protagonist.originId) {
    const originEntry = entryById.get(input.protagonist.originId);
    if (!originEntry || originEntry.kind !== 'origin' || originEntry.visibility !== 'public'
      || !isEntryVisibleAtAnchor(originEntry, projectionFacts, input.anchor.worldTimeOrder)) {
      throw new Error(`开局出身 ${input.protagonist.originId} 在当前锚点不可用。`);
    }
    const origin = originEntry.definition as OriginDefinition;
    for (const itemId of origin.startingItems) {
      const itemEntry = entryById.get(itemId);
      if (!itemEntry || itemEntry.kind !== 'item' || itemEntry.visibility !== 'public'
        || !isEntryVisibleAtAnchor(itemEntry, projectionFacts, input.anchor.worldTimeOrder)) {
        throw new Error(`出身 ${input.protagonist.originId} 的起始物品 ${itemId} 不存在、不可公开或当前不可用。`);
      }
      if (itemOwners[itemId] !== undefined) {
        throw new Error(`初始物品 ${itemId} 已归属其他角色，不能重复生成。`);
      }
      itemOwners[itemId] = input.protagonist.actorId;
      itemSources[itemId] = {
        kind: 'starting_loadout', sourceId: input.protagonist.originId, obtainedAtStateVersion: 0,
      };
    }
  }
  for (const companion of companions) {
    const templateEntry = templateEntries.get(companion.templateId);
    if (!templateEntry) {
      throw new Error(`Unknown companion template: ${companion.templateId}.`);
    }
    if (templateEntry.visibility !== 'public'
      || !isPlayerRecruitmentCandidate(templateEntry, projectionFacts, input.anchor.worldTimeOrder)
      || !openingRelationshipFor(templateEntry, input.anchor.worldTimeOrder)) {
      throw new Error(`同伴模板 ${companion.templateId} 在此开局锚点不可招募，或缺少公开的资格/关系依据。`);
    }
    const recruitment = (templateEntry.definition as ActorTemplateDefinition).recruitment!;
    const card = createTemplateCard({
      actorId: companion.actorId,
      worldId: input.worldId,
      worldPackageRevision: input.packageRevision,
      templateId: companion.templateId,
      definition: templateEntry.definition as ActorTemplateDefinition,
      controller: 'companion',
      kind: 'companion',
    });
    card.skills = Object.fromEntries(Object.entries(card.skills)
      .filter(([skillId]) => publicSkillIds.has(skillId)));
    card.combatAttacks = card.combatAttacks?.filter(attack =>
      publicSkillIds.has(attack.skillId) && catalog[attack.skillId]?.usage === 'attack');
    card.abilities = card.abilities.filter(abilityId => publicAbilityIds.has(abilityId));
    card.preparedAbilities = [...card.abilities];
    card.companionLeaderActorId = input.protagonist.actorId;
    if (companion.directive) card.companionDirective = companion.directive;
    cards.push(card);

    const openingRelationship = recruitment.openingRelationship!;
    relationships.push({
      relId: `rel-${companion.actorId}-${input.protagonist.actorId}`,
      fromActorId: companion.actorId,
      toActorId: input.protagonist.actorId,
      stance: openingRelationship.stance,
      closeness: openingRelationship.closeness,
      updatedTurnId: null,
    });
    for (const itemId of (templateEntry.definition as ActorTemplateDefinition).startingItems ?? []) {
      const itemEntry = entryById.get(itemId);
      if (!itemEntry || itemEntry.kind !== 'item' || itemEntry.visibility !== 'public'
        || !isEntryVisibleAtAnchor(itemEntry, projectionFacts, input.anchor.worldTimeOrder)) {
        throw new Error(`同伴 ${companion.templateId} 的初始物品 ${itemId} 不存在或不可公开。`);
      }
      if (itemOwners[itemId] !== undefined) {
        throw new Error(`初始物品 ${itemId} 已归属其他角色，不能重复生成。`);
      }
      itemOwners[itemId] = card.actorId;
      itemSources[itemId] = { kind: 'starting_loadout', sourceId: companion.templateId, obtainedAtStateVersion: 0 };
    }
  }

  // Instantiate the locked opening scene's NPCs as branch actors, never as
  // party members. Their full card remains server-side for deterministic
  // rules; player projections later expose only a public name/presence.
  const openingSceneEntries = visibleSceneEntries.filter(entry =>
    (entry.definition as { locationId?: string }).locationId === input.anchor.locationId);
  const openingActorTemplateIds = new Set(openingSceneEntries.flatMap(entry =>
    (entry.definition as import('../../domain/content/types').SceneDefinition).actors));
  for (const templateId of openingActorTemplateIds) {
    const templateEntry = templateEntries.get(templateId);
    if (!templateEntry) continue; // Non-template scene actor IDs can be canon references.
    if (!isEntryVisibleAtAnchor(templateEntry, projectionFacts, input.anchor.worldTimeOrder)
      || !isTemplateValidAtAnchor(templateEntry, input.anchor.worldTimeOrder)) continue;
    // A canon protagonist and their public template represent the same person.
    const templateName = (templateEntry.definition as ActorTemplateDefinition).name;
    const supportedSubjects = new Set(templateEntry.provenance.sourceFactIds.flatMap(id => {
      const fact = projectionFacts.find(f => f.factId === id);
      return fact?.subjectEntityId ? [fact.subjectEntityId] : [];
    }));
    if (protagonistCard.entityId && supportedSubjects.size === 1 && supportedSubjects.has(protagonistCard.entityId)
      && templateName === protagonistCard.name) continue;
    const actorId = `npc-${templateId}`;
    if (cards.some(card => card.actorId === actorId) || actorId === input.protagonist.actorId) {
      throw new Error(`开局场景 NPC 角色 ID 冲突：${actorId}。`);
    }
    const definition = templateEntry.definition as ActorTemplateDefinition;
    const card = createTemplateCard({
      actorId,
      worldId: input.worldId,
      worldPackageRevision: input.packageRevision,
      templateId,
      definition,
      controller: 'gm',
      kind: 'npc',
    });
    cards.push(card);
    relationships.push({
      relId: `rel-${actorId}-${input.protagonist.actorId}`,
      fromActorId: actorId,
      toActorId: input.protagonist.actorId,
      stance: 'neutral',
      closeness: 0,
      updatedTurnId: null,
    });
    for (const itemId of definition.startingItems ?? []) {
      const itemEntry = entryById.get(itemId);
      if (!itemEntry || itemEntry.kind !== 'item' || itemEntry.visibility !== 'public'
        || !isEntryVisibleAtAnchor(itemEntry, projectionFacts, input.anchor.worldTimeOrder)) {
        throw new Error(`场景角色 ${templateId} 的初始物品 ${itemId} 不存在。`);
      }
      if (itemOwners[itemId] !== undefined) {
        throw new Error(`初始物品 ${itemId} 已归属其他角色，不能重复生成。`);
      }
      itemOwners[itemId] = actorId;
      itemSources[itemId] = { kind: 'starting_loadout', sourceId: templateId, obtainedAtStateVersion: 0 };
    }
  }

  const partyCards = cards.filter(card => card.controller === 'player' || card.kind === 'companion');

  const resourceParameters = pkg.manifest.ruleConfiguration.modules.find(m => m.moduleId === 'resources_conditions')?.parameters;
  for (const card of cards) {
    if (typeof resourceParameters?.hpMax === 'number') card.resourceMax.hp = resourceParameters.hpMax;
    if (typeof resourceParameters?.staminaMax === 'number') card.resourceMax.stamina = resourceParameters.staminaMax;
  }

  const snapshot: GameStateSnapshot = {
    branchId,
    stateVersion: 0,
    ruleConfiguration: JSON.parse(JSON.stringify(pkg.manifest.ruleConfiguration)),
    ...(rules.binding.moduleVersions.some(m => m.moduleId === 'pressure_track') ? {
      pressureTracks: { tension: { level: 0, maxLevel: Number(pkg.manifest.ruleConfiguration.modules.find(m => m.moduleId === 'pressure_track')?.parameters.maxLevel ?? 4) } },
    } : {}),
    clockSeconds: 0,
    clockMinutes: 0,
    actors: {},
    itemOwners,
    itemSources,
    encounters: [],
    discoveries: [],
    questProgress: pkg.entries
      .filter(entry => entry.kind === 'quest')
      .map(entry => ({
        questId: entry.entryId,
        status: 'available' as const,
        counters: {},
        updatedStateVersion: 0,
        completedStateVersion: null,
      })),
    questRewards: [],
    // Complete v0 snapshot: cards and party membership belong to the branch
    // timeline, so a historical fork restores them from snapshots instead of
    // copying the source branch's current rows (P2 acceptance A03).
    cards: cards.map(card => ({ actorId: card.actorId, card })),
    skills: cards.flatMap(card => Object.entries(card.skills).map(([skillId, rank]) => ({
      actorId: card.actorId,
      skillId,
      rank,
      practicePoints: 0,
      awardedKeys: [],
    }))),
    relationships,
    party: partyCards.map(card => ({
      actorId: card.actorId,
      controller: card.controller,
      role: card.controller === 'player' ? 'protagonist' : 'companion',
      joinedAt: input.createdAt,
      groupId: 'main',
    })),
  };
  if (await hasBranchContentManifestTable(input.db)) {
    snapshot.contentManifest = createBaseContentManifest({
      worldId: input.worldId,
      branchId,
      stateVersion: 0,
      basePackage: { revision: input.packageRevision, contentHash: pkg.manifest.contentHash },
    });
  }
  // P9 adoption pass: initial mainline runtime is part of the creation
  // transaction — the start node activates from evaluated conditions, never
  // from model claims, and the content artifact binds to the branch snapshot.
  if (input.adoption) {
    // Initialize the campaign situations (activation tick) BEFORE progress
    // evaluation, so the first turn already offers the stage's methods.
    const situationRuntime = applySituationRuntime({
      definitions: input.adoption.artifact.situations.map(situation => ({
        situationId: situation.entryId,
        definition: situation.definition,
      })),
      nextState: snapshot,
      sourceTurnId: `${branchId}:adoption`,
      playerActorId: input.protagonist.actorId,
      methodOps: [],
    });
    snapshot.situations = situationRuntime.situations;
    const runtime = emptyRuntimeForPlan({
      branchId, plan: input.adoption.plan, intentRevision: input.adoption.intent.intentRevision,
      stateVersion: 0, playerActorId: input.protagonist.actorId,
    });
    const adoptionPass = evaluateCampaignProgress({
      plan: input.adoption.plan,
      runtime,
      state: snapshot,
      transactionEvents: [],
      historyEvents: [],
      artifact: input.adoption.artifact,
      turnId: `${branchId}:adoption`,
      nextStateVersion: 0,
    });
    // A plan whose ENDING condition already holds at the opening creates a
    // dead-on-arrival campaign — refuse adoption (found in real GLM journey
    // J1: ending-caught fired at the adoption pass itself).
    if (adoptionPass.runtime.ending) {
      throw new Error(`提案的结局「${adoptionPass.runtime.ending.title}」在开局状态即成立，拒绝采用该提案；请重新生成。`);
    }
    snapshot.campaignRuntime = adoptionPass.runtime;
    snapshot.campaignContentBinding = {
      artifactIds: [input.adoption.artifact.artifactId],
      contentHash: input.adoption.artifact.contentHash,
    };
  }
  for (const card of cards) {
    const sceneEntry = pkg.entries.find(entry => entry.kind === 'scene' &&
      (entry.definition as { locationId?: string }).locationId === input.anchor.locationId);
    const initialZoneId = sceneEntry
      ? ((sceneEntry.definition as { zones?: Array<{ zoneId: string }> }).zones?.[0]?.zoneId)
      : undefined;
    snapshot.actors[card.actorId] = {
      actorId: card.actorId,
      locationId: input.anchor.locationId,
      ...(initialZoneId ? { zoneId: initialZoneId } : {}),
      resources: { ...card.resourceMax },
      conditions: [],
      lifeStatus: 'active',
    };
  }

  await input.db.transaction(async tx => {
    const campaignExists = await tx.queryOne('SELECT campaign_id FROM campaigns WHERE campaign_id = ?', [input.campaignId]);
    if (campaignExists) throw new Error(`Campaign already exists: ${input.campaignId}.`);
    const branchExists = await tx.queryOne('SELECT branch_id FROM branches WHERE branch_id = ?', [branchId]);
    if (branchExists) throw new Error(`Branch already exists: ${branchId}.`);

    await tx.execute(
      `INSERT INTO campaigns
        (campaign_id, world_id, title, ruleset_id, ruleset_version, world_mapping_version,
         opening_json, created_at, package_revision, anchor_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        input.campaignId,
        input.worldId,
        input.title,
        pkg.manifest.ruleset.id,
        pkg.manifest.ruleset.version,
        pkg.manifest.mappingVersion,
        JSON.stringify({ goal: input.goal, protagonistActorId: input.protagonist.actorId }),
        input.createdAt,
        input.packageRevision,
        JSON.stringify(input.anchor),
      ],
    );
    await tx.execute(
      `INSERT INTO branches (branch_id, campaign_id, parent_branch_id, fork_turn_id, state_version, created_at)
       VALUES (?, ?, NULL, NULL, 0, ?)`,
      [branchId, input.campaignId, input.createdAt],
    );
    if (snapshot.contentManifest) await insertBranchContentManifest(tx, snapshot.contentManifest, input.createdAt);
    for (const card of cards) {
      const actor = snapshot.actors[card.actorId]!;
      await tx.execute(
        `INSERT INTO actor_states (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
         VALUES (?, ?, 0, ?, ?, '[]')`,
        [branchId, card.actorId, actor.locationId, JSON.stringify(actor.resources)],
      );
      await tx.execute(
        `INSERT INTO actor_cards (branch_id, actor_id, card_json, created_at, updated_at, updated_state_version)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [branchId, card.actorId, JSON.stringify(card), input.createdAt, input.createdAt],
      );
      if (partyCards.some(member => member.actorId === card.actorId)) {
        await tx.execute(
          `INSERT INTO party_members (branch_id, actor_id, controller, role, joined_at, party_group_id)
           VALUES (?, ?, ?, ?, ?, 'main')`,
          [branchId, card.actorId, card.controller, card.controller === 'player' ? 'protagonist' : 'companion', input.createdAt],
        );
      }
      for (const skill of cardSkillRows(card)) {
        await tx.execute(
          `INSERT INTO actor_skills (branch_id, actor_id, skill_id, rank, practice_points, awarded_turns_json, state_version)
           VALUES (?, ?, ?, ?, 0, '[]', 0)`,
          [branchId, skill.actorId, skill.skillId, skill.rank],
        );
      }
    }
    for (const relationship of relationships) {
      await tx.execute(
        `INSERT INTO relationships (branch_id, rel_id, from_actor_id, to_actor_id, stance, closeness, updated_turn_id, state_version)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 0)`,
        [branchId, relationship.relId, relationship.fromActorId, relationship.toActorId, relationship.stance, relationship.closeness],
      );
    }
    for (const [itemId, ownerActorId] of Object.entries(itemOwners)) {
      await tx.execute(
        'INSERT INTO inventory (branch_id, item_id, owner_actor_id, state_version) VALUES (?, ?, ?, 0)',
        [branchId, itemId, ownerActorId],
      );
    }
    for (const quest of snapshot.questProgress ?? []) {
      await tx.execute(
        `INSERT INTO quest_states
          (branch_id, quest_id, status, counters_json, updated_state_version, completed_state_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, NULL, ?, ?)`,
        [branchId, quest.questId, quest.status, JSON.stringify(quest.counters), input.createdAt, input.createdAt],
      );
    }
    await tx.execute(
      `INSERT INTO snapshots (branch_id, state_version, snapshot_json, state_hash, created_at)
       VALUES (?, 0, ?, NULL, ?)`,
      [branchId, JSON.stringify(snapshot), input.createdAt],
    );
    if (input.adoption) {
      await input.adoption.planStore.archivePlanRevision(tx, {
        plan: input.adoption.plan,
        intent: input.adoption.intent,
        setupId: input.adoption.intent.setupId,
        campaignId: input.campaignId,
        sourceTrigger: input.adoption.sourceTrigger,
        intentHash: input.adoption.plan.intentHash,
        adoptedAt: input.createdAt,
      });
      await input.adoption.planStore.archiveArtifact(tx, input.adoption.artifact, input.createdAt);
    }
  });

  return { campaignId: input.campaignId, branchId, snapshot: cloneGameState(snapshot), cards };
}

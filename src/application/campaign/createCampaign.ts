import type { AttributeName, SkillRank } from '../../domain/rules/types';
import { cloneGameState, type GameStateSnapshot } from '../../domain/state/types';
import type { ActorCard, SkillCatalog } from '../../domain/characters/card';
import type { ActorTemplateDefinition, ContentEntry, SkillDefinition } from '../../domain/content/types';
import type { SqliteDatabase } from '../ports/sqlite';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import { createOriginalCard, createTemplateCard } from '../../domain/characters/card';
import { buildOpening } from '../world/opening';

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
  const pkg = await input.worldStore.getWorldPackage(input.worldId, input.packageRevision);
  if (!pkg) throw new Error(`World package not found: ${input.worldId} r${input.packageRevision}.`);
  if (pkg.manifest.status !== 'published') {
    throw new Error(`World package r${input.packageRevision} is ${pkg.manifest.status}, not published.`);
  }

  const skillEntries = pkg.entries.filter(entry => entry.kind === 'skill');
  const catalog: SkillCatalog = {};
  for (const entry of skillEntries) {
    catalog[entry.entryId] = entry.definition as SkillDefinition;
  }

  const templateEntries = new Map<string, ContentEntry>();
  for (const entry of pkg.entries) {
    if (entry.kind === 'actor_template') templateEntries.set(entry.entryId, entry);
  }

  const branchId = branchIdFor(input.campaignId);
  const world = await input.worldStore.getWorld(input.worldId);
  if (!world) throw new Error(`Unknown world: ${input.worldId}.`);

  const actors: GameStateSnapshot['actors'] = {};
  const cards: ActorCard[] = [];

  // Protagonist card.
  let protagonistCard: ActorCard;
  if (input.protagonist.kind === 'original') {
    if (!input.protagonist.attributes || !input.protagonist.initialSkills) {
      throw new Error('Original protagonists require attributes and initial skills.');
    }
    protagonistCard = createOriginalCard({
      actorId: input.protagonist.actorId,
      name: input.protagonist.name,
      worldId: input.worldId,
      worldPackageRevision: input.packageRevision,
      attributes: input.protagonist.attributes,
      initialSkills: input.protagonist.initialSkills,
      preparedAbilities: input.protagonist.preparedAbilities,
      learnedAbilities: input.protagonist.learnedAbilities,
      originId: input.protagonist.originId,
      pathId: input.protagonist.pathId,
    }, catalog);
  } else {
    if (!input.protagonist.canonEntityId) {
      throw new Error('Canon protagonists require a canon entity id.');
    }
    const entity = await input.worldStore.getEntity(input.worldId, input.protagonist.canonEntityId);
    if (!entity) throw new Error(`Canon entity not found: ${input.protagonist.canonEntityId}.`);
    const facts = await input.worldStore.listFacts(input.worldId);
    const mappings = await input.worldStore.listRuleMappings(input.worldId);
    const opening = buildOpening({
      branchId,
      actorId: input.protagonist.actorId,
      displayName: input.protagonist.name,
      kind: 'canon',
      worldTimeOrder: input.anchor.worldTimeOrder,
      canonEntity: entity,
    }, { facts, mappings });
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
      description: entity.name,
    };
  }
  cards.push(protagonistCard);

  // Companion cards from actor templates.
  for (const companion of input.companions ?? []) {
    const templateEntry = templateEntries.get(companion.templateId);
    if (!templateEntry) {
      throw new Error(`Unknown companion template: ${companion.templateId}.`);
    }
    cards.push(createTemplateCard({
      actorId: companion.actorId,
      worldId: input.worldId,
      worldPackageRevision: input.packageRevision,
      templateId: companion.templateId,
      definition: templateEntry.definition as ActorTemplateDefinition,
      controller: 'companion',
      kind: 'companion',
    }));
  }

  const snapshot: GameStateSnapshot = {
    branchId,
    stateVersion: 0,
    clockSeconds: 0,
    clockMinutes: 0,
    actors: {},
    itemOwners: {},
  };
  for (const card of cards) {
    snapshot.actors[card.actorId] = {
      actorId: card.actorId,
      locationId: input.anchor.locationId,
      resources: { ...card.resourceMax },
      conditions: [],
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
      await tx.execute(
        `INSERT INTO party_members (branch_id, actor_id, controller, role, joined_at)
         VALUES (?, ?, ?, ?, ?)`,
        [branchId, card.actorId, card.controller, card.controller === 'player' ? 'protagonist' : 'companion', input.createdAt],
      );
      for (const skill of cardSkillRows(card)) {
        await tx.execute(
          `INSERT INTO actor_skills (branch_id, actor_id, skill_id, rank, practice_points, awarded_turns_json, state_version)
           VALUES (?, ?, ?, ?, 0, '[]', 0)`,
          [branchId, skill.actorId, skill.skillId, skill.rank],
        );
      }
    }
    await tx.execute(
      `INSERT INTO snapshots (branch_id, state_version, snapshot_json, state_hash, created_at)
       VALUES (?, 0, ?, NULL, ?)`,
      [branchId, JSON.stringify(snapshot), input.createdAt],
    );
  });

  return { campaignId: input.campaignId, branchId, snapshot: cloneGameState(snapshot), cards };
}

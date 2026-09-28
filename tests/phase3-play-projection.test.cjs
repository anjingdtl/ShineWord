/**
 * P4.1 regression: read-only play projections (plan §16.3).
 *
 * Covers the five required properties:
 *   1. the player projection is complete,
 *   2. current party members are complete,
 *   3. actors who left the party are not leaked,
 *   4. GM-only NPC fields are not leaked,
 *   5. public NPC fields are visible, and every list shares one stateVersion.
 *
 * The test runs against the compiled core module
 * (`dist/application/campaign/playProjection`), so `npm test` covers it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPlayUiProjection,
  buildNpcPublicProjection,
  isActorObservable,
} = require('../dist/application/campaign/playProjection');

function entry(entryId, kind, visibility, definition) {
  return {
    entryId,
    kind,
    revision: 1,
    provenance: { kind: 'explicit', sourceFactIds: [], rationale: 'test fixture' },
    fieldProvenance: {},
    visibility,
    dependencyIds: [],
    definition,
  };
}

const ENTRIES = [
  entry('skill-blade', 'skill', 'public', { name: '剑术', attribute: 'agility', allowUntrained: false }),
  entry('skill-stealth', 'skill', 'public', { name: '潜行', attribute: 'agility', allowUntrained: true }),
  entry('skill-poison', 'skill', 'gm', { name: '毒术', attribute: 'knowledge', allowUntrained: false }),
  entry('ability-flurry', 'ability', 'public', { name: '剑舞', attribute: 'agility', costs: {} }),
  entry('item-blade', 'item', 'public', { name: '横刀', category: 'weapon' }),
  entry('quest-main', 'quest', 'gm', { name: '查明失踪人口', trigger: {} }),
  entry('lore-manor', 'lore', 'discoverable', { name: '沈府旧事' }),
];

function actorCard(overrides = {}) {
  return {
    actorId: 'actor-player',
    name: '李慕白',
    kind: 'original',
    controller: 'player',
    attributes: { physique: 3, agility: 2, insight: 3, knowledge: 1, willpower: 2, social: 2 },
    skills: { 'skill-blade': 'trained' },
    abilities: [],
    preparedAbilities: ['ability-flurry'],
    resourceMax: { hp: 10, stamina: 10 },
    defense: 2,
    powerTier: 'ordinary',
    rulesetId: 'shineword-core',
    rulesetVersion: '0.2.0',
    worldId: 'world-1',
    worldPackageRevision: 1,
    cardRevision: 1,
    ...overrides,
  };
}

function baseState(overrides = {}) {
  return {
    branchId: 'camp-1-main',
    stateVersion: 7,
    clockSeconds: 3600,
    clockMinutes: 60,
    actors: {
      'actor-player': {
        actorId: 'actor-player',
        locationId: 'loc-hall',
        resources: { hp: 7, stamina: 9 },
        conditions: ['poisoned'],
        lifeStatus: 'active',
      },
      'actor-ally-1': {
        actorId: 'actor-ally-1',
        locationId: 'loc-hall',
        resources: { hp: 6, stamina: 4 },
        conditions: [],
        lifeStatus: 'active',
        abilityCooldowns: { 'ability-flurry': 9 },
      },
    },
    itemOwners: { 'item-blade': 'actor-player' },
    itemSources: {
      'item-blade': { kind: 'starting_loadout', sourceId: 'opening', obtainedAtStateVersion: 0 },
    },
    skills: [
      { actorId: 'actor-player', skillId: 'skill-blade', rank: 'trained', practicePoints: 12, awardedKeys: [] },
      { actorId: 'actor-ally-1', skillId: 'skill-stealth', rank: 'novice', practicePoints: 3, awardedKeys: [] },
      { actorId: 'actor-departed', skillId: 'skill-stealth', rank: 'master', practicePoints: 0, awardedKeys: [] },
    ],
    relationships: [
      { relId: 'rel-1', fromActorId: 'actor-ally-1', toActorId: 'actor-player', stance: 'trust', closeness: 78, updatedTurnId: null },
      { relId: 'rel-2', fromActorId: 'actor-npc-1', toActorId: 'actor-player', stance: 'wary', closeness: 32, updatedTurnId: null },
      { relId: 'rel-3', fromActorId: 'actor-ally-1', toActorId: 'actor-npc-1', stance: 'wary', closeness: 10, updatedTurnId: null },
    ],
    discoveries: [
      { entryId: 'lore-manor', actorId: 'actor-player', knownAtStateVersion: 5, sourceTurnId: 'turn-3', knownVia: 'witnessed' },
      { entryId: 'lore-other', actorId: 'actor-ally-1', knownAtStateVersion: 5, sourceTurnId: 'turn-3', knownVia: 'told' },
    ],
    questProgress: [
      { questId: 'quest-main', status: 'active', counters: { clue: 2 }, updatedStateVersion: 6, completedStateVersion: null },
    ],
    party: [
      { actorId: 'actor-player', controller: 'player', role: 'protagonist', joinedAt: 't0', groupId: 'main' },
      { actorId: 'actor-ally-1', controller: 'companion', role: 'companion', joinedAt: 't0', groupId: 'main' },
    ],
    encounters: [],
    ...overrides,
  };
}

const ALLY_CARD = actorCard({
  actorId: 'actor-ally-1',
  name: '茯苓',
  kind: 'companion',
  controller: 'companion',
  companionDirective: 'protect',
  companionLeaderActorId: 'actor-player',
  skills: { 'skill-stealth': 'novice' },
  preparedAbilities: [],
});

const NPC_CARD = actorCard({
  actorId: 'actor-npc-1',
  name: '福伯',
  kind: 'npc',
  controller: 'gm',
  templateId: 'tpl-steward',
  entityId: 'entity-steward',
  skills: { 'skill-blade': 'expert', 'skill-poison': 'master' },
  preparedAbilities: ['ability-flurry'],
  abilities: ['ability-flurry'],
  resourceMax: { hp: 8, stamina: 6 },
  description: '伺候沈家三十年的老仆，袖口总有一股陈年墨香。',
  combatBehavior: { retreatThreshold: 0.3, morale: 'steady' },
});

function projection(cards, state) {
  return buildPlayUiProjection({
    campaignId: 'camp-1',
    branchId: 'camp-1-main',
    worldId: 'world-1',
    packageRevision: 1,
    goal: '查明失踪人口',
    state,
    cards,
    entries: ENTRIES,
  });
}

test('player and current party members project completely', () => {
  const state = baseState();
  const view = projection([actorCard(), ALLY_CARD], state);

  assert.equal(view.stateVersion, 7);
  assert.equal(view.clockSeconds, 3600);
  assert.equal(view.goal, '查明失踪人口');

  assert.ok(view.player);
  assert.equal(view.player.actorId, 'actor-player');
  assert.equal(view.player.attributes.physique, 3);
  assert.equal(view.player.resources.hp, 7);
  assert.deepEqual(view.player.conditions, ['poisoned']);
  assert.equal(view.player.lifeStatus, 'active');
  assert.equal(view.player.defense, 2);
  assert.equal(view.player.powerTier, 'ordinary');
  assert.equal(view.player.preparedAbilitySlots, 4);
  assert.equal(view.player.preparedAbilities.length, 1);
  assert.equal(view.player.preparedAbilities[0].name, '剑舞');
  assert.equal(view.player.preparedAbilities[0].cooldownExpiresAtVersion, null);

  assert.equal(view.party.length, 1);
  const ally = view.party[0];
  assert.equal(ally.name, '茯苓');
  assert.equal(ally.companionDirective, 'protect');
  assert.equal(ally.companionLeaderActorId, 'actor-player');
  assert.equal(ally.groupId, 'main');
  assert.equal(ally.preparedAbilities.length, 0);
  assert.equal(ally.resources.stamina, 4);

  // Skills carry the real rank die and the rule-domain threshold.
  const playerBlade = view.skills.find(skill => skill.actorId === 'actor-player');
  assert.equal(playerBlade.name, '剑术');
  assert.equal(playerBlade.dieSides, 8);
  assert.equal(playerBlade.practicePoints, 12);
  assert.equal(playerBlade.threshold, 20);
  const allyStealth = view.skills.find(skill => skill.actorId === 'actor-ally-1');
  assert.equal(allyStealth.name, '潜行');
  assert.equal(allyStealth.dieSides, 6);
  assert.equal(allyStealth.threshold, 10);

  // Only the player's own discoveries and network are projected.
  assert.equal(view.discoveries.length, 1);
  assert.equal(view.discoveries[0].title, '沈府旧事');
  assert.equal(view.discoveries[0].knownVia, 'witnessed');
  assert.deepEqual(
    view.relationships.map(rel => rel.relId).sort(),
    ['rel-1', 'rel-2'],
  );
  assert.equal(view.quests.length, 1);
  assert.equal(view.quests[0].name, '查明失踪人口');
  assert.equal(view.quests[0].counters.clue, 2);
  assert.equal(view.inventory.length, 1);
  assert.equal(view.inventory[0].name, '横刀');
  assert.equal(view.inventory[0].ownerName, '李慕白');
  assert.equal(view.inventory[0].source.kind, 'starting_loadout');
});

test('actors who left the party are not leaked', () => {
  const state = baseState({
    party: [
      { actorId: 'actor-player', controller: 'player', role: 'protagonist', joinedAt: 't0', groupId: 'main' },
    ],
    itemOwners: { 'item-blade': 'actor-player', 'item-relic': 'actor-departed' },
  });
  // The departed actor's card is no longer part of the summary projection.
  const view = projection([actorCard()], state);

  assert.deepEqual(view.party, []);
  assert.equal(view.skills.some(skill => skill.actorId === 'actor-departed'), false);
  assert.equal(view.inventory.some(item => item.ownerActorId === 'actor-departed'), false);
  assert.equal(view.inventory.length, 1);
});

test('NPC public projection hides every GM-only field', () => {
  const state = baseState({
    encounters: [
      {
        state: {
          encounterId: 'enc-1',
          status: 'active',
          scene: { sceneId: 'scene-1', coverSpotIds: [], exitIds: [] },
          actors: {
            'actor-npc-1': { actorId: 'actor-npc-1', side: 'hostile', hp: 5, maxHp: 8, zoneId: 'z1', conditions: ['wounded'], actedThisRound: false, movedThisRound: false },
          },
          initiative: ['actor-npc-1'],
          pendingActorIds: [],
          turnCursor: 0,
          round: 1,
        },
        zones: [],
        zoneMap: {},
        exits: [],
        createdAt: 't0',
        resolvedAt: null,
      },
    ],
    actors: {
      'actor-player': {
        actorId: 'actor-player',
        locationId: 'loc-hall',
        resources: { hp: 7, stamina: 9 },
        conditions: [],
        lifeStatus: 'active',
      },
      'actor-npc-1': {
        actorId: 'actor-npc-1',
        locationId: 'loc-hall',
        resources: { hp: 8, stamina: 6 },
        conditions: ['wounded'],
        lifeStatus: 'active',
      },
    },
  });

  const view = buildNpcPublicProjection({
    actor: NPC_CARD,
    state,
    playerActorId: 'actor-player',
    entries: ENTRIES,
  });

  // Nothing mechanical may cross the boundary.
  const keys = Object.keys(view);
  for (const hidden of ['attributes', 'abilities', 'preparedAbilities', 'resourceMax', 'skills', 'templateId', 'entityId']) {
    assert.equal(keys.includes(hidden), false, `GM-only field leaked: ${hidden}`);
  }
  assert.equal(JSON.stringify(view).includes('skill-poison'), false);
  assert.equal(JSON.stringify(view).includes('tpl-steward'), false);

  // Public fields are visible.
  assert.equal(view.kind, 'npc');
  assert.equal(view.description.includes('陈年墨香'), true);
  assert.equal(view.morale, 'steady');
  assert.equal(view.retreatThreshold, 0.3);
  assert.deepEqual(view.observedSkills, [{ skillId: 'skill-blade', name: '剑术' }]);
  assert.equal(view.unknownSkillCount, 1);
  assert.equal(view.relationship.stance, 'wary');
  assert.equal(view.relationship.closeness, 32);
  assert.equal(view.lifeStatus, 'active');
  assert.deepEqual(view.visibleConditions, ['wounded']);
  assert.equal(view.unknownSections.includes('attributes'), true);
  assert.equal(view.unknownSections.includes('skills'), true);
  assert.equal(view.unknownSections.includes('conditions'), false);
});

test('unobserved NPCs expose no runtime state at all', () => {
  const state = baseState({
    actors: {
      'actor-player': {
        actorId: 'actor-player',
        locationId: 'loc-hall',
        resources: { hp: 7, stamina: 9 },
        conditions: [],
        lifeStatus: 'active',
      },
      'actor-npc-1': {
        actorId: 'actor-npc-1',
        locationId: 'loc-forest',
        resources: { hp: 8, stamina: 6 },
        conditions: ['wounded'],
        lifeStatus: 'critical',
      },
    },
  });

  assert.equal(isActorObservable(state, 'actor-npc-1', 'actor-player'), false);
  const view = buildNpcPublicProjection({
    actor: NPC_CARD,
    state,
    playerActorId: 'actor-player',
    entries: ENTRIES,
  });
  assert.equal(view.lifeStatus, null);
  assert.deepEqual(view.visibleConditions, []);
  assert.equal(view.unknownSections.includes('conditions'), true);
  assert.equal(JSON.stringify(view).includes('critical'), false);
});
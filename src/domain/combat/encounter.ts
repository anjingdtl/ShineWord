/**
 * Zone-graph distance bands (plan §12.3): same zone = near, one connection =
 * mid, two connections = far, anything further (including disconnected
 * zones) = out_of_range. Disconnected is NOT far: a target behind a wall or
 * in another scene is unreachable, never "reachable at long range".
 */
export type DistanceBand = 'near' | 'mid' | 'far' | 'out_of_range';

export const DISTANCE_BANDS: readonly DistanceBand[] = ['near', 'mid', 'far', 'out_of_range'];

export interface EncounterActor {
  actorId: string;
  /** `neutral` is a distinct faction, never implicitly hostile. */
  side: 'player' | 'npc' | 'neutral';
  hp: number;
  maxHp: number;
  stamina: number;
  conditions: string[];
  distanceBand: DistanceBand;
  actedThisRound: boolean;
  /** Standard movement is separate from the main action (plan §10.3). */
  movedThisRound: boolean;
}

export interface EncounterScene {
  sceneId: string;
  /** Cover spots and exits as scene-level facts for the Narrator. */
  coverSpotIds: string[];
  exitIds: string[];
}

export interface EncounterState {
  encounterId: string;
  status: 'active' | 'resolved' | 'escaped' | 'wiped';
  scene: EncounterScene;
  actors: Record<string, EncounterActor>;
  /** Frozen at encounter start; NPC order never depends on generated text length. */
  initiative: string[];
  /** New party members are held out of initiative until the next round. */
  pendingActorIds?: string[];
  turnCursor: number;
  round: number;
  /**
   * Closeout C6: per-actor disabled-fate states selected by the scene's fate
   * contract (domain/combat/disabledFate.ts). Rides the snapshot verbatim so
   * rewind and save/restore reproduce fate progress exactly.
   */
  fates?: Record<string, import('./disabledFate').DisabledFateState>;
}

export interface EncounterStartInput {
  encounterId: string;
  scene: EncounterScene;
  actors: Array<Pick<EncounterActor, 'actorId' | 'side' | 'hp' | 'maxHp' | 'stamina' | 'conditions'>>;
  /** Player actors first, then NPCs in declared order. */
  initiative: string[];
}

export interface EncounterStartResult {
  state: EncounterState;
  round: number;
  currentActorId: string;
}

export function startEncounter(input: EncounterStartInput): EncounterStartResult {
  if (input.initiative.length === 0) {
    throw new Error('An encounter requires a frozen initiative order.');
  }
  const actorIds = new Set(input.actors.map(actor => actor.actorId));
  for (const id of input.initiative) {
    if (!actorIds.has(id)) {
      throw new Error(`Initiative references unknown actor ${id}.`);
    }
  }
  const actors: Record<string, EncounterActor> = {};
  for (const actor of input.actors) {
    if (actor.hp < 0 || actor.stamina < 0) {
      throw new Error(`Encounter actor ${actor.actorId} cannot start with negative resources.`);
    }
    actors[actor.actorId] = {
      ...actor,
      conditions: [...actor.conditions],
      distanceBand: 'mid',
      actedThisRound: false,
      movedThisRound: false,
    };
  }
  const state: EncounterState = {
    encounterId: input.encounterId,
    status: 'active',
    scene: {
      sceneId: input.scene.sceneId,
      coverSpotIds: [...input.scene.coverSpotIds],
      exitIds: [...input.scene.exitIds],
    },
    actors,
    initiative: [...input.initiative],
    pendingActorIds: [],
    turnCursor: 0,
    round: 1,
  };
  const firstConsciousIndex = state.initiative.findIndex(actorId => {
    const actor = state.actors[actorId];
    return actor !== undefined && actor.hp > 0 && !actor.conditions.includes('disabled');
  });
  if (firstConsciousIndex < 0) {
    throw new Error('An encounter requires at least one conscious actor.');
  }
  state.turnCursor = firstConsciousIndex;
  const firstActorId = state.initiative[firstConsciousIndex];
  if (!firstActorId) {
    throw new Error('An encounter requires a non-empty initiative order.');
  }
  return { state, round: 1, currentActorId: firstActorId };
}

export interface DamageResult {
  actorId: string;
  hpBefore: number;
  hpAfter: number;
  disabled: boolean;
}

/**
 * Prototype damage template: normal hit 2, full success 3, minus armor,
 * floored at 0. Real world packages remap these numbers; the template never
 * overrides canon power tiers.
 */
export function applyDamage(
  state: EncounterState,
  actorId: string,
  rawDamage: number,
  armor: number,
): DamageResult {
  const actor = state.actors[actorId];
  if (!actor) throw new Error(`Unknown encounter actor: ${actorId}.`);
  if (!Number.isInteger(rawDamage) || rawDamage < 0) {
    throw new Error('Raw damage must be a non-negative integer.');
  }
  if (!Number.isInteger(armor) || armor < 0) {
    throw new Error('Armor must be a non-negative integer.');
  }
  const hpBefore = actor.hp;
  const hpAfter = Math.max(0, hpBefore - Math.max(0, rawDamage - armor));
  actor.hp = hpAfter;
  const disabled = hpAfter === 0;
  if (disabled && !actor.conditions.includes('disabled')) {
    actor.conditions.push('disabled');
  }
  return { actorId, hpBefore, hpAfter, disabled };
}

export function spendStamina(state: EncounterState, actorId: string, amount: number): void {
  const actor = state.actors[actorId];
  if (!actor) throw new Error(`Unknown encounter actor: ${actorId}.`);
  if (!Number.isInteger(amount) || amount < 0) throw new Error('Stamina cost must be a non-negative integer.');
  if (actor.stamina < amount) {
    throw new Error(`Not enough stamina: ${actor.stamina} < ${amount}.`);
  }
  actor.stamina -= amount;
}

export function changeDistance(state: EncounterState, actorId: string, band: DistanceBand): void {
  const actor = state.actors[actorId];
  if (!actor) throw new Error(`Unknown encounter actor: ${actorId}.`);
  actor.distanceBand = band;
}

/**
 * Advances from the actor whose action just resolved to the next conscious
 * actor. Incapacitated slots are skipped in the same advancement, including
 * when the initiative order wraps. A full loop starts a new round and resets
 * per-round action and movement allowances.
 */
export function advanceInitiative(state: EncounterState): { actorId: string; round: number } {
  if (state.status !== 'active') {
    throw new Error(`Encounter is not active: ${state.status}.`);
  }
  const moveNext = () => {
    state.turnCursor += 1;
    if (state.turnCursor >= state.initiative.length) {
      state.turnCursor = 0;
      state.round += 1;
      for (const actor of Object.values(state.actors)) {
        actor.actedThisRound = false;
        actor.movedThisRound = false;
      }
    }
  };
  const currentActorId = state.initiative[state.turnCursor];
  const currentActor = currentActorId ? state.actors[currentActorId] : undefined;
  if (currentActor && currentActor.hp > 0 && !currentActor.conditions.includes('disabled')) {
    currentActor.actedThisRound = true;
  }

  for (let steps = 0; steps < state.initiative.length; steps += 1) {
    moveNext();
    const nextActorId = state.initiative[state.turnCursor];
    const nextActor = nextActorId ? state.actors[nextActorId] : undefined;
    if (nextActorId && nextActor && nextActor.hp > 0 && !nextActor.conditions.includes('disabled')) {
      return { actorId: nextActorId, round: state.round };
    }
  }
  throw new Error('No conscious actor remains in the encounter.');
}

export type EncounterOutcome = 'resolved' | 'escaped' | 'wiped';

export function resolveEncounter(
  state: EncounterState,
  outcome: EncounterOutcome,
): EncounterState {
  if (outcome === 'wiped') {
    const playersAlive = state.initiative.some(id => state.actors[id]?.side === 'player' && state.actors[id].hp > 0);
    if (playersAlive) {
      throw new Error('Cannot wipe the encounter while a player actor is conscious.');
    }
  }
  state.status = outcome;
  return state;
}

/**
 * A disabled actor's fate (captured / rescued / death risk / ending) belongs
 * to the scene contract, never to an ad-hoc model decision. This helper just
 * enumerates the legal outcomes for validation.
 */
export const DISABLED_FATES = ['captured', 'rescued', 'death_risk', 'ending'] as const;
export type DisabledFate = (typeof DISABLED_FATES)[number];

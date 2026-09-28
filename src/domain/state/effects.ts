import type { EffectOperation, ResourcePrecondition } from '../turns/types';
import { cloneGameState, type GameStateSnapshot } from './types';

function requireActor(state: GameStateSnapshot, actorId: string) {
  const actor = state.actors[actorId];
  if (!actor) throw new Error(`Unknown actor: ${actorId}.`);
  return actor;
}

export function assertResourcePreconditions(
  state: GameStateSnapshot,
  preconditions: readonly ResourcePrecondition[],
): void {
  for (const condition of preconditions) {
    const actor = requireActor(state, condition.actorId);
    const current = actor.resources[condition.resourceId] ?? 0;
    if (current < condition.minimum) {
      throw new Error(
        `Resource precondition failed: ${condition.actorId}.${condition.resourceId} ` +
          `requires ${condition.minimum}, has ${current}.`,
      );
    }
  }
}

/** Normalizes legacy snapshots that only carry clockMinutes (plan §10.3). */
export function effectiveClockSeconds(state: GameStateSnapshot): number {
  return state.clockSeconds ?? state.clockMinutes * 60;
}

export function applyEffects(
  current: GameStateSnapshot,
  effects: readonly EffectOperation[],
  baseTimeCostMinutes = 0,
): GameStateSnapshot {
  if (!Number.isFinite(baseTimeCostMinutes) || baseTimeCostMinutes < 0) {
    throw new Error('baseTimeCostMinutes must be >= 0.');
  }

  const next = cloneGameState(current);
  next.clockSeconds = effectiveClockSeconds(current) + baseTimeCostMinutes * 60;

  for (const effect of effects) {
    switch (effect.op) {
      case 'consumeResource': {
        const actor = requireActor(next, effect.actorId);
        const currentAmount = actor.resources[effect.resourceId] ?? 0;
        const newAmount = currentAmount - effect.amount;
        if (newAmount < 0) {
          throw new Error(
            `Resource cannot become negative: ${effect.actorId}.${effect.resourceId}.`,
          );
        }
        actor.resources[effect.resourceId] = newAmount;
        break;
      }
      case 'restoreResource': {
        const actor = requireActor(next, effect.actorId);
        const currentAmount = actor.resources[effect.resourceId] ?? 0;
        // Restores clamp at the declared cap (the card's effective maximum);
        // resources never exceed their maximum through healing or rest.
        const target = effect.cap !== undefined ? Math.min(effect.cap, currentAmount + effect.amount) : currentAmount + effect.amount;
        actor.resources[effect.resourceId] = target;
        break;
      }
      case 'changeLocation': {
        requireActor(next, effect.actorId).locationId = effect.locationId;
        break;
      }
      case 'applyCondition': {
        const actor = requireActor(next, effect.actorId);
        if (!actor.conditions.includes(effect.conditionId)) {
          actor.conditions.push(effect.conditionId);
        }
        break;
      }
      case 'removeCondition': {
        const actor = requireActor(next, effect.actorId);
        actor.conditions = actor.conditions.filter(condition => condition !== effect.conditionId);
        break;
      }
      case 'advanceClock':
        next.clockSeconds += effect.minutes * 60;
        break;
      case 'transferItem': {
        requireActor(next, effect.fromActorId);
        requireActor(next, effect.toActorId);
        const owner = next.itemOwners[effect.itemId];
        if (owner !== effect.fromActorId) {
          throw new Error(
            `Item owner mismatch: ${effect.itemId} is owned by ${owner ?? 'nobody'}, ` +
              `not ${effect.fromActorId}.`,
          );
        }
        next.itemOwners[effect.itemId] = effect.toActorId;
        break;
      }
      case 'grantItem': {
        // Engine-only loot op: creates ownership once; duplicate grants of a
        // unique item are refused by the session layer's loot policy.
        requireActor(next, effect.actorId);
        const owner = next.itemOwners[effect.itemId];
        if (owner !== undefined && owner !== effect.actorId) {
          throw new Error(`Item ${effect.itemId} already owned by ${owner}.`);
        }
        next.itemOwners[effect.itemId] = effect.actorId;
        break;
      }
      case 'recordEvent':
        // Event persistence belongs to the transaction layer; this effect is state-neutral.
        break;
      default: {
        const exhaustive: never = effect;
        throw new Error(`Unsupported effect: ${JSON.stringify(exhaustive)}.`);
      }
    }
  }

  // Keep the legacy minute projection in the same snapshot as the
  // authoritative second-based clock. Action time and explicit clock effects
  // are committed together, so callers never restore a stale header value.
  next.clockMinutes = Math.floor(next.clockSeconds / 60);
  return next;
}

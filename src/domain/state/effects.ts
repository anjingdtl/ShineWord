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

export function applyEffects(
  current: GameStateSnapshot,
  effects: readonly EffectOperation[],
  baseTimeCostMinutes = 0,
): GameStateSnapshot {
  if (!Number.isFinite(baseTimeCostMinutes) || baseTimeCostMinutes < 0) {
    throw new Error('baseTimeCostMinutes must be >= 0.');
  }

  const next = cloneGameState(current);
  next.clockMinutes += baseTimeCostMinutes;

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
      case 'advanceClock':
        next.clockMinutes += effect.minutes;
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
      case 'recordEvent':
        // Event persistence belongs to the transaction layer; this effect is state-neutral.
        break;
    }
  }

  return next;
}

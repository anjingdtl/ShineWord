export interface ActorState {
  actorId: string;
  locationId: string;
  resources: Record<string, number>;
  conditions: string[];
}

export interface GameStateSnapshot {
  branchId: string;
  stateVersion: number;
  clockMinutes: number;
  actors: Record<string, ActorState>;
  itemOwners: Record<string, string>;
}

export function cloneGameState(state: GameStateSnapshot): GameStateSnapshot {
  return {
    branchId: state.branchId,
    stateVersion: state.stateVersion,
    clockMinutes: state.clockMinutes,
    actors: Object.fromEntries(
      Object.entries(state.actors).map(([id, actor]) => [
        id,
        {
          actorId: actor.actorId,
          locationId: actor.locationId,
          resources: { ...actor.resources },
          conditions: [...actor.conditions],
        },
      ]),
    ),
    itemOwners: { ...state.itemOwners },
  };
}

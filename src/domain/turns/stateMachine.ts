import type { TurnState } from './types';

const ALLOWED_TRANSITIONS: Readonly<Record<TurnState, readonly TurnState[]>> = {
  Draft: ['Planned'],
  Planned: ['AwaitRoll', 'Resolved'],
  AwaitRoll: ['Resolved'],
  Resolved: ['Narrated'],
  Narrated: ['Validated', 'Repair'],
  Validated: ['Committed'],
  Repair: ['Validated', 'Paused'],
  Paused: ['Narrated'],
  Committed: [],
};

export function canTransitionTurn(from: TurnState, to: TurnState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transitionTurn(from: TurnState, to: TurnState): TurnState {
  if (!canTransitionTurn(from, to)) {
    throw new Error(`Illegal turn transition: ${from} -> ${to}.`);
  }
  return to;
}

export function nextTurnStates(from: TurnState): readonly TurnState[] {
  return ALLOWED_TRANSITIONS[from];
}

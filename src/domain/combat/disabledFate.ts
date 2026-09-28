/**
 * Contract-driven disabled-fate state machine (closeout C6, plan §10).
 *
 * A disabled actor's fate - captured / rescued / death_risk / ending - is
 * selected by the SCENE CONTRACT declared with the encounter, never by an
 * ad-hoc model decision. This module is the pure rule engine:
 *  - contracts are validated (fates legal, priorities unambiguous, outcome
 *    shapes complete);
 *  - per-actor fate states ride the encounter snapshot, so rewind and save
 *    restore them exactly like every other piece of combat state;
 *  - every transition returns an authority event for the caller to persist -
 *    the engine itself never writes.
 */
import { DISABLED_FATES, type EncounterOutcome } from './encounter';

export type DisabledFate = (typeof DISABLED_FATES)[number];
export type FatePhase = 'none' | 'pending' | 'active' | 'concluded';
export type FateResolution = 'rescued' | 'stabilized' | 'died' | 'ended' | 'freed';

export interface DisabledFateState {
  actorId: string;
  fate: DisabledFate | null;
  phase: FatePhase;
  /** Encounter round the actor became disabled. */
  disabledSinceRound: number;
  /** Round the current fate was assigned. */
  fateSinceRound: number | null;
  resolution: FateResolution | null;
}

export type FateOutcome =
  | { kind: 'encounter_ends'; outcome: EncounterOutcome }
  | { kind: 'awaits_rescue' }
  | { kind: 'death_risk'; lethalAfterRounds: number }
  | { kind: 'ends_campaign'; endingId: string };

export interface FateRule {
  fate: DisabledFate;
  appliesTo: 'player' | 'companion' | 'npc' | 'any';
  /** Rounds the actor must have stayed disabled before this rule applies. */
  minDisabledRounds: number;
  /** Lower runs first; duplicates are a contract validation error. */
  priority: number;
  outcome: FateOutcome;
}

export interface SceneFateContract {
  encounterId: string;
  rules: readonly FateRule[];
}

export type FateEvent =
  | { kind: 'fate_assigned'; actorId: string; fate: DisabledFate; round: number }
  | { kind: 'death_risk_escalated'; actorId: string; roundsDisabled: number; round: number }
  | { kind: 'fate_resolved'; actorId: string; fate: DisabledFate; resolution: FateResolution; round: number }
  | { kind: 'ending_triggered'; actorId: string; endingId: string; round: number }
  | { kind: 'encounter_end_by_fate'; actorId: string; fate: DisabledFate; outcome: EncounterOutcome; round: number };

export interface FateTransition {
  events: readonly FateEvent[];
  /** Set when the contract ends the whole encounter. */
  encounterOutcome: EncounterOutcome | null;
  /** Set when the contract ends the campaign with an ending id. */
  endingId: string | null;
}

export function emptyFateState(actorId: string): DisabledFateState {
  return {
    actorId,
    fate: null,
    phase: 'none',
    disabledSinceRound: 0,
    fateSinceRound: null,
    resolution: null,
  };
}

/** Structural validation; throws with the offending rule identified. */
export function validateFateContract(contract: SceneFateContract): void {
  if (!contract.encounterId) throw new Error('Fate contract needs an encounterId.');
  const seenPriorities = new Set<number>();
  for (const rule of contract.rules) {
    if (!DISABLED_FATES.includes(rule.fate)) {
      throw new Error(`Unknown fate ${String(rule.fate)}.`);
    }
    if (seenPriorities.has(rule.priority)) {
      throw new Error(`Duplicate fate rule priority ${rule.priority}.`);
    }
    seenPriorities.add(rule.priority);
    if (rule.minDisabledRounds < 0) {
      throw new Error('minDisabledRounds must be >= 0.');
    }
    if (rule.outcome.kind === 'ends_campaign' && !rule.outcome.endingId) {
      throw new Error('ends_campaign outcome requires an endingId.');
    }
    if (rule.outcome.kind === 'death_risk' && rule.outcome.lethalAfterRounds < 1) {
      throw new Error('death_risk outcome requires lethalAfterRounds >= 1.');
    }
  }
}

/** First matching rule by ascending priority; null when none applies. */
export function selectFateRule(
  contract: SceneFateContract,
  actor: { side: 'player' | 'npc'; isCompanion: boolean },
  disabledRounds: number,
): FateRule | null {
  const ordered = [...contract.rules].sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    if (disabledRounds < rule.minDisabledRounds) continue;
    if (rule.appliesTo === 'any') return rule;
    if (rule.appliesTo === 'player' && actor.side === 'player' && !actor.isCompanion) return rule;
    if (rule.appliesTo === 'companion' && actor.side === 'player' && actor.isCompanion) return rule;
    if (rule.appliesTo === 'npc' && actor.side === 'npc') return rule;
  }
  return null;
}

export interface FateActorSnapshot {
  actorId: string;
  side: 'player' | 'npc';
  isCompanion: boolean;
  disabled: boolean;
}

/**
 * Advances every actor's fate state one round under the contract.
 * `fates` is mutated in place (it lives inside the encounter snapshot);
 * the returned transition tells the caller what to persist and whether the
 * encounter or campaign must end.
 */
export function applyFateTransitions(
  round: number,
  actors: readonly FateActorSnapshot[],
  fates: Record<string, DisabledFateState>,
  contract: SceneFateContract,
): FateTransition {
  const events: FateEvent[] = [];
  let encounterOutcome: EncounterOutcome | null = null;
  let endingId: string | null = null;

  for (const actor of actors) {
    const state = fates[actor.actorId] ?? emptyFateState(actor.actorId);
    fates[actor.actorId] = state;

    if (!actor.disabled) {
      if (state.phase === 'active' || state.phase === 'pending') {
        // Healed before the fate concluded: the fate lifts.
        state.phase = 'concluded';
        state.resolution = state.resolution ?? 'freed';
        events.push({
          kind: 'fate_resolved', actorId: actor.actorId,
          fate: state.fate ?? 'rescued', resolution: 'freed', round,
        });
      }
      continue;
    }

    if (state.phase === 'none') {
      state.disabledSinceRound = round;
      state.phase = 'pending';
    }

    if (state.phase === 'pending') {
      const disabledRounds = round - state.disabledSinceRound;
      const rule = selectFateRule(contract, actor, disabledRounds);
      if (!rule) continue;
      state.fate = rule.fate;
      state.fateSinceRound = round;
      state.phase = 'active';
      events.push({ kind: 'fate_assigned', actorId: actor.actorId, fate: rule.fate, round });
      applyOutcome(rule, state, round, events, resolved => {
        if (resolved.encounterOutcome) encounterOutcome = resolved.encounterOutcome;
        if (resolved.endingId) endingId = resolved.endingId;
      });
      continue;
    }

    if (state.phase === 'active') {
      const rule = contract.rules.find(candidate => candidate.fate === state.fate);
      if (rule?.outcome.kind === 'death_risk') {
        const roundsDisabled = round - state.disabledSinceRound;
        if (roundsDisabled >= rule.outcome.lethalAfterRounds) {
          state.phase = 'concluded';
          state.resolution = 'died';
          events.push({
            kind: 'fate_resolved', actorId: actor.actorId,
            fate: state.fate ?? 'death_risk', resolution: 'died', round,
          });
        } else {
          events.push({
            kind: 'death_risk_escalated', actorId: actor.actorId,
            roundsDisabled, round,
          });
        }
      }
    }
  }

  return { events, encounterOutcome, endingId };
}

function applyOutcome(
  rule: FateRule,
  state: DisabledFateState,
  round: number,
  events: FateEvent[],
  record: (t: { encounterOutcome?: EncounterOutcome | null; endingId?: string | null }) => void,
): void {
  if (rule.outcome.kind === 'awaits_rescue') return; // stays active until rescue/heal
  if (rule.outcome.kind === 'death_risk') return;    // timer handled per round
  state.phase = 'concluded';
  if (rule.outcome.kind === 'encounter_ends') {
    state.resolution = 'ended';
    events.push({
      kind: 'encounter_end_by_fate', actorId: state.actorId,
      fate: rule.fate, outcome: rule.outcome.outcome, round,
    });
    record({ encounterOutcome: rule.outcome.outcome });
    return;
  }
  state.resolution = 'ended';
  events.push({
    kind: 'ending_triggered', actorId: state.actorId,
    endingId: rule.outcome.endingId, round,
  });
  record({ endingId: rule.outcome.endingId });
}

/** Ally rescue: concludes captured / awaits_rescue fates. */
export function rescueFate(
  fates: Record<string, DisabledFateState>,
  actorId: string,
  round: number,
): boolean {
  const state = fates[actorId];
  if (!state || state.phase !== 'active') return false;
  if (state.fate !== 'captured' && state.fate !== 'death_risk') return false;
  state.phase = 'concluded';
  state.resolution = 'rescued';
  return true;
}

/** Stabilize pushes the death-risk timer out by resetting its clock. */
export function stabilizeFate(
  fates: Record<string, DisabledFateState>,
  actorId: string,
  round: number,
): boolean {
  const state = fates[actorId];
  if (!state || state.phase !== 'active' || state.fate !== 'death_risk') return false;
  state.disabledSinceRound = round;
  return true;
}

/**
 * Deferred-consequence lifecycle semantics (phase 9.5, ROOT_CAUSE_AUDIT §2).
 *
 * The protocol declares four statuses — pending / triggered / discharged /
 * cancelled — but only 'pending' and 'triggered' were ever assigned. Two
 * obligations therefore had no code path at all:
 *
 *   1. A pending obligation whose trigger can never become true stayed
 *      'pending' forever, so a superseded node or terminal campaign left a
 *      record that looked like future content but could never fire.
 *   2. An obligation whose effects had been applied stayed 'triggered' forever,
 *      so the runtime could not distinguish "applied" from "not yet applied".
 *
 * This module owns BOTH decisions. It is deliberately conservative:
 *
 *   - Reachability is a three-valued judgement. A condition that references only
 *     non-node facts (counters, promises, relationships, actors) is treated as
 *     STILL POSSIBLE. Only a trigger that is provably false — because every node
 *     status it depends on is terminal and mismatched — counts as stranded. An
 *     unknown fact is never treated as false.
 *   - Nothing here rewrites a trigger condition, fabricates a success, or edits
 *     a past snapshot. A stranded record keeps its original condition and gains
 *     an explicit, auditable disposition.
 *   - Every transition emits a campaign event so the change is visible in the
 *     branch event history and reviewable, rather than silent.
 */

import type { CampaignEvent, CampaignNodeRuntimeV1, CampaignRuntimeV1, DeferredConsequenceRecordV1 } from './types';
import type { SituationCondition } from '../situations/types';

/** Node statuses that can never change again. */
const TERMINAL_NODE_STATUSES = ['succeeded', 'failed', 'superseded', 'cancelled'] as const;
const TERMINAL_CAMPAIGN_STATUSES = ['completed', 'failed', 'ended'] as const;

/** Why a pending obligation was closed without ever firing. */
export const CONSEQUENCE_CANCEL_REASONS = ['trigger_node_retired', 'campaign_ended'] as const;
export type ConsequenceCancelReason = (typeof CONSEQUENCE_CANCEL_REASONS)[number];

export interface ConditionPossibility {
  canBeTrue: boolean;
  canBeFalse: boolean;
}

/**
 * Three-valued possibility of a condition given current node statuses.
 *
 * Mirrors the replan service's reachability judgement so the adoption guard and
 * this disposition cannot drift apart. Non-node facts are NOT modelled here:
 * they report "still possible", because a counter may still rise and an unknown
 * fact must never be read as false.
 */
export function conditionPossibilityForNodes(
  condition: SituationCondition,
  statuses: ReadonlyMap<string, string>,
): ConditionPossibility {
  if (condition.kind === 'all' || condition.kind === 'any') {
    const children = condition.of.map(child => conditionPossibilityForNodes(child, statuses));
    if (condition.kind === 'all') {
      return {
        canBeTrue: children.every(child => child.canBeTrue),
        canBeFalse: children.some(child => child.canBeFalse),
      };
    }
    return {
      canBeTrue: children.some(child => child.canBeTrue),
      canBeFalse: children.every(child => child.canBeFalse),
    };
  }
  if (condition.kind === 'not') {
    const nested = conditionPossibilityForNodes(condition.of, statuses);
    return { canBeTrue: nested.canBeFalse, canBeFalse: nested.canBeTrue };
  }
  if (condition.kind === 'campaign_node_status') {
    const status = statuses.get(condition.nodeId);
    if (status && (TERMINAL_NODE_STATUSES as readonly string[]).includes(status)) {
      const matches = status === condition.status;
      return { canBeTrue: matches, canBeFalse: !matches };
    }
  }
  return { canBeTrue: true, canBeFalse: true };
}

function statusMap(nodes: readonly CampaignNodeRuntimeV1[]): Map<string, string> {
  return new Map(nodes.map(node => [node.nodeId, node.status]));
}

/**
 * Identifiers of pending obligations that can provably never trigger again.
 *
 * These are the records left behind by a replan that superseded the node they
 * were waiting on. Returning them lets the caller dispose of them explicitly
 * instead of letting them masquerade as future content.
 */
export function orphanedPendingConsequences(input: {
  deferredConsequences: CampaignRuntimeV1['deferredConsequences'];
  nodeStates: readonly CampaignNodeRuntimeV1[];
}): string[] {
  const statuses = statusMap(input.nodeStates);
  return input.deferredConsequences
    .filter(consequence => consequence.status === 'pending'
      && !conditionPossibilityForNodes(consequence.triggerCondition, statuses).canBeTrue)
    .map(consequence => consequence.consequenceId);
}

/**
 * Cancels pending obligations whose trigger is unreachable, including when the
 * campaign has entered a terminal status.
 *
 * The trigger condition and description are preserved verbatim; only the
 * lifecycle status and an explicit reason are added. A GM-visible reason is
 * recorded so the disposition is auditable rather than a silent disappearance.
 *
 * Returns the ids that were closed and the events describing each closure.
 */
export function dischargeStrandedConsequences(input: {
  runtime: CampaignRuntimeV1;
  nextStateVersion: number;
  /** Current node states used to prove a trigger unreachable while the campaign is active. */
  nodeStates?: readonly CampaignNodeRuntimeV1[];
}): { consequenceIds: string[]; events: CampaignEvent[] } {
  const nodeStates = input.nodeStates ?? input.runtime?.nodeStates;
  const campaignEnded = (TERMINAL_CAMPAIGN_STATUSES as readonly string[]).includes(input.runtime.campaignStatus);
  if (!nodeStates && !campaignEnded) return { consequenceIds: [], events: [] };
  const statuses = nodeStates ? statusMap(nodeStates) : new Map<string, string>();
  const consequenceIds: string[] = [];
  const events: CampaignEvent[] = [];
  for (const consequence of input.runtime.deferredConsequences) {
    if (consequence.status !== 'pending') continue;
    if (!campaignEnded && conditionPossibilityForNodes(consequence.triggerCondition, statuses).canBeTrue) continue;
    consequence.status = 'cancelled';
    consequence.cancelledAtVersion = input.nextStateVersion;
    consequence.cancelReason = campaignEnded ? 'campaign_ended' : 'trigger_node_retired';
    consequenceIds.push(consequence.consequenceId);
    events.push({
      eventType: 'campaign_consequence_cancelled',
      payload: {
        consequenceId: consequence.consequenceId,
        reason: consequence.cancelReason,
        description: consequence.description,
        stateVersion: input.nextStateVersion,
      },
    });
  }
  return { consequenceIds, events };
}

/**
 * Marks triggered obligations whose effects have been applied as 'discharged'.
 *
 * The settlement layer is the only place that knows an effect set actually ran,
 * so it passes the applied idempotency keys back here. Recording this keeps the
 * runtime honest about what has already been paid out, and keeps a second
 * settlement pass from re-applying the same consequence.
 */
export function dischargeAppliedConsequences(input: {
  runtime: CampaignRuntimeV1;
  appliedKeys: ReadonlySet<string>;
  nextStateVersion: number;
}): { consequenceIds: string[]; events: CampaignEvent[] } {
  const consequenceIds: string[] = [];
  const events: CampaignEvent[] = [];
  for (const consequence of input.runtime.deferredConsequences) {
    if (consequence.status !== 'triggered') continue;
    if (!input.appliedKeys.has(consequence.idempotencyKey)) continue;
    consequence.status = 'discharged';
    consequence.dischargedAtVersion = input.nextStateVersion;
    consequenceIds.push(consequence.consequenceId);
    events.push({
      eventType: 'campaign_consequence_discharged',
      payload: {
        consequenceId: consequence.consequenceId,
        stateVersion: input.nextStateVersion,
      },
    });
  }
  return { consequenceIds, events };
}

/** True when the record is closed and will never be applied or trigger again. */
export function isClosedConsequence(consequence: DeferredConsequenceRecordV1): boolean {
  return consequence.status === 'discharged' || consequence.status === 'cancelled';
}

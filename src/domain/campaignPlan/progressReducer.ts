import type {
  CampaignContentArtifactV1,
  CampaignEvent,
  CampaignPlanV1,
  CampaignRewardPolicyV1,
  CampaignRuntimeV1,
  DeferredConsequenceRecordV1,
  CampaignEndingV1,
} from './types';
import { CAMPAIGN_RUNTIME_SCHEMA } from './types';
import type { GameStateSnapshot } from '../state/types';
import type { ConditionFacts } from '../situations/conditions';
import { evaluateCondition, snapshotConditionFacts } from '../situations/conditions';
import type { SituationCondition } from '../situations/types';

/**
 * CampaignProgressReducer (plan §9): the ONLY authority that turns committed
 * events and evaluated conditions into mainline progress. Deterministic,
 * bounded, side-effect free — the caller persists the returned runtime and
 * events inside the same commit transaction. Model output never marks a node
 * succeeded; only these condition evaluations do.
 */

/** One transaction processes at most this many node transitions. */
export const NODE_TRANSITION_BATCH_LIMIT = 8;
/** Bounded chained consequence triggers per transaction. */
export const CONSEQUENCE_TRIGGER_LIMIT = 4;
/** Bounded player-visible progress lines kept in the runtime. */
export const PROGRESS_LINE_LIMIT = 5;
/** Branch events scanned for committed_event conditions (most recent first). */
export const EVENT_HISTORY_WINDOW = 200;

export interface BranchEventRecord {
  eventType: string;
  payload: unknown;
  /** Event identity key used for processedEventKeys dedupe. */
  eventKey: string;
  stateVersion: number;
}

export interface ProgressReducerInput {
  plan: CampaignPlanV1;
  runtime: CampaignRuntimeV1;
  /** Next state (post-turn-settlement draft) the reducer evaluates against. */
  state: GameStateSnapshot;
  /** Events committed in THIS transaction (already applied to state). */
  transactionEvents: readonly BranchEventRecord[];
  /** Bounded recent history for committed_event conditions. */
  historyEvents: readonly BranchEventRecord[];
  artifact?: CampaignContentArtifactV1;
  turnId: string;
  nextStateVersion: number;
}

export interface CampaignRewardGrant {
  policyId: string;
  nodeId: string;
  grantKey: string;
  policy: CampaignRewardPolicyV1;
}

export interface ProgressReducerOutput {
  runtime: CampaignRuntimeV1;
  events: CampaignEvent[];
  rewards: CampaignRewardGrant[];
  result: 'no_change' | 'changed';
  /** Player-visible progress lines added this transaction. */
  progressLines: string[];
}

function isTrue(condition: SituationCondition | null, facts: ConditionFacts): boolean {
  if (condition === null) return false;
  const result = evaluateCondition(condition, facts);
  return result.value && !result.unknown;
}

/** Unknown never completes; explicit false can fail. */
function isFalse(condition: SituationCondition | null, facts: ConditionFacts): boolean {
  if (condition === null) return false;
  const result = evaluateCondition(condition, facts);
  return !result.value && !result.unknown;
}

function eventMatches(
  event: BranchEventRecord,
  eventType: string,
  payloadMatch?: Readonly<Record<string, string>>,
): boolean {
  if (event.eventType !== eventType) return false;
  if (!payloadMatch) return true;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  return Object.entries(payloadMatch).every(([key, value]) => String(payload[key]) === value);
}

export function campaignConditionFacts(input: {
  state: GameStateSnapshot;
  runtime: CampaignRuntimeV1;
  transactionEvents: readonly BranchEventRecord[];
  historyEvents: readonly BranchEventRecord[];
  playerActorId: string;
  resolvedReferenceEventKeys?: readonly string[];
}): ConditionFacts {
  const facts = snapshotConditionFacts({
    actors: input.state.actors,
    itemOwners: input.state.itemOwners,
    discoveries: input.state.discoveries,
    relationships: input.state.relationships,
    questProgress: input.state.questProgress,
    situations: input.state.situations,
    playerActorId: input.playerActorId,
    resolvedReferenceEventKeys: input.resolvedReferenceEventKeys,
    causalWorldTimeOrder: input.state.causalWorldTimeOrder ?? 0,
    cards: (input.state.cards ?? []).map(entry => ({
      actorId: entry.actorId,
      templateId: (entry.card as { templateId?: string }).templateId,
    })),
  });
  const nodeStatus = new Map(input.runtime.nodeStates.map(n => [n.nodeId, n.status]));
  const recentEvents = [...input.transactionEvents, ...input.historyEvents].slice(0, EVENT_HISTORY_WINDOW);
  const situationById = new Map((input.state.situations ?? []).map(s => [s.situationId, s]));
  return {
    ...facts,
    campaignNodeStatus: nodeId => nodeStatus.get(nodeId),
    committedEventOccurred: (eventType, payloadMatch) =>
      recentEvents.some(event => eventMatches(event, eventType, payloadMatch)),
    promiseStatus: (situationId, promiseId) =>
      situationById.get(situationId)?.promises.find(p => p.promiseId === promiseId)?.status,
    situationCounter: (situationId, counterId) => {
      const counter = situationById.get(situationId)?.counters[counterId];
      return typeof counter === 'number' ? counter : undefined;
    },
  };
}

function cloneRuntime(runtime: CampaignRuntimeV1): CampaignRuntimeV1 {
  return {
    ...runtime,
    planBinding: { ...runtime.planBinding },
    nodeStates: runtime.nodeStates.map(node => ({
      ...node,
      completedEvidence: node.completedEvidence.map(e => ({ ...e })),
    })),
    deferredConsequences: runtime.deferredConsequences.map(consequence => ({
      ...consequence,
      sourceEventRefs: [...consequence.sourceEventRefs],
      affectedActors: [...consequence.affectedActors],
      effectSpecs: [...consequence.effectSpecs],
    })),
    processedEventKeys: [...runtime.processedEventKeys],
    grantedRewardKeys: [...runtime.grantedRewardKeys],
    replanReasonCodes: [...runtime.replanReasonCodes],
    recentProgressLines: runtime.recentProgressLines.map(line => ({ ...line })),
  };
}

function endingPriority(kind: CampaignEndingV1['outcomeKind']): number {
  return { success: 3, pyrrhic: 2, open: 1, failure: 0 }[kind];
}

export function evaluateCampaignProgress(input: ProgressReducerInput): ProgressReducerOutput {
  if (input.runtime.schemaVersion !== CAMPAIGN_RUNTIME_SCHEMA) {
    throw new Error(`Unknown campaign runtime schema: ${String(input.runtime.schemaVersion)}.`);
  }
  if (input.runtime.planBinding.planId !== input.plan.planId
    || input.runtime.planBinding.revision !== input.plan.revision) {
    throw new Error('runtime/plan binding mismatch — refusing to evaluate progress.');
  }
  const runtime = cloneRuntime(input.runtime);
  const events: CampaignEvent[] = [];
  const rewards: CampaignRewardGrant[] = [];
  const progressLines: string[] = [];
  const stateById = new Map(runtime.nodeStates.map(node => [node.nodeId, node]));
  const nodeById = new Map(input.plan.nodes.map(node => [node.nodeId, node]));
  const facts = () => campaignConditionFacts({
    state: input.state,
    runtime,
    transactionEvents: input.transactionEvents,
    historyEvents: input.historyEvents,
    playerActorId: protagonistActorId(input.state),
  });

  const setStatus = (nodeId: string, status: CampaignRuntimeV1['nodeStates'][number]['status'],
    extra: Partial<CampaignRuntimeV1['nodeStates'][number]>): boolean => {
    const entry = stateById.get(nodeId);
    if (!entry || entry.status === status) return false;
    const from = entry.status;
    entry.status = status;
    if (status === 'active') entry.activatedAtVersion = input.nextStateVersion;
    if (['succeeded', 'failed', 'superseded', 'cancelled'].includes(status)) {
      entry.resolvedAtVersion = input.nextStateVersion;
    }
    Object.assign(entry, extra);
    events.push({
      eventType: 'campaign_node_changed',
      payload: { nodeId, from, to: status, ...(extra.supersededBy ? { supersededBy: extra.supersededBy } : {}), ...(extra.supersedeReason ? { reason: extra.supersedeReason } : {}) },
    });
    return true;
  };

  let changed = false;
  let transitions = 0;

  // --- Node lifecycle evaluation (bounded batch) ---
  for (let round = 0; round < NODE_TRANSITION_BATCH_LIMIT; round += 1) {
    const currentFacts = facts();
    let roundChanged = false;

    for (const node of input.plan.nodes) {
      if (transitions >= NODE_TRANSITION_BATCH_LIMIT) break;
      const entry = stateById.get(node.nodeId);
      if (!entry) continue;
      if (['succeeded', 'failed', 'superseded', 'cancelled'].includes(entry.status)) continue;
      if (input.plan.startNodeIds.includes(node.nodeId) && node.activation === null && entry.status === 'planned') {
        if (setStatus(node.nodeId, 'available', {})) { transitions += 1; roundChanged = true; }
      }
      if (entry.status === 'planned' && node.activation !== null) {
        const depsMet = node.statusDependencies.every(depId => {
          const dep = stateById.get(depId);
          return dep !== undefined && ['succeeded', 'superseded', 'cancelled'].includes(dep.status);
        });
        if (depsMet && isTrue(node.activation, currentFacts)) {
          if (setStatus(node.nodeId, 'available', {})) { transitions += 1; roundChanged = true; }
        }
      }
      // Early completion (A17): evidence may already satisfy a stage the plan
      // expected later — pending nodes also check completion, not just active.
      if (['planned', 'available', 'suspended', 'active'].includes(entry.status)
        && isTrue(node.completion, currentFacts)) {
        const evidence = collectCompletionEvidence(node, input);
        if (setStatus(node.nodeId, 'succeeded', { completedEvidence: evidence })) {
          transitions += 1;
          roundChanged = true;
          progressLines.push(`目标推进：${node.title}已完成。`);
        }
        // Skip-over: earlier dependency nodes this success bypassed are no
        // longer needed — superseded with an explicit reason, never re-run.
        const skippedDeps = collectTransitiveDependencies(node.nodeId, input.plan);
        for (const depId of skippedDeps) {
          if (transitions >= NODE_TRANSITION_BATCH_LIMIT) break;
          const depEntry = stateById.get(depId);
          const depNode = nodeById.get(depId);
          if (!depEntry || !depNode || depNode.role !== 'main') continue;
          if (!['planned', 'available', 'suspended', 'active'].includes(depEntry.status)) continue;
          if (setStatus(depId, 'superseded', { supersededBy: node.nodeId, supersedeReason: 'skipped_by_early_completion' })) {
            transitions += 1;
            roundChanged = true;
          }
        }
        continue;
      }
      entryGuard: if (entry.status === 'available' || entry.status === 'suspended' || entry.status === 'active') {
        if (isFalse(node.completion, currentFacts) && node.failure !== null && isTrue(node.failure, currentFacts)) {
          if (setStatus(node.nodeId, 'failed', {})) { transitions += 1; roundChanged = true; }
          break entryGuard;
        }
        if (node.cancellation !== null && isTrue(node.cancellation, currentFacts)) {
          if (setStatus(node.nodeId, 'cancelled', {})) { transitions += 1; roundChanged = true; }
          break entryGuard;
        }
        if (entry.status !== 'active' && runtime.primaryNodeId === null) {
          const depsMet = node.statusDependencies.every(depId => {
            const dep = stateById.get(depId);
            return dep !== undefined && ['succeeded', 'superseded', 'cancelled'].includes(dep.status);
          }) || node.statusDependencies.length === 0;
          if (depsMet) {
            entry.status = 'active';
            entry.activatedAtVersion = input.nextStateVersion;
            runtime.primaryNodeId = node.nodeId;
            runtime.publicObjectiveProjection = node.publicObjective;
            events.push({ eventType: 'campaign_node_changed', payload: { nodeId: node.nodeId, from: 'available', to: 'active' } });
            transitions += 1;
            roundChanged = true;
            progressLines.push(`当前目标：${node.publicObjective}`);
          }
        }
      }
    }

    // Supersede pass: a succeeded node makes unneeded intermediate main nodes superseded.
    for (const node of input.plan.nodes) {
      if (transitions >= NODE_TRANSITION_BATCH_LIMIT) break;
      const entry = stateById.get(node.nodeId);
      if (!entry || !['planned', 'available', 'suspended', 'active'].includes(entry.status)) continue;
      if (node.role !== 'main' || node.coverage === 'provisional') continue;
      // Node no longer needed: an alternative node with the same statusDependency closure already succeeded.
      const alternativeDone = node.alternativeNodeIds.some(altId => {
        const alt = stateById.get(altId);
        return alt !== undefined && alt.status === 'succeeded';
      });
      if (alternativeDone) {
        if (setStatus(node.nodeId, 'superseded', { supersededBy: node.alternativeNodeIds[0], supersedeReason: 'alternative_succeeded' })) {
          transitions += 1;
          roundChanged = true;
        }
      }
    }

    // Advance primary pointer when the current primary resolved.
    if (runtime.primaryNodeId !== null) {
      const primary = stateById.get(runtime.primaryNodeId);
      if (primary && ['succeeded', 'failed', 'superseded', 'cancelled'].includes(primary.status)) {
        runtime.primaryNodeId = null;
        for (const node of input.plan.nodes) {
          const entry = stateById.get(node.nodeId);
          if (entry && entry.status === 'available') {
            entry.status = 'active';
            entry.activatedAtVersion = input.nextStateVersion;
            runtime.primaryNodeId = node.nodeId;
            runtime.publicObjectiveProjection = node.publicObjective;
            events.push({ eventType: 'campaign_node_changed', payload: { nodeId: node.nodeId, from: 'available', to: 'active' } });
            roundChanged = true;
            progressLines.push(`当前目标：${node.publicObjective}`);
            break;
          }
        }
      }
    }
    if (!roundChanged) break;
    changed = true;
  }

  // --- Deferred consequences: schedule from artifact templates ---
  if (input.artifact) {
    for (const template of input.artifact.consequenceTemplates) {
      if (runtime.deferredConsequences.some(c => c.consequenceId === template.consequenceId)) continue;
      // Scheduling happens through effect specs (schedule_consequence) during
      // settlement; templates here define the trigger shapes. Registration is
      // done by the settlement adapter, not by passive evaluation.
      void template;
    }
  }

  // --- Deferred consequences: evaluate pending triggers (bounded) ---
  let triggered = 0;
  for (const consequence of runtime.deferredConsequences) {
    if (triggered >= CONSEQUENCE_TRIGGER_LIMIT) break;
    if (consequence.status !== 'pending') continue;
    if (isTrue(consequence.triggerCondition, facts())) {
      consequence.status = 'triggered';
      consequence.triggeredAtVersion = input.nextStateVersion;
      triggered += 1;
      changed = true;
      events.push({
        eventType: 'campaign_consequence_triggered',
        payload: { consequenceId: consequence.consequenceId, description: consequence.description },
      });
      if (consequence.visibility === 'public') {
        progressLines.push(`后果显现：${consequence.description}`);
      }
    }
  }

  // --- Rewards: grant once per nodeId+policyId on success ---
  if (input.artifact) {
    for (const policy of input.artifact.rewardPolicies) {
      const nodeEntry = stateById.get(policy.nodeId);
      if (!nodeEntry || nodeEntry.status !== 'succeeded') continue;
      const grantKey = `${input.runtime.branchId}:${policy.nodeId}:${policy.policyId}`;
      if (runtime.grantedRewardKeys.includes(grantKey)) continue;
      runtime.grantedRewardKeys.push(grantKey);
      rewards.push({ policyId: policy.policyId, nodeId: policy.nodeId, grantKey, policy });
      changed = true;
      events.push({
        eventType: 'campaign_reward_granted',
        payload: { nodeId: policy.nodeId, policyId: policy.policyId, description: policy.description },
      });
      progressLines.push(`获得回报：${policy.description}`);
    }
  }

  // --- Endings: condition-driven, highest priority wins ---
  if (runtime.campaignStatus === 'active' && input.plan.possibleEndings.length > 0) {
    const currentFacts = facts();
    const satisfied = input.plan.possibleEndings
      .filter(ending => isTrue(ending.condition, currentFacts))
      .sort((a, b) => endingPriority(b.outcomeKind) - endingPriority(a.outcomeKind));
    const ending = satisfied[0];
    if (ending) {
      runtime.campaignStatus = ending.outcomeKind === 'failure' ? 'failed' : 'completed';
      runtime.ending = {
        endingId: ending.endingId,
        title: ending.title,
        outcomeKind: ending.outcomeKind,
        atStateVersion: input.nextStateVersion,
        turnId: input.turnId,
      };
      changed = true;
      events.push({
        eventType: 'campaign_ending',
        payload: { endingId: ending.endingId, outcomeKind: ending.outcomeKind, title: ending.title },
      });
      events.push({
        eventType: 'campaign_status_changed',
        payload: { from: 'active', to: runtime.campaignStatus },
      });
      progressLines.push(`战役走向结局：${ending.title}`);
    }
  }

  // --- Bookkeeping ---
  runtime.stateVersion = input.nextStateVersion;
  runtime.lastProgressVersion = input.nextStateVersion;
  if (progressLines.length > 0) {
    runtime.recentProgressLines = [
      ...runtime.recentProgressLines,
      ...progressLines.map(text => ({ atStateVersion: input.nextStateVersion, text })),
    ].slice(-PROGRESS_LINE_LIMIT);
  }
  return {
    runtime,
    events,
    rewards,
    result: changed || events.length > 0 ? 'changed' : 'no_change',
    progressLines,
  };
}

function collectCompletionEvidence(
  node: { nodeId: string },
  input: ProgressReducerInput,
): Array<{ kind: 'event' | 'condition'; ref: string; atStateVersion: number }> {
  const evidence: Array<{ kind: 'event' | 'condition'; ref: string; atStateVersion: number }> = [];
  for (const event of input.transactionEvents.slice(0, 10)) {
    evidence.push({ kind: 'event', ref: event.eventKey, atStateVersion: input.nextStateVersion });
  }
  evidence.push({ kind: 'condition', ref: `${node.nodeId}:completion`, atStateVersion: input.nextStateVersion });
  return evidence;
}

function protagonistActorId(state: GameStateSnapshot): string {
  const party = state.party ?? [];
  const player = party.find(member => member.controller === 'player');
  return player?.actorId ?? party[0]?.actorId ?? Object.keys(state.actors)[0] ?? '';
}

/** Transitive statusDependencies closure (bounded by plan node count). */
function collectTransitiveDependencies(nodeId: string, plan: CampaignPlanV1): string[] {
  const seen = new Set<string>([nodeId]);
  const out: string[] = [];
  const queue = [nodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = plan.nodes.find(n => n.nodeId === id);
    for (const depId of node?.statusDependencies ?? []) {
      if (seen.has(depId)) continue;
      seen.add(depId);
      out.push(depId);
      queue.push(depId);
    }
  }
  return out;
}

/** Registers a deferred consequence into a runtime (settlement adapter entry). */
export function registerDeferredConsequence(
  runtime: CampaignRuntimeV1,
  record: Omit<DeferredConsequenceRecordV1, 'status' | 'createdAtVersion' | 'sourceTurnId' | 'idempotencyKey'> & {
    sourceTurnId?: string;
    createdAtVersion?: number;
    idempotencyKey?: string;
  },
  turnId: string,
  stateVersion: number,
): CampaignEvent | null {
  const idempotencyKey = record.idempotencyKey ?? `${runtime.branchId}:${record.consequenceId}`;
  if (runtime.deferredConsequences.some(c => c.idempotencyKey === idempotencyKey || c.consequenceId === record.consequenceId)) {
    return null;
  }
  const consequence: DeferredConsequenceRecordV1 = {
    ...record,
    idempotencyKey,
    status: 'pending',
    createdAtVersion: record.createdAtVersion ?? stateVersion,
    sourceTurnId: record.sourceTurnId ?? turnId,
  };
  runtime.deferredConsequences.push(consequence);
  return {
    eventType: 'campaign_consequence_scheduled',
    payload: { consequenceId: consequence.consequenceId, description: consequence.description },
  };
}

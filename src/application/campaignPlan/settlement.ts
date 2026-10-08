import type { ActionContract } from '../../domain/turns/types';
import type { RollGrade } from '../../domain/rules/types';
import type { ActorCard } from '../../domain/characters/card';
import type { CampaignContentArtifactV1, CampaignPlanV1 } from '../../domain/campaignPlan/types';
import type { GameStateSnapshot } from '../../domain/state/types';
import { evaluateCampaignProgress, registerDeferredConsequence, EVENT_HISTORY_WINDOW,
  type BranchEventRecord } from '../../domain/campaignPlan/progressReducer';
import { compileCampaignEffects, bindCampaignResources } from '../../domain/campaignPlan/campaignEffects';
import { createActorReferenceResolver } from '../../domain/characters/actorIdentity';
import { applyEffects } from '../../domain/state/effects';
import { applySituationRuntime, applySituationProjection } from '../situations/causalProjection';
import type { SqliteDatabase } from '../ports/sqlite';

export interface CampaignSettlementInput {
  nextState: GameStateSnapshot;
  turnId: string;
  nextStateVersion: number;
  /** Management adoption has no rolled action or invented outcome effects. */
  action?: { contract: ActionContract; grade: RollGrade };
  transactionEvents: Array<{ eventType: string; payload: unknown }>;
  plan: CampaignPlanV1;
  artifacts: readonly CampaignContentArtifactV1[];
  historyEvents: BranchEventRecord[];
}

/** Shared authority for action and adoption commits. Claims and their effects
 * are prepared together; the caller persists this draft in one transaction. */
export function settleCampaignProgress(input: CampaignSettlementInput): Array<{ eventType: string; payload: unknown }> {
  const { nextState } = input;
  const nextVersion = input.nextStateVersion;
  const runtime = nextState.campaignRuntime;
  if (!runtime) return [];
  const events: Array<{ eventType: string; payload: unknown }> = [];
  const playerActorId = nextState.party?.find(member => member.controller === 'player')?.actorId ?? '';
  const resolveActorReference = createActorReferenceResolver({ actors: nextState.actors,
    cards: (nextState.cards ?? []).map(row => row.card as ActorCard) });
  const campaignActor = (id: string): string => {
    const resolved = ['pc','player','self','__player__','玩家'].includes(id) ? playerActorId : resolveActorReference(id);
    if (!nextState.actors[resolved]) throw new Error(`战役后果引用人物 ${id} 未实例化或有歧义，拒绝提交。`);
    return resolved;
  };
  const shiftRelationship = (from: string, to: string, delta: number): void => {
    const fromActorId = campaignActor(from), toActorId = campaignActor(to);
    if (!nextState.actors[fromActorId] || !nextState.actors[toActorId]) return;
    nextState.relationships ??= [];
    let rel = nextState.relationships.find(r => r.fromActorId === fromActorId && r.toActorId === toActorId);
    if (!rel) { rel = { relId: `rel-${fromActorId}-${toActorId}`, fromActorId, toActorId, stance: 'neutral', closeness: 0, updatedTurnId: null }; nextState.relationships.push(rel); }
    rel.closeness = Math.max(0, Math.min(100, rel.closeness + delta));
    rel.updatedTurnId = input.turnId;
    events.push({ eventType: 'relationship_changed', payload: { fromActorId, toActorId, delta } });
  };
  // 1. Per-grade campaign outcome extensions frozen in the contract.
  const extension = input.action?.contract.campaignEffects?.[input.action.grade];
  if (extension) {
    for (const grant of extension.knowledgeGrants) {
      const actorId = campaignActor(grant.actorId);
      nextState.discoveries = [...(nextState.discoveries ?? [])];
      if (!nextState.discoveries.some(d => d.entryId === grant.entryId && d.actorId === actorId)) {
        nextState.discoveries.push({
          entryId: grant.entryId, actorId,
          knownAtStateVersion: nextVersion,
          sourceTurnId: input.turnId, knownVia: 'told',
        });
        events.push({ eventType: 'knowledge_discovered', payload: { entryId: grant.entryId, actorId } });
      }
    }
    for (const shift of extension.relationshipShifts) {
      shiftRelationship(shift.fromActorId, shift.toActorId, shift.delta);
    }
    const ownerArtifact = input.artifacts.find(item => item.situations.some(s => s.entryId === input.action?.contract.methodRef?.situationId));
    for (const consequenceId of extension.scheduledConsequences) {
      const template = ownerArtifact?.consequenceTemplates.find(item => item.consequenceId === consequenceId);
      if (!template) continue;
      const scheduled = registerDeferredConsequence(runtime, {
        consequenceId: template.consequenceId,
        description: template.description,
        triggerCondition: template.triggerCondition,
        sourceEventRefs: [input.turnId],
        affectedActors: [],
        effectSpecs: template.effectSpecs,
        visibility: template.visibility,
      }, input.turnId, nextVersion);
      if (scheduled) events.push(scheduled);
    }
  }
  // 2. Progress reducer over the post-settlement state (history preloaded).
  const authorityEvents = [...(input.action?.contract.outcomes[input.action.grade].effects ?? []).map(effect => ({
    eventType: effect.op === 'recordEvent' ? effect.eventType : effect.op, payload: effect,
  })), ...input.transactionEvents, ...events];
  const transactionEvents = authorityEvents.map((event, index) => ({
    eventType: event.eventType, payload: event.payload,
    eventKey: `tx:${index}:${event.eventType}`, stateVersion: nextVersion,
  }));
  const artifact = input.artifacts.find(item => item.planId === runtime.planBinding.planId
    && item.planRevision === runtime.planBinding.revision) ?? input.artifacts[0];
  let outcome = evaluateCampaignProgress({
    plan: input.plan, runtime, state: nextState,
    transactionEvents, historyEvents: input.historyEvents, artifact,
    evaluationMode: 'progress_only',
    turnId: input.turnId, nextStateVersion: nextVersion,
  });
  nextState.campaignRuntime = outcome.runtime;
  events.push(...outcome.events);
  const rewards = [...outcome.rewards];
  // A triggered consequence must apply its effects in this Prepared state,
  // not merely publish a "triggered" label. Re-evaluate progress afterwards.
  const appliedConsequences = new Set(runtime.deferredConsequences.filter(c => c.status === 'triggered').map(c => c.idempotencyKey));
  let consequenceCount = 0;
  for (let round = 0; round < 4; round += 1) {
    const triggered = nextState.campaignRuntime.deferredConsequences.filter(c => c.status === 'triggered' && !appliedConsequences.has(c.idempotencyKey));
    if (!triggered.length) break;
    for (const consequence of triggered) {
      appliedConsequences.add(consequence.idempotencyKey);
      consequenceCount += 1;
      const compiled = compileCampaignEffects(consequence.effectSpecs, { actorResolver: campaignActor });
      compiled.effects = bindCampaignResources(compiled.effects, nextState, (nextState.cards ?? []).map(c => ({ actorId: c.actorId, resourceMax: (c.card as { resourceMax: Record<string, number> }).resourceMax })));
      Object.assign(nextState, applyEffects(nextState, compiled.effects));
      for (const effect of compiled.effects) events.push({ eventType: effect.op === 'recordEvent' ? effect.eventType : 'campaign_consequence_effect', payload: { consequenceId: consequence.consequenceId, ...effect } });
      const causal = applySituationRuntime({ nextState: { ...nextState, stateVersion: nextVersion }, sourceTurnId: input.turnId, playerActorId,
        definitions: input.artifacts.flatMap(a => a.situations.map(s => ({ situationId: s.entryId, definition: s.definition }))), methodOps: compiled.transitions });
      applySituationProjection(nextState, causal);
      events.push(...causal.events);
      for (const grant of compiled.knowledgeGrants) {
        nextState.discoveries ??= [];
        if (!nextState.discoveries.some(d => d.entryId === grant.entryId && d.actorId === grant.actorId)) {
          nextState.discoveries.push({ entryId: grant.entryId, actorId: grant.actorId, knownAtStateVersion: nextVersion, sourceTurnId: input.turnId, knownVia: 'told' });
          events.push({ eventType: 'knowledge_discovered', payload: grant });
        }
      }
      for (const shift of compiled.relationshipShifts) {
        shiftRelationship(shift.fromActorId, shift.toActorId, shift.delta);
      }
    }
    outcome = evaluateCampaignProgress({ plan: input.plan, runtime: nextState.campaignRuntime, state: nextState,
      evaluationMode: 'progress_only',
      consequenceTriggerBudget: Math.max(0, 4 - consequenceCount),
      transactionEvents: [...transactionEvents, ...events.map((event, index) => ({ ...event, eventKey: `campaign:${index}`, stateVersion: nextVersion }))],
      historyEvents: input.historyEvents, artifact, turnId: input.turnId, nextStateVersion: nextVersion });
    nextState.campaignRuntime = outcome.runtime;
    events.push(...outcome.events);
    rewards.push(...outcome.rewards);
  }
  // 3. Stage rewards: applied locally, deduped by runtime.grantedRewardKeys.
  if (artifact) {
    for (const reward of rewards) {
      for (const spec of reward.policy.rewards) {
        if (spec.kind === 'knowledge') {
          const actorId = campaignActor(spec.toActorId ?? playerActorId);
          nextState.discoveries = [...(nextState.discoveries ?? [])];
          if (!nextState.discoveries.some(d => d.entryId === spec.targetId && d.actorId === actorId)) {
            nextState.discoveries.push({ entryId: spec.targetId, actorId,
              knownAtStateVersion: nextVersion, sourceTurnId: input.turnId, knownVia: 'told' });
            events.push({ eventType: 'knowledge_discovered', payload: { entryId: spec.targetId, actorId } });
          }
        } else if (spec.kind === 'relationship' && spec.toActorId) {
          shiftRelationship(spec.targetId, spec.toActorId, spec.delta ?? 1);
        } else if (spec.kind === 'item') {
          nextState.itemOwners = { ...nextState.itemOwners };
          if (nextState.itemOwners[spec.targetId] === undefined) {
            nextState.itemOwners[spec.targetId] = campaignActor(spec.toActorId ?? playerActorId);
            nextState.itemSources = { ...(nextState.itemSources ?? {}) };
            nextState.itemSources[spec.targetId] = { kind: 'quest_reward', sourceId: reward.policyId, obtainedAtStateVersion: nextVersion };
            events.push({ eventType: 'item_transferred', payload: { itemId: spec.targetId, toActorId: nextState.itemOwners[spec.targetId] } });
          }
        } else if (spec.kind === 'resource_cap') {
          const actorId = campaignActor(spec.toActorId ?? playerActorId);
          const stored = nextState.cards?.find(card => card.actorId === actorId);
          const card = stored?.card as { resourceMax?: Record<string, number> } | undefined;
          if (card?.resourceMax?.[spec.targetId] !== undefined) {
            card.resourceMax[spec.targetId] = Math.max(1, card.resourceMax[spec.targetId]! + (spec.delta ?? 1));
            events.push({ eventType: 'resource_cap_changed', payload: { actorId, resourceId: spec.targetId, cap: card.resourceMax[spec.targetId] } });
          }
        } else if (spec.kind === 'skill_rank') {
          const actorId = campaignActor(spec.toActorId ?? playerActorId);
          nextState.skills = [...(nextState.skills ?? [])];
          const entry = nextState.skills.find(skill => skill.actorId === actorId && (skill.skillId === spec.targetId || skill.skillId === spec.targetId.replace(/^skill-/, '')));
          if (entry) {
            const ranks = ['untrained', 'novice', 'trained', 'expert', 'master'] as const;
            const requested = ranks.indexOf(spec.rank as typeof ranks[number]);
            const nextIndex = Math.min(ranks.length - 1, Math.max(ranks.indexOf(entry.rank), requested >= 0 ? requested : ranks.indexOf(entry.rank) + 1));
            entry.rank = ranks[nextIndex]!;
            const card = nextState.cards?.find(c => c.actorId === actorId)?.card as ActorCard | undefined;
            if (card) card.skills = { ...card.skills, [entry.skillId]: entry.rank };
            events.push({ eventType: 'training_completed', payload: { actorId, skillId: spec.targetId, rank: entry.rank } });
          }
        }
      }
    }
  }
  // Ending claims observe the complete prepared facts, including consequence
  // and reward effects. This pass cannot claim any additional unapplied grant.
  const ending = evaluateCampaignProgress({ plan: input.plan, runtime: nextState.campaignRuntime, state: nextState,
    evaluationMode: 'ending_only', transactionEvents: [...transactionEvents,
      ...events.map((event, index) => ({ ...event, eventKey: `campaign:${index}`, stateVersion: nextVersion }))],
    historyEvents: input.historyEvents, turnId: input.turnId, nextStateVersion: nextVersion });
  nextState.campaignRuntime = ending.runtime;
  events.push(...ending.events);
  return events;
}

export async function readCampaignEventHistory(db: SqliteDatabase, branchId: string): Promise<BranchEventRecord[]> {
  const rows = await db.queryAll<{ event_seq: number; event_type: string; payload_json: string; state_version: number }>(
    'SELECT event_seq, event_type, payload_json, state_version FROM branch_events WHERE branch_id=? ORDER BY event_seq DESC LIMIT ?',
    [branchId, EVENT_HISTORY_WINDOW]);
  return rows.reverse().map(row => {
    const payload = JSON.parse(row.payload_json);
    return { eventType: row.event_type === 'recordEvent' && typeof payload?.eventType === 'string' ? payload.eventType : row.event_type,
      payload, eventKey: String(row.event_seq), stateVersion: row.state_version };
  });
}

import type { CampaignContentArtifactV1, CampaignPlanV1 } from './types';
import type { SituationCondition } from '../situations/types';
import { validateConditionShape } from '../situations/conditions';

type Leaf = Exclude<SituationCondition, { kind: 'all' | 'any' | 'not' }>;
type Possibility = { yes: boolean; no: boolean };
const unknown: Possibility = { yes: true, no: true };
const absent: Possibility = { yes: false, no: true };
const present: Possibility = { yes: true, no: false };

function leaves(condition: SituationCondition, positive = true): { leaf: Leaf; positive: boolean }[] {
  if (condition.kind === 'not') return leaves(condition.of, !positive);
  if (condition.kind === 'all' || condition.kind === 'any') return condition.of.flatMap(c => leaves(c, positive));
  return [{ leaf: condition, positive }];
}

/**
 * New-authoring gate only: an earlier stage cannot automatically end the
 * campaign while its later main goal is still unattempted, without actual
 * loss/cancellation evidence. This does not revalidate archived plans or
 * change runtime NOT semantics. It is a necessary structural check, not a
 * complete solver for authored conditions or a judgement of ending prose.
 */
export function validateEndingCompletionOrder(plan: CampaignPlanV1, artifact: CampaignContentArtifactV1): string[] {
  const retired = new Set(plan.retiredNodeIds ?? []);
  const nodes = plan.nodes.filter(n => !retired.has(n.nodeId));
  const valid = (condition: SituationCondition) => {
    const errors: string[] = [];
    validateConditionShape(condition, errors);
    return errors.length === 0;
  };
  if (nodes.some(n => !valid(n.completion)) || plan.possibleEndings.some(e => !valid(e.condition))) return [];
  const after = (nodeId: string): Set<string> => {
    const result = new Set<string>();
    const queue = [nodeId];
    while (queue.length) {
      const current = queue.shift()!;
      const node = nodes.find(n => n.nodeId === current);
      const next = [...(node?.nextNodeIds ?? []), ...nodes.filter(n => n.statusDependencies.includes(current)).map(n => n.nodeId)];
      for (const id of next) if (id !== nodeId && !result.has(id)) { result.add(id); queue.push(id); }
    }
    return result;
  };
  const positiveEvents = (condition: SituationCondition | null) => condition && valid(condition)
    ? leaves(condition).filter(row => row.positive && row.leaf.kind === 'committed_event').map(row => (row.leaf as Extract<Leaf, { kind: 'committed_event' }>).eventType) : [];
  const successfulEvents = new Set(artifact.situations.flatMap(s => s.definition.methods.flatMap(m =>
    ['success', 'full_success'].flatMap(grade => (m.outcomeTemplates?.[grade as 'success' | 'full_success'].effects ?? [])
      .filter(e => e.template === 'record_event').map(e => (e as { eventType: string }).eventType)))));
  const lossEvents = new Set([
    ...nodes.flatMap(n => [...positiveEvents(n.failure), ...positiveEvents(n.cancellation)]),
    ...artifact.situations.flatMap(s => s.definition.methods.flatMap(m =>
      ['failure', 'severe_failure'].flatMap(grade => (m.outcomeTemplates?.[grade as 'failure' | 'severe_failure'].effects ?? [])
        .filter(e => e.template === 'record_event').map(e => (e as { eventType: string }).eventType)))).filter(event => !successfulEvents.has(event)),
  ]);
  const errors: string[] = [];
  for (const ending of plan.possibleEndings) {
    const endingLeaves = leaves(ending.condition);
    const predecessors = endingLeaves.filter(row => row.positive && row.leaf.kind === 'campaign_node_status' && row.leaf.status === 'succeeded')
      .map(row => (row.leaf as Extract<Leaf, { kind: 'campaign_node_status' }>).nodeId);
    for (const target of nodes.filter(n => n.role === 'main' && predecessors.some(id => after(id).has(n.nodeId)
      && !nodes.find(p => p.nodeId === id)?.alternativeNodeIds.includes(n.nodeId)))) {
      const futureEvents = new Set(positiveEvents(target.completion));
      const usesAbsence = endingLeaves.some(({ leaf, positive }) => !positive && (
        (leaf.kind === 'committed_event' && futureEvents.has(leaf.eventType))
        || (leaf.kind === 'campaign_node_status' && leaf.nodeId === target.nodeId && leaf.status === 'succeeded')));
      const unfinished = new Set([target.nodeId, ...after(target.nodeId)]);
      const unfinishedEvents = new Set(nodes.filter(n => unfinished.has(n.nodeId)).flatMap(n => positiveEvents(n.completion)));
      const possible = (condition: SituationCondition): Possibility => {
        if (condition.kind === 'not') { const p = possible(condition.of); return { yes: p.no, no: p.yes }; }
        if (condition.kind === 'all' || condition.kind === 'any') {
          const children = condition.of.map(possible);
          return condition.kind === 'all' ? { yes: children.every(c => c.yes), no: children.some(c => c.no) }
            : { yes: children.some(c => c.yes), no: children.every(c => c.no) };
        }
        if (condition.kind === 'campaign_node_status' && (['failed', 'cancelled'].includes(condition.status)
          || (condition.status === 'succeeded' && unfinished.has(condition.nodeId)))) return absent;
        if (condition.kind === 'committed_event' && (unfinishedEvents.has(condition.eventType) || lossEvents.has(condition.eventType))) return absent;
        if (condition.kind === 'promise_status' && condition.status === 'broken') return absent;
        if (condition.kind === 'actor_alive') return present;
        return unknown;
      };
      if (possible(ending.condition).yes) {
        errors.push(usesAbsence
          ? `ending ${ending.endingId}: absence of later main goal ${target.nodeId} can end the campaign before it is attempted; require committed failure/cancellation/loss evidence or completion of the later goal (尚未完成不等于失败).`
          : `ending ${ending.endingId}: an earlier stage can end the campaign before later main goal ${target.nodeId} is attempted; require its completion or committed failure/cancellation/loss evidence. A genuinely optional epilogue must be role optional, not an unfinished required main goal.`);
        break;
      }
    }
  }
  return errors;
}

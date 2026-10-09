import type { CampaignNodeV1, CampaignPlanV1, CampaignRuntimeV1 } from '../../domain/campaignPlan/types';
import type { GameStateSnapshot } from '../../domain/state/types';

export const STAGE_PREPARATION_REASON = 'stage_content_prepared_ahead';
const TARGET_PREFIX = 'stage_content_target:';
const TERMINAL = new Set(['succeeded', 'failed', 'superseded', 'cancelled']);

export function stagePreparationReasons(nodeId: string): string[] {
  return [STAGE_PREPARATION_REASON, TARGET_PREFIX + nodeId];
}

/** The scope is part of the durable job, so a later trigger cannot retarget a
 * running/frozen request to a different stage. It never enters public UI. */
export function stagePreparationTargetId(reasons: readonly string[]): string | null {
  const targets = [...new Set(reasons.filter(reason => reason.startsWith(TARGET_PREFIX)).map(reason => reason.slice(TARGET_PREFIX.length)))];
  if (!reasons.includes(STAGE_PREPARATION_REASON)) return null;
  if (targets.length !== 1 || !targets[0]) throw new Error('stage_preparation_scope_missing');
  return targets[0]!;
}

/** One nearest unfinished main successor; never skip an already prepared
 * next stage to expand more distant content, endings or unrelated branches. */
export function evaluateStagePreparationTarget(input: {
  plan: CampaignPlanV1; runtime: CampaignRuntimeV1; state: GameStateSnapshot;
}): CampaignNodeV1 | null {
  const { plan, runtime, state } = input;
  const primary = plan.nodes.find(node => node.nodeId === runtime.primaryNodeId);
  const current = runtime.nodeStates.find(node => node.nodeId === runtime.primaryNodeId);
  if (runtime.campaignStatus !== 'active' || current?.status !== 'active' || !primary
    || !primary.situationRef || !(state.situations ?? []).some(s => s.situationId === primary.situationRef && ['active', 'eligible'].includes(s.status))) return null;
  const visited = new Set<string>([primary.nodeId]);
  const queue = [...primary.nextNodeIds];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = plan.nodes.find(item => item.nodeId === id);
    if (!node) continue;
    const status = runtime.nodeStates.find(item => item.nodeId === id)?.status;
    if (node.role !== 'main' || plan.retiredNodeIds?.includes(id) || (status && TERMINAL.has(status))) {
      queue.push(...node.nextNodeIds);
      continue;
    }
    if (status && !['planned', 'available'].includes(status)) return null;
    return node.coverage === 'provisional' || !node.situationRef
      || !(state.situations ?? []).some(s => s.situationId === node.situationRef && !['resolved', 'suppressed'].includes(s.status)) ? node : null;
  }
  return null;
}

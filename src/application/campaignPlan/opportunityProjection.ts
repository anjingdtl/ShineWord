import type { ActorCard } from '../../domain/characters/card';
import type { ContentEntry } from '../../domain/content/types';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { CampaignContentArtifactV1, CampaignPlanV1 } from '../../domain/campaignPlan/types';
import type { SituationDefinitionV1 } from '../../domain/situations/types';
import { assessMethod } from '../guidance/candidates';
import type { AllowedCandidateV1 } from '../guidance/types';

export type OpportunityProjectionStatus =
  | 'no_campaign'
  | 'paused'
  | 'terminal'
  | 'ready'
  | 'blocked'
  | 'content_gap'
  | 'stale_binding';

export interface ProjectedOpportunityRoute {
  candidateRef: string;
  situationId: string;
  methodId: string;
  title: string;
  goal: string;
  firstStepIntent: string;
  actionKind: AllowedCandidateV1['actionKind'];
  available: boolean;
  blockers: readonly string[];
  /** Same signature means one displayed action can lead to several authored routes. */
  actionSignature: string;
}

export interface ProjectedOpportunityRouteGroup {
  actionSignature: string;
  firstStepIntent: string;
  candidateRefs: readonly string[];
}

export interface ProjectedNarrativeOpportunity {
  nodeId: string;
  situationId: string;
  title: string;
  objective: string;
  publicSummary: string;
  priority: number;
  /** Authored incoming plan edges. Runtime effects remain in GameStateSnapshot. */
  incomingNodeIds: readonly string[];
  routes: readonly ProjectedOpportunityRoute[];
  routeGroups: readonly ProjectedOpportunityRouteGroup[];
}

export interface NarrativeOpportunityProjection {
  status: OpportunityProjectionStatus;
  primarySituationId?: string;
  preferredCandidateRef?: string;
  /** Only public, currently bound nodes and player-visible methods appear here. */
  opportunities: readonly ProjectedNarrativeOpportunity[];
  feedback?: string;
}

export interface ProjectNarrativeOpportunitiesInput {
  state: GameStateSnapshot;
  plan?: CampaignPlanV1 | null;
  artifacts?: readonly CampaignContentArtifactV1[];
  situationDefinitions: readonly { situationId: string; definition: SituationDefinitionV1 }[];
  playerCard: ActorCard;
  cards: readonly ActorCard[];
  entries: readonly ContentEntry[];
  /** When this grade failed, recommend another legal route in the same node first. */
  failedMethodRef?: string;
}

const TERMINAL_CAMPAIGN_STATUSES = new Set(['completed', 'failed', 'ended']);

/**
 * Read-only projection of authored plan nodes onto the current branch. It
 * carries no progress of its own: node status, gates, ownership and effects
 * are read from the existing plan/artifact binding and GameStateSnapshot.
 */
export function projectNarrativeOpportunities(
  input: ProjectNarrativeOpportunitiesInput,
): NarrativeOpportunityProjection {
  const { state, plan, playerCard } = input;
  const runtime = state.campaignRuntime;
  if (!runtime || !plan) return { status: 'no_campaign', opportunities: [] };
  if (runtime.planBinding.planId !== plan.planId
    || runtime.planBinding.revision !== plan.revision
    || runtime.planBinding.contentHash !== plan.contentHash) {
    return { status: 'stale_binding', opportunities: [], feedback: '主线内容绑定已变化，请刷新当前局面。' };
  }
  if (TERMINAL_CAMPAIGN_STATUSES.has(runtime.campaignStatus)) {
    return {
      status: 'terminal', opportunities: [],
      ...(runtime.ending?.title ? { feedback: `本段战役已结束：${runtime.ending.title}` } : { feedback: '本段战役已结束。' }),
    };
  }
  if (runtime.campaignStatus === 'paused' || runtime.campaignStatus === 'preparing') {
    return { status: 'paused', opportunities: [], feedback: '战役当前暂停，恢复后可继续推进。' };
  }

  const boundIds = new Set(state.campaignContentBinding?.artifactIds ?? plan.contentArtifactRefs);
  const artifacts = (input.artifacts ?? []).filter(artifact => boundIds.has(artifact.artifactId)
    && artifact.planId === plan.planId && artifact.planRevision === plan.revision);
  const artifactSituation = new Map(artifacts.flatMap(artifact => artifact.situations.map(situation => [
    situation.entryId,
    { nodeId: situation.nodeId, artifactId: artifact.artifactId },
  ] as const)));
  const definitions = new Map(input.situationDefinitions.map(item => [item.situationId, item.definition] as const));
  const states = new Map(runtime.nodeStates.map(node => [node.nodeId, node] as const));
  const active = [...plan.nodes]
    .filter(node => states.get(node.nodeId)?.status === 'active')
    .sort((a, b) => nodePriority(a.nodeId, input) - nodePriority(b.nodeId, input));

  const actorLocation = state.actors[playerCard.actorId]?.locationId;
  const situationStatuses = new Map((state.situations ?? []).map(item => [item.situationId, item] as const));
  const methodContext = {
    state,
    playerCard,
    cardsByName: new Map(input.cards.map(card => [card.actorId, card] as const)),
    entries: input.entries,
    situationStatuses,
    causalWorldTimeOrder: state.causalWorldTimeOrder ?? 0,
  };

  const opportunities: ProjectedNarrativeOpportunity[] = [];
  let activeNodeMissingContent = false;
  let blockedByCurrentState = false;
  for (const node of active) {
    if (node.visibility !== 'public') {
      activeNodeMissingContent = true;
      continue;
    }
    if (node.coverage !== 'concrete' || !node.situationRef) {
      activeNodeMissingContent = true;
      continue;
    }
    const definition = definitions.get(node.situationRef);
    const authored = artifactSituation.get(node.situationRef);
    if (!definition || !authored || authored.nodeId !== node.nodeId) {
      activeNodeMissingContent = true;
      continue;
    }
    const snapshot = situationStatuses.get(node.situationRef);
    if (!snapshot || snapshot.status !== 'active') {
      // Content exists. Its authored activation/knowledge gate has not
      // produced an active situation yet, so this is a state gate, not a
      // reason to fabricate a generic action.
      if (!snapshot || snapshot.status === 'dormant' || snapshot.status === 'eligible') blockedByCurrentState = true;
      else activeNodeMissingContent = true;
      continue;
    }
    if (definition.locationId && definition.locationId !== actorLocation) continue;

    const routes = definition.methods.flatMap(method => {
      const assessed = assessMethod(node.situationRef!, method, methodContext);
      if (!assessed.visible) return [];
      return [{
        candidateRef: assessed.ref,
        situationId: node.situationRef!,
        methodId: method.methodId,
        title: method.title,
        goal: method.goal,
        firstStepIntent: method.firstStep.intent,
        actionKind: method.firstStep.actionKind,
        available: assessed.eligible,
        blockers: [...assessed.blockers],
        actionSignature: actionSignature(method.firstStep),
      } satisfies ProjectedOpportunityRoute];
    });
    if (routes.length === 0) {
      activeNodeMissingContent = true;
      continue;
    }
    const prioritizedRoutes = prioritizeFailedRoute(routes, input.failedMethodRef);
    opportunities.push({
      nodeId: node.nodeId,
      situationId: node.situationRef,
      title: node.title,
      objective: node.publicObjective,
      publicSummary: definition.summary,
      priority: nodePriority(node.nodeId, input),
      incomingNodeIds: incomingNodeIds(node.nodeId, plan.nodes),
      routes: prioritizedRoutes,
      routeGroups: groupRoutes(prioritizedRoutes),
    });
  }

  opportunities.sort((a, b) => a.priority - b.priority || a.nodeId.localeCompare(b.nodeId));
  const preferred = opportunities.flatMap(opportunity => opportunity.routes)
    .find(route => route.available)?.candidateRef;
  if (opportunities.length > 0 && preferred) {
    return {
      status: opportunities.some(item => item.routes.some(route => route.available)) ? 'ready' : 'blocked',
      primarySituationId: opportunities[0]!.situationId,
      preferredCandidateRef: preferred,
      opportunities,
      ...(!opportunities.some(item => item.routes.some(route => route.available))
        ? { feedback: '当前已知剧情路径的前提尚未满足；可先补齐路径所列条件。' }
        : activeNodeMissingContent ? { feedback: '部分已激活的剧情节点缺少已绑定的具体内容。' } : {}),
    };
  }

  if (activeNodeMissingContent || (active.length === 0 && runtime.campaignStatus === 'active')) {
    return {
      status: 'content_gap',
      opportunities: [],
      feedback: '当前主线没有已准备好的可行动剧情内容；暂时无法推进这条剧情。',
    };
  }
  if (blockedByCurrentState) {
    return {
      status: 'blocked', opportunities: [],
      feedback: '已知剧情局面仍在等待当前世界条件解锁。',
    };
  }
  return { status: 'ready', opportunities: [] };
}

function nodePriority(nodeId: string, input: ProjectNarrativeOpportunitiesInput): number {
  const runtime = input.state.campaignRuntime;
  const node = input.plan?.nodes.find(item => item.nodeId === nodeId);
  if (!runtime || !node) return Number.MAX_SAFE_INTEGER;
  if (nodeId === runtime.primaryNodeId) return 0;
  const primary = input.plan?.nodes.find(item => item.nodeId === runtime.primaryNodeId);
  if (primary?.nextNodeIds.includes(nodeId)) return 10 + primary.nextNodeIds.indexOf(nodeId);
  if (primary?.alternativeNodeIds.includes(nodeId)) return 20 + primary.alternativeNodeIds.indexOf(nodeId);
  return node.role === 'main' ? 100 : 200;
}

function incomingNodeIds(nodeId: string, nodes: CampaignPlanV1['nodes']): string[] {
  return nodes.filter(node => node.nextNodeIds.includes(nodeId) || node.alternativeNodeIds.includes(nodeId))
    .map(node => node.nodeId).sort();
}

function actionSignature(step: {
  actionKind: string; skillId?: string; itemId?: string; abilityId?: string;
  targetEntryId?: string; destinationId?: string; intent: string;
}): string {
  const normalize = (value: string): string => value.replace(/[\s，。！？、,.!?；;：:]/g, '');
  return [step.actionKind, step.skillId ?? '', step.itemId ?? '', step.abilityId ?? '',
    step.targetEntryId ?? '', step.destinationId ?? '', normalize(step.intent)].join('|');
}

function groupRoutes(routes: readonly ProjectedOpportunityRoute[]): ProjectedOpportunityRouteGroup[] {
  const groups = new Map<string, ProjectedOpportunityRouteGroup>();
  for (const route of routes) {
    const current = groups.get(route.actionSignature);
    if (current) {
      if (!current.candidateRefs.includes(route.candidateRef)) {
        groups.set(route.actionSignature, { ...current, candidateRefs: [...current.candidateRefs, route.candidateRef] });
      }
    } else {
      groups.set(route.actionSignature, {
        actionSignature: route.actionSignature,
        firstStepIntent: route.firstStepIntent,
        candidateRefs: [route.candidateRef],
      });
    }
  }
  return [...groups.values()];
}

function prioritizeFailedRoute(
  routes: readonly ProjectedOpportunityRoute[],
  failedMethodRef?: string,
): ProjectedOpportunityRoute[] {
  if (!failedMethodRef) return [...routes];
  const alternateAvailable = routes.some(route => route.available && route.candidateRef !== failedMethodRef);
  if (!alternateAvailable) return [...routes];
  return [...routes].sort((a, b) => Number(a.candidateRef === failedMethodRef) - Number(b.candidateRef === failedMethodRef));
}

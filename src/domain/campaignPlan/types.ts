import type { SituationCondition, SituationTransitionOp } from '../situations/types';

/**
 * Campaign mainline domain (P9 plan §5). Three layers with separate owners:
 *
 * - CampaignIntentV1  — what the player wants (user-owned, revisable).
 * - CampaignPlanV1    — future problems and opportunities (immutable revisions).
 * - CampaignRuntimeV1 — what actually happened (branch snapshot state, written
 *   only by the commit transaction after CampaignProgressReducer evaluation).
 *
 * A plan never proves anything happened and never grants capabilities; all
 * progress derives from committed events and evaluated conditions.
 */

export const CAMPAIGN_INTENT_SCHEMA = 'campaign-intent-1';
export const CAMPAIGN_PLAN_SCHEMA = 'campaign-plan-1';
export const CAMPAIGN_RUNTIME_SCHEMA = 'campaign-runtime-1';
export const CAMPAIGN_CONTENT_SCHEMA = 'campaign-content-1';
export const CAMPAIGN_PLAN_COMPILER_VERSION = 'campaign-plan-compiler-1';

export type CampaignLengthPreference = 'short' | 'medium' | 'long';

export interface CampaignIntentV1 {
  schemaVersion: typeof CAMPAIGN_INTENT_SCHEMA;
  setupId: string;
  /** Monotone per setup; every revision keeps the full raw intent. */
  intentRevision: number;
  /** Free user text; may be empty when goalMode is exploration_pending. */
  rawIntent: string;
  /** Compact normalized statement kept for planning prompts and audits. */
  normalizedIntent: string;
  /** declared: user stated a goal; exploration_pending: goal chosen later (A04). */
  goalMode: 'declared' | 'exploration_pending';
  protagonistBinding: {
    actorId: string;
    kind: 'original' | 'canon';
    name: string;
    canonEntityId?: string;
  };
  openingAnchor: {
    worldTimeOrder: number;
    anchorEventId?: string;
    locationId: string;
  };
  companionBindings: ReadonlyArray<{ actorId: string; templateId: string; directive?: string }>;
  tone?: string;
  lengthPreference: CampaignLengthPreference;
  explorationPreference?: string;
  /** User-stated constraints the plan must respect verbatim (bounded count). */
  userConstraints: string[];
  /** Canon entities/locations the user explicitly named in the intent. */
  requestedCanonTargets: string[];
  /** Frozen knowledge policy hash inputs inherited from the world config. */
  knowledgePolicy: 'anchor_projection';
  sourceCoverageBinding: {
    worldId: string;
    packageRevision: number;
    coverageWorldTimeOrder: number;
    packageContentHash: string;
  };
  createdAt: string;
}

export type CampaignNodeRole = 'main' | 'optional';
export type CampaignNodeCoverage = 'concrete' | 'provisional';

export interface CampaignNodeProvenanceV1 {
  kind: 'design_fill' | 'canon_inspired';
  /** Canon fact ids grounding the node; empty for pure design fill. */
  sourceFactIds: string[];
  rationale: string;
}

export interface CampaignNodeV1 {
  /** Stable within a plan lineage; replans keep ids when meaning is kept. */
  nodeId: string;
  role: CampaignNodeRole;
  /** Player-safe stage title (no GM secrets, no future spoilers). */
  title: string;
  /** Player-visible objective statement for this stage. */
  publicObjective: string;
  /** GM-only purpose; never enters public projections or Narrator payloads. */
  gmPurpose: string;
  /** Null only on start nodes (immediately activatable). */
  activation: SituationCondition | null;
  completion: SituationCondition;
  failure: SituationCondition | null;
  cancellation: SituationCondition | null;
  /** Node ids whose resolution unlocks this node (soft ordering). */
  statusDependencies: string[];
  /** Alternative nodes that can satisfy this stage instead. */
  alternativeNodeIds: string[];
  nextNodeIds: string[];
  /** Content artifact situation implementing this stage's playable board. */
  situationRef?: string;
  rewardPolicyRefs: string[];
  consequenceRefs: string[];
  coverage: CampaignNodeCoverage;
  visibility: 'public' | 'gm';
  provenance: CampaignNodeProvenanceV1;
}

export interface CampaignEndingV1 {
  endingId: string;
  title: string;
  /** Player-safe description shown in the ending review. */
  publicDescription: string;
  condition: SituationCondition;
  outcomeKind: 'success' | 'pyrrhic' | 'failure' | 'open';
}

export interface CampaignPlanV1 {
  schemaVersion: typeof CAMPAIGN_PLAN_SCHEMA;
  planId: string;
  /** Immutable revision number; runtime binds planId+revision. */
  revision: number;
  parentRevision: number | null;
  intentHash: string;
  baseWorldBinding: {
    worldId: string;
    packageRevision: number;
    packageContentHash: string;
    coverageWorldTimeOrder: number;
  };
  ruleBindingHash: string;
  /** Public long-term goal statement (player-visible). */
  longTermGoal: string;
  /** Proposal summary shown before adoption (goal/tone/situation/first problem). */
  publicPitch: string;
  /** GM-only premise; excluded from every public projection. */
  gmPremise: string;
  tone: string;
  lengthPreference: CampaignLengthPreference;
  startNodeIds: string[];
  nodes: CampaignNodeV1[];
  possibleEndings: CampaignEndingV1[];
  /** Dependencies not yet buildable/resolvable at plan time (远期 provisional). */
  unresolvedDependencies: ReadonlyArray<{
    nodeId: string;
    description: string;
    kind: 'segment_build' | 'content_prep';
  }>;
  contentArtifactRefs: string[];
  compilerVersion: string;
  contentHash: string;
  createdAt: string;
}

export const CAMPAIGN_NODE_STATUSES = [
  'planned', 'available', 'active', 'suspended',
  'succeeded', 'failed', 'superseded', 'cancelled',
] as const;
export type CampaignNodeRuntimeStatus = (typeof CAMPAIGN_NODE_STATUSES)[number];

export const CAMPAIGN_STATUSES = [
  'preparing', 'active', 'paused', 'completed', 'failed', 'ended',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const DEFERRED_CONSEQUENCE_STATUSES = ['pending', 'triggered', 'discharged', 'cancelled'] as const;
export type DeferredConsequenceStatus = (typeof DEFERRED_CONSEQUENCE_STATUSES)[number];

export interface DeferredConsequenceRecordV1 {
  consequenceId: string;
  /** Player-safe description of the pending repercussion. */
  description: string;
  triggerCondition: SituationCondition;
  /** Committed events that created this obligation. */
  sourceEventRefs: string[];
  affectedActors: string[];
  /** CampaignEffectSpecs applied when the consequence triggers. */
  effectSpecs: readonly CampaignEffectSpec[];
  visibility: 'public' | 'gm';
  status: DeferredConsequenceStatus;
  idempotencyKey: string;
  createdAtVersion: number;
  triggeredAtVersion?: number;
  sourceTurnId: string;
}

export interface CampaignNodeRuntimeV1 {
  nodeId: string;
  status: CampaignNodeRuntimeStatus;
  activatedAtVersion?: number;
  resolvedAtVersion?: number;
  supersededBy?: string;
  supersedeReason?: string;
  /** Evidence entries backing the resolution (event refs / condition ids). */
  completedEvidence: ReadonlyArray<{ kind: 'event' | 'condition'; ref: string; atStateVersion: number }>;
}

export interface CampaignEndingRuntimeV1 {
  endingId: string;
  title: string;
  outcomeKind: CampaignEndingV1['outcomeKind'];
  atStateVersion: number;
  turnId: string;
}

export interface CampaignRuntimeV1 {
  schemaVersion: typeof CAMPAIGN_RUNTIME_SCHEMA;
  branchId: string;
  planBinding: { planId: string; revision: number; contentHash: string };
  intentRevision: number;
  /** Snapshot state version this runtime was last updated at. */
  stateVersion: number;
  campaignStatus: CampaignStatus;
  primaryNodeId: string | null;
  nodeStates: CampaignNodeRuntimeV1[];
  deferredConsequences: DeferredConsequenceRecordV1[];
  /** Event keys (event seq identities) already consumed by progress evaluation. */
  processedEventKeys: string[];
  /** Reward grants keyed `nodeId:policyId:grantIndex` — replan/rename cannot re-grant. */
  grantedRewardKeys: string[];
  lastProgressVersion: number;
  replanReasonCodes: string[];
  /** Player-visible objective line projected from the ACTIVE node (runtime truth). */
  publicObjectiveProjection: string;
  /** Recent committed progress lines for the UI card (bounded ring). */
  recentProgressLines: ReadonlyArray<{ atStateVersion: number; text: string }>;
  ending?: CampaignEndingRuntimeV1;
}

// ---------------------------------------------------------------------------
// Campaign effect specs (model-selectable, locally compiled & validated).
// ---------------------------------------------------------------------------

/**
 * Whitelisted campaign effect templates (plan §6.2). The planning model only
 * selects template ids + legal references; every number is validated by the
 * local compiler against world definitions before an artifact is published.
 */
export type CampaignEffectSpec =
  | { template: 'situation_status'; situationId: string; status: import('../situations/types').SituationStatus; resolution?: string }
  | { template: 'situation_counter'; situationId: string; counterId: string; delta: number }
  | { template: 'promise_create'; situationId: string; promiseId: string; promisorActorId: string; promiseeActorId?: string; description: string }
  | { template: 'promise_fulfill'; situationId: string; promiseId: string }
  | { template: 'promise_break'; situationId: string; promiseId: string }
  | { template: 'grant_knowledge'; entryId: string; actorId?: string }
  | { template: 'grant_item'; itemId: string; toActorId: string }
  | { template: 'relationship_shift'; fromActorId: string; toActorId: string; delta: number }
  | { template: 'condition_apply'; actorId: string; conditionId: string }
  | { template: 'condition_remove'; actorId: string; conditionId: string }
  | { template: 'resource_change'; actorId: string; resourceId: string; amount: number }
  | { template: 'clock_advance'; minutes: number }
  | { template: 'record_event'; eventType: string; summary: string }
  | { template: 'schedule_consequence'; consequenceId: string }
  | { template: 'suppress_reference_event'; situationId: string; eventKey: string; reason: string };

export const CAMPAIGN_EFFECT_TEMPLATES: readonly string[] = [
  'situation_status', 'situation_counter', 'promise_create', 'promise_fulfill', 'promise_break',
  'grant_knowledge', 'grant_item', 'relationship_shift', 'condition_apply', 'condition_remove',
  'resource_change', 'clock_advance', 'record_event', 'schedule_consequence', 'suppress_reference_event',
];

/** Compiled, executable projection of effect specs for one commit. */
export interface CompiledCampaignEffects {
  /** Engine EffectOperations merged into the contract outcome clause. */
  effects: import('../turns/types').EffectOperation[];
  /** Situation transitions applied by the situation runtime in the same commit. */
  transitions: SituationTransitionOp[];
  /** Knowledge entries granted to actors (engine-origin). */
  knowledgeGrants: ReadonlyArray<{ entryId: string; actorId: string }>;
  /** Relationship deltas (engine-origin, bounded). */
  relationshipShifts: ReadonlyArray<{ fromActorId: string; toActorId: string; delta: number }>;
  /** Deferred consequences to schedule (registered into runtime). */
  scheduledConsequences: string[];
}

// ---------------------------------------------------------------------------
// Reward policies (content artifact owned; granted by the progress reducer).
// ---------------------------------------------------------------------------

export interface CampaignRewardSpecV1 {
  kind: 'skill_rank' | 'item' | 'knowledge' | 'relationship' | 'resource_cap';
  /** Target of the reward: skill id / item id / entry id / actor id pair. */
  targetId: string;
  toActorId?: string;
  /** Rank name for skill_rank; unused otherwise. */
  rank?: string;
  /** Delta for relationship; cap delta for resource_cap. */
  delta?: number;
}

export interface CampaignRewardPolicyV1 {
  policyId: string;
  nodeId: string;
  description: string;
  rewards: readonly CampaignRewardSpecV1[];
}

// ---------------------------------------------------------------------------
// Content artifact: campaign-scoped situations/consequences/rewards.
// ---------------------------------------------------------------------------

export interface CampaignSituationArtifactV1 {
  entryId: string;
  nodeId: string;
  definition: import('../situations/types').SituationDefinitionV1;
}

export interface CampaignContentArtifactV1 {
  schemaVersion: typeof CAMPAIGN_CONTENT_SCHEMA;
  artifactId: string;
  campaignId: string;
  /** Campaign-level (shared by branches) until a branch adopts an override. */
  scope: 'campaign';
  planId: string;
  planRevision: number;
  namespace: 'campaign';
  situations: readonly CampaignSituationArtifactV1[];
  rewardPolicies: readonly CampaignRewardPolicyV1[];
  consequenceTemplates: ReadonlyArray<{
    consequenceId: string;
    description: string;
    triggerCondition: SituationCondition;
    effectSpecs: readonly CampaignEffectSpec[];
    visibility: 'public' | 'gm';
  }>;
  /** World entry ids this artifact depends on (resolution closure). */
  dependencies: { worldEntryIds: readonly string[] };
  provenance: CampaignNodeProvenanceV1;
  contentHash: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Branch events emitted by campaign settlement (persisted in branch_events).
// ---------------------------------------------------------------------------

export type CampaignEventType =
  | 'campaign_plan_adopted'
  | 'campaign_node_changed'
  | 'campaign_goal_changed'
  | 'campaign_reward_granted'
  | 'campaign_consequence_scheduled'
  | 'campaign_consequence_triggered'
  | 'campaign_ending'
  | 'campaign_status_changed';

export interface CampaignEvent {
  eventType: CampaignEventType;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Frozen runtime helpers.
// ---------------------------------------------------------------------------

export function emptyRuntimeForPlan(input: {
  branchId: string;
  plan: CampaignPlanV1;
  intentRevision: number;
  stateVersion: number;
  playerActorId: string;
}): CampaignRuntimeV1 {
  const nodeStates: CampaignNodeRuntimeV1[] = input.plan.nodes.map(node => ({
    nodeId: node.nodeId,
    status: 'planned',
    completedEvidence: [],
  }));
  const runtime: CampaignRuntimeV1 = {
    schemaVersion: CAMPAIGN_RUNTIME_SCHEMA,
    branchId: input.branchId,
    planBinding: {
      planId: input.plan.planId,
      revision: input.plan.revision,
      contentHash: input.plan.contentHash,
    },
    intentRevision: input.intentRevision,
    stateVersion: input.stateVersion,
    campaignStatus: 'active',
    primaryNodeId: null,
    nodeStates,
    deferredConsequences: [],
    processedEventKeys: [],
    grantedRewardKeys: [],
    lastProgressVersion: input.stateVersion,
    replanReasonCodes: [],
    publicObjectiveProjection: input.plan.longTermGoal,
    recentProgressLines: [],
  };
  return runtime;
}

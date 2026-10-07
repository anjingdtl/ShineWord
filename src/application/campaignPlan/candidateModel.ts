import type { CampaignEffectSpec } from '../../domain/campaignPlan/types';
import { CAMPAIGN_EFFECT_TEMPLATES } from '../../domain/campaignPlan/types';
import type { SituationTransitionOp } from '../../domain/situations/types';
import { SKILL_RANKS, type SkillRank } from '../../domain/rules/types';

/**
 * Campaign plan candidate model (plan §6.2): the model's ONLY authoring
 * surface. It selects template ids + legal references; the local compiler
 * (localCompile.ts) validates every reference and computes the authoritative
 * CampaignPlanV1/CampaignContentArtifactV1. Anything outside this shape is
 * rejected — form-like JSON that fails schema never becomes a proposal.
 */

export const CAMPAIGN_PLAN_MODEL_VERSION = 'campaign-plan-model-1';

/** Whitelisted condition templates the model may compose. */
export const CONDITION_TEMPLATE_KINDS = [
  'situation_resolved', 'situation_status', 'quest_succeeded', 'committed_event',
  'counter_at_least', 'promise_fulfilled', 'knowledge_known', 'relationship_at_least',
  'item_owned', 'actor_alive', 'actor_dead', 'node_succeeded',
] as const;
export type ConditionTemplateKind = (typeof CONDITION_TEMPLATE_KINDS)[number];

export interface ConditionTemplateNode {
  kind: ConditionTemplateKind | 'all' | 'any' | 'not';
  situationId?: string;
  status?: string;
  questId?: string;
  eventType?: string;
  payloadMatch?: Readonly<Record<string, string>>;
  counterId?: string;
  minimum?: number;
  promiseId?: string;
  entryId?: string;
  fromActorId?: string;
  toActorId?: string;
  closeness?: number;
  itemId?: string;
  actorId?: string;
  nodeId?: string;
  of?: ReadonlyArray<ConditionTemplateNode>;
}

export interface OutcomeTemplateSpec {
  resultFact: string;
  effects: readonly CampaignEffectSpec[];
}

export interface MethodSpec {
  methodId: string;
  title: string;
  goal: string;
  firstStep: {
    intent: string;
    actionKind: 'skill_check' | 'ability' | 'observe' | 'talk' | 'interact' | 'move';
    skillId?: string;
    itemId?: string;
    abilityId?: string;
    targetEntryId?: string;
    destinationId?: string;
  };
  requires: {
    skillId?: string;
    minRank?: 'untrained' | 'novice' | 'trained' | 'expert' | 'master';
    itemId?: string;
    knowledgeEntryId?: string;
    relationshipTo?: string;
    minCloseness?: number;
    actorAlive?: string;
  };
  tradeoffs: string;
  preparation: string;
  outcomes: Readonly<Record<'full_success' | 'success' | 'failure' | 'severe_failure', OutcomeTemplateSpec>>;
}

export interface StageSpec {
  nodeId: string;
  role: 'main' | 'optional';
  title: string;
  publicObjective: string;
  gmPurpose: string;
  coverage: 'concrete' | 'provisional';
  activation: ConditionTemplateNode | null;
  completion: ConditionTemplateNode;
  failure?: ConditionTemplateNode | null;
  cancellation?: ConditionTemplateNode | null;
  dependsOn: string[];
  alternatives: string[];
  next: string[];
  situationRef?: string;
  rewardPolicyRefs: string[];
  consequenceRefs: string[];
  provenance: { kind: 'design_fill' | 'canon_inspired'; sourceFactIds?: string[]; rationale: string };
}

export interface EndingSpec {
  endingId: string;
  title: string;
  publicDescription: string;
  outcomeKind: 'success' | 'pyrrhic' | 'failure' | 'open';
  condition: ConditionTemplateNode;
}

export interface ConsequenceSpec {
  consequenceId: string;
  description: string;
  trigger: ConditionTemplateNode;
  effects: readonly CampaignEffectSpec[];
  visibility: 'public' | 'gm';
}

export interface RewardSpec {
  policyId: string;
  nodeId: string;
  description: string;
  rewards: ReadonlyArray<{
    kind: 'skill_rank' | 'item' | 'knowledge' | 'relationship' | 'resource_cap';
    targetId: string;
    toActorId?: string;
    rank?: string;
    delta?: number;
  }>;
}

export interface FirstSituationSpec {
  situationTitle: string;
  summary: string;
  gmBrief: string;
  pressureDescription: string;
  deadlineClockSeconds?: number;
  methods: readonly MethodSpec[];
  signs: ReadonlyArray<{ text: string }>;
}

export interface CampaignPlanCandidateModelV1 {
  modelVersion: typeof CAMPAIGN_PLAN_MODEL_VERSION;
  proposal: {
    title: string;
    longTermGoal: string;
    publicPitch: string;
    gmPremise: string;
    tone: string;
  };
  stages: readonly StageSpec[];
  endings: readonly EndingSpec[];
  firstSituation: FirstSituationSpec;
  consequences: readonly ConsequenceSpec[];
  rewards: readonly RewardSpec[];
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Display-text fields (titles/goals/tradeoffs) clamp to their bound when
 * the model is wordy; only meaninglessly SHORT text stays a hard error.
 * Structural fields never go through this path.
 */
function clampDisplayString(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < min) return null;
  return trimmed.slice(0, max);
}
function isBoundedString(value: unknown, min: number, max: number): boolean {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
// References retain the world's existing ID spelling (locations may be
// Chinese names). The compiler, rather than an authoring-ID regex, checks scope.
function isReference(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function isOneOf(value: unknown, choices: readonly string[]): value is string {
  return typeof value === 'string' && choices.includes(value);
}

function parseRequirements(value: unknown, errors: string[], prefix: string): MethodSpec['requires'] | null {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) { errors.push(`${prefix}: requirements object required.`); return null; }
  // Optional nulls mean "no gate", as in the existing first-step adapter.
  // Keep that wire compatibility without coercing non-string IDs or ranks.
  const gates = Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null));
  const idFields = ['skillId', 'itemId', 'knowledgeEntryId', 'relationshipTo', 'actorAlive'];
  const allowed = [...idFields, 'minRank', 'minCloseness'];
  if (Object.keys(value).some(field => !allowed.includes(field))) {
    errors.push(`${prefix}: unsupported requirement field.`); return null;
  }
  for (const field of idFields) {
    if (gates[field] !== undefined && !isReference(gates[field])) {
      errors.push(`${prefix}.${field}: stable string id required.`); return null;
    }
  }
  if (gates.minRank !== undefined && (!isOneOf(gates.minRank, SKILL_RANKS) || gates.skillId === undefined)) {
    errors.push(`${prefix}.minRank: skillId and a string rank (${SKILL_RANKS.join(' | ')}) required.`); return null;
  }
  if (gates.minCloseness !== undefined && (gates.relationshipTo === undefined || !Number.isInteger(gates.minCloseness)
    || Number(gates.minCloseness) < 0 || Number(gates.minCloseness) > 100)) {
    errors.push(`${prefix}.minCloseness: relationshipTo and an integer within 0..100 required.`); return null;
  }
  return gates as MethodSpec['requires'];
}

function parseRewards(value: readonly unknown[], errors: string[], prefix: string): RewardSpec['rewards'] | null {
  const rewards: Array<RewardSpec['rewards'][number]> = [];
  for (const [index, raw] of value.entries()) {
    const at = `${prefix}.rewards[${index}]`;
    if (!isRecord(raw) || !isOneOf(raw.kind, ['skill_rank','item','knowledge','relationship','resource_cap'])) {
      errors.push(`${at}: reward object with a supported kind required.`); return null;
    }
    if (!isReference(raw.targetId)) {
      errors.push(`${at}.targetId: stable target id required.`); return null;
    }
    if (raw.toActorId !== undefined && !isReference(raw.toActorId)) {
      errors.push(`${at}.toActorId: stable actor id required.`); return null;
    }
    if (raw.kind === 'relationship' && !isReference(raw.toActorId)) {
      errors.push(`${at}: relationship reward requires targetId and toActorId.`); return null;
    }
    if (raw.rank !== undefined && (typeof raw.rank !== 'string' || !SKILL_RANKS.includes(raw.rank as SkillRank))) {
      errors.push(`${at}.rank: use a string rank: ${SKILL_RANKS.join(' | ')}; numeric ranks are invalid.`); return null;
    }
    if (raw.delta !== undefined && (!Number.isInteger(raw.delta) || Math.abs(Number(raw.delta)) > (raw.kind === 'relationship' ? 3 : 10))) {
      errors.push(`${at}.delta: bounded integer required.`); return null;
    }
    rewards.push({ kind: raw.kind as RewardSpec['rewards'][number]['kind'], targetId: raw.targetId,
      ...(raw.toActorId !== undefined ? { toActorId: raw.toActorId as string } : {}),
      ...(raw.rank !== undefined ? { rank: raw.rank as string } : {}),
      ...(raw.delta !== undefined ? { delta: raw.delta as number } : {}) });
  }
  return rewards;
}

function parseEffects(value: unknown, errors: string[], prefix: string): CampaignEffectSpec[] {
  if (!Array.isArray(value) || value.length > 8) {
    errors.push(`${prefix}: effects must be an array of ≤8 templates.`);
    return [];
  }
  const out: CampaignEffectSpec[] = [];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) { errors.push(`${prefix}.effects[${index}]: must be an object.`); continue; }
    const spec = raw as Record<string, unknown>;
    if (!isOneOf(spec.template, CAMPAIGN_EFFECT_TEMPLATES)) {
      errors.push(`${prefix}.effects[${index}]: unknown effect template ${String(spec.template)}.`);
      continue;
    }
    const template = spec.template;
    const required: Record<string, string[]> = {
      situation_counter: ['counterId'], promise_create: ['promiseId','promisorActorId','description'],
      promise_fulfill: ['promiseId'], promise_break: ['promiseId'], grant_knowledge: ['entryId'],
      grant_item: ['itemId','toActorId'], relationship_shift: ['fromActorId','toActorId'],
      condition_apply: ['actorId','conditionId'], condition_remove: ['actorId','conditionId'],
      resource_change: ['actorId','resourceId'], record_event: ['eventType','summary'],
      suppress_reference_event: ['eventKey','reason'], schedule_consequence: ['consequenceId'],
    };
    if ((required[template] ?? []).some(field => typeof spec[field] !== 'string' || !(spec[field] as string).trim())) {
      errors.push(`${prefix}: ${template} has missing required fields.`); continue;
    }
    if (template === 'clock_advance' && (!Number.isInteger(spec.minutes) || Number(spec.minutes) < 1 || Number(spec.minutes) > 240)) {
      errors.push(`${prefix}: invalid clock advance.`); continue;
    }
    if (template === 'situation_status' && !isOneOf(spec.status, ['dormant','eligible','active','resolved','suppressed'])) {
      errors.push(prefix + ': unknown situation status.');
      continue;
    }
    if (['situation_status', 'situation_counter', 'promise_create', 'promise_fulfill', 'promise_break', 'suppress_reference_event'].includes(template)
      && (typeof spec.situationId !== 'string' || spec.situationId.length === 0)) {
      errors.push(`${prefix}.effects[${index}].${template}: situationId required.`);
      continue;
    }
    if (template === 'situation_counter' && (!Number.isInteger(spec.delta) || Math.abs(Number(spec.delta)) > 10)) {
      errors.push(`${prefix}.effects[${index}]: counter delta must be an integer within ±10.`);
      continue;
    }
    if (['grant_knowledge', 'grant_item'].includes(template) && typeof spec[template === 'grant_knowledge' ? 'entryId' : 'itemId'] !== 'string') {
      errors.push(`${prefix}.effects[${index}].${template}: entry/item id required.`);
      continue;
    }
    if (template === 'relationship_shift' && (!Number.isInteger(spec.delta) || Math.abs(Number(spec.delta)) > 3)) {
      errors.push(`${prefix}.effects[${index}]: relationship delta within ±3.`);
      continue;
    }
    if (template === 'resource_change' && (!Number.isInteger(spec.amount) || Math.abs(Number(spec.amount)) > 10)) {
      errors.push(`${prefix}.effects[${index}]: resource amount within ±10.`);
      continue;
    }
    if (template === 'clock_advance' && (!Number.isInteger(spec.minutes) || Number(spec.minutes) < 1 || Number(spec.minutes) > 240)) {
      errors.push(`${prefix}.effects[${index}]: clock minutes must be an integer within 1..240.`);
      continue;
    }
    if (template === 'record_event' && (!EVENT_TYPE_PATTERN.test(String(spec.eventType)) || !isBoundedString(spec.summary, 1, 200))) {
      errors.push(`${prefix}.effects[${index}]: record_event needs snake_case type and a summary.`);
      continue;
    }
    if (template === 'schedule_consequence' && typeof spec.consequenceId !== 'string') {
      errors.push(`${prefix}.effects[${index}]: consequenceId required.`);
      continue;
    }
    out.push(spec as unknown as CampaignEffectSpec);
  }
  return out;
}

function parseCondition(value: unknown, errors: string[], prefix: string, depth = 0): ConditionTemplateNode | null {
  if (depth > 3) { errors.push(`${prefix}: condition nesting exceeds 3 levels.`); return null; }
  if (!isRecord(value)) { errors.push(`${prefix}: condition must be an object.`); return null; }
  const node = value as Record<string, unknown>;
  if (typeof node.kind !== 'string') { errors.push(`${prefix}: string condition kind required.`); return null; }
  const kind = node.kind;
  if (kind === 'all' || kind === 'any' || kind === 'not') {
    const of = node.of;
    let children: unknown[] | null = kind === 'not'
      ? (Array.isArray(of) ? (of.length === 1 ? of : null) : of && typeof of === 'object' ? [of] : null)
      : (Array.isArray(of) ? of : null);
    if (!Array.isArray(children)) {
      errors.push(`${prefix}: invalid condition children.`); return null;
    }
    // Invalid condition semantics must never become an absent condition.
    if (children.length === 0) { errors.push(`${prefix}: empty condition children.`); return null; }
    if (children.length > 6) { errors.push(prefix + ': too many conditions; refusing to truncate.'); return null; }
    const parsed = children.map((child, index) => parseCondition(child, errors, `${prefix}.${kind}[${index}]`, depth + 1));
    if (parsed.some(child => child === null)) return null;
    return { kind, of: parsed as ConditionTemplateNode[] };
  }
  // Effect-template names cannot be interpreted as condition semantics.
  if (!(CONDITION_TEMPLATE_KINDS as readonly string[]).includes(kind)) {
    errors.push(prefix + ': unknown condition kind ' + kind);
    return null;
  }
  const out: ConditionTemplateNode = { kind: kind as ConditionTemplateKind };
  if (kind === 'situation_status') {
    if (!isOneOf(node.status, ['dormant','eligible','active','resolved','suppressed'])) {
      errors.push(`${prefix}: unknown situation status.`); return null;
    }
    out.status = String(node.status);
  }
  // Field-name tolerance: models emit situation/situationId, minimum/count/
  // value etc. interchangeably; normalize before the strict checks below.
  const norm = {
    ...node,
    situationId: node.situationId ?? node.situation,
    questId: node.questId ?? node.quest,
    eventType: node.eventType ?? node.event,
    counterId: node.counterId ?? node.counter,
    promiseId: node.promiseId ?? node.promise,
    entryId: node.entryId ?? node.entry,
    itemId: node.itemId ?? node.item,
    actorId: node.actorId ?? node.actor,
    minimum: node.minimum ?? node.count ?? node.value ?? node.min,
  } as Record<string, unknown>;
  if (typeof norm.situationId === 'string') out.situationId = norm.situationId;
  if (typeof norm.questId === 'string') out.questId = norm.questId;
  if (typeof norm.eventType === 'string') out.eventType = norm.eventType;
  if (node.payloadMatch && typeof node.payloadMatch === 'object' && !Array.isArray(node.payloadMatch)
    && Object.keys(node.payloadMatch as object).length <= 4
    && Object.values(node.payloadMatch as object).every(v => typeof v === 'string')) {
    out.payloadMatch = node.payloadMatch as Record<string, string>;
  }
  if (typeof norm.counterId === 'string') out.counterId = norm.counterId;
  if (typeof norm.minimum === 'number' && Number.isInteger(norm.minimum) && norm.minimum >= 0 && norm.minimum <= 99) out.minimum = norm.minimum;
  if (typeof norm.promiseId === 'string') out.promiseId = norm.promiseId;
  if (typeof norm.entryId === 'string') out.entryId = norm.entryId;
  if (typeof node.fromActorId === 'string') out.fromActorId = node.fromActorId;
  if (typeof node.toActorId === 'string') out.toActorId = node.toActorId;
  if (typeof node.closeness === 'number' && Number.isInteger(node.closeness)) out.closeness = node.closeness;
  if (typeof norm.itemId === 'string') out.itemId = norm.itemId;
  if (typeof norm.actorId === 'string') out.actorId = norm.actorId;
  if (typeof node.nodeId === 'string') out.nodeId = node.nodeId;
  if (kind === 'situation_resolved' || kind === 'situation_status' || kind === 'counter_at_least' || kind === 'promise_fulfilled') {
    if (!out.situationId) { errors.push(`${prefix}.${kind}: situationId required.`); return null; }
  }
  if (kind === 'quest_succeeded' && !out.questId) { errors.push(`${prefix}.quest_succeeded: questId required.`); return null; }
  if (kind === 'committed_event' && !out.eventType) { errors.push(`${prefix}.committed_event: eventType required.`); return null; }
  if (kind === 'counter_at_least' && out.counterId === undefined) { errors.push(`${prefix}.counter_at_least: counterId required.`); return null; }
  if (kind === 'counter_at_least' && out.minimum === undefined) { errors.push(`${prefix}.counter_at_least: integer minimum required.`); return null; }
  if (kind === 'promise_fulfilled' && !out.promiseId) { errors.push(`${prefix}.promise_fulfilled: promiseId required.`); return null; }
  if (kind === 'knowledge_known' && !out.entryId) { errors.push(`${prefix}.knowledge_known: entryId required.`); return null; }
  if (kind === 'relationship_at_least' && (out.fromActorId === undefined || out.toActorId === undefined || out.closeness === undefined)) { errors.push(`${prefix}.relationship_at_least: from/to/closeness required.`); return null; }
  if (kind === 'item_owned' && (out.itemId === undefined || out.actorId === undefined)) { errors.push(`${prefix}.item_owned: itemId+actorId required.`); return null; }
  if ((kind === 'actor_alive' || kind === 'actor_dead') && !out.actorId) { errors.push(`${prefix}.${kind}: actorId required.`); return null; }
  if (kind === 'node_succeeded' && !out.nodeId) { errors.push(`${prefix}.node_succeeded: nodeId required.`); return null; }
  return out;
}

function parseOutcome(value: unknown, errors: string[], prefix: string): OutcomeTemplateSpec | null {
  if (!isRecord(value)) { errors.push(`${prefix}: outcome must be an object.`); return null; }
  const record = value as Record<string, unknown>;
  if (!isBoundedString(record.resultFact, 4, 160)) { errors.push(`${prefix}.resultFact: 4..160 chars required.`); return null; }
  const effects = parseEffects(record.effects, errors, `${prefix}.effects`);
  return { resultFact: String(record.resultFact).trim(), effects };
}

function parseMethod(value: unknown, errors: string[], prefix: string): MethodSpec | null {
  if (!isRecord(value)) { errors.push(`${prefix}: method must be an object.`); return null; }
  const m = value as Record<string, unknown>;
  if (!isId(m.methodId)) { errors.push(`${prefix}.methodId: stable id required.`); return null; }
  // Alias: models alternate title/name; the goal text may live at method
  // level (goal/description) or inside firstStep.description.
  const clampedTitle = clampDisplayString(m.title ?? m.name, 2, 24);
  if (clampedTitle === null) { errors.push(`${prefix}.title: 2..24 chars.`); return null; }
  const firstStepRecord = isRecord(m.firstStep) ? m.firstStep : undefined;
  const goalSource = typeof m.goal === 'string' && m.goal.trim().length >= 4 ? m.goal
    : (typeof m.description === 'string' && m.description.trim().length >= 4 ? m.description
      : (typeof firstStepRecord?.description === 'string' ? firstStepRecord.description
        : (typeof m.firstStep === 'string' && m.firstStep.trim().length >= 4 ? m.firstStep : undefined)));
  const clampedGoal = clampDisplayString(goalSource ?? '推进：' + clampedTitle, 4, 120);
  if (clampedGoal === null) { errors.push(`${prefix}.goal: 4..120 chars.`); return null; }
  const clampedTradeoffs = clampDisplayString(m.tradeoffs, 2, 120)
    ?? clampDisplayString(m.risks, 2, 120)
    ?? '风险由检定结果决定';
  const clampedPreparation = clampDisplayString(m.preparation === '' ? '无' : m.preparation, 1, 120) ?? '无';
  let step = firstStepRecord;
  // Adapter: firstStep may be a plain STRING (the intent text) — wrap it with
  // the method-level skill, if any.
  const methodSkill = typeof m.skill === 'string' ? m.skill
    : typeof (m.firstStep as Record<string, unknown> | undefined)?.skill === 'string'
      ? String((m.firstStep as Record<string, unknown>).skill)
      : undefined;
  if (typeof m.firstStep === 'string') {
    step = { intent: m.firstStep, actionKind: methodSkill ? 'skill_check' : 'interact', ...(methodSkill ? { skillId: methodSkill } : {}) };
  }
  // Adapter: firstStep may be an object WITHOUT intent (e.g. {skills:[...]}).
  // Synthesize the player-readable intent from title + goal; a
  // firstStep.description (no intent key) is the intent text itself.
  if (step && typeof step === 'object' && typeof step.intent !== 'string') {
    const skills = Array.isArray(step.skills) && typeof step.skills[0] === 'string' ? step.skills[0] : methodSkill;
    const intentText = typeof step.description === 'string' && step.description.trim().length >= 6
      ? step.description : `${clampedTitle}：${clampedGoal}`;
    step = { ...step, intent: intentText, actionKind: skills ? 'skill_check' : 'interact', ...(skills ? { skillId: skills } : {}) };
  }
  // Adapter: firstStep may be a bare {skill} shape without intent/actionKind;
  // synthesize a player-readable first-step intent from the title + goal.
  if (step && typeof step.intent !== 'string' && typeof step.skill === 'string') {
    step = { ...step, intent: `${clampedTitle}：${clampedGoal}`, actionKind: 'skill_check', skillId: step.skill };
  }
  if (step && typeof step.skill === 'string' && typeof step.skillId !== 'string' && typeof step.actionKind !== 'string') {
    step = { ...step, actionKind: 'skill_check', skillId: step.skill };
  }
  if (!step || !isBoundedString(step.intent, 6, 160)) { errors.push(`${prefix}.firstStep.intent: 6..160 chars.`); return null; }
  if (!isOneOf(step.actionKind, ['skill_check', 'ability', 'observe', 'talk', 'interact', 'move'])) {
    errors.push(`${prefix}.firstStep.actionKind: unknown kind.`); return null;
  }
  for (const field of ['skillId', 'itemId', 'abilityId', 'targetEntryId', 'destinationId']) {
    if (step[field] !== undefined && step[field] !== null && !isReference(step[field])) {
      errors.push(`${prefix}.firstStep.${field}: stable string id required.`); return null;
    }
  }
  const requires = parseRequirements(m.requires, errors, `${prefix}.requires`);
  if (!requires) return null;
  // Model-drift adapter: outcomes may arrive as an ARRAY of
  // {tier, resultFact, effects} — normalize to the per-grade record.
  let outcomes = m.outcomes as Record<string, unknown> | undefined;
  if (Array.isArray(m.outcomes)) {
    const normalized: Record<string, unknown> = {};
    for (const entry of m.outcomes as Array<Record<string, unknown>>) {
      if (entry && typeof entry.tier === 'string') {
        const tier = String(entry.tier ?? entry.level ?? entry.grade).replace(/-/g, '_');
        normalized[tier] = { resultFact: entry.resultFact, effects: entry.effects };
      }
    }
    outcomes = normalized;
  }
  if (!outcomes) { errors.push(`${prefix}.outcomes: four grades required.`); return null; }
  // String outcome values are narrative results — accept as resultFact.
  for (const grade of ['full_success', 'success', 'failure', 'severe_failure'] as const) {
    if (typeof outcomes[grade] === 'string' && String(outcomes[grade]).trim().length >= 4) {
      outcomes[grade] = { resultFact: outcomes[grade] };
    }
  }
  const parsedOutcomes: Partial<Record<'full_success' | 'success' | 'failure' | 'severe_failure', OutcomeTemplateSpec>> = {};
  for (const grade of ['full_success', 'success', 'failure', 'severe_failure'] as const) {
    const outcome = parseOutcome(outcomes[grade], errors, `${prefix}.outcomes.${grade}`);
    if (!outcome) return null;
    parsedOutcomes[grade] = outcome;
  }
  return {
    methodId: String(m.methodId),
    title: clampedTitle,
    goal: clampedGoal,
    firstStep: {
      intent: String(step.intent).trim(),
      actionKind: step.actionKind as MethodSpec['firstStep']['actionKind'],
      ...(typeof step.skillId === 'string' ? { skillId: step.skillId } : {}),
      ...(typeof step.itemId === 'string' ? { itemId: step.itemId } : {}),
      ...(typeof step.abilityId === 'string' ? { abilityId: step.abilityId } : {}),
      ...(typeof step.targetEntryId === 'string' ? { targetEntryId: step.targetEntryId } : {}),
      ...(typeof step.destinationId === 'string' ? { destinationId: step.destinationId } : {}),
    },
    requires,
    tradeoffs: clampedTradeoffs,
    preparation: clampedPreparation,
    outcomes: parsedOutcomes as MethodSpec['outcomes'],
  };
}

/** Strict parse of the raw model text into a candidate model. */
const DBG = (phase: string) => { if ((globalThis as { __P9_PARSE_DEBUG__?: boolean }).__P9_PARSE_DEBUG__) console.error('[parse]', phase); };
export function parseCampaignPlanCandidate(raw: unknown, errors: string[]): CampaignPlanCandidateModelV1 | null {
  if (!isRecord(raw)) { errors.push('candidate: must be a JSON object.'); return null; }
  const c = raw as Record<string, unknown>;
  if (c.modelVersion !== undefined && (typeof c.modelVersion !== 'string' || !/^campaign-(plan-model-1|revision)/.test(c.modelVersion))) {
    // Tolerate omitted modelVersion (gateway strips it) and the model's
    // revision-style spellings; the SHAPE checks below stay strict.
    errors.push(`candidate: unknown modelVersion ${String(c.modelVersion)}.`);
    return null;
  }
  const proposal = c.proposal as Record<string, unknown> | undefined;
  DBG('proposal-check');
  if (!proposal || !isBoundedString(proposal.longTermGoal, 4, 120)
    || !isBoundedString(proposal.publicPitch, 10, 400)
    || !isBoundedString(proposal.gmPremise, 4, 400)
    || !isBoundedString(proposal.tone, 2, 40)) {
    errors.push('proposal: longTermGoal/publicPitch/gmPremise/tone required.');
    return null;
  }
  DBG('stages-check');
  if (!Array.isArray(c.stages) || c.stages.length < 2 || c.stages.length > 8) {
    errors.push('stages: 2..8 required.'); return null;
  }
  const stages: StageSpec[] = [];
  const nodeIds = new Set<string>();
  for (const [index, rawStage] of c.stages.entries()) {
    const prefix = `stages[${index}]`;
    if (!isRecord(rawStage)) { errors.push(`${prefix}: stage object required.`); return null; }
    const s = rawStage;
    if (!isId(s.nodeId)) { errors.push(`${prefix}.nodeId: stable id required.`); return null; }
    if (nodeIds.has(String(s.nodeId))) { errors.push(`${prefix}.nodeId: duplicate.`); return null; }
    nodeIds.add(String(s.nodeId));
    // Display-field fallbacks (replan models sometimes drop them): title
    // ← nodeId; publicObjective ← title; gmPurpose ← generic purpose. The
    // structural fields (completion/refs) below stay strict.
    const stageTitle = clampDisplayString(s.title, 2, 40) ?? String(s.nodeId);
    const stageObjective = clampDisplayString(s.publicObjective, 4, 160)
      ?? clampDisplayString(s.objective, 4, 160) ?? `${stageTitle}：推进这一阶段的目标`;
    const stagePurpose = clampDisplayString(s.gmPurpose, 4, 400)
    ?? clampDisplayString(s.purpose, 4, 400) ?? '模型规划的阶段性目的（未提供 GM 说明）。';
    const stageRole = ['main', 'optional'].includes(String(s.role)) ? String(s.role) : 'main'; // default main
    const firstStageIndex = 0;
    const stageCoverage = ['concrete', 'provisional'].includes(String(s.coverage)) ? String(s.coverage)
      : (stages.length === firstStageIndex ? 'concrete' : 'provisional'); // opener concrete, later provisional
    const completion = parseCondition(s.completion, errors, `${prefix}.completion`);
    // Optional stage conditions: a model-provided non-object value (e.g. a
    // failure DESCRIPTION string) carries no condition semantics — degrade to
    // "not provided" with a diagnostic instead of invalidating the plan. The
    // REQUIRED completion condition above stays strict.
    const parseOptionalCondition = (value: unknown, field: string): ConditionTemplateNode | null => {
      if (value === null || value === undefined || value === '' || value === false) return null;
      if (typeof value !== 'object') { errors.push(`${prefix}.${field}: condition must be an object or null.`); return null; }
      return parseCondition(value, errors, `${prefix}.${field}`);
    };
    const activation = parseOptionalCondition(s.activation, 'activation');
    const failure = parseOptionalCondition(s.failure, 'failure');
    const cancellation = parseOptionalCondition(s.cancellation, 'cancellation');
    // Required-field fallback: an unparseable completion must not drop the
    // stage (a hole in the node chain fails validation worse). The first
    // stage completes with its situation; later stages complete with their
    // predecessor — an explicit, honest compiler default.
    if (!completion) { errors.push(`${prefix}.completion: valid completion required.`); return null; }
    const effectiveCompletion = completion;
    stages.push({
      nodeId: String(s.nodeId), role: stageRole as 'main' | 'optional',
      title: stageTitle, publicObjective: stageObjective, gmPurpose: stagePurpose,
      coverage: stageCoverage as 'concrete' | 'provisional',
      activation, completion: effectiveCompletion, failure, cancellation,
      // Keep only id-shaped refs: models sometimes append prose annotations
      // to next/dependsOn lists; those are notes, not node references.
      dependsOn: (Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : []).filter(id => ID_PATTERN.test(id)),
      alternatives: (Array.isArray(s.alternatives) ? s.alternatives.map(String) : []).filter(id => ID_PATTERN.test(id)),
      next: (Array.isArray(s.next) ? s.next.map(String) : []).filter(id => ID_PATTERN.test(id)),
      situationRef: typeof s.situationRef === 'string' ? s.situationRef : undefined,
      rewardPolicyRefs: Array.isArray(s.rewardPolicyRefs) ? s.rewardPolicyRefs.map(String) : [],
      consequenceRefs: Array.isArray(s.consequenceRefs) ? s.consequenceRefs.map(String) : [],
      provenance: {
        kind: s.provenance && (s.provenance as Record<string, unknown>).kind === 'canon_inspired' ? 'canon_inspired' : 'design_fill',
        sourceFactIds: Array.isArray((s.provenance as Record<string, unknown>)?.sourceFactIds)
          ? ((s.provenance as Record<string, unknown>).sourceFactIds as unknown[]).map(String) : [],
        rationale: String((s.provenance as Record<string, unknown>)?.rationale ?? 'model planned'),
      },
    });
  }
  if (!Array.isArray(c.endings) || c.endings.length === 0 || c.endings.length > 4) {
    errors.push('endings: 1..4 required.'); return null;
  }
  DBG('endings-start');
  const endings: EndingSpec[] = [];
  for (const [index, rawEnding] of c.endings.entries()) {
    const e = rawEnding as Record<string, unknown>;
    const prefix = `endings[${index}]`;
    if (!isRecord(e)) { errors.push(`${prefix}: ending object required.`); return null; }
    if (!isId(e.endingId) || !isBoundedString(e.title, 2, 40)
      || !isBoundedString(e.publicDescription, 4, 200)
      || !isOneOf(e.outcomeKind, ['success', 'pyrrhic', 'failure', 'open'])) {
      errors.push(`${prefix}: malformed ending.`); return null;
    }
    const condition = parseCondition(e.condition, errors, `${prefix}.condition`);
    if (!condition) { errors.push(`${prefix}: invalid ending condition.`); return null; }
    endings.push({
      endingId: String(e.endingId), title: String(e.title).trim(),
      publicDescription: String(e.publicDescription).trim(),
      outcomeKind: e.outcomeKind as EndingSpec['outcomeKind'], condition,
    });
  }
  DBG('situation-check');
  const situationRaw = c.firstSituation as Record<string, unknown> | undefined;
  const situation: Record<string, unknown> | undefined = situationRaw === undefined || situationRaw === null ? undefined : ({
    ...situationRaw,
    situationTitle: situationRaw.situationTitle ?? situationRaw.title ?? situationRaw.name,
    summary: situationRaw.summary ?? situationRaw.description,
    gmBrief: situationRaw.gmBrief ?? situationRaw.brief ?? '模型规划的局面（未提供 GM 说明）。',
    pressureDescription: situationRaw.pressureDescription ?? situationRaw.pressure ?? '局势会随时间变化。',
  } as Record<string, unknown>);
  // Replans may omit firstSituation entirely (the current board keeps
  // playing); openings REQUIRE it.
  if (situation !== undefined && (!isBoundedString(situation.situationTitle, 2, 40)
    || !isBoundedString(situation.summary, 8, 300))) {
    errors.push('firstSituation: situationTitle/summary required.'); return null;
  }
  if (situation === undefined && !Array.isArray(c.stages)) {
    errors.push('candidate: stages required.'); return null;
  }
  if (situation !== undefined && Array.isArray(situation.methods)
    && (situation.methods.length < 2 || situation.methods.length > 5)) {
    errors.push('firstSituation.methods: 2..5 required.'); return null;
  }
  const situationMethods: unknown[] = situation !== undefined && Array.isArray(situation.methods) ? situation.methods : [];
  DBG('methods-start');
  const methods: MethodSpec[] = [];
  for (const [index, rawMethod] of situationMethods.entries()) {
    const method = parseMethod(rawMethod, errors, `firstSituation.methods[${index}]`);
    if (!method) return null;
    methods.push(method);
  }
  DBG('consequences-start');
  // Some providers nest these complete arrays in firstSituation. Lift them
  // without synthesizing definitions; ambiguous dual placement is rejected.
  const locatedArray = (field: 'consequences' | 'rewards'): unknown => {
    const root = c[field]; const nested = situation?.[field];
    if (root !== undefined && nested !== undefined) {
      errors.push(`${field}: define at one location only.`);
      return undefined;
    }
    const value = root ?? nested;
    if (value !== undefined && !Array.isArray(value)) errors.push(`${field}: must be an array.`);
    return value;
  };
  const consequenceArray = locatedArray('consequences');
  const rewardArray = locatedArray('rewards');
  const consequences: ConsequenceSpec[] = [];
  if (Array.isArray(consequenceArray)) {
    for (const [index, rawConsequence] of consequenceArray.entries()) {
      const prefix = `consequences[${index}]`;
      if (!isRecord(rawConsequence)) { errors.push(`${prefix}: consequence object required.`); return null; }
      const cs = rawConsequence;
      if (!isId(cs.consequenceId) || !isBoundedString(cs.description, 4, 160)) {
        errors.push(`${prefix}: consequenceId/description required.`); return null;
      }
      const trigger = parseCondition(cs.trigger, errors, `${prefix}.trigger`);
      if (!trigger) { errors.push(`${prefix}: invalid trigger.`); return null; }
      const effects = parseEffects(cs.effects, errors, `${prefix}.effects`);
      consequences.push({
        consequenceId: String(cs.consequenceId), description: String(cs.description).trim(),
        trigger, effects,
        visibility: cs.visibility === 'gm' ? 'gm' : 'public',
      });
    }
  }
  const rewards: RewardSpec[] = [];
  if (Array.isArray(rewardArray)) {
    for (const [index, rawReward] of rewardArray.entries()) {
      const prefix = `rewards[${index}]`;
      if (!isRecord(rawReward)) { errors.push(`${prefix}: reward policy object required.`); return null; }
      const r = rawReward;
      if (!isId(r.policyId) || !isId(r.nodeId) || !isBoundedString(r.description, 4, 120)
        || !Array.isArray(r.rewards) || r.rewards.length === 0 || r.rewards.length > 4) {
        errors.push(`${prefix}: policyId/nodeId/description/rewards required.`); return null;
      }
      const parsedRewards = parseRewards(r.rewards, errors, prefix);
      if (!parsedRewards) return null;
      rewards.push({
        policyId: String(r.policyId), nodeId: String(r.nodeId ?? ''),
        description: String(r.description).trim(),
        rewards: parsedRewards,
      });
    }
  }
  if (errors.length > 0) return null;
  return {
    modelVersion: CAMPAIGN_PLAN_MODEL_VERSION,
    proposal: {
      title: isBoundedString(proposal.title, 2, 40) ? String(proposal.title).trim() : String(proposal.longTermGoal).slice(0, 40),
      longTermGoal: String(proposal.longTermGoal).trim(),
      publicPitch: String(proposal.publicPitch).trim(),
      gmPremise: String(proposal.gmPremise).trim(),
      tone: String(proposal.tone).trim(),
    },
    stages, endings,
    firstSituation: {
      situationTitle: String(situation?.situationTitle ?? stages[0]?.title ?? '当前局面').trim(),
      summary: String(situation?.summary ?? stages[0]?.publicObjective ?? '战役继续推进。').trim(),
      gmBrief: String(situation?.gmBrief ?? '模型规划的局面。').trim(),
      pressureDescription: String(situation?.pressureDescription ?? '局势会随时间变化。').trim(),
      ...(typeof situation?.deadlineClockSeconds === 'number' && situation.deadlineClockSeconds > 0 && situation.deadlineClockSeconds <= 86400 * 7
        ? { deadlineClockSeconds: Math.round(situation.deadlineClockSeconds as number) } : {}),
      methods,
      signs: Array.isArray(situation?.signs)
        ? ((situation as Record<string, unknown>).signs as unknown[]).filter(isRecord).filter(s => isBoundedString(s.text, 2, 120)).map(s => ({ text: String(s.text).trim() }))
        : [],
    },
    consequences, rewards,
  };
}

/** Extracts the first JSON object from a raw model response (no silent fallback to free text). */
export function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1]!.trim() : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

export type { SituationTransitionOp };

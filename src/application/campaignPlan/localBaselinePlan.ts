/**
 * Local baseline campaign plan (convergence plan W3, commit 2).
 *
 * Builds a minimal, honest `CampaignPlanCandidateModelV1` from the SAME
 * planning context the LLM path freezes (buildPlanningContext), then runs it
 * through the SAME compileAndValidateCandidate. The baseline is a floor, not
 * a fake mainline: every provenance is `design_fill`, the proposal text says
 * what it is, and the first situation only references entries that exist in
 * the published package at the chosen anchor.
 *
 * Structure: one concrete start stage (survey / talk / engage methods with
 * full four-grade outcome templates and explicit L1 compile policies), plus
 * provisional successor stages that the existing stage preparation/replan
 * services materialize later in the background. For a 'long' preference the
 * template additionally carries the two co-scheduled delayed consequences
 * the causality validator demands, triggered by the last required main stage.
 */
import { CAMPAIGN_PLAN_MODEL_VERSION, type CampaignPlanCandidateModelV1, type MethodSpec, type OutcomeTemplateSpec } from './candidateModel';
import type { CampaignIntentV1 } from '../../domain/campaignPlan/types';
import type { LocalCompileContext } from './localCompile';
import type { CampaignPlanV1, CampaignContentArtifactV1 } from '../../domain/campaignPlan/types';
import { canonicalJsonOf, sha256HexOf } from './hashing';

export interface LocalBaselineModelInput {
  ctx: LocalCompileContext;
  intent: CampaignIntentV1;
  anchorTitle: string;
  worldTitle: string;
}

const DEFAULT_GOAL = '在开局锚点处开始一段冒险';

function fourGrades(resultFacts: {
  fullSuccess: string; success: string; failure: string; severeFailure: string;
}, effects: {
  fullSuccess: OutcomeTemplateSpec['effects']; success: OutcomeTemplateSpec['effects'];
  failure: OutcomeTemplateSpec['effects']; severeFailure: OutcomeTemplateSpec['effects'];
}): MethodSpec['outcomes'] {
  return {
    full_success: { resultFact: resultFacts.fullSuccess, effects: effects.fullSuccess },
    success: { resultFact: resultFacts.success, effects: effects.success },
    failure: { resultFact: resultFacts.failure, effects: effects.failure },
    severe_failure: { resultFact: resultFacts.severeFailure, effects: effects.severeFailure },
  };
}

/** Fixed L1 policies for newly compiled baseline methods: honest and closed. */
function fixedPolicies(): Pick<MethodSpec, 'difficultyPolicy' | 'evidencePolicy' | 'evidenceAllowlist'> {
  return { difficultyPolicy: { kind: 'fixed', band: 'normal' }, evidencePolicy: { kind: 'fixed', evidenceIds: [] }, evidenceAllowlist: [] };
}

export function buildLocalBaselineModel(input: LocalBaselineModelInput): CampaignPlanCandidateModelV1 {
  const { ctx, intent } = input;
  const long = intent.lengthPreference === 'long';
  const goal = intent.goalMode === 'declared' && intent.normalizedIntent.trim()
    ? intent.normalizedIntent.trim() : DEFAULT_GOAL;
  const scene = ctx.visibleEntries.find(entry => entry.kind === 'scene'
    && (entry.definition as { locationId?: string }).locationId === ctx.openingLocationId)
    ?? ctx.visibleEntries.find(entry => entry.kind === 'scene');
  const sceneDefinition = (scene?.definition ?? {}) as { name?: string; actors?: string[] };
  const sceneName = sceneDefinition.name ?? '眼前';
  const skillIds = new Set(ctx.visibleEntries.filter(entry => entry.kind === 'skill').map(entry => entry.entryId));
  const talkTarget = (sceneDefinition.actors ?? []).find(id => ctx.presentActorRefs?.includes(id)
    || ctx.presentActorRefs?.includes(`npc-${id}`));

  const methods: MethodSpec[] = [];
  if (skillIds.has('skill-observation')) {
    methods.push({
      methodId: 'baseline-survey',
      title: '查看现场',
      goal: '弄清眼前的局面和可用的线索',
      firstStep: { intent: `仔细查看${sceneName}现场，寻找值得注意的细节与线索`, actionKind: 'skill_check', skillId: 'skill-observation' },
      requires: { skillId: 'skill-observation', minRank: 'untrained' },
      tradeoffs: '花费时间；结论取决于检定',
      preparation: '无',
      ...fixedPolicies(),
      outcomes: fourGrades(
        { fullSuccess: `你把${sceneName}的现场看得一清二楚，掌握了可靠的线索。`,
          success: `你确认了${sceneName}异常的大致来源。`,
          failure: '你没有看出额外的线索。',
          severeFailure: '你的翻动惊动了旁人，引起了注意。' },
        {
          fullSuccess: [{ template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 2 },
            ...(long ? [{ template: 'record_event', eventType: 'baseline_stage_mark', summary: '开局调查留下了完整记录' } as const] : [])],
          success: [{ template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 1 },
            ...(long ? [{ template: 'record_event', eventType: 'baseline_stage_mark', summary: '开局调查留下了记录' } as const] : [])],
          failure: [],
          severeFailure: [{ template: 'record_event', eventType: 'baseline_alert_raised', summary: '查看现场的动静引起了注意' }],
        }),
    });
  }
  if (talkTarget && skillIds.has('skill-diplomacy')) {
    methods.push({
      methodId: 'baseline-ask',
      title: '向在场者打听',
      goal: '从在场的人那里了解发生了什么',
      firstStep: { intent: `向在场的人打听${sceneName}的情形`, actionKind: 'talk', skillId: 'skill-diplomacy', targetEntryId: talkTarget },
      requires: {},
      tradeoffs: '对方不一定愿意多说；态度会影响关系',
      preparation: '无',
      ...fixedPolicies(),
      outcomes: fourGrades(
        { fullSuccess: '在场的人把知道的全告诉了你，局势清楚了。',
          success: '在场的人透露了关键信息，局势大致清楚。',
          failure: '对方摇了摇头，不愿多说。',
          severeFailure: '你的追问让对方起了疑心。' },
        {
          fullSuccess: [{ template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 2 },
            { template: 'situation_status', situationId: 'self', status: 'resolved', resolution: '在场者指认了局势的来源' }],
          success: [{ template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 1 },
            { template: 'situation_status', situationId: 'self', status: 'resolved', resolution: '在场者指认了局势的来源' }],
          failure: [],
          severeFailure: [],
        }),
    });
  }
  methods.push({
    methodId: 'baseline-engage',
    title: '着手处理眼前的事',
    goal: `推进：${goal}`.slice(0, 60),
    firstStep: { intent: `着手处理：${sceneName}眼前最紧要的事`, actionKind: 'interact' },
    requires: {},
    tradeoffs: '没有先摸清情况，风险自负',
    preparation: '无',
    ...fixedPolicies(),
    outcomes: fourGrades(
      { fullSuccess: `你果断介入，${sceneName}的眼前局势被你推动了一大步。`,
        success: `你的介入让${sceneName}的眼前局势告一段落。`,
        failure: '你的处理没有奏效，局势依旧。',
        severeFailure: '仓促介入让局面变得更糟。' },
      {
        fullSuccess: [{ template: 'situation_status', situationId: 'self', status: 'resolved', resolution: '主动介入使眼前局势告一段落' },
          ...(long ? [{ template: 'schedule_consequence', consequenceId: 'baseline-delayed-a' } as const,
            { template: 'schedule_consequence', consequenceId: 'baseline-delayed-b' } as const] : [])],
        success: [{ template: 'situation_status', situationId: 'self', status: 'resolved', resolution: '主动介入使眼前局势告一段落' },
          ...(long ? [{ template: 'schedule_consequence', consequenceId: 'baseline-delayed-a' } as const,
            { template: 'schedule_consequence', consequenceId: 'baseline-delayed-b' } as const] : [])],
        failure: [],
        severeFailure: [{ template: 'record_event', eventType: 'baseline_alert_raised', summary: '仓促介入引起了注意' }],
      }),
  });
  if (methods.length < 2) {
    throw new Error('local_baseline_insufficient_methods:这个世界包在当前锚点下没有足够的可编译开局动作，请使用 AI 定制主线。');
  }

  const anchorTitle = input.anchorTitle.trim() || '开局时刻';
  const model: CampaignPlanCandidateModelV1 = {
    modelVersion: CAMPAIGN_PLAN_MODEL_VERSION,
    proposal: {
      title: `${input.worldTitle}·${anchorTitle}`.slice(0, 60),
      longTermGoal: goal,
      publicPitch: `快速开始（本地基线）：${goal}。先以可执行的开局局面起步，后续主线与个性化由 AI 在后台补全。`,
      gmPremise: '本地基线：无隐藏前提，不声称理解原著深线；后续主线由后台规划补全。',
      tone: intent.tone?.trim() || '沿原著',
    },
    stages: [
      {
        nodeId: 'baseline-stage-1', role: 'main', title: '站稳开局',
        publicObjective: `在${sceneName}弄清局面并站稳脚跟`,
        gmPurpose: '让玩家以本地可执行动作完成开局。',
        coverage: 'concrete', activation: null,
        completion: { kind: 'all', of: [
          { kind: 'situation_resolved', situationId: 'self' },
          { kind: 'counter_at_least', situationId: 'self', counterId: 'evidence', minimum: 1 },
        ] },
        failure: null, cancellation: null, dependsOn: [], alternatives: [], next: ['baseline-stage-2'],
        rewardPolicyRefs: [], consequenceRefs: long ? ['baseline-delayed-a', 'baseline-delayed-b'] : [],
        provenance: { kind: 'design_fill', sourceFactIds: [], rationale: '本地基线开局阶段。' },
      },
      {
        nodeId: 'baseline-stage-2', role: 'main', title: '推进主线',
        publicObjective: goal.slice(0, 160),
        gmPurpose: '后继主线由后台阶段预备补全。',
        coverage: 'provisional',
        activation: { kind: 'node_succeeded', nodeId: 'baseline-stage-1' },
        completion: { kind: 'committed_event', eventType: 'baseline_stage2_done' },
        failure: null, cancellation: null, dependsOn: ['baseline-stage-1'], alternatives: [], next: ['baseline-stage-3'],
        rewardPolicyRefs: [], consequenceRefs: [],
        provenance: { kind: 'design_fill', sourceFactIds: [], rationale: '本地基线后继阶段，待后台预备。' },
      },
      {
        nodeId: 'baseline-stage-3', role: 'main', title: '抵达阶段目标',
        publicObjective: `达成：${goal}`.slice(0, 160),
        gmPurpose: '终局前的最后主阶段，由后台预备具体化。',
        coverage: 'provisional',
        activation: { kind: 'node_succeeded', nodeId: 'baseline-stage-2' },
        completion: { kind: 'committed_event', eventType: 'baseline_stage3_done' },
        failure: null, cancellation: null, dependsOn: ['baseline-stage-2'], alternatives: [], next: [],
        rewardPolicyRefs: [], consequenceRefs: [],
        provenance: { kind: 'design_fill', sourceFactIds: [], rationale: '本地基线终阶段，待后台预备。' },
      },
    ],
    endings: [
      long
        ? { endingId: 'baseline-ending', title: '阶段目标达成', publicDescription: '主线阶段目标完成，本地基线旅程告一段落。', outcomeKind: 'success',
            condition: { kind: 'all', of: [
              { kind: 'node_succeeded', nodeId: 'baseline-stage-3' },
              { kind: 'committed_event', eventType: 'baseline_delayed_signal_a' },
              { kind: 'committed_event', eventType: 'baseline_delayed_signal_b' },
            ] } }
        : { endingId: 'baseline-ending', title: '阶段目标达成', publicDescription: '主线阶段目标完成，本地基线旅程告一段落。', outcomeKind: 'success',
            condition: { kind: 'node_succeeded', nodeId: 'baseline-stage-3' } },
    ],
    firstSituation: {
      situationTitle: `${sceneName}的局势`,
      summary: `${anchorTitle}：${sceneName}正有事情发生，值得弄清并介入。`,
      gmBrief: '本地基线开局局面（设计补全）：无隐藏秘密；后续主线由后台规划补全。',
      pressureDescription: '局势会随着时间与你的行动变化。',
      signs: [],
      methods,
    },
    consequences: long ? [
      { consequenceId: 'baseline-delayed-a', description: '开局调查的线索在后续阶段浮现出新的含义',
        visibility: 'public' as const,
        trigger: { kind: 'node_succeeded', nodeId: 'baseline-stage-3' },
        effects: [{ template: 'record_event', eventType: 'baseline_delayed_signal_a', summary: '早期线索在后续显现' }] },
      { consequenceId: 'baseline-delayed-b', description: '开局留下的记录在终阶段引起回应',
        visibility: 'public' as const,
        trigger: { kind: 'all', of: [
          { kind: 'node_succeeded', nodeId: 'baseline-stage-3' },
          { kind: 'committed_event', eventType: 'baseline_stage_mark' },
        ] },
        effects: [{ template: 'record_event', eventType: 'baseline_delayed_signal_b', summary: '开局记录带来回应' }] },
    ] : [],
    rewards: [],
  };
  return model;
}

/**
 * Candidate row identity for the local path: byte-stable raw response so the
 * integrity gate (isIntactReadyCandidate) can audit it like any LLM product.
 */
export function localBaselineCandidateIdentity(model: CampaignPlanCandidateModelV1, plan: CampaignPlanV1, artifact: CampaignContentArtifactV1): {
  rawResponseText: string; candidateHash: string;
} {
  const rawResponseText = canonicalJsonOf(model as unknown as Record<string, unknown>);
  return { rawResponseText, candidateHash: sha256HexOf(canonicalJsonOf({ plan, artifact })) };
}

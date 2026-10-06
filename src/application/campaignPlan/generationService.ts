import type { ApiProfile, LlmProvider, LlmRequest } from '../llm/types';
import { normalizeReasoningTier } from '../llm/types';
import { DEFAULT_OUTPUT_DEMANDS } from '../llm/requestDemands';
import { resolveModelCapabilities } from '../llm/capabilityResolver';
import { planLlmRequest } from '../llm/requestBudgetKernel';
import { stableFingerprint } from '../llm/requestPlan';
import { llmModelProfileFingerprint } from '../llm/profileFingerprint';
import { reasoningDialectForModel } from '../llm/reasoningPolicy';
import { estimateTokens } from '../context/tokenEstimate';
import { endpointBucketId } from '../worldBuild/rateScheduler';
import type { ContentEntry } from '../../domain/content/types';
import type { CampaignIntentV1 } from '../../domain/campaignPlan/types';
import type { LocalCompileContext } from './localCompile';
import { CAMPAIGN_PLAN_MODEL_VERSION, extractJsonObject, parseCampaignPlanCandidate, type CampaignPlanCandidateModelV1 } from './candidateModel';

/**
 * Campaign plan generation (plan §6.2): freeze → generate → strict parse →
 * validate → local compile → candidate ready. One generation plus at most ONE
 * structural repair share the two-physical-HTTP budget; both dispatches are
 * ledgered under the same logical request. A06/T07: form-like invalid JSON
 * never becomes a proposal; repair keeps the SAME frozen materials and only
 * appends the error list.
 */

export interface PlanRequestMaterials {
  system: string;
  user: string;
}

export function buildPlanRequestMaterials(input: {
  intent: CampaignIntentV1;
  ctx: LocalCompileContext;
  visibleEntries: readonly ContentEntry[];
  worldTitle: string;
  anchorTitle: string;
  playerName: string;
  openingGoalSuggestions: readonly string[];
}): PlanRequestMaterials {
  const { intent, ctx } = input;
  const skills = input.visibleEntries.filter(entry => entry.kind === 'skill').slice(0, 16)
    .map(entry => `${entry.entryId}(${(entry.definition as { name?: string }).name ?? entry.entryId.replace(/^skill-/, '')})`);
  const abilities = input.visibleEntries.filter(entry => entry.kind === 'ability').slice(0, 8)
    .map(entry => entry.entryId);
  const scenes = input.visibleEntries.filter(entry => entry.kind === 'scene').slice(0, 6)
    .map(entry => {
      const definition = entry.definition as { name?: string; locationId?: string; actors?: string[] };
      return `${definition.locationId ?? '?'}:${definition.name ?? ''}${definition.actors?.length ? `（在场:${definition.actors.slice(0, 4).join(',')}）` : ''}`;
    });
  const npcs = [...ctx.openingTemplateIds].slice(0, 10);
  const items = input.visibleEntries.filter(entry => entry.kind === 'item').slice(0, 10)
    .map(entry => entry.entryId);
  const clues = input.visibleEntries.filter(entry => entry.kind === 'lore').slice(0, 10)
    .map(entry => entry.entryId);
  const quests = input.visibleEntries.filter(entry => entry.kind === 'quest').slice(0, 6)
    .map(entry => entry.entryId);

  const goalBlock = intent.goalMode === 'declared'
    ? `玩家意图（必须响应，不得改写）：${intent.normalizedIntent}${intent.userConstraints.length > 0 ? `\n玩家约束：${intent.userConstraints.join('；')}` : ''}`
    : '玩家意图：尚未决定目标（探索型开局）。请生成一个以"弄清局势、发现机会"为核心的探索开局，目标状态为待选择，不虚构玩家已宣布的目标。';

  const system = [
    '你是一个文字 TRPG 的战役主线策划。根据玩家意图与开局世界资料，规划一场有长期方向的冒险战役。',
    '你的输出只是一份候选规划：它不证明任何事件已经发生，不能给角色知识、物品或能力；具体后果由本地规则结算。',
    '',
    '输出要求（只输出一个 JSON 对象，不要输出任何其他文字）：',
    '{',
    '  "modelVersion": "' + CAMPAIGN_PLAN_MODEL_VERSION + '",',
    '  "proposal": {"title","longTermGoal","publicPitch","gmPremise","tone"},',
    '  "stages": [{"nodeId","role":"main|optional","title","publicObjective","gmPurpose","coverage":"concrete|provisional","activation","completion","failure","cancellation","dependsOn":[],"alternatives":[],"next":[],"provenance":{"kind":"design_fill|canon_inspired","sourceFactIds":[],"rationale"}}],',
    '  "endings": [{"endingId","title","publicDescription","outcomeKind":"success|pyrrhic|failure|open","condition"}],',
    '  "firstSituation": {"situationTitle","summary","gmBrief","pressureDescription","deadlineClockSeconds","signs":[{"text"}],"methods":[...]}',
    '}',
    '',
    '结构规则：',
    '- stages 2-6 个，主路径必须从无 activation 的起点可达至少一个结局条件；远期阶段用 coverage="provisional"；',
    '- 第一个 concrete 阶段必须完整可玩：endings 之前先由 firstSituation 给出 2-4 个办法（methods），办法之间机制不同（不同技能/不同行动类型/不同对象），至少一个办法的 firstStep 只用下面列出的技能且不需要准备；',
    '- 每个 method 的 outcomes 必须给出 full_success/success/failure/severe_failure 四档，各档 resultFact 一句玩家可读事实，effects 从效果模板白名单选择；',
    '- 条件模板白名单：situation_resolved{situationId}, situation_status{situationId,status}, quest_succeeded{questId}, committed_event{eventType,payloadMatch?}, counter_at_least{situationId,counterId,minimum}, promise_fulfilled{situationId,promiseId}, knowledge_known{entryId}, relationship_at_least{fromActorId,toActorId,closeness}, item_owned{itemId,actorId}, actor_alive{actorId}, actor_dead{actorId}, node_succeeded{nodeId}；可用 {"kind":"all","of":[...]}/any/not 组合（≤3 层）。firstSituation 的局面可以用 situationId "self" 指代自身；',
    '- 效果模板白名单：situation_status{situationId,status,resolution?}, situation_counter{situationId,counterId,delta(±10)}, promise_create{situationId,promiseId,promisorActorId,promiseeActorId?,description}, promise_fulfill{situationId,promiseId}, promise_break{situationId,promiseId}, grant_knowledge{entryId}, grant_item{itemId,toActorId}, relationship_shift{fromActorId,toActorId,delta(±3)}, condition_apply{actorId,conditionId}, condition_remove{actorId,conditionId}, resource_change{actorId,resourceId,amount(±10)}, clock_advance{minutes(≤240)}, record_event{eventType,summary}, schedule_consequence{consequenceId}, suppress_reference_event{situationId,eventKey,reason}；',
    '- 可选 "consequences": [{consequenceId,description,trigger, effects:[{template:"schedule_consequence" 之外的效果}],visibility}] 表示延迟后果；可选 "rewards": [{policyId,nodeId,description,rewards:[{kind:"skill_rank|item|knowledge|relationship|resource_cap",targetId,toActorId?,rank?,delta?}]}]；',
    '- 公开字段（title/publicObjective/publicPitch/longTermGoal/signs/summary）不得泄漏 gmPremise、gmPurpose、隐藏身份或原著后期走向；',
    '- 只能引用下面给出的 ID（技能/人物/地点/物品/线索/任务）；不得发明新的 ID。',
  ].join('\n');

  const user = [
    `作品：${input.worldTitle}`,
    `开局时刻：${input.anchorTitle}`,
    `开局地点：${ctx.openingLocationId}`,
    `玩家角色：${input.playerName}（已会技能：${[...ctx.protagonistSkills].slice(0, 10).join(', ') || '无'}）`,
    goalBlock,
    `篇幅偏好：${intent.lengthPreference === 'short' ? '短篇（2-3 阶段）' : intent.lengthPreference === 'long' ? '长篇（4-6 阶段）' : '中篇（3-5 阶段）'}${intent.tone ? `；基调：${intent.tone}` : ''}`,
    input.openingGoalSuggestions.length > 0 ? `可参考的开局方向：${input.openingGoalSuggestions.join('；')}` : null,
    '',
    '可用技能：', skills.join('、') || '无',
    '可用能力：', abilities.join('、') || '无',
    '可进入场景：', scenes.join('；') || '无',
    '在场/可出现人物模板：', npcs.join('、') || '无',
    '已知物品：', items.join('、') || '无',
    '已知线索/资料：', clues.join('、') || '无',
    '可关联任务：', quests.join('、') || '无',
  ].filter(line => line !== null).join('\n');

  return { system, user };
}

export interface PlanGenerationResult {
  status: 'ready' | 'invalid' | 'retryable_failed' | 'outcome_unknown';
  model: CampaignPlanCandidateModelV1 | null;
  parseErrors: string[];
  rawText: string;
  physicalRequests: number;
}

/**
 * Runs the ledgered plan request (generate + bounded repair). The caller
 * persists the raw text and stage transitions; this function is pure aside
 * from the provider call.
 */
export async function generateCampaignPlanCandidate(input: {
  provider: LlmProvider;
  profile: ApiProfile;
  materials: PlanRequestMaterials;
  logicalRequestId: string;
  worldId: string;
}): Promise<PlanGenerationResult> {
  const demands = DEFAULT_OUTPUT_DEMANDS.campaign_plan;
  const maximum = Math.min(demands.maximum, input.profile.contentOutputTokens ?? 16_384);
  const plan = planLlmRequest({
    capabilities: resolveModelCapabilities({
      declared: {
        contextWindowTokens: input.profile.capabilities.contextWindow,
        maxOutputTokens: input.profile.capabilities.maxOutputTokens,
        supportsJsonMode: input.profile.capabilities.supportsJson,
        reportsUsage: input.profile.capabilities.reportsUsage,
        reasoningUsageReported: input.profile.capabilities.reportsUsage,
      },
      reasoningMode: 'always_on',
    }),
    requestKind: 'campaign_plan',
    estimatedMandatoryInputTokens: estimateTokens(`${input.materials.system}\n${input.materials.user}`),
    businessOutputDemand: { ...demands, target: Math.min(demands.target, maximum), maximum },
    reasoningPolicy: {
      tier: normalizeReasoningTier(input.profile.reasoningTier ?? input.profile.reasoningEffort),
      providerDialect: input.profile.reasoningDialect ?? reasoningDialectForModel(input.profile.model),
      model: input.profile.model,
    },
  });
  const reasoningPolicy = plan.reasoningPolicy;
  if (!reasoningPolicy) throw new Error('campaign_plan_policy_missing');
  const buildRequest = (repairErrors: string[] | null): LlmRequest => ({
    role: 'WorldMapper',
    system: input.materials.system,
    user: repairErrors === null ? input.materials.user
      : `${input.materials.user}\n\n上一次输出未通过校验，错误如下：\n- ${repairErrors.join('\n- ')}\n请输出修正后的完整 JSON（保持相同结构与玩家意图，不要删除必需字段）。`,
    maxOutputTokens: plan.wireOutputTokens,
    jsonMode: input.profile.capabilities.supportsJson,
    requestKind: 'campaign_plan',
    reasoningTier: reasoningPolicy.tier,
    reasoningReserveTokens: reasoningPolicy.reserveTokens,
    reasoningPolicyVersion: reasoningPolicy.policyVersion,
    ledger: { logicalRequestId: input.logicalRequestId, requestKind: 'campaign_plan', worldId: input.worldId },
    scheduling: {
      logicalTaskId: input.logicalRequestId,
      role: 'mapper', priority: 'P2',
      endpointBucketId: endpointBucketId(input.profile.endpoint),
      requestPlanHash: stableFingerprint(plan),
      estimatedInputTokens: plan.mandatoryInputTokens,
      reservedOutputTokens: plan.wireOutputTokens,
      worldId: input.worldId,
    },
    ...(repairErrors !== null ? { repairInstructions: '输出修正后的完整 JSON 对象。' } : {}),
  });

  const dispatch = async (request: LlmRequest): Promise<{ text: string; unknown: boolean }> => {
    try {
      const response = await input.provider.complete(request);
      return { text: response.text, unknown: false };
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error
        && ((error as { name?: string }).name === 'OutcomeUnknownReplayError')) {
        return { text: '', unknown: true };
      }
      throw error;
    }
  };

  let physicalRequests = 0;
  const first = await dispatch(buildRequest(null));
  physicalRequests += 1;
  if (first.unknown) {
    return { status: 'outcome_unknown', model: null, parseErrors: [], rawText: '', physicalRequests };
  }
  const firstErrors: string[] = [];
  const firstParsed = extractJsonObject(first.text);
  const firstModel = firstParsed === null ? null : parseCampaignPlanCandidate(firstParsed, firstErrors);
  if (firstModel !== null) {
    return { status: 'ready', model: firstModel, parseErrors: [], rawText: first.text, physicalRequests };
  }
  // One bounded repair with the SAME frozen materials + error list.
  const repair = await dispatch(buildRequest(firstErrors.slice(0, 12)));
  physicalRequests += 1;
  if (repair.unknown) {
    return { status: 'outcome_unknown', model: null, parseErrors: firstErrors, rawText: first.text, physicalRequests };
  }
  const repairErrors: string[] = [];
  const repairParsed = extractJsonObject(repair.text);
  const repairModel = repairParsed === null ? null : parseCampaignPlanCandidate(repairParsed, repairErrors);
  if (repairModel !== null) {
    return { status: 'ready', model: repairModel, parseErrors: [], rawText: repair.text, physicalRequests };
  }
  return { status: 'invalid', model: null, parseErrors: repairErrors.length > 0 ? repairErrors : firstErrors, rawText: repair.text, physicalRequests };
}

export { llmModelProfileFingerprint };

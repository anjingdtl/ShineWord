import type { ApiProfile, LlmProvider, LlmRequest } from '../llm/types';
import { LlmRequestFailure, normalizeReasoningTier } from '../llm/types';
import { DEFAULT_OUTPUT_DEMANDS } from '../llm/requestDemands';
import { resolveModelCapabilities } from '../llm/capabilityResolver';
import { planLlmRequest } from '../llm/requestBudgetKernel';
import { BudgetInfeasibleError, stableFingerprint } from '../llm/requestPlan';
import { llmModelProfileFingerprint } from '../llm/profileFingerprint';
import { reasoningDialectForModel, REASONING_ONLY_RESERVE_MULTIPLIER } from '../llm/reasoningPolicy';
import type { ReasoningPolicySelection } from '../llm/reasoningPolicy';
import { recoverReasoningPolicy, observedReasoningTokensFromFailure } from '../llm/reasoningFeedback';
import { estimateFinalWireInput, verifyFinalWireRequest } from '../llm/finalWireVerifier';
import { endpointBucketId } from '../worldBuild/rateScheduler';
import type { ContentEntry } from '../../domain/content/types';
import type { CampaignIntentV1 } from '../../domain/campaignPlan/types';
import { SKILL_RANKS } from '../../domain/rules/types';
import type { LocalCompileContext } from './localCompile';
import { CAMPAIGN_PLAN_MODEL_VERSION, METHOD_REQUIREMENT_FIELDS, METHOD_CONDITION_TEMPLATE_KINDS, PROPOSAL_TEXT_LIMITS, extractJsonObject, parseCampaignPlanCandidate, type CampaignPlanCandidateModelV1 } from './candidateModel';

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
  knownKnowledgeEntryIds?: ReadonlySet<string>;
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
  const clues = input.visibleEntries.filter(entry => entry.kind === 'lore' && !ctx.campaignEntryIds?.has(entry.entryId)).slice(0, 10)
    .map(entry => entry.entryId);
  const adoptedClues = input.visibleEntries.filter(entry => entry.kind === 'lore' && ctx.campaignEntryIds?.has(entry.entryId))
    .map(entry => ({ entryId: entry.entryId, definition: entry.definition, playerKnows: input.knownKnowledgeEntryIds?.has(entry.entryId) ?? false }));
  const quests = input.visibleEntries.filter(entry => entry.kind === 'quest').slice(0, 6)
    .map(entry => entry.entryId);

  const goalBlock = intent.goalMode === 'declared'
    ? `玩家完整意图（必须响应，不得裁剪）：${intent.rawIntent}\n归纳目标：${intent.normalizedIntent}${intent.userConstraints.length > 0 ? `\n玩家约束：${intent.userConstraints.join('；')}` : ''}`
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
    '  "firstSituation": {"situationTitle","summary","gmBrief","pressureDescription","deadlineClockSeconds","signs":[{"text"}],"methods":[...]},',
    '  "consequences": [{"consequenceId":"stable-id","description":"后续反应","trigger":{"kind":"committed_event","eventType":"later_supported_event"},"effects":[{"template":"record_event","eventType":"reaction_recorded","summary":"实际回应"}],"visibility":"public"}],',
    '  "rewards": [],',
    '  "clues": [{"clueId":"local-clue-alias","title":"线索标题","text":"发现后才能公开的线索内容","sourceEntryIds":[],"provenance":{"kind":"design_fill|canon_inspired","sourceFactIds":[],"rationale":"来源说明"}}]',
    '}',
    '',
    '结构规则：',
    `- proposal 各字段必须是字符串并满足长度：${Object.entries(PROPOSAL_TEXT_LIMITS).map(([field, limit]) => `${field} ${limit.min}..${limit.max} 字符`).join('；')}。tone 用简短风格标签，不写长剧情描述；长度错误只修正对应字段，不删目标/前提，也不裁剪输入的完整玩家意图。`,
    '- stages 2-6 个，主路径必须从无 activation 的起点可达至少一个结局条件；远期阶段用 coverage="provisional"；',
    '- 只有当前第一阶段 activation=null。后续阶段用 node_succeeded 与 dependsOn 引用前驱；firstSituation 仅服务当前第一阶段，远期不得用 self 的同一计数冒充独立问题。短篇每阶段约 2-5 次有意义的决定，不用反复交谈/观察刷 10/30 次计数；完成条件对应取得证据、达成承诺或解除具体阻碍。',
    '- 第一个 concrete 阶段必须完整可玩：endings 之前先由 firstSituation 给出 2-4 个办法（methods），办法之间机制不同（不同技能/不同行动类型/不同对象），至少一个办法的 firstStep 只用下面列出的技能且不需要准备；',
    '- 每个 method 的 outcomes 必须给出 full_success/success/failure/severe_failure 四档，各档 resultFact 一句玩家可读事实，effects 从效果模板白名单选择；',
    '- 每种办法必须至少有一个成功档以权威 effects 推进该阶段 completion；有风险的失败要提供改变局面的代价或新机会。日常观察、无风险交谈可使用 observe/talk/interact，不必强制 skill_check。',
    '- 至少一条当前可执行路线必须能通过不同、有因果关系的普通 success 决定完成阶段，不能让所有完成路线都只等待 full_success。大成功可给捷径或额外收益。普通成功已经创建承诺、发现知识之后，后续办法应消费这些已提交事实；重复创建同一承诺或重复授予同一知识不算新进展。累计计数达到门槛的成功路径不能仍强制等待大成功才写入 resolved。',
    '- 中长篇阶段应包含准备、取得实绩、兑现或选择后续方向等不同问题，避免首步一次普通成功就跳过所有过程，也不要通过重复同一步骤凑篇幅。修订时先核对已有开放承诺、已知知识、关系和实际失败代价，再提供当前角色能执行的下一步。',
    '- 局面 resolved/suppressed 后，其办法不能继续执行。不能让唯一增进关系的办法先关闭 self，却要求随后在同一局面反复交谈达到更高关系；同理，先 prepare 取得条件，最后由满足前提的 fulfillment 办法结算，完成条件必须能在关闭前成立。关系起点使用已提交值，未建立的有向关系从0开始。',
    '- 计数的单位必须与实际取得的事实一致：一次取得一份证词，不能写成 evidence+10 冒充两份独立证据。关闭前供给不足时，提供不关闭局面的准备办法，随后由 requires.condition 达标的兑现办法收尾；修复不能通过删除准备门槛或夸大一次首步成果跳过过程。',
    '- 条件模板白名单：situation_resolved{situationId}, situation_status{situationId,status}, quest_succeeded{questId}, committed_event{eventType,payloadMatch?}, counter_at_least{situationId,counterId,minimum}, promise_fulfilled{situationId,promiseId}, knowledge_known{entryId}, relationship_at_least{fromActorId,toActorId,closeness}, item_owned{itemId,actorId}, actor_alive{actorId}, actor_dead{actorId}, node_succeeded{nodeId}；可用 {"kind":"all","of":[...]}/any/not 组合（≤3 层）。firstSituation 的局面可以用 situationId "self" 指代自身；',
    '- 效果模板白名单：situation_status{situationId,status,resolution?}, situation_counter{situationId,counterId,delta(±10)}, promise_create{situationId,promiseId,promisorActorId,promiseeActorId?,description}, promise_fulfill{situationId,promiseId}, promise_break{situationId,promiseId}, grant_knowledge{entryId}, grant_item{itemId,toActorId}, relationship_shift{fromActorId,toActorId,delta(±3)}, condition_apply{actorId,conditionId}, condition_remove{actorId,conditionId}, resource_change{actorId,resourceId,amount(±10)}, clock_advance{minutes(≤240)}, record_event{eventType,summary}, schedule_consequence{consequenceId}, suppress_reference_event{situationId,eventKey,reason}；',
    '- 可选 "consequences": [{consequenceId,description,trigger, effects:[{template:"schedule_consequence" 之外的效果}],visibility}] 表示延迟后果；可选 "rewards": [{policyId,nodeId,description,rewards:[{kind:"skill_rank|item|knowledge|relationship|resource_cap",targetId,toActorId?,rank?,delta?}]}]；',
    '- 人物担保、合作或付出应留下可执行后果：在相应 outcomes 用 schedule_consequence 引用 consequences；trigger 应等待后续履约、事件或准备条件，不与调度条件同时成立。后续办法可用 promise_fulfilled、knowledge_known 或 relationship_at_least 消费这些真实结果。',
    '- 若篇幅偏好为长篇，至少设计两个来源、触发和效果各不相同的持续后果：先由成功行动明确排程，至少经过两次不同的有效玩家决定后才满足触发条件；每个后果的权威效果都必须被后续办法、阶段完成条件或结局条件实际消费。只有 record_event 文案、同回合自触发、重复关系/知识授予或没有后续消费者的后果不算。',
    '- 行动文本、firstStep.targetEntryId 与效果必须指向同一实际参与者和场景：与未具名镇民/矿工闲谈时省略 targetEntryId；不得把被关押人物写成酒馆交谈对象，也不得因与第三人闲谈而改变她的关系。只有结果明确描述与该角色互动，才可产生针对她的关系效果。',
    '- 公开字段（title/publicObjective/publicPitch/longTermGoal/signs/summary）不得泄漏 gmPremise、gmPurpose、隐藏身份或原著后期走向；',
    '- 下方已验证事实与人物资料约束全部文案（包括 GM 字段、线索和四档 resultFact），不是只供引用 ID。不得改写原著人物的身份/职务、被捕原因、灾害原因、既有事件或开局时间；不得用 design_fill 包装替换原著事实。未提供的原案细节保持未知，设计新的调查/探视/协作过程，不编造已发生的罪行、损失或罪证。不能把开局锚点无依据地跳到若干日之后，也不能替换人物职务来迁就剧情。',
    '- 原著事实中的名称只是引用资料，不表示玩家知晓。当前场景、已知知识与公开资料决定玩家可见内容；GM 知道的秘密不能转成公开的标题、迹象或自动授予知识。',
    '- stages.provenance 与 clues.provenance 使用同一严格来源合同：canon_inspired 必须有下方可核实的 sourceFactIds，且全部引用有效；design_fill 必须 sourceFactIds=[]，如实说明新增过程。无效原著引用会拒绝整个候选，不会自动改成创作补充。',
    '- 世界人物、地点、技能、能力、物品和任务只能引用下面的 ID。可在 clues 定义最多8条战役线索（标题2..80、正文4..800字），clueId 是新建的局部别名，不能占用已有条目ID；只在 knowledge_known、grant_knowledge、requires.knowledgeEntryId 或 knowledge 奖励中引用它。本地生成独立战役命名空间ID。没有 clues 定义的新线索引用无效。',
    '- clues.sourceEntryIds 只能引用下方已有目录；canon_inspired 必须引用可核实的 sourceFactIds，设计补充用 design_fill 且 sourceFactIds=[]。线索不能伪称原著事实，不能定义新物品、人物或能力；采纳线索定义不授予知识，必须由成功行动或实际完成后的奖励获得。',
    '- 事实 ID 与目录条目 ID 是两个独立命名空间：sourceFactIds 只能取“唯一允许填写到 stages/clues.provenance.sourceFactIds 的原著事实 ID”列表；clues.sourceEntryIds 只能取“唯一允许填写到 clues.sourceEntryIds 的世界目录条目 ID”列表。列表中没有适合的来源时，clue 可用 sourceEntryIds=[] 与 design_fill/sourceFactIds=[]；宁可省略该线索，也不得拼造、变形或把 factId 当 entryId。',
    '- actorId/fromActorId/toActorId 使用玩家 actorId 或在场人物模板 ID；禁止杜撰 pc、roland、anna 等英文昵称。计数条件必须明确 integer minimum，situation_status 必须明确 status。',
    '- situation_status 的 status 只允许 dormant / eligible / active / resolved / suppressed。failed、completed、cancelled 都不是局面状态。失败或取消条件可用 committed_event，且对应 outcomes 必须用 record_event 产生那个事件；不需要的 failure/cancellation 写 null。',
    '- endings.condition 引用阶段只能使用 node_succeeded，nodeId 必须逐字等于 stages 中的 nodeId；例如 {"kind":"node_succeeded","nodeId":"stage-2"}。严禁把阶段 ID 写入 situationId，也严禁用 situation_resolved/situation_status 代替 node_succeeded。本地不会猜测或代你补造结局。每个末端主阶段都必须被至少一个结局条件引用（包括失败/开放结局）。',
    '- 多个 endings 必须分别由不同、可达且有实际来源的事实条件触发；严禁复制同一个 node_succeeded 条件，再换 title/outcomeKind 冒充成功、惨胜、失败或开放结局。各 outcomeKind 若不能对应不同的 committed_event 或其它可验证证据，就只保留一个真实结局。',
    '- 尚未完成后续主目标不等于失败。不能用“前一阶段成功 AND NOT 后续成功事件/节点”自动触发代价或失败结局，否则后续阶段根本没有行动机会。提前失败/代价退出必须由已提交的失败、取消或实际损失证据触发；成功结局应等目标的后续主阶段完成。保护持续安全、争取协作等已承诺目标必须留出实际推进机会。',
    '- success/pyrrhic/open 结局不能只依赖前序节点成功就自动跳过后续 main 目标；not 失败事件也不是退出证据。确实不属于当前完整目标的后日谈/下一场委托应标 role=optional，不能先列为主目标再提前结束。实际失败、取消、角色损失可保留提前退出路径。',
    '- 结局硬门槛（逐个 ending 自检）：每个可能结束战役的 condition 都必须包含该路线所有必做 main 目标的完成证据；只有未完成目标的真实失败、取消或损失证据，才可走提前退出。即使 outcomeKind=open，也不能只写前序节点成功。',
    '- 明确反例：若 stage-4 是 role=main 且接在 stage-3 后，condition={"kind":"node_succeeded","nodeId":"stage-3"} 的 open 结局无效；没有真实失败/取消/损失时，至少要要求 node_succeeded(stage-4)。stage-4 若实际只是后日谈，先标为 role=optional，再按已完成主线设计结局。',
    '- method 完整形状：{"methodId":"stable-id","title":"办法标题","goal":"要实现什么","firstStep":{"intent":"玩家直接可执行的第一步描述","actionKind":"observe|talk|interact|skill_check|ability|move","skillId":"仅检定时填写已给出的技能 ID","targetEntryId":"可选的在场人物模板 ID"},"requires":{},"preparation":"无","tradeoffs":"具体代价","outcomes":{"full_success":{"resultFact":"本档结果事实","effects":[]},"success":{"resultFact":"本档结果事实","effects":[]},"failure":{"resultFact":"本档结果事实","effects":[]},"severe_failure":{"resultFact":"本档结果事实","effects":[]}}}。不同办法应改变不同的关系、承诺、知识、代价或后续机会。',
    `- requires 仅支持这些字段：${METHOD_REQUIREMENT_FIELDS.join(', ')}。ID 必须是白名单中的字符串；minRank 必须与 skillId 配对，等级为 ${SKILL_RANKS.join(' / ')}；minCloseness 必须与 relationshipTo 配对且为0..100整数。不要发明 knowledge、promise、counter、event 等 requires 字段。condition 使用已有条件模板，不能填写自由文本或代码。`,
    `- requires.condition 可用 ${METHOD_CONDITION_TEMPLATE_KINDS.join(', ')}，按既有 all/any/not 结构组合；不能使用 committed_event。例：{"kind":"counter_at_least","situationId":"self","counterId":"evidence","minimum":2} 或 {"kind":"promise_fulfilled","situationId":"已提交承诺所属局面ID","promiseId":"已提交承诺ID"}。缺失数据不会被 not 当成成立。准备办法先产生计数/知识/承诺，后续办法引用相同身份并兑现；不能让唯一生产准备条件的办法依赖它自己尚未产生的条件。`,
    '- 条件必须嵌套在 requires.condition 中。完整示例："requires":{"condition":{"kind":"counter_at_least","situationId":"self","counterId":"evidence","minimum":2}}。禁止直接把 kind/of/situationId/counterId/minimum 放在 requires 根上；修复时保留原准备条件，只更正结构，不能删掉门槛。',
    '- 每个 schedule_consequence 的 consequenceId 必须在根对象 consequences 数组中完整定义；consequences.trigger 必须是条件 JSON 对象，不是文字。条件字段用 kind，效果字段用 template。',
    '- 输出前核对每一个 schedule_consequence.consequenceId 与 consequences[].consequenceId 完全一致。没有定义就不得安排；不用延迟后果时 consequences=[] 且 outcomes 中没有 schedule_consequence。不要照抄上面的示例事件，事件必须有本次后续办法的 record_event 来源。',
    '- 阶段 completion/failure/cancellation 不能引用该阶段自身的 node_succeeded；那会成为无法推进的循环。未来未构建的阶段保持 provisional。',
    '- 当前阶段 completion 的局面/计数/承诺必须有 outcomes 或 consequences 中的实际效果来源。要求 self resolved 就必须有 situation_status resolved；要求承诺兑现则先 promise_create 再 promise_fulfill。旧承诺必须逐字使用已提交状态中的 situationId+promiseId，不能把旧 promiseId 配给新的 self。',
    '- 普通 success 的完成路径也必须兑现 completion 引用的旧开放承诺，或提供独立准备后的履约办法；只有 full_success 兑现旧承诺仍会让普通成功反复计数而无法推进。已提交 fulfilled 的旧承诺可以直接沿用，不重复创建或改写。',
    '- firstSituation 默认省略 deadlineClockSeconds；只有玩家目标确实需要倒计时才填写。带 deadlineClockSeconds 的局面超时也会 resolved，因此 completion 不能只要求 self resolved。应使用类似 {"kind":"all","of":[{"kind":"situation_resolved","situationId":"self"},{"kind":"counter_at_least","situationId":"self","counterId":"objective_completed","minimum":1}]} 的条件；该正数计数/兑现承诺/committed_event 必须由 success 或 full_success 产生，且 failure/severe_failure 不得产生同一证据。any 中每一条包含 resolved 的可完成路径都必须在该路径内同时要求这种成功专属证据，绝不能把超时记作完成。',
    '- 当前可行动人物见“当前在场人物”白名单；其它世界人物只能作为远期背景，不能当作当前 firstStep.targetEntryId。至少一个入口 requires={} 且不依赖物品、能力、关系或未发现知识；无在场目标时可从无 targetEntryId 的现场调查开始。',
    '- 当前只定义一份 firstSituation，situationId=self。不要发明 sit-n2 等远期局面 ID；provisional 阶段用 committed_event 或已有知识/任务作为 completion，后续修订才定义它自己的局面。record_event 必须含 eventType 与 summary。',
    '- 所有 eventType 使用小写 snake_case（^[a-z][a-z0-9_]*$），例如 rescue_completed；不能使用连字符或空格。committed_event 条件与 record_event 效果必须逐字引用同一个事件名。节点/办法/后果的 ID 与事件名是不同字段。',
    `- rewards[].rewards[] 的每项必须有 kind 与 targetId。relationship 奖励的 targetId 是关系起点人物ID，toActorId 是终点人物ID，delta 为±3以内整数；targetId 不能换成 fromActorId，这与 relationship_shift 效果字段不同。知识/物品/技能奖励的 targetId 分别是已给出的条目ID，资源上限的 targetId 仅 hp/stamina。skill_rank 的 rank 必须是字符串 ${SKILL_RANKS.join(' / ')}，不能填写数字1、2或汉字等级。`,
    '- relationship_at_least.closeness 沿用当前角色关系的 0..100 整数标度，门槛以当前已提交关系和可获得增量为依据；resourceId 仅 hp 或 stamina。proposal 的 longTermGoal/publicPitch/gmPremise/tone 全部填写；日常合作的 gmPremise 说明各方真实动机与阻力，无需预设阴谋。',
  ].join('\n');

  const user = [
    `作品：${input.worldTitle}`,
    `开局时刻：${input.anchorTitle}`,
    `开局地点：${ctx.openingLocationId}`,
    `玩家角色：${input.playerName}（actorId=${intent.protagonistBinding.actorId}；已会技能：${[...ctx.protagonistSkills].slice(0, 10).join(', ') || '无'}）`,
    goalBlock,
    `篇幅偏好：${intent.lengthPreference === 'short' ? '短篇（2-3 阶段）' : intent.lengthPreference === 'long' ? '长篇（4-6 阶段）' : '中篇（3-5 阶段）'}${intent.tone ? `；基调：${intent.tone}` : ''}`,
    input.openingGoalSuggestions.length > 0 ? `可参考的开局方向：${input.openingGoalSuggestions.join('；')}` : null,
    '',
    '可用技能：', skills.join('、') || '无',
    '可用能力：', abilities.join('、') || '无',
    '可进入场景：', scenes.join('；') || '无',
    '当前在场人物（仅这些可以作为当前行动对象）：', (ctx.presentActorRefs ?? []).join('、') || '无',
    '世界人物模板（可能在别处，不代表当前在场）：', npcs.join('、') || '无',
    '策划可用人物资料（公开文案仍需过滤隐藏动机）：', JSON.stringify(ctx.actorMaterials ?? []),
    '开局时已验证的原著事实（不得补入后期事件）：', JSON.stringify(ctx.openingFacts ?? []),
    '唯一允许填写到 stages/clues.provenance.sourceFactIds 的原著事实 ID（必须逐字复制；不得从剧情知识、其它字段或旧任务补造）：',
    JSON.stringify((ctx.openingFacts ?? []).map(fact => fact.factId)),
    '唯一允许填写到 clues.sourceEntryIds 的世界目录条目 ID（必须逐字复制；这不是原著事实 ID）：',
    JSON.stringify(input.visibleEntries.map(entry => entry.entryId)),
    '已知物品：', items.join('、') || '无',
    '可引用的世界线索/资料（不代表角色已经知道）：', clues.join('、') || '无',
    '当前分支已采纳的战役线索（供策划使用，playerKnows=false时不得公开正文或假设前提已满足）：', JSON.stringify(adoptedClues),
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
  branchId?: string;
  /** Durable response recovery; never redispatch a completed generation. */
  resume?: { text: string; repairUsed: boolean };
  physicalRequestBudget?: number;
  /** Feedback selected at material freeze, never from live history on restore. */
  reasoningPolicy?: ReasoningPolicySelection;
  /** Resume a known output-exhausted attempt under the original aggregate cap. */
  reasoningReserveMultiplier?: number;
  /** A completed failed response is a lower bound, not a calibrated p95. */
  observedReasoningTokens?: number | null;
  /** Actual durable wire ceiling of the known exhausted attempt being resumed. */
  previousWireOutputTokens?: number | null;
  onResponse?: (text: string, repairUsed: boolean) => Promise<void>;
  beforeDispatch?: () => Promise<void>;
  /** Local reference and executable-contract gates share the same repair. */
  validateModel?: (model: CampaignPlanCandidateModelV1) => readonly string[];
}): Promise<PlanGenerationResult> {
  const demands = DEFAULT_OUTPUT_DEMANDS.campaign_plan;
  const maximum = Math.min(demands.maximum, input.profile.contentOutputTokens ?? 16_384);
  let reserveMultiplier = input.reasoningReserveMultiplier ?? 1;
  const wireMessages = (materials: PlanRequestMaterials) => [
    { role: 'system' as const, content: materials.system },
    { role: 'user' as const, content: materials.user },
  ];
  let plan = planLlmRequest({
    ...planLlmRequestInput(input, demands, maximum),
    estimatedMandatoryInputTokens: estimateFinalWireInput(wireMessages(input.materials)),
  });
  if (!plan.reasoningPolicy) throw new Error('campaign_plan_policy_missing');
  const observed = input.observedReasoningTokens;
  let recoverySelection = reserveMultiplier > 1
    ? recoverReasoningPolicy(planLlmRequestInput(input, demands, maximum).reasoningPolicy,
      plan.reasoningPolicy.reserveTokens, observed) : undefined;
  if (recoverySelection !== undefined) {
    plan = planLlmRequest({ ...planLlmRequestInput(input, demands, maximum, reserveMultiplier, recoverySelection),
      estimatedMandatoryInputTokens: estimateFinalWireInput(wireMessages(input.materials)) });
  }
  // The original mandatory material and profile are frozen. A larger local
  // reasoning reservation alone does not improve an unchanged wire ceiling.
  if (!input.resume && reserveMultiplier > 1 && (input.physicalRequestBudget ?? 2) > 0) {
    assertRecoveryBudgetIncreased(input.previousWireOutputTokens, plan.wireOutputTokens);
  }
  const initialPolicy = plan.reasoningPolicy;
  if (!initialPolicy) throw new Error('campaign_plan_policy_missing');
  let reasoningPolicy = initialPolicy;
  const buildRequest = (repairErrors: string[] | null): LlmRequest => ({
    role: 'WorldMapper',
    system: input.materials.system,
    user: repairErrors === null ? input.materials.user
      : `${input.materials.user}\n\n上一次输出未通过校验，错误如下：\n- ${repairErrors.join('\n- ')}\n请输出修正后的完整 JSON（保持相同结构与玩家意图，不要删除必需字段）。`,
    maxOutputTokens: plan.wireOutputTokens,
    maxPhysicalRequests: 1,
    jsonMode: input.profile.capabilities.supportsJson,
    requestKind: 'campaign_plan',
    reasoningTier: reasoningPolicy.tier,
    reasoningReserveTokens: reasoningPolicy.reserveTokens,
    reasoningPolicyVersion: reasoningPolicy.policyVersion,
    ledger: { logicalRequestId: input.logicalRequestId, physicalAttemptLimit: 2, requestKind: 'campaign_plan', worldId: input.worldId, ...(input.branchId ? { branchId: input.branchId } : {}) },
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
    await input.beforeDispatch?.();
    // Check the allocation actually sent, after adding the complete candidate
    // and repair instructions. Replanning here could accept a smaller wire
    // ceiling while the request still sends the original frozen allocation.
    const check = verifyFinalWireRequest({ messages: wireMessages(request), budget: {
      contextWindowTokens: plan.envelope.contextWindowTokens,
      hardInputLimit: plan.envelope.hardInputLimit,
      wireOutputTokens: request.maxOutputTokens,
      safetyMarginTokens: plan.envelope.safetyMarginTokens,
    } });
    if (request.scheduling) request = { ...request, scheduling: { ...request.scheduling,
      estimatedInputTokens: check.estimatedInputTokens } };
    try {
      physicalRequests += 1;
      const response = await input.provider.complete(request);
      return { text: response.text, unknown: false };
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error
        && ((error as { name?: string }).name === 'OutcomeUnknownReplayError')) {
        return { text: '', unknown: true };
      }
      const metric = error instanceof LlmRequestFailure ? error.requestMetrics.at(-1) : undefined;
      if ((metric?.completionState === 'reasoning_only' || metric?.completionState === 'length')
        && physicalRequests < budget && reserveMultiplier === 1) {
        reserveMultiplier = REASONING_ONLY_RESERVE_MULTIPLIER;
        recoverySelection = recoverReasoningPolicy(planLlmRequestInput(input, demands, maximum).reasoningPolicy,
          initialPolicy.reserveTokens, observedReasoningTokensFromFailure(error));
        plan = planLlmRequest({ ...planLlmRequestInput(input, demands, maximum, reserveMultiplier, recoverySelection),
          estimatedMandatoryInputTokens: estimateFinalWireInput(wireMessages(request)) });
        reasoningPolicy = plan.reasoningPolicy!;
        assertRecoveryBudgetIncreased(request.maxOutputTokens, plan.wireOutputTokens);
        return dispatch({ ...request, maxOutputTokens: plan.wireOutputTokens,
          reasoningReserveTokens: reasoningPolicy.reserveTokens,
          scheduling: { ...request.scheduling!, requestPlanHash: stableFingerprint(plan),
            estimatedInputTokens: plan.mandatoryInputTokens, reservedOutputTokens: plan.wireOutputTokens } });
      }
      throw error;
    }
  };

  let physicalRequests = 0;
  const budget = Math.min(2, input.physicalRequestBudget ?? 2);
  if (!input.resume && budget < 1) return { status: 'invalid', model: null, parseErrors: ['physical_request_budget_exhausted'], rawText: '', physicalRequests };
  const first = input.resume ? { text: input.resume.text, unknown: false } : await dispatch(buildRequest(null));
  if (!input.resume) {
    if (!first.unknown) await input.onResponse?.(first.text, false);
  }
  if (first.unknown) {
    return { status: 'outcome_unknown', model: null, parseErrors: [], rawText: '', physicalRequests };
  }
  const firstErrors: string[] = [];
  const firstParsed = extractJsonObject(first.text);
  const firstModel = firstParsed === null ? null : parseCampaignPlanCandidate(firstParsed, firstErrors);
  if (firstModel) firstErrors.push(...(input.validateModel?.(firstModel) ?? []));
  if (firstModel !== null && firstErrors.length === 0) {
    return { status: 'ready', model: firstModel, parseErrors: [], rawText: first.text, physicalRequests };
  }
  if (firstParsed === null) firstErrors.push('输出必须是完整 JSON 对象。');
  if (input.resume?.repairUsed || physicalRequests >= budget) {
    return { status: 'invalid', model: null, parseErrors: firstErrors, rawText: first.text, physicalRequests };
  }
  // One bounded repair with the SAME frozen materials + error list.
  const repairRequest = buildRequest(firstErrors.slice(0, 12));
  repairRequest.user += `\n待修复候选（保留完整意图和合法合同）：\n${first.text}`;
  const repair = await dispatch(repairRequest);
  if (repair.unknown) {
    return { status: 'outcome_unknown', model: null, parseErrors: firstErrors, rawText: first.text, physicalRequests };
  }
  await input.onResponse?.(repair.text, true);
  const repairErrors: string[] = [];
  const repairParsed = extractJsonObject(repair.text);
  const repairModel = repairParsed === null ? null : parseCampaignPlanCandidate(repairParsed, repairErrors);
  if (repairModel) repairErrors.push(...(input.validateModel?.(repairModel) ?? []));
  if (repairModel !== null && repairErrors.length === 0) {
    return { status: 'ready', model: repairModel, parseErrors: [], rawText: repair.text, physicalRequests };
  }
  return { status: 'invalid', model: null, parseErrors: repairErrors.length > 0 ? repairErrors : firstErrors, rawText: repair.text, physicalRequests };
}

function assertRecoveryBudgetIncreased(previous: number | null | undefined, next: number): void {
  if (!Number.isSafeInteger(previous) || Number(previous) <= 0) {
    throw new BudgetInfeasibleError('上次已知截断请求缺少有效的输出预算记录，已停止重复派发。请调整配置后重新准备。', 'output_demand_infeasible');
  }
  if (next <= Number(previous)) {
    throw new BudgetInfeasibleError(`输出预算无法增加（此前 ${previous}、恢复后 ${next} token），已停止重复派发。请调整配置后重新准备。`, 'output_demand_infeasible');
  }
}

function planLlmRequestInput(input: { profile: ApiProfile; reasoningPolicy?: ReasoningPolicySelection }, demands: typeof DEFAULT_OUTPUT_DEMANDS.campaign_plan, maximum: number, reserveMultiplier = 1, recoverySelection?: ReasoningPolicySelection) {
  return {
    capabilities: resolveModelCapabilities({ declared: {
      contextWindowTokens: input.profile.capabilities.contextWindow, maxOutputTokens: input.profile.capabilities.maxOutputTokens,
      supportsJsonMode: input.profile.capabilities.supportsJson, reportsUsage: input.profile.capabilities.reportsUsage,
      reasoningUsageReported: input.profile.capabilities.reportsUsage }, reasoningMode: 'always_on' as const }),
    requestKind: 'campaign_plan' as const, estimatedMandatoryInputTokens: 0,
    // A known exhausted completion needs a whole JSON again. Use the remaining
    // headroom for business output instead of dropping to the cold-start target.
    // The kernel still enforces the frozen model ceiling and business minimum.
    businessOutputDemand: { ...demands, target: Math.min(reserveMultiplier > 1 ? maximum : demands.target, maximum), maximum },
    reasoningPolicy: recoverySelection ?? { ...(input.reasoningPolicy ?? { tier: normalizeReasoningTier(input.profile.reasoningTier ?? input.profile.reasoningEffort),
      providerDialect: input.profile.reasoningDialect ?? reasoningDialectForModel(input.profile.model), model: input.profile.model,
    }), reserveMultiplier },
  };
}

export { llmModelProfileFingerprint };

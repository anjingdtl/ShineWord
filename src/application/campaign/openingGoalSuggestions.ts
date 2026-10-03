/**
 * AI-suggested opening goals (2026-10-01 product ask #3).
 *
 * The opening wizard's "这次想做什么" field is easy to leave blank for
 * players who have not read the source novel. One cheap JSON request over
 * the published world package proposes two concrete goals tied to the
 * chosen anchor moment, place and cast; a third option always remains the
 * player's own words. Failures degrade silently to "no suggestions" - the
 * wizard must never block on this.
 */
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

const MAX_GOAL_LENGTH = 40;
const MAX_GOALS = 2;
const goalCache = new Map<string, { promise: Promise<string[]>; settled: boolean }>();
const MAX_CACHED_GOAL_REQUESTS = 32;

function parseGoals(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || !('goals' in parsed) || !Array.isArray(parsed.goals)) return [];
  const seen = new Set<string>();
  const goals: string[] = [];
  for (const raw of parsed.goals) {
    const goal = sanitizeGoal(raw);
    if (goal && !seen.has(goal)) { seen.add(goal); goals.push(goal); }
    if (goals.length >= MAX_GOALS) break;
  }
  return goals;
}

export interface OpeningGoalSuggestionInput {
  worldTitle: string;
  /** Narrative moment the campaign will start at, e.g. "序0 · 程岩穿越为四王子罗兰". */
  anchorTitle: string;
  /** Start location display name, when known. */
  locationName?: string;
  /** A few canon character names for flavour (already display-safe). */
  characterNames: readonly string[];
  /** The player's character name (original or canon). */
  playerName: string;
}

/** Production uses the same scheduled/ledgered provider as campaign turns.
 * Optional only for the original read-only API's callers and old tests. */
export interface OpeningGoalGovernance {
  worldId: string;
  packageRevision: number;
  packageContentHash: string;
  anchorEventId: string;
  profile: ApiProfile;
  sha256Hex(input: string): Promise<string> | string;
  isCurrent(): Promise<boolean>;
  queueSignal?: AbortSignal;
}

function sanitizeGoal(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_GOAL_LENGTH);
  return trimmed.length >= 4 ? trimmed : null;
}

/**
 * Returns 0-2 short goal suggestions. NEVER throws: any provider/parse
 * failure resolves to [] so the caller can render suggestions as a pure
 * enhancement.
 */
export async function suggestOpeningGoals(
  provider: LlmProvider,
  input: OpeningGoalSuggestionInput,
  governance?: OpeningGoalGovernance,
): Promise<string[]> {
  const systemLines = [
    '你是文字冒险游戏的开局目标策划。根据给定的开局时刻、地点与人物，提出两个具体、可玩性强的开局目标。',
    '要求：',
    '- 每个目标不超过 28 个字，一句话，动词开头；',
    '- 两个目标方向不同（例如一个调查谜团、一个改善处境/结盟）；',
    `- 贴合开局时刻的局势与地点，可以引用人物（如「${input.playerName}」）`,
  ];
  if (input.characterNames.length > 0) {
    systemLines.push(`- 世界已知人物示例：${input.characterNames.slice(0, 6).join('、')}`);
  }
  systemLines.push('- 只输出 JSON：{"goals":["目标一","目标二"]}');
  const system = systemLines.join('\n');

  const user = [
    `作品：${input.worldTitle}`,
    `开局时刻：${input.anchorTitle}`,
    input.locationName ? `开局地点：${input.locationName}` : null,
    `玩家角色：${input.playerName}`,
  ]
    .filter(line => line !== null)
    .join('\n');

  try {
    let cacheKey: string | null = null;
    let request: LlmRequest = {
      role: 'Planner',
      system,
      user,
      maxOutputTokens: DEFAULT_OUTPUT_DEMANDS.opening_goal.maximum,
      jsonMode: true,
      requestKind: 'opening_goal',
    };
    if (governance) {
      if (!governance.worldId || !Number.isSafeInteger(governance.packageRevision)
        || governance.packageRevision < 1 || !/^[a-f0-9]{64}$/i.test(governance.packageContentHash)
        || !governance.anchorEventId || governance.queueSignal?.aborted || !await governance.isCurrent()) return [];
      const profile = governance.profile;
      const maximum = Math.min(DEFAULT_OUTPUT_DEMANDS.opening_goal.maximum, profile.contentOutputTokens ?? 16_384);
      const plan = planLlmRequest({ capabilities: resolveModelCapabilities({
        declared: { contextWindowTokens: profile.capabilities.contextWindow,
          maxOutputTokens: profile.capabilities.maxOutputTokens, supportsJsonMode: profile.capabilities.supportsJson,
          reportsUsage: profile.capabilities.reportsUsage, reasoningUsageReported: profile.capabilities.reportsUsage },
        reasoningMode: 'always_on',
      }), requestKind: 'opening_goal', estimatedMandatoryInputTokens: estimateTokens(`${system}\n${user}`),
        businessOutputDemand: { ...DEFAULT_OUTPUT_DEMANDS.opening_goal,
          target: Math.min(DEFAULT_OUTPUT_DEMANDS.opening_goal.target, maximum), maximum },
        reasoningPolicy: { tier: normalizeReasoningTier(profile.reasoningTier ?? profile.reasoningEffort),
          providerDialect: profile.reasoningDialect ?? reasoningDialectForModel(profile.model), model: profile.model },
      });
      if (!plan.reasoningPolicy) throw new Error('opening_goal_policy_missing');
      const digest = await governance.sha256Hex(JSON.stringify({
        version: 'opening-goal-2', revision: governance.packageRevision, contentHash: governance.packageContentHash,
        anchorEventId: governance.anchorEventId, system, user,
      }));
      if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error('opening_goal_invalid_hash');
      const logicalRequestId = `opening-goal:${governance.worldId}:${digest}`;
      // Unknown remote outcomes belong to the semantic request, even after
      // changing API/model/budget. Known suggestions may vary by configuration.
      cacheKey = `${logicalRequestId}:${llmModelProfileFingerprint(profile)}:${stableFingerprint(plan)}`;
      request = { ...request, maxOutputTokens: plan.wireOutputTokens, maxPhysicalRequests: 1,
        jsonMode: profile.capabilities.supportsJson, queueSignal: governance.queueSignal,
        reasoningTier: plan.reasoningPolicy.tier, reasoningReserveTokens: plan.reasoningPolicy.reserveTokens,
        reasoningPolicyVersion: plan.reasoningPolicy.policyVersion,
        ledger: { logicalRequestId, requestKind: 'opening_goal', worldId: governance.worldId },
        scheduling: { logicalTaskId: logicalRequestId, role: 'goal_recommender', priority: 'P1',
          endpointBucketId: endpointBucketId(profile.endpoint), requestPlanHash: stableFingerprint(plan),
          estimatedInputTokens: plan.mandatoryInputTokens, reservedOutputTokens: plan.wireOutputTokens, worldId: governance.worldId },
      };
      if (governance.queueSignal?.aborted || !await governance.isCurrent()) return [];
    }
    let completion: Promise<string[]>;
    if (cacheKey) {
      const key = cacheKey;
      const prior = goalCache.get(key);
      if (prior) completion = prior.promise;
      else {
        if (goalCache.size >= MAX_CACHED_GOAL_REQUESTS) {
          const disposable = [...goalCache].find(([, value]) => value.settled);
          if (!disposable) return [];
          goalCache.delete(disposable[0]);
        }
        const entry = { promise: Promise.resolve<string[]>([]), settled: false };
        goalCache.set(key, entry);
        completion = Promise.resolve().then(() => provider.complete(request)).then(response => parseGoals(response.text)).then(goals => {
          entry.settled = true;
          if (!goals.length) goalCache.delete(key);
          return goals;
        }, error => { goalCache.delete(key); throw error; });
        entry.promise = completion;
      }
    } else completion = provider.complete(request).then(response => parseGoals(response.text));
    const goals = await completion;
    if (governance && (governance.queueSignal?.aborted || !await governance.isCurrent())) return [];
    return [...goals];
  } catch {
    return [];
  }
}

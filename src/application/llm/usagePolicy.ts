/**
 * LLM usage policy (startup convergence plan §5.1, W1).
 *
 * Single source of truth for how each `LlmRequestKind` is allowed to use the
 * UI and what happens when the model fails. The startup-convergence contract:
 * only tier-T-B (foreground degradable) kinds may block a player-visible
 * wait, and they must carry a local fallback; everything else is background
 * enhancement or a one-shot creative pass.
 *
 * This module is declarative metadata. It does NOT reject requests at
 * runtime: the census/guard tests (tests/llm-usage-census.test.cjs) fail when
 * a new request kind is added without a policy entry, and test environments
 * may assert policy consistency for UI-blocking requests. Production keeps
 * behavior unchanged (plan W1: "不在生产环境因策略冲突拒绝请求").
 */

import type { LlmRequestKind } from './types';

/**
 * - `creative_once` — must understand the source novel; long, one-shot, has
 *   progress UI and existing recovery (T-D).
 * - `foreground_degradable` — the player is waiting for this specific output;
 *   blocking the UI is allowed ONLY with a deadline and local fallback (T-B).
 * - `background_enhance` — quality upgrade that must never gate the player
 *   (T-C). Failures keep the local result silently.
 */
export type LlmUsageTier = 'creative_once' | 'foreground_degradable' | 'background_enhance';

export interface LlmUsagePolicyEntry {
  tier: LlmUsageTier;
  /** Whether a player-visible wait may depend on this kind's success. */
  uiBlockingAllowed: boolean;
  /** Local result used when the request fails or is skipped, or null. */
  localFallback: string | null;
  /** Owning work package / module for drift questions. */
  owner: string;
}

export const LLM_USAGE_POLICY: Record<LlmRequestKind, LlmUsagePolicyEntry> = {
  planner: {
    tier: 'foreground_degradable',
    uiBlockingAllowed: true,
    localFallback: 'local method match (W4a) before Planner; free-input fallback stays open',
    owner: 'game/v2Turn',
  },
  narrator: {
    tier: 'foreground_degradable',
    uiBlockingAllowed: true,
    localFallback: 'local narration template (W4c RFC; not yet approved)',
    owner: 'game/v2Turn',
  },
  campaign_plan: {
    tier: 'background_enhance',
    uiBlockingAllowed: false,
    localFallback: 'local baseline plan (W3)',
    owner: 'campaignPlan/generationService',
  },
  opening_goal: {
    tier: 'background_enhance',
    uiBlockingAllowed: false,
    localFallback: 'localOpeningGoals (W2)',
    owner: 'campaign/openingGoalSuggestions',
  },
  narrator_guidance: {
    tier: 'background_enhance',
    uiBlockingAllowed: false,
    localFallback: 'local guidance (guidance/ancillary)',
    owner: 'guidance/ancillary',
  },
  world_extract: {
    tier: 'creative_once',
    uiBlockingAllowed: true,
    localFallback: null,
    owner: 'worldBuild/openingPolicy',
  },
  world_mapping: {
    tier: 'background_enhance',
    uiBlockingAllowed: false,
    localFallback: "startup_local mapping (buildPackageFromCanon)",
    owner: 'worldBuild/llmRequest',
  },
  world_adjudication: {
    tier: 'background_enhance',
    uiBlockingAllowed: false,
    localFallback: null,
    owner: 'worldBuild (no production call site at 3fb323ba..e7f5e9d; W0 census)',
  },
  registry: {
    tier: 'background_enhance',
    uiBlockingAllowed: false,
    localFallback: null,
    owner: 'world/bookRegistry, segmentBuild/openingSurvey',
  },
  timeline: {
    tier: 'background_enhance',
    uiBlockingAllowed: false,
    localFallback: 'local timeline resolver (floor)',
    owner: 'world/timelinePass',
  },
  memory_checkpoint: {
    tier: 'background_enhance',
    uiBlockingAllowed: false,
    localFallback: null,
    owner: 'game/turnPostProcessing (post-commit, lease/fenced)',
  },
  memory_repair: {
    tier: 'background_enhance',
    uiBlockingAllowed: false,
    localFallback: null,
    owner: 'game/turnPostProcessing (post-commit, lease/fenced)',
  },
  summarizer: {
    tier: 'background_enhance',
    uiBlockingAllowed: false,
    localFallback: null,
    owner: 'memory/summarizer (no production call site at e7f5e9d; W0 census)',
  },
  style_analyzer: {
    tier: 'background_enhance',
    uiBlockingAllowed: false,
    localFallback: 'preset style',
    owner: 'writerStyle/sourceAnalyzer',
  },
};

/** Kinds whose success the player-visible startup path may depend on. */
export function uiBlockingLlmKinds(): LlmRequestKind[] {
  return (Object.keys(LLM_USAGE_POLICY) as LlmRequestKind[])
    .filter(kind => LLM_USAGE_POLICY[kind].uiBlockingAllowed);
}

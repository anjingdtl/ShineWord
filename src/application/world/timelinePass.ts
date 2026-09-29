/**
 * Pass 3 whole-book timeline pass (1M resident plan §4.3).
 *
 * ONE request over the collected event proposals asks the model to order
 * them and supply cross-chapter dependencies with whole-book vision. The
 * model only PROPOSES: local code keeps proposals whose event keys exist,
 * drops dependencies on unknown events (same rule as the local resolver),
 * commits canon events through the existing saveEvent path and marks the
 * proposals resolved. The local resolveEventProposals fallback still runs
 * afterwards for anything this pass did not cover - it is the floor, this
 * pass is the upgrade.
 */
import type { LlmRequest, LlmResponse } from '../llm/types';
import { parseStrictJsonObject } from '../llm/json';
import type { WorldStore } from '../ports/worldStore';
import { eventIdFor } from './extraction';
import type { ReasoningEffort } from '../worldBuild/groupPlanner';

export const TIMELINE_PASS_VERSION = 'timeline-pass-1';
export const TIMELINE_MAX_OUTPUT_TOKENS = 8_192;
/** Timeline thinking task (plan §4.3: GLM high / DeepSeek thinking). */
export const TIMELINE_REASONING_EFFORT: ReasoningEffort = 'high';

const TIMELINE_SYSTEM = [
  'You are ShineWord Chronicler. You receive the event list of a whole Chinese novel (each with an event key, title, summary and provisional order) and output exactly one JSON object, no prose.',
  'Schema: {"events":[{"key":string,"order":number,"dependsOn":string[]}]}',
  'Rules:',
  '- Cover ONLY the events from the provided list; reuse its exact keys.',
  '- order is the whole-book chronological position (1 = earliest); ties allowed.',
  '- dependsOn lists event keys from the SAME list that must happen before this event; omit unknown keys.',
  '- Do not invent events, do not merge events, do not output prose.',
].join('\n');

export interface TimelinePassResult {
  updated: number;
  skipped: boolean;
  reused: boolean;
}

interface RawTimeline {
  events?: Array<{ key?: unknown; order?: unknown; dependsOn?: unknown }>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function timelineJobId(worldId: string): string {
  return `job-timeline-${worldId}`;
}

export interface TimelinePassInput {
  worldStore: WorldStore;
  complete: (request: LlmRequest) => Promise<LlmResponse>;
  worldId: string;
  modelFingerprint: string;
  createdAt: string;
  /** Identity of the event-set this pass covers (checkpoint idempotency). */
  contentHash: string;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
}

export async function runTimelinePass(input: TimelinePassInput): Promise<TimelinePassResult> {
  const jobId = timelineJobId(input.worldId);
  const proposals = await input.worldStore.listEventProposals(input.worldId);
  if (proposals.length === 0) {
    return { updated: 0, skipped: true, reused: false };
  }
  const existing = await input.worldStore.getJob(input.worldId, jobId);
  if (existing?.status === 'done' && existing.contentHash === input.contentHash
    && existing.extractorVersion === TIMELINE_PASS_VERSION) {
    return { updated: 0, skipped: false, reused: true };
  }

  const payload = {
    events: proposals.map(proposal => ({
      key: proposal.eventId,
      title: proposal.title,
      summary: proposal.summary,
      provisionalOrder: proposal.worldTimeOrder,
      chapter: proposal.narrativeChapterId,
    })),
  };
  const response = await input.complete({
    role: 'WorldMapper',
    system: TIMELINE_SYSTEM,
    user: JSON.stringify(payload),
    maxOutputTokens: input.maxOutputTokens ?? TIMELINE_MAX_OUTPUT_TOKENS,
    jsonMode: true,
    reasoningEffort: input.reasoningEffort ?? TIMELINE_REASONING_EFFORT,
  });
  const raw = parseStrictJsonObject<RawTimeline>(response.text, 'Chronicler output');

  const knownKeys = new Set(proposals.map(proposal => proposal.eventId));
  const proposedOrder = new Map<string, number>();
  const proposedDeps = new Map<string, string[]>();
  for (const candidate of raw.events ?? []) {
    const key = asString(candidate.key);
    if (!key || !knownKeys.has(key)) continue;
    if (typeof candidate.order === 'number' && Number.isFinite(candidate.order)) {
      proposedOrder.set(key, Math.max(1, Math.floor(candidate.order)));
    }
    if (Array.isArray(candidate.dependsOn)) {
      const deps = candidate.dependsOn
        .filter((dep): dep is string => typeof dep === 'string')
        .filter(dep => knownKeys.has(dep) && dep !== key);
      if (deps.length > 0) proposedDeps.set(key, deps);
    }
  }

  // Model proposes, local commits: every dependency must reference a known
  // event (same rule as resolveEventProposals) and canon lands via saveEvent.
  let updated = 0;
  for (const proposal of proposals) {
    const order = proposedOrder.get(proposal.eventId) ?? proposal.worldTimeOrder;
    const dependencies = [...new Set([
      ...(proposal.dependsOnEventKeys ?? [])
        .map(key => eventIdFor(input.worldId, key))
        .filter(id => knownKeys.has(id)),
      ...(proposedDeps.get(proposal.eventId) ?? []),
    ])];
    await input.worldStore.saveEvent({
      worldId: input.worldId,
      eventId: proposal.eventId,
      title: proposal.title,
      summary: proposal.summary,
      worldTimeOrder: order,
      narrativeChapterId: proposal.narrativeChapterId,
      validFrom: null,
      validTo: null,
      status: 'canon',
      dependsOnEventIds: dependencies,
    }, input.createdAt);
    updated += 1;
  }
  await input.worldStore.markEventProposalsResolved(
    input.worldId, proposals.map(proposal => proposal.eventId), input.createdAt,
  );

  await input.worldStore.upsertJob({
    worldId: input.worldId,
    jobId,
    kind: 'timeline',
    targetId: null,
    status: 'done',
    attempts: (existing?.attempts ?? 0) + 1,
    contentHash: input.contentHash,
    extractorVersion: TIMELINE_PASS_VERSION,
    modelFingerprint: input.modelFingerprint,
    usageJson: response.usage ? JSON.stringify(response.usage) : null,
    resultJson: JSON.stringify({ events: proposals.length, ordered: proposedOrder.size }),
    error: null,
    createdAt: existing?.createdAt ?? input.createdAt,
    updatedAt: input.createdAt,
  }, input.createdAt);

  return { updated, skipped: false, reused: false };
}

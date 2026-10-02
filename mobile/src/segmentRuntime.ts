import { AndroidSegmentExecutionHost } from './phase6ExecutionHost';
import { AppState } from 'react-native';
import { SqliteBuildRunStore } from '../../src/infra/sqlite/sqliteBuildRunStore';
import { providerProfileFromFrozen, reviveRunConfig } from '../../src/application/worldBuild/runConfig';
import { KeychainSecretStore } from './secureKeyStore';
import { requestSegmentRunControl } from './sourceImport';

export async function startSegmentRun(runId: string): Promise<void> {
  const runtime = await getDatabaseRuntime();
  const runs = new SqliteBuildRunStore(runtime.db);
  const host = new AndroidSegmentExecutionHost({ runs,
    projectExists: async id => Boolean(await runtime.worldStore.getWorld(id)),
    credentialsAvailable: async id => { const run = await runs.getRun(id); const config = reviveRunConfig(run?.configJson ?? null);
      return Boolean(config && await new KeychainSecretStore().get(config.keyRef)); },
    launch: async id => { await startOrResumeBuild(id, null); }, controlRun: requestSegmentRunControl });
  await host.start(runId);
}
import { getDatabaseRuntime } from './database';
import { startOrResumeBuild } from './buildWatchdog';
import { nativeSha256 } from './nativeCrypto';
import { isFactVisibleAtAnchor } from '../../src/application/world/opening';
import { sourceIdForChapter } from '../../src/application/incrementalMapping/canonSelection';
import type { SourceRangeV1 } from '../../src/domain/build/phase6';
import type { SqliteRow } from '../../src/application/ports/sqlite';
import { rangesCover } from '../../src/application/segmentBuild/ranges';
import { estimateBuildLeadTimeMs } from '../../src/application/segmentBuild/segmentBuildService';
import { readSegmentSchedulingAdmission } from './llmScheduler';
import type { SegmentReadinessV1 } from '../../src/application/segmentBuild/types';

interface CampaignPlanningRow extends SqliteRow {
  world_id: string; anchor_json: string; opening_json: string; state_version: number;
}

function finiteAnchor(json: string): number | null {
  try {
    const value: unknown = JSON.parse(json);
    if (value && typeof value === 'object' && 'worldTimeOrder' in value
      && typeof value.worldTimeOrder === 'number' && Number.isFinite(value.worldTimeOrder)) return value.worldTimeOrder;
  } catch { /* A missing or corrupt anchor never grants whole-world evidence. */ }
  return null;
}

function requiredBranchSegments(readiness: SegmentReadinessV1, input: {
  campaignId: string; branchId: string; stateVersion: number;
}) {
  const adoptedIds = new Set(readiness.currentBinding?.artifactIds ?? []);
  const coverage = readiness.availableArtifacts.filter(a => adoptedIds.has(a.artifactId)).flatMap(a => a.coverage);
  return readiness.segments.filter(segment => segment.intent.reason === 'action_dependency'
    && segment.intent.demandRefs.some(ref => ref.campaignId === input.campaignId && ref.branchId === input.branchId
      && ref.stateVersion === input.stateVersion) && !rangesCover(segment.intent.ranges, coverage));
}

export async function getSegmentReadiness(worldId: string, campaignId?: string, branchId?: string) {
  const runtime = await getDatabaseRuntime();
  if (!await runtime.segmentPlans.getPlan(worldId)) return null;
  return runtime.segments.readReadiness({ worldId, campaignId, branchId });
}

/** Uses scene evidence, coverage and dependency demand, never turn counts. */
export async function maintainSegmentContent(input: {
  worldId: string; campaignId: string; branchId: string; locationId: string | null;
  stateVersion: number; anchorWorldTimeOrder?: number | null; intent?: string;
}): Promise<{ pending: boolean; message: string | null }> {
  const runtime = await getDatabaseRuntime();
  const plan = await runtime.segmentPlans.getPlan(input.worldId);
  if (!plan) return { pending: false, message: null };
  const row = await runtime.db.queryOne<CampaignPlanningRow>(
    `SELECT c.world_id, c.anchor_json, c.opening_json, b.state_version
       FROM campaigns c JOIN branches b ON b.campaign_id = c.campaign_id
      WHERE c.campaign_id = ? AND b.branch_id = ?`, [input.campaignId, input.branchId]);
  if (!row || row.world_id !== input.worldId) throw new Error('segment_campaign_branch_mismatch');
  if (row.state_version !== input.stateVersion) return { pending: true, message: '战役状态已更新，请刷新后继续原行动。' };
  const state = await runtime.turns.getState(input.branchId);
  if (!state || state.stateVersion !== input.stateVersion) return { pending: true, message: '战役状态已更新，请刷新后继续原行动。' };
  const anchor = finiteAnchor(row.anchor_json);
  let readiness = await runtime.segments.readReadiness(input);
  // The persisted campaign anchor is authoritative. A UI hint may be stale
  // and cannot make later canon visible to dependency planning.
  if (anchor === null) return { pending: requiredBranchSegments(readiness, input).length > 0,
    message: '无法确定原著时点，已停止自动预构建。' };
  let openingActorId: string | null = null;
  try {
    const opening: unknown = JSON.parse(row.opening_json);
    if (opening && typeof opening === 'object' && 'protagonistActorId' in opening
      && typeof opening.protagonistActorId === 'string') openingActorId = opening.protagonistActorId;
  } catch { /* The snapshot party can still establish the player actor. */ }
  const playerActorId = state.party?.find(member => member.role === 'protagonist')?.actorId ?? openingActorId;
  const currentLocationId = playerActorId ? state.actors[playerActorId]?.locationId ?? null : null;
  const binding = readiness.currentBinding;
  if (binding) {
    const ids = readiness.availableArtifacts.map(a => a.artifactId);
    if (ids.some(id => !binding.artifactIds.includes(id))) {
      await runtime.segmentPublication.adoptAtSafeBoundary({ ...input, expectedStateVersion: input.stateVersion,
        expectedManifestHash: binding.artifactManifestHash ?? binding.manifestHash, artifactIds: ids });
      readiness = await runtime.segments.readReadiness(input);
    }
  }
  const { binding: sourceBinding, members } = await runtime.sourceCatalog.snapshot(input.worldId);
  const [facts, entities] = await Promise.all([runtime.worldStore.listFacts(input.worldId), runtime.worldStore.listEntities(input.worldId)]);
  const locationEntities = entities.filter(e => e.type === 'location' && (e.entityId === currentLocationId || e.name === currentLocationId));
  const visible = facts.filter(f => (f.scope === 'world' || f.scope === 'canon')
    && f.status !== 'conflict' && f.status !== 'speculation'
    && [f.validFrom, f.validTo, f.revealAt].every(bound => bound === null
      || /^-?\d+$/.test(bound) && Number.isSafeInteger(Number(bound)))
    && isFactVisibleAtAnchor(f, anchor)
    && locationEntities.some(e => e.entityId === f.subjectEntityId
      || (f.predicate === 'current_location' || f.predicate === 'home_location')
        && (f.value.location === e.entityId || f.value.location === e.name)));
  const currentRanges: SourceRangeV1[] = [];
  for (const span of visible.flatMap(f => f.sources).slice(0, 8)) {
    const sourceId = sourceIdForChapter(span.chapterId, sourceBinding);
    if (sourceId) currentRanges.push(await runtime.sourceCatalog.createRange(sourceId, span.startOffset, span.endOffset));
  }
  if (!currentRanges.length) {
    const required = requiredBranchSegments(readiness, input);
    return { pending: required.length > 0, message: required.some(segment => segment.lastErrorCode?.includes('outcome_unknown'))
      ? '行动依赖的模型请求扣费结果未知；原行动已保留，请先在请求账本确认。'
      : required.length > 0 ? '行动依赖资料尚未采用；原行动已保留。' : null };
  }
  const candidates: SourceRangeV1[][] = [];
  for (const current of currentRanges.slice(0, 2)) {
    const member = members.find(m => m.sourceId === current.sourceId);
    if (!member) continue;
    const covered = readiness.availableArtifacts.flatMap(a => a.coverage).filter(r => r.sourceId === current.sourceId
      && r.startCp <= current.startCp && r.endCp > current.startCp);
    const edge = Math.max(current.endCp, ...covered.map(r => r.endCp));
    // Only the near source domain gets a 1–2 window buffer. Remaining book
    // coverage and already-ready windows are reused rather than swept.
    for (let start = edge; start < Math.min(member.codePointCount, edge + 6400); start += 3200)
      candidates.push([await runtime.sourceCatalog.createRange(member.sourceId, start, Math.min(member.codePointCount, start + 3200))]);
  }
  const dependencyRanges: SourceRangeV1[] = [];
  const adoptedBeforePlanning = new Set(readiness.currentBinding?.artifactIds ?? []);
  const adoptedPlanningCoverage = readiness.availableArtifacts.filter(a => adoptedBeforePlanning.has(a.artifactId)).flatMap(a => a.coverage);
  if (input.intent && entities.some(e => e.name.length >= 2 && input.intent!.includes(e.name))) {
    const ranges = [...currentRanges, ...candidates.flat()];
    const result = await runtime.sourceIndex.search({ worldId: input.worldId, query: input.intent,
      scope: { kind: 'build_internal', worldId: input.worldId, intentId: `action-${await nativeSha256.sha256Hex(input.intent)}`,
        sourceBinding, allowedRanges: ranges }, topK: 3 });
    // Retrieval is internal planning evidence. Unpublished text is never
    // returned to the player or supplied to the turn's Narrator.
    for (const hit of result.hits) if (!rangesCover([hit.range], adoptedPlanningCoverage)) {
      // Reuse the preplanned near-domain window; shifting its start to the hit
      // would add arbitrary extra tail work on every retry/search result.
      const candidate = [...readiness.availableArtifacts.flatMap(a => a.coverage), ...candidates.flat()]
        .find(range => rangesCover([hit.range], [range]));
      if (candidate && !dependencyRanges.some(range => range.sourceId === candidate.sourceId
        && range.startCp === candidate.startCp && range.endCp === candidate.endCp)) dependencyRanges.push(candidate);
    }
  }
  const demandRef = { campaignId: input.campaignId, branchId: input.branchId, stateVersion: input.stateVersion };
  const config = await runtime.segmentConfigs.get(input.worldId, plan.executionConfigFingerprint);
  const estimatedRequestTokens = 3200 + 1500 + Math.min(config.maxOutputTokens,
    config.contentOutputTokens + config.reasoningReserveTokens);
  const admission = await readSegmentSchedulingAdmission(providerProfileFromFrozen(config), estimatedRequestTokens);
  const lifecycleAllowed = AppState.currentState === 'active' && !readiness.pauseReason;
  const latencySamplesMs: number[] = [];
  const runs = new SqliteBuildRunStore(runtime.db);
  for (const record of readiness.segments.slice(-8)) for (const runId of record.runIds) {
    for (const unit of await runs.listUnits(runId)) {
      try {
        const usage: unknown = JSON.parse(unit.usageJson ?? '{}');
        if (usage && typeof usage === 'object' && 'requestMetrics' in usage && Array.isArray(usage.requestMetrics)) {
          for (const metric of usage.requestMetrics) if (metric && typeof metric === 'object'
            && 'outcome' in metric && metric.outcome === 'completed' && 'durationMs' in metric
            && typeof metric.durationMs === 'number' && Number.isFinite(metric.durationMs) && metric.durationMs > 0)
            latencySamplesMs.push(metric.durationMs);
        }
      } catch { /* Corrupt measurements never imply a fast batch. */ }
    }
  }
  const preparation = { worldId: input.worldId, executionConfigFingerprint: plan.executionConfigFingerprint,
    currentRanges, demandRef, minBuffer: 1, maxBuffer: estimateBuildLeadTimeMs(latencySamplesMs) >= 60_000 ? 2 : 1,
    lifecycleAllowed, latencySamplesMs };
  // A submitted dependency may wait in the existing P1 queue for quota to
  // recover. Speculative P2 work is created only with current headroom.
  if (dependencyRanges.length) await runtime.segments.prepareRecent({ ...preparation, dependencyRanges,
    candidateRanges: [], budgetAllowed: admission.requestFeasible, higherPriorityPending: true });
  await runtime.segments.prepareRecent({ ...preparation, candidateRanges: candidates,
    budgetAllowed: admission.backgroundBudgetAvailable, higherPriorityPending: admission.higherPriorityPending });
  if (lifecycleAllowed) {
    const queued = await runtime.segments.dispatch(input.worldId);
    for (const segment of queued) {
      if (!admission.requestFeasible || Number(segment.intent.priority.slice(1)) >= 2 && !admission.backgroundBudgetAvailable) continue;
      for (const runId of segment.runIds) void startSegmentRun(runId).catch(async () => {
        if (!await runtime.worldStore.getWorld(input.worldId)) return;
        await runtime.segmentArtifacts.recordDiagnostic({ worldId: input.worldId, segmentId: segment.intent.segmentId,
          generation: segment.intent.generation, errors: ['execution_host_start_failed'], createdAt: new Date().toISOString() });
      });
    }
  }
  readiness = await runtime.segments.readReadiness(input);
  const adoptedIds = new Set(readiness.currentBinding?.artifactIds ?? []);
  const adoptedCoverage = readiness.availableArtifacts.filter(a => adoptedIds.has(a.artifactId)).flatMap(a => a.coverage);
  const requiredSegments = requiredBranchSegments(readiness, input);
  const pending = dependencyRanges.some(range => !rangesCover([range], adoptedCoverage))
    || requiredSegments.some(segment => !rangesCover(segment.intent.ranges, adoptedCoverage));
  const unknown = requiredSegments.some(segment => segment.lastErrorCode?.includes('outcome_unknown'));
  return { pending, message: !pending ? null : unknown
    ? '行动依赖的模型请求扣费结果未知；原行动已保留，请先在请求账本确认。'
    : readiness.pauseReason ? '行动依赖的整理已暂停；原行动已保留，恢复整理后可继续。'
    : !admission.requestFeasible ? '当前 API 配额不足以完成行动依赖；原行动已保留，请调整配额后继续。'
    : requiredSegments.some(segment => segment.status === 'needs_review') ? '行动依赖的资料需要审查；原行动已保留。'
    : '当前行动需要的资料正在准备；原行动已保留，就绪后可继续。' };
}

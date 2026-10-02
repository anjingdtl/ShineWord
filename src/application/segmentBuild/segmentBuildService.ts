import { SEGMENT_PLAN_VERSION, type BuildIntentV1, type SegmentRecordV1, type SourceRangeV1 } from '../../domain/build/phase6';
import { isBuildIntentV1 } from '../../domain/build/validation';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import type { BranchContentPortV1, BuildExecutionViewV1, BuildExecutorPortV1, SourceCatalogPortV1 } from '../ports/phase6';
import type { PublishedArtifactCatalogV1, SegmentDemandRef, SegmentDemandV1, SegmentIndexCoverageReaderV1, SegmentPauseReason, SegmentPlanStoreV1, SegmentReadinessV1 } from './types';
import { normalizePlanningRanges, planningRangesOverlap, rangesCover, referencedMembersCompatible, subtractPlanningCoverage } from './ranges';

const priorityRank = (priority: BuildIntentV1['priority']): number => Number(priority.slice(1));
const viable = (segment: SegmentRecordV1): boolean => !['stale','canceled','failed_terminal'].includes(segment.status);
export interface SegmentDemandInputV1 {
  worldId: string;
  executionConfigFingerprint: string;
  ranges: readonly SourceRangeV1[];
  reason: BuildIntentV1['reason'];
  priority?: BuildIntentV1['priority'];
  demandRef?: SegmentDemandRef;
}
export interface RecentPreparationInputV1 {
  worldId: string;
  executionConfigFingerprint: string;
  currentRanges: readonly SourceRangeV1[];
  dependencyRanges?: readonly SourceRangeV1[];
  candidateRanges?: ReadonlyArray<readonly SourceRangeV1[]>;
  demandRef?: SegmentDemandRef;
  budgetAllowed?: boolean;
  lifecycleAllowed?: boolean;
  higherPriorityPending?: boolean;
  latencySamplesMs?: readonly number[];
  expectedNeedAtMs?: number;
  minBuffer?: number;
  maxBuffer?: number;
  maxSegmentCodePoints?: number;
}

/** Planning never sends HTTP or writes canon, leases, published content, or branch state. */
export class SegmentBuildService {
  private readonly now: () => string;
  constructor(private readonly ports: {
    store: SegmentPlanStoreV1;
    catalog: SourceCatalogPortV1;
    executor: BuildExecutorPortV1;
    artifacts: PublishedArtifactCatalogV1;
    indexCoverage?: SegmentIndexCoverageReaderV1;
    branchContent?: Pick<BranchContentPortV1, 'freezeBinding'>;
    sha256Hex: Sha256HexProvider['sha256Hex'];
    now?: () => string;
  }) { this.now = ports.now ?? (() => new Date().toISOString()); }

  /** A small opening is logical coverage, not a mandatory single LLM request. */
  async ensureBootstrap(input: { worldId: string; executionConfigFingerprint: string; maxCodePoints?: number }): Promise<SegmentRecordV1> {
    const snapshot = await this.ports.catalog.snapshot(input.worldId);
    const member = [...snapshot.members].sort((a,b) => a.sourceOrdinal-b.sourceOrdinal)[0];
    if (!member || member.codePointCount < 1) throw new Error('opening_source_missing');
    const cap = boundedPositive(input.maxCodePoints ?? 3200, 3200);
    const chapter = [...member.chapters].sort((a,b) => a.startCp-b.startCp)[0];
    const end = Math.min(member.codePointCount, chapter?.endCp ?? member.codePointCount, cap);
    const range = await this.ports.catalog.createRange(member.sourceId,0,end);
    const segments = await this.requestDemand({ ...input, ranges:[range], reason:'bootstrap',priority:'P1' });
    const first = segments[0];
    if (!first) throw new Error('opening_plan_missing');
    return first;
  }

  async requestDemand(input: SegmentDemandInputV1): Promise<SegmentRecordV1[]> {
    if (!/^[a-f0-9]{64}$/i.test(input.executionConfigFingerprint)) throw new Error('invalid_execution_config_fingerprint');
    if (!['bootstrap','action_dependency','near_domain','buffer','user_full'].includes(input.reason)
      || (input.priority!==undefined && !['P0','P1','P2','P3'].includes(input.priority))) throw new Error('invalid_segment_demand');
    const ranges = await normalizePlanningRanges(this.ports.catalog,input.worldId,input.ranges);
    const snapshot = await this.ports.catalog.snapshot(input.worldId);
    const now = this.now();
    await this.ports.store.ensurePlan({ planId:`sp-${await this.hash(input.worldId)}`, worldId:input.worldId,
      planVersion:SEGMENT_PLAN_VERSION,sourceBinding:snapshot.binding, executionConfigFingerprint:input.executionConfigFingerprint,
      pauseReason:null,createdAt:now,updatedAt:now });
    // A competing planner may insert overlapping work between our read and transaction.
    // The store rejects that race; re-reading attaches to its work rather than double-building it.
    for (let attempt=0; attempt<4; attempt++) {
      const existing = (await this.ports.store.listSegments(input.worldId)).filter(segment => viable(segment)
        && segment.intent.executionConfigFingerprint === input.executionConfigFingerprint
        && referencedMembersCompatible(segment.intent.ranges,segment.intent.sourceBinding,snapshot.binding)
        && planningRangesOverlap(segment.intent.ranges,ranges));
      const records: SegmentRecordV1[] = [];
      for (const segment of existing) records.push(await this.register(segment, await this.workFingerprint(segment.intent),input));
      const missing = await subtractPlanningCoverage(this.ports.catalog,ranges,existing.flatMap(v => v.intent.ranges));
      if (!missing.length) return records;
      const intent: BuildIntentV1 = { intentId:'pending',segmentId:'pending',worldId:input.worldId,
        planVersion:SEGMENT_PLAN_VERSION,generation:1,sourceBinding:snapshot.binding,ranges:missing,
        reason:input.reason, priority: input.priority ?? priorityForReason(input.reason),
        executionConfigFingerprint:input.executionConfigFingerprint,demandRefs:input.demandRef ? [input.demandRef] : [] };
      const fingerprint = await this.workFingerprint(intent);
      intent.intentId=`bi-${fingerprint}`; intent.segmentId=`seg-${fingerprint}`;
      if (!isBuildIntentV1(intent)) throw new Error('invalid_build_intent');
      try {
        records.push(await this.register({intent,runIds:[],artifactIds:[],publishedCoverage:[],status:'planned',lastErrorCode:null,updatedAt:now},fingerprint,input));
        return records;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'segment_overlap_conflict' || attempt===3) throw error;
      }
    }
    throw new Error('segment_planning_conflict');
  }

  /** Existing executor is the sole execution writer; its ensureRun must be idempotent per intent generation. */
  async dispatch(worldId: string): Promise<SegmentRecordV1[]> {
    const plan = await this.ports.store.getPlan(worldId);
    if (!plan || plan.pauseReason) return [];
    const readiness = await this.readReadiness({worldId});
    const candidates = readiness.segments.filter(v => v.status==='planned' || (v.runIds.length>0
      && !['ready','stale','canceled','failed_terminal','needs_review','paused','failed_retryable'].includes(v.status)))
      .sort((a,b) => priorityRank(a.intent.priority)-priorityRank(b.intent.priority) || a.updatedAt.localeCompare(b.updatedAt));
    for (const segment of candidates) {
      const currentPlan=await this.ports.store.getPlan(worldId);
      if (!currentPlan || currentPlan.pauseReason) break;
      const current=(await this.ports.store.listSegments(worldId)).find(v => v.intent.segmentId===segment.intent.segmentId);
      if (!current || !viable(current) || current.status==='ready') continue;
      const result = await this.ports.executor.ensureRun(current.intent);
      if (!result.runIds.length || result.runIds.some(id => !id)) throw new Error('executor_run_missing');
      const attached=await this.ports.store.attachRuns(segment.intent.segmentId,segment.intent.generation,result.runIds,this.now());
      if (!attached) for (const runId of result.runIds) await this.ports.executor.requestControl(runId,'cancel');
    }
    return (await this.readReadiness({worldId})).segments.filter(v => candidates.some(c => c.intent.segmentId===v.intent.segmentId));
  }

  async readReadiness(input: { worldId: string; campaignId?: string; branchId?: string }): Promise<SegmentReadinessV1> {
    const plan = await this.ports.store.getPlan(input.worldId);
    const snapshot = await this.ports.catalog.snapshot(input.worldId);
    const published = await this.ports.artifacts.listPublishedArtifacts(input.worldId);
    const records = await this.ports.store.listSegments(input.worldId);
    const diagnostics: Array<{segmentId:string;code:string;retryAt:string|null}> = [];
    const projected: SegmentRecordV1[] = [];
    let executionPauseReason: SegmentPauseReason=null;
    for (const record of records) {
      const artifacts = published.filter(a => a.worldId===input.worldId && a.segmentId===record.intent.segmentId
        && a.generation===record.intent.generation && referencedMembersCompatible(a.coverage,a.sourceBinding,snapshot.binding));
      const executions: BuildExecutionViewV1[] = [];
      for (const runId of record.runIds) {
        try { executions.push(await this.ports.executor.readExecution(runId)); }
        catch { diagnostics.push({segmentId:record.intent.segmentId,code:'execution_projection_unavailable',retryAt:null}); }
      }
      let status = projectStatus(record,executions);
      let lastErrorCode = executions.find(v => v.lastErrorCode)?.lastErrorCode ?? null;
      const waiting=executions.find(v => ['waiting_network','waiting_unlock','paused_user','stopped_user','paused_system'].includes(v.status));
      if (waiting) executionPauseReason=waiting.status==='waiting_network' ? 'network' : waiting.status==='waiting_unlock' ? 'unlock'
        : waiting.status==='paused_system' ? 'system' : 'user';
      if (!lastErrorCode && waiting) lastErrorCode=waiting.status;
      if (!referencedMembersCompatible(record.intent.ranges,record.intent.sourceBinding,snapshot.binding)) {
        status='stale'; lastErrorCode='source_changed';
      } else if (executions.some(v => v.requestOutcome==='outcome_unknown')) {
        status='needs_review'; lastErrorCode='outcome_unknown';
      } else if (rangesCover(record.intent.ranges,artifacts.flatMap(v => v.coverage))) status='ready';
      else if (record.runIds.length !== executions.length) { status='failed_retryable'; lastErrorCode='execution_projection_unavailable'; }
      const segment: SegmentRecordV1 = {...record,status,lastErrorCode,artifactIds:artifacts.map(a => a.artifactId),
        publishedCoverage:dedupeRanges(artifacts.flatMap(a => a.coverage)),updatedAt:this.now()};
      const saved=await this.ports.store.saveProjection(segment);
      if (saved) projected.push(segment);
      else {
        const current=(await this.ports.store.listSegments(input.worldId)).find(v => v.intent.segmentId===segment.intent.segmentId);
        if (current) projected.push(current);
      }
      if (lastErrorCode) diagnostics.push({segmentId:segment.intent.segmentId,code:lastErrorCode,retryAt:executions.find(v => v.retryAt)?.retryAt ?? null});
    }
    const currentBinding = input.campaignId && input.branchId && this.ports.branchContent
      ? await this.ports.branchContent.freezeBinding(input.campaignId,input.branchId) : null;
    const availableArtifacts = published.filter(a => referencedMembersCompatible(a.coverage,a.sourceBinding,snapshot.binding));
    const adopted = new Set(currentBinding?.artifactIds ?? []);
    const demands = (await this.ports.store.listDemands(input.worldId)).filter(d => d.active && (!input.branchId || !d.ref
      || (d.ref.branchId===input.branchId && d.ref.campaignId===input.campaignId)));
    return { worldId:input.worldId,segments:projected,availableArtifacts,currentBinding,
      unmetDemandIds:demands.filter(d => {
        const segment=projected.find(v => v.intent.segmentId===d.segmentId && v.intent.generation===d.generation);
        return !segment || segment.status!=='ready' || Boolean(d.ref && (!currentBinding || segment.artifactIds.some(id => !adopted.has(id))));
      }).map(d => d.demandId),pauseReason:plan?.pauseReason ?? executionPauseReason,
      branchArtifacts:availableArtifacts.map(a => ({artifactId:a.artifactId,status:adopted.has(a.artifactId)?'adopted':
        currentBinding && demands.some(d => d.segmentId===a.segmentId)?'pending_adoption':'available'})),
      indexCoverage:this.ports.indexCoverage ? await this.ports.indexCoverage.readIndexCoverage(input.worldId) : [],
      executingRanges:projected.filter(v => ['extracting','mapping','validating'].includes(v.status)).flatMap(v => v.intent.ranges),
      recentCandidates:projected.filter(v => ['buffer','near_domain'].includes(v.intent.reason) && viable(v)),diagnostics };
  }

  async prepareRecent(input: RecentPreparationInputV1): Promise<SegmentRecordV1[]> {
    const plan = await this.ports.store.getPlan(input.worldId);
    if (plan?.pauseReason || input.budgetAllowed===false || input.lifecycleAllowed===false) return [];
    const created: SegmentRecordV1[] = [];
    // Real missing action dependencies are P1 and are not counted as speculative buffer.
    if (input.dependencyRanges?.length) created.push(...await this.requestDemand({...input,ranges:input.dependencyRanges,
      reason:'action_dependency',priority:'P1'}));
    if (input.higherPriorityPending) return created;
    const max = Math.min(2,boundedPositive(input.maxBuffer ?? 2,2));
    const min = Math.min(max,boundedPositive(input.minBuffer ?? 1,1));
    const readiness = await this.readReadiness({worldId:input.worldId,campaignId:input.demandRef?.campaignId,branchId:input.demandRef?.branchId});
    const adopted = new Set(readiness.currentBinding?.artifactIds ?? []);
    let buffered = readiness.recentCandidates.filter(v => v.status!=='ready' || !v.artifactIds.length || v.artifactIds.some(id => !adopted.has(id))).length;
    if (buffered >= max) return created;
    const lead = estimateBuildLeadTimeMs(input.latencySamplesMs ?? []);
    const shouldStart = buffered < min || (input.expectedNeedAtMs !== undefined && input.expectedNeedAtMs-Date.parse(this.now()) <= lead);
    if (!shouldStart || (!input.currentRanges.length && !input.candidateRanges?.length)) return created;
    const candidates = input.candidateRanges ?? await this.nearbyCandidates(input.worldId,input.currentRanges,input.maxSegmentCodePoints ?? 10000);
    for (const ranges of candidates) {
      if (buffered >= max) break;
      if (!ranges.length || readiness.segments.some(v => viable(v) && rangesCover(ranges,v.intent.ranges))) continue;
      const records = await this.requestDemand({...input,ranges,reason:buffered<min?'near_domain':'buffer',priority:'P2'});
      created.push(...records); buffered += records.filter(v => !readiness.segments.some(old => old.intent.segmentId===v.intent.segmentId)).length;
    }
    return created;
  }

  async setPause(worldId: string, reason: SegmentPauseReason): Promise<void> {
    if (!await this.ports.store.setPause(worldId,reason,this.now())) return;
    for (const segment of await this.ports.store.listSegments(worldId)) if (viable(segment) && segment.status!=='ready') {
      if (!reason && segment.lastErrorCode==='outcome_unknown') continue;
      for (const runId of segment.runIds) await this.ports.executor.requestControl(runId,reason ? 'pause' : 'resume');
    }
  }
  async resume(worldId: string): Promise<void> { await this.setPause(worldId,null); }
  async cancelDemand(demandId: string): Promise<void> { await this.ports.store.cancelDemand(demandId); }
  async findSegmentByRunId(runId: string): Promise<SegmentRecordV1 | null> { return this.ports.store.findSegmentByRunId(runId); }

  private async nearbyCandidates(worldId: string,currentRanges: readonly SourceRangeV1[], cap: number): Promise<SourceRangeV1[][]> {
    const result: SourceRangeV1[][] = [];
    const maximum=boundedPositive(cap,10000);
    // Remain in the currently referenced source/domain. Never march through unrelated volumes.
    for (const range of currentRanges) {
      const snapshot = await this.ports.catalog.snapshot(worldId);
      const member = snapshot.members.find(v => v.sourceId===range.sourceId && v.normalizedTreeHash===range.normalizedTreeHash);
      if (!member) continue;
      let cursor=range.endCp;
      for (let count=0; count<2 && cursor<member.codePointCount; count++) {
        const chapter=member.chapters.find(c => c.endCp>cursor);
        const end=Math.min(member.codePointCount,chapter?.endCp ?? member.codePointCount,cursor+maximum);
        result.push([await this.ports.catalog.createRange(range.sourceId,cursor,end)]); cursor=end;
      }
    }
    return result;
  }

  private async register(segment: SegmentRecordV1,fingerprint: string,input: SegmentDemandInputV1): Promise<SegmentRecordV1> {
    const priority=input.priority ?? priorityForReason(input.reason);
    const ref=input.demandRef ?? null;
    const demand: SegmentDemandV1 = {demandId:`sd-${await this.hash(JSON.stringify({segmentId:segment.intent.segmentId,
      generation:segment.intent.generation,ref:ref ? [ref.campaignId,ref.branchId,ref.stateVersion,ref.userCommandId ?? null] : null}))}`,worldId:input.worldId,segmentId:segment.intent.segmentId,
      generation:segment.intent.generation,ref,reason:input.reason,priority,active:true,createdAt:this.now()};
    return this.ports.store.registerDemand(segment,fingerprint,demand);
  }
  private async workFingerprint(intent: BuildIntentV1): Promise<string> {
    return this.hash(JSON.stringify({version:SEGMENT_PLAN_VERSION,worldId:intent.worldId,config:intent.executionConfigFingerprint,
      ranges:intent.ranges.map(range => ({sourceId:range.sourceId,normalizedTreeHash:range.normalizedTreeHash,startCp:range.startCp,
        endCp:range.endCp,rangeContentHash:range.rangeContentHash,sourceOrdinal:intent.sourceBinding.members.find(v => v.sourceId===range.sourceId)?.sourceOrdinal}))}));
  }
  private async hash(text: string): Promise<string> {
    const digest=await this.ports.sha256Hex(text);
    if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error('invalid_sha256_provider');
    return digest.toLowerCase();
  }
}

function boundedPositive(value: number,fallback: number): number {
  if (!Number.isSafeInteger(value) || value<1) throw new Error('invalid_segment_limit');
  return Math.min(value,Math.max(fallback,100000));
}
function priorityForReason(reason: BuildIntentV1['reason']): BuildIntentV1['priority'] {
  return reason==='bootstrap' || reason==='action_dependency' ? 'P1' : reason==='user_full' ? 'P3' : 'P2';
}
function projectStatus(record: SegmentRecordV1,views: readonly BuildExecutionViewV1[]): SegmentRecordV1['status'] {
  if (!views.length) return record.runIds.length ? 'failed_retryable' : record.status;
  if (views.some(v => v.status==='needs_review')) return 'needs_review';
  if (views.some(v => v.status==='failed_terminal')) return 'failed_terminal';
  if (views.some(v => v.status==='failed_retryable')) return 'failed_retryable';
  if (views.every(v => v.status==='canceled')) return 'canceled';
  if (views.some(v => ['paused_user','stopped_user','paused_system','waiting_network','waiting_unlock'].includes(v.status))) return 'paused';
  if (views.every(v => v.status==='completed')) return 'validating';
  if (views.some(v => ['validating','publishing'].includes(v.phase))) return 'validating';
  if (views.some(v => ['mapping','merging'].includes(v.phase))) return 'mapping';
  return 'extracting';
}
function dedupeRanges(ranges: readonly SourceRangeV1[]): SourceRangeV1[] {
  return ranges.filter((range,index) => ranges.findIndex(other => JSON.stringify(range)===JSON.stringify(other))===index);
}
/** With few observations, retain a conservative bound; one fast response cannot enlarge the pipeline. */
export function estimateBuildLeadTimeMs(samples: readonly number[], conservativeMs=120000): number {
  const valid=samples.filter(v => Number.isFinite(v) && v>0).sort((a,b) => a-b);
  if (valid.length<5) return Math.max(conservativeMs,...valid);
  return valid[Math.min(valid.length-1,Math.ceil(valid.length*0.9)-1)] ?? conservativeMs;
}

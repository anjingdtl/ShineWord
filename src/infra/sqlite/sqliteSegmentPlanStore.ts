import type { SqliteDatabase, SqliteRow, SqliteTransaction } from '../../application/ports/sqlite';
import type { SegmentDemandV1, SegmentPauseReason, SegmentPlanStoreV1, SegmentPlanV1 } from '../../application/segmentBuild/types';
import { planningRangesOverlap } from '../../application/segmentBuild/ranges';
import type { BuildIntentV1, SegmentRecordV1, SegmentStatusV1, SourceRangeV1 } from '../../domain/build/phase6';
import { isBuildIntentV1, isSourceRangeV1, isSourceSetBindingV1 } from '../../domain/build/validation';

interface PlanRow extends SqliteRow {
  plan_id:string; world_id:string; plan_version:string; source_binding_json:string;
  execution_config_fingerprint:string; pause_reason:string|null; created_at:string; updated_at:string;
}
interface SegmentRow extends SqliteRow {
  segment_id:string; world_id:string; generation:number; work_fingerprint:string; intent_json:string;
  run_ids_json:string; artifact_ids_json:string; published_coverage_json:string; status:string; last_error_code:string|null; updated_at:string;
}
interface DemandRow extends SqliteRow {
  demand_id:string; world_id:string; segment_id:string; generation:number; ref_json:string|null;
  reason:string; priority:string; active:number; created_at:string;
}
const statuses: readonly string[]=['planned','extracting','mapping','validating','ready','needs_review','paused','failed_retryable','failed_terminal','canceled','stale'];

export class SqliteSegmentPlanStore implements SegmentPlanStoreV1 {
  constructor(private readonly db: SqliteDatabase) {}
  async ensurePlan(plan: SegmentPlanV1): Promise<SegmentPlanV1> {
    if (plan.planVersion!=='segment-plan-1' || !isSourceSetBindingV1(plan.sourceBinding)) throw new Error('invalid_segment_plan');
    await this.db.execute(`INSERT INTO world_segment_plans
      (plan_id,world_id,plan_version,source_binding_json,execution_config_fingerprint,pause_reason,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(world_id) DO UPDATE SET
      source_binding_json=excluded.source_binding_json, execution_config_fingerprint=excluded.execution_config_fingerprint,updated_at=excluded.updated_at`,
      [plan.planId,plan.worldId,plan.planVersion,JSON.stringify(plan.sourceBinding),plan.executionConfigFingerprint,plan.pauseReason,plan.createdAt,plan.updatedAt]);
    const persisted=await this.getPlan(plan.worldId);
    if (!persisted) throw new Error('segment_plan_deleted');
    return persisted;
  }
  async getPlan(worldId:string): Promise<SegmentPlanV1|null> {
    const row=await this.db.queryOne<PlanRow>('SELECT * FROM world_segment_plans WHERE world_id=?',[worldId]);
    if (!row) return null;
    const sourceBinding:unknown=JSON.parse(row.source_binding_json);
    if (row.plan_version!=='segment-plan-1' || !isSourceSetBindingV1(sourceBinding)
      || (row.pause_reason!==null && !['user','system','budget','network','unlock'].includes(row.pause_reason))) throw new Error('invalid_persisted_segment_plan');
    return {planId:row.plan_id,worldId:row.world_id,planVersion:'segment-plan-1',sourceBinding,
      executionConfigFingerprint:row.execution_config_fingerprint,pauseReason:row.pause_reason as SegmentPauseReason,createdAt:row.created_at,updatedAt:row.updated_at};
  }
  async listSegments(worldId:string): Promise<SegmentRecordV1[]> {
    return (await this.db.queryAll<SegmentRow>('SELECT * FROM world_segments WHERE world_id=? ORDER BY updated_at,segment_id',[worldId])).map(fromRow);
  }
  async findSegmentByRunId(runId:string):Promise<SegmentRecordV1|null> {
    // Android SQLite JSON1 is optional; the only lookup author remains M3.
    const rows=await this.db.queryAll<SegmentRow>("SELECT * FROM world_segments WHERE run_ids_json<>'[]' ORDER BY updated_at DESC");
    return rows.map(fromRow).find(segment => segment.runIds.includes(runId)) ?? null;
  }
  async registerDemand(segment:SegmentRecordV1,fingerprint:string,demand:SegmentDemandV1): Promise<SegmentRecordV1> {
    if (!isBuildIntentV1(segment.intent) || !/^[a-f0-9]{64}$/i.test(fingerprint)) throw new Error('invalid_segment_record');
    if (!['bootstrap','action_dependency','near_domain','buffer','user_full'].includes(demand.reason) || !['P0','P1','P2','P3'].includes(demand.priority)
      || (demand.ref!==null && !validRef(demand.ref))) throw new Error('invalid_segment_demand');
    if (demand.worldId!==segment.intent.worldId || demand.segmentId!==segment.intent.segmentId || demand.generation!==segment.intent.generation) throw new Error('demand_segment_mismatch');
    return this.db.transaction(async tx => {
      let row=await tx.queryOne<SegmentRow>('SELECT * FROM world_segments WHERE world_id=? AND work_fingerprint=?',[segment.intent.worldId,fingerprint]);
      if (!row) {
        const others=await tx.queryAll<SegmentRow>("SELECT * FROM world_segments WHERE world_id=? AND status NOT IN ('stale','canceled','failed_terminal')",[segment.intent.worldId]);
        if (others.map(fromRow).some(v => v.intent.executionConfigFingerprint===segment.intent.executionConfigFingerprint
          && planningRangesOverlap(v.intent.ranges,segment.intent.ranges))) throw new Error('segment_overlap_conflict');
        await tx.execute(`INSERT INTO world_segments
          (segment_id,world_id,generation,work_fingerprint,intent_json,run_ids_json,artifact_ids_json,published_coverage_json,status,last_error_code,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[segment.intent.segmentId,segment.intent.worldId,segment.intent.generation,fingerprint,
          JSON.stringify(segment.intent),JSON.stringify(segment.runIds),JSON.stringify(segment.artifactIds),JSON.stringify(segment.publishedCoverage),segment.status,segment.lastErrorCode,segment.updatedAt]);
        row=await tx.queryOne<SegmentRow>('SELECT * FROM world_segments WHERE segment_id=?',[segment.intent.segmentId]);
      }
      if (!row) throw new Error('segment_deleted');
      const current=fromRow(row);
      if (current.intent.generation!==demand.generation) throw new Error('segment_generation_changed');
      await tx.execute(`INSERT INTO segment_demands
        (demand_id,world_id,segment_id,generation,ref_json,reason,priority,active,created_at) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(demand_id) DO UPDATE SET active=1,priority=MIN(segment_demands.priority,excluded.priority),
        reason=CASE WHEN excluded.priority<segment_demands.priority THEN excluded.reason ELSE segment_demands.reason END`,
        [demand.demandId,demand.worldId,current.intent.segmentId,demand.generation,demand.ref ? JSON.stringify(demand.ref) : null,demand.reason,demand.priority,1,demand.createdAt]);
      const refs=[...current.intent.demandRefs];
      if (demand.ref && !refs.some(v => refKey(v)===refKey(demand.ref!))) refs.push(demand.ref);
      const promoted=demand.priority<current.intent.priority;
      const intent:BuildIntentV1={...current.intent,demandRefs:refs,priority:promoted?demand.priority:current.intent.priority,
        reason:promoted?demand.reason:current.intent.reason};
      await tx.execute('UPDATE world_segments SET intent_json=?,updated_at=? WHERE segment_id=? AND generation=?',
        [JSON.stringify(intent),segment.updatedAt,current.intent.segmentId,current.intent.generation]);
      const canRevive=current.status==='canceled' && current.runIds.length===0 && current.artifactIds.length===0;
      if (canRevive) await tx.execute("UPDATE world_segments SET status='planned' WHERE segment_id=? AND generation=?",[current.intent.segmentId,current.intent.generation]);
      return {...current,intent,status:canRevive ? 'planned' : current.status};
    });
  }
  async saveProjection(segment:SegmentRecordV1): Promise<boolean> {
    if (!statuses.includes(segment.status) || !segment.publishedCoverage.every(isSourceRangeV1)) throw new Error('invalid_segment_projection');
    // Do not overwrite intent metadata that another demand may have promoted since the read.
    return (await this.db.execute(`UPDATE world_segments SET artifact_ids_json=?,published_coverage_json=?,status=?,last_error_code=?,updated_at=?
      WHERE segment_id=? AND generation=? AND (status NOT IN ('canceled','stale') OR status=?)`,[JSON.stringify(segment.artifactIds),JSON.stringify(segment.publishedCoverage),segment.status,
      segment.lastErrorCode,segment.updatedAt,segment.intent.segmentId,segment.intent.generation,segment.status]))>0;
  }
  async attachRuns(segmentId:string,generation:number,runIds:readonly string[],now:string): Promise<boolean> {
    return this.db.transaction(async tx => {
      const row=await tx.queryOne<SegmentRow>('SELECT * FROM world_segments WHERE segment_id=? AND generation=?',[segmentId,generation]);
      if (!row) return false;
      const current=fromRow(row);
      if (['stale','canceled'].includes(current.status)) return false;
      const merged=[...new Set([...current.runIds,...runIds])];
      return (await tx.execute('UPDATE world_segments SET run_ids_json=?,updated_at=? WHERE segment_id=? AND generation=?',
        [JSON.stringify(merged),now,segmentId,generation]))>0;
    });
  }
  async listDemands(worldId:string): Promise<SegmentDemandV1[]> {
    const rows=await this.db.queryAll<DemandRow>('SELECT * FROM segment_demands WHERE world_id=? ORDER BY created_at,demand_id',[worldId]);
    return rows.map(row => {
      const ref:unknown=row.ref_json ? JSON.parse(row.ref_json) : null;
      if (ref!==null && !validRef(ref)) throw new Error('invalid_persisted_segment_demand');
      if (!['bootstrap','action_dependency','near_domain','buffer','user_full'].includes(row.reason) || !['P0','P1','P2','P3'].includes(row.priority)) throw new Error('invalid_persisted_segment_demand');
      return {demandId:row.demand_id,worldId:row.world_id,segmentId:row.segment_id,generation:row.generation,ref,
        reason:row.reason as SegmentDemandV1['reason'],priority:row.priority as SegmentDemandV1['priority'],active:row.active===1,createdAt:row.created_at};
    });
  }
  async setPause(worldId:string,reason:SegmentPauseReason,now:string): Promise<boolean> {
    return (await this.db.execute('UPDATE world_segment_plans SET pause_reason=?,updated_at=? WHERE world_id=?',[reason,now,worldId]))>0;
  }
  async cancelDemand(demandId:string): Promise<void> {
    await this.db.transaction(async tx => {
      const demand=await tx.queryOne<DemandRow>('SELECT * FROM segment_demands WHERE demand_id=?',[demandId]);
      if (!demand) return;
      await tx.execute('UPDATE segment_demands SET active=0 WHERE demand_id=?',[demandId]);
      const row=await tx.queryOne<SegmentRow>('SELECT * FROM world_segments WHERE segment_id=?',[demand.segment_id]);
      if (row) {
        const current=fromRow(row);
        const active=await tx.queryAll<DemandRow>('SELECT * FROM segment_demands WHERE segment_id=? AND active=1',[demand.segment_id]);
        const refs=active.flatMap(d=>d.ref_json ? [JSON.parse(d.ref_json) as BuildIntentV1['demandRefs'][number]] : []);
        const intent={...current.intent,demandRefs:refs.filter((ref,index)=>refs.findIndex(r=>refKey(r)===refKey(ref))===index)};
        await tx.execute('UPDATE world_segments SET intent_json=? WHERE segment_id=?',[JSON.stringify(intent),demand.segment_id]);
      }
      await cancelUnneededPlanned(tx,demand.segment_id);
    });
  }
}

function fromRow(row:SegmentRow):SegmentRecordV1 {
  const intent:unknown=JSON.parse(row.intent_json);
  const runs:unknown=JSON.parse(row.run_ids_json), artifacts:unknown=JSON.parse(row.artifact_ids_json),coverage:unknown=JSON.parse(row.published_coverage_json);
  if (!isBuildIntentV1(intent) || intent.segmentId!==row.segment_id || intent.worldId!==row.world_id || intent.generation!==row.generation
    || !isStrings(runs) || !isStrings(artifacts) || !Array.isArray(coverage) || !coverage.every(isSourceRangeV1) || !statuses.includes(row.status)) throw new Error('invalid_persisted_segment');
  return {intent,runIds:runs,artifactIds:artifacts,publishedCoverage:coverage as SourceRangeV1[],status:row.status as SegmentStatusV1,lastErrorCode:row.last_error_code,updatedAt:row.updated_at};
}
function isStrings(value:unknown):value is string[] {return Array.isArray(value) && value.every(v => typeof v==='string' && v.length>0);}
function validRef(value:unknown):value is BuildIntentV1['demandRefs'][number] {
  if (typeof value!=='object' || value===null) return false;
  const v=value as Record<string,unknown>;
  return typeof v.campaignId==='string' && v.campaignId.length>0 && typeof v.branchId==='string' && v.branchId.length>0
    && Number.isSafeInteger(v.stateVersion) && Number(v.stateVersion)>=0 && (v.userCommandId===undefined || typeof v.userCommandId==='string');
}
function refKey(ref:BuildIntentV1['demandRefs'][number]):string {return JSON.stringify([ref.campaignId,ref.branchId,ref.stateVersion,ref.userCommandId ?? null]);}
async function cancelUnneededPlanned(tx:SqliteTransaction,segmentId:string):Promise<void> {
  await tx.execute(`UPDATE world_segments SET status='canceled' WHERE segment_id=? AND status='planned' AND run_ids_json='[]'
    AND NOT EXISTS (SELECT 1 FROM segment_demands WHERE segment_id=? AND active=1)`,[segmentId,segmentId]);
}

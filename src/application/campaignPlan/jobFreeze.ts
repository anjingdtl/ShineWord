import type { SqliteDatabase } from '../ports/sqlite';
import type { ApiProfile } from '../llm/types';
import type { CampaignIntentV1 } from '../../domain/campaignPlan/types';
import type { LocalCompileContext } from './localCompile';
import type { PlanRequestMaterials } from './generationService';
import { sha256HexOf } from './hashing';

export const CAMPAIGN_PLAN_FREEZE_SCHEMA = 'campaign-plan-freeze-2';
export interface FrozenPlanJob {
  schema: typeof CAMPAIGN_PLAN_FREEZE_SCHEMA;
  intent: CampaignIntentV1;
  profile: ApiProfile;
  materials: PlanRequestMaterials;
  basePlan?: import('../../domain/campaignPlan/types').CampaignPlanV1;
  baseState?: import('../../domain/state/types').GameStateSnapshot;
  context: Omit<LocalCompileContext, 'openingActorIds' | 'openingTemplateIds' | 'protagonistSkills' | 'availableFactIds'> & {
    openingActorIds: string[]; openingTemplateIds: string[]; protagonistSkills: string[]; availableFactIds: string[];
  };
}
export function frozenPlanJob(intent: CampaignIntentV1, profile: ApiProfile, materials: PlanRequestMaterials, ctx: LocalCompileContext): FrozenPlanJob {
  return { schema: CAMPAIGN_PLAN_FREEZE_SCHEMA, intent, profile, materials,
    context: { ...ctx, openingActorIds: [...ctx.openingActorIds], openingTemplateIds: [...ctx.openingTemplateIds],
      protagonistSkills: [...ctx.protagonistSkills], availableFactIds: [...ctx.availableFactIds] } };
}
export function thawPlanContext(frozen: FrozenPlanJob): LocalCompileContext {
  return { ...frozen.context, openingActorIds: new Set(frozen.context.openingActorIds),
    openingTemplateIds: new Set(frozen.context.openingTemplateIds), protagonistSkills: new Set(frozen.context.protagonistSkills),
    availableFactIds: new Set(frozen.context.availableFactIds) };
}
export async function readPlanFreeze(db: SqliteDatabase, jobId: string): Promise<FrozenPlanJob | null> {
  const row = await db.queryOne<{ payload_json: string; content_hash: string }>(
    'SELECT payload_json,content_hash FROM frozen_turn_material_roots WHERE root_id=?', [`campaign-job:${jobId}`]);
  if (!row) {
    const legacy = await db.queryOne('SELECT root_id FROM frozen_turn_material_roots WHERE turn_id=? AND stage=\'plan\' LIMIT 1', [jobId]);
    if (legacy) throw Object.assign(new Error('规划冻结协议已变更；保留旧材料，请新建关联规划，不自动重发。'), { name: 'FrozenMaterialsCorruptedError' });
    return null;
  }
  try {
    if (sha256HexOf(row.payload_json) !== row.content_hash) throw new Error('hash mismatch');
    const frozen = JSON.parse(row.payload_json) as FrozenPlanJob;
    if (frozen.schema !== CAMPAIGN_PLAN_FREEZE_SCHEMA || !frozen.context || !frozen.intent || !frozen.profile
      || typeof frozen.materials?.system !== 'string' || typeof frozen.materials?.user !== 'string') throw new Error('invalid envelope');
    for (const key of ['openingActorIds','openingTemplateIds','protagonistSkills','availableFactIds'] as const) {
      if (!Array.isArray(frozen.context[key])) throw new Error('invalid context');
    }
    return frozen;
  } catch {
    const error = new Error('规划冻结材料损坏；已保留原信封，停止请求。');
    error.name = 'FrozenMaterialsCorruptedError';
    throw error;
  }
}
export async function writePlanFreeze(db: SqliteDatabase, jobId: string, setupId: string, frozen: FrozenPlanJob, now: string): Promise<void> {
  const payload = JSON.stringify(frozen);
  await db.execute(`INSERT INTO frozen_turn_material_roots
    (root_id,campaign_id,branch_id,turn_id,logical_request_id,role,stage,attempt,payload_json,content_hash,created_at)
    VALUES (?,?,?,?,?,'WorldMapper','plan',1,?,?,?) ON CONFLICT(root_id) DO NOTHING`,
    [`campaign-job:${jobId}`, `setup:${setupId}`, setupId, jobId, `campaign-plan:${jobId}`, payload, sha256HexOf(payload), now]);
}

import type { SqliteDatabase } from '../ports/sqlite';
import type { CampaignContentArtifactV1 } from '../../domain/campaignPlan/types';
import { validateCampaignClues } from '../../domain/campaignPlan/clues';
import { canonicalJsonOf, sha256HexOf } from './hashing';
import { campaignContentBindingHash } from './contentBinding';
import { campaignContentEntries } from './contentResolver';

/** Shared snapshot-bound archive reader for planning, rules and projections. */
export async function readBoundCampaignArtifacts(db: SqliteDatabase, campaignId: string,
  binding: { artifactIds: readonly string[]; contentHash?: string }): Promise<CampaignContentArtifactV1[]> {
  if (new Set(binding.artifactIds).size !== binding.artifactIds.length) throw new Error('战役内容绑定包含重复档案，拒绝继续。');
  const artifacts: CampaignContentArtifactV1[] = [];
  for (const artifactId of binding.artifactIds) {
    const row = await db.queryOne<{ artifact_json: string; content_hash: string }>(
      'SELECT artifact_json,content_hash FROM campaign_content_artifacts WHERE artifact_id=?', [artifactId]);
    if (!row) throw new Error(`战役内容 ${artifactId} 缺失，拒绝以不完整内容继续。`);
    const artifact = JSON.parse(row.artifact_json) as CampaignContentArtifactV1;
    const { contentHash, ...body } = artifact;
    if (artifact.campaignId !== campaignId || artifact.artifactId !== artifactId || row.content_hash !== contentHash
      || contentHash !== sha256HexOf(canonicalJsonOf(body))) throw new Error(`战役内容 ${artifactId} 哈希不符，拒绝继续。`);
    const errors = validateCampaignClues(artifact);
    if (errors.length) throw new Error(errors.join('; '));
    artifacts.push(artifact);
  }
  if (binding.contentHash !== undefined && campaignContentBindingHash(artifacts) !== binding.contentHash) {
    throw new Error('战役内容组合 hash 不匹配，拒绝继续。');
  }
  campaignContentEntries(artifacts); // campaign dependencies must be in this exact binding
  return artifacts;
}

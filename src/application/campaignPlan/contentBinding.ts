import type { CampaignContentArtifactV1 } from '../../domain/campaignPlan/types';
import { canonicalJsonOf, sha256HexOf } from './hashing';

/** Each archive has its own hash; a branch may compose several revisions. */
export function campaignContentBindingHash(artifacts: readonly CampaignContentArtifactV1[]): string {
  if (artifacts.length === 1) return artifacts[0]!.contentHash;
  return sha256HexOf(canonicalJsonOf(artifacts.map(a => ({ artifactId: a.artifactId, contentHash: a.contentHash }))
    .sort((a, b) => a.artifactId.localeCompare(b.artifactId))));
}

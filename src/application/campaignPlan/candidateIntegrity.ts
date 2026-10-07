import type { CampaignPlanCandidateRecord } from '../../infra/sqlite/sqliteCampaignPlanStore';
import { canonicalJsonOf, sha256HexOf } from './hashing';

/** A persisted ready flag alone is insufficient after process recovery. */
export function isIntactReadyCandidate(candidate: CampaignPlanCandidateRecord | null): candidate is CampaignPlanCandidateRecord & {
  plan: NonNullable<CampaignPlanCandidateRecord['plan']>; artifact: NonNullable<CampaignPlanCandidateRecord['artifact']>;
} {
  if (!candidate || candidate.stage !== 'ready' || !candidate.plan || !candidate.artifact
    || candidate.validationErrors.length || !candidate.plan.nodes?.length || !candidate.plan.startNodeIds?.length
    || !candidate.artifact.situations?.length) return false;
  const { contentHash: planHash, ...planBody } = candidate.plan;
  const { contentHash: artifactHash, ...artifactBody } = candidate.artifact;
  return planHash === sha256HexOf(canonicalJsonOf(planBody))
    && artifactHash === sha256HexOf(canonicalJsonOf(artifactBody))
    && candidate.candidateHash === sha256HexOf(canonicalJsonOf({ plan: candidate.plan, artifact: candidate.artifact }));
}

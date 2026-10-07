import type { SqliteDatabase } from '../ports/sqlite';
import type { SqliteCampaignPlanStore, CampaignPlanCandidateRecord } from '../../infra/sqlite/sqliteCampaignPlanStore';
import { createCampaign, type CreateCampaignInput, type CreatedCampaign } from '../campaign/createCampaign';
import { sha256HexOf, canonicalJsonOf } from './hashing';
import { isIntactReadyCandidate } from './candidateIntegrity';

/**
 * Atomic opening adoption (plan §6.4): the validated candidate becomes a
 * campaign in ONE transaction. Same setupId + candidateHash creates at most
 * one campaign — repeated "start adventure" clicks are idempotent and return
 * the original result (A09).
 */

export interface AdoptOpeningPlanInput {
  db: SqliteDatabase;
  planStore: SqliteCampaignPlanStore;
  setupId: string;
  candidateId: string;
  create: Omit<CreateCampaignInput, 'adoption'>;
}

export interface AdoptOpeningPlanResult {
  outcome: 'created' | 'already_exists';
  campaign: CreatedCampaign;
}

export async function adoptOpeningPlan(input: AdoptOpeningPlanInput): Promise<AdoptOpeningPlanResult> {
  const setup = await input.planStore.getSetup(input.setupId);
  if (!setup) throw new Error(`Unknown setup: ${input.setupId}.`);
  const candidate: CampaignPlanCandidateRecord | null = await input.planStore.getCandidate(input.candidateId);
  if (!isIntactReadyCandidate(candidate)) {
    throw new Error(`Candidate ${input.candidateId} is not ready; only a validated proposal can start a campaign.`);
  }
  if (setup.currentCandidateId !== input.candidateId) {
    throw new Error('The ready proposal is no longer current — regenerate after editing intent/protagonist/anchor.');
  }
  // Pre-transaction re-verification (plan §6.4): hash + bindings must match.
  const recomputed = sha256HexOf(JSON.stringify({ plan: candidate.plan, artifact: candidate.artifact }, (_key, value) =>
    value === undefined ? undefined : value));
  if (recomputed !== candidate.candidateHash && canonicalHash(candidate.plan, candidate.artifact) !== candidate.candidateHash) {
    throw new Error('Candidate hash mismatch — refusing to adopt a tampered proposal.');
  }
  if (candidate.plan.baseWorldBinding.worldId !== input.create.worldId
    || candidate.plan.baseWorldBinding.packageRevision !== input.create.packageRevision) {
    throw new Error('Candidate world binding differs from the requested campaign.');
  }
  if (setup.intent.openingAnchor.worldTimeOrder !== input.create.anchor.worldTimeOrder
    || setup.intent.openingAnchor.locationId !== input.create.anchor.locationId
    || setup.intent.openingAnchor.anchorEventId !== input.create.anchor.anchorEventId
    || setup.intent.protagonistBinding.actorId !== input.create.protagonist.actorId
    || setup.intent.protagonistBinding.kind !== input.create.protagonist.kind
    || setup.intent.protagonistBinding.name !== input.create.protagonist.name
    || setup.intent.protagonistBinding.canonEntityId !== input.create.protagonist.canonEntityId
    || (setup.intent.protagonistBinding.attributes !== undefined && canonicalJsonOf(setup.intent.protagonistBinding.attributes) !== canonicalJsonOf(input.create.protagonist.attributes))
    || (setup.intent.protagonistBinding.initialSkills !== undefined && canonicalJsonOf(setup.intent.protagonistBinding.initialSkills) !== canonicalJsonOf(input.create.protagonist.initialSkills ?? []))
    || (setup.intent.protagonistBinding.description !== undefined && setup.intent.protagonistBinding.description !== input.create.protagonist.description)
    || sha256HexOf(canonicalJsonOf(setup.intent)) !== candidate.plan.intentHash
    || canonicalJsonOf(setup.intent.companionBindings) !== canonicalJsonOf(input.create.companions ?? [])) {
    throw new Error('Setup anchor/protagonist drifted from the candidate — regenerate the proposal.');
  }

  // Idempotent replay: same setup already adopted → return the existing campaign.
  const adoptedRow = await input.db.queryOne<{ campaign_id: string }>(
    'SELECT campaign_id FROM campaign_plan_revisions WHERE setup_id=? AND source_trigger=? LIMIT 1',
    [input.setupId, 'opening_adoption']);
  if (adoptedRow) {
    const branchId = `${adoptedRow.campaign_id}-main`;
    const snapshotRow = await input.db.queryOne<{ snapshot_json: string }>(
      'SELECT snapshot_json FROM snapshots WHERE branch_id=? ORDER BY state_version ASC LIMIT 1', [branchId]);
    if (snapshotRow) {
      return {
        outcome: 'already_exists',
        campaign: {
          campaignId: adoptedRow.campaign_id,
          branchId,
          snapshot: JSON.parse(snapshotRow.snapshot_json),
          cards: [],
        },
      };
    }
  }

  const { contentHash: _artifactHash, ...artifactBody } = candidate.artifact;
  const reboundArtifact = { ...artifactBody, campaignId: input.create.campaignId };
  const created = await createCampaign({
    ...input.create,
    goal: candidate.plan.longTermGoal,
    adoption: {
      planStore: input.planStore,
      plan: candidate.plan,
      intent: setup.intent,
      artifact: { ...reboundArtifact, contentHash: sha256HexOf(canonicalJsonOf(reboundArtifact)) },
      sourceTrigger: 'opening_adoption',
      guard: async tx => {
        const row = await tx.queryOne<{ intent_json: string; status: string; current_candidate_id: string }>(
          'SELECT intent_json,status,current_candidate_id FROM campaign_setups WHERE setup_id=?', [input.setupId]);
        if (!row || row.status !== 'proposal_ready' || row.current_candidate_id !== input.candidateId
          || sha256HexOf(canonicalJsonOf(JSON.parse(row.intent_json))) !== candidate.plan!.intentHash) {
          throw new Error('Setup changed or was adopted before this transaction.');
        }
        await tx.execute("UPDATE campaign_setups SET status='adopted',updated_at=? WHERE setup_id=?", [input.create.createdAt, input.setupId]);
        await tx.execute("UPDATE campaign_plan_jobs SET status='adopted',updated_at=? WHERE setup_id=? AND status='candidate_ready'", [input.create.createdAt, input.setupId]);
      },
    },
  });
  return { outcome: 'created', campaign: created };
}

function canonicalHash(plan: unknown, artifact: unknown): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
        .map(key => [key, sort((value as Record<string, unknown>)[key])]));
    }
    return value;
  };
  return sha256HexOf(JSON.stringify(sort({ plan, artifact })));
}

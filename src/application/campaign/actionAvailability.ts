import type { CampaignStatus } from '../../domain/campaignPlan/types';

/**
 * Legacy campaigns without a campaign runtime keep their existing play path.
 * A runtime campaign accepts new player turns only while it is active.
 */
export function canSubmitCampaignAction(status: CampaignStatus | null | undefined): boolean {
  return status == null || status === 'active';
}

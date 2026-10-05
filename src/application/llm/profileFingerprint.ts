import type { ApiProfile } from './types';
import { reasoningDialectForModel } from './reasoningPolicy';
import { stableFingerprint } from './requestPlan';

/** Stable calibration identity for one configured provider/model profile.
 * Endpoint values are hashed before they reach persistent ledger metadata. */
export function llmModelProfileFingerprint(profile: Pick<
  ApiProfile,
  'id' | 'endpoint' | 'model' | 'capabilities' | 'reasoningDialect'
>): string {
  return stableFingerprint({
    profileId: profile.id,
    endpointFingerprint: stableFingerprint(profile.endpoint),
    model: profile.model,
    contextWindow: profile.capabilities?.contextWindow ?? null,
    maxOutputTokens: profile.capabilities?.maxOutputTokens ?? null,
    reasoningDialect: profile.reasoningDialect ?? reasoningDialectForModel(profile.model),
  });
}

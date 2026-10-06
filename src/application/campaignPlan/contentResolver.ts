import type { ContentEntry } from '../../domain/content/types';
import type { CampaignContentArtifactV1 } from '../../domain/campaignPlan/types';

/**
 * Unified read-only content resolution (plan §7): world published entries +
 * the branch's adopted campaign artifacts compose ONE entry list consumed by
 * the turn session, rules and projections. Campaign content lives in its own
 * namespace (`camp-` prefix / artifact binding) and never writes back into
 * world canon; world entry ids always win on collision.
 */

export function campaignSituationEntries(artifact: CampaignContentArtifactV1): ContentEntry[] {
  return artifact.situations.map(situation => ({
    entryId: situation.entryId,
    kind: 'situation' as const,
    revision: artifact.planRevision,
    provenance: {
      kind: 'design_fill' as const,
      sourceFactIds: [],
      rationale: `战役内容 ${artifact.artifactId}：主线局面，不属于世界原著。`,
    },
    fieldProvenance: {},
    visibility: 'gm' as const,
    dependencyIds: [...artifact.dependencies.worldEntryIds].filter(id => id !== situation.entryId),
    definition: situation.definition,
  }));
}

export function resolveCampaignContent(
  worldEntries: readonly ContentEntry[],
  artifacts: readonly CampaignContentArtifactV1[],
): ContentEntry[] {
  const worldIds = new Set(worldEntries.map(entry => entry.entryId));
  const merged = [...worldEntries];
  for (const artifact of artifacts) {
    for (const entry of campaignSituationEntries(artifact)) {
      if (worldIds.has(entry.entryId)) continue; // world canon wins; never shadow
      if (merged.some(existing => existing.entryId === entry.entryId)) continue;
      merged.push(entry);
    }
  }
  return merged;
}

/** Campaign methods offered to a turn, keyed for the compile path. */
export function campaignMethodsForTurn(
  artifacts: readonly CampaignContentArtifactV1[],
  activeSituationIds: ReadonlySet<string>,
): Array<{ situationId: string; method: import('../../domain/situations/types').MethodTemplateV1 }> {
  const out: Array<{ situationId: string; method: import('../../domain/situations/types').MethodTemplateV1 }> = [];
  for (const artifact of artifacts) {
    for (const situation of artifact.situations) {
      if (activeSituationIds.size > 0 && !activeSituationIds.has(situation.entryId)) continue;
      for (const method of situation.definition.methods ?? []) {
        out.push({ situationId: situation.entryId, method });
      }
    }
  }
  return out;
}

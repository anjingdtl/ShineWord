import type { ContentEntry } from '../../domain/content/types';
import type { CampaignContentArtifactV1, CampaignRuntimeV1 } from '../../domain/campaignPlan/types';
import type { SituationDefinitionV1 } from '../../domain/situations/types';

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

/**
 * The archive remains the complete authority catalog for frozen contracts,
 * history, promises and deferred consequences. Player affordances are a
 * separate read projection of that catalog at the supplied runtime boundary.
 * An event can finish a node without resolving its situation: situation.active
 * alone must never resurrect that node's methods, opportunities or pressure.
 * Guidance and compilation consume this SAME projection; post-turn callers
 * supply the prepared runtime, not the pre-turn runtime.
 */
export function projectPlayableSituations<T extends { situationId: string; definition: SituationDefinitionV1 }>(
  definitions: readonly T[], artifacts: readonly CampaignContentArtifactV1[], runtime?: CampaignRuntimeV1,
): T[] {
  if (!runtime) return [...definitions];
  const ended = ['completed', 'failed', 'ended'].includes(runtime.campaignStatus);
  const closedNodes = new Set(runtime.nodeStates
    .filter(node => ['succeeded', 'failed', 'superseded', 'cancelled'].includes(node.status))
    .map(node => node.nodeId));
  const retiredSituations = new Set(artifacts.flatMap(artifact => artifact.situations
    .filter(situation => ended || closedNodes.has(situation.nodeId)).map(situation => situation.entryId)));
  return definitions.filter(situation => !retiredSituations.has(situation.situationId));
}

/** Campaign methods offered to a turn, keyed for the compile path. */
export function campaignMethodsForTurn(
  artifacts: readonly CampaignContentArtifactV1[],
  activeSituationIds: ReadonlySet<string>,
  runtime?: CampaignRuntimeV1,
): Array<{ situationId: string; method: import('../../domain/situations/types').MethodTemplateV1 }> {
  const out: Array<{ situationId: string; method: import('../../domain/situations/types').MethodTemplateV1 }> = [];
  const definitions = artifacts.flatMap(artifact => artifact.situations.map(situation => ({
    situationId: situation.entryId, definition: situation.definition,
  })));
  for (const situation of projectPlayableSituations(definitions, artifacts, runtime)) {
    if (activeSituationIds.size > 0 && !activeSituationIds.has(situation.situationId)) continue;
    for (const method of situation.definition.methods ?? []) {
      out.push({ situationId: situation.situationId, method });
    }
  }
  return out;
}

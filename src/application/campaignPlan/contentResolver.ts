import type { ContentEntry } from '../../domain/content/types';
import type { CampaignContentArtifactV1, CampaignRuntimeV1 } from '../../domain/campaignPlan/types';
import type { SituationDefinitionV1 } from '../../domain/situations/types';
import { validateCampaignClues } from '../../domain/campaignPlan/clues';

/**
 * Unified read-only content resolution (plan §7): world published entries +
 * the branch's adopted campaign artifacts compose ONE entry list consumed by
 * the turn session, rules and projections. Campaign content lives in its own
 * namespace and never writes back into world canon. Ownership comes from
 * the verified snapshot binding; an id prefix alone grants no authority.
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

export function campaignClueEntries(artifact: CampaignContentArtifactV1): ContentEntry[] {
  const errors = validateCampaignClues(artifact);
  if (errors.length) throw new Error(errors.join('; '));
  return (artifact.clues ?? []).map(clue => ({ entryId: clue.entryId, kind: 'lore', revision: artifact.planRevision,
    visibility: 'discoverable', provenance: { kind: clue.provenance.kind === 'canon_inspired' ? 'inferred' : 'design_fill',
      sourceFactIds: [...clue.provenance.sourceFactIds], rationale: clue.provenance.rationale },
    fieldProvenance: {}, dependencyIds: [...clue.dependencyIds], definition: clue.definition }));
}

export function campaignContentEntries(artifacts: readonly CampaignContentArtifactV1[]): ContentEntry[] {
  const entries = artifacts.flatMap(artifact => [...campaignSituationEntries(artifact), ...campaignClueEntries(artifact)]);
  const ids = new Set(entries.map(entry => entry.entryId));
  for (const artifact of artifacts) for (const id of artifact.dependencies.campaignEntryIds ?? []) {
    if (!ids.has(id)) throw new Error(`战役依赖 ${id} 不在当前快照绑定的内容中。`);
  }
  return entries;
}

export function resolveCampaignContent(
  worldEntries: readonly ContentEntry[],
  artifacts: readonly CampaignContentArtifactV1[],
): ContentEntry[] {
  const worldIds = new Set(worldEntries.map(entry => entry.entryId));
  const merged = [...worldEntries];
  const entries = campaignContentEntries(artifacts);
  const ids = new Set([...worldIds, ...entries.map(entry => entry.entryId)]);
  for (const entry of entries) {
    if (entry.kind === 'lore' && entry.dependencyIds.some(id => !ids.has(id))) throw new Error(`战役线索 ${entry.entryId} 的来源不在当前目录中。`);
    if (entry.kind === 'lore' && worldIds.has(entry.entryId)) throw new Error(`战役线索 ${entry.entryId} 与世界条目冲突。`);
    if (worldIds.has(entry.entryId)) continue; // world canon wins; never shadow
    if (merged.some(existing => existing.entryId === entry.entryId)) continue;
    merged.push(entry);
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

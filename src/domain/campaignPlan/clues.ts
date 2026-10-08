import type { CampaignContentArtifactV1 } from './types';

/** Validate the additive clue envelope without changing historical artifacts. */
export function validateCampaignClues(artifact: CampaignContentArtifactV1, scope?: {
  worldEntryIds: ReadonlySet<string>; campaignEntryIds?: ReadonlySet<string>; factIds?: ReadonlySet<string>;
}): string[] {
  if (artifact.clues === undefined) return [];
  const errors: string[] = [];
  if (!Array.isArray(artifact.clues) || artifact.clues.length > 8) return ['artifact: clues must be an array of ≤8 definitions.'];
  const seen = new Set<string>(artifact.situations.map(s => s.entryId));
  const declared = new Set([...artifact.dependencies.worldEntryIds, ...(artifact.dependencies.campaignEntryIds ?? [])]);
  const bounded = (value: unknown, min: number, max: number): boolean =>
    typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
  for (const clue of artifact.clues) {
    if (!clue || !/^camp-clue-[a-f0-9]{24}$/.test(clue.entryId) || seen.has(clue.entryId)
      || scope?.worldEntryIds.has(clue.entryId) || scope?.campaignEntryIds?.has(clue.entryId)) {
      errors.push('artifact: clue id must be unique in the campaign namespace and cannot shadow existing content.'); continue;
    }
    seen.add(clue.entryId);
    if (Object.keys(clue).some(key => !['entryId','definition','provenance','dependencyIds'].includes(key))
      || !clue.definition || Object.keys(clue.definition).some(key => !['name','title','text'].includes(key))
      || !bounded(clue.definition.name, 2, 80) || !bounded(clue.definition.title, 2, 80) || !bounded(clue.definition.text, 4, 800)) {
      errors.push(`artifact: clue ${clue.entryId} must contain only bounded lore text.`);
    }
    const p = clue.provenance;
    if (!p || !['design_fill','canon_inspired'].includes(p.kind) || !bounded(p.rationale, 4, 200)
      || !Array.isArray(p.sourceFactIds) || p.sourceFactIds.length > 8
      || p.sourceFactIds.some((id: unknown) => typeof id !== 'string' || !id || (scope?.factIds && !scope.factIds.has(id)))
      || (p.kind === 'canon_inspired' && !p.sourceFactIds.length)
      || (p.kind === 'design_fill' && p.sourceFactIds.length > 0)) errors.push(`artifact: clue ${clue.entryId} has unverifiable provenance.`);
    if (!Array.isArray(clue.dependencyIds) || clue.dependencyIds.length > 8
      || clue.dependencyIds.some((id: unknown) => typeof id !== 'string' || !declared.has(id) || (scope && !scope.worldEntryIds.has(id) && !scope.campaignEntryIds?.has(id)))) {
      errors.push(`artifact: clue ${clue.entryId} depends on content outside its bound catalog.`);
    }
  }
  return errors;
}

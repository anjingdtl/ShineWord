import type { BookSection, ContentEntry, ProgressiveDeltaPackage, WorldPackageManifest } from '../../domain/content/types';
import type { SegmentContentBindingV1 } from '../../domain/content/segmentArtifact';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import type { SqliteDatabase } from '../ports/sqlite';
import { loadBranchDeltaEntries } from '../worldPackage/contentManifest';
import { readBoundCampaignArtifacts } from '../campaignPlan/boundArtifacts';
import { resolveCampaignContent } from '../campaignPlan/contentResolver';

interface WorldCatalogReader {
  getWorldPackage(worldId: string, revision: number): Promise<{
    manifest: WorldPackageManifest; entries: ContentEntry[]; sections: BookSection[];
  } | null>;
  getProgressiveDeltaPackage(deltaId: string): Promise<ProgressiveDeltaPackage | null>;
}

export interface SegmentCatalogReader {
  loadEffectiveCatalog(input: { campaignId: string; branchId: string; binding?: SegmentContentBindingV1 }):
    Promise<{ entries: ContentEntry[]; sections: BookSection[] }>;
}

/** One immutable authority catalog for rules and player projections. Visibility
 * remains the consumer's responsibility; loading never grants knowledge. */
export async function loadCampaignContentCatalog(input: {
  db: SqliteDatabase;
  worldStore: WorldCatalogReader;
  segmentContent?: SegmentCatalogReader;
  sha256Hex: Sha256HexProvider['sha256Hex'];
  worldId: string;
  packageRevision: number;
  branch?: { campaignId: string; state: GameStateSnapshot };
}): Promise<{ entries: ContentEntry[]; sections: BookSection[] }> {
  const pkg = await input.worldStore.getWorldPackage(input.worldId, input.packageRevision);
  if (!pkg) {
    throw new Error(`Locked world package is missing: ${input.worldId} r${input.packageRevision}.`);
  }
  let entries = [...pkg.entries];
  let sections = pkg.sections.map(section => ({ ...section, entryIds: [...section.entryIds] }));
  const branch = input.branch;
  if (branch) {
    const state = branch.state;
    const deltas = state.contentManifest ? await loadBranchDeltaEntries({
      manifest: state.contentManifest, worldId: input.worldId, branchId: state.branchId,
      stateVersion: state.stateVersion, baseRevision: input.packageRevision,
      baseContentHash: pkg.manifest.contentHash,
      getDelta: id => input.worldStore.getProgressiveDeltaPackage(id), sha256Hex: input.sha256Hex,
    }) : [];
    if (state.segmentContentBinding) {
      if (!input.segmentContent) throw new Error('Segment content owner is unavailable for the adopted branch.');
      if (state.segmentContentBinding.basePackageRevision !== input.packageRevision) throw new Error('Segment binding differs from the locked package.');
      const catalog = await input.segmentContent.loadEffectiveCatalog({
        campaignId: branch.campaignId, branchId: state.branchId, binding: state.segmentContentBinding,
      });
      entries = [...catalog.entries];
      sections = catalog.sections.map(section => ({ ...section, entryIds: [...section.entryIds] }));
    } else {
      entries.push(...deltas.flatMap(delta => delta.entries));
      for (const section of deltas.flatMap(delta => delta.sections)) {
        const existing = sections.find(item => item.book === section.book && item.sectionKey === section.sectionKey);
        if (existing) existing.entryIds = [...existing.entryIds, ...section.entryIds];
        else sections.push({ ...section, entryIds: [...section.entryIds] });
      }
    }
    if (state.campaignContentBinding) {
      const artifacts = await readBoundCampaignArtifacts(input.db, branch.campaignId, state.campaignContentBinding);
      entries = resolveCampaignContent(entries, artifacts);
      const clueIds = artifacts.flatMap(artifact => (artifact.clues ?? []).map(clue => clue.entryId));
      if (clueIds.length) {
        if (sections.some(section => section.book === 'player_handbook' && section.sectionKey === 'campaign_clues')) {
          throw new Error('Campaign clue section conflicts with the immutable world catalog.');
        }
        sections.push({ book: 'player_handbook', sectionKey: 'campaign_clues', title: '战役线索',
          entryIds: [...new Set(clueIds)], position: Math.max(0, ...sections.map(section => section.position)) + 1 });
      }
    }
  }
  if (new Set(entries.map(entry => entry.entryId)).size !== entries.length) {
    throw new Error('The active branch content catalog contains conflicting immutable entry ids.');
  }
  return { entries, sections };
}

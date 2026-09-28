import { SHINEWORD_RULESET_ID, SHINEWORD_RULESET_VERSION } from '../../domain/rules/ruleset';
import type {
  BookSection,
  ContentEntry,
  WorldPackageBuildScope,
  WorldPackageManifest,
} from '../../domain/content/types';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import { computePackageContentHash, validatePackage } from './validate';

export interface PublishPackageInput {
  worldStore: SqliteWorldStore;
  sha256Hex: Sha256HexProvider['sha256Hex'];
  worldId: string;
  sourceSha256: string;
  mappingVersion: string;
  entries: readonly ContentEntry[];
  sections: readonly BookSection[];
  createdAt: string;
  /**
   * Final package status (P2 acceptance G04). 'published' = the full
   * completeness gate passed and campaigns may lock this revision.
   * 'needs_review' = an explicitly labeled PREVIEW revision: extraction had
   * failed chunks or the novel mapping degraded, so it must not be presented
   * as the novel's complete three books. needs_review revisions never open
   * campaigns (createCampaign refuses non-published).
   */
  status?: 'published' | 'needs_review';
  /** Extra coverage facts recorded into the validation report. */
  coverage?: Record<string, unknown>;
  /** When set, publishes a versioned, content-hashed partial/full source scope. */
  buildScope?: WorldPackageBuildScope;
}

export interface PublishPackageResult {
  manifest: WorldPackageManifest;
  report: ReturnType<typeof validatePackage>;
}

/**
 * Publishes an immutable world package revision. The gate is absolute:
 * structural validation errors, dangling references, unknown effect ops and
 * OPEN BLOCKING review issues all stop publication entirely. A revision is
 * never rewritten - corrections ship as a new revision.
 */
export async function publishWorldPackage(input: PublishPackageInput): Promise<PublishPackageResult> {
  const status = input.status ?? 'published';
  const report = validatePackage(
    { worldId: input.worldId, revision: 0 },
    input.entries,
    input.sections,
  );
  if (!report.ok) {
    throw new Error(
      `World package failed validation and cannot publish:\n- ${report.errors.join('\n- ')}`,
    );
  }

  const blockingIssues = await input.worldStore.listReviewIssues(input.worldId, 'open');
  const blockers = blockingIssues.filter(issue => issue.severity === 'blocking');
  if (blockers.length > 0) {
    throw new Error(
      `World package has ${blockers.length} unresolved blocking conflict(s); resolve them in the review queue first: ` +
        blockers.map(issue => issue.issueId).join(', '),
    );
  }

  if (input.buildScope) validateBuildScope(input.buildScope);
  const contentHash = await computePackageContentHash(
    input.entries, input.sections, input.sha256Hex, input.buildScope,
  );
  const existing = await input.worldStore.listWorldPackages(input.worldId);
  const revision = existing.length > 0 ? Math.max(...existing.map(pkg => pkg.revision)) + 1 : 1;

  const manifest: WorldPackageManifest = {
    worldId: input.worldId,
    revision,
    schemaVersion: input.buildScope ? 'world-package-3' : 'world-package-2',
    sourceSha256: input.sourceSha256,
    ruleset: { id: SHINEWORD_RULESET_ID, version: SHINEWORD_RULESET_VERSION },
    mappingVersion: input.mappingVersion,
    contentHash,
    status,
    ...(input.buildScope ? { buildScope: input.buildScope } : {}),
  };

  await input.worldStore.saveWorldPackage({
    manifest,
    entries: input.entries.map(entry => ({ ...entry, revision })),
    sections: input.sections,
    validationJson: JSON.stringify({
      errors: report.errors,
      warnings: report.warnings,
      entryCount: report.entryCount,
      countsByKind: report.countsByKind,
      ...(input.buildScope ? { buildScope: input.buildScope } : {}),
      ...(input.coverage ?? {}),
    }),
    createdAt: input.createdAt,
  });

  return { manifest, report };
}

function validateBuildScope(scope: WorldPackageBuildScope): void {
  if (!['progressive', 'full'].includes(scope.strategy)
    || !['opening', 'incremental', 'whole_source'].includes(scope.scope)
    || !['partial', 'complete'].includes(scope.completeness)
    || !Array.isArray(scope.sourceRanges) || scope.sourceRanges.length === 0) {
    throw new Error('World package build scope is invalid.');
  }
  for (const range of scope.sourceRanges) {
    if (!Number.isSafeInteger(range.startCodePoint) || !Number.isSafeInteger(range.endCodePoint)
      || range.startCodePoint < 0 || range.endCodePoint <= range.startCodePoint
      || !/^[a-f0-9]{64}$/i.test(range.contentSha256)) {
      throw new Error('World package source coverage range is invalid.');
    }
  }
  const lineage = scope.packageLineage;
  if (lineage?.kind === 'delta' && (!Number.isSafeInteger(lineage.baseRevision) || (lineage.baseRevision ?? 0) < 1
    || !lineage.branchId?.trim() || !Number.isSafeInteger(lineage.stateVersion) || (lineage.stateVersion ?? -1) < 0)) {
    throw new Error('World package delta lineage must bind a base revision, branch and state version.');
  }
  if (lineage?.kind === 'base' && (lineage.baseRevision !== undefined || lineage.branchId !== undefined || lineage.stateVersion !== undefined)) {
    throw new Error('World package base lineage cannot bind a delta target.');
  }
}

/**
 * Player knowledge lens for book views (P2 acceptance A06): a player view is
 * filtered by what the READER knows — GM-only entries stay out, and
 * discoverable entries stay hidden until the branch has actually discovered
 * them. The full edit view (`includeGm: true`) is a separate, explicit mode.
 */
export interface BookKnowledge {
  /** Entry ids the reading actor/branch has actually discovered in play. */
  discoveredEntryIds: ReadonlySet<string>;
}

/** Assembles one book view with visibility + knowledge filtering (plan §5, §14). */
export function assembleBook(
  pkg: { entries: readonly ContentEntry[]; sections: readonly BookSection[] },
  book: BookSection['book'],
  options: { includeGm: boolean; knowledge?: BookKnowledge },
): Array<{ section: BookSection; entries: ContentEntry[] }> {
  const byId = new Map(pkg.entries.map(entry => [entry.entryId, entry]));
  const discovered = options.knowledge?.discoveredEntryIds;
  return pkg.sections
    .filter(section => section.book === book)
    .sort((a, b) => a.position - b.position)
    .map(section => {
      const entries = section.entryIds
        .map(entryId => byId.get(entryId))
        .filter((entry): entry is ContentEntry => {
          if (!entry) return false;
          if (entry.visibility === 'gm') return options.includeGm;
          if (entry.visibility === 'discoverable') {
            // The edit view sees everything; a player view requires an actual
            // in-play discovery record for this entry.
            return options.includeGm || discovered?.has(entry.entryId) === true;
          }
          return true;
        });
      // Section metadata is part of the player payload too. Keeping the
      // original entryIds here would reveal GM-only and undiscovered content
      // even though the entries themselves were filtered out.
      return { section: { ...section, entryIds: entries.map(entry => entry.entryId) }, entries };
    })
    .filter(group => group.entries.length > 0);
}

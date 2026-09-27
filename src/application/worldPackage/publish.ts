import { SHINEWORD_RULESET_ID, SHINEWORD_RULESET_VERSION } from '../../domain/rules/ruleset';
import type {
  BookSection,
  ContentEntry,
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
}

export interface PublishPackageResult {
  manifest: WorldPackageManifest;
  report: ReturnType<typeof validatePackage>;
}

/**
 * Publishes an immutable world package revision. The gate is absolute:
 * structural validation errors, dangling references, unknown effect ops and
 * OPEN BLOCKING review issues all stop publication. A published revision is
 * never rewritten - corrections ship as a new revision.
 */
export async function publishWorldPackage(input: PublishPackageInput): Promise<PublishPackageResult> {
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

  const contentHash = await computePackageContentHash(input.entries, input.sections, input.sha256Hex);
  const existing = await input.worldStore.listWorldPackages(input.worldId);
  const revision = existing.length > 0 ? Math.max(...existing.map(pkg => pkg.revision)) + 1 : 1;

  const manifest: WorldPackageManifest = {
    worldId: input.worldId,
    revision,
    schemaVersion: 'world-package-2',
    sourceSha256: input.sourceSha256,
    ruleset: { id: SHINEWORD_RULESET_ID, version: SHINEWORD_RULESET_VERSION },
    mappingVersion: input.mappingVersion,
    contentHash,
    status: 'published',
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
    }),
    createdAt: input.createdAt,
  });

  return { manifest, report };
}

/** Assembles one book view with visibility filtering (plan §5). */
export function assembleBook(
  pkg: { entries: readonly ContentEntry[]; sections: readonly BookSection[] },
  book: BookSection['book'],
  options: { includeGm: boolean },
): Array<{ section: BookSection; entries: ContentEntry[] }> {
  const byId = new Map(pkg.entries.map(entry => [entry.entryId, entry]));
  return pkg.sections
    .filter(section => section.book === book)
    .sort((a, b) => a.position - b.position)
    .map(section => ({
      section,
      entries: section.entryIds
        .map(entryId => byId.get(entryId))
        .filter((entry): entry is ContentEntry => {
          if (!entry) return false;
          if (entry.visibility === 'gm' && !options.includeGm) return false;
          return true;
        }),
    }))
    .filter(group => !options.includeGm || group.entries.length > 0);
}

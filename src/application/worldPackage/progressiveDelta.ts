import type {
  BookSection,
  BookName,
  BranchContentManifest,
  ContentEntry,
  ProgressiveDeltaPackage,
  WorldPackageBuildScope,
} from '../../domain/content/types';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import type { SqliteDatabase, SqliteRow } from '../ports/sqlite';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import type { SourceManifest, SourceStore } from '../ports/sourceStore';
import { codePointLength } from '../../domain/world/textOffsets';
import { ensureBaseBranchContentManifest, insertBranchContentManifest, readBranchContentManifest } from './branchContentStore';
import { createContentManifest, verifyDeltaPackage } from './contentManifest';
import { assertValidWorldPackageBuildScope } from './publish';
import { computePackageContentHash, validatePackage } from './validate';
import { isFactVisibleAtAnchor } from '../world/opening';
import { visibleEvidenceRanges } from '../progressiveBuild/progressiveTurnContext';

const USER_LOOKUP_PROVENANCE_RATIONALE = '用户主动本地查书后暂存的逐字摘录；未添加总结、解释或规则数值。';

export interface PublishProgressiveDeltaInput {
  db: SqliteDatabase;
  worldStore: SqliteWorldStore;
  sourceStore: Pick<SourceStore, 'findActiveByRawHash' | 'readRange' | 'getChapters'>;
  sha256Hex: Sha256HexProvider['sha256Hex'];
  deltaId: string;
  worldId: string;
  branchId: string;
  stateVersion: number;
  baseRevision: number;
  sourceSha256: string;
  mappingVersion: string;
  entries: readonly ContentEntry[];
  /** Only sections/entry links introduced by this delta. Existing section ids are appended. */
  sections: readonly BookSection[];
  sourceRanges: WorldPackageBuildScope['sourceRanges'];
  /** Bypasses visible-citation scope only for constrained, exact-quote lookup deltas. */
  purpose?: 'player_requested_book_lookup';
  signal?: AbortSignal;
  createdAt: string;
}

export interface PublishProgressiveDeltaResult {
  delta: ProgressiveDeltaPackage;
  status: ProgressiveDeltaPackage['status'];
  activeManifest: BranchContentManifest | null;
}

export interface PublishUserRequestedSourceLookupInput {
  db: SqliteDatabase;
  worldStore: SqliteWorldStore;
  sourceStore: Pick<SourceStore, 'findActiveByRawHash' | 'readRange' | 'getChapters'>;
  sha256Hex: Sha256HexProvider['sha256Hex'];
  worldId: string;
  branchId: string;
  stateVersion: number;
  baseRevision: number;
  sourceSha256: string;
  book: BookName;
  passages: readonly {
    chapterId: string;
    chapterTitle: string;
    startCodePoint: number;
    endCodePoint: number;
    text: string;
  }[];
  existingEntryIds: ReadonlySet<string>;
  createdAt: string;
  signal?: AbortSignal;
}

export interface PublishUserRequestedSourceLookupResult {
  status: 'published' | 'needs_review' | 'already_published';
  /** IDs only; callers must not display passage content before explicit confirmation. */
  entryIds: string[];
  publication: PublishProgressiveDeltaResult | null;
}

/** Store explicitly requested local-search hits as exact, hidden lore quotes.
 * This fixed-template path cannot create rules, public entries or summaries. */
export async function publishUserRequestedSourceLookupDelta(
  input: PublishUserRequestedSourceLookupInput,
): Promise<PublishUserRequestedSourceLookupResult> {
  throwIfAborted(input.signal);
  const base = await input.worldStore.getWorldPackage(input.worldId, input.baseRevision);
  if (!base || base.manifest.status !== 'published') {
    throw new Error('Source lookup requires the campaign locked package.');
  }
  const baseSection = base.sections.find(item => item.book === input.book);
  if (!baseSection) throw new Error('The locked package has no section for the selected book.');
  const entries: ContentEntry[] = [];
  const ranges: WorldPackageBuildScope['sourceRanges'][number][] = [];
  const entryIds: string[] = [];
  const seen = new Set<string>();
  let totalCodePoints = 0;
  for (const passage of input.passages.slice(0, 3)) {
    throwIfAborted(input.signal);
    const length = codePointLength(passage.text);
    if (!passage.chapterId || !passage.chapterTitle || !Number.isSafeInteger(passage.startCodePoint)
      || !Number.isSafeInteger(passage.endCodePoint) || passage.startCodePoint < 0
      || length <= 0 || length > 1_200 || length !== passage.endCodePoint - passage.startCodePoint
      || totalCodePoints + length > 3_600) continue;
    const contentSha256 = (await input.sha256Hex(passage.text)).toLowerCase();
    throwIfAborted(input.signal);
    const rangeKey = `${passage.chapterId}:${passage.startCodePoint}:${passage.endCodePoint}:${contentSha256}`;
    if (seen.has(rangeKey)) continue;
    seen.add(rangeKey);
    totalCodePoints += length;
    const entryId = `source-lookup-${(await input.sha256Hex(`${input.book}:${rangeKey}`)).slice(0, 28)}`;
    throwIfAborted(input.signal);
    entryIds.push(entryId);
    if (input.existingEntryIds.has(entryId)) continue;
    const sourceRange = {
      chapterId: passage.chapterId,
      startCodePoint: passage.startCodePoint,
      endCodePoint: passage.endCodePoint,
      contentSha256,
    };
    const provenance = {
      kind: 'explicit' as const,
      sourceFactIds: [] as string[],
      sourceRanges: [sourceRange],
      policyId: 'user-requested-source-lookup',
      rationale: USER_LOOKUP_PROVENANCE_RATIONALE,
    };
    entries.push({
      entryId,
      kind: 'lore',
      revision: input.baseRevision,
      provenance,
      fieldProvenance: { 'definition.text': provenance },
      visibility: 'discoverable',
      revealPolicyId: 'source-lookup-confirmation',
      dependencyIds: [],
      definition: { name: '原著摘录', title: passage.chapterTitle, text: passage.text },
    });
    ranges.push({
      startCodePoint: passage.startCodePoint,
      endCodePoint: passage.endCodePoint,
      contentSha256,
    });
  }
  if (entryIds.length === 0) return { status: 'already_published', entryIds: [], publication: null };
  if (entries.length === 0) return { status: 'already_published', entryIds, publication: null };
  const deltaId = `source-lookup-${(await input.sha256Hex(
    `${input.sourceSha256}:${input.branchId}:${input.stateVersion}:${input.book}:${entries.map(entry => entry.entryId).join(',')}`,
  )).slice(0, 32)}`;
  throwIfAborted(input.signal);
  const previousAttempt = await input.db.queryOne<{ status: string }>(
    'SELECT status FROM progressive_world_deltas WHERE delta_id = ?', [deltaId],
  );
  throwIfAborted(input.signal);
  if (previousAttempt) {
    return { status: 'needs_review', entryIds: [], publication: null };
  }
  const publication = await publishProgressiveDelta({
    db: input.db,
    worldStore: input.worldStore,
    sourceStore: input.sourceStore,
    sha256Hex: input.sha256Hex,
    deltaId,
    worldId: input.worldId,
    branchId: input.branchId,
    stateVersion: input.stateVersion,
    baseRevision: input.baseRevision,
    sourceSha256: input.sourceSha256,
    mappingVersion: base.manifest.mappingVersion,
    entries,
    sections: [{
      book: input.book,
      sectionKey: 'source-lookup-excerpts',
      title: '主动查书摘录',
      entryIds: entries.map(entry => entry.entryId),
      position: baseSection.position + 1,
    }],
    sourceRanges: ranges,
    purpose: 'player_requested_book_lookup',
    signal: input.signal,
    createdAt: input.createdAt,
  });
  return {
    status: publication.status,
    entryIds: publication.status === 'published' ? entryIds : [],
    publication,
  };
}

/** Persist exact player-visible source passages encountered during a turn as
 * an additive Player Handbook appendix. This is a local fixed-template
 * compilation: it does not summarize, infer rules or make another model call. */
export async function publishSourceEvidenceExcerptDelta(input: {
  db: SqliteDatabase;
  worldStore: SqliteWorldStore;
  sourceStore: Pick<SourceStore, 'findActiveByRawHash' | 'readRange' | 'getChapters'>;
  sha256Hex: Sha256HexProvider['sha256Hex'];
  worldId: string;
  branchId: string;
  stateVersion: number;
  baseRevision: number;
  sourceSha256: string;
  passages: readonly {
    chapterId: string;
    startCodePoint: number;
    endCodePoint: number;
    text: string;
  }[];
  existingEntryIds: ReadonlySet<string>;
  createdAt: string;
}): Promise<PublishProgressiveDeltaResult | null> {
  const base = await input.worldStore.getWorldPackage(input.worldId, input.baseRevision);
  if (!base || base.manifest.status !== 'published') throw new Error('Source excerpts require the campaign locked package.');
  const section = base.sections.find(item => item.book === 'player_handbook');
  if (!section) throw new Error('The locked package has no Player Handbook section for cited source excerpts.');
  const entries: ContentEntry[] = [];
  const ranges: WorldPackageBuildScope['sourceRanges'][number][] = [];
  const refs = new Set<string>();
  let totalCodePoints = 0;
  for (const passage of input.passages.slice(0, 3)) {
    const length = codePointLength(passage.text);
    if (length <= 0 || length !== passage.endCodePoint - passage.startCodePoint) continue;
    totalCodePoints += length;
    if (totalCodePoints > 1_200) break;
    const contentSha256 = (await input.sha256Hex(passage.text)).toLowerCase();
    const rangeKey = `${passage.chapterId}:${passage.startCodePoint}:${passage.endCodePoint}:${contentSha256}`;
    if (refs.has(rangeKey)) continue;
    refs.add(rangeKey);
    const entryId = `novel-excerpt-${(await input.sha256Hex(rangeKey)).slice(0, 24)}`;
    if (input.existingEntryIds.has(entryId)) continue;
    const sourceRange = {
      chapterId: passage.chapterId,
      startCodePoint: passage.startCodePoint,
      endCodePoint: passage.endCodePoint,
      contentSha256,
    };
    const provenance = {
      kind: 'explicit' as const,
      sourceFactIds: [] as string[],
      sourceRanges: [sourceRange],
      policyId: 'verbatim-source-excerpt',
      rationale: '逐字摘录自当前角色可见的原著证据范围；未加入解释或规则数值。',
    };
    entries.push({
      entryId, kind: 'lore', revision: input.baseRevision,
      provenance,
      fieldProvenance: { 'definition.text': provenance },
      visibility: 'public', dependencyIds: [],
      definition: { name: '原著证据摘录', title: '已核对原文', text: passage.text },
    });
    ranges.push({
      startCodePoint: passage.startCodePoint,
      endCodePoint: passage.endCodePoint,
      contentSha256,
    });
  }
  if (entries.length === 0) return null;
  const deltaId = `source-excerpts-${(await input.sha256Hex(
    `${input.branchId}:${input.stateVersion}:${entries.map(entry => entry.entryId).join(',')}`,
  )).slice(0, 32)}`;
  return publishProgressiveDelta({
    db: input.db,
    worldStore: input.worldStore,
    sourceStore: input.sourceStore,
    sha256Hex: input.sha256Hex,
    deltaId,
    worldId: input.worldId,
    branchId: input.branchId,
    stateVersion: input.stateVersion,
    baseRevision: input.baseRevision,
    sourceSha256: input.sourceSha256,
    mappingVersion: base.manifest.mappingVersion,
    entries,
    sections: [{ book: 'player_handbook', sectionKey: 'source-excerpts',
      title: '已核对原文摘录', entryIds: entries.map(entry => entry.entryId), position: section.position + 1 }],
    sourceRanges: ranges,
    createdAt: input.createdAt,
  });
}

/** Compile and publish an additive, branch-bound delta through the same
 * structural/provenance/review gates as a full package. Conflicts remain
 * immutable `needs_review` artifacts; fixes require a new delta id. */
export async function publishProgressiveDelta(input: PublishProgressiveDeltaInput): Promise<PublishProgressiveDeltaResult> {
  throwIfAborted(input.signal);
  if (!input.deltaId.trim() || input.deltaId.length > 160 || !/^[a-zA-Z0-9._:-]+$/.test(input.deltaId)) {
    throw new Error('Progressive delta id is invalid.');
  }
  if (!/^[a-f0-9]{64}$/i.test(input.sourceSha256)) throw new Error('Progressive delta source hash is invalid.');
  if (input.entries.length === 0 || input.entries.length > 500 || input.sections.length > 100 ||
      input.sourceRanges.length === 0 || input.sourceRanges.length > 64 ||
      input.sourceRanges.reduce((total, range) => total + range.endCodePoint - range.startCodePoint, 0) > 12_000) {
    throw new Error('Progressive delta exceeds its entry, section or source-range bounds.');
  }
  const base = await input.worldStore.getWorldPackage(input.worldId, input.baseRevision);
  if (!base || base.manifest.status !== 'published') throw new Error('Progressive delta requires its exact published base package.');
  if (base.manifest.contentHash.toLowerCase() !== (await readCampaignPackageHash(input.db, input.branchId, input.worldId, input.baseRevision))?.toLowerCase()) {
    throw new Error('Progressive delta base does not match the campaign package lock.');
  }
  const sourceManifest = await verifySourceRanges(input.sourceStore, input.sha256Hex, input.sourceSha256, input.sourceRanges);
  const sourceChapters = await input.sourceStore.getChapters(sourceManifest.sourceId);
  const branch = await input.db.queryOne<SqliteRow>(
    `SELECT b.state_version, c.world_id, c.package_revision, c.anchor_json
       FROM branches b JOIN campaigns c ON c.campaign_id = b.campaign_id
      WHERE b.branch_id = ?`, [input.branchId],
  );
  if (!branch || String(branch.world_id) !== input.worldId || Number(branch.package_revision) !== input.baseRevision ||
      Number(branch.state_version) !== input.stateVersion) {
    throw new Error('Progressive delta branch or state changed before publication.');
  }
  const baseline = await ensureBaseBranchContentManifest({
    db: input.db, branchId: input.branchId, worldId: input.worldId,
    stateVersion: input.stateVersion, packageRevision: input.baseRevision,
    packageContentHash: base.manifest.contentHash, createdAt: input.createdAt,
  });
  if (baseline.basePackage.contentHash.toLowerCase() !== base.manifest.contentHash.toLowerCase()) {
    throw new Error('Branch content manifest is bound to a different immutable base package.');
  }
  const activeDeltas: ProgressiveDeltaPackage[] = [];
  for (const ref of baseline.deltas) {
    const delta = await input.worldStore.getProgressiveDeltaPackage(ref.deltaId);
    if (!delta || !await verifyDeltaPackage(delta, {
      deltaId: ref.deltaId, contentHash: ref.contentHash, baseContentHash: base.manifest.contentHash,
    }, input.sha256Hex)) {
      throw new Error(`Published progressive delta ${ref.deltaId} is missing or failed integrity verification.`);
    }
    activeDeltas.push(delta);
  }

  const buildScope: WorldPackageBuildScope = {
    strategy: 'progressive', scope: 'incremental', completeness: 'partial',
    sourceRanges: input.sourceRanges.map(range => ({ ...range })),
    packageLineage: {
      kind: 'delta', baseRevision: input.baseRevision,
      branchId: input.branchId, stateVersion: input.stateVersion,
    },
  };
  assertValidWorldPackageBuildScope(buildScope);
  const additions = input.entries.map(entry => ({ ...entry, revision: input.baseRevision }));
  const errors: string[] = [];
  const allKnown = [...base.entries, ...activeDeltas.flatMap(delta => delta.entries)];
  const knownIds = new Set(allKnown.map(entry => entry.entryId));
  const proposedIds = new Set<string>();
  for (const entry of additions) {
    if (knownIds.has(entry.entryId) || proposedIds.has(entry.entryId)) {
      errors.push(`Entry id ${entry.entryId} already exists; published definitions cannot be overwritten.`);
    }
    proposedIds.add(entry.entryId);
  }
  const anchor = JSON.parse(String(branch.anchor_json ?? '{}')) as { worldTimeOrder?: number };
  const facts = await input.worldStore.listFacts(input.worldId);
  const priorEntries = [...base.entries, ...activeDeltas.flatMap(delta => delta.entries)];
  if (input.purpose === 'player_requested_book_lookup') {
    await validateUserRequestedLookupDelta(input, sourceManifest, sourceChapters, errors);
  } else {
    validateAllowedDeltaSourceRanges(input.sourceRanges, visibleEvidenceRanges(
      priorEntries, facts, anchor.worldTimeOrder ?? 0,
      await readBranchDiscoveredEntryIds(input.db, input.branchId, input.stateVersion),
    ), errors);
  }
  validateDeltaEvidence(additions, input.sourceRanges, sourceChapters, facts, anchor.worldTimeOrder, errors);
  await validateNoDeadNpcRevival(input.db, input.branchId, input.stateVersion, additions, errors);
  const mergedSections = mergeSections(
    [...base.sections, ...activeDeltas.flatMap(delta => delta.sections)],
    input.sections,
    errors,
  );
  const mergedEntries = [...allKnown, ...additions];
  const report = validatePackage({ worldId: input.worldId, revision: input.baseRevision }, mergedEntries, mergedSections);
  const blockers = (await input.worldStore.listReviewIssues(input.worldId, 'open'))
    .filter(issue => issue.severity === 'blocking');
  if (blockers.length > 0) errors.push(`World has unresolved blocking review issues: ${blockers.map(issue => issue.issueId).join(', ')}.`);
  errors.push(...report.errors);
  const contentHash = await computePackageContentHash(additions, input.sections, input.sha256Hex, buildScope);
  const delta: ProgressiveDeltaPackage = {
    schemaVersion: 'shineword-progressive-delta-1',
    deltaId: input.deltaId,
    worldId: input.worldId,
    basePackage: { revision: input.baseRevision, contentHash: base.manifest.contentHash },
    originBranchId: input.branchId,
    publishedAtStateVersion: input.stateVersion,
    sourceSha256: input.sourceSha256.toLowerCase(),
    mappingVersion: input.mappingVersion,
    buildScope,
    status: errors.length === 0 ? 'published' : 'needs_review',
    contentHash,
    entries: additions,
    sections: input.sections.map(section => ({ ...section, entryIds: [...section.entryIds] })),
    validation: { errors, warnings: report.warnings },
    createdAt: input.createdAt,
  };
  const nextManifest = errors.length === 0
    ? await createContentManifest({
        worldId: input.worldId,
        branchId: input.branchId,
        stateVersion: input.stateVersion,
        contentVersion: baseline.contentVersion + 1,
        basePackage: baseline.basePackage,
        deltas: [...baseline.deltas, {
          deltaId: delta.deltaId,
          contentHash: delta.contentHash,
          publishedAtStateVersion: delta.publishedAtStateVersion,
          originBranchId: delta.originBranchId,
        }],
      }, input.sha256Hex)
    : null;

  throwIfAborted(input.signal);
  await input.db.transaction(async tx => {
    throwIfAborted(input.signal);
    const current = await tx.queryOne<SqliteRow>(
      `SELECT b.state_version, c.world_id, c.package_revision
         FROM branches b JOIN campaigns c ON c.campaign_id = b.campaign_id
        WHERE b.branch_id = ?`, [input.branchId],
    );
    const latest = await readBranchContentManifest(tx, input.branchId, input.stateVersion);
    if (!current || Number(current.state_version) !== input.stateVersion || String(current.world_id) !== input.worldId ||
        Number(current.package_revision) !== input.baseRevision ||
        latest?.contentVersion !== baseline.contentVersion || latest.manifestHash !== baseline.manifestHash) {
      throw new Error('Progressive content changed while this delta was validating; rebuild against the current branch manifest.');
    }
    if (delta.status === 'published') {
      const blocking = await tx.queryAll<{ issue_id: string }>(
        `SELECT issue_id FROM review_issues WHERE world_id = ? AND status = 'open' AND severity = 'blocking'`,
        [input.worldId],
      );
      if (blocking.length > 0) throw new Error('A blocking review issue opened while this delta was validating; publication was canceled.');
    }
    await tx.execute(
      `INSERT INTO progressive_world_deltas
        (delta_id, world_id, origin_branch_id, published_at_state_version, base_revision,
         base_content_hash, status, content_hash, package_json, validation_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [delta.deltaId, delta.worldId, delta.originBranchId, delta.publishedAtStateVersion,
        delta.basePackage.revision, delta.basePackage.contentHash, delta.status,
        delta.contentHash, JSON.stringify(delta), JSON.stringify(delta.validation), delta.createdAt],
    );
    if (nextManifest) await insertBranchContentManifest(tx, nextManifest, input.createdAt);
  });
  return { delta, status: delta.status, activeManifest: nextManifest };
}

async function readCampaignPackageHash(
  db: Pick<SqliteDatabase, 'queryOne'>,
  branchId: string,
  worldId: string,
  revision: number,
): Promise<string | null> {
  const row = await db.queryOne<{ content_hash: string }>(
    `SELECT wp.content_hash
       FROM branches b JOIN campaigns c ON c.campaign_id = b.campaign_id
       JOIN world_packages wp ON wp.world_id = c.world_id AND wp.revision = c.package_revision
      WHERE b.branch_id = ? AND c.world_id = ? AND c.package_revision = ?`,
    [branchId, worldId, revision],
  );
  return row?.content_hash ?? null;
}

function mergeSections(base: readonly BookSection[], additions: readonly BookSection[], errors: string[]): BookSection[] {
  const result = base.map(section => ({ ...section, entryIds: [...section.entryIds] }));
  for (const addition of additions) {
    const current = result.find(section => section.book === addition.book && section.sectionKey === addition.sectionKey);
    if (!current) {
      result.push({ ...addition, entryIds: [...addition.entryIds] });
      continue;
    }
    if (current.title !== addition.title) errors.push(`Section ${addition.book}/${addition.sectionKey} has a conflicting title; existing book structure is immutable.`);
    current.entryIds = [...current.entryIds, ...addition.entryIds];
  }
  return result;
}

async function validateUserRequestedLookupDelta(
  input: PublishProgressiveDeltaInput,
  sourceManifest: SourceManifest,
  chapters: Awaited<ReturnType<SourceStore['getChapters']>>,
  errors: string[],
): Promise<void> {
  const section = input.sections.length === 1 ? input.sections[0] : undefined;
  if (!section || !['player_handbook', 'gm_guide', 'monster_manual'].includes(section.book)
      || section.sectionKey !== 'source-lookup-excerpts' || section.title !== '主动查书摘录'
      || section.entryIds.length !== input.entries.length
      || input.entries.some(entry => !section.entryIds.includes(entry.entryId))) {
    errors.push('User-requested source lookup deltas must use one dedicated selected-book excerpt section.');
  }
  const requestedRanges = new Set<string>();
  for (const range of input.sourceRanges) {
    const key = `${range.startCodePoint}:${range.endCodePoint}:${range.contentSha256.toLowerCase()}`;
    if (requestedRanges.has(key)) errors.push('User-requested lookup delta contains duplicate source ranges.');
    requestedRanges.add(key);
  }
  const usedRanges = new Set<string>();
  for (const entry of input.entries) {
    const definition = entry.definition as { name?: unknown; title?: unknown; text?: unknown } | null;
    const provenance = entry.provenance;
    const fieldProvenance = entry.fieldProvenance ?? {};
    const field = fieldProvenance['definition.text'];
    const shapeErrors: string[] = [];
    if (!provenance || typeof provenance !== 'object') shapeErrors.push('missing provenance');
    if (entry.kind !== 'lore' || entry.visibility !== 'discoverable'
        || entry.revealPolicyId !== 'source-lookup-confirmation') shapeErrors.push('not hidden lore');
    if (!Array.isArray(entry.dependencyIds) || entry.dependencyIds.length !== 0) shapeErrors.push('has dependencies');
    if (Object.keys(entry).sort().join(',') !== 'definition,dependencyIds,entryId,fieldProvenance,kind,provenance,revealPolicyId,revision,visibility') {
      shapeErrors.push('unexpected entry fields');
    }
    if (!definition || typeof definition.text !== 'string' || definition.name !== '原著摘录'
        || typeof definition.title !== 'string' || Object.keys(definition).sort().join(',') !== 'name,text,title') {
      shapeErrors.push('not an exact excerpt definition');
    }
    if (Object.keys(fieldProvenance).sort().join(',') !== 'definition.text' || !field) {
      shapeErrors.push('missing field provenance');
    }
    if (provenance && typeof provenance === 'object'
        && (Object.keys(provenance).sort().join(',') !== 'kind,policyId,rationale,sourceFactIds,sourceRanges'
          || !Array.isArray(provenance.sourceFactIds) || provenance.sourceFactIds.length !== 0
          || !Array.isArray(provenance.sourceRanges) || provenance.sourceRanges.length !== 1
          || provenance.kind !== 'explicit' || provenance.policyId !== 'user-requested-source-lookup'
          || provenance.rationale !== USER_LOOKUP_PROVENANCE_RATIONALE)) {
      shapeErrors.push('invalid exact-source provenance');
    }
    if (field && typeof field === 'object'
        && (Object.keys(field).sort().join(',') !== 'kind,policyId,rationale,sourceFactIds,sourceRanges'
          || field.kind !== 'explicit' || field.policyId !== 'user-requested-source-lookup'
          || !Array.isArray(field.sourceFactIds) || field.sourceFactIds.length !== 0
          || !Array.isArray(field.sourceRanges) || field.sourceRanges.length !== 1
          || field.rationale !== USER_LOOKUP_PROVENANCE_RATIONALE)) {
      shapeErrors.push('invalid field provenance');
    }
    if (shapeErrors.length > 0) {
      errors.push(`${entry.entryId}: source lookup delta ${shapeErrors.join('; ')}.`);
      continue;
    }
    const validProvenance = provenance!;
    const validField = field!;
    const validDefinition = definition as { title: string; text: string };
    const reference = validProvenance.sourceRanges![0]!;
    const fieldReference = validField.sourceRanges![0]!;
    if (reference.chapterId !== fieldReference.chapterId
        || reference.startCodePoint !== fieldReference.startCodePoint
        || reference.endCodePoint !== fieldReference.endCodePoint
        || reference.contentSha256.toLowerCase() !== fieldReference.contentSha256.toLowerCase()) {
      errors.push(`${entry.entryId}: source lookup field provenance does not match its entry provenance.`);
      continue;
    }
    const key = `${reference.startCodePoint}:${reference.endCodePoint}:${reference.contentSha256.toLowerCase()}`;
    const chapter = chapters.find(item => item.chapterId === reference.chapterId);
    if (!requestedRanges.has(key) || usedRanges.has(key) || !chapter
        || validDefinition.title !== chapter.title
        || reference.startCodePoint < chapter.startOffset || reference.endCodePoint > chapter.endOffset
        || reference.endCodePoint - reference.startCodePoint !== codePointLength(validDefinition.text)) {
      errors.push(`${entry.entryId}: source lookup quote has no unique, chapter-bound verified source range.`);
      continue;
    }
    usedRanges.add(key);
    try {
      const sourceText = await input.sourceStore.readRange(sourceManifest.sourceId,
        reference.startCodePoint, reference.endCodePoint);
      if (sourceText !== validDefinition.text || (await input.sha256Hex(sourceText)).toLowerCase()
          !== reference.contentSha256.toLowerCase()) {
        errors.push(`${entry.entryId}: source lookup quote is not an exact match for the imported novel.`);
      }
    } catch {
      errors.push(`${entry.entryId}: source lookup quote could not be verified against the imported novel.`);
    }
  }
  if (usedRanges.size !== requestedRanges.size) {
    errors.push('Every source range in a user-requested lookup delta must back exactly one exact quote.');
  }
}

async function readBranchDiscoveredEntryIds(
  db: Pick<SqliteDatabase, 'queryOne'>,
  branchId: string,
  stateVersion: number,
): Promise<ReadonlySet<string>> {
  const row = await db.queryOne<{ snapshot_json: string }>(
    'SELECT snapshot_json FROM snapshots WHERE branch_id = ? AND state_version = ?', [branchId, stateVersion],
  );
  if (!row) return new Set();
  try {
    const snapshot = JSON.parse(row.snapshot_json) as {
      party?: Array<{ role?: string; actorId?: string }>;
      discoveries?: Array<{ actorId?: string; entryId?: string }>;
    };
    const protagonistId = snapshot.party?.find(member => member.role === 'protagonist')?.actorId;
    return new Set((snapshot.discoveries ?? [])
      .filter(discovery => discovery.actorId === protagonistId && typeof discovery.entryId === 'string')
      .map(discovery => discovery.entryId!));
  } catch {
    return new Set();
  }
}

function validateDeltaEvidence(
  entries: readonly ContentEntry[],
  ranges: WorldPackageBuildScope['sourceRanges'],
  chapters: Awaited<ReturnType<SourceStore['getChapters']>>,
  facts: Awaited<ReturnType<SqliteWorldStore['listFacts']>>,
  worldTimeOrder: number | undefined,
  errors: string[],
): void {
  const factsById = new Map(facts.map(fact => [fact.factId, fact]));
  for (const entry of entries) {
    const provenance = [entry.provenance, ...Object.values(entry.fieldProvenance ?? {})];
    for (const [index, source] of provenance.entries()) {
      if ((source.kind === 'explicit' || source.kind === 'inferred') && source.sourceFactIds.length === 0 &&
          (source.sourceRanges?.length ?? 0) === 0) {
        errors.push(`${entry.entryId}: source-backed provenance ${index} requires at least one fact citation.`);
      }
      for (const reference of source.sourceRanges ?? []) {
        const chapter = chapters.find(item => item.chapterId === reference.chapterId);
        if (!chapter || reference.startCodePoint < chapter.startOffset || reference.endCodePoint > chapter.endOffset ||
            !ranges.some(range => range.startCodePoint === reference.startCodePoint &&
              range.endCodePoint === reference.endCodePoint &&
              range.contentSha256.toLowerCase() === reference.contentSha256.toLowerCase())) {
          errors.push(`${entry.entryId}: source passage citation ${reference.chapterId} is outside its verified delta ranges.`);
        }
      }
      for (const factId of source.sourceFactIds) {
        const fact = factsById.get(factId);
        if (!fact || fact.status === 'speculation' || fact.status === 'conflict') {
          errors.push(`${entry.entryId}: source fact ${factId} is missing, speculative or conflicted.`);
          continue;
        }
        const visibleAtAnchor = worldTimeOrder === undefined
          ? fact.validFrom === null && fact.validTo === null && fact.revealAt === null
          : isFactVisibleAtAnchor(fact, worldTimeOrder);
        if (!visibleAtAnchor) {
          errors.push(`${entry.entryId}: source fact ${factId} is beyond the campaign story-time anchor.`);
        }
        if (fact.sources.length === 0 || fact.sources.some(sourceSpan => !ranges.some(range =>
          range.startCodePoint <= sourceSpan.startOffset && range.endCodePoint >= sourceSpan.endOffset))) {
          errors.push(`${entry.entryId}: source fact ${factId} is outside this delta's cited source ranges.`);
        }
      }
    }
  }
}

function validateAllowedDeltaSourceRanges(
  ranges: WorldPackageBuildScope['sourceRanges'],
  allowed: readonly { startCodePoint: number; endCodePoint: number }[],
  errors: string[],
): void {
  for (const range of ranges) {
    if (!allowed.some(candidate => candidate.startCodePoint <= range.startCodePoint
      && candidate.endCodePoint >= range.endCodePoint)) {
      errors.push(`Source range [${range.startCodePoint},${range.endCodePoint}) is outside evidence already visible on this branch.`);
    }
  }
}

async function validateNoDeadNpcRevival(
  db: SqliteDatabase,
  branchId: string,
  stateVersion: number,
  additions: readonly ContentEntry[],
  errors: string[],
): Promise<void> {
  const actorTemplates = additions.filter(entry => entry.kind === 'actor_template');
  if (actorTemplates.length === 0) return;
  const snapshotRow = await db.queryOne<{ snapshot_json: string }>(
    'SELECT snapshot_json FROM snapshots WHERE branch_id = ? AND state_version = ?', [branchId, stateVersion],
  );
  if (!snapshotRow) return;
  let snapshot: { actors?: Record<string, { lifeStatus?: string }> };
  try { snapshot = JSON.parse(snapshotRow.snapshot_json) as typeof snapshot; }
  catch { return; }
  const cards = await db.queryAll<{ actor_id: string; card_json: string }>(
    'SELECT actor_id, card_json FROM actor_cards WHERE branch_id = ?', [branchId],
  );
  const deadNpcNames = new Set<string>();
  const deadNpcTemplateIds = new Set<string>();
  for (const row of cards) {
    if (snapshot.actors?.[row.actor_id]?.lifeStatus !== 'dead') continue;
    try {
      const card = JSON.parse(row.card_json) as { kind?: string; controller?: string; name?: string; templateId?: string };
      if (card.kind !== 'npc' && card.controller !== 'gm') continue;
      if (card.name) deadNpcNames.add(normalizeIdentity(card.name));
      if (card.templateId) deadNpcTemplateIds.add(card.templateId);
    } catch { /* malformed cards are handled by normal session recovery */ }
  }
  for (const entry of actorTemplates) {
    const name = (entry.definition as { name?: unknown }).name;
    if (deadNpcTemplateIds.has(entry.entryId) || (typeof name === 'string' && deadNpcNames.has(normalizeIdentity(name)))) {
      errors.push(`${entry.entryId}: this branch has already recorded the NPC as dead; a source delta cannot restore them.`);
    }
  }
}

function normalizeIdentity(value: string): string {
  return value.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLocaleLowerCase();
}

async function verifySourceRanges(
  sourceStore: Pick<SourceStore, 'findActiveByRawHash' | 'readRange' | 'getChapters'>,
  sha256Hex: Sha256HexProvider['sha256Hex'],
  sourceSha256: string,
  ranges: WorldPackageBuildScope['sourceRanges'],
): Promise<SourceManifest> {
  const source = await sourceStore.findActiveByRawHash(sourceSha256);
  if (!source || source.status !== 'active') throw new Error('Progressive delta source is not the active imported novel.');
  for (const range of ranges) {
    if (!Number.isSafeInteger(range.startCodePoint) || !Number.isSafeInteger(range.endCodePoint) ||
        range.startCodePoint < 0 || range.endCodePoint <= range.startCodePoint || range.endCodePoint > source.codePointCount) {
      throw new Error('Progressive delta source range is outside the active source.');
    }
    const text = await sourceStore.readRange(source.sourceId, range.startCodePoint, range.endCodePoint);
    if (codePointLength(text) !== range.endCodePoint - range.startCodePoint ||
        (await sha256Hex(text)).toLowerCase() !== range.contentSha256.toLowerCase()) {
      throw new Error('Progressive delta source range failed completeness or content-hash verification.');
    }
  }
  return source;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Progressive source lookup was canceled.');
  error.name = 'AbortError';
  throw error;
}

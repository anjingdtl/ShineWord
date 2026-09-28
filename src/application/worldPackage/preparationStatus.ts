import type { BookSection, ContentEntry, WorldPackageBuildScope, WorldPackageManifest } from '../../domain/content/types';
import type { StoredChunk, StoredFact } from '../ports/worldStore';

export type PreparationBookKey = BookSection['book'];
export type PreparationState = 'organized' | 'unorganized' | 'not_found';

export interface BookPreparationStatus {
  book: PreparationBookKey;
  state: PreparationState;
  entryCount: number;
  sourceEntryCount: number;
}

export interface WorldPreparationStatus {
  packageRevision: number;
  packageScope: WorldPackageBuildScope | null;
  sourceChunkCount: number;
  extractedChunkCount: number;
  failedChunkCount: number;
  pendingChunkCount: number;
  factCount: number;
  unmappedFactCount: number;
  fullSourceComplete: boolean;
  books: readonly BookPreparationStatus[];
}

export function sourceRangesCoverWholeText(
  ranges: readonly { startCodePoint: number; endCodePoint: number }[],
  sourceCodePointCount: number,
): boolean {
  if (!Number.isSafeInteger(sourceCodePointCount) || sourceCodePointCount <= 0 || ranges.length === 0) return false;
  const ordered = [...ranges].sort((a, b) => a.startCodePoint - b.startCodePoint || a.endCodePoint - b.endCodePoint);
  if (ordered[0]?.startCodePoint !== 0 || ordered[ordered.length - 1]?.endCodePoint !== sourceCodePointCount) return false;
  return ordered.every((range, index) => Number.isSafeInteger(range.startCodePoint)
    && Number.isSafeInteger(range.endCodePoint)
    && range.endCodePoint > range.startCodePoint
    && (index === 0 || ordered[index - 1]?.endCodePoint === range.startCodePoint));
}

/**
 * Derive book readiness from persisted coverage, citations and extraction
 * checkpoints. `not_found` only means no relevant entry is present in the
 * current mapped scope; callers must explain when the rest of the source is
 * still unscanned.
 */
export function summarizeWorldPreparation(input: {
  manifest: Pick<WorldPackageManifest, 'revision' | 'buildScope'>;
  entries: readonly ContentEntry[];
  sections: readonly BookSection[];
  facts: readonly StoredFact[];
  chunks: readonly StoredChunk[];
  sourceCodePointCount?: number;
}): WorldPreparationStatus {
  const mappableFacts = input.facts.filter(fact => fact.status === 'explicit' || fact.status === 'inference');
  const mappableFactIds = new Set(mappableFacts.map(fact => fact.factId));
  const mappedFactIds = new Set<string>();
  const sourceEntries = new Set<string>();
  const entriesById = new Map(input.entries.map(entry => [entry.entryId, entry]));
  for (const entry of input.entries) {
    const provenances = [entry.provenance, ...Object.values(entry.fieldProvenance ?? {})];
    let hasSourceEvidence = false;
    for (const provenance of provenances) {
      for (const id of provenance.sourceFactIds) {
        if (mappableFactIds.has(id)) mappedFactIds.add(id);
        hasSourceEvidence = true;
      }
      if ((provenance.sourceRanges?.length ?? 0) > 0) hasSourceEvidence = true;
    }
    if (hasSourceEvidence) sourceEntries.add(entry.entryId);
  }
  const unmappedFactCount = mappableFacts.filter(fact => !mappedFactIds.has(fact.factId)).length;
  const extractedChunkCount = input.chunks.filter(chunk => chunk.extractionStatus === 'extracted').length;
  const failedChunkCount = input.chunks.filter(chunk => chunk.extractionStatus === 'failed').length;
  const pendingChunkCount = input.chunks.filter(chunk => chunk.extractionStatus === 'pending').length;
  const scopeRanges = input.manifest.buildScope?.sourceRanges ?? [];
  const chunksByRange = [...input.chunks]
    .sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
  const chunksCoveredByScope = chunksByRange.every(chunk => {
    if (chunk.startOffset < 0 || chunk.endOffset <= chunk.startOffset) return false;
    return scopeRanges.some(range => range.startCodePoint <= chunk.startOffset
      && range.endCodePoint >= chunk.endOffset);
  });
  const fullSourceComplete = input.manifest.buildScope?.strategy === 'full'
    && input.manifest.buildScope.scope === 'whole_source'
    && input.manifest.buildScope.completeness === 'complete'
    && input.chunks.length > 0
    && input.sourceCodePointCount !== undefined
    && sourceRangesCoverWholeText(scopeRanges, input.sourceCodePointCount)
    && chunksCoveredByScope
    && extractedChunkCount === input.chunks.length
    && failedChunkCount === 0
    && pendingChunkCount === 0;
  const books = (['player_handbook', 'gm_guide', 'monster_manual'] as const).map(book => {
    const ids = new Set(input.sections.filter(section => section.book === book).flatMap(section => section.entryIds));
    const bookEntries = [...ids].filter(id => entriesById.has(id));
    const sourceEntryCount = bookEntries.filter(id => sourceEntries.has(id)).length;
    const state: PreparationState = sourceEntryCount > 0
      ? 'organized'
      : fullSourceComplete
        ? 'not_found'
        : unmappedFactCount > 0 && (extractedChunkCount > 0 || mappableFacts.length > 0)
          ? 'unorganized'
          : 'not_found';
    return { book, state, entryCount: bookEntries.length, sourceEntryCount };
  });
  return {
    packageRevision: input.manifest.revision,
    packageScope: input.manifest.buildScope ?? null,
    sourceChunkCount: input.chunks.length,
    extractedChunkCount,
    failedChunkCount,
    pendingChunkCount,
    factCount: mappableFacts.length,
    unmappedFactCount,
    fullSourceComplete,
    books,
  };
}

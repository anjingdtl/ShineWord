import type { IndexCoverageV1, SourceRangeV1 } from '../ports/phase6';
import type { SourceSearchEntity } from '../search/chineseSourceSearch';

export const PERSISTENT_SOURCE_INDEX_VERSION = 'persistent-cjk-bigram-1';
export const SOURCE_INDEX_PAGE_CP = 4_096;
export interface SourceIndexKey {
  sourceId: string; normalizedTreeHash: string; indexVersion: string; codePointCount: number;
}
export interface SourceIndexParagraph {
  startCp: number; endCp: number; chapterId: string; paragraphId: string; contentHash: string;
  terms: Readonly<Record<string, number>>;
}
export interface SourceIndexPage {
  startCp: number; endCp: number; contentHash: string; paragraphs: readonly SourceIndexParagraph[];
}
export interface SourceIndexCandidate {
  paragraphId: string; chapterId: string; startCp: number; endCp: number; contentHash: string; score: number;
}
export interface SourceIndexStore {
  coverage(key: SourceIndexKey): Promise<IndexCoverageV1>;
  commitPage(key: SourceIndexKey, page: SourceIndexPage): Promise<void>;
  invalidatePage(key: SourceIndexKey, startCp: number): Promise<void>;
  candidates(key: SourceIndexKey, ranges: readonly SourceRangeV1[], terms: readonly string[], limit: number): Promise<SourceIndexCandidate[]>;
  neighbors(key: SourceIndexKey, hit: SourceIndexCandidate, ranges: readonly SourceRangeV1[], limit: number): Promise<SourceIndexCandidate[]>;
  replaceAliases(worldId: string, fingerprint: string, entities: readonly SourceSearchEntity[]): Promise<void>;
  expandAliasTerms(worldId: string, query: string): Promise<{ terms: string[]; entityIds: string[] }>;
  countParagraphs(key: SourceIndexKey, ranges: readonly SourceRangeV1[]): Promise<number>;
  stats(): Promise<{ pageCount: number; paragraphCount: number; postingCount: number; maxPages: number }>;
}

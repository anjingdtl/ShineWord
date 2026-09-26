export type EntityType =
  | 'character'
  | 'faction'
  | 'location'
  | 'item'
  | 'ability'
  | 'rule'
  | 'event';

export const ENTITY_TYPES: readonly EntityType[] = [
  'character',
  'faction',
  'location',
  'item',
  'ability',
  'rule',
  'event',
];

export type FactStatus =
  | 'explicit'
  | 'inference'
  | 'speculation'
  | 'conflict'
  | 'user_supplement';

export const FACT_STATUSES: readonly FactStatus[] = [
  'explicit',
  'inference',
  'speculation',
  'conflict',
  'user_supplement',
];

export type EventStatus = 'canon' | 'pending' | 'invalidated';

export type BuildStatus =
  | 'importing'
  | 'extracting'
  | 'merging'
  | 'mapping'
  | 'ready'
  | 'failed';

export interface SourceChapter {
  chapterId: string;
  index: number;
  title: string;
  startOffset: number;
  endOffset: number;
  charCount: number;
  contentHash: string;
}

export interface SourceChunk {
  chunkId: string;
  chapterId: string;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  charCount: number;
  contentHash: string;
}

export type ChapterSplitStrategy = 'standard' | 'loose' | 'fallback';

export interface ParsedTxtSource {
  encoding: string;
  sourceSha256Hex: string;
  sourceByteLength: number;
  normalizeVersion: string;
  chapterSplitVersion: string;
  splitStrategy: ChapterSplitStrategy;
  text: string;
  codePointCount: number;
  chapters: SourceChapter[];
  chunks: SourceChunk[];
}

export interface EvidenceSpan {
  chapterId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
}

export interface EntityProposal {
  entityKey: string;
  type: EntityType;
  name: string;
  aliases?: readonly string[];
}

export interface FactProposal {
  subjectKey: string;
  predicate: string;
  value: Record<string, unknown>;
  status: FactStatus;
  confidence: number;
  evidence: EvidenceSpan;
  validFrom?: string | null;
  validTo?: string | null;
  revealAt?: string | null;
}

export interface EventProposal {
  eventKey: string;
  title: string;
  summary: string;
  worldTimeOrder?: number | null;
  narrativeChapterId?: string | null;
  dependsOnEventKeys?: readonly string[];
}

export interface RuleMappingProposal {
  targetKey: string;
  mappingKind: 'attribute' | 'skill' | 'power_tier' | 'resource';
  mapping: Record<string, unknown>;
  evidenceRefs: readonly string[];
}

export interface ExtractionResult {
  entities: readonly EntityProposal[];
  facts: readonly FactProposal[];
  events: readonly EventProposal[];
  ruleMappings: readonly RuleMappingProposal[];
}

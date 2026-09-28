/**
 * Segment-protocol LLM extractor for multi-chunk groups (closeout C3,
 * plan §7.1). One request carries numbered segments (one per chunk, with its
 * chapter title); the model returns facts tagged with the segment and a
 * verbatim quote. Local code resolves quote -> segment-relative offset ->
 * absolute code point span, so evidence validation still holds without the
 * model ever seeing or emitting offsets.
 */
import type {
  EntityProposal,
  EventProposal,
  ExtractionResult,
  FactProposal,
  RuleMappingProposal,
} from '../../domain/world/types';
import { codePointLength } from '../../domain/world/textOffsets';
import { LlmRequestFailure, type LlmPhysicalRequestMetric, type LlmRequest } from '../../application/llm/types';
import type { LlmCompleteFn } from './llmExtractor';
import { parseExtractorJson } from './llmExtractor';

export const LLM_GROUP_EXTRACTOR_VERSION = 'llm-group-extractor-1';
export const DEFAULT_GROUP_MAX_OUTPUT_TOKENS = 8_000;

const GROUP_SYSTEM = [
  'You are ShineWord Extractor. You read several numbered segments of a Chinese novel and output exactly one JSON object, no prose.',
  'Each segment header looks like [S<segmentNumber> <chapterTitle>].',
  'Schema: {"entities":[{"key":string,"type":"character|faction|location|item|ability|rule|event","name":string,"aliases":string[]}],',
  '"facts":[{"subject":string,"predicate":string,"value":object,"status":"explicit|inference|speculation","confidence":number,"segment":number,"quote":string}],',
  '"events":[{"key":string,"title":string,"summary":string,"order":number|null,"segment":number,"dependsOn":string[]}],',
  '"ruleMappings":[{"target":string,"kind":"attribute|skill|power_tier|resource","mapping":object,"evidenceQuotes":string[]}]}',
  'Rules:',
  '- subject/predicate targets must be entity keys you listed.',
  '- segment is the 1-based segment number the fact was found in; quote MUST be a verbatim contiguous substring of THAT segment.',
  '- status "explicit" only for directly stated facts; "inference" for safe conclusions; "speculation" for guesses.',
  '- Never invent facts, never mix segments, never output offsets.',
].join('\n');

export interface GroupSegmentInput {
  chunkId: string;
  chapterId: string;
  chapterTitle: string;
  startCp: number;
  text: string;
}

export interface GroupExtractInput {
  unitId: string;
  segments: readonly GroupSegmentInput[];
  worldId: string;
}

interface RawGroupFact {
  subject?: unknown;
  predicate?: unknown;
  value?: unknown;
  status?: unknown;
  confidence?: unknown;
  segment?: unknown;
  quote?: unknown;
}

interface RawGroupExtraction {
  entities?: Array<{ key?: unknown; type?: unknown; name?: unknown; aliases?: unknown }>;
  facts?: RawGroupFact[];
  events?: Array<{ key?: unknown; title?: unknown; summary?: unknown; order?: unknown; segment?: unknown; dependsOn?: unknown }>;
  ruleMappings?: Array<{ target?: unknown; kind?: unknown; mapping?: unknown; evidenceQuotes?: unknown }>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The resolved extraction additionally remembers WHICH chunk each fact's
 * evidence came from, so group commits can partition per chunk exactly.
 */
export interface GroupResolvedFact extends FactProposal {
  chunkId: string;
}

export interface GroupExtractionResult {
  entities: EntityProposal[];
  facts: GroupResolvedFact[];
  events: Array<EventProposal & { chunkId: string }>;
  ruleMappings: RuleMappingProposal[];
  /** Facts dropped because the quote did not exist in the claimed segment. */
  rejectedQuotes: number;
  /** Redacted timings and token counts for each physical provider attempt. */
  requestMetrics?: readonly LlmPhysicalRequestMetric[];
}

export class LlmGroupExtractor {
  readonly version = LLM_GROUP_EXTRACTOR_VERSION;

  constructor(
    private readonly complete: LlmCompleteFn,
    private readonly maxOutputTokens = DEFAULT_GROUP_MAX_OUTPUT_TOKENS,
  ) {}

  async extract(input: GroupExtractInput): Promise<GroupExtractionResult> {
    const body = input.segments.map((segment, index) => {
      const header = `[S${index + 1} ${segment.chapterTitle}]`;
      return `${header}\n${segment.text}`;
    }).join('\n\n');
    const request: LlmRequest = {
      role: 'Extractor',
      system: GROUP_SYSTEM,
      user: body,
      maxOutputTokens: this.maxOutputTokens,
      jsonMode: true,
    };
    const response = await this.complete(request);
    let raw: RawGroupExtraction;
    try {
      raw = parseExtractorJson(response.text) as RawGroupExtraction;
    } catch (error) {
      if (response.requestMetrics?.length) {
        throw new LlmRequestFailure(error instanceof Error ? error.message : 'Group extraction JSON was invalid.', response.requestMetrics);
      }
      throw error;
    }

    const entities: EntityProposal[] = [];
    for (const candidate of raw.entities ?? []) {
      const key = asString(candidate.key);
      const name = asString(candidate.name);
      const type = asString(candidate.type);
      if (!key || !name || !type) continue;
      if (!['character', 'faction', 'location', 'item', 'ability', 'rule', 'event'].includes(type)) continue;
      entities.push({
        entityKey: key,
        type: type as EntityProposal['type'],
        name,
        aliases: Array.isArray(candidate.aliases)
          ? candidate.aliases.filter((alias): alias is string => typeof alias === 'string' && alias.trim().length > 0)
          : [],
      });
    }

    const facts: GroupResolvedFact[] = [];
    let rejectedQuotes = 0;
    for (const candidate of raw.facts ?? []) {
      const subject = asString(candidate.subject);
      const predicate = asString(candidate.predicate);
      const quote = asString(candidate.quote);
      const status = asString(candidate.status);
      const segmentNumber = typeof candidate.segment === 'number' ? candidate.segment : 0;
      const segment = input.segments[segmentNumber - 1];
      if (!subject || !predicate || !quote || !status || !segment) continue;
      if (!['explicit', 'inference', 'speculation', 'conflict', 'user_supplement'].includes(status)) continue;
      // Local resolution inside the claimed segment only - a quote that
      // exists elsewhere but not in this segment is rejected, not relocated.
      const rel = segment.text.indexOf(quote);
      if (rel === -1) {
        rejectedQuotes += 1;
        continue;
      }
      const absStart = segment.startCp + codePointLength(segment.text.slice(0, rel));
      const absEnd = absStart + codePointLength(quote);
      const value = candidate.value && typeof candidate.value === 'object' && !Array.isArray(candidate.value)
        ? candidate.value as Record<string, unknown>
        : {};
      facts.push({
        subjectKey: subject,
        predicate,
        value,
        status: status as FactProposal['status'],
        confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 0.8,
        evidence: {
          chapterId: segment.chapterId,
          startOffset: absStart,
          endOffset: absEnd,
          quote,
        },
        chunkId: segment.chunkId,
      });
    }

    const events: Array<EventProposal & { chunkId: string }> = [];
    for (const candidate of raw.events ?? []) {
      const key = asString(candidate.key);
      const title = asString(candidate.title);
      const summary = asString(candidate.summary);
      const segmentNumber = typeof candidate.segment === 'number' ? candidate.segment : 0;
      const segment = input.segments[segmentNumber - 1];
      if (!key || !title || !summary || !segment) continue;
      events.push({
        eventKey: key,
        title,
        summary,
        worldTimeOrder: typeof candidate.order === 'number' ? candidate.order : null,
        narrativeChapterId: segment.chapterId,
        dependsOnEventKeys: Array.isArray(candidate.dependsOn)
          ? candidate.dependsOn.filter((dep): dep is string => typeof dep === 'string')
          : [],
        chunkId: segment.chunkId,
      });
    }

    const ruleMappings: RuleMappingProposal[] = [];
    for (const candidate of raw.ruleMappings ?? []) {
      const target = asString(candidate.target);
      const kind = asString(candidate.kind);
      if (!target || !kind) continue;
      if (!['attribute', 'skill', 'power_tier', 'resource'].includes(kind)) continue;
      ruleMappings.push({
        targetKey: target,
        mappingKind: kind as RuleMappingProposal['mappingKind'],
        mapping: candidate.mapping && typeof candidate.mapping === 'object' && !Array.isArray(candidate.mapping)
          ? candidate.mapping as Record<string, unknown>
          : {},
        evidenceRefs: Array.isArray(candidate.evidenceQuotes)
          ? candidate.evidenceQuotes.filter((ref): ref is string => typeof ref === 'string')
          : [],
      });
    }

    return { entities, facts, events, ruleMappings, rejectedQuotes, requestMetrics: response.requestMetrics };
  }
}

/** Adapter to the plain ExtractionResult shape for the C1 apply pipeline. */
export function toExtractionResult(group: GroupExtractionResult): ExtractionResult {
  return {
    entities: group.entities,
    facts: group.facts.map(({ chunkId: _chunkId, ...fact }) => fact),
    events: group.events.map(({ chunkId: _chunkId, ...event }) => event),
    ruleMappings: group.ruleMappings,
  };
}

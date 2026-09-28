import type { ChunkExtractor } from './buildWorld';
import type {
  EntityProposal,
  EventProposal,
  ExtractionResult,
  FactProposal,
  RuleMappingProposal,
} from '../../domain/world/types';
import type { StoredChunk } from '../../application/ports/worldStore';
import { LlmRequestFailure, type LlmRequest, type LlmResponse } from '../../application/llm/types';
import { codePointLength } from '../../domain/world/textOffsets';

export const LLM_EXTRACTOR_VERSION = 'llm-extractor-1';
export const DEFAULT_LLM_EXTRACTOR_MAX_OUTPUT_TOKENS = 8000;

const EXTRACTOR_SYSTEM = [
  'You are ShineWord Extractor. You read one chunk of a Chinese novel and output exactly one JSON object, no prose.',
  'Schema: {"entities":[{"key":string,"type":"character|faction|location|item|ability|rule|event","name":string,"aliases":string[]}],',
  '"facts":[{"subject":string,"predicate":string,"value":object,"status":"explicit|inference|speculation","confidence":number,"quote":string}],',
  '"events":[{"key":string,"title":string,"summary":string,"order":number|null,"dependsOn":string[]}],',
  '"ruleMappings":[{"target":string,"kind":"attribute|skill|power_tier|resource","mapping":object,"evidenceQuotes":string[]}]}',
  'Rules:',
  '- subject/predicate targets must be entity keys you listed.',
  '- quote MUST be a verbatim contiguous substring of the chunk text supporting the fact.',
  '- status "explicit" only for directly stated facts; "inference" for safe conclusions; "speculation" for guesses.',
  '- Never invent facts, never copy other chunks, never output offsets.',
].join('\n');

interface RawFact {
  subject?: unknown;
  predicate?: unknown;
  value?: unknown;
  status?: unknown;
  confidence?: unknown;
  quote?: unknown;
}

interface RawExtraction {
  entities?: Array<{ key?: unknown; type?: unknown; name?: unknown; aliases?: unknown }>;
  facts?: RawFact[];
  events?: Array<{ key?: unknown; title?: unknown; summary?: unknown; order?: unknown; dependsOn?: unknown }>;
  ruleMappings?: Array<{ target?: unknown; kind?: unknown; mapping?: unknown; evidenceQuotes?: unknown }>;
}

export interface LlmCompleteFn {
  (request: LlmRequest): Promise<LlmResponse>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function parseExtractorJson(text: string): RawExtraction {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Extractor output does not contain a JSON object.');
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as RawExtraction;
}

/**
 * LLM-backed chunk extractor. The model only supplies verbatim quotes; local
 * code resolves quotes to absolute code point offsets, so every stored fact
 * still passes evidence validation against the immutable source.
 */
export class LlmChunkExtractor implements ChunkExtractor {
  readonly version = LLM_EXTRACTOR_VERSION;

  constructor(
    private readonly complete: LlmCompleteFn,
    private readonly maxOutputTokens = DEFAULT_LLM_EXTRACTOR_MAX_OUTPUT_TOKENS,
  ) {}

  async extract({ chunk, chunkText }: { chunk: StoredChunk; chunkText: string; worldId: string }): Promise<ExtractionResult> {
    const response = await this.complete({
      role: 'Extractor',
      system: EXTRACTOR_SYSTEM,
      user: JSON.stringify({
        chapterId: chunk.chapterId,
        chunkId: chunk.chunkId,
        text: chunkText,
      }),
      maxOutputTokens: this.maxOutputTokens,
      jsonMode: true,
    });

    let raw: RawExtraction;
    try {
      raw = parseExtractorJson(response.text);
    } catch (error) {
      if (response.requestMetrics?.length) {
        throw new LlmRequestFailure(error instanceof Error ? error.message : 'Extractor JSON was invalid.', response.requestMetrics);
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

    const facts: FactProposal[] = [];
    for (const candidate of raw.facts ?? []) {
      const subject = asString(candidate.subject);
      const predicate = asString(candidate.predicate);
      const quote = asString(candidate.quote);
      const status = asString(candidate.status);
      if (!subject || !predicate || !quote || !status) continue;
      if (!['explicit', 'inference', 'speculation', 'conflict', 'user_supplement'].includes(status)) continue;
      // Local offset resolution: the model never supplies offsets. Quotes that
      // do not exist in the chunk get an empty span so evidence validation
      // rejects them visibly instead of the fact being silently trusted.
      const rel = chunkText.indexOf(quote);
      const absStart = rel === -1
        ? chunk.startOffset
        : chunk.startOffset + codePointLength(chunkText.slice(0, rel));
      const absEnd = rel === -1
        ? chunk.startOffset
        : absStart + codePointLength(quote);
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
          chapterId: chunk.chapterId,
          startOffset: absStart,
          endOffset: absEnd,
          quote,
        },
      });
    }

    const events: EventProposal[] = [];
    for (const candidate of raw.events ?? []) {
      const key = asString(candidate.key);
      const title = asString(candidate.title);
      const summary = asString(candidate.summary);
      if (!key || !title || !summary) continue;
      events.push({
        eventKey: key,
        title,
        summary,
        worldTimeOrder: typeof candidate.order === 'number' ? candidate.order : null,
        narrativeChapterId: chunk.chapterId,
        dependsOnEventKeys: Array.isArray(candidate.dependsOn)
          ? candidate.dependsOn.filter((dep): dep is string => typeof dep === 'string')
          : [],
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

    return { entities, facts, events, ruleMappings };
  }
}

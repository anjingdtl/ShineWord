/**
 * Segment-protocol LLM extractor for multi-chunk groups (closeout C3,
 * plan §7.1; resident variant per 1M plan §4.2). One request carries numbered
 * segments (one per chunk, with its chapter title); the model returns facts
 * tagged with the segment and a verbatim quote. Local code resolves quote ->
 * segment-relative offset -> absolute code point span, so evidence
 * validation still holds without the model ever seeing or emitting offsets.
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
import type { ReasoningEffort } from '../worldBuild/groupPlanner';
import type { LlmCompleteFn } from './llmExtractor';
import { parseExtractorJson } from './llmExtractor';

export const LLM_GROUP_EXTRACTOR_VERSION = 'llm-group-extractor-1';
/**
 * Fallback content output cap when no budget is injected. The legacy 8k hard
 * clamp is gone (1M plan §5): production always injects the profile-derived
 * budget (maxContentOutputTokens + reasoningReserveTokens).
 */
export const DEFAULT_GROUP_CONTENT_OUTPUT_TOKENS = 16_384;

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

/**
 * Resident mode (1M plan §4.2): message 1 is this static system prompt,
 * message 2 is the WHOLE book as numbered segments - byte-stable across all
 * units of a run so provider prefix caches hit - and message 3 is the per-unit
 * scope instruction.
 */
const RESIDENT_SYSTEM = [
  'You are ShineWord Resident Extractor. You read the WHOLE Chinese novel provided as numbered segments (each header looks like [S<segmentNumber> <chapterTitle>]) and output exactly one JSON object, no prose.',
  'The FINAL user message restricts WHICH segment range this request covers; extract ONLY inside that range.',
  'Schema: {"entities":[{"key":string,"type":"character|faction|location|item|ability|rule|event","name":string,"aliases":string[]}],',
  '"facts":[{"subject":string,"predicate":string,"value":object,"status":"explicit|inference|speculation","confidence":number,"segment":number,"quote":string}],',
  '"events":[{"key":string,"title":string,"summary":string,"order":number|null,"segment":number,"dependsOn":string[]}],',
  '"ruleMappings":[{"target":string,"kind":"attribute|skill|power_tier|resource","mapping":object,"evidenceQuotes":string[]}]}',
  'Rules:',
  '- subject/predicate targets must be entity keys you listed; when the final message provides an entity registry, prefer its keys.',
  '- segment is the GLOBAL 1-based segment number the fact was found in and MUST be inside the requested range; quote MUST be a verbatim contiguous substring of THAT segment.',
  '- status "explicit" only for directly stated facts; "inference" for safe conclusions; "speculation" for guesses.',
  '- Never invent facts, never mix segments, never output offsets, never extract outside the requested range.',
].join('\n');

export interface GroupSegmentInput {
  chunkId: string;
  chapterId: string;
  chapterTitle: string;
  startCp: number;
  text: string;
}

/**
 * Route focus (unified P1 §4): 'characters' emphasizes people, factions,
 * relationships, states and skill clues; 'world' emphasizes places, items,
 * rules, events and the timeline. Routes are PROMPT emphasis only - both
 * routes share the exact schema, evidence validation and commit path, and a
 * single-route run extracts everything in one pass.
 */
export type ExtractRoute = 'characters' | 'world';

const ROUTE_FOCUS: Record<ExtractRoute, string> = {
  characters: [
    'Route focus: PEOPLE. Prioritize characters and factions as entities; relationship, state, identity, ability/skill-clue and circumstance facts about them.',
    'Locations/items/rules are only worth a fact when a person\'s situation depends on them; skip standalone worldbuilding.',
  ].join('\n'),
  world: [
    'Route focus: WORLD. Prioritize locations, items, rules/constraints and events; setting, geography, factions-as-institutions, resources and the timeline of what happens.',
    'Personal relationship minutiae between characters is the other route\'s job; only keep person facts that change the world state.',
  ].join('\n'),
};

export interface GroupExtractInput {
  unitId: string;
  segments: readonly GroupSegmentInput[];
  worldId: string;
  /** Per-call output cap override (e.g. a reasoning-reserve bump retry). */
  maxOutputTokens?: number;
  /** Per-call reasoning effort override. */
  reasoningEffort?: ReasoningEffort;
  /** Route focus (dual-route runs); omit for full-scope extraction. */
  route?: ExtractRoute;
}

export interface ResidentExtractInput {
  unitId: string;
  /**
   * ALL book segments with GLOBAL numbering - the coordinator passes the SAME
   * array for every unit of a run so the message-2 prefix stays byte-stable
   * (1M plan §4.2, no per-unit assembly drift allowed).
   */
  segments: readonly GroupSegmentInput[];
  /** Inclusive 1-based GLOBAL segment range this unit extracts. */
  scope: { firstSegment: number; lastSegment: number };
  worldId: string;
  /** Compact Pass-0 registry summary: entity keys to prefer (plan §4.3). */
  registrySummary?: string;
  /** Per-call output cap override (e.g. a reasoning-reserve bump retry). */
  maxOutputTokens?: number;
  /** Per-call reasoning effort override. */
  reasoningEffort?: ReasoningEffort;
  /** Route focus (dual-route runs); omit for full-scope extraction. */
  route?: ExtractRoute;
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
    private readonly maxOutputTokens = DEFAULT_GROUP_CONTENT_OUTPUT_TOKENS,
    private readonly reasoningEffort: ReasoningEffort = 'off',
  ) {}

  async extract(input: GroupExtractInput): Promise<GroupExtractionResult> {
    const body = this.buildSegmentBody(input.segments);
    const system = input.route ? `${GROUP_SYSTEM}\n${ROUTE_FOCUS[input.route]}` : GROUP_SYSTEM;
    const request: LlmRequest = {
      role: 'Extractor',
      system,
      user: body,
      maxOutputTokens: input.maxOutputTokens ?? this.maxOutputTokens,
      reasoningEffort: input.reasoningEffort ?? this.reasoningEffort,
      jsonMode: true,
    };
    const response = await this.complete(request);
    return this.parseResponse(response, input.segments);
  }

  /**
   * Resident extraction (1M plan §4.2): the whole book rides as a byte-stable
   * user message; only the final scope instruction varies per unit. Local
   * resolution still validates every quote against the claimed segment and
   * drops anything outside the requested scope (defense in depth).
   */
  async extractResident(input: ResidentExtractInput): Promise<GroupExtractionResult> {
    if (input.scope.firstSegment < 1 || input.scope.lastSegment > input.segments.length
      || input.scope.firstSegment > input.scope.lastSegment) {
      throw new Error('Resident extract scope is outside the book segment range.');
    }
    const body = this.buildSegmentBody(input.segments);
    const system = input.route ? `${RESIDENT_SYSTEM}\n${ROUTE_FOCUS[input.route]}` : RESIDENT_SYSTEM;
    const instruction = [
      `仅抽取第 ${input.scope.firstSegment}..${input.scope.lastSegment} 段（全书共 ${input.segments.length} 段）范围内的事实、实体与事件。`,
      `segment 字段必须取 ${input.scope.firstSegment} 到 ${input.scope.lastSegment} 之间的值。`,
      '其余段落仅用于消歧参考，不得输出其中的内容。',
    ];
    if (input.registrySummary) {
      instruction.push(`实体 key 优先使用注册表中已有的 key：${input.registrySummary}`);
    }
    const request: LlmRequest = {
      role: 'Extractor',
      system,
      user: body,
      maxOutputTokens: input.maxOutputTokens ?? this.maxOutputTokens,
      reasoningEffort: input.reasoningEffort ?? this.reasoningEffort,
      jsonMode: true,
      followUpUserMessages: [instruction.join('\n')],
    };
    const response = await this.complete(request);
    return this.parseResponse(response, input.segments, input.scope);
  }

  private buildSegmentBody(segments: readonly GroupSegmentInput[]): string {
    return segments.map((segment, index) => {
      const header = `[S${index + 1} ${segment.chapterTitle}]`;
      return `${header}\n${segment.text}`;
    }).join('\n\n');
  }

  private async parseResponse(
    response: { text: string; requestMetrics?: readonly LlmPhysicalRequestMetric[] },
    segments: readonly GroupSegmentInput[],
    scope?: { firstSegment: number; lastSegment: number },
  ): Promise<GroupExtractionResult> {
    let raw: RawGroupExtraction;
    try {
      raw = parseExtractorJson(response.text) as RawGroupExtraction;
    } catch (error) {
      if (response.requestMetrics?.length) {
        throw new LlmRequestFailure(error instanceof Error ? error.message : 'Group extraction JSON was invalid.', response.requestMetrics);
      }
      throw error;
    }
    const inScope = (segmentNumber: number): boolean =>
      scope ? segmentNumber >= scope.firstSegment && segmentNumber <= scope.lastSegment : true;

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
      const segment = segments[segmentNumber - 1];
      if (!subject || !predicate || !quote || !status || !segment) continue;
      if (!['explicit', 'inference', 'speculation', 'conflict', 'user_supplement'].includes(status)) continue;
      if (!inScope(segmentNumber)) {
        // Resident defense in depth: the model answered outside the requested
        // range - drop it, another unit owns that range.
        rejectedQuotes += 1;
        continue;
      }
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
      const segment = segments[segmentNumber - 1];
      if (!key || !title || !summary || !segment) continue;
      if (!inScope(segmentNumber)) continue;
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

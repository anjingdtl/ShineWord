/**
 * Structured-output pipeline (infrastructure plan §40):
 *
 *   raw provider content
 *     -> strip reasoning wrappers
 *     -> markdown fence
 *     -> balanced JSON candidates
 *     -> parse + safe repairs (trailing comma, double decoding)
 *     -> field/enum alias normalization (whitelist)
 *     -> caller validator (schema + semantic + authority)
 *
 * Transport-level tolerance, business-level strictness: a candidate only
 * succeeds when the caller's validator accepts it, so repairs can never
 * smuggle semantic garbage past assertValidActionContract() (plan §48).
 */

import {
  applyEnumAliases,
  applyFieldAliases,
  decodeDoubleEncoded,
  findBalancedJsonSpans,
  looksTruncated,
  repairTrailingCommas,
  stripMarkdownFence,
  stripReasoningWrappers,
} from './responseNormalizer';

export type StructuredFailureCode =
  | 'no_json_found'
  | 'json_invalid'
  | 'json_truncated'
  | 'schema_invalid';

export class StructuredParseError extends Error {
  constructor(
    message: string,
    readonly code: StructuredFailureCode,
    readonly repairSteps: readonly string[],
  ) {
    super(message);
    this.name = 'StructuredParseError';
  }
}

export interface StructuredParseOptions {
  label: string;
  /** alias key -> canonical key; promoted only when canonical is absent. */
  fieldAliases?: Record<string, string>;
  /** field -> observed value -> canonical value (whitelist only). */
  enumAliases?: Record<string, Record<string, string>>;
  /** Schema/semantic/authority gate; throws to reject a candidate. */
  validate?: (value: unknown) => void;
}

export interface StructuredParseResult<T> {
  value: T;
  /** Human-readable repair log for traces and tests. */
  repairSteps: readonly string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Candidate {
  text: string;
  origin: string;
}

/**
 * Parses one structured object out of raw provider content. Throws
 * StructuredParseError with a precise code so callers can distinguish
 * truncation (retry with more output budget) from absent JSON (repair
 * prompt) from schema rejection (business failure).
 */
export function parseStructuredOutput<T>(raw: string, options: StructuredParseOptions): StructuredParseResult<T> {
  const repairSteps: string[] = [];
  const cleaned = stripReasoningWrappers(raw);
  if (cleaned !== raw) repairSteps.push('strip_reasoning_wrapper');

  // Candidate order mirrors provider behaviour frequency: direct strict JSON,
  // fenced block, balanced spans from mixed prose.
  const candidates: Candidate[] = [{ text: cleaned.trim(), origin: 'direct' }];
  const { fenced, remainder } = stripMarkdownFence(cleaned);
  if (fenced) {
    candidates.push({ text: fenced, origin: 'fence' });
    repairSteps.push('strip_markdown_fence');
  }
  for (const span of findBalancedJsonSpans(remainder)) {
    if (span.isObject) {
      candidates.push({ text: span.text, origin: 'balanced' });
    }
  }
  if (fenced && candidates.length <= 2) {
    // Fenced content that itself failed balance may still parse after repair.
  }

  const errors: string[] = [];
  for (const candidate of candidates) {
    for (const text of [candidate.text, repairTrailingCommas(candidate.text) ?? '']) {
      if (!text.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      if (text !== candidate.text) repairSteps.push('repair_trailing_comma');

      const decoded = decodeDoubleEncoded(parsed);
      if (decoded !== parsed) repairSteps.push('decode_double_encoded');
      if (!isPlainObject(decoded)) continue;

      let normalized: unknown = decoded;
      if (options.fieldAliases) {
        const aliased = applyFieldAliases(normalized, options.fieldAliases);
        normalized = aliased.value;
        repairSteps.push(...aliased.applied.map(step => `alias:${step}`));
      }
      if (options.enumAliases) {
        const enumed = applyEnumAliases(normalized, options.enumAliases);
        normalized = enumed.value;
        repairSteps.push(...enumed.applied.map(step => `enum:${step}`));
      }

      if (options.validate) {
        try {
          options.validate(normalized);
        } catch (error) {
          errors.push(`${candidate.origin}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      }
      return { value: normalized as T, repairSteps };
    }
  }

  if (options.validate && errors.length > 0 && candidates.some(item => item.text.trim().startsWith('{'))) {
    throw new StructuredParseError(
      `${options.label} failed validation after normalization: ${errors[0]}`,
      'schema_invalid',
      repairSteps,
    );
  }
  if (looksTruncated(cleaned)) {
    throw new StructuredParseError(
      `${options.label} JSON appears truncated (unbalanced at end of output).`,
      'json_truncated',
      repairSteps,
    );
  }
  const sawBrace = cleaned.includes('{');
  throw new StructuredParseError(
    sawBrace
      ? `${options.label} contained JSON that could not be parsed safely.`
      : `${options.label} returned no JSON object.`,
    sawBrace ? 'json_invalid' : 'no_json_found',
    repairSteps,
  );
}

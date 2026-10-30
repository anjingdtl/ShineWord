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
  repairVendorStructuralArtifacts,
  stripMarkdownFence,
  stripReasoningWrappers,
  type StructuralRepairOptions,
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
  /**
   * Vendor structural repair (final-closeout R4): declares the schema
   * vocabulary that licenses the deterministic form-A/form-B repairs for
   * MiniMax-class malformed JSON. Callers that do not declare it keep the
   * exact pre-existing behaviour (no repair attempted).
   */
  structuralRepair?: StructuralRepairOptions;
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

  /** Attempts one candidate: parse, safe repairs, aliases, validation. */
  const attemptCandidate = (text: string, origin: string): { value: T; steps: string[] } | { error: string } => {
    for (const variant of [text, repairTrailingCommas(text) ?? '']) {
      if (!variant.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(variant);
      } catch {
        continue;
      }
      const steps = text !== variant ? ['repair_trailing_comma'] : [];

      const decoded = decodeDoubleEncoded(parsed);
      if (decoded !== parsed) steps.push('decode_double_encoded');
      if (!isPlainObject(decoded)) continue;

      let normalized: unknown = decoded;
      if (options.fieldAliases) {
        const aliased = applyFieldAliases(normalized, options.fieldAliases);
        normalized = aliased.value;
        steps.push(...aliased.applied.map(step => `alias:${step}`));
      }
      if (options.enumAliases) {
        const enumed = applyEnumAliases(normalized, options.enumAliases);
        normalized = enumed.value;
        steps.push(...enumed.applied.map(step => `enum:${step}`));
      }

      if (options.validate) {
        try {
          options.validate(normalized);
        } catch (error) {
          return { error: `${origin}: ${error instanceof Error ? error.message : String(error)}` };
        }
      }
      return { value: normalized as T, steps };
    }
    return { error: `${origin}: not parseable` };
  };

  const errors: string[] = [];
  for (const candidate of candidates) {
    const attempt = attemptCandidate(candidate.text, candidate.origin);
    if ('value' in attempt) {
      return { value: attempt.value, repairSteps: [...repairSteps, ...attempt.steps] };
    }
    if (!/not parseable/.test(attempt.error)) errors.push(attempt.error);
  }

  if (options.structuralRepair) {
    const repairedText = repairVendorStructuralArtifacts(cleaned, options.structuralRepair);
    if (repairedText !== null && repairedText !== cleaned.trim()) {
      const attempt = attemptCandidate(repairedText, 'vendor_repair');
      if ('value' in attempt) {
        return { value: attempt.value, repairSteps: [...repairSteps, 'repair_vendor_structural_artifacts', ...attempt.steps] };
      }
      if (!/not parseable/.test(attempt.error)) errors.push(attempt.error);
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

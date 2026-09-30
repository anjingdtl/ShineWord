/**
 * Provider-response normalization (infrastructure plan §39-§47).
 *
 * Lenient at the MODEL BOUNDARY only: reasoning wrappers, markdown fences,
 * prose around JSON, trailing commas and double encoding are repaired HERE;
 * schema/semantic/authority validation stays strict downstream. No business
 * field is ever invented (plan §77).
 */

/** Known chain-of-thought wrappers some providers inline into `content`. */
const REASONING_WRAPPERS: ReadonlyArray<{ open: string; close: string }> = [
  { open: '<think>', close: '</think>' },
  { open: '<thinking>', close: '</thinking>' },
  { open: '<reasoning>', close: '</reasoning>' },
];

/** Strips well-known reasoning wrapper blocks (case-insensitive). */
export function stripReasoningWrappers(text: string): string {
  let result = text;
  for (const { open, close } of REASONING_WRAPPERS) {
    const pattern = new RegExp(`${open}([\\s\\S]*?)${close}`, 'gi');
    result = result.replace(pattern, '');
  }
  return result;
}

export interface FenceExtraction {
  /** Content inside the first ``` fence, when present. */
  fenced: string | null;
  /** The text to scan for balanced JSON after fence handling. */
  remainder: string;
}

/** Extracts fenced blocks (```json ... ``` or ``` ... ```). */
export function stripMarkdownFence(text: string): FenceExtraction {
  const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (!match || match[1] === undefined) return { fenced: null, remainder: text };
  return { fenced: match[1].trim(), remainder: text };
}

export interface BalancedSpan {
  text: string;
  /** Character start offset in the scanned input. */
  start: number;
  isObject: boolean;
}

/**
 * Finds balanced top-level JSON object/array spans with full string and
 * escape awareness. Replaces the old indexOf('{')/lastIndexOf('}') trick:
 * braces inside string literals never count, nested structures stay whole,
 * and prose before/after the payload is ignored.
 */
export function findBalancedJsonSpans(input: string, maxSpans = 4): BalancedSpan[] {
  const spans: BalancedSpan[] = [];
  const stack: Array<{ openIndex: number; opener: '{' | '[' }> = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      escaped = false;
      continue;
    }
    if (ch === '{' || ch === '[') {
      // Only top-level openers become candidate spans; an opener inside an
      // existing span belongs to that span.
      if (stack.length === 0 && spans.length < maxSpans) {
        stack.push({ openIndex: i, opener: ch });
      } else if (stack.length > 0) {
        stack.push({ openIndex: -1, opener: ch });
      }
      continue;
    }
    if (ch === '}' || ch === ']') {
      const top = stack.pop();
      if (top && top.openIndex >= 0) {
        const closer = ch === '}' ? '}' : ']';
        const expected = top.opener === '{' ? '}' : ']';
        if (closer === expected) {
          spans.push({
            text: input.slice(top.openIndex, i + 1),
            start: top.openIndex,
            isObject: top.opener === '{',
          });
        }
      }
      continue;
    }
  }
  return spans;
}

/**
 * Removes trailing commas before } or ] - outside string literals only.
 * Returns null when no repair was needed.
 */
export function repairTrailingCommas(text: string): string | null {
  let inString = false;
  let escaped = false;
  let repaired = '';
  let changed = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      repaired += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      repaired += ch;
      continue;
    }
    if (ch === ',') {
      // Look ahead past whitespace for the closer.
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] ?? '')) j += 1;
      const lookahead = j < text.length ? text[j] : undefined;
      if (lookahead === '}' || lookahead === ']') {
        changed = true; // drop the comma (and keep the whitespace as-is)
        continue;
      }
    }
    repaired += ch;
  }
  return changed ? repaired : null;
}

export const MAX_DOUBLE_DECODE_LAYERS = 2;

/**
 * Unwraps double-encoded JSON: '"{\"a\":1}"' -> the object. At most 2 layers
 * (plan §45); returns null when the value is not a JSON-encoded string.
 */
export function decodeDoubleEncoded(value: unknown, layers = MAX_DOUBLE_DECODE_LAYERS): unknown | null {
  let current = value;
  for (let layer = 0; layer < layers; layer += 1) {
    if (typeof current !== 'string') return current;
    const trimmed = current.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return current;
    try {
      current = JSON.parse(trimmed);
    } catch {
      return current;
    }
  }
  return current;
}

/**
 * Field-alias promotion (plan §46): whitelist only, alias promoted ONLY when
 * the canonical key is absent at that level - a model-provided canonical
 * field always wins. Applied recursively to nested plain objects and arrays.
 */
export function applyFieldAliases(
  value: unknown,
  aliases: Record<string, string>,
): { value: unknown; applied: string[] } {
  const applied: string[] = [];
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (node === null || typeof node !== 'object') return node;
    const source = node as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(source)) {
      const canonical = aliases[key];
      if (canonical && !(canonical in source) && !(canonical in result)) {
        result[canonical] = visit(val);
        applied.push(`${key}->${canonical}`);
      } else {
        result[key] = visit(val);
      }
    }
    return result;
  };
  return { value: visit(value), applied };
}

/**
 * Known enum alias normalization (plan §47): whitelist per field; values are
 * only remapped when the field currently holds exactly the aliased string.
 */
export function applyEnumAliases(
  value: unknown,
  enumAliases: Record<string, Record<string, string>>,
): { value: unknown; applied: string[] } {
  const applied: string[] = [];
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (node === null || typeof node !== 'object') return node;
    const source = node as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(source)) {
      const map = enumAliases[key];
      if (map && typeof val === 'string' && val in map) {
        result[key] = map[val];
        applied.push(`${key}:${val}->${map[val]}`);
      } else {
        result[key] = visit(val);
      }
    }
    return result;
  };
  return { value: visit(value), applied };
}

/** True when the input looks like JSON that simply never finished. */
export function looksTruncated(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  // Unbalanced until EOF with no repairable trailing comma is the classic
  // finish_reason=length truncation signature (plan §76).
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of trimmed) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
  }
  return depth > 0;
}

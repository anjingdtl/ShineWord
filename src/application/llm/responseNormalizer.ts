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
 * Vendor structural repair (final-closeout V1.1.1, R4): MiniMax-M3.1-class
 * long-thinking generations deterministically emit two JSON artifacts that
 * GLM/DeepSeek do not, both on HTTP 200 / finish_reason=stop responses:
 *   Form A: a dropped closing quote of a known schema key (`"quote":"v"`
 *           emitted as `"quote:v"`), which cascades into unparseable JSON.
 *   Form B: a missing closing brace of a nested object inside an array
 *           element (`"mapping":{"functions":[...],"evidenceQuotes":[...]}`),
 *           which misnests the following keys and breaks the element.
 * Both repairs are SYNTACTIC ONLY - form A is whitelist-bound to the caller's
 * declared key vocabulary, form B only inserts a brace where no valid JSON can
 * exist without one - and run only after strict parsing already failed, so a
 * well-formed response is byte-identical to its input. Schema, evidence and
 * authority validation stay strict downstream; a repair can never mint a
 * valid-looking fact that the verbatim-quote checks would not also accept.
 */

/** Form A repair: `"key:"` -> `"key":"` for whitelisted keys only. */
export function repairDroppedKeyClosingQuote(text: string, keys: ReadonlySet<string>): string {
  return text.replace(/"([A-Za-z_][A-Za-z0-9_]*):"/g, (match, key: string) => (
    keys.has(key) ? `"${key}":"` : match));
}

interface RepairEdit {
  /** Character offset in the input where an insertion happens. */
  offset: number;
  /** Text to insert at that offset. */
  insert: string;
}

interface ReadStringResult {
  value: string;
  /** Offset just past the closing quote. */
  end: number;
}

/**
 * Form B scan: one string-aware pass that records deterministic `}`
 * insertions. Single trigger rule, structurally unambiguous: an object opener
 * where a KEY is expected is never valid JSON, so the dangling object must be
 * closed first (the model dropped its closer inside an array element). When
 * that happens the following element-level keys may land one level deeper
 * than intended; extractors recover the known misnested evidence key
 * explicitly, and every recovered quote still passes the strict verbatim
 * verification downstream. Truncation is NOT repaired: input that simply ends
 * with open frames gets no insertion, so the caller's truncated-output
 * classification stays intact. Any structure this scan does not recognize
 * aborts the repair (null) rather than guessing.
 */
function scanMissingClosingBraces(text: string): RepairEdit[] | null {
  const edits: RepairEdit[] = [];
  const frames: Array<{ kind: 'object' | 'array'; objectState: 'expect-key' | 'after-key' | 'after-colon' | 'after-value' | null }> = [];
  let i = 0;
  const readStringAt = (start: number): ReadStringResult | null => {
    let j = start + 1;
    let esc = false;
    while (j < text.length) {
      const ch = text[j];
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') return { value: text.slice(start + 1, j), end: j + 1 };
      j += 1;
    }
    return null; // unterminated string: nothing structural to decide here
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      const str = readStringAt(i);
      if (str === null) return null; // unterminated: leave for truncation handling
      const top = frames[frames.length - 1];
      if (top?.kind === 'object') {
        if (top.objectState === 'expect-key') top.objectState = 'after-key';
        else if (top.objectState === 'after-colon') top.objectState = 'after-value';
        else return null; // genuinely malformed beyond these artifacts
      }
      i = str.end;
      continue;
    }
    if (ch === ':') {
      const top = frames[frames.length - 1];
      if (top?.kind !== 'object' || top.objectState !== 'after-key') return null;
      top.objectState = 'after-colon';
      i += 1;
      continue;
    }
    if (ch === ',') {
      const top = frames[frames.length - 1];
      if (top?.kind === 'object') {
        if (top.objectState !== 'after-value') return null;
        top.objectState = 'expect-key';
      } else if (top?.kind !== 'array') return null;
      i += 1;
      continue;
    }
    if (ch === '{') {
      const top = frames[frames.length - 1];
      if (top?.kind === 'object') {
        if (top.objectState === 'after-colon') top.objectState = 'after-value';
        else if (top.objectState === 'expect-key') {
          // Close the dangling object and retry the opener at the outer level.
          // The comma immediately before belongs to the OUTER container, so
          // the closer goes before it (element boundary: `"]}` + `,` + `{`).
          frames.pop();
          const offset = text[i - 1] === ',' ? i - 1 : i;
          edits.push({ offset, insert: '}' });
          continue;
        } else return null;
      }
      frames.push({ kind: 'object', objectState: 'expect-key' });
      i += 1;
      continue;
    }
    if (ch === '[') {
      const top = frames[frames.length - 1];
      if (top?.kind === 'object') {
        if (top.objectState !== 'after-colon') return null;
        top.objectState = 'after-value';
      }
      frames.push({ kind: 'array', objectState: null });
      i += 1;
      continue;
    }
    if (ch === '}') {
      const top = frames[frames.length - 1];
      if (top?.kind !== 'object') return null;
      if (top.objectState !== 'after-value' && top.objectState !== 'expect-key') return null;
      frames.pop();
      i += 1;
      continue;
    }
    if (ch === ']') {
      const top = frames[frames.length - 1];
      if (top?.kind !== 'array') return null;
      frames.pop();
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) { i += 1; continue; }
    const literal = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (!literal) return null; // unknown artifact class: never guess
    const top = frames[frames.length - 1];
    if (top?.kind === 'object') {
      if (top.objectState !== 'after-colon') return null;
      top.objectState = 'after-value';
    }
    i += literal[0].length;
    continue;
  }
  if (frames.length > 0) return null; // truncation is not a repair target
  return edits;
}

export interface StructuralRepairOptions {
  /** All schema keys eligible for the form-A quote repair. */
  vocabulary: ReadonlySet<string>;
}

/**
 * Applies both vendor structural repairs. Returns null when the input does
 * not exhibit them (or exhibits something this repair does not understand);
 * callers must treat null as "no candidate", never as a silent fallback.
 */
export function repairVendorStructuralArtifacts(text: string, options: StructuralRepairOptions): string | null {
  const quoted = repairDroppedKeyClosingQuote(text, options.vocabulary);
  const edits = scanMissingClosingBraces(quoted);
  // Form A alone can already make the text parseable; a form-B scan abort
  // (unrecognized structure) must not discard that repair. JSON.parse on the
  // candidate remains the final judge either way.
  if (edits === null || edits.length === 0) return quoted !== text ? quoted : null;
  let repaired = '';
  let cursor = 0;
  for (const edit of edits) {
    repaired += quoted.slice(cursor, edit.offset) + edit.insert;
    cursor = edit.offset;
  }
  repaired += quoted.slice(cursor);
  return repaired;
}

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

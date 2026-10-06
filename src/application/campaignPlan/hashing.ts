import { sha256Hex } from '../../domain/identity/sha256';

/** Canonical JSON + SHA-256 helpers shared by the campaign plan layer. */

export function canonicalJsonOf(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = sortDeep(record[key]);
    }
    return out;
  }
  return value;
}

export { sha256Hex as sha256HexOf };

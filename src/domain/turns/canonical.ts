import type { ActionContract } from './types';

export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

function encode(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON rejects non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => encode(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return `{${keys
      .map(key => {
        const nested = object[key];
        if (nested === undefined) {
          throw new Error(`Canonical JSON rejects undefined at key ${key}.`);
        }
        return `${JSON.stringify(key)}:${encode(nested)}`;
      })
      .join(',')}}`;
  }
  throw new Error(`Canonical JSON cannot encode ${typeof value}.`);
}

export function canonicalStringify(value: CanonicalJson): string {
  return encode(value);
}

export function serializeActionContract(contract: ActionContract): string {
  return canonicalStringify(contract as unknown as CanonicalJson);
}

export interface Sha256HexProvider {
  sha256Hex(input: string): Promise<string> | string;
}

export async function hashActionContract(
  contract: ActionContract,
  provider: Sha256HexProvider,
): Promise<string> {
  const hash = await provider.sha256Hex(serializeActionContract(contract));
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new Error('SHA-256 provider must return a 64-character hexadecimal digest.');
  }
  return hash.toLowerCase();
}

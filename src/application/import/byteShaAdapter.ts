/**
 * Byte-hash adapter over a "native hash of base64" primitive.
 *
 * This is the adapter the mobile app builds its import pipeline on: the only
 * hashing primitive the React Native crypto module exposes for arbitrary byte
 * ranges is `sha256BytesHex(base64)`. The contract of the returned provider is
 * strict: `sha256BytesHex(bytes)` hashes EXACTLY the bytes it was given — never
 * some other byte sequence the factory happened to see earlier (e.g. the whole
 * novel file). Violating that made every chapter/chunk digest equal the raw
 * file digest (closeout C1 / plan §4.1): resumes then "reused" one extraction
 * for every chunk and silently skipped the rest of the book.
 */

declare const btoa: (data: string) => string;

export interface Base64NativeSha256 {
  /** Hashes the byte sequence obtained by base64-decoding `base64`. */
  sha256BytesHexFromBase64(base64: string): Promise<string>;
  sha256Hex(input: string): Promise<string>;
}

export interface ByteSha256TextProvider {
  sha256BytesHex(bytes: Uint8Array): Promise<string>;
  sha256Hex(input: string): Promise<string>;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa !== 'function') {
    throw new Error('btoa is unavailable on this runtime.');
  }
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    let part = '';
    for (let j = i; j < end; j += 1) {
      const byte = bytes[j];
      if (byte === undefined) break;
      part += String.fromCharCode(byte);
    }
    binary += part;
  }
  return btoa(binary);
}

export function makeBase64NativeByteSha(native: Base64NativeSha256): ByteSha256TextProvider {
  return {
    async sha256BytesHex(bytes: Uint8Array): Promise<string> {
      return native.sha256BytesHexFromBase64(bytesToBase64(bytes));
    },
    sha256Hex: async (input: string) => native.sha256Hex(input),
  };
}

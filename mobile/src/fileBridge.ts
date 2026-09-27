import { NativeModules } from 'react-native';

// Hermes provides btoa/atob without lib-dom typings.
declare const btoa: (data: string) => string;

interface ShineWordFilesNative {
  pickTextFile(): Promise<{ uri: string; name: string; size: number } | null>;
  readFileBase64(uriString: string): Promise<string>;
  createTextFile(defaultName: string): Promise<{ uri: string } | null>;
  writeFileBase64(uriString: string, base64Data: string): Promise<boolean>;
}

function native(): ShineWordFilesNative {
  const module = NativeModules.ShineWordFiles as ShineWordFilesNative | undefined;
  if (!module) throw new Error('ShineWordFiles native module is unavailable.');
  return module;
}

export interface PickedNovelFile {
  uri: string;
  name: string;
  size: number;
  bytes: Uint8Array;
  /** Raw file bytes as base64 - the input for true byte-level hashing (G06). */
  base64: string;
}

export async function pickNovelFile(): Promise<PickedNovelFile | null> {
  const picked = await native().pickTextFile();
  if (!picked) return null;
  const base64 = await native().readFileBase64(picked.uri);
  return {
    uri: picked.uri,
    name: picked.name ?? 'novel.txt',
    size: picked.size,
    bytes: base64ToBytes(base64),
    base64,
  };
}

export function base64ToBytes(base64: string): Uint8Array {
  const atobFn = (globalThis as { atob?: (data: string) => string }).atob;
  if (!atobFn) throw new Error('atob is unavailable on this runtime.');
  const binary = atobFn(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** SAF create-document picker; the user picks where the export lands. */
export async function createExportFile(defaultName: string): Promise<string | null> {
  const target = await native().createTextFile(defaultName);
  return target?.uri ?? null;
}

export async function writeExportFile(uri: string, text: string): Promise<boolean> {
  if (typeof btoa !== 'function') throw new Error('btoa is unavailable on this runtime.');
  const bytes = new TextEncoderLike().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return native().writeFileBase64(uri, btoa(binary));
}

/** Minimal UTF-8 encoder (Hermes has no TextEncoder). */
class TextEncoderLike {
  encode(text: string): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < text.length; i += 1) {
      let code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          i += 1;
        }
      }
      if (code < 0x80) out.push(code);
      else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
    return new Uint8Array(out);
  }
}

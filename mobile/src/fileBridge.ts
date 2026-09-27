import { NativeModules } from 'react-native';

interface ShineWordFilesNative {
  pickTextFile(): Promise<{ uri: string; name: string; size: number } | null>;
  readFileBase64(uriString: string): Promise<string>;
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

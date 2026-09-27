import { NativeModules } from 'react-native';
import type { Sha256HexProvider } from '../../src/domain/turns/canonical';
import { NativeSecureRandomByteSource } from '../../src/platform/random/nativeSecureRandom';

interface ShineWordCryptoNative {
  nextByte(): number;
  sha256Hex(input: string): Promise<string>;
  /** SHA-256 over raw bytes delivered as base64 (P2 acceptance G06). */
  sha256BytesHex(base64Input: string): Promise<string>;
}

function native(): ShineWordCryptoNative {
  const module = NativeModules.ShineWordCrypto as ShineWordCryptoNative | undefined;
  if (!module) throw new Error('ShineWordCrypto native module is unavailable.');
  return module;
}

export function createNativeRandomBytes(): NativeSecureRandomByteSource {
  return new NativeSecureRandomByteSource(native());
}

export const nativeSha256: Sha256HexProvider = {
  async sha256Hex(input: string): Promise<string> {
    const value = await native().sha256Hex(input);
    if (!/^[0-9a-f]{64}$/i.test(value)) {
      throw new Error('Native SHA-256 returned an invalid digest.');
    }
    return value.toLowerCase();
  },
};

function assertDigest(value: string): string {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error('Native SHA-256 returned an invalid digest.');
  }
  return value.toLowerCase();
}

/**
 * True original-file-byte SHA-256: the picker already holds the file as
 * base64, so hashing never round-trips through a JS string. GBK/UTF-16
 * files no longer hash a re-encoded byte shadow (P2 acceptance G06).
 */
export async function nativeSha256BytesHex(base64Input: string): Promise<string> {
  return assertDigest(await native().sha256BytesHex(base64Input));
}

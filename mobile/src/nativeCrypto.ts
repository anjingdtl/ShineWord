import { NativeModules } from 'react-native';
import type { Sha256HexProvider } from '../../src/domain/turns/canonical';
import { NativeSecureRandomByteSource } from '../../src/platform/random/nativeSecureRandom';

interface ShineWordCryptoNative {
  nextByte(): number;
  sha256Hex(input: string): Promise<string>;
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

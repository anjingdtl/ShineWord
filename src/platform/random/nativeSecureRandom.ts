import type { RandomByteSource } from '../../domain/rules/random';

export interface NativeSecureRandomModule {
  nextByte(): number;
}

export class NativeSecureRandomByteSource implements RandomByteSource {
  constructor(private readonly nativeModule: NativeSecureRandomModule) {}

  nextByte(): number {
    const value = this.nativeModule.nextByte();
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error(`Native secure random returned invalid byte ${value}.`);
    }
    return value;
  }
}

export interface RandomSource {
  nextIntInclusive(min: number, max: number): number;
}

export interface RandomByteSource {
  nextByte(): number;
}

export class RejectionSamplingRandomSource implements RandomSource {
  constructor(private readonly bytes: RandomByteSource) {}

  nextIntInclusive(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new Error(`Invalid random range: [${min}, ${max}].`);
    }

    const span = max - min + 1;
    if (span < 1 || span > 256) {
      throw new Error(`RejectionSamplingRandomSource supports ranges up to 256 values; received ${span}.`);
    }

    const limit = Math.floor(256 / span) * span;
    for (;;) {
      const value = this.bytes.nextByte();
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error(`Random byte source returned ${value}; expected an integer from 0 to 255.`);
      }
      if (value < limit) {
        return min + (value % span);
      }
    }
  }
}

export function assertRandomResult(value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `Random source returned ${value}; expected an integer between ${min} and ${max}.`,
    );
  }
}

export interface RandomSource {
  nextIntInclusive(min: number, max: number): number;
}

export function assertRandomResult(value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `Random source returned ${value}; expected an integer between ${min} and ${max}.`,
    );
  }
}

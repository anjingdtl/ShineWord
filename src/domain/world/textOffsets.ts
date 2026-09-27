/**
 * Offset policy: all source offsets are Unicode code point offsets over the
 * normalized text, never UTF-16 units. JS strings are UTF-16, so conversions
 * between code point offsets and string indices need an explicit index.
 *
 * The index keeps a sampled map (every `sampleStride` code points) and resolves
 * exact positions with a short linear scan: construction is O(n), lookups are
 * O(stride).
 */
export class CodePointOffsetIndex {
  private readonly text: string;
  private readonly sampleStride: number;
  private readonly utf16IndexBySample: Int32Array;
  readonly codePointCount: number;

  constructor(text: string, sampleStride = 512) {
    if (sampleStride < 1) throw new Error('sampleStride must be >= 1.');
    this.text = text;
    this.sampleStride = sampleStride;
    const samples: number[] = [0];
    let codePoints = 0;
    let utf16Index = 0;
    while (utf16Index < text.length) {
      const code = text.charCodeAt(utf16Index);
      utf16Index += code >= 0xd800 && code < 0xdc00 ? 2 : 1;
      codePoints += 1;
      if (codePoints % sampleStride === 0) samples.push(utf16Index);
    }
    this.codePointCount = codePoints;
    this.utf16IndexBySample = Int32Array.from(samples);
  }

  utf16IndexOf(offset: number): number {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.codePointCount) {
      throw new Error(`Code point offset out of range: ${offset}.`);
    }
    const sampleIndex = Math.floor(offset / this.sampleStride);
    const sampled = this.utf16IndexBySample[sampleIndex] ?? 0;
    let utf16Index: number = sampled;
    let remaining = offset - sampleIndex * this.sampleStride;
    while (remaining > 0) {
      const code = this.text.charCodeAt(utf16Index);
      utf16Index += code >= 0xd800 && code < 0xdc00 ? 2 : 1;
      remaining -= 1;
    }
    return utf16Index;
  }

  slice(startOffset: number, endOffset: number): string {
    if (startOffset > endOffset) {
      throw new Error(`Invalid code point range: [${startOffset}, ${endOffset}].`);
    }
    return this.text.slice(
      this.utf16IndexOf(startOffset),
      this.utf16IndexOf(endOffset),
    );
  }
}

export function codePointLength(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; ) {
    const code = text.charCodeAt(i);
    i += code >= 0xd800 && code < 0xdc00 ? 2 : 1;
    count += 1;
  }
  return count;
}

/** UTF-8 bytes without TextEncoder, which Hermes does not provide. */
export function utf8Bytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.codePointAt(i) as number;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
      i += 1; // surrogate pair consumed as one code point
    }
  }
  return Uint8Array.from(bytes);
}

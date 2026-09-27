import { GBK_TABLE } from './gbkTable';

/**
 * Hermes-safe text decoding for novel imports.
 *
 * - UTF-8 decoding builds the output string in bounded chunks: spreading a
 *   million-element array into String.fromCodePoint overflows the call stack
 *   on Hermes (the Phase-2 long-text fix).
 * - GBK decoding uses a generated table (scripts/genGbkTable.mjs) because
 *   Hermes has no TextDecoder; Android novels are commonly GBK/GB18030.
 */

const CODE_POINT_CHUNK = 8192;

export function decodeUtf8(bytes: Uint8Array): string {
  const out: number[] = [];
  let i = 0;
  const len = bytes.length;
  while (i < len) {
    const b1 = bytes[i];
    if (b1 < 0x80) {
      out.push(b1);
      i += 1;
    } else if (b1 >= 0xc2 && b1 <= 0xdf && i + 1 < len) {
      out.push(((b1 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b1 >= 0xe0 && b1 <= 0xef && i + 2 < len) {
      out.push(
        ((b1 & 0x0f) << 12) |
          ((bytes[i + 1] & 0x3f) << 6) |
          (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else if (b1 >= 0xf0 && b1 <= 0xf4 && i + 3 < len) {
      out.push(
        ((b1 & 0x07) << 18) |
          ((bytes[i + 1] & 0x3f) << 12) |
          ((bytes[i + 2] & 0x3f) << 6) |
          (bytes[i + 3] & 0x3f),
      );
      i += 4;
    } else {
      out.push(0xfffd);
      i += 1;
    }
  }
  // Chunked assembly avoids one giant spread call.
  const parts: string[] = [];
  for (let start = 0; start < out.length; start += CODE_POINT_CHUNK) {
    parts.push(String.fromCodePoint(...out.slice(start, start + CODE_POINT_CHUNK)));
  }
  return parts.join('');
}

const LEAD_MIN = 0x81;
const LEAD_MAX = 0xFE;

function gbkIndex(lead: number, trail: number): number {
  return (lead - LEAD_MIN) * 190 + (trail <= 0x7e ? trail - 0x40 : trail - 0x41);
}

export function decodeGbk(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk: number[] = [];
  const flush = () => {
    if (chunk.length > 0) {
      parts.push(String.fromCodePoint(...chunk));
      chunk = [];
    }
  };
  let i = 0;
  const len = bytes.length;
  while (i < len) {
    const b1 = bytes[i];
    if (b1 < 0x80) {
      chunk.push(b1);
      i += 1;
      continue;
    }
    if (b1 < LEAD_MIN || b1 > LEAD_MAX || i + 1 >= len) {
      chunk.push(0xfffd);
      i += 1;
      continue;
    }
    const b2 = bytes[i + 1];
    const validTrail = (b2 >= 0x40 && b2 <= 0x7e) || (b2 >= 0x80 && b2 <= 0xFE);
    if (!validTrail) {
      chunk.push(0xfffd);
      i += 1;
      continue;
    }
    const code = Number.parseInt(
      GBK_TABLE.substr(gbkIndex(b1, b2) * 4, 4),
      16,
    );
    chunk.push(code === 0 ? 0xfffd : code);
    i += 2;
    if (chunk.length >= CODE_POINT_CHUNK) flush();
  }
  flush();
  return parts.join('');
}

/**
 * Byte-level BOM sniffing + heuristic GBK detection (matches the core
 * importer's encoding detection, which never decodes GBK on device itself).
 */
export function detectEncoding(bytes: Uint8Array): 'utf-8-sig' | 'utf-8' | 'gbk' {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8-sig';
  }
  // Sample the head for UTF-8 validity; a single invalid sequence means GBK
  // (or another legacy encoding). Pure-ASCII heads are valid in both.
  const sampleEnd = Math.min(bytes.length, 64 * 1024);
  let multi = false;
  for (let i = 0; i < sampleEnd; ) {
    const b = bytes[i];
    if (b < 0x80) {
      i += 1;
      continue;
    }
    multi = true;
    let seqLen = 0;
    if (b >= 0xc2 && b <= 0xdf) seqLen = 2;
    else if (b >= 0xe0 && b <= 0xef) seqLen = 3;
    else if (b >= 0xf0 && b <= 0xf4) seqLen = 4;
    if (seqLen === 0) return 'gbk';
    for (let k = 1; k < seqLen; k += 1) {
      if (i + k >= sampleEnd || (bytes[i + k] & 0xc0) !== 0x80) return 'gbk';
    }
    i += seqLen;
  }
  return multi || bytes.length > 0 ? 'utf-8' : 'utf-8';
}

/** Chunked UTF-16 decode (Hermes-safe; rare but legal novel encodings). */
function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const units: number[] = [];
  for (let i = 0; i + 1 < bytes.byteLength; i += 2) {
    units.push(view.getUint16(i, littleEndian));
  }
  const parts: string[] = [];
  for (let start = 0; start < units.length; start += CODE_POINT_CHUNK) {
    parts.push(String.fromCharCode(...units.slice(start, start + CODE_POINT_CHUNK)));
  }
  return parts.join('');
}

/** Decodes raw novel bytes with the detected encoding (Phase 2: GBK works on device). */
export function decodeNovel(bytes: Uint8Array, encoding: string): string {
  switch (encoding) {
    case 'utf-8-sig':
      return decodeUtf8(bytes.subarray(3));
    case 'utf-8':
      return decodeUtf8(bytes);
    case 'gbk':
      return decodeGbk(bytes);
    case 'utf-16le':
      return decodeUtf16(bytes.subarray(2), true);
    case 'utf-16be':
      return decodeUtf16(bytes.subarray(2), false);
    default:
      throw new Error(`此文件编码为 ${encoding}，当前版本仅支持 UTF-8 / GBK / UTF-16。`);
  }
}

/** TextDecodeProvider adapter for importTxtSource on device. */
export const mobileTextDecoder = {
  decode(bytes: Uint8Array, encoding: string): string {
    return decodeNovel(bytes, encoding);
  },
};

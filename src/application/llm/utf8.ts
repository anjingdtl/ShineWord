const CODE_POINT_CHUNK = 8192;

/** Hermes-safe UTF-8 decoder shared by imports and streamed LLM responses. */
export function decodeUtf8(bytes: Uint8Array): string {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i]!;
    if (b1 < 0x80) {
      out.push(b1);
      i += 1;
    } else if (b1 >= 0xc2 && b1 <= 0xdf && i + 1 < bytes.length) {
      out.push(((b1 & 0x1f) << 6) | (bytes[i + 1]! & 0x3f));
      i += 2;
    } else if (b1 >= 0xe0 && b1 <= 0xef && i + 2 < bytes.length) {
      out.push(((b1 & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f));
      i += 3;
    } else if (b1 >= 0xf0 && b1 <= 0xf4 && i + 3 < bytes.length) {
      out.push(((b1 & 0x07) << 18) | ((bytes[i + 1]! & 0x3f) << 12)
        | ((bytes[i + 2]! & 0x3f) << 6) | (bytes[i + 3]! & 0x3f));
      i += 4;
    } else {
      out.push(0xfffd);
      i += 1;
    }
  }
  const parts: string[] = [];
  for (let start = 0; start < out.length; start += CODE_POINT_CHUNK) {
    parts.push(String.fromCodePoint(...out.slice(start, start + CODE_POINT_CHUNK)));
  }
  return parts.join('');
}

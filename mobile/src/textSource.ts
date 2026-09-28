/**
 * Mobile bridge to the native streaming text source (closeout C2).
 *
 * Implements the core `StreamingTextSource` contract over
 * `ShineWordTextSourceModule`: staged private copy + bounded decoded windows
 * with multi-byte carry. The whole novel never crosses the bridge as one
 * payload.
 */
import type { TextWindow, StreamingTextSource } from '../../src/application/import/streamingTxtImport';

interface TextSourceNative {
  stageUri(uri: string, sourceKey: string): Promise<{ path: string; byteLength: number; sha256: string }>;
  detectEncoding(path: string): Promise<{ encoding: string; byteLength: number }>;
  readTextChunk(
    path: string,
    encoding: string,
    byteOffset: number,
    maxBytes: number,
  ): Promise<{ text: string; nextByteOffset: number; atEof: boolean }>;
  deleteStaged(path: string): Promise<boolean>;
}

function native(): TextSourceNative {
  const module = (globalThis as { ShineWordTextSource?: TextSourceNative }).ShineWordTextSource;
  if (!module) throw new Error('ShineWordTextSource native module is unavailable.');
  return module;
}

export interface StagedSource {
  path: string;
  byteLength: number;
  sha256: string;
}

/** Copies the picked SAF document into private storage, hashing on the way. */
export async function stageUri(uri: string, sourceKey: string): Promise<StagedSource> {
  return native().stageUri(uri, sourceKey);
}

export async function deleteStaged(path: string): Promise<boolean> {
  return native().deleteStaged(path);
}

/**
 * Bounded decoded-window reader bound to one staged file. Encoding is
 * detected once (BOM + UTF-8 validity sniff, mirroring the core labels) and
 * the BOM is handled by the importer, so 'utf-8-sig' maps to plain UTF-8
 * here.
 */
export async function stagedTextSource(staged: StagedSource): Promise<StreamingTextSource> {
  const detected = await native().detectEncoding(staged.path);
  const encoding = detected.encoding === 'utf-8-sig' ? 'utf-8' : detected.encoding;
  return {
    encoding,
    byteLength: staged.byteLength,
    rawSha256Hex: staged.sha256,
    readText: async (byteOffset: number, maxBytes: number): Promise<TextWindow> =>
      native().readTextChunk(staged.path, encoding, byteOffset, maxBytes),
  };
}

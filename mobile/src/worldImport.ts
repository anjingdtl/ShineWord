import type { ParsedTxtSource } from '../../src/domain/world/types';
import { importTxtSource } from '../../src/application/import/txtImport';
import { buildWorldFromTxt } from '../../src/application/world/buildWorld';
import { LlmChunkExtractor } from '../../src/application/world/llmExtractor';
import { SqliteWorldStore } from '../../src/infra/sqlite/sqliteWorldStore';
import { getDatabaseRuntime } from './database';
import { nativeSha256 } from './nativeCrypto';
import type { ApiProfile } from '../../src/application/llm/types';
import { OpenAICompatibleProvider } from '../../src/application/llm/openAICompatible';
import { KeychainSecretStore } from './secureKeyStore';
import { FetchHttpTransport } from './fetchTransport';

const bytesSha = {
  async sha256BytesHex(bytes: Uint8Array): Promise<string> {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return nativeSha256.sha256Hex(binary);
  },
  sha256Hex: nativeSha256.sha256Hex,
};

const decoder = {
  decode(bytes: Uint8Array, encoding: string): string {
    // The file bridge decodes nothing; Android novels are UTF-8 or GBK.
    // Hermes lacks TextDecoder, so the bridge hands back raw bytes and we
    // decode UTF-8 here; GBK novels must be converted before import on device.
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    if (encoding !== 'utf-8' && encoding !== 'utf-8-sig') {
      throw new Error(
        `此文件编码为 ${encoding}，当前设备版本仅支持 UTF-8。请先转换编码再导入。`,
      );
    }
    return decodeUtf8(binary);
  },
};

function decodeUtf8(binary: string): string {
  // Manual UTF-8 decode over charcodes (Hermes has no TextDecoder).
  const out: number[] = [];
  let i = 0;
  while (i < binary.length) {
    const b1 = binary.charCodeAt(i);
    if (b1 < 0x80) {
      out.push(b1);
      i += 1;
    } else if (b1 >= 0xc2 && b1 <= 0xdf) {
      out.push(((b1 & 0x1f) << 6) | (binary.charCodeAt(i + 1) & 0x3f));
      i += 2;
    } else if (b1 >= 0xe0 && b1 <= 0xef) {
      out.push(
        ((b1 & 0x0f) << 12) |
          ((binary.charCodeAt(i + 1) & 0x3f) << 6) |
          (binary.charCodeAt(i + 2) & 0x3f),
      );
      i += 3;
    } else if (b1 >= 0xf0 && b1 <= 0xf4) {
      out.push(
        ((b1 & 0x07) << 18) |
          ((binary.charCodeAt(i + 1) & 0x3f) << 12) |
          ((binary.charCodeAt(i + 2) & 0x3f) << 6) |
          (binary.charCodeAt(i + 3) & 0x3f),
      );
      i += 4;
    } else {
      out.push(0xfffd);
      i += 1;
    }
  }
  return String.fromCodePoint(...out);
}

export interface ImportPreview {
  parsed: ParsedTxtSource;
  title: string;
}

export async function previewNovel(bytes: Uint8Array, fallbackTitle: string): Promise<ImportPreview> {
  const parsed = await importTxtSource(bytes, bytesSha, decoder);
  return { parsed, title: fallbackTitle };
}

export interface WorldBuildProgress {
  phase: 'importing' | 'extracting' | 'done' | 'failed';
  chunksDone?: number;
  chunksTotal?: number;
  message?: string;
}

export interface BuiltWorldSummary {
  worldId: string;
  title: string;
  chapterCount: number;
  chunkCount: number;
  entityCount: number;
  factCount: number;
  eventCount: number;
  failedChunks: number;
  rejected: number;
}

function makeTitleFromText(parsed: ParsedTxtSource, fallback: string): string {
  const firstLine = parsed.text.split('\n', 1)[0]?.trim() ?? '';
  if (firstLine.length >= 2 && firstLine.length <= 30) return firstLine;
  return fallback;
}

export async function buildWorldOnDevice(
  bytes: Uint8Array,
  fallbackTitle: string,
  profile: ApiProfile,
  onProgress: (progress: WorldBuildProgress) => void,
): Promise<BuiltWorldSummary> {
  onProgress({ phase: 'importing' });
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  const preview = await previewNovel(bytes, fallbackTitle);
  const title = makeTitleFromText(preview.parsed, fallbackTitle);

  const provider = new OpenAICompatibleProvider(
    profile,
    new KeychainSecretStore(),
    new FetchHttpTransport(),
    120_000,
  );
  const extractor = new LlmChunkExtractor(request => provider.complete(request));

  const worldId = `world-${Date.now().toString(36)}`;
  const result = await buildWorldFromTxt({
    worldId,
    title,
    bytes,
    store: worldStore,
    sha: bytesSha,
    decoder,
    extractor,
    concurrency: 1,
    modelFingerprint: `${profile.endpoint}#${profile.model}`,
  });

  onProgress({ phase: 'done' });
  return {
    worldId,
    title,
    chapterCount: result.parsed.chapters.length,
    chunkCount: result.parsed.chunks.length,
    entityCount: result.entityCount,
    factCount: result.factCounts.inserted + result.factCounts.duplicate,
    eventCount: result.eventCount,
    failedChunks: result.failedChunks.length,
    rejected: result.rejectedCount,
  };
}

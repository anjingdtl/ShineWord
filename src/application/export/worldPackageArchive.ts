import type { BookSection, ContentEntry, WorldPackageManifest } from '../../domain/content/types';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import type { WorldRecord } from '../ports/worldStore';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import { computePackageContentHash, validatePackage } from '../worldPackage/validate';

const ARCHIVE_SCHEMA = 'shineword-world-archive-1';
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_PACKAGE_JSON_BYTES = 15 * 1024 * 1024;

export interface PortableWorldPackage {
  schemaVersion: typeof ARCHIVE_SCHEMA;
  title: string;
  manifest: WorldPackageManifest;
  entries: ContentEntry[];
  sections: BookSection[];
  /**
   * Historical publishers hash the incoming entry revision, then persist the
   * entries at the new immutable package revision. Preserve that hash basis
   * in the portable envelope so old packages remain verifiable after export.
   */
  contentHashBasisRevision?: number;
}

/**
 * Portable world delivery is a ZIP with one UTF-8 payload. The archive uses
 * the standard ZIP "store" method so it can be produced on Hermes without a
 * compression dependency; the package content hash remains the authority.
 */
export async function encodeWorldPackageArchive(
  input: Omit<PortableWorldPackage, 'schemaVersion'>,
  sha256Hex: Sha256HexProvider['sha256Hex'],
): Promise<Uint8Array> {
  validatePortableInput(input);
  const contentHashBasisRevision = await findContentHashBasisRevision(
    input.manifest,
    input.entries,
    input.sections,
    sha256Hex,
  );
  if (contentHashBasisRevision === null) {
    throw new Error('World package content hash does not match its manifest.');
  }
  const payload = utf8Encode(JSON.stringify({
    ...input,
    schemaVersion: ARCHIVE_SCHEMA,
    contentHashBasisRevision,
  }));
  if (payload.length > MAX_PACKAGE_JSON_BYTES) throw new Error('World package payload exceeds the portable archive limit.');
  const name = utf8Encode('package.json');
  const crc = crc32(payload);
  const localHeader = new Uint8Array(30 + name.length);
  write32(localHeader, 0, 0x04034b50);
  write16(localHeader, 4, 20);
  write16(localHeader, 6, 0x0800);
  write16(localHeader, 8, 0);
  write32(localHeader, 14, crc);
  write32(localHeader, 18, payload.length);
  write32(localHeader, 22, payload.length);
  write16(localHeader, 26, name.length);
  localHeader.set(name, 30);

  const centralHeader = new Uint8Array(46 + name.length);
  write32(centralHeader, 0, 0x02014b50);
  write16(centralHeader, 4, 20);
  write16(centralHeader, 6, 20);
  write16(centralHeader, 8, 0x0800);
  write16(centralHeader, 10, 0);
  write32(centralHeader, 16, crc);
  write32(centralHeader, 20, payload.length);
  write32(centralHeader, 24, payload.length);
  write16(centralHeader, 28, name.length);
  write32(centralHeader, 42, 0);
  centralHeader.set(name, 46);

  const centralOffset = localHeader.length + payload.length;
  const eocd = new Uint8Array(22);
  write32(eocd, 0, 0x06054b50);
  write16(eocd, 8, 1);
  write16(eocd, 10, 1);
  write32(eocd, 12, centralHeader.length);
  write32(eocd, 16, centralOffset);
  const archive = concatBytes([localHeader, payload, centralHeader, eocd]);
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error('World package archive exceeds the import size limit.');
  return archive;
}

export async function decodeWorldPackageArchive(
  archive: Uint8Array,
  sha256Hex: Sha256HexProvider['sha256Hex'],
): Promise<PortableWorldPackage> {
  if (!(archive instanceof Uint8Array) || archive.length < 22 || archive.length > MAX_ARCHIVE_BYTES) {
    throw new Error('World package archive has an invalid size.');
  }
  const payloadBytes = readStoredZipPackage(archive);
  if (payloadBytes.length > MAX_PACKAGE_JSON_BYTES) throw new Error('World package payload exceeds the import size limit.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(payloadBytes));
  } catch {
    throw new Error('World package archive payload is not valid UTF-8 JSON.');
  }
  const bundle = parsed as Partial<PortableWorldPackage>;
  if (bundle.schemaVersion !== ARCHIVE_SCHEMA) throw new Error('Unsupported world package archive schema.');
  if (typeof bundle.title !== 'string' || !bundle.title.trim() || bundle.title.length > 200) {
    throw new Error('World package title is missing or too long.');
  }
  if (!bundle.manifest || !Array.isArray(bundle.entries) || !Array.isArray(bundle.sections)) {
    throw new Error('World package archive is missing its manifest, entries or book sections.');
  }
  validatePortableInput({ title: bundle.title, manifest: bundle.manifest, entries: bundle.entries, sections: bundle.sections });
  if (bundle.manifest.status !== 'published') throw new Error('Only a published world package can be imported for play.');
  const report = validatePackage(bundle.manifest, bundle.entries, bundle.sections);
  if (!report.ok) throw new Error(`World package validation failed:\n- ${report.errors.join('\n- ')}`);
  const basisRevision = bundle.contentHashBasisRevision;
  if (basisRevision !== undefined && (!Number.isSafeInteger(basisRevision) || basisRevision < 0)) {
    throw new Error('World package hash basis revision is invalid.');
  }
  const verifiedBasis = await findContentHashBasisRevision(
    bundle.manifest,
    bundle.entries,
    bundle.sections,
    sha256Hex,
    basisRevision,
  );
  if (verifiedBasis === null) throw new Error('World package content hash verification failed.');
  return {
    schemaVersion: ARCHIVE_SCHEMA,
    title: bundle.title,
    manifest: bundle.manifest,
    entries: bundle.entries,
    sections: bundle.sections,
    contentHashBasisRevision: verifiedBasis,
  };
}

export async function importPortableWorldPackage(input: {
  worldStore: SqliteWorldStore;
  sha256Hex: Sha256HexProvider['sha256Hex'];
  archive: Uint8Array;
  newWorldId: string;
  createdAt: string;
}): Promise<{ worldId: string; title: string; revision: number; contentHash: string }> {
  if (!input.newWorldId.trim() || input.newWorldId.length > 120) throw new Error('New world id is invalid.');
  const bundle = await decodeWorldPackageArchive(input.archive, input.sha256Hex);
  // Keep the published revision, entry revisions and content hash intact.
  // Campaign saves lock this immutable package version, and portable import
  // must not silently turn rN into a different local r1 package.
  const entries = bundle.entries;
  const report = validatePackage(bundle.manifest, entries, bundle.sections);
  if (!report.ok) throw new Error(`World package validation failed:\n- ${report.errors.join('\n- ')}`);
  const manifest: WorldPackageManifest = {
    ...bundle.manifest,
    worldId: input.newWorldId,
    status: 'published',
  };
  const world: WorldRecord = {
    worldId: input.newWorldId,
    title: bundle.title,
    sourceSha256: bundle.manifest.sourceSha256,
    sourceBytes: 0,
    normalizeVersion: 'portable-package-no-source',
    chapterSplitVersion: 'portable-package-no-source',
    buildStatus: 'ready',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
  await input.worldStore.saveImportedWorldPackage({
    world,
    manifest,
    entries,
    sections: bundle.sections,
    validationJson: JSON.stringify({
      errors: report.errors,
      warnings: report.warnings,
      entryCount: report.entryCount,
      countsByKind: report.countsByKind,
      sourceIncluded: false,
      importedFromWorldId: bundle.manifest.worldId,
      importedFromRevision: bundle.manifest.revision,
      importedFromContentHash: bundle.manifest.contentHash,
      importedContentHashBasisRevision: bundle.contentHashBasisRevision,
    }),
    createdAt: input.createdAt,
  });
  return {
    worldId: input.newWorldId,
    title: bundle.title,
    revision: manifest.revision,
    contentHash: manifest.contentHash,
  };
}

function validatePortableInput(input: Omit<PortableWorldPackage, 'schemaVersion'>): void {
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200) {
    throw new Error('World package title is missing or too long.');
  }
  if (!input.manifest || input.manifest.schemaVersion !== 'world-package-2' ||
      typeof input.manifest.worldId !== 'string' || !input.manifest.worldId.trim() || input.manifest.worldId.length > 120 ||
      !Number.isSafeInteger(input.manifest.revision) || input.manifest.revision < 1) {
    throw new Error('World package manifest is invalid.');
  }
  if (!/^[a-f0-9]{64}$/i.test(input.manifest.contentHash) || !/^[a-f0-9]{64}$/i.test(input.manifest.sourceSha256)) {
    throw new Error('World package hashes must be SHA-256 hex strings.');
  }
  if (!Array.isArray(input.entries) || input.entries.length === 0 || input.entries.length > 5000 ||
      !Array.isArray(input.sections) || input.sections.length > 500) {
    throw new Error('World package entry or section count is outside the allowed range.');
  }
}

async function findContentHashBasisRevision(
  manifest: Pick<WorldPackageManifest, 'contentHash' | 'revision'>,
  entries: readonly ContentEntry[],
  sections: readonly BookSection[],
  sha256Hex: Sha256HexProvider['sha256Hex'],
  explicitBasisRevision?: number,
): Promise<number | null> {
  const candidates = explicitBasisRevision === undefined
    ? [...new Set([
        manifest.revision,
        Math.max(0, manifest.revision - 1),
        0,
        ...entries.map(entry => entry.revision),
      ])]
    : [explicitBasisRevision];
  for (const revision of candidates) {
    if (!Number.isSafeInteger(revision) || revision < 0) continue;
    const candidateEntries = entries.map(entry => ({ ...entry, revision }));
    if (await computePackageContentHash(candidateEntries, sections, sha256Hex) === manifest.contentHash) {
      return revision;
    }
  }
  return null;
}

function readStoredZipPackage(bytes: Uint8Array): Uint8Array {
  const eocdOffset = findEocd(bytes);
  if (read16(bytes, eocdOffset + 4) !== 0 || read16(bytes, eocdOffset + 6) !== 0 ||
      read16(bytes, eocdOffset + 8) !== 1 || read16(bytes, eocdOffset + 10) !== 1) {
    throw new Error('World package ZIP must contain exactly one file on a single disk.');
  }
  const centralSize = read32(bytes, eocdOffset + 12);
  const centralOffset = read32(bytes, eocdOffset + 16);
  const commentLength = read16(bytes, eocdOffset + 20);
  if (eocdOffset + 22 + commentLength !== bytes.length || centralOffset + centralSize !== eocdOffset) {
    throw new Error('World package ZIP directory bounds are invalid.');
  }
  if (centralOffset + 46 > eocdOffset || read32(bytes, centralOffset) !== 0x02014b50) {
    throw new Error('World package ZIP directory is invalid.');
  }
  const flags = read16(bytes, centralOffset + 8);
  const method = read16(bytes, centralOffset + 10);
  const expectedCrc = read32(bytes, centralOffset + 16);
  const compressedSize = read32(bytes, centralOffset + 20);
  const uncompressedSize = read32(bytes, centralOffset + 24);
  const nameLength = read16(bytes, centralOffset + 28);
  const extraLength = read16(bytes, centralOffset + 30);
  const entryCommentLength = read16(bytes, centralOffset + 32);
  const localOffset = read32(bytes, centralOffset + 42);
  const fileName = utf8Decode(sliceChecked(bytes, centralOffset + 46, nameLength));
  if (fileName !== 'package.json' || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new Error('World package ZIP contains an unexpected or unsafe path.');
  }
  if ((flags & 0x0009) !== 0 || method !== 0 || compressedSize !== uncompressedSize) {
    throw new Error('World package ZIP uses unsupported compression or encryption.');
  }
  if (centralOffset + 46 + nameLength + extraLength + entryCommentLength !== eocdOffset ||
      localOffset + 30 > centralOffset || read32(bytes, localOffset) !== 0x04034b50) {
    throw new Error('World package ZIP entry bounds are invalid.');
  }
  const localFlags = read16(bytes, localOffset + 6);
  const localMethod = read16(bytes, localOffset + 8);
  const localNameLength = read16(bytes, localOffset + 26);
  const localExtraLength = read16(bytes, localOffset + 28);
  const localName = utf8Decode(sliceChecked(bytes, localOffset + 30, localNameLength));
  if (localFlags !== flags || localMethod !== method || localName !== fileName) {
    throw new Error('World package ZIP local and central records disagree.');
  }
  const payloadOffset = localOffset + 30 + localNameLength + localExtraLength;
  const payload = sliceChecked(bytes, payloadOffset, uncompressedSize);
  if (payloadOffset + payload.length !== centralOffset || crc32(payload) !== expectedCrc) {
    throw new Error('World package ZIP payload checksum or bounds are invalid.');
  }
  return payload;
}

function findEocd(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (read32(bytes, offset) === 0x06054b50) return offset;
  }
  throw new Error('World package ZIP end directory was not found.');
}

function sliceChecked(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error('World package ZIP contains an out-of-bounds record.');
  }
  return bytes.slice(offset, offset + length);
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, item) => total + item.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function write16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function write32(bytes: Uint8Array, offset: number, value: number): void {
  write16(bytes, offset, value & 0xffff);
  write16(bytes, offset + 2, (value >>> 16) & 0xffff);
}

function read16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) throw new Error('Truncated world package ZIP record.');
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function read32(bytes: Uint8Array, offset: number): number {
  return (read16(bytes, offset) | (read16(bytes, offset + 2) << 16)) >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function utf8Encode(value: string): Uint8Array {
  const result: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let point = value.charCodeAt(index);
    if (point >= 0xd800 && point <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        point = 0x10000 + ((point - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }
    if (point < 0x80) result.push(point);
    else if (point < 0x800) result.push(0xc0 | (point >> 6), 0x80 | (point & 63));
    else if (point < 0x10000) result.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 63), 0x80 | (point & 63));
    else result.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 63), 0x80 | ((point >> 6) & 63), 0x80 | (point & 63));
  }
  return new Uint8Array(result);
}

function utf8Decode(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index] ?? 0;
    let point: number;
    let count: number;
    if (first < 0x80) { point = first; count = 1; }
    else if ((first & 0xe0) === 0xc0) { point = first & 0x1f; count = 2; }
    else if ((first & 0xf0) === 0xe0) { point = first & 0x0f; count = 3; }
    else if ((first & 0xf8) === 0xf0) { point = first & 0x07; count = 4; }
    else throw new Error('World package ZIP filename or payload contains invalid UTF-8.');
    if (index + count > bytes.length) throw new Error('World package ZIP contains truncated UTF-8.');
    for (let offset = 1; offset < count; offset += 1) {
      const continuation = bytes[index + offset] ?? 0;
      if ((continuation & 0xc0) !== 0x80) throw new Error('World package ZIP contains invalid UTF-8.');
      point = (point << 6) | (continuation & 0x3f);
    }
    index += count;
    if (point <= 0xffff) result += String.fromCharCode(point);
    else {
      point -= 0x10000;
      result += String.fromCharCode(0xd800 + (point >> 10), 0xdc00 + (point & 0x3ff));
    }
  }
  return result;
}

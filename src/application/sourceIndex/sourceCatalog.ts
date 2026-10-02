import type { SourceCatalogPortV1, SourceCatalogMemberV1, SourceRangeV1, SourceSetBindingV1 } from '../ports/phase6';
import type { SourceStore } from '../ports/sourceStore';
import type { WorldStore } from '../ports/worldStore';
import { mirrorSourceId } from '../ports/worldStore';
import { assertSourceRange, isSourceBindingCompatible, isSourceSetBindingV1 } from '../../domain/build/validation';
import { codePointLength } from '../../domain/world/textOffsets';

export interface SourceHashProvider { sha256Hex(input: string): Promise<string> | string }
/** Hashing/evidence reads remain bounded even when a logical segment spans many ranges. */
export const MAX_SOURCE_EVIDENCE_CP = 65_536;

export class SourceCatalogAdapter implements SourceCatalogPortV1 {
  constructor(
    private readonly sources: Pick<SourceStore, 'getManifest' | 'getChapters' | 'readRange'>,
    private readonly worlds: Pick<WorldStore, 'listWorldSources'>,
    private readonly hashes: SourceHashProvider,
  ) {}

  async snapshot(worldId: string): Promise<{ binding: SourceSetBindingV1; members: readonly SourceCatalogMemberV1[] }> {
    const memberships = await this.worlds.listWorldSources(worldId);
    if (!memberships.length) throw new Error('source_membership_missing');
    const members: SourceCatalogMemberV1[] = [];
    for (const membership of [...memberships].sort((a, b) => a.sourceOrdinal - b.sourceOrdinal)) {
      const manifest = await this.activeManifest(membership.sourceId);
      if (manifest.rawSha256Hex !== membership.rawSha256) throw new Error('source_membership_hash_mismatch');
      const chapters = await this.sources.getChapters(membership.sourceId);
      members.push({ sourceId: manifest.sourceId, sourceOrdinal: membership.sourceOrdinal,
        normalizedTreeHash: manifest.normalizedTreeHash, rawSha256Hex: manifest.rawSha256Hex,
        codePointCount: manifest.codePointCount,
        chapters: chapters.map(chapter => ({ chapterId: mirrorSourceId(membership.sourceOrdinal, chapter.chapterId),
          startCp: chapter.startOffset, endCp: chapter.endOffset, title: chapter.title })) });
    }
    const bindingMembers = members.map(({ sourceId, sourceOrdinal, normalizedTreeHash }) =>
      ({ sourceId, sourceOrdinal, normalizedTreeHash }));
    const sourceSetHash = await this.hashes.sha256Hex(JSON.stringify({ version: 'source-set-1', members: bindingMembers }));
    const binding: SourceSetBindingV1 = { sourceSetHash, members: bindingMembers };
    if (!isSourceSetBindingV1(binding)) throw new Error('source_membership_invalid');
    return { binding, members };
  }

  async createRange(sourceId: string, startCp: number, endCp: number): Promise<SourceRangeV1> {
    const manifest = await this.activeManifest(sourceId);
    const range: SourceRangeV1 = { sourceId, normalizedTreeHash: manifest.normalizedTreeHash,
      startCp, endCp, rangeContentHash: '0'.repeat(64) };
    assertSourceRange(range, manifest);
    this.assertBounded(range);
    const text = await this.readComplete(range);
    range.rangeContentHash = await this.hashes.sha256Hex(text);
    assertSourceRange(range, manifest);
    // A deletion/replacement during an asynchronous read/hash must fail closed.
    const current = await this.activeManifest(sourceId);
    if (current.normalizedTreeHash !== range.normalizedTreeHash) throw new Error('source_changed');
    return range;
  }

  async readRange(range: SourceRangeV1): Promise<string> {
    const manifest = await this.activeManifest(range.sourceId);
    assertSourceRange(range, manifest);
    this.assertBounded(range);
    const text = await this.readComplete(range);
    if (await this.hashes.sha256Hex(text) !== range.rangeContentHash) throw new Error('source_range_hash_mismatch');
    const current = await this.activeManifest(range.sourceId);
    if (current.normalizedTreeHash !== range.normalizedTreeHash) throw new Error('source_changed');
    return text;
  }

  async isBindingCompatible(worldId: string, binding: SourceSetBindingV1): Promise<boolean> {
    if (!isSourceSetBindingV1(binding)) return false;
    try { return isSourceBindingCompatible(binding, (await this.snapshot(worldId)).binding); }
    catch { return false; }
  }

  private assertBounded(range: SourceRangeV1): void {
    if (range.endCp - range.startCp > MAX_SOURCE_EVIDENCE_CP) throw new Error('source_range_requires_bounded_slices');
  }
  private async activeManifest(sourceId: string) {
    const manifest = await this.sources.getManifest(sourceId);
    if (!manifest || manifest.status !== 'active') throw new Error('source_not_active');
    return manifest;
  }
  private async readComplete(range: SourceRangeV1): Promise<string> {
    const text = await this.sources.readRange(range.sourceId, range.startCp, range.endCp);
    if (codePointLength(text) !== range.endCp - range.startCp) throw new Error('source_range_incomplete');
    return text;
  }
}

import { emptyStoryMemoryState, storyMemoryContentHash, type StoryMemoryPatch, type StoryMemoryState } from './storyMemoryTypes';
import { mergeStoryMemoryPatch } from './storyMemoryMerger';

export interface AppliedMemoryLink {
  patchId: string; fromStateVersion: number; toStateVersion: number; baseFingerprint: string;
  resultFingerprint: string | null; patch: StoryMemoryPatch; createdAt: string; appliedAt: string | null;
}

/** Verify the source chain before rebinding. Every evidence version is engine owned. */
export function replayMemoryChain(links: readonly AppliedMemoryLink[], branchId: string, now: string,
  turnVersions?: ReadonlyMap<string, number>): StoryMemoryState {
  let state = emptyStoryMemoryState(branchId, now);
  for (const link of links) {
    const manifest = link.patch.evidenceVersions;
    if (!manifest || link.patch.schemaVersion !== 3 || link.fromStateVersion !== state.throughStateVersion
      || link.patch.range.fromStateVersion !== link.fromStateVersion || link.patch.range.toStateVersion !== link.toStateVersion) {
      throw new Error('Memory chain has a missing evidence manifest or noncontiguous range.');
    }
    const versions = new Map(Object.entries(manifest));
    for (const [id, version] of versions) {
      if (!Number.isSafeInteger(version) || version <= link.fromStateVersion || version > link.toStateVersion
        || (turnVersions && turnVersions.get(id) !== version)) throw new Error('Memory chain evidence does not match committed turns.');
    }
    state = mergeStoryMemoryPatch(state, { patch: link.patch, patchId: link.patchId,
      baseFingerprint: link.baseFingerprint, turnVersions: versions, now });
    if (state.metadata.fingerprint !== link.resultFingerprint) throw new Error('Memory chain fingerprint mismatch.');
  }
  return state;
}

export function assertMemoryCheckpointChain(state: StoryMemoryState | null, links: readonly AppliedMemoryLink[],
  branchId: string, currentVersion: number, turnVersions?: ReadonlyMap<string, number>): void {
  if (!state) { if (links.length) throw new Error('Memory patches have no checkpoint body.'); return; }
  if (state.schemaVersion !== 3 || state.branchId !== branchId || !Number.isSafeInteger(state.throughStateVersion)
    || state.throughStateVersion > currentVersion || state.throughStateVersion < 0) throw new Error('Memory checkpoint identity or coverage is invalid.');
  const replayed = replayMemoryChain(links, branchId, state.metadata.updatedAt, turnVersions);
  if (storyMemoryContentHash(replayed) !== storyMemoryContentHash(state)
    || replayed.metadata.fingerprint !== state.metadata.fingerprint
    || (state.metadata.contentHash && state.metadata.contentHash !== storyMemoryContentHash(state))) {
    throw new Error('Memory checkpoint body differs from its verified patch chain.');
  }
}

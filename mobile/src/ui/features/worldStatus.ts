/**
 * Shared presentation helper for a world's build/publication state.
 *
 * Used by the library card and the world-detail overview so the two surfaces
 * cannot drift apart. Only stored values are mapped; an unknown status is shown
 * verbatim instead of being guessed.
 */
import type { WorldLibraryEntry } from '../../worldImport';

/** `buildStatus` values written by the world builder, in product language. */
const STATUS_LABEL: Record<string, string> = {
  importing: '解析原文中',
  extracting: '抽取中',
  merging: '整合中',
  ready: '资料就绪（未发布三宝书）',
  failed: '构建未完成',
};

export function worldStatusLine(world: WorldLibraryEntry): string {
  if (world.packageRevision >= 1) return `已发布 · r${world.packageRevision}`;
  return STATUS_LABEL[world.buildStatus] ?? world.buildStatus;
}

/** Human label for a raw builder status (no revision involved). */
export function worldBuildStatusLabel(buildStatus: string): string {
  return STATUS_LABEL[buildStatus] ?? buildStatus;
}
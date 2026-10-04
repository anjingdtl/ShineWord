/**
 * Pending Bridge (P8-1, plan §9.4): turns "memory is stale" into a coverage
 * fact. Every authoritative commit after the last eligible checkpoint is
 * listed explicitly as pending-bridge material, or recorded as a gap. Recent
 * top-N recall cannot replace this list, and "no retrieval hit" is never
 * interpreted as "did not happen" (plan I10).
 */

import type { CoverageManifest } from './storyMemoryEligibility';

export interface PendingBridgeCommit {
  stateVersion: number;
  turnId: string;
  publicSummary: string;
}

export interface PendingBridgeGap {
  kind: 'missing_commit';
  fromStateVersion: number;
  toStateVersion: number;
}

export interface PendingBridgeResult {
  commits: PendingBridgeCommit[];
  gaps: PendingBridgeGap[];
  manifest: CoverageManifest;
}

export interface BuildPendingBridgeInput {
  committedTurns: ReadonlyArray<{
    turnId: string;
    stateVersion: number;
    publicSummary: string;
  }>;
  /** Exclusive lower bound (checkpoint through version, or branch seed origin). */
  fromStateVersion: number;
  /** Inclusive upper bound (current branch head). */
  toStateVersion: number;
}

export function buildPendingBridge(input: BuildPendingBridgeInput): PendingBridgeResult {
  const byVersion = new Map<number, PendingBridgeCommit>();
  for (const turn of input.committedTurns) {
    if (turn.stateVersion > input.fromStateVersion && turn.stateVersion <= input.toStateVersion) {
      if (!byVersion.has(turn.stateVersion)) {
        byVersion.set(turn.stateVersion, {
          stateVersion: turn.stateVersion,
          turnId: turn.turnId,
          publicSummary: turn.publicSummary ?? '',
        });
      }
    }
  }
  const commits: PendingBridgeCommit[] = [];
  const gaps: PendingBridgeGap[] = [];
  for (let version = input.fromStateVersion + 1; version <= input.toStateVersion; version += 1) {
    const commit = byVersion.get(version);
    if (commit) commits.push(commit);
    else gaps.push({ kind: 'missing_commit', fromStateVersion: version, toStateVersion: version });
  }
  const manifest: CoverageManifest = {
    throughStateVersion: input.fromStateVersion,
    currentStateVersion: input.toStateVersion,
    entries: [
      ...commits.map(commit => ({
        stateVersion: commit.stateVersion,
        turnId: commit.turnId,
        status: 'pending_bridge' as const,
      })),
      ...gaps.map(gap => ({
        stateVersion: gap.fromStateVersion,
        turnId: null,
        status: 'gap' as const,
      })),
    ].sort((a, b) => a.stateVersion - b.stateVersion),
    contiguous: gaps.length === 0,
  };
  return { commits, gaps, manifest };
}

/**
 * Renders the bridge as a prompt-material text. Every commit stays in the
 * list (one short line each); long summaries are clipped per line, never
 * dropped — if the whole item cannot fit the budget the allocator decides
 * with an explicit drop reason, not silence.
 */
export function renderPendingBridge(bridge: PendingBridgeResult, options?: {
  heading?: string;
  maxSummaryChars?: number;
}): string {
  const heading = options?.heading ?? '未整理补桥';
  const maxChars = options?.maxSummaryChars ?? 120;
  const lines: string[] = [`【${heading}】记忆检查点之后已提交但尚未整理的经历（每条都必须被下一回合知晓）：`];
  for (const commit of bridge.commits) {
    const summary = commit.publicSummary.length > maxChars
      ? `${commit.publicSummary.slice(0, maxChars)}…`
      : commit.publicSummary;
    lines.push(`- v${commit.stateVersion} ${commit.turnId}: ${summary || '(无公开摘要，见事件)'}`);
  }
  for (const gap of bridge.gaps) {
    lines.push(`- v${gap.fromStateVersion}: [覆盖缺口] 该版本提交记录缺失，历史不可证明连续`);
  }
  return lines.join('\n');
}

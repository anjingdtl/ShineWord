import type { BuildRunStore } from '../ports/worldBuildStore';
import type { WorldStore } from '../ports/worldStore';

export const AUTOMATIC_MAPPING_RETRY = 'mapping_auto_retry';

export function isAutomaticMappingFailure(reason: string): boolean {
  if (/outcome_unknown|unknown outcome|401|403|unauthorized|invalid.{0,12}(key|credential)|API key is missing|不支持思考|cannot reserve|capability.*insufficient/i.test(reason)) return false;
  return /truncat|finish_reason|思维链|未产生正文|no JSON|could not be parsed|proposal arrays|Mandatory protocol input|context length|prompt too long|input too long|network|offline|timeout|timed out|429|502|503|504|fetch failed|econn/i.test(reason);
}

interface RecoveryDeps<T extends { completed: boolean }> {
  runStore: BuildRunStore;
  worldStore: WorldStore;
  execute: () => Promise<T>;
  signal: { aborted: boolean; stopRequested?: boolean };
  onWaiting?: (message: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Durable engineering recovery shared by inline and headless execution.
 * Backoff and completed mapping payloads survive process exits. Pause and
 * stop stay responsive; technical failures never enter content review. */
export async function executeWithAutomaticMappingRecovery<T extends { completed: boolean }>(
  deps: RecoveryDeps<T>, runId: string,
): Promise<T> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const run = await deps.runStore.getRun(runId);
  if (!run) throw new Error(`Unknown run ${runId}.`);
  const jobId = `job-map-recovery-${runId}`;
  let result: T | undefined;
  while (true) {
    const snapshot = await deps.runStore.getRun(runId);
    const job = await deps.worldStore.getJob(run.worldId, jobId);
    if (snapshot?.lastErrorCode === AUTOMATIC_MAPPING_RETRY && job?.status === 'pending' && job.resultJson) {
      const retry = JSON.parse(job.resultJson) as { nextRetryAt: number };
      deps.onWaiting?.('映射正在后台自动恢复；已完成成果保留，稍后自动续试');
      while (now() < retry.nextRetryAt && !deps.signal.aborted) {
        const controls = await deps.runStore.getRun(runId);
        if (!controls || controls.pauseRequested || controls.cancelRequested
          || controls.status === 'paused_user' || controls.status === 'stopped_user') break;
        await sleep(Math.min(500, retry.nextRetryAt - now()));
      }
    }
    const controls = await deps.runStore.getRun(runId);
    if (deps.signal.aborted || controls?.pauseRequested || controls?.cancelRequested
      || controls?.status === 'paused_user' || controls?.status === 'stopped_user') {
      if (result && controls && controls.status !== 'completed') {
        const stopped = deps.signal.stopRequested || controls.cancelRequested || controls.status === 'stopped_user';
        const timestamp = new Date(now()).toISOString();
        await deps.runStore.requestRunControl(runId, 'resume', timestamp);
        await deps.runStore.setRunStatus(runId, stopped ? 'stopped_user' : 'paused_user', timestamp);
      }
      return result ?? await deps.execute();
    }
    result = await deps.execute();
    const latest = await deps.runStore.getRun(runId);
    if (result.completed || deps.signal.aborted || latest?.status !== 'failed_retryable'
      || latest.lastErrorCode !== AUTOMATIC_MAPPING_RETRY) return result;
    const previous = await deps.worldStore.getJob(run.worldId, jobId);
    const attempts = (previous?.attempts ?? 0) + 1;
    // A persistent provider fault opens a five-minute circuit after three
    // waves, avoiding a tight paid-request loop. Waits remain interruptible.
    const delay = attempts >= 3 ? 300_000 : 5_000 * 2 ** (attempts - 1);
    const timestamp = new Date(now()).toISOString();
    await deps.worldStore.upsertJob({
      worldId: run.worldId, jobId, kind: 'rule_mapping', targetId: runId,
      status: 'pending', attempts, contentHash: null, extractorVersion: 'automatic-mapping-recovery-1',
      modelFingerprint: null, usageJson: null,
      resultJson: JSON.stringify({ nextRetryAt: now() + delay }),
      error: null, createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp,
    }, timestamp);
  }
}

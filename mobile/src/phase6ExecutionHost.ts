import type { BuildRunStore } from '../../src/application/ports/worldBuildStore';
import type { ExecutionHostPortV1 } from '../../src/application/ports/phase6';

/** OS execution adapter. It delegates all leases and checkpoints to the existing runner. */
export class AndroidSegmentExecutionHost implements ExecutionHostPortV1 {
  constructor(private readonly deps: {
    runs: Pick<BuildRunStore, 'getRun' | 'setRunStatus' | 'listUnits' | 'requestSystemPause'>;
    projectExists(worldId: string): Promise<boolean>;
    credentialsAvailable(runId: string): Promise<boolean>;
    launch(runId: string): Promise<void>;
    controlRun(runId: string, command: 'pause' | 'resume' | 'cancel'): Promise<void>;
    now?: () => string;
  }) {}

  async start(runId: string): Promise<void> {
    const run = await this.deps.runs.getRun(runId);
    if (!run || !await this.deps.projectExists(run.worldId)) return;
    if (!this.canStart(run) || await this.hasUnknownOutcome(run)) return;
    const unlocked = await this.deps.credentialsAvailable(runId);
    // Keychain can wait for an OS unlock. Deletion or a user pause during that
    // await must remain authoritative when it returns.
    const current = await this.deps.runs.getRun(runId);
    if (!current || !await this.deps.projectExists(current.worldId)
      || !this.canStart(current) || await this.hasUnknownOutcome(current)) return;
    if (!unlocked) {
      await this.deps.runs.setRunStatus(runId, 'waiting_unlock', this.now(), 'keychain_unavailable', '解锁后可继续整理。');
      return;
    }
    // A second entry reaches the same persisted lease CAS in executeRun.
    // This adapter deliberately has no process-local ownership substitute.
    await this.deps.launch(runId);
  }

  async control(runId: string, command: 'pause' | 'resume' | 'cancel'): Promise<void> {
    const run = await this.deps.runs.getRun(runId);
    if (!run || !await this.deps.projectExists(run.worldId)) return;
    // A resume tap alone is not approval to repeat an unknown paid outcome.
    if (command === 'resume' && await this.hasUnknownOutcome(run)) return;
    await this.deps.controlRun(runId, command);
    if (command === 'resume') await this.start(runId);
  }

  async systemPaused(runId: string, reason: 'fgs_dataSync_timeout' | 'background_start_denied'): Promise<void> {
    const run = await this.deps.runs.getRun(runId);
    if (!run || !await this.deps.projectExists(run.worldId)) return;
    if (!this.deps.runs.requestSystemPause) throw new Error('execution_system_pause_not_supported');
    // M4 atomically preserves user controls and terminal verdicts. Calling the
    // ordinary pause control here would turn an OS pause into a user pause.
    await this.deps.runs.requestSystemPause(runId, reason, this.now());
  }

  private now(): string { return (this.deps.now ?? (() => new Date().toISOString()))(); }

  private canStart(run: Awaited<ReturnType<BuildRunStore['getRun']>>): boolean {
    return Boolean(run && !run.pauseRequested && !run.cancelRequested
      && !['paused_user', 'stopped_user', 'paused_system', 'canceled', 'completed', 'failed_terminal', 'needs_review'].includes(run.status));
  }

  private async hasUnknownOutcome(run: NonNullable<Awaited<ReturnType<BuildRunStore['getRun']>>>): Promise<boolean> {
    return Boolean(run.lastErrorCode?.includes('outcome_unknown'))
      || (await this.deps.runs.listUnits(run.runId)).some(unit => unit.status !== 'completed'
        && Boolean(unit.errorCode?.includes('outcome_unknown')));
  }
}

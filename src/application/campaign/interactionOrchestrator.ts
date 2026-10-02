import type { SqliteDatabase, SqliteRow, SqliteTransaction } from '../ports/sqlite';

export type InteractionOperationStatus = 'running' | 'paused_system' | 'completed' | 'failed';

export interface InteractionOperation {
  operationId: string;
  campaignId: string;
  branchId: string;
  kind: 'encounter_auto' | 'play_turn';
  status: InteractionOperationStatus;
  expectedStateVersion: number;
  fenceToken: number;
  nextStep: number;
  maxSteps: number;
  replayPreparedStep: boolean;
}

export interface InteractionOperationStep {
  operationId: string;
  stepIndex: number;
  actionKind: 'npc_turn';
  requestId: string;
  expectedStateVersion: number;
  committedStateVersion: number | null;
  status: 'prepared' | 'committed';
}

export interface InteractionOperationRunInput<TAction> {
  operationId: string;
  campaignId: string;
  branchId: string;
  kind: 'encounter_auto' | 'play_turn';
  expectedStateVersion: number;
  /** Derive the next action only from the current, authoritative local view. */
  nextAction: (stepIndex: number, stateVersion: number, replayPreparedStep: boolean) => Promise<TAction | null>;
  actionKind: (action: TAction) => 'npc_turn';
  executeAction: (action: TAction, requestId: string, fenceToken: number) => Promise<{ stateVersion: number; continue: boolean }>;
  /** Checked only between commits; an in-flight mechanical action is not aborted. */
  pauseRequested?: () => boolean;
  yieldToUi?: () => Promise<void>;
  now?: () => number;
  /** Fault-injection seam: called after the game commit and before journal checkpoint. */
  afterActionBeforeCheckpoint?: (step: InteractionOperationStep) => Promise<void>;
}

export interface InteractionOperationRunResult {
  operation: InteractionOperation;
  stepsThisRun: number;
  pauseReason: 'player_decision' | 'system' | 'step_limit' | 'wall_clock' | null;
}

/**
 * Durable coordinator for bounded actions such as NPC encounter turns.
 * Game state remains authoritative in the existing turn/snapshot stores. The
 * journal contains only stable ids, step fences and checkpoint versions.
 */
export class SqliteInteractionOperationJournal {
  constructor(private readonly db: SqliteDatabase, private readonly nowIso: () => string = () => new Date().toISOString()) {}

  /** Ordinary turns use the same branch journal BEFORE any Planner request. */
  async guardTurn<T>(input: { campaignId: string; branchId: string; turnId: string; expectedStateVersion: number },
    work: (fence: { campaignId: string; fenceToken: number }) => Promise<T>): Promise<T> {
    // A crash after game commit but before the journal acknowledgement must
    // not leave a completed turn permanently locking the branch.
    await this.db.execute(`UPDATE interaction_operations SET status='completed',updated_at=?
      WHERE branch_id=? AND operation_kind='play_turn' AND status IN ('running','paused_system')
      AND EXISTS (SELECT 1 FROM turns t WHERE t.branch_id=interaction_operations.branch_id
        AND t.status='Committed' AND t.committed_state_version=interaction_operations.expected_state_version+1)`, [this.nowIso(),input.branchId]);
    const operation = await this.open({ ...input, operationId: `play:${input.branchId}:${input.turnId}`,
      kind: 'play_turn', nextAction: async () => null, actionKind: () => 'npc_turn',
      executeAction: async () => ({ stateVersion: input.expectedStateVersion, continue: false }) });
    try {
      const result = await work({ campaignId: input.campaignId, fenceToken: operation.fenceToken });
      await this.db.execute(`UPDATE interaction_operations SET status='completed',updated_at=?
        WHERE operation_id=? AND fence_token=?`, [this.nowIso(),operation.operationId,operation.fenceToken]);
      return result;
    } catch (error) {
      await this.pause(operation,'system');
      throw error;
    }
  }

  async run<TAction>(input: InteractionOperationRunInput<TAction>): Promise<InteractionOperationRunResult> {
    validateInput(input);
    let operation = await this.open(input);
    if (operation.status === 'completed') {
      return { operation, stepsThisRun: 0, pauseReason: null };
    }
    const startTime = (input.now ?? Date.now)();
    const deadline = startTime + 10_000;
    let stepsThisRun = 0;
    const yieldToUi = input.yieldToUi ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)));

    try {
      while (operation.nextStep < operation.maxSteps) {
        if (input.pauseRequested?.()) {
          operation = await this.pause(operation, 'system');
          return { operation, stepsThisRun, pauseReason: 'system' };
        }
        if ((input.now ?? Date.now)() >= deadline) {
          operation = await this.pause(operation, 'system');
          return { operation, stepsThisRun, pauseReason: 'wall_clock' };
        }

        await this.assertFence(operation);
        const action = await input.nextAction(
          operation.nextStep, operation.expectedStateVersion, operation.replayPreparedStep,
        );
        if (action === null) {
          operation = await this.complete(operation);
          return { operation, stepsThisRun, pauseReason: 'player_decision' };
        }

        const kind = input.actionKind(action);
        const requestId = childRequestId(operation.operationId, operation.nextStep);
        const step = await this.prepareStep(operation, kind, requestId);
        await this.assertFence(operation);
        const result = await input.executeAction(action, step.requestId, operation.fenceToken);
        await input.afterActionBeforeCheckpoint?.(step);
        operation = await this.checkpointStep(operation, step, result.stateVersion);
        stepsThisRun += 1;

        if (!result.continue) {
          operation = await this.complete(operation);
          return { operation, stepsThisRun, pauseReason: 'player_decision' };
        }
        if (stepsThisRun % 4 === 0) await yieldToUi();
      }

      operation = await this.pause(operation, 'system');
      return { operation, stepsThisRun, pauseReason: 'step_limit' };
    } catch (error) {
      // A retryable failure remains resumable; prepared request ids make a
      // post-commit/pre-checkpoint restart replay the same child action.
      try { operation = await this.pause(operation, 'system'); } catch { /* stale fence already owns recovery */ }
      throw error;
    }
  }

  async getOperation(operationId: string): Promise<InteractionOperation | null> {
    const row = await this.db.queryOne<OperationRow>(
      'SELECT * FROM interaction_operations WHERE operation_id = ?', [operationId],
    );
    return row ? operationFromRow(row) : null;
  }

  async listSteps(operationId: string): Promise<InteractionOperationStep[]> {
    const rows = await this.db.queryAll<StepRow>(
      'SELECT * FROM interaction_operation_steps WHERE operation_id = ? ORDER BY step_index', [operationId],
    );
    return rows.map(stepFromRow);
  }

  async getResumableOperation(campaignId: string, branchId: string): Promise<InteractionOperation | null> {
    const row = await this.db.queryOne<OperationRow>(
      `SELECT * FROM interaction_operations WHERE campaign_id = ? AND branch_id = ?
        AND operation_kind='encounter_auto' AND status IN ('running', 'paused_system') ORDER BY updated_at DESC LIMIT 1`,
      [campaignId, branchId],
    );
    if (!row) return null;
    const operation = operationFromRow(row);
    const prepared = await this.db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM interaction_operation_steps
        WHERE operation_id = ? AND step_index = ? AND status = 'prepared'`,
      [operation.operationId, operation.nextStep],
    );
    const branch = await this.db.queryOne<{ state_version: number }>(
      'SELECT state_version FROM branches WHERE branch_id = ?', [branchId],
    );
    operation.replayPreparedStep = (prepared?.n ?? 0) === 1
      && branch?.state_version === operation.expectedStateVersion + 1;
    return operation;
  }

  private async open<TAction>(input: InteractionOperationRunInput<TAction>): Promise<InteractionOperation> {
    return this.db.transaction(async tx => {
      const branch = await tx.queryOne<{ campaign_id: string; state_version: number }>(
        'SELECT campaign_id, state_version FROM branches WHERE branch_id = ?', [input.branchId],
      );
      if (!branch || branch.campaign_id !== input.campaignId) throw new Error('分支不属于当前战役。');
      if (branch.state_version !== input.expectedStateVersion) throw new Error('分支状态已变化，请刷新后再继续。');

      const prior = await tx.queryOne<OperationRow>(
        'SELECT * FROM interaction_operations WHERE operation_id = ?', [input.operationId],
      );
      let replayPreparedStep = false;
      if (prior) {
        if (prior.campaign_id !== input.campaignId || prior.branch_id !== input.branchId || prior.operation_kind !== input.kind) {
          throw new Error('操作编号已绑定到其他战役、分支或类型。');
        }
        if (prior.status === 'completed') return operationFromRow(prior);
        const recoverable = await tx.queryOne<{ n: number }>(
          `SELECT COUNT(*) AS n FROM interaction_operation_steps
            WHERE operation_id = ? AND step_index = ? AND status = 'prepared'`,
          [input.operationId, prior.next_step],
        );
        if (branch.state_version !== prior.expected_state_version
          && !(branch.state_version === prior.expected_state_version + 1 && (recoverable?.n ?? 0) === 1)) {
          throw new Error('待恢复操作与分支检查点不一致；为避免重复结算已停止。');
        }
        replayPreparedStep = branch.state_version === prior.expected_state_version + 1 && (recoverable?.n ?? 0) === 1;
      }

      const running = await tx.queryOne<{ operation_id: string }>(
        `SELECT operation_id FROM interaction_operations
          WHERE branch_id = ? AND status = 'running' AND operation_id <> ? LIMIT 1`,
        [input.branchId, input.operationId],
      );
      if (running) throw new Error('该分支已有自动行动正在运行。');

      const fence = await tx.queryOne<{ fence_token: number }>(
        'SELECT fence_token FROM interaction_campaign_fences WHERE campaign_id = ?', [input.campaignId],
      );
      const fenceToken = (fence?.fence_token ?? 0) + 1;
      await tx.execute(
        `INSERT INTO interaction_campaign_fences (campaign_id, fence_token, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(campaign_id) DO UPDATE SET fence_token = excluded.fence_token, updated_at = excluded.updated_at`,
        [input.campaignId, fenceToken, this.nowIso()],
      );

      if (prior) {
        await tx.execute(
          `UPDATE interaction_operations SET status = 'running', fence_token = ?, updated_at = ?
            WHERE operation_id = ?`,
          [fenceToken, this.nowIso(), input.operationId],
        );
      } else {
        await tx.execute(
          `INSERT INTO interaction_operations
            (operation_id, campaign_id, branch_id, operation_kind, status, expected_state_version,
             fence_token, next_step, max_steps, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'running', ?, ?, 0, 32, ?, ?)`,
          [input.operationId, input.campaignId, input.branchId, input.kind, input.expectedStateVersion,
            fenceToken, this.nowIso(), this.nowIso()],
        );
      }
      const row = await tx.queryOne<OperationRow>(
        'SELECT * FROM interaction_operations WHERE operation_id = ?', [input.operationId],
      );
      if (!row) throw new Error('无法建立自动行动检查点。');
      return { ...operationFromRow(row), replayPreparedStep };
    });
  }

  private async assertFence(operation: InteractionOperation): Promise<void> {
    const row = await this.db.queryOne<{
      status: string; operation_fence: number; campaign_fence: number;
      operation_version: number; branch_version: number; next_step: number;
    }>(
      `SELECT o.status, o.fence_token AS operation_fence, f.fence_token AS campaign_fence,
              o.expected_state_version AS operation_version, b.state_version AS branch_version, o.next_step
         FROM interaction_operations o
         JOIN interaction_campaign_fences f ON f.campaign_id = o.campaign_id
         JOIN branches b ON b.branch_id = o.branch_id
        WHERE o.operation_id = ?`,
      [operation.operationId],
    );
    if (!row || row.status !== 'running' || row.operation_fence !== operation.fenceToken
      || row.campaign_fence !== operation.fenceToken || row.next_step !== operation.nextStep) {
      throw new Error('自动行动已被更新的分支操作接管。');
    }
    if (row.branch_version !== row.operation_version) {
      const prepared = await this.db.queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM interaction_operation_steps
          WHERE operation_id = ? AND step_index = ? AND expected_state_version = ? AND status = 'prepared'`,
        [operation.operationId, operation.nextStep, row.operation_version],
      );
      if (!(row.branch_version === row.operation_version + 1 && (prepared?.n ?? 0) === 1)) {
        throw new Error('分支版本与自动行动检查点不一致。');
      }
    }
  }

  private async prepareStep(
    operation: InteractionOperation,
    actionKind: 'npc_turn',
    requestId: string,
  ): Promise<InteractionOperationStep> {
    return this.db.transaction(async tx => {
      await this.assertFenceInTransaction(tx, operation);
      const old = await tx.queryOne<StepRow>(
        'SELECT * FROM interaction_operation_steps WHERE operation_id = ? AND step_index = ?',
        [operation.operationId, operation.nextStep],
      );
      if (old) {
        if (old.action_kind !== actionKind || old.request_id !== requestId
          || old.expected_state_version !== operation.expectedStateVersion || old.status !== 'prepared') {
          throw new Error('已准备的自动行动与当前请求不匹配。');
        }
        return stepFromRow(old);
      }
      await tx.execute(
        `INSERT INTO interaction_operation_steps
          (operation_id, step_index, action_kind, request_id, expected_state_version,
           committed_state_version, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'prepared', ?, ?)`,
        [operation.operationId, operation.nextStep, actionKind, requestId, operation.expectedStateVersion,
          this.nowIso(), this.nowIso()],
      );
      const row = await tx.queryOne<StepRow>(
        'SELECT * FROM interaction_operation_steps WHERE operation_id = ? AND step_index = ?',
        [operation.operationId, operation.nextStep],
      );
      if (!row) throw new Error('无法准备自动行动步骤。');
      return stepFromRow(row);
    });
  }

  private async checkpointStep(
    operation: InteractionOperation,
    step: InteractionOperationStep,
    committedStateVersion: number,
  ): Promise<InteractionOperation> {
    return this.db.transaction(async tx => {
      await this.assertFenceInTransaction(tx, operation);
      const branch = await tx.queryOne<{ state_version: number }>(
        'SELECT state_version FROM branches WHERE branch_id = ?', [operation.branchId],
      );
      if (!branch || branch.state_version !== committedStateVersion
        || committedStateVersion !== operation.expectedStateVersion + 1) {
        throw new Error('自动行动提交版本不匹配，检查点未推进。');
      }
      await tx.execute(
        `UPDATE interaction_operation_steps SET status = 'committed', committed_state_version = ?, updated_at = ?
          WHERE operation_id = ? AND step_index = ? AND status = 'prepared'`,
        [committedStateVersion, this.nowIso(), operation.operationId, step.stepIndex],
      );
      await tx.execute(
        `UPDATE interaction_operations SET expected_state_version = ?, next_step = next_step + 1, updated_at = ?
          WHERE operation_id = ? AND status = 'running' AND fence_token = ?`,
        [committedStateVersion, this.nowIso(), operation.operationId, operation.fenceToken],
      );
      const row = await tx.queryOne<OperationRow>(
        'SELECT * FROM interaction_operations WHERE operation_id = ?', [operation.operationId],
      );
      if (!row) throw new Error('自动行动检查点丢失。');
      return operationFromRow(row);
    });
  }

  private async pause(operation: InteractionOperation, _reason: 'system'): Promise<InteractionOperation> {
    await this.db.execute(
      `UPDATE interaction_operations SET status = 'paused_system', updated_at = ?
        WHERE operation_id = ? AND status = 'running' AND fence_token = ?`,
      [this.nowIso(), operation.operationId, operation.fenceToken],
    );
    return { ...operation, status: 'paused_system' };
  }

  private async complete(operation: InteractionOperation): Promise<InteractionOperation> {
    await this.assertFence(operation);
    await this.db.execute(
      `UPDATE interaction_operations SET status = 'completed', updated_at = ?
        WHERE operation_id = ? AND status = 'running' AND fence_token = ?`,
      [this.nowIso(), operation.operationId, operation.fenceToken],
    );
    return { ...operation, status: 'completed' };
  }

  private async assertFenceInTransaction(tx: SqliteTransaction, operation: InteractionOperation): Promise<void> {
    const row = await tx.queryOne<{
      status: string; operation_fence: number; campaign_fence: number; operation_version: number;
      branch_version: number; next_step: number;
    }>(
      `SELECT o.status, o.fence_token AS operation_fence, f.fence_token AS campaign_fence,
              o.expected_state_version AS operation_version, b.state_version AS branch_version, o.next_step
         FROM interaction_operations o
         JOIN interaction_campaign_fences f ON f.campaign_id = o.campaign_id
         JOIN branches b ON b.branch_id = o.branch_id
        WHERE o.operation_id = ?`, [operation.operationId],
    );
    const prepared = row && row.branch_version === row.operation_version + 1
      ? await tx.queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM interaction_operation_steps
          WHERE operation_id = ? AND step_index = ? AND expected_state_version = ? AND status = 'prepared'`,
        [operation.operationId, operation.nextStep, row.operation_version],
      )
      : null;
    if (!row || row.status !== 'running' || row.operation_fence !== operation.fenceToken
      || row.campaign_fence !== operation.fenceToken || row.next_step !== operation.nextStep
      || (row.branch_version !== row.operation_version && (prepared?.n ?? 0) !== 1)) {
      throw new Error('自动行动租约或分支版本已失效。');
    }
  }
}

interface OperationRow extends SqliteRow {
  operation_id: string; campaign_id: string; branch_id: string; operation_kind: 'encounter_auto' | 'play_turn';
  status: InteractionOperationStatus; expected_state_version: number; fence_token: number;
  next_step: number; max_steps: number;
}

interface StepRow extends SqliteRow {
  operation_id: string; step_index: number; action_kind: 'npc_turn'; request_id: string;
  expected_state_version: number; committed_state_version: number | null; status: 'prepared' | 'committed';
}

function validateInput<TAction>(input: InteractionOperationRunInput<TAction>): void {
  if (!input.operationId || input.operationId.length > 200 || /[\u0000-\u001f]/.test(input.operationId)) {
    throw new Error('自动行动编号格式无效。');
  }
  if (!input.campaignId || !input.branchId || !Number.isInteger(input.expectedStateVersion) || input.expectedStateVersion < 0) {
    throw new Error('自动行动的战役、分支或预期版本无效。');
  }
}

function childRequestId(operationId: string, stepIndex: number): string {
  const suffix = `:s${stepIndex}`;
  const prefix = operationId.length + suffix.length <= 96 ? operationId : operationId.slice(0, 96 - suffix.length);
  return `${prefix}${suffix}`;
}

function operationFromRow(row: OperationRow): InteractionOperation {
  return {
    operationId: row.operation_id, campaignId: row.campaign_id, branchId: row.branch_id,
    kind: row.operation_kind, status: row.status, expectedStateVersion: row.expected_state_version,
    fenceToken: row.fence_token, nextStep: row.next_step, maxSteps: row.max_steps, replayPreparedStep: false,
  };
}

function stepFromRow(row: StepRow): InteractionOperationStep {
  return {
    operationId: row.operation_id, stepIndex: row.step_index, actionKind: row.action_kind,
    requestId: row.request_id, expectedStateVersion: row.expected_state_version,
    committedStateVersion: row.committed_state_version, status: row.status,
  };
}

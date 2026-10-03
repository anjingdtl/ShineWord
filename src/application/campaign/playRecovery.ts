import type { SqliteDatabase, SqliteTransaction } from '../ports/sqlite';
import type { LlmReplayApprovalPort } from '../ports/llmLedger';

export interface PlayRecovery {
  expectedStateVersion: number;
  intent: string;
  frozen: boolean;
  unknownAttemptIds: string[];
}

async function branchVersion(db: SqliteTransaction, campaignId: string, branchId: string): Promise<number> {
  const row = await db.queryOne<{ state_version: number }>(
    'SELECT state_version FROM branches WHERE branch_id = ? AND campaign_id = ?', [branchId, campaignId],
  );
  if (!row) throw new Error('战役分支不存在。');
  return row.state_version;
}

export async function loadPlayRecovery(
  db: SqliteTransaction, campaignId: string, branchId: string,
): Promise<PlayRecovery | null> {
  const version = await branchVersion(db, campaignId, branchId);
  const draft = await db.queryOne<{ intent_text: string }>(
    'SELECT intent_text FROM play_intent_drafts WHERE branch_id = ? AND expected_state_version = ?', [branchId, version],
  );
  const staged = await db.queryOne<{ action_contract_json: string }>(
    `SELECT action_contract_json FROM turns WHERE branch_id = ? AND expected_state_version = ?
      AND committed_state_version IS NULL ORDER BY created_at LIMIT 1`, [branchId, version],
  );
  const unknown = await db.queryAll<{ attempt_id: string }>(
    `SELECT attempt_id FROM llm_request_attempts WHERE branch_id = ? AND state_version = ?
      AND request_kind IN ('planner', 'narrator') AND status = 'outcome_unknown'
      AND replay_approved_at IS NULL ORDER BY started_at`, [branchId, version],
  );
  const contractIntent = staged ? (JSON.parse(staged.action_contract_json) as { intent?: string }).intent : '';
  const intent = draft?.intent_text || contractIntent || '';
  if (!intent && !staged && unknown.length === 0) return null;
  return { expectedStateVersion: version, intent, frozen: !!staged, unknownAttemptIds: unknown.map(row => row.attempt_id) };
}

/** Persist before dispatch. A staged contract or unknown dispatch locks the original action. */
export async function savePlayIntentDraft(
  db: SqliteDatabase, campaignId: string, branchId: string, intent: string,
): Promise<number> {
  if (!intent.trim()) throw new Error('行动不能为空。');
  return db.transaction(async tx => {
    const pending = await loadPlayRecovery(tx, campaignId, branchId);
    if (pending && (pending.frozen || pending.unknownAttemptIds.length > 0)
      && pending.intent && pending.intent !== intent) throw new Error('请先恢复原先未完成的行动。');
    const version = pending?.expectedStateVersion ?? await branchVersion(tx, campaignId, branchId);
    await tx.execute(
      `INSERT INTO play_intent_drafts (branch_id, expected_state_version, intent_text, updated_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(branch_id) DO UPDATE SET
       expected_state_version = excluded.expected_state_version, intent_text = excluded.intent_text, updated_at = excluded.updated_at`,
      [branchId, version, intent, Date.now()],
    );
    return version;
  });
}

export async function clearPlayIntentDraft(db: SqliteDatabase, branchId: string, expectedStateVersion: number): Promise<void> {
  await db.execute('DELETE FROM play_intent_drafts WHERE branch_id = ? AND expected_state_version = ?', [branchId, expectedStateVersion]);
}

/** Approval is scoped to the exact attempt(s) shown to the player, never a global bypass. */
export async function acknowledgePlayReplay(
  ledger: LlmReplayApprovalPort, campaignId: string, branchId: string, expectedStateVersion: number, attemptIds: string[],
): Promise<void> {
  await ledger.acknowledgePlayReplay({ campaignId, branchId, expectedStateVersion, attemptIds });
}

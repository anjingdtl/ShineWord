import type { GuidanceStore } from '../../application/ports/guidanceStore';
import type { TurnGuidanceV1 } from '../../application/guidance/types';
import type { SqliteDatabase, SqliteRow } from '../../application/ports/sqlite';

interface GuidanceRow extends SqliteRow {
  branch_id: string;
  decision_point_id: string;
  source_turn_id: string;
  state_version: number;
  severity: string;
  guidance_json: string;
  created_at: string;
  updated_at: string;
}

function fromRow(row: GuidanceRow): TurnGuidanceV1 {
  const guidance = JSON.parse(row.guidance_json) as TurnGuidanceV1;
  if (guidance.guidanceVersion !== 'turn-guidance-1') {
    throw new Error(`Unknown guidance version: ${String(guidance.guidanceVersion)}.`);
  }
  if (guidance.decisionPoint.decisionPointId !== row.decision_point_id
    || guidance.decisionPoint.branchId !== row.branch_id
    || guidance.decisionPoint.stateVersion !== row.state_version) {
    throw new Error('Stored guidance binding does not match its row identity.');
  }
  return guidance;
}

export class SqliteGuidanceStore implements GuidanceStore {
  constructor(private readonly db: SqliteDatabase) {}

  async save(record: TurnGuidanceV1, now = new Date().toISOString()): Promise<void> {
    await this.db.execute(
      `INSERT INTO branch_decision_guidance
        (branch_id, decision_point_id, source_turn_id, state_version, severity, guidance_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(branch_id, decision_point_id) DO UPDATE SET
         severity = excluded.severity,
         guidance_json = excluded.guidance_json,
         updated_at = excluded.updated_at`,
      [
        record.decisionPoint.branchId,
        record.decisionPoint.decisionPointId,
        record.decisionPoint.sourceTurnId,
        record.decisionPoint.stateVersion,
        record.severity,
        JSON.stringify(record),
        now,
        now,
      ],
    );
  }

  async get(branchId: string, decisionPointId: string): Promise<TurnGuidanceV1 | null> {
    const row = await this.db.queryOne<GuidanceRow>(
      `SELECT branch_id, decision_point_id, source_turn_id, state_version, severity, guidance_json, created_at, updated_at
         FROM branch_decision_guidance
        WHERE branch_id = ? AND decision_point_id = ?`,
      [branchId, decisionPointId],
    );
    return row ? fromRow(row) : null;
  }

  async latestForVersion(branchId: string, stateVersion: number): Promise<TurnGuidanceV1 | null> {
    const row = await this.db.queryOne<GuidanceRow>(
      `SELECT branch_id, decision_point_id, source_turn_id, state_version, severity, guidance_json, created_at, updated_at
         FROM branch_decision_guidance
        WHERE branch_id = ? AND state_version <= ?
        ORDER BY state_version DESC LIMIT 1`,
      [branchId, stateVersion],
    );
    return row ? fromRow(row) : null;
  }

  async listAll(branchId: string): Promise<TurnGuidanceV1[]> {
    const rows = await this.db.queryAll<GuidanceRow>(
      `SELECT branch_id, decision_point_id, source_turn_id, state_version, severity, guidance_json, created_at, updated_at
         FROM branch_decision_guidance
        WHERE branch_id = ?
        ORDER BY state_version ASC`,
      [branchId],
    );
    return rows.map(fromRow);
  }
}

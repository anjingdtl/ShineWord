import type { GuidanceStore } from '../../application/ports/guidanceStore';
import type { TurnGuidanceV1 } from '../../application/guidance/types';
import { validateGuidanceRecord } from '../../application/guidance/types';
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

const listeners = new WeakMap<object, Set<(branchId: string) => void>>();

function fromRow(row: GuidanceRow): TurnGuidanceV1 {
  const guidance = JSON.parse(row.guidance_json) as TurnGuidanceV1;
  const errors = validateGuidanceRecord(guidance);
  if (errors.length > 0) throw new Error(`Stored guidance is malformed: ${errors.join(', ')}.`);
  if (guidance.guidanceVersion !== 'turn-guidance-1') {
    throw new Error(`Unknown guidance version: ${String(guidance.guidanceVersion)}.`);
  }
  if (guidance.decisionPoint.decisionPointId !== row.decision_point_id
    || guidance.decisionPoint.branchId !== row.branch_id
    || guidance.decisionPoint.stateVersion !== row.state_version
    || guidance.decisionPoint.sourceTurnId !== row.source_turn_id) {
    throw new Error('Stored guidance binding does not match its row identity.');
  }
  return guidance;
}

export class SqliteGuidanceStore implements GuidanceStore {
  constructor(private readonly db: SqliteDatabase) {}
  get dedupScope(): object { return this.db; }
  subscribe(listener: (branchId: string) => void): () => void {
    let scope = listeners.get(this.db);
    if (!scope) { scope = new Set(); listeners.set(this.db, scope); }
    scope.add(listener);
    return () => { scope!.delete(listener); };
  }
  private notify(branchId: string): void {
    for (const listener of listeners.get(this.db) ?? []) { try { listener(branchId); } catch { /* derived view */ } }
  }

  async save(record: TurnGuidanceV1, now = new Date().toISOString()): Promise<void> {
    await this.db.execute(
      `INSERT INTO branch_decision_guidance
        (branch_id, decision_point_id, source_turn_id, state_version, severity, guidance_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(branch_id, decision_point_id) DO UPDATE SET
         source_turn_id = excluded.source_turn_id,
         state_version = excluded.state_version,
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
    this.notify(record.decisionPoint.branchId);
  }

  async replaceIfCurrent(record: TurnGuidanceV1, expected: TurnGuidanceV1): Promise<boolean> {
    const binding = record.decisionPoint;
    const changes = await this.db.execute(
      `UPDATE branch_decision_guidance SET severity = ?, guidance_json = ?, updated_at = ?
        WHERE branch_id = ? AND decision_point_id = ? AND guidance_json = ?
          AND EXISTS (SELECT 1 FROM branches b JOIN snapshots s
            ON s.branch_id = b.branch_id AND s.state_version = b.state_version
            WHERE b.branch_id = ? AND b.state_version = ?
              AND COALESCE(json_extract(s.snapshot_json, '$.segmentContentBinding.artifactManifestHash'),
                json_extract(s.snapshot_json, '$.segmentContentBinding.manifestHash'),
                json_extract(s.snapshot_json, '$.contentManifest.manifestHash'), 'no-binding') = ?)`,
      [record.severity, JSON.stringify(record), new Date().toISOString(), binding.branchId,
        binding.decisionPointId, JSON.stringify(expected), binding.branchId, binding.stateVersion,
        binding.contentBindingHash],
    );
    if (changes > 0) this.notify(binding.branchId);
    return changes > 0;
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

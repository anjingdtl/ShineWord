import type {
  NarrativeRecord,
  NarrativeStore,
} from '../../application/ports/narrativeStore';
import type { SqliteDatabase, SqliteRow } from '../../application/ports/sqlite';
import type { RollGrade } from '../../domain/rules/types';

interface NarrativeRow extends SqliteRow {
  branch_id: string;
  turn_id: string;
  outcome_grade: string;
  text: string;
  status: string;
  created_at: string;
}

function fromRow(row: NarrativeRow): NarrativeRecord {
  if (row.status !== 'Candidate' && row.status !== 'Committed') {
    throw new Error(`Invalid narrative status: ${row.status}.`);
  }
  return {
    branchId: row.branch_id,
    turnId: row.turn_id,
    outcomeGrade: row.outcome_grade as RollGrade,
    text: row.text,
    status: row.status,
    createdAt: row.created_at,
  };
}

export class SqliteNarrativeStore implements NarrativeStore {
  constructor(private readonly db: SqliteDatabase) {}

  async get(branchId: string, turnId: string): Promise<NarrativeRecord | null> {
    const row = await this.db.queryOne<NarrativeRow>(
      `SELECT branch_id, turn_id, outcome_grade, text, status, created_at
         FROM turn_narratives
        WHERE branch_id = ? AND turn_id = ?`,
      [branchId, turnId],
    );
    return row ? fromRow(row) : null;
  }

  async saveCandidate(
    record: Omit<NarrativeRecord, 'status'>,
  ): Promise<NarrativeRecord> {
    return this.db.transaction(async tx => {
      const existing = await tx.queryOne<NarrativeRow>(
        `SELECT branch_id, turn_id, outcome_grade, text, status, created_at
           FROM turn_narratives
          WHERE branch_id = ? AND turn_id = ?`,
        [record.branchId, record.turnId],
      );
      if (existing) {
        const current = fromRow(existing);
        if (
          current.outcomeGrade !== record.outcomeGrade ||
          current.text !== record.text
        ) {
          throw new Error('Narrative candidate is immutable once persisted.');
        }
        return current;
      }
      await tx.execute(
        `INSERT INTO turn_narratives
          (branch_id, turn_id, outcome_grade, text, status, created_at)
         VALUES (?, ?, ?, ?, 'Candidate', ?)`,
        [
          record.branchId,
          record.turnId,
          record.outcomeGrade,
          record.text,
          record.createdAt,
        ],
      );
      return { ...record, status: 'Candidate' };
    });
  }

  async markCommitted(branchId: string, turnId: string): Promise<void> {
    await this.db.execute(
      `UPDATE turn_narratives
          SET status = 'Committed'
        WHERE branch_id = ? AND turn_id = ?`,
      [branchId, turnId],
    );
  }
}

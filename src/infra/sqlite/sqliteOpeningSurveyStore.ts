import type { SqliteDatabase, SqliteTransaction } from '../../application/ports/sqlite';
import { OPENING_SURVEY_VERSION, type OpeningSurveyRecordV1, type OpeningSurveyStoreV1, type OpeningSurveyV1 } from '../../application/segmentBuild/openingSurvey';
import { isSourceRangeV1 } from '../../domain/build/validation';

export const OPENING_SURVEY_SCHEMA_SQL = `CREATE TABLE world_opening_surveys (
 world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','completed','failed','outcome_unknown')),
 result_json TEXT, error_code TEXT, PRIMARY KEY(world_id,fingerprint));`;
export class SqliteOpeningSurveyStore implements OpeningSurveyStoreV1 {
  constructor(private readonly db: SqliteDatabase) {}
  async read(worldId: string, fingerprint: string): Promise<OpeningSurveyRecordV1 | null> {
    const row = await this.db.queryOne<{ status: string; result_json: string | null; error_code: string | null }>(
      'SELECT status,result_json,error_code FROM world_opening_surveys WHERE world_id=? AND fingerprint=?', [worldId,fingerprint]);
    if (!row) return null;
    if (row.status === 'running') return { status: 'outcome_unknown', result: null, errorCode: 'interrupted_survey' };
    if (row.status === 'failed' || row.status === 'outcome_unknown') return { status: row.status, result: null, errorCode: row.error_code };
    let raw: unknown;
    try { raw = JSON.parse(row.result_json ?? 'null'); } catch { throw new Error('corrupt_opening_survey'); }
    const value = raw as Partial<OpeningSurveyV1> | null;
    if (!value || value.version !== OPENING_SURVEY_VERSION || value.worldId !== worldId || value.fingerprint !== fingerprint
      || !isSourceRangeV1(value.sourceRange) || !Array.isArray(value.evidence) || value.evidence.length > 24
      || !value.evidence.every(e => e && isSourceRangeV1(e.range) && ['character','location','event','timeline','relationship'].includes(e.category)
        && typeof e.label === 'string' && e.label.length <= 160 && typeof e.quote === 'string' && Array.from(e.quote).length <= 160)
      || !Number.isSafeInteger(value.recommendedEndCp) || value.recommendedEndCp! > value.sourceRange.endCp
      || !Number.isFinite(value.estimatedInputTokens) || value.estimatedInputTokens! > value.inputTokenLimit!) throw new Error('corrupt_opening_survey');
    return { status: 'completed', result: value as OpeningSurveyV1, errorCode: null };
  }
  async claim(worldId: string, fingerprint: string, guard: (tx: SqliteTransaction) => Promise<void>): Promise<boolean> {
    return this.db.transaction(async tx => { await guard(tx);
      return (await tx.execute("INSERT OR IGNORE INTO world_opening_surveys(world_id,fingerprint,status) VALUES (?,?,'running')", [worldId,fingerprint])) === 1;
    });
  }
  async finish(worldId: string, fingerprint: string, value: OpeningSurveyRecordV1, guard: (tx: SqliteTransaction) => Promise<void>): Promise<void> {
    await this.db.transaction(async tx => { await guard(tx);
      if (await tx.execute("UPDATE world_opening_surveys SET status=?,result_json=?,error_code=? WHERE world_id=? AND fingerprint=? AND status='running'",
        [value.status, value.result ? JSON.stringify(value.result) : null, value.errorCode, worldId, fingerprint]) !== 1) throw new Error('stale_opening_survey');
    });
  }
}

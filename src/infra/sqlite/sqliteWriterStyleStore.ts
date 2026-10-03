import type { SqliteDatabase, SqliteRow, SqliteTransaction } from '../../application/ports/sqlite';
import type { ProjectStyleBindingRecord, SourceStyleAnalysisRecord, SourceStyleProfile, WriterStyleStore } from '../../application/writerStyle/ports';
import type { EffectiveStyleSnapshotV1, StyleSemanticV1 } from '../../domain/style/types';
import { validateStyleOverrides, validateStyleSemantic, validateStyleSnapshot, validateSourceStyleBaseline } from '../../domain/style/validation';
import { estimateTokens } from '../../application/context/tokenEstimate';

interface JsonRow extends SqliteRow { value: string }
interface AnalysisRow extends SqliteRow {
  project_id: string; cache_key: string; logical_request_id: string; status: string;
  error_code: string | null; updated_at: string;
}
function readBinding(value: string): ProjectStyleBindingRecord {
  const binding = JSON.parse(value) as ProjectStyleBindingRecord;
  validateStyleSemantic(binding.baseline); validateStyleSemantic(binding.semantic); validateStyleOverrides(binding.overrides);
  if (binding.sourceBaseline !== undefined) validateSourceStyleBaseline(binding.sourceBaseline);
  if (!Number.isSafeInteger(binding.revision) || binding.revision < 1
    || !['source', 'preset', 'custom'].includes(binding.mode)
    || !['pending', 'running', 'ready', 'failed', 'suggestion'].includes(binding.analysisStatus)
    || !Number.isSafeInteger(binding.userOverrideVersion) || binding.userOverrideVersion < 0
    || typeof binding.projectId !== 'string' || !binding.projectId
    || typeof binding.styleVersion !== 'string' || !binding.styleVersion) throw new Error('corrupt_style_binding');
  return binding;
}
function readProfile(value: string): SourceStyleProfile {
  const profile = JSON.parse(value) as SourceStyleProfile;
  validateStyleSemantic(profile.semantic);
  return profile;
}
function readSnapshot(value: string): EffectiveStyleSnapshotV1 {
  const snapshot: unknown = JSON.parse(value); validateStyleSnapshot(snapshot);
  if (snapshot.tokenEstimate !== estimateTokens(snapshot.compiledText)) throw new Error('corrupt_style_snapshot_estimate');
  return snapshot;
}

export class SqliteWriterStyleStore implements WriterStyleStore {
  constructor(private readonly db: SqliteDatabase) {}
  async putAsset(asset: { assetId: string; assetVersion: string; semantic: StyleSemanticV1 }): Promise<StyleSemanticV1> {
    validateStyleSemantic(asset.semantic);
    await this.db.execute('INSERT OR IGNORE INTO writer_style_assets (asset_id, asset_version, semantic_json) VALUES (?, ?, ?)',
      [asset.assetId, asset.assetVersion, JSON.stringify(asset.semantic)]);
    const row = await this.db.queryOne<JsonRow>('SELECT semantic_json AS value FROM writer_style_assets WHERE asset_id = ? AND asset_version = ?', [asset.assetId, asset.assetVersion]);
    if (!row) throw new Error('style_asset_not_persisted');
    const semantic: unknown = JSON.parse(row.value); validateStyleSemantic(semantic); return semantic;
  }
  async getBinding(projectId: string): Promise<ProjectStyleBindingRecord | null> {
    const row = await this.db.queryOne<JsonRow>('SELECT binding_json AS value FROM project_writer_style_bindings WHERE project_id = ?', [projectId]);
    return row ? readBinding(row.value) : null;
  }
  async initializeBinding(binding: ProjectStyleBindingRecord): Promise<ProjectStyleBindingRecord> {
    validateStyleSemantic(binding.baseline); validateStyleOverrides(binding.overrides);
    if (binding.sourceBaseline !== undefined) validateSourceStyleBaseline(binding.sourceBaseline);
    await this.db.execute('INSERT OR IGNORE INTO project_writer_style_bindings (project_id, style_version, revision, binding_json) VALUES (?, ?, ?, ?)',
      [binding.projectId, binding.styleVersion, binding.revision, JSON.stringify(binding)]);
    const stored = await this.getBinding(binding.projectId);
    if (!stored) throw new Error('style_project_deleted');
    return stored;
  }
  async initializeImportedBinding(tx: SqliteTransaction, binding: ProjectStyleBindingRecord): Promise<ProjectStyleBindingRecord> {
    validateStyleSemantic(binding.baseline); validateStyleSemantic(binding.semantic); validateStyleOverrides(binding.overrides);
    if (binding.sourceBaseline !== undefined) validateSourceStyleBaseline(binding.sourceBaseline);
    await tx.execute('INSERT OR IGNORE INTO project_writer_style_bindings (project_id, style_version, revision, binding_json) VALUES (?, ?, ?, ?)',
      [binding.projectId, binding.styleVersion, binding.revision, JSON.stringify(binding)]);
    const row = await tx.queryOne<JsonRow>('SELECT binding_json AS value FROM project_writer_style_bindings WHERE project_id = ?', [binding.projectId]);
    if (!row) throw new Error('style_project_deleted');
    return readBinding(row.value);
  }
  async compareAndSetBinding(binding: ProjectStyleBindingRecord, expectedVersion: string): Promise<boolean> {
    validateStyleSemantic(binding.baseline); validateStyleSemantic(binding.semantic); validateStyleOverrides(binding.overrides);
    if (binding.sourceBaseline !== undefined) validateSourceStyleBaseline(binding.sourceBaseline);
    return (await this.db.execute('UPDATE project_writer_style_bindings SET style_version = ?, revision = ?, binding_json = ? WHERE project_id = ? AND style_version = ? AND revision = ?',
      [binding.styleVersion, binding.revision, JSON.stringify(binding), binding.projectId, expectedVersion, binding.revision - 1])) === 1;
  }
  async getProfile(projectId: string, cacheKey: string): Promise<SourceStyleProfile | null> {
    const row = await this.db.queryOne<JsonRow>('SELECT profile_json AS value FROM source_style_profiles WHERE project_id = ? AND cache_key = ? AND status = ? AND profile_json IS NOT NULL', [projectId, cacheKey, 'ready']);
    return row ? readProfile(row.value) : null;
  }
  async listProfiles(projectId: string): Promise<SourceStyleProfile[]> {
    const rows = await this.db.queryAll<JsonRow>('SELECT profile_json AS value FROM source_style_profiles WHERE project_id = ? AND status = ? AND profile_json IS NOT NULL ORDER BY updated_at, cache_key', [projectId, 'ready']);
    return rows.map(row => readProfile(row.value));
  }
  async listInterruptedAnalyses(): Promise<SourceStyleAnalysisRecord[]> {
    const rows = await this.db.queryAll<{ project_id: string; cache_key: string }>("SELECT project_id, cache_key FROM source_style_profiles WHERE status = 'running'");
    const records: SourceStyleAnalysisRecord[] = [];
    for (const row of rows) { const record = await this.getAnalysis(row.project_id, row.cache_key); if (record) records.push(record); }
    return records;
  }
  async getAnalysis(projectId: string, cacheKey: string): Promise<SourceStyleAnalysisRecord | null> {
    const row = await this.db.queryOne<AnalysisRow>('SELECT project_id, cache_key, logical_request_id, status, error_code, updated_at FROM source_style_profiles WHERE project_id = ? AND cache_key = ?', [projectId, cacheKey]);
    if (!row) return null;
    return { projectId: row.project_id, cacheKey: row.cache_key, logicalRequestId: row.logical_request_id,
      status: row.status as SourceStyleAnalysisRecord['status'], errorCode: row.error_code, updatedAt: row.updated_at };
  }
  async claimAnalysis(record: SourceStyleAnalysisRecord): Promise<boolean> {
    return (await this.db.execute(`INSERT OR IGNORE INTO source_style_profiles
      (project_id, cache_key, logical_request_id, status, error_code, updated_at, profile_json) VALUES (?, ?, ?, 'running', NULL, ?, NULL)`,
      [record.projectId, record.cacheKey, record.logicalRequestId, record.updatedAt])) === 1;
  }
  async retryFailedAnalysis(record: SourceStyleAnalysisRecord): Promise<boolean> {
    return (await this.db.execute(`UPDATE source_style_profiles SET status = 'running', error_code = NULL, updated_at = ?
      WHERE project_id = ? AND cache_key = ? AND status = 'failed' AND logical_request_id = ?`,
      [record.updatedAt, record.projectId, record.cacheKey, record.logicalRequestId])) === 1;
  }
  async finishAnalysis(record: SourceStyleAnalysisRecord, profile?: SourceStyleProfile): Promise<void> {
    if (profile) validateStyleSemantic(profile.semantic);
    const changed = await this.db.execute(`UPDATE source_style_profiles SET status = ?, error_code = ?, updated_at = ?, profile_json = ?
      WHERE project_id = ? AND cache_key = ? AND status = 'running' AND logical_request_id = ?`,
      [record.status, record.errorCode, record.updatedAt, profile ? JSON.stringify(profile) : null, record.projectId, record.cacheKey, record.logicalRequestId]);
    if (!changed) throw new Error('style_analysis_superseded_or_deleted');
  }
  async getSnapshot(projectId: string, branchId: string, turnId: string): Promise<EffectiveStyleSnapshotV1 | null> {
    const row = await this.db.queryOne<JsonRow>('SELECT snapshot_json AS value FROM writer_style_snapshots WHERE project_id = ? AND branch_id = ? AND turn_id = ?', [projectId, branchId, turnId]);
    return row ? readSnapshot(row.value) : null;
  }
  async putSnapshot(snapshot: EffectiveStyleSnapshotV1): Promise<EffectiveStyleSnapshotV1> {
    validateStyleSnapshot(snapshot);
    await this.db.transaction(async tx => {
      const branch = await tx.queryOne<{ world_id: string }>(`SELECT c.world_id FROM branches b JOIN campaigns c ON c.campaign_id = b.campaign_id WHERE b.branch_id = ?`, [snapshot.branchId]);
      if (!branch || branch.world_id !== snapshot.projectId) throw new Error('style_snapshot_branch_scope_mismatch');
      await tx.execute(`INSERT OR IGNORE INTO writer_style_snapshots (snapshot_id, project_id, branch_id, turn_id, compiled_hash, snapshot_json) VALUES (?, ?, ?, ?, ?, ?)`,
        [snapshot.snapshotId, snapshot.projectId, snapshot.branchId, snapshot.turnId, snapshot.compiledHash, JSON.stringify(snapshot)]);
    });
    const stored = await this.getSnapshot(snapshot.projectId, snapshot.branchId, snapshot.turnId);
    if (!stored) throw new Error('style_snapshot_not_persisted');
    return stored;
  }
  async listSnapshots(projectId: string, branchId?: string): Promise<EffectiveStyleSnapshotV1[]> {
    const rows = await this.db.queryAll<JsonRow>(`SELECT snapshot_json AS value FROM writer_style_snapshots WHERE project_id = ?${branchId ? ' AND branch_id = ?' : ''} ORDER BY branch_id, turn_id`, branchId ? [projectId, branchId] : [projectId]);
    return rows.map(row => readSnapshot(row.value));
  }
}

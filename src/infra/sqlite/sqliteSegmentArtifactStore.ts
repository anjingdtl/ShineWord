import type { PublishedArtifactV1, SourceSetBindingV1 } from '../../domain/build/phase6';
import type { SegmentArtifactManifestV1, SegmentArtifactV1 } from '../../domain/content/segmentArtifact';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import type { SqliteDatabase, SqliteRow, SqliteTransaction } from '../../application/ports/sqlite';
import { parseSegmentArtifact, serializeSegmentArtifact, verifySegmentArtifactManifest } from '../../application/segmentPublication/protocol';

/** Registered exactly once by M0; this owner never installs migrations. */
export const phase6ArtifactSchema = `
CREATE TABLE IF NOT EXISTS world_segment_artifacts (
 artifact_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, segment_id TEXT NOT NULL,
 generation INTEGER NOT NULL CHECK(generation > 0), content_hash TEXT NOT NULL,
 artifact_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_segment_artifact_world ON world_segment_artifacts(world_id, segment_id, generation);
CREATE TABLE IF NOT EXISTS branch_segment_artifact_manifests (
 branch_id TEXT NOT NULL, state_version INTEGER NOT NULL CHECK(state_version >= 0),
 artifact_version INTEGER NOT NULL CHECK(artifact_version >= 0), artifact_manifest_hash TEXT NOT NULL,
 manifest_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(branch_id,state_version,artifact_manifest_hash),
 FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_branch_segment_artifact_manifest ON branch_segment_artifact_manifests(branch_id,state_version DESC,artifact_version DESC);
CREATE TABLE IF NOT EXISTS segment_publication_diagnostics (
 diagnostic_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, segment_id TEXT NOT NULL,
 generation INTEGER NOT NULL, error_codes_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);
`;
export class SqliteSegmentArtifactStore {
  constructor(readonly db:SqliteDatabase, readonly sha256Hex:Sha256HexProvider['sha256Hex']){}
  async getArtifact(artifactId:string,tx:Pick<SqliteTransaction,'queryOne'>=this.db):Promise<SegmentArtifactV1|null> {
    const row=await tx.queryOne<SqliteRow>('SELECT artifact_id, world_id, content_hash, artifact_json FROM world_segment_artifacts WHERE artifact_id = ?',[artifactId]);
    if(!row)return null;
    const artifact=await parseSegmentArtifact(String(row.artifact_json),this.sha256Hex);
    if(artifact.artifactId!==row.artifact_id||artifact.worldId!==row.world_id||artifact.contentHash!==row.content_hash)throw new Error('artifact_row_binding_mismatch');
    return artifact;
  }
  async listArtifacts(worldId:string):Promise<SegmentArtifactV1[]> {
    const rows=await this.db.queryAll<{artifact_id:string}>('SELECT artifact_id FROM world_segment_artifacts WHERE world_id = ? ORDER BY segment_id, generation, artifact_id',[worldId]);
    const result:SegmentArtifactV1[]=[];
    for(const row of rows){const a=await this.getArtifact(row.artifact_id);if(a)result.push(a);}return result;
  }
  async listPublishedArtifacts(worldId:string):Promise<PublishedArtifactV1[]> {
    return (await this.listArtifacts(worldId)).map(a=>({artifactId:a.artifactId,worldId:a.worldId,segmentId:a.segmentId,generation:a.generation,
      sourceBinding:a.sourceBinding,coverage:a.coverage,canonSnapshotHash:a.canonSnapshotHash,contentHash:a.contentHash,validationVersion:a.validationVersion}));
  }
  async insertArtifact(tx:SqliteTransaction,artifact:SegmentArtifactV1):Promise<void> {
    const previous=await this.getArtifact(artifact.artifactId,tx);
    if(previous){if(serializeSegmentArtifact({...previous,createdAt:artifact.createdAt})!==serializeSegmentArtifact(artifact))throw new Error('immutable_artifact_collision');return;}
    await tx.execute(`INSERT INTO world_segment_artifacts (artifact_id,world_id,segment_id,generation,content_hash,artifact_json,created_at) VALUES (?,?,?,?,?,?,?)`,
      [artifact.artifactId,artifact.worldId,artifact.segmentId,artifact.generation,artifact.contentHash,serializeSegmentArtifact(artifact),artifact.createdAt]);
  }
  /** Archive restore has already performed full hashes/closure validation;
   * world existence is still fenced by FK, and rows are never replaced. */
  async restoreArtifacts(artifacts:readonly SegmentArtifactV1[]):Promise<void> {
    for(const a of artifacts)await parseSegmentArtifact(serializeSegmentArtifact(a),this.sha256Hex);
    await this.db.transaction(async tx=>{for(const a of artifacts)await this.insertArtifact(tx,a);});
  }
  async getManifest(branchId:string,artifactManifestHash:string,tx:Pick<SqliteTransaction,'queryOne'>=this.db):Promise<SegmentArtifactManifestV1|null> {
    const row=await tx.queryOne<SqliteRow>('SELECT state_version, artifact_manifest_hash, manifest_json FROM branch_segment_artifact_manifests WHERE branch_id = ? AND artifact_manifest_hash = ? ORDER BY state_version DESC LIMIT 1',[branchId,artifactManifestHash]);
    if(!row)return null;const value:unknown=JSON.parse(String(row.manifest_json));
    if(!await verifySegmentArtifactManifest(value,this.sha256Hex))throw new Error('invalid_artifact_manifest');
    const manifest=value as SegmentArtifactManifestV1;
    if(manifest.branchId!==branchId||manifest.artifactManifestHash!==row.artifact_manifest_hash||manifest.stateVersion!==Number(row.state_version))throw new Error('artifact_manifest_row_mismatch');
    return manifest;
  }
  async insertManifest(tx:SqliteTransaction,manifest:SegmentArtifactManifestV1,now:string):Promise<void> {
    if(!await verifySegmentArtifactManifest(manifest,this.sha256Hex))throw new Error('invalid_artifact_manifest');
    await tx.execute(`INSERT OR IGNORE INTO branch_segment_artifact_manifests (branch_id,state_version,artifact_version,artifact_manifest_hash,manifest_json,created_at) VALUES (?,?,?,?,?,?)`,
      [manifest.branchId,manifest.stateVersion,manifest.artifacts.length,manifest.artifactManifestHash,JSON.stringify(manifest),now]);
  }
  async recordDiagnostic(input:{worldId:string;segmentId:string;generation:number;errors:readonly string[];createdAt:string}):Promise<void> {
    const diagnosticId=`${input.worldId}:${input.segmentId}:${input.generation}:${(await this.sha256Hex(JSON.stringify(input.errors))).slice(0,24)}`;
    // INSERT SELECT prevents a late rejected publication from resurrecting a deleted world.
    await this.db.execute(`INSERT OR IGNORE INTO segment_publication_diagnostics (diagnostic_id,world_id,segment_id,generation,error_codes_json,created_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM worlds WHERE world_id = ?)`,
      [diagnosticId,input.worldId,input.segmentId,input.generation,JSON.stringify(input.errors),input.createdAt,input.worldId]);
  }
  async assertSourceBindingCurrent(tx:SqliteTransaction,worldId:string,binding:SourceSetBindingV1):Promise<void> {
    for(const member of binding.members){const row=await tx.queryOne<SqliteRow>(`SELECT s.normalized_tree_hash,s.status,ws.source_ordinal FROM world_sources ws
      JOIN imported_sources s ON s.source_id = ws.source_id WHERE ws.world_id = ? AND ws.source_id = ?`,[worldId,member.sourceId]);
      if(!row||row.status!=='active'||row.normalized_tree_hash!==member.normalizedTreeHash||Number(row.source_ordinal)!==member.sourceOrdinal)throw new Error('source_changed');}
  }
}

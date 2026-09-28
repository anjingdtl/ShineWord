import type { BranchContentManifest } from '../../domain/content/types';
import type { SqliteDatabase, SqliteRow, SqliteTransaction } from '../ports/sqlite';
import { createBaseContentManifest } from './contentManifest';
import { isBranchContentManifestStructure } from './contentManifest';

type ContentDb = Pick<SqliteDatabase, 'queryOne' | 'queryAll' | 'execute' | 'transaction'>;
type ContentTx = Pick<SqliteTransaction, 'queryOne' | 'queryAll' | 'execute'>;

export async function hasBranchContentManifestTable(db: Pick<SqliteDatabase, 'queryOne'>): Promise<boolean> {
  const row = await db.queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'branch_content_manifests'`,
  );
  return (row?.n ?? 0) === 1;
}

/** Latest immutable content generation active at or before a branch snapshot. */
export async function readBranchContentManifest(
  db: Pick<SqliteDatabase, 'queryOne'> | Pick<SqliteTransaction, 'queryOne'>,
  branchId: string,
  stateVersion: number,
): Promise<BranchContentManifest | null> {
  const row = await db.queryOne<SqliteRow>(
    `SELECT state_version, content_version, manifest_hash, manifest_json
       FROM branch_content_manifests
      WHERE branch_id = ? AND state_version <= ?
      ORDER BY state_version DESC, content_version DESC LIMIT 1`,
    [branchId, stateVersion],
  );
  if (!row) return null;
  let manifest: BranchContentManifest;
  try { manifest = JSON.parse(String(row.manifest_json)) as BranchContentManifest; }
  catch { throw new Error(`Branch content manifest for ${branchId} is malformed.`); }
  if (!isBranchContentManifestStructure(manifest) || manifest.branchId !== branchId ||
      manifest.stateVersion !== Number(row.state_version) || manifest.contentVersion !== Number(row.content_version) ||
      manifest.manifestHash.toLowerCase() !== String(row.manifest_hash).toLowerCase()) {
    throw new Error(`Branch content manifest binding is inconsistent for ${branchId}.`);
  }
  return manifest;
}

export async function insertBranchContentManifest(
  tx: ContentTx,
  manifest: BranchContentManifest,
  createdAt: string,
): Promise<void> {
  await tx.execute(
    `INSERT INTO branch_content_manifests
      (branch_id, state_version, content_version, manifest_hash, manifest_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [manifest.branchId, manifest.stateVersion, manifest.contentVersion, manifest.manifestHash,
      JSON.stringify(manifest), createdAt],
  );
}

/** Lazy baseline for campaigns created before migration 15. It never edits an
 * existing snapshot or package; the next committed snapshot records it. */
export async function ensureBaseBranchContentManifest(input: {
  db: ContentDb;
  branchId: string;
  worldId: string;
  stateVersion: number;
  packageRevision: number;
  packageContentHash: string;
  createdAt: string;
}): Promise<BranchContentManifest> {
  if (!await hasBranchContentManifestTable(input.db)) {
    throw new Error('Progressive content storage migration is not installed.');
  }
  return input.db.transaction(async tx => {
    const current = await readBranchContentManifest(tx, input.branchId, input.stateVersion);
    if (current) return current;
    const binding = await tx.queryOne<SqliteRow>(
      `SELECT b.state_version, c.world_id, c.package_revision
         FROM branches b JOIN campaigns c ON c.campaign_id = b.campaign_id
        WHERE b.branch_id = ?`, [input.branchId],
    );
    if (!binding || Number(binding.state_version) !== input.stateVersion ||
        String(binding.world_id) !== input.worldId || Number(binding.package_revision) !== input.packageRevision) {
      throw new Error('Campaign package or branch state changed while the base content manifest was being initialized.');
    }
    const manifest = createBaseContentManifest({
      worldId: input.worldId,
      branchId: input.branchId,
      stateVersion: input.stateVersion,
      basePackage: { revision: input.packageRevision, contentHash: input.packageContentHash },
    });
    await insertBranchContentManifest(tx, manifest, input.createdAt);
    return manifest;
  });
}

export function rebindBranchContentManifest(
  manifest: BranchContentManifest,
  branchId: string,
  stateVersion = manifest.stateVersion,
  worldId = manifest.worldId,
): BranchContentManifest {
  return { ...manifest, branchId, stateVersion, worldId, basePackage: { ...manifest.basePackage },
    deltas: manifest.deltas.map(ref => ({ ...ref })) };
}

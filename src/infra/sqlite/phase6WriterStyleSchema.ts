/** Registered only by M0's single migration sequence. All project rows cascade on world deletion. */
export const PHASE6_WRITER_STYLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS writer_style_assets (
  asset_id TEXT NOT NULL,
  asset_version TEXT NOT NULL,
  semantic_json TEXT NOT NULL,
  PRIMARY KEY (asset_id, asset_version)
);
CREATE TABLE IF NOT EXISTS project_writer_style_bindings (
  project_id TEXT PRIMARY KEY REFERENCES worlds(world_id) ON DELETE CASCADE,
  style_version TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  binding_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_style_profiles (
  project_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  logical_request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'ready', 'failed')),
  error_code TEXT,
  updated_at TEXT NOT NULL,
  profile_json TEXT,
  PRIMARY KEY (project_id, cache_key)
);
CREATE TABLE IF NOT EXISTS writer_style_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  compiled_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  UNIQUE (project_id, branch_id, turn_id)
);
CREATE INDEX IF NOT EXISTS idx_writer_style_snapshots_branch ON writer_style_snapshots(project_id, branch_id);
`;

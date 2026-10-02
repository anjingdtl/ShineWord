/** Registered once by M0; segment status is a read projection, never a second run/lease ledger. */
export const PHASE6_SEGMENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS world_segment_plans (
  plan_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL UNIQUE REFERENCES worlds(world_id) ON DELETE CASCADE,
  plan_version TEXT NOT NULL CHECK(plan_version = 'segment-plan-1'),
  source_binding_json TEXT NOT NULL,
  execution_config_fingerprint TEXT NOT NULL,
  pause_reason TEXT CHECK(pause_reason IN ('user','system','budget','network','unlock')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS world_segments (
  segment_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES world_segment_plans(world_id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK(generation > 0),
  work_fingerprint TEXT NOT NULL,
  intent_json TEXT NOT NULL,
  run_ids_json TEXT NOT NULL,
  artifact_ids_json TEXT NOT NULL,
  published_coverage_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('planned','extracting','mapping','validating','ready','needs_review','paused','failed_retryable','failed_terminal','canceled','stale')),
  last_error_code TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(world_id, work_fingerprint)
);
CREATE INDEX IF NOT EXISTS world_segments_by_world ON world_segments(world_id, status);
CREATE TABLE IF NOT EXISTS segment_demands (
  demand_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES world_segment_plans(world_id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL REFERENCES world_segments(segment_id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  ref_json TEXT,
  reason TEXT NOT NULL CHECK(reason IN ('bootstrap','action_dependency','near_domain','buffer','user_full')),
  priority TEXT NOT NULL CHECK(priority IN ('P0','P1','P2','P3')),
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS segment_demands_by_world ON segment_demands(world_id, active);
`;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  title TEXT NOT NULL,
  ruleset_id TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  world_mapping_version TEXT NOT NULL,
  opening_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS actor_skills (
  branch_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  rank TEXT NOT NULL CHECK(rank IN ('untrained', 'novice', 'trained', 'expert', 'master')),
  practice_points INTEGER NOT NULL DEFAULT 0,
  awarded_turns_json TEXT NOT NULL DEFAULT '[]',
  state_version INTEGER NOT NULL,
  PRIMARY KEY(branch_id, actor_id, skill_id),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relationships (
  branch_id TEXT NOT NULL,
  rel_id TEXT NOT NULL,
  from_actor_id TEXT NOT NULL,
  to_actor_id TEXT NOT NULL,
  stance TEXT NOT NULL,
  closeness INTEGER NOT NULL DEFAULT 0,
  updated_turn_id TEXT,
  state_version INTEGER NOT NULL,
  PRIMARY KEY(branch_id, rel_id),
  UNIQUE(branch_id, from_actor_id, to_actor_id),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS encounters (
  branch_id TEXT NOT NULL,
  encounter_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'resolved', 'escaped', 'wiped')),
  scene_id TEXT NOT NULL,
  distance_bands_json TEXT NOT NULL DEFAULT '{}',
  initiative_json TEXT NOT NULL DEFAULT '[]',
  turn_cursor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY(branch_id, encounter_id),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS encounter_actors (
  branch_id TEXT NOT NULL,
  encounter_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  side TEXT NOT NULL,
  hp INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  stamina INTEGER NOT NULL,
  conditions_json TEXT NOT NULL DEFAULT '[]',
  distance_band TEXT NOT NULL DEFAULT 'mid' CHECK(distance_band IN ('near', 'mid', 'far')),
  acted_this_round INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(branch_id, encounter_id, actor_id),
  FOREIGN KEY(branch_id, encounter_id) REFERENCES encounters(branch_id, encounter_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memories (
  branch_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('turn_range_summary', 'scene_summary', 'snapshot_note')),
  summary TEXT NOT NULL,
  from_state_version INTEGER NOT NULL,
  to_state_version INTEGER NOT NULL,
  invalid_at INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, memory_id),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS llm_requests (
  branch_id TEXT,
  turn_id TEXT,
  role TEXT NOT NULL,
  request_seq INTEGER NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, turn_id, role, request_seq)
);

CREATE INDEX IF NOT EXISTS idx_actor_skills_actor ON actor_skills(branch_id, actor_id, rank);
CREATE INDEX IF NOT EXISTS idx_memories_branch ON memories(branch_id, to_state_version);
CREATE INDEX IF NOT EXISTS idx_encounters_status ON encounters(branch_id, status);

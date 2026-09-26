PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS branches (
  branch_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  parent_branch_id TEXT,
  fork_turn_id TEXT,
  state_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(parent_branch_id) REFERENCES branches(branch_id)
);

CREATE TABLE IF NOT EXISTS actor_states (
  branch_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  location_id TEXT NOT NULL,
  resources_json TEXT NOT NULL,
  conditions_json TEXT NOT NULL,
  PRIMARY KEY(branch_id, actor_id),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory (
  branch_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  owner_actor_id TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  PRIMARY KEY(branch_id, item_id),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS turns (
  branch_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  status TEXT NOT NULL,
  expected_state_version INTEGER NOT NULL,
  committed_state_version INTEGER,
  action_contract_json TEXT NOT NULL,
  action_contract_hash TEXT NOT NULL,
  outcome_grade TEXT,
  public_summary TEXT,
  effects_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  committed_at TEXT,
  PRIMARY KEY(branch_id, turn_id),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS roll_records (
  branch_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  roll_index INTEGER NOT NULL,
  ruleset_id TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  contract_hash TEXT NOT NULL,
  dice_count INTEGER NOT NULL,
  die_sides INTEGER NOT NULL,
  rolls_json TEXT NOT NULL,
  highest INTEGER NOT NULL,
  difficulty INTEGER NOT NULL,
  margin INTEGER NOT NULL,
  grade TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, turn_id, roll_index),
  FOREIGN KEY(branch_id, turn_id) REFERENCES turns(branch_id, turn_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS branch_events (
  branch_id TEXT NOT NULL,
  event_seq INTEGER NOT NULL,
  turn_id TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, event_seq),
  FOREIGN KEY(branch_id, turn_id) REFERENCES turns(branch_id, turn_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshots (
  branch_id TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  state_hash TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, state_version),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_committed_state
  ON turns(branch_id, committed_state_version)
  WHERE committed_state_version IS NOT NULL;

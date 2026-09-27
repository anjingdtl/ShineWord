PRAGMA foreign_keys = ON;

-- Phase 2 (P2-0): divergence from the shared story must never rewrite
-- canon_events. Each branch records its own overlay - the shared canon stays
-- immutable so two campaigns of the same novel cannot pollute each other.
CREATE TABLE IF NOT EXISTS branch_canon_overrides (
  world_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'invalidated', 'confirmed')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, branch_id, event_id),
  FOREIGN KEY(world_id, event_id) REFERENCES canon_events(world_id, event_id) ON DELETE CASCADE
);

-- P2-0: durable per-encounter practice dedup. One practice point per
-- (branch, encounter, actor, skill, kind) - replayed turns find their own
-- ledger row and are refused.
CREATE TABLE IF NOT EXISTS reward_ledger (
  branch_id TEXT NOT NULL,
  encounter_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  reward_kind TEXT NOT NULL CHECK(reward_kind IN ('practice', 'milestone')),
  granted_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, encounter_id, actor_id, skill_id, reward_kind)
);

-- P2-1: world package revisions. A published revision is immutable - the
-- three books are views over package_entries of the same revision.
CREATE TABLE IF NOT EXISTS world_packages (
  world_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  schema_version TEXT NOT NULL DEFAULT 'world-package-2',
  source_sha256 TEXT NOT NULL,
  ruleset_id TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  mapping_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft', 'validating', 'needs_review', 'published', 'retired')),
  content_hash TEXT NOT NULL,
  validation_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, revision),
  FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS package_entries (
  world_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  entry_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('skill', 'ability', 'item', 'condition', 'actor_template', 'origin', 'path', 'scene', 'quest', 'lore', 'constraint')),
  definition_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  field_provenance_json TEXT NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'gm', 'discoverable')),
  dependency_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, revision, entry_id),
  FOREIGN KEY(world_id, revision) REFERENCES world_packages(world_id, revision) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS book_sections (
  world_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  book TEXT NOT NULL CHECK(book IN ('player_handbook', 'gm_guide', 'monster_manual')),
  section_key TEXT NOT NULL,
  title TEXT NOT NULL,
  entry_ids_json TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(world_id, revision, book, section_key),
  FOREIGN KEY(world_id, revision) REFERENCES world_packages(world_id, revision) ON DELETE CASCADE
);

-- P2-2: campaigns lock their dependency set at creation time.
ALTER TABLE campaigns ADD COLUMN package_revision INTEGER;
ALTER TABLE campaigns ADD COLUMN anchor_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE campaigns ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- P2-2: player / companion / GM-controlled membership per branch.
CREATE TABLE IF NOT EXISTS party_members (
  branch_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  controller TEXT NOT NULL CHECK(controller IN ('player', 'companion', 'gm')),
  role TEXT NOT NULL DEFAULT 'companion',
  joined_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, actor_id)
);

-- P2-2: character cards (attributes, skills, abilities, derived values).
-- The authoritative numeric projections remain actor_skills / actor_states -
-- the card carries identity and rule parameters.
CREATE TABLE IF NOT EXISTS actor_cards (
  branch_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  card_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_state_version INTEGER NOT NULL,
  PRIMARY KEY(branch_id, actor_id)
);

-- P2-3: quest progress is branch-scoped and advances only through committed
-- rule events, never because a narrator claims success.
CREATE TABLE IF NOT EXISTS quest_states (
  branch_id TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('available', 'active', 'succeeded', 'failed', 'abandoned')),
  counters_json TEXT NOT NULL DEFAULT '{}',
  updated_state_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, quest_id)
);

-- P2-3: transactional outbox for derived work (summaries, index refresh).
CREATE TABLE IF NOT EXISTS outbox (
  branch_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY(branch_id, task_id)
);

-- P2-4: conflicts and review items surfaced by world building. Blocking
-- issues stop publication until resolved or explicitly waived.
CREATE TABLE IF NOT EXISTS review_issues (
  world_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'blocking' CHECK(severity IN ('blocking', 'major', 'minor')),
  detail_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'waived')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY(world_id, issue_id)
);

CREATE INDEX IF NOT EXISTS idx_overrides_branch ON branch_canon_overrides(branch_id, world_id);
CREATE INDEX IF NOT EXISTS idx_ledger_actor ON reward_ledger(branch_id, actor_id, skill_id);
CREATE INDEX IF NOT EXISTS idx_entries_kind ON package_entries(world_id, revision, kind);
CREATE INDEX IF NOT EXISTS idx_packages_status ON world_packages(world_id, status);
CREATE INDEX IF NOT EXISTS idx_party_branch ON party_members(branch_id, controller);
CREATE INDEX IF NOT EXISTS idx_quests_branch ON quest_states(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_review_open ON review_issues(world_id, status, severity);

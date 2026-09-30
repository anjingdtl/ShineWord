import type { SqliteMigration } from './migrations';

export const CORE_SCHEMA_SQL = `PRAGMA foreign_keys = ON;

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
`;
export const NARRATIVES_SCHEMA_SQL = `PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS turn_narratives (
  branch_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  outcome_grade TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('Candidate', 'Committed')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, turn_id),
  FOREIGN KEY(branch_id, turn_id) REFERENCES turns(branch_id, turn_id) ON DELETE CASCADE
);
`;

export const WORLD_SCHEMA_SQL = `PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS worlds (
  world_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_bytes INTEGER NOT NULL,
  normalize_version TEXT NOT NULL,
  chapter_split_version TEXT NOT NULL,
  build_status TEXT NOT NULL CHECK(build_status IN ('importing', 'extracting', 'merging', 'mapping', 'ready', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_chapters (
  world_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  chapter_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  char_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, chapter_id),
  UNIQUE(world_id, chapter_index),
  FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_chunks (
  world_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  char_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(extraction_status IN ('pending', 'extracted', 'failed')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, chunk_id),
  UNIQUE(world_id, chapter_id, chunk_index),
  FOREIGN KEY(world_id, chapter_id) REFERENCES source_chapters(world_id, chapter_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entities (
  world_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('character', 'faction', 'location', 'item', 'ability', 'rule', 'event')),
  name TEXT NOT NULL,
  first_seen_chapter_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, entity_id),
  FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entity_aliases (
  world_id TEXT NOT NULL,
  alias_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  score REAL NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, alias_id),
  UNIQUE(world_id, entity_id, alias),
  FOREIGN KEY(world_id, entity_id) REFERENCES entities(world_id, entity_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS canon_facts (
  world_id TEXT NOT NULL,
  fact_id TEXT NOT NULL,
  subject_entity_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  value_json TEXT NOT NULL,
  value_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('explicit', 'inference', 'speculation', 'conflict', 'user_supplement')),
  confidence REAL NOT NULL DEFAULT 1.0,
  valid_from TEXT,
  valid_to TEXT,
  reveal_at TEXT,
  scope TEXT NOT NULL DEFAULT 'world',
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, fact_id),
  FOREIGN KEY(world_id, subject_entity_id) REFERENCES entities(world_id, entity_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fact_sources (
  world_id TEXT NOT NULL,
  fact_id TEXT NOT NULL,
  source_index INTEGER NOT NULL,
  chapter_id TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  quote TEXT NOT NULL,
  quote_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, fact_id, source_index),
  FOREIGN KEY(world_id, fact_id) REFERENCES canon_facts(world_id, fact_id) ON DELETE CASCADE,
  FOREIGN KEY(world_id, chapter_id) REFERENCES source_chapters(world_id, chapter_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS canon_events (
  world_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  world_time_order INTEGER,
  narrative_chapter_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  status TEXT NOT NULL DEFAULT 'canon' CHECK(status IN ('canon', 'pending', 'invalidated')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, event_id),
  FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_dependencies (
  world_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  depends_on_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, event_id, depends_on_event_id),
  FOREIGN KEY(world_id, event_id) REFERENCES canon_events(world_id, event_id) ON DELETE CASCADE,
  FOREIGN KEY(world_id, depends_on_event_id) REFERENCES canon_events(world_id, event_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS divergence_markers (
  world_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  marker_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, branch_id, marker_id),
  FOREIGN KEY(world_id, event_id) REFERENCES canon_events(world_id, event_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_rule_mappings (
  world_id TEXT NOT NULL,
  mapping_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  mapping_kind TEXT NOT NULL CHECK(mapping_kind IN ('attribute', 'skill', 'power_tier', 'resource')),
  mapping_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  ruleset_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'retired')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, mapping_id),
  FOREIGN KEY(world_id, target_entity_id) REFERENCES entities(world_id, entity_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_records (
  world_id TEXT NOT NULL,
  knowledge_id TEXT NOT NULL,
  branch_id TEXT,
  actor_id TEXT NOT NULL,
  fact_id TEXT,
  event_id TEXT,
  known_via TEXT NOT NULL CHECK(known_via IN ('witnessed', 'told', 'public', 'inferred')),
  known_at TEXT,
  source_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, knowledge_id),
  FOREIGN KEY(world_id, fact_id) REFERENCES canon_facts(world_id, fact_id) ON DELETE CASCADE,
  FOREIGN KEY(world_id, event_id) REFERENCES canon_events(world_id, event_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_jobs (
  world_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('import', 'extract_chunk', 'merge_entities', 'timeline', 'rule_mapping')),
  target_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT,
  extractor_version TEXT,
  model_fingerprint TEXT,
  usage_json TEXT,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(world_id, job_id),
  FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_world_status ON source_chunks(world_id, extraction_status);
CREATE INDEX IF NOT EXISTS idx_facts_subject ON canon_facts(world_id, subject_entity_id, status);
CREATE INDEX IF NOT EXISTS idx_facts_predicate ON canon_facts(world_id, predicate);
CREATE INDEX IF NOT EXISTS idx_events_order ON canon_events(world_id, world_time_order);
CREATE INDEX IF NOT EXISTS idx_aliases_alias ON entity_aliases(world_id, alias);
CREATE INDEX IF NOT EXISTS idx_jobs_world_status ON world_jobs(world_id, status, kind);
`;

export const GAME_SCHEMA_SQL = `PRAGMA foreign_keys = ON;

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
`;

export const PHASE2_SCHEMA_SQL = `
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
`;

const P2_ACCEPTANCE_SCHEMA_SQL = `PRAGMA foreign_keys = ON;

-- P2 acceptance G06: raw-file-byte SHA-256. New imports store the true byte
-- digest in source_sha256, while worlds hashed by the legacy re-encode scheme keep
-- their old value here so resume matching and old save manifests never break
-- silently. The column is never backfilled - legacy values are preserved as
-- they were (plan 15.3 - no silent rewrites of existing data).
ALTER TABLE worlds ADD COLUMN legacy_source_sha256 TEXT;

-- G01: encounters.round was part of the domain model but never had a
-- column (saveEncounter had no production caller). Stored rounds keep
-- the default of 1 - existing rows never claimed a round number.
ALTER TABLE encounters ADD COLUMN round INTEGER NOT NULL DEFAULT 1;
`;

const COMBAT_ECONOMY_SCHEMA_SQL = `PRAGMA foreign_keys = ON;

-- Combat uses a separate per-round movement allowance alongside the main action.
ALTER TABLE encounter_actors ADD COLUMN moved_this_round INTEGER NOT NULL DEFAULT 0;
`;

const KNOWLEDGE_QUEST_SCHEMA_SQL = `PRAGMA foreign_keys = ON;

ALTER TABLE quest_states ADD COLUMN completed_state_version INTEGER;

-- Branch-local knowledge is a projection of the full snapshots and events.
CREATE TABLE IF NOT EXISTS branch_knowledge (
  branch_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  known_via TEXT NOT NULL CHECK(known_via IN ('witnessed', 'told', 'inferred')),
  source_turn_id TEXT NOT NULL,
  known_state_version INTEGER NOT NULL,
  PRIMARY KEY(branch_id, actor_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_knowledge_entry ON branch_knowledge(branch_id, entry_id);

-- Quest rewards are independent of narrated text and deduplicated by immutable key.
CREATE TABLE IF NOT EXISTS quest_reward_ledger (
  branch_id TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  granted_state_version INTEGER NOT NULL,
  PRIMARY KEY(branch_id, quest_id, reward_id)
);
`;

const WORLD_PACKAGE_DRAFTS_SCHEMA_SQL = `PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS world_package_drafts (
  world_id TEXT PRIMARY KEY NOT NULL,
  base_revision INTEGER NOT NULL,
  draft_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE,
  FOREIGN KEY(world_id, base_revision) REFERENCES world_packages(world_id, revision) ON DELETE CASCADE
);
`;

const PARTY_LIFECYCLE_SCHEMA_SQL = `PRAGMA foreign_keys = ON;

-- Party groups make splits explicit while preserving branch-local membership history.
ALTER TABLE party_members ADD COLUMN party_group_id TEXT NOT NULL DEFAULT 'main';
`;

const EVENT_PROPOSAL_CHECKPOINT_SCHEMA_SQL = `PRAGMA foreign_keys = ON;

-- Closeout C1: per-chunk event proposals are checkpointed in the same
-- transaction that marks a chunk done. Timeline resolution later reads ALL
-- unresolved proposals (across runs/chunks) so a crash between chunk commit
-- and timeline resolution never loses events, and re-resolution is replayable.
CREATE TABLE IF NOT EXISTS world_event_proposals (
  world_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  world_time_order INTEGER,
  narrative_chapter_id TEXT,
  depends_on_event_keys_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed', 'resolved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(world_id, chunk_id, event_id),
  FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_proposals_status
  ON world_event_proposals(world_id, status);
`;

const IMPORTED_SOURCES_SCHEMA_SQL = `PRAGMA foreign_keys = ON;

-- Closeout C2: persisted private source of imported novels. The normalized
-- text lives in bounded shards, builds read ranges from here so resuming a
-- build never requires re-picking the original file. A source is written
-- under a staging manifest during streaming import and activated in one
-- transaction after all shards/chapters/chunks are verified.
CREATE TABLE IF NOT EXISTS imported_sources (
  source_id TEXT PRIMARY KEY,
  raw_sha256 TEXT NOT NULL,
  normalized_tree_hash TEXT NOT NULL,
  normalize_tree_hash_version TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  code_point_count INTEGER NOT NULL,
  encoding TEXT NOT NULL,
  normalize_version TEXT NOT NULL,
  chapter_split_version TEXT NOT NULL,
  normalize_shard_scheme TEXT NOT NULL,
  split_strategy TEXT NOT NULL,
  file_name TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'staging' CHECK(status IN ('staging', 'active', 'orphaned')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_imported_sources_raw_active
  ON imported_sources(raw_sha256) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS imported_source_segments (
  source_id TEXT NOT NULL,
  shard_index INTEGER NOT NULL,
  start_cp INTEGER NOT NULL,
  end_cp INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY(source_id, shard_index),
  FOREIGN KEY(source_id) REFERENCES imported_sources(source_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_imported_source_segments_range
  ON imported_source_segments(source_id, start_cp, end_cp);

CREATE TABLE IF NOT EXISTS imported_source_chapters (
  source_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  chapter_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  start_cp INTEGER NOT NULL,
  end_cp INTEGER NOT NULL,
  char_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  PRIMARY KEY(source_id, chapter_id),
  UNIQUE(source_id, chapter_index),
  FOREIGN KEY(source_id) REFERENCES imported_sources(source_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS imported_source_chunks (
  source_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  start_cp INTEGER NOT NULL,
  end_cp INTEGER NOT NULL,
  char_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  PRIMARY KEY(source_id, chunk_id),
  UNIQUE(source_id, chapter_id, chunk_index),
  FOREIGN KEY(source_id) REFERENCES imported_sources(source_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_imported_source_chunks_chapter
  ON imported_source_chunks(source_id, chapter_id);
`;

const WORLD_BUILD_RUNS_SCHEMA_SQL = `PRAGMA foreign_keys = ON;

-- Closeout C2: persistent build runs and units. One coordinator owns a run
-- at a time via a CAS lease with a monotonically increasing fencing token,
-- late commits from a stale owner are rejected by token comparison.
CREATE TABLE IF NOT EXISTS world_build_runs (
  run_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_snapshot_hash TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  plan_version TEXT NOT NULL,
  model_fingerprint TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN
    ('reading', 'normalizing', 'indexing', 'extracting', 'merging', 'mapping', 'validating', 'publishing')),
  status TEXT NOT NULL CHECK(status IN
    ('queued', 'running', 'waiting_network', 'waiting_unlock', 'paused_system', 'paused_user',
     'failed_retryable', 'needs_review', 'failed_terminal', 'canceled', 'completed')),
  units_total INTEGER NOT NULL DEFAULT 0,
  units_done INTEGER NOT NULL DEFAULT 0,
  units_failed INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TEXT,
  fencing_token INTEGER NOT NULL DEFAULT 0,
  heartbeat_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES imported_sources(source_id)
);

CREATE INDEX IF NOT EXISTS idx_world_build_runs_status ON world_build_runs(status, updated_at);

CREATE TABLE IF NOT EXISTS world_build_units (
  unit_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('extract_group', 'map_batch')),
  source_ranges_json TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  parent_unit_id TEXT,
  ord INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN
    ('queued', 'running', 'waiting_network', 'waiting_unlock',
     'failed_retryable', 'needs_review', 'failed_terminal', 'canceled', 'completed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  retry_at TEXT,
  result_ref TEXT,
  usage_json TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES world_build_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_build_units_run ON world_build_units(run_id, ord);
CREATE UNIQUE INDEX IF NOT EXISTS idx_world_build_units_unique_input
  ON world_build_units(run_id, kind, input_hash, config_fingerprint);
`;

const PROGRESSIVE_PACKAGE_SCOPE_SCHEMA_SQL = `
ALTER TABLE world_packages ADD COLUMN build_scope_json TEXT NOT NULL DEFAULT '{}';
`;

const PROGRESSIVE_CONTENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS branch_content_manifests (
  branch_id TEXT NOT NULL,
  state_version INTEGER NOT NULL CHECK(state_version >= 0),
  content_version INTEGER NOT NULL CHECK(content_version >= 0),
  manifest_hash TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, state_version, content_version),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_branch_content_manifest_head
  ON branch_content_manifests(branch_id, state_version DESC, content_version DESC);

CREATE TABLE IF NOT EXISTS progressive_world_deltas (
  delta_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  origin_branch_id TEXT NOT NULL,
  published_at_state_version INTEGER NOT NULL CHECK(published_at_state_version >= 0),
  base_revision INTEGER NOT NULL CHECK(base_revision > 0),
  base_content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('needs_review', 'published')),
  content_hash TEXT NOT NULL,
  package_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_progressive_delta_origin
  ON progressive_world_deltas(origin_branch_id, published_at_state_version);

`;

const INTERACTION_ORCHESTRATION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS interaction_campaign_fences (
  campaign_id TEXT PRIMARY KEY,
  fence_token INTEGER NOT NULL CHECK(fence_token > 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(campaign_id) REFERENCES campaigns(campaign_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interaction_operations (
  operation_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL CHECK(operation_kind IN ('encounter_auto')),
  status TEXT NOT NULL CHECK(status IN ('running', 'paused_system', 'completed', 'failed')),
  expected_state_version INTEGER NOT NULL CHECK(expected_state_version >= 0),
  fence_token INTEGER NOT NULL CHECK(fence_token > 0),
  next_step INTEGER NOT NULL DEFAULT 0 CHECK(next_step >= 0),
  max_steps INTEGER NOT NULL CHECK(max_steps > 0 AND max_steps <= 32),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(campaign_id) REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_interaction_one_running_per_branch
  ON interaction_operations(branch_id) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS interaction_operation_steps (
  operation_id TEXT NOT NULL,
  step_index INTEGER NOT NULL CHECK(step_index >= 0),
  action_kind TEXT NOT NULL CHECK(action_kind IN ('npc_turn')),
  request_id TEXT NOT NULL UNIQUE,
  expected_state_version INTEGER NOT NULL CHECK(expected_state_version >= 0),
  committed_state_version INTEGER,
  status TEXT NOT NULL CHECK(status IN ('prepared', 'committed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(operation_id, step_index),
  FOREIGN KEY(operation_id) REFERENCES interaction_operations(operation_id) ON DELETE CASCADE
);
`;

export const UNIFIED_BUILD_P1_SCHEMA_SQL = `
ALTER TABLE world_build_runs ADD COLUMN config_json TEXT;
ALTER TABLE world_build_runs ADD COLUMN plan_state_json TEXT;
ALTER TABLE world_build_runs ADD COLUMN scope_json TEXT;
ALTER TABLE world_build_runs ADD COLUMN pause_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE world_build_runs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;
`;

export const UNIFIED_BUILD_P3_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS world_stage_plans (
  plan_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  strategy TEXT NOT NULL CHECK (strategy IN ('full', 'progressive')),
  stages_json TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_stage_plans_world ON world_stage_plans(world_id);

CREATE TABLE IF NOT EXISTS world_stage_states (
  plan_id TEXT NOT NULL,
  stage_index INTEGER NOT NULL CHECK (stage_index >= 0),
  status TEXT NOT NULL CHECK (status IN (
    'untriggered', 'queued', 'building', 'validating', 'built', 'pending_activation', 'activated',
    'waiting_network', 'waiting_unlock', 'waiting_system', 'paused', 'failed')),
  run_id TEXT,
  package_revision INTEGER,
  trigger_reason TEXT,
  trigger_dedupe_key TEXT,
  triggered_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plan_id, stage_index)
);

CREATE TABLE IF NOT EXISTS campaign_package_advances (
  campaign_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  from_revision INTEGER NOT NULL,
  to_revision INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, branch_id, state_version)
);
CREATE INDEX IF NOT EXISTS idx_campaign_package_advances
  ON campaign_package_advances(campaign_id, branch_id, state_version);
`;

export const LLM_REQUEST_LEDGER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS llm_request_attempts (
  attempt_id TEXT PRIMARY KEY,
  logical_request_id TEXT NOT NULL,
  request_kind TEXT NOT NULL,
  campaign_id TEXT,
  branch_id TEXT,
  world_id TEXT,
  state_version INTEGER,
  model_profile_fingerprint TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL,
  failure_class TEXT,
  error_code TEXT,
  http_status INTEGER,
  provider_request_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  cached_input_tokens INTEGER,
  estimated_usage INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_llm_request_attempts_logical
  ON llm_request_attempts(logical_request_id, attempt_no);
CREATE INDEX IF NOT EXISTS idx_llm_request_attempts_status
  ON llm_request_attempts(status);
`;

export const STORY_MEMORY_V2_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS story_memory_states (
  branch_id TEXT PRIMARY KEY,
  through_state_version INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  state_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  dirty_from_state_version INTEGER,
  last_applied_patch_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS story_memory_patches (
  patch_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  from_state_version INTEGER NOT NULL,
  to_state_version INTEGER NOT NULL,
  base_fingerprint TEXT NOT NULL,
  result_fingerprint TEXT,
  patch_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_story_memory_patches_branch
  ON story_memory_patches(branch_id, to_state_version);
`;

export const EPISODIC_RECALL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS episodic_turn_index (
  branch_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  search_text TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  invalid_at_state_version INTEGER,
  PRIMARY KEY(branch_id, turn_id)
);
CREATE INDEX IF NOT EXISTS idx_episodic_turn_index_branch
  ON episodic_turn_index(branch_id, state_version);
`;

export const BUILTIN_MIGRATIONS: readonly SqliteMigration[] = [
  { version: 1, name: 'core', sql: CORE_SCHEMA_SQL },
  { version: 2, name: 'narratives', sql: NARRATIVES_SCHEMA_SQL },
  { version: 3, name: 'world', sql: WORLD_SCHEMA_SQL },
  { version: 4, name: 'game', sql: GAME_SCHEMA_SQL },
  { version: 5, name: 'phase2', sql: PHASE2_SCHEMA_SQL },
  { version: 6, name: 'p2_acceptance', sql: P2_ACCEPTANCE_SCHEMA_SQL },
  { version: 7, name: 'combat_economy', sql: COMBAT_ECONOMY_SCHEMA_SQL },
  { version: 8, name: 'knowledge_quests', sql: KNOWLEDGE_QUEST_SCHEMA_SQL },
  { version: 9, name: 'world_package_drafts', sql: WORLD_PACKAGE_DRAFTS_SCHEMA_SQL },
  { version: 10, name: 'party_lifecycle', sql: PARTY_LIFECYCLE_SCHEMA_SQL },
  { version: 11, name: 'event_proposal_checkpoint', sql: EVENT_PROPOSAL_CHECKPOINT_SCHEMA_SQL },
  { version: 12, name: 'imported_sources', sql: IMPORTED_SOURCES_SCHEMA_SQL },
  { version: 13, name: 'world_build_runs', sql: WORLD_BUILD_RUNS_SCHEMA_SQL },
  { version: 14, name: 'progressive_package_scope', sql: PROGRESSIVE_PACKAGE_SCOPE_SCHEMA_SQL },
  { version: 15, name: 'progressive_branch_content', sql: PROGRESSIVE_CONTENT_SCHEMA_SQL },
  { version: 16, name: 'interaction_orchestration', sql: INTERACTION_ORCHESTRATION_SCHEMA_SQL },
  { version: 17, name: 'unified_build_p1', sql: UNIFIED_BUILD_P1_SCHEMA_SQL },
  { version: 18, name: 'unified_build_p3_stages', sql: UNIFIED_BUILD_P3_SCHEMA_SQL },
  { version: 19, name: 'llm_request_ledger', sql: LLM_REQUEST_LEDGER_SCHEMA_SQL },
  { version: 20, name: 'story_memory_v2', sql: STORY_MEMORY_V2_SCHEMA_SQL },
  { version: 21, name: 'episodic_recall_v2', sql: EPISODIC_RECALL_SCHEMA_SQL },
];

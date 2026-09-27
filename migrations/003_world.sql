PRAGMA foreign_keys = ON;

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

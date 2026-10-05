import type { SqliteMigration } from './migrations';

/** Fresh development schema. Historical upgrade chains are intentionally removed. */
export const BUILTIN_MIGRATIONS: readonly SqliteMigration[] = [{ version: 100, name: 'phase8_current_baseline', sql: `
CREATE TABLE actor_cards (
  branch_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  card_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_state_version INTEGER NOT NULL,
  PRIMARY KEY(branch_id, actor_id)
);

CREATE TABLE actor_skills (
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

CREATE TABLE actor_states (
  branch_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  location_id TEXT NOT NULL,
  resources_json TEXT NOT NULL,
  conditions_json TEXT NOT NULL,
  PRIMARY KEY(branch_id, actor_id),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE TABLE book_sections (
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

CREATE TABLE branch_canon_overrides (
  world_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'invalidated', 'confirmed')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, branch_id, event_id),
  FOREIGN KEY(world_id, event_id) REFERENCES canon_events(world_id, event_id) ON DELETE CASCADE
);

CREATE TABLE branch_content_manifests (
  branch_id TEXT NOT NULL,
  state_version INTEGER NOT NULL CHECK(state_version >= 0),
  content_version INTEGER NOT NULL CHECK(content_version >= 0),
  manifest_hash TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, state_version, content_version),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE TABLE branch_decision_guidance (
  branch_id TEXT NOT NULL,
  decision_point_id TEXT NOT NULL,
  source_turn_id TEXT NOT NULL,
  state_version INTEGER NOT NULL CHECK(state_version >= 0),
  severity TEXT NOT NULL CHECK(severity IN ('normal','major')),
  guidance_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, decision_point_id),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE TABLE branch_events (
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

CREATE TABLE branch_knowledge (
  branch_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  known_via TEXT NOT NULL CHECK(known_via IN ('witnessed', 'told', 'inferred')),
  source_turn_id TEXT NOT NULL,
  known_state_version INTEGER NOT NULL,
  PRIMARY KEY(branch_id, actor_id, entry_id)
);

CREATE TABLE branch_segment_artifact_manifests (
 branch_id TEXT NOT NULL, state_version INTEGER NOT NULL CHECK(state_version >= 0),
 artifact_version INTEGER NOT NULL CHECK(artifact_version >= 0), artifact_manifest_hash TEXT NOT NULL,
 manifest_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(branch_id,state_version,artifact_manifest_hash),
 FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE TABLE branch_situations (
  branch_id TEXT NOT NULL,
  situation_id TEXT NOT NULL,
  state_version INTEGER NOT NULL CHECK(state_version >= 0),
  status TEXT NOT NULL CHECK(status IN ('dormant','eligible','active','resolved','suppressed')),
  situation_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, situation_id),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE TABLE branches (
  branch_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  parent_branch_id TEXT,
  fork_turn_id TEXT,
  state_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(parent_branch_id) REFERENCES branches(branch_id)
);

CREATE TABLE campaign_package_advances (
  campaign_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  from_revision INTEGER NOT NULL,
  to_revision INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, branch_id, state_version)
);

CREATE TABLE campaigns (
  campaign_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  title TEXT NOT NULL,
  ruleset_id TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  world_mapping_version TEXT NOT NULL,
  opening_json TEXT NOT NULL,
  created_at TEXT NOT NULL, package_revision INTEGER, anchor_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE TABLE canon_events (
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

CREATE TABLE canon_facts (
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

CREATE TABLE divergence_markers (
  world_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  marker_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, branch_id, marker_id),
  FOREIGN KEY(world_id, event_id) REFERENCES canon_events(world_id, event_id) ON DELETE CASCADE
);

CREATE TABLE encounter_actors (
  branch_id TEXT NOT NULL,
  encounter_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  side TEXT NOT NULL,
  hp INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  stamina INTEGER NOT NULL,
  conditions_json TEXT NOT NULL DEFAULT '[]',
  distance_band TEXT NOT NULL DEFAULT 'mid' CHECK(distance_band IN ('near', 'mid', 'far')),
  acted_this_round INTEGER NOT NULL DEFAULT 0, moved_this_round INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(branch_id, encounter_id, actor_id),
  FOREIGN KEY(branch_id, encounter_id) REFERENCES encounters(branch_id, encounter_id) ON DELETE CASCADE
);

CREATE TABLE encounters (
  branch_id TEXT NOT NULL,
  encounter_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'resolved', 'escaped', 'wiped')),
  scene_id TEXT NOT NULL,
  distance_bands_json TEXT NOT NULL DEFAULT '{}',
  initiative_json TEXT NOT NULL DEFAULT '[]',
  turn_cursor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  resolved_at TEXT, round INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(branch_id, encounter_id),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE TABLE entities (
  world_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('character', 'faction', 'location', 'item', 'ability', 'rule', 'event')),
  name TEXT NOT NULL,
  first_seen_chapter_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, entity_id),
  FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE TABLE entity_aliases (
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

CREATE TABLE episodic_turn_index (
  branch_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  search_text TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  invalid_at_state_version INTEGER,
  PRIMARY KEY(branch_id, turn_id)
);

CREATE TABLE event_dependencies (
  world_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  depends_on_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(world_id, event_id, depends_on_event_id),
  FOREIGN KEY(world_id, event_id) REFERENCES canon_events(world_id, event_id) ON DELETE CASCADE,
  FOREIGN KEY(world_id, depends_on_event_id) REFERENCES canon_events(world_id, event_id) ON DELETE CASCADE
);

CREATE TABLE fact_sources (
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

CREATE TABLE frozen_turn_material_roots (
      root_id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      logical_request_id TEXT NOT NULL,
      role TEXT NOT NULL,
      stage TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE frozen_turn_postprocess_outbox (
      handoff_id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      committed_state_version INTEGER NOT NULL,
      rule_binding_hash TEXT,
      public_evidence_hash TEXT NOT NULL,
      body_revision_hash TEXT,
      has_body INTEGER NOT NULL DEFAULT 0,
      task_schema TEXT NOT NULL DEFAULT 'turn-postprocess-handoff-1',
      status TEXT NOT NULL CHECK(status IN ('pending','running','retryable_failed','outcome_unknown','blocked','succeeded','superseded','cancelled')),
      lease_owner TEXT,
      lease_expires_at TEXT,
      fencing_token INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      episodic_indexed INTEGER NOT NULL DEFAULT 0,
      physical_http_count INTEGER NOT NULL DEFAULT 0,
      diagnostics_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE imported_source_chapters (
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

CREATE TABLE imported_source_chunks (
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

CREATE TABLE imported_source_segments (
  source_id TEXT NOT NULL,
  shard_index INTEGER NOT NULL,
  start_cp INTEGER NOT NULL,
  end_cp INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY(source_id, shard_index),
  FOREIGN KEY(source_id) REFERENCES imported_sources(source_id) ON DELETE CASCADE
);

CREATE TABLE imported_sources (
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

CREATE TABLE interaction_campaign_fences (
  campaign_id TEXT PRIMARY KEY,
  fence_token INTEGER NOT NULL CHECK(fence_token > 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(campaign_id) REFERENCES campaigns(campaign_id) ON DELETE CASCADE
);

CREATE TABLE interaction_operation_steps (
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

CREATE TABLE "interaction_operations" (
      operation_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
      branch_id TEXT NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
      operation_kind TEXT NOT NULL CHECK(operation_kind IN ('encounter_auto','play_turn')),
      status TEXT NOT NULL CHECK(status IN ('running','paused_system','completed','failed')),
      expected_state_version INTEGER NOT NULL CHECK(expected_state_version>=0),
      fence_token INTEGER NOT NULL CHECK(fence_token>0), next_step INTEGER NOT NULL DEFAULT 0 CHECK(next_step>=0),
      max_steps INTEGER NOT NULL CHECK(max_steps>0 AND max_steps<=32), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE inventory (
  branch_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  owner_actor_id TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  PRIMARY KEY(branch_id, item_id),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE TABLE knowledge_records (
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

CREATE TABLE llm_request_attempts (
  attempt_id TEXT PRIMARY KEY,
    request_fingerprint TEXT, response_json TEXT, response_hash TEXT,
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
, reasoning_tier TEXT, reasoning_reserve_tokens INTEGER, reasoning_policy_version TEXT, wire_output_tokens INTEGER, replay_approved_at INTEGER);

CREATE TABLE llm_requests (
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

CREATE TABLE llm_resource_buckets (
  endpoint_bucket_id TEXT PRIMARY KEY NOT NULL,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE memories (
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

CREATE TABLE outbox (
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

CREATE TABLE "package_entries" (
      world_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      entry_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('skill', 'ability', 'item', 'condition', 'actor_template', 'origin', 'path', 'scene', 'quest', 'lore', 'constraint', 'situation')),
      definition_json TEXT NOT NULL,
      provenance_json TEXT NOT NULL,
      field_provenance_json TEXT NOT NULL DEFAULT '{}',
      visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'gm', 'discoverable')),
      dependency_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      PRIMARY KEY(world_id, revision, entry_id),
      FOREIGN KEY(world_id, revision) REFERENCES world_packages(world_id, revision) ON DELETE CASCADE
    );

CREATE TABLE party_members (
  branch_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  controller TEXT NOT NULL CHECK(controller IN ('player', 'companion', 'gm')),
  role TEXT NOT NULL DEFAULT 'companion',
  joined_at TEXT NOT NULL, party_group_id TEXT NOT NULL DEFAULT 'main',
  PRIMARY KEY(branch_id, actor_id)
);

CREATE TABLE play_intent_drafts (
      branch_id TEXT PRIMARY KEY,
      expected_state_version INTEGER NOT NULL,
      intent_text TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
    );

CREATE TABLE progressive_world_deltas (
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

CREATE TABLE project_writer_style_bindings (
  project_id TEXT PRIMARY KEY REFERENCES worlds(world_id) ON DELETE CASCADE,
  style_version TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  binding_json TEXT NOT NULL
);

CREATE TABLE quest_reward_ledger (
  branch_id TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  granted_state_version INTEGER NOT NULL,
  PRIMARY KEY(branch_id, quest_id, reward_id)
);

CREATE TABLE quest_states (
  branch_id TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('available', 'active', 'succeeded', 'failed', 'abandoned')),
  counters_json TEXT NOT NULL DEFAULT '{}',
  updated_state_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, completed_state_version INTEGER,
  PRIMARY KEY(branch_id, quest_id)
);

CREATE TABLE relationships (
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

CREATE TABLE review_issues (
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

CREATE TABLE review_resolution_policies (
      world_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      resolution TEXT NOT NULL CHECK(resolution IN ('resolved', 'waived')),
      resolved_at TEXT NOT NULL,
      PRIMARY KEY(world_id, kind, severity, detail_json),
      FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
    );

CREATE TABLE reward_ledger (
  branch_id TEXT NOT NULL,
  encounter_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  reward_kind TEXT NOT NULL CHECK(reward_kind IN ('practice', 'milestone')),
  granted_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, encounter_id, actor_id, skill_id, reward_kind)
);

CREATE TABLE roll_records (
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

CREATE TABLE segment_demands (
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

CREATE TABLE segment_publication_diagnostics (
 diagnostic_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, segment_id TEXT NOT NULL,
 generation INTEGER NOT NULL, error_codes_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE TABLE snapshots (
  branch_id TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  state_hash TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, state_version),
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE
);

CREATE TABLE source_chapters (
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

CREATE TABLE source_chunks (
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

CREATE TABLE source_index_alias_versions (
  world_id TEXT PRIMARY KEY REFERENCES worlds(world_id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL
);

CREATE TABLE source_index_aliases (
  world_id TEXT NOT NULL REFERENCES source_index_alias_versions(world_id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  alias_text TEXT NOT NULL,
  PRIMARY KEY(world_id, entity_id, normalized_alias)
);

CREATE TABLE source_index_pages (
  index_id INTEGER NOT NULL REFERENCES source_index_sources(index_id) ON DELETE CASCADE,
  start_cp INTEGER NOT NULL,
  end_cp INTEGER NOT NULL CHECK(end_cp > start_cp),
  content_hash TEXT NOT NULL,
  paragraph_count INTEGER NOT NULL,
  posting_count INTEGER NOT NULL,
  used_at INTEGER NOT NULL,
  PRIMARY KEY(index_id, start_cp)
);

CREATE TABLE source_index_paragraphs (
  paragraph_id INTEGER PRIMARY KEY,
  index_id INTEGER NOT NULL,
  page_start_cp INTEGER NOT NULL,
  start_cp INTEGER NOT NULL,
  end_cp INTEGER NOT NULL CHECK(end_cp > start_cp),
  chapter_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  FOREIGN KEY(index_id, page_start_cp) REFERENCES source_index_pages(index_id,start_cp) ON DELETE CASCADE,
  UNIQUE(index_id, start_cp, end_cp)
);

CREATE TABLE source_index_postings (
  paragraph_id INTEGER NOT NULL REFERENCES source_index_paragraphs(paragraph_id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  frequency INTEGER NOT NULL CHECK(frequency > 0),
  PRIMARY KEY(paragraph_id, term)
);

CREATE TABLE source_index_sources (
  index_id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES imported_sources(source_id) ON DELETE CASCADE,
  normalized_tree_hash TEXT NOT NULL,
  index_version TEXT NOT NULL,
  code_point_count INTEGER NOT NULL CHECK(code_point_count >= 0),
  corrupt INTEGER NOT NULL DEFAULT 0 CHECK(corrupt IN (0,1)),
  UNIQUE(source_id, normalized_tree_hash, index_version)
);

CREATE TABLE source_style_profiles (
  project_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  logical_request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'ready', 'failed')),
  error_code TEXT,
  updated_at TEXT NOT NULL,
  profile_json TEXT,
  PRIMARY KEY (project_id, cache_key)
);

CREATE TABLE story_memory_batch_requests (
      batch_id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, from_state_version INTEGER NOT NULL,
      to_state_version INTEGER NOT NULL, base_fingerprint TEXT NOT NULL,
      payload_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );

CREATE TABLE story_memory_batch_responses (
      batch_id TEXT NOT NULL, response_no INTEGER NOT NULL, response_json TEXT NOT NULL,
      content_hash TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(batch_id,response_no)
    );

CREATE TABLE story_memory_checkpoints (
      branch_id TEXT NOT NULL, through_state_version INTEGER NOT NULL,
      state_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(branch_id, through_state_version)
    );

CREATE TABLE story_memory_patches (
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

CREATE TABLE story_memory_states (
  branch_id TEXT PRIMARY KEY,
  through_state_version INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  state_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  dirty_from_state_version INTEGER,
  last_applied_patch_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE story_memory_worker_leases (
      branch_id TEXT PRIMARY KEY, lease_owner TEXT NOT NULL, fencing_token INTEGER NOT NULL,
      lease_expires_at TEXT NOT NULL
    );

CREATE TABLE turn_narratives (
  branch_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  outcome_grade TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('Candidate', 'Committed')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, turn_id),
  FOREIGN KEY(branch_id, turn_id) REFERENCES turns(branch_id, turn_id) ON DELETE CASCADE
);

CREATE TABLE turns (
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

CREATE TABLE "world_build_runs" (
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
    ('queued', 'running', 'waiting_network', 'waiting_unlock', 'paused_system', 'paused_user', 'stopped_user',
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
  config_json TEXT,
  plan_state_json TEXT,
  scope_json TEXT,
  pause_requested INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(source_id) REFERENCES imported_sources(source_id)
);

CREATE TABLE "world_build_units" (
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

CREATE TABLE world_event_proposals (
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

CREATE TABLE world_jobs (
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

CREATE TABLE world_opening_surveys (
 world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','completed','failed','outcome_unknown')),
 result_json TEXT, error_code TEXT, PRIMARY KEY(world_id,fingerprint));

CREATE TABLE world_package_drafts (
  world_id TEXT PRIMARY KEY NOT NULL,
  base_revision INTEGER NOT NULL,
  draft_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE,
  FOREIGN KEY(world_id, base_revision) REFERENCES world_packages(world_id, revision) ON DELETE CASCADE
);

CREATE TABLE world_packages (
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
  created_at TEXT NOT NULL, build_scope_json TEXT NOT NULL DEFAULT '{}', rule_config_json TEXT NOT NULL DEFAULT 'null',
  PRIMARY KEY(world_id, revision),
  FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE TABLE world_rule_mappings (
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

CREATE TABLE world_segment_artifacts (
 artifact_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, segment_id TEXT NOT NULL,
 generation INTEGER NOT NULL CHECK(generation > 0), content_hash TEXT NOT NULL,
 artifact_json TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE
);

CREATE TABLE world_segment_execution_configs (
 world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL, config_json TEXT NOT NULL,
 PRIMARY KEY(world_id,fingerprint)
);

CREATE TABLE world_segment_plans (
  plan_id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL UNIQUE REFERENCES worlds(world_id) ON DELETE CASCADE,
  plan_version TEXT NOT NULL CHECK(plan_version = 'segment-plan-1'),
  source_binding_json TEXT NOT NULL,
  execution_config_fingerprint TEXT NOT NULL,
  pause_reason TEXT CHECK(pause_reason IN ('user','system','budget','network','unlock')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE world_segments (
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

CREATE TABLE world_sources (
      world_id TEXT NOT NULL,
      source_ordinal INTEGER NOT NULL CHECK(source_ordinal >= 1),
      source_id TEXT NOT NULL,
      raw_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(world_id, source_ordinal),
      UNIQUE(world_id, source_id),
      UNIQUE(source_id),
      FOREIGN KEY(world_id) REFERENCES worlds(world_id) ON DELETE CASCADE,
      FOREIGN KEY(source_id) REFERENCES imported_sources(source_id) ON DELETE CASCADE
    );

CREATE TABLE world_stage_plans (
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

CREATE TABLE world_stage_states (
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

CREATE TABLE worlds (
  world_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_bytes INTEGER NOT NULL,
  normalize_version TEXT NOT NULL,
  chapter_split_version TEXT NOT NULL,
  build_status TEXT NOT NULL CHECK(build_status IN ('importing', 'extracting', 'merging', 'mapping', 'ready', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, legacy_source_sha256 TEXT);

CREATE TABLE writer_style_assets (
  asset_id TEXT NOT NULL,
  asset_version TEXT NOT NULL,
  semantic_json TEXT NOT NULL,
  PRIMARY KEY (asset_id, asset_version)
);

CREATE TABLE writer_style_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(branch_id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  compiled_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  UNIQUE (project_id, branch_id, turn_id)
);

CREATE INDEX idx_actor_skills_actor ON actor_skills(branch_id, actor_id, rank);

CREATE INDEX idx_aliases_alias ON entity_aliases(world_id, alias);

CREATE INDEX idx_branch_content_manifest_head
  ON branch_content_manifests(branch_id, state_version DESC, content_version DESC);

CREATE INDEX idx_branch_knowledge_entry ON branch_knowledge(branch_id, entry_id);

CREATE INDEX idx_branch_segment_artifact_manifest ON branch_segment_artifact_manifests(branch_id,state_version DESC,artifact_version DESC);

CREATE INDEX idx_branch_situations_version
  ON branch_situations(branch_id, state_version);

CREATE INDEX idx_campaign_package_advances
  ON campaign_package_advances(campaign_id, branch_id, state_version);

CREATE INDEX idx_chunks_world_status ON source_chunks(world_id, extraction_status);

CREATE INDEX idx_encounters_status ON encounters(branch_id, status);

CREATE INDEX idx_episodic_turn_index_branch
  ON episodic_turn_index(branch_id, state_version);

CREATE INDEX idx_event_proposals_status
  ON world_event_proposals(world_id, status);

CREATE INDEX idx_events_order ON canon_events(world_id, world_time_order);

CREATE INDEX idx_facts_predicate ON canon_facts(world_id, predicate);

CREATE INDEX idx_facts_subject ON canon_facts(world_id, subject_entity_id, status);

CREATE INDEX idx_frozen_outbox_status
      ON frozen_turn_postprocess_outbox(branch_id, status, committed_state_version);

CREATE INDEX idx_frozen_roots_turn
      ON frozen_turn_material_roots(branch_id, turn_id);

CREATE INDEX idx_imported_source_chunks_chapter
  ON imported_source_chunks(source_id, chapter_id);

CREATE INDEX idx_imported_source_segments_range
  ON imported_source_segments(source_id, start_cp, end_cp);

CREATE UNIQUE INDEX idx_imported_sources_raw_active
  ON imported_sources(raw_sha256) WHERE status = 'active';

CREATE UNIQUE INDEX idx_interaction_one_running_per_branch ON interaction_operations(branch_id) WHERE status='running';

CREATE INDEX idx_jobs_world_status ON world_jobs(world_id, status, kind);

CREATE INDEX idx_ledger_actor ON reward_ledger(branch_id, actor_id, skill_id);

CREATE INDEX idx_llm_request_attempts_logical
  ON llm_request_attempts(logical_request_id, attempt_no);

CREATE INDEX idx_llm_request_attempts_reasoning_usage
  ON llm_request_attempts(model_profile_fingerprint, reasoning_tier, request_kind, started_at);

CREATE INDEX idx_llm_request_attempts_status
  ON llm_request_attempts(status);

CREATE INDEX idx_memories_branch ON memories(branch_id, to_state_version);

CREATE INDEX idx_outbox_pending ON outbox(branch_id, status);

CREATE INDEX idx_overrides_branch ON branch_canon_overrides(branch_id, world_id);

CREATE INDEX idx_package_entries_kind ON package_entries(world_id, kind);

CREATE INDEX idx_packages_status ON world_packages(world_id, status);

CREATE INDEX idx_party_branch ON party_members(branch_id, controller);

CREATE INDEX idx_progressive_delta_origin
  ON progressive_world_deltas(origin_branch_id, published_at_state_version);

CREATE INDEX idx_quests_branch ON quest_states(branch_id, status);

CREATE INDEX idx_review_open ON review_issues(world_id, status, severity);

CREATE INDEX idx_segment_artifact_world ON world_segment_artifacts(world_id, segment_id, generation);

CREATE INDEX idx_story_memory_patches_branch
  ON story_memory_patches(branch_id, to_state_version);

CREATE UNIQUE INDEX idx_turn_committed_state
  ON turns(branch_id, committed_state_version)
  WHERE committed_state_version IS NOT NULL;

CREATE INDEX idx_world_build_runs_status ON world_build_runs(status, updated_at);

CREATE INDEX idx_world_build_units_run ON world_build_units(run_id, ord);

CREATE UNIQUE INDEX idx_world_build_units_unique_input
  ON world_build_units(run_id, kind, input_hash, config_fingerprint);

CREATE INDEX idx_world_stage_plans_world ON world_stage_plans(world_id);

CREATE INDEX idx_writer_style_snapshots_branch ON writer_style_snapshots(project_id, branch_id);

CREATE INDEX segment_demands_by_world ON segment_demands(world_id, active);

CREATE INDEX source_index_paragraph_ranges ON source_index_paragraphs(index_id,start_cp,end_cp);

CREATE INDEX source_index_posting_terms ON source_index_postings(term,paragraph_id);

CREATE INDEX world_segments_by_world ON world_segments(world_id, status);

CREATE TABLE abandoned_turns (branch_id TEXT NOT NULL, turn_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(branch_id,turn_id));
CREATE TABLE shineword_baseline (baseline_version TEXT PRIMARY KEY, installed_at TEXT NOT NULL);
` }];

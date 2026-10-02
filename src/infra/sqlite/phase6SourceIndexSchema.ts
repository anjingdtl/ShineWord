/** M0 appends this SQL to the one phase 6 migration. Derived data only. */
export const PHASE6_SOURCE_INDEX_SCHEMA = `
CREATE TABLE source_index_sources (
  index_id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES imported_sources(source_id) ON DELETE CASCADE,
  normalized_tree_hash TEXT NOT NULL,
  index_version TEXT NOT NULL,
  code_point_count INTEGER NOT NULL CHECK(code_point_count >= 0),
  corrupt INTEGER NOT NULL DEFAULT 0 CHECK(corrupt IN (0,1)),
  UNIQUE(source_id, normalized_tree_hash, index_version)
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
CREATE INDEX source_index_paragraph_ranges ON source_index_paragraphs(index_id,start_cp,end_cp);
CREATE TABLE source_index_postings (
  paragraph_id INTEGER NOT NULL REFERENCES source_index_paragraphs(paragraph_id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  frequency INTEGER NOT NULL CHECK(frequency > 0),
  PRIMARY KEY(paragraph_id, term)
);
CREATE INDEX source_index_posting_terms ON source_index_postings(term,paragraph_id);
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
`;

PRAGMA foreign_keys = ON;

-- P2 acceptance G06: raw-file-byte SHA-256. New imports store the true byte
-- digest in source_sha256, while worlds hashed by the legacy re-encode scheme keep
-- their old value here so resume matching and old save manifests never break
-- silently. The column is never backfilled - legacy values are preserved as
-- they were (plan §15.3: no silent rewrites of existing data).
ALTER TABLE worlds ADD COLUMN legacy_source_sha256 TEXT;

-- G01: encounters.round was part of the domain model but never had a
-- column (saveEncounter had no production caller). Stored rounds keep
-- the default of 1 - existing rows never claimed a round number.
ALTER TABLE encounters ADD COLUMN round INTEGER NOT NULL DEFAULT 1;

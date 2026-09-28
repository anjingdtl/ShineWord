PRAGMA foreign_keys = ON;

-- Party groups make splits explicit while preserving branch-local membership history.
ALTER TABLE party_members ADD COLUMN party_group_id TEXT NOT NULL DEFAULT 'main';

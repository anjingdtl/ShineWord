PRAGMA foreign_keys = ON;

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

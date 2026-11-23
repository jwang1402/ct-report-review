CREATE TABLE IF NOT EXISTS study_a_expert_references (
  case_id TEXT NOT NULL REFERENCES private_cases(case_id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version >= 1),
  expert TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  notes TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(case_id,version)
);

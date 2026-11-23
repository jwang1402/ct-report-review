-- A separate, sealed collection of cases for the crossover experiment.
CREATE TABLE IF NOT EXISTS study_b_cohort (
  id INTEGER PRIMARY KEY CHECK(id=1),
  version INTEGER NOT NULL DEFAULT 0,
  frozen INTEGER NOT NULL DEFAULT 0 CHECK(frozen IN (0,1)),
  cases_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(cases_json)),
  order_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(order_json))
);
INSERT OR IGNORE INTO study_b_cohort(id) VALUES(1);
CREATE TRIGGER IF NOT EXISTS study_b_seal_cases BEFORE UPDATE ON study_b_cohort WHEN OLD.frozen=1
BEGIN SELECT RAISE(ABORT,'Study B cases are frozen'); END;
CREATE TRIGGER IF NOT EXISTS study_b_keep_cases BEFORE DELETE ON study_b_cohort WHEN OLD.frozen=1
BEGIN SELECT RAISE(ABORT,'Study B cases are frozen'); END;

CREATE TABLE IF NOT EXISTS study_b_readers (
  username TEXT PRIMARY KEY REFERENCES accounts(username) ON DELETE CASCADE,
  cohort TEXT NOT NULL CHECK(cohort IN ('junior','senior')),
  slot INTEGER NOT NULL CHECK(slot>0),
  UNIQUE(cohort,slot)
);
CREATE TABLE IF NOT EXISTS study_b_readings (
  username TEXT NOT NULL REFERENCES study_b_readers(username) ON DELETE CASCADE,
  case_id TEXT NOT NULL,
  period INTEGER NOT NULL CHECK(period IN (1,2)),
  arm TEXT NOT NULL CHECK(arm IN ('with_ai','without_ai')),
  started_at INTEGER NOT NULL,
  submitted_at INTEGER CHECK(submitted_at>=started_at),
  version INTEGER NOT NULL DEFAULT 0,
  report TEXT NOT NULL,
  findings_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(findings_json)),
  PRIMARY KEY(username,case_id,period)
);
CREATE UNIQUE INDEX IF NOT EXISTS study_b_one_open_read ON study_b_readings(username,period) WHERE submitted_at IS NULL;
CREATE TRIGGER IF NOT EXISTS study_b_lock_final BEFORE UPDATE ON study_b_readings WHEN OLD.submitted_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'The reading has already been submitted'); END;
CREATE TABLE IF NOT EXISTS study_b_assessments (
  username TEXT NOT NULL,
  case_id TEXT NOT NULL,
  period INTEGER NOT NULL,
  version INTEGER NOT NULL,
  errors_json TEXT NOT NULL CHECK(json_valid(errors_json)),
  accepted_json TEXT NOT NULL CHECK(json_valid(accepted_json)),
  assessor TEXT NOT NULL,
  assessed_at INTEGER NOT NULL,
  PRIMARY KEY(username,case_id,period),
  FOREIGN KEY(username,case_id,period) REFERENCES study_b_readings(username,case_id,period) ON DELETE CASCADE
);

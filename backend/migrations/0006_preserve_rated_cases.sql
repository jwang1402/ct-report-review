-- Preserve report editing locks when an administrator removes a reader's ratings.
CREATE TABLE IF NOT EXISTS previously_rated_cases (
  case_id TEXT PRIMARY KEY REFERENCES private_cases(case_id) ON DELETE CASCADE
);
CREATE TRIGGER IF NOT EXISTS keep_rated_case_locked
AFTER DELETE ON assignments WHEN OLD.rating IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO previously_rated_cases(case_id)
    SELECT case_id FROM private_cases WHERE case_id=OLD.case_id;
END;

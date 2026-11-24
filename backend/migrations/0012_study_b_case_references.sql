-- Keep published CTs, draft reports, and randomized case order in their sealed cohort.
-- A row with null reference_json uses the reference packaged at publication.
CREATE TABLE IF NOT EXISTS study_b_case_references (
  case_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
  reference_json TEXT CHECK(reference_json IS NULL OR json_valid(reference_json)),
  locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1))
);
CREATE TRIGGER IF NOT EXISTS study_b_lock_assessed_reference AFTER INSERT ON study_b_assessments
BEGIN
  INSERT INTO study_b_case_references(case_id,locked) VALUES(NEW.case_id,1)
    ON CONFLICT(case_id) DO UPDATE SET locked=1;
END;
INSERT OR IGNORE INTO study_b_case_references(case_id,locked)
  SELECT DISTINCT case_id,1 FROM study_b_assessments;

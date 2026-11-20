-- Anonymous study letters are allocated per case after filtering the original shared order.
-- Keep four-model assignments and all pre-existing scores intact.
CREATE VIEW IF NOT EXISTS study_a_reports AS
SELECT case_id,model_name,
       substr('ABC',row_number() OVER (PARTITION BY case_id ORDER BY letter),1) AS letter
FROM shared_case_letters
WHERE case_id IN ('BR4shared-Case01','BR4shared-Case02','BR4shared-Case03','BR4shared-Case04',
                  'BR4shared-Case05','BR4shared-Case06','BR4shared-Case07','BR4shared-Case08',
                  'BR4shared-Case09','BR4shared-Case10')
  AND model_name IN ('MORPH-CT','BTB3D-16','CT-CHAT-8B');

CREATE TABLE IF NOT EXISTS study_a_findings (
  text_sha256 TEXT PRIMARY KEY CHECK(length(text_sha256)=64),
  labels_json TEXT NOT NULL CHECK(json_valid(labels_json) AND json_type(labels_json)='object')
);
CREATE TABLE IF NOT EXISTS study_a_reviews (
  username TEXT NOT NULL,
  case_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  text_sha256 TEXT NOT NULL REFERENCES study_a_findings(text_sha256),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('yes','no')),
  errors_json TEXT NOT NULL CHECK(json_valid(errors_json) AND json_type(errors_json)='array'),
  confirmed INTEGER NOT NULL CHECK(confirmed=1),
  version INTEGER NOT NULL CHECK(version>=1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(username,case_id,model_name),
  FOREIGN KEY(username,case_id,model_name) REFERENCES assignments(username,case_id,model_name) ON DELETE CASCADE,
  CHECK ((mode='yes')=(json_array_length(errors_json)>0))
);
CREATE TRIGGER IF NOT EXISTS lock_case_on_study_a_review
AFTER INSERT ON study_a_reviews BEGIN
  INSERT OR IGNORE INTO previously_rated_cases(case_id) VALUES (NEW.case_id);
END;

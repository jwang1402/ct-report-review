CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE TABLE IF NOT EXISTS login_attempts (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reviews (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 submission_id TEXT NOT NULL UNIQUE,
 case_id TEXT NOT NULL,
 release_id INTEGER NOT NULL,
 report_id TEXT NOT NULL,
 model_name TEXT NOT NULL,
 reviewer TEXT NOT NULL,
 decision TEXT NOT NULL CHECK (decision IN ('1','2','3','4','5','ACCEPT','PARTIAL_ACCEPT','REJECT')),
 comment TEXT NOT NULL,
 created_at TEXT NOT NULL
);

-- Existing shared sessions have no verified user identity and cannot enter either area.
-- Legacy reviews remain in their original table as administrator-only history.
CREATE TABLE IF NOT EXISTS accounts (
  username TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin','doctor')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
  role TEXT NOT NULL,
  credential_stamp TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_sessions_expiry ON account_sessions(expires);
CREATE TABLE IF NOT EXISTS private_cases (
  case_id TEXT PRIMARY KEY,
  case_name TEXT NOT NULL,
  image_key TEXT NOT NULL UNIQUE,
  image_filename TEXT NOT NULL,
  image_size INTEGER NOT NULL CHECK (image_size > 0)
);
CREATE TABLE IF NOT EXISTS private_reports (
  case_id TEXT NOT NULL REFERENCES private_cases(case_id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  report_text TEXT NOT NULL,
  PRIMARY KEY(case_id,model_name)
);
CREATE TABLE IF NOT EXISTS assignments (
  username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
  case_id TEXT NOT NULL,
  letter TEXT NOT NULL CHECK (letter IN ('A','B','C','D')),
  model_name TEXT NOT NULL,
  case_order INTEGER NOT NULL DEFAULT 0,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  updated_at TEXT,
  PRIMARY KEY(username,case_id,letter),
  UNIQUE(username,case_id,model_name),
  FOREIGN KEY(case_id,model_name) REFERENCES private_reports(case_id,model_name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shared_case_letters (
  case_id TEXT NOT NULL,
  letter TEXT NOT NULL CHECK (letter IN ('A','B','C','D')),
  model_name TEXT NOT NULL,
  case_order INTEGER NOT NULL CHECK (case_order >= 1),
  PRIMARY KEY(case_id,letter),
  UNIQUE(case_id,model_name),
  FOREIGN KEY(case_id,model_name) REFERENCES private_reports(case_id,model_name) ON DELETE CASCADE
);

-- Cases already reviewed under a different blind key remain independent legacy studies.
CREATE TRIGGER IF NOT EXISTS shared_letter_consistency
BEFORE INSERT ON shared_case_letters
WHEN EXISTS (SELECT 1 FROM shared_case_letters WHERE case_id=NEW.case_id AND case_order<>NEW.case_order)
  OR EXISTS (SELECT 1 FROM assignments WHERE case_id=NEW.case_id AND
    (case_order<>NEW.case_order OR (letter=NEW.letter AND model_name<>NEW.model_name)
      OR (model_name=NEW.model_name AND letter<>NEW.letter)))
BEGIN
  SELECT RAISE(ABORT,'Inconsistent shared case order or report key');
END;

CREATE TRIGGER IF NOT EXISTS shared_assignment_insert
BEFORE INSERT ON assignments
WHEN EXISTS (SELECT 1 FROM shared_case_letters WHERE case_id=NEW.case_id)
  AND NOT EXISTS (SELECT 1 FROM shared_case_letters WHERE case_id=NEW.case_id
    AND letter=NEW.letter AND model_name=NEW.model_name AND case_order=NEW.case_order)
BEGIN
  SELECT RAISE(ABORT,'Assignment must use the shared case order and report key');
END;

CREATE TRIGGER IF NOT EXISTS shared_assignment_update
BEFORE UPDATE OF case_id,letter,model_name,case_order ON assignments
WHEN EXISTS (SELECT 1 FROM shared_case_letters WHERE case_id=NEW.case_id)
  AND NOT EXISTS (SELECT 1 FROM shared_case_letters WHERE case_id=NEW.case_id
    AND letter=NEW.letter AND model_name=NEW.model_name AND case_order=NEW.case_order)
BEGIN
  SELECT RAISE(ABORT,'Assignment must use the shared case order and report key');
END;

CREATE TABLE IF NOT EXISTS web_batches (
  batch_id TEXT PRIMARY KEY,
  prefix TEXT NOT NULL UNIQUE,
  manifest TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published'))
);
CREATE TABLE IF NOT EXISTS web_uploads (
  batch_id TEXT NOT NULL REFERENCES web_batches(batch_id),
  case_id TEXT NOT NULL,
  upload_id TEXT,
  ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0,1)),
  PRIMARY KEY(batch_id,case_id)
);
CREATE TABLE IF NOT EXISTS web_parts (
  batch_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  part INTEGER NOT NULL CHECK (part >= 1),
  etag TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  PRIMARY KEY(batch_id,case_id,part),
  FOREIGN KEY(batch_id,case_id) REFERENCES web_uploads(batch_id,case_id)
);
CREATE TABLE IF NOT EXISTS web_case_versions (
  case_id TEXT PRIMARY KEY REFERENCES private_cases(case_id),
  revision TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public_studies (
  prefix TEXT PRIMARY KEY REFERENCES web_batches(prefix),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
);

CREATE TABLE IF NOT EXISTS public_readers (
  username TEXT PRIMARY KEY REFERENCES accounts(username) ON DELETE CASCADE,
  prefix TEXT NOT NULL REFERENCES public_studies(prefix),
  display_name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires INTEGER NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0 CHECK(closed IN (0,1))
);
CREATE INDEX IF NOT EXISTS public_readers_prefix ON public_readers(prefix);

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

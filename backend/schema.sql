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
  checklist_version TEXT NOT NULL DEFAULT 'radbert-raw',
  PRIMARY KEY(username,case_id,model_name),
  FOREIGN KEY(username,case_id,model_name) REFERENCES assignments(username,case_id,model_name) ON DELETE CASCADE,
  CHECK ((mode='yes')=(json_array_length(errors_json)>0))
);
CREATE TRIGGER IF NOT EXISTS lock_case_on_study_a_review
AFTER INSERT ON study_a_reviews BEGIN
  INSERT OR IGNORE INTO previously_rated_cases(case_id) VALUES (NEW.case_id);
END;

CREATE TABLE IF NOT EXISTS study_a_checklist_releases (
  version TEXT PRIMARY KEY NOT NULL CHECK(length(version) BETWEEN 1 AND 40 AND version NOT GLOB '*[^A-Za-z0-9_-]*' AND version!='radbert-raw'),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS study_a_one_active_release ON study_a_checklist_releases(active) WHERE active=1;
CREATE TABLE IF NOT EXISTS study_a_finding_overrides (
  version TEXT NOT NULL REFERENCES study_a_checklist_releases(version),
  text_sha256 TEXT NOT NULL REFERENCES study_a_findings(text_sha256),
  finding TEXT NOT NULL CHECK(finding IN (
    'cardiomegaly','hiatal_hernia','pericardial_effusion','lymphadenopathy','lung_nodule','emphysema',
    'interlobular_septal_thickening','consolidation','atelectasis','lung_opacity','pulmonary_fibrotic_sequela',
    'bronchiectasis','pleural_effusion','mosaic_attenuation_pattern','arterial_wall_calcification',
    'peribronchial_thickening','medical_material','coronary_artery_wall_calcification')),
  raw_value INTEGER NOT NULL CHECK(raw_value IN (0,1)),
  reviewed_value INTEGER NOT NULL CHECK(reviewed_value IN (0,1) AND reviewed_value!=raw_value),
  PRIMARY KEY(version,text_sha256,finding)
);
CREATE TRIGGER IF NOT EXISTS study_a_start_release_as_draft BEFORE INSERT ON study_a_checklist_releases
WHEN NEW.active!=0 OR NEW.published!=0 BEGIN
  SELECT RAISE(ABORT,'Create a draft before publishing a checklist');
END;
CREATE TRIGGER IF NOT EXISTS study_a_seal_release AFTER UPDATE OF active ON study_a_checklist_releases
WHEN NEW.active=1 AND NEW.published=0 BEGIN
  UPDATE study_a_checklist_releases SET published=1 WHERE version=NEW.version;
END;
CREATE TRIGGER IF NOT EXISTS study_a_keep_release_sealed BEFORE UPDATE ON study_a_checklist_releases
WHEN OLD.published=1 AND (NEW.published=0 OR NEW.version!=OLD.version) BEGIN
  SELECT RAISE(ABORT,'Published checklist is immutable');
END;
CREATE TRIGGER IF NOT EXISTS study_a_keep_published_release BEFORE DELETE ON study_a_checklist_releases
WHEN OLD.published=1 BEGIN
  SELECT RAISE(ABORT,'Published checklist is immutable');
END;
CREATE TRIGGER IF NOT EXISTS study_a_check_override BEFORE INSERT ON study_a_finding_overrides BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM study_a_checklist_releases rel JOIN study_a_findings f ON f.text_sha256=NEW.text_sha256
    WHERE rel.version=NEW.version AND rel.published=0 AND json_extract(f.labels_json,'$.' || NEW.finding)=NEW.raw_value
  ) THEN RAISE(ABORT,'Expected a draft and matching original finding') END;
END;
CREATE TRIGGER IF NOT EXISTS study_a_keep_override_on_update BEFORE UPDATE ON study_a_finding_overrides BEGIN
  SELECT RAISE(ABORT,'Stage new checklist corrections with a new release or replace draft rows');
END;
CREATE TRIGGER IF NOT EXISTS study_a_keep_published_override BEFORE DELETE ON study_a_finding_overrides
WHEN (SELECT published FROM study_a_checklist_releases WHERE version=OLD.version)=1 BEGIN
  SELECT RAISE(ABORT,'Published checklist is immutable');
END;

CREATE TABLE IF NOT EXISTS study_a_expert_references (
  case_id TEXT NOT NULL REFERENCES private_cases(case_id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version >= 1),
  expert TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  notes TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(case_id,version)
);
CREATE TABLE IF NOT EXISTS crossover_readers (
  username TEXT PRIMARY KEY REFERENCES accounts(username) ON DELETE CASCADE,
  cohort TEXT NOT NULL CHECK(cohort IN ('senior','junior')),
  display_name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  UNIQUE(cohort,name_key)
);
CREATE TABLE IF NOT EXISTS crossover_devices (
  device_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES crossover_readers(username) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS crossover_sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES crossover_readers(username) ON DELETE CASCADE,
  name_confirmed_at INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS crossover_expiry ON crossover_sessions(expires);
CREATE TABLE IF NOT EXISTS crossover_requests (
  id TEXT PRIMARY KEY,
  device_hash TEXT NOT NULL UNIQUE,
  cohort TEXT NOT NULL CHECK(cohort IN ('senior','junior')),
  requested_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);


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

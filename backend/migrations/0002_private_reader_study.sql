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

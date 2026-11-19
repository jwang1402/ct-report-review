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

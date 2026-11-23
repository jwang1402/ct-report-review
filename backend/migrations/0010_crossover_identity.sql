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

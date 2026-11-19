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

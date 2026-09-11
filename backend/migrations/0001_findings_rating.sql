-- Preserve legacy decisions and IDs; allow new 1–5 findings ratings.
CREATE TABLE reviews_rating (
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
INSERT INTO reviews_rating SELECT * FROM reviews;
ALTER TABLE reviews RENAME TO reviews_legacy_backup_20260911;
ALTER TABLE reviews_rating RENAME TO reviews;

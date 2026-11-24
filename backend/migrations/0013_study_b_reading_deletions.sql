-- Keep a revision floor for reopened readings. Deleted clinical content is never copied.
CREATE TABLE IF NOT EXISTS study_b_reading_deletions (
  username TEXT NOT NULL REFERENCES study_b_readers(username) ON DELETE CASCADE,
  case_id TEXT NOT NULL,
  period INTEGER NOT NULL,
  next_version INTEGER NOT NULL,
  PRIMARY KEY(username,case_id,period)
);
CREATE TRIGGER IF NOT EXISTS study_b_remember_deleted_revision AFTER DELETE ON study_b_readings
WHEN EXISTS (SELECT 1 FROM study_b_readers WHERE username=OLD.username)
BEGIN
  INSERT INTO study_b_reading_deletions(username,case_id,period,next_version)
  VALUES(OLD.username,OLD.case_id,OLD.period,OLD.version+2)
  ON CONFLICT(username,case_id,period) DO UPDATE SET next_version=excluded.next_version;
END;

-- Once a junior starts session 2, keep its name-confirmation cutoff independently
-- of any session-1 readings subsequently removed by the administrator.
CREATE TABLE IF NOT EXISTS study_b_second_sessions (
  username TEXT PRIMARY KEY REFERENCES study_b_readers(username) ON DELETE CASCADE,
  opens_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO study_b_second_sessions(username,opens_at)
  SELECT username,MAX(submitted_at)+28*24*60*60 FROM study_b_readings r
  WHERE period=1 AND EXISTS (SELECT 1 FROM study_b_readings s WHERE s.username=r.username AND s.period=2)
  GROUP BY username HAVING COUNT(submitted_at)=10;
CREATE TRIGGER IF NOT EXISTS study_b_record_second_session AFTER INSERT ON study_b_readings
WHEN NEW.period=2 AND NOT EXISTS (SELECT 1 FROM study_b_second_sessions WHERE username=NEW.username)
BEGIN
  INSERT INTO study_b_second_sessions(username,opens_at)
    SELECT NEW.username,MAX(submitted_at)+28*24*60*60 FROM study_b_readings
    WHERE username=NEW.username AND period=1 HAVING COUNT(submitted_at)=10;
END;

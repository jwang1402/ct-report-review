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

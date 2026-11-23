-- Source extractor values stay in study_a_findings. Old and in-flight ratings default to their original checklist.
ALTER TABLE study_a_reviews ADD COLUMN checklist_version TEXT NOT NULL DEFAULT 'radbert-raw';

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

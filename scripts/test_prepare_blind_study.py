"""Offline regression tests for shared enrollment, using only synthetic report bodies."""
import importlib.util
import sqlite3
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch


source = Path(__file__).with_name("prepare-blind-study.py")
spec = importlib.util.spec_from_file_location("study_import", source)
study = importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)


class EnrollmentTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("PRAGMA foreign_keys=ON;" + (study.BACKEND / "schema.sql").read_text(encoding="utf-8"))
        self.users = [f"doctor{i}" for i in range(5)]
        self.db.executemany("INSERT INTO accounts VALUES (?, 'doctor','test','test')", [(u,) for u in self.users])
        overrides = self.enterContext(ExitStack())
        overrides.enter_context(patch.object(study, "query", lambda _, sql, remote: self.db.execute(sql).fetchall()))
        overrides.enter_context(patch.object(study, "apply_sql", lambda _, sql, scratch, remote: self.db.executescript(sql)))
        objects, reports, plan = {}, {}, []
        for i, case in enumerate(["Case03", "Case01", "Case02"]):
            case_id = f"Demo-{case}"
            objects[case] = (case_id, case, f"blind/Demo/{case}/fixture", case+".nii.gz", 1024)
            models = list(study.MODELS.values())
            for j, letter in enumerate(study.LETTERS):
                model = models[(i+j) % 4]
                reports[case, model] = "Synthetic text"
                plan.append((case_id, letter, model, i + 1))
        self.objects, self.reports, self.plan = objects, reports, plan
        self.db.executescript(study.study_sql(objects, reports, plan))

    def assign(self, user):
        return study.enroll("db", "Demo", user, self.plan, None, False)

    def test_no_users_then_one_three_five_and_retries(self):
        self.assertEqual(self.db.execute("SELECT count(*) FROM assignments").fetchone()[0], 0)
        self.assertEqual(set(study.shared_plan("db","Demo",False)), set(self.plan))
        for count, user in enumerate(self.users, 1):
            self.assertTrue(self.assign(user))
            mapping = self.db.execute("SELECT case_id, letter, model_name, case_order FROM assignments WHERE username=?", (user,))
            self.assertEqual(set(map(tuple,mapping)), set(self.plan))
            self.assertEqual(self.db.execute("SELECT count(*) FROM assignments").fetchone()[0], count * 12)
        self.db.execute("UPDATE assignments SET rating=5,comment='fixture' WHERE username=? AND letter='D'", (self.users[0],))
        self.db.executescript(study.study_sql(self.objects, self.reports, self.plan))
        self.assertFalse(self.assign(self.users[0]))
        self.assertEqual(self.db.execute("SELECT count(*) FROM assignments WHERE rating=5 AND comment='fixture'").fetchone()[0],3)
        self.assertEqual(self.db.execute("SELECT count(*) FROM assignments WHERE rating IS NULL").fetchone()[0],57)

    def test_incomplete_personal_mapping_and_legacy_studies_are_preserved(self):
        me = self.users[0]
        self.db.execute("INSERT INTO assignments(username,case_id,letter,model_name,case_order) VALUES(?,?,?,?,?)",
                        (me, *self.plan[0]))
        with self.assertRaisesRegex(ValueError, "incomplete"):
            self.assign(me)
        self.assertEqual(self.db.execute("SELECT count(*) FROM assignments").fetchone()[0],1)
        self.db.execute("INSERT INTO private_cases VALUES('Old-Case01','Case01','blind/Old/Case01/sample','Case01.nii.gz',1024)")
        with self.assertRaisesRegex(ValueError, "legacy"):
            study.shared_plan("db","Old",False)


if __name__ == "__main__":
    unittest.main()

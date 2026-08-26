import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ctl import setup_jobs


class SetupJobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(setup_jobs, "DB_PATH", Path(self.temp.name) / "jobs.sqlite3")
        self.db_patch.start()

    def tearDown(self):
        self.db_patch.stop()
        self.temp.cleanup()

    def test_job_progress_is_persistent_and_secret_free(self):
        job = setup_jobs.create_job("foundation", "foundation", "Preparing identity")
        setup_jobs.update_job(job["id"], status="starting", stage="authentik", summary="Starting Authentik",
                              progress=35, message="PostgreSQL is ready")
        loaded = setup_jobs.get_job(job["id"])
        self.assertEqual(loaded["progress"], 35)
        self.assertEqual(loaded["events"][-1]["message"], "PostgreSQL is ready")
        self.assertNotIn("password", repr(loaded).lower())

    def test_interrupted_work_becomes_retryable(self):
        job = setup_jobs.create_job("open-webui", "application", "Preparing Open WebUI")
        self.assertEqual(setup_jobs.recover_interrupted_jobs(), 1)
        loaded = setup_jobs.get_job(job["id"])
        self.assertEqual(loaded["status"], "failed")
        replacement = setup_jobs.create_job("open-webui", "application", "Retrying Open WebUI")
        self.assertNotEqual(replacement["id"], job["id"])


if __name__ == "__main__":
    unittest.main()

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ctl import setup_jobs
from ctl.app import _expand_batch_targets, _memory_gate_exceeded, _project_batch_memory


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

    def test_batch_is_durable_ordered_and_single_active(self):
        items = [
            {"service_id": "ollama", "role": "infrastructure", "dependencies": [],
             "sso_strategy": "machine_only", "projected_bytes": 100},
            {"service_id": "open-webui", "role": "application", "dependencies": ["ollama"],
             "sso_strategy": "native_oidc", "projected_bytes": 200},
        ]
        first = setup_jobs.create_batch(items, host_total_bytes=1000, host_baseline_bytes=100)
        duplicate = setup_jobs.create_batch(items, host_total_bytes=1000, host_baseline_bytes=100)
        self.assertEqual(first["id"], duplicate["id"])
        self.assertEqual([item["service_id"] for item in first["items"]], ["ollama", "open-webui"])
        setup_jobs.update_batch_item(first["id"], 0, status="prepared", phase="prepared",
                                     peak_bytes=125, marginal_bytes=80, gpu_peak_bytes=64)
        loaded = setup_jobs.get_batch(first["id"])
        self.assertEqual(loaded["items"][0]["marginal_bytes"], 80)
        self.assertEqual(loaded["items"][0]["gpu_peak_bytes"], 64)

    def test_interrupted_batch_pauses_and_resumes_from_persisted_item(self):
        batch = setup_jobs.create_batch([{
            "service_id": "ollama", "role": "infrastructure", "dependencies": [],
            "sso_strategy": "machine_only", "projected_bytes": 100,
        }])
        setup_jobs.update_batch(batch["id"], status="running", phase="measuring_memory", current_index=0)
        self.assertEqual(setup_jobs.recover_interrupted_batches(), 1)
        loaded = setup_jobs.get_batch(batch["id"])
        self.assertEqual(loaded["status"], "paused_interrupted")
        self.assertEqual(loaded["current_index"], 0)

    def test_dependency_expansion_is_deduplicated_and_infrastructure_first(self):
        expanded = _expand_batch_targets(["surfsense", "open-webui", "ollama"])
        ids = [item["service_id"] for item in expanded]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertLess(ids.index("ollama"), ids.index("surfsense"))
        self.assertLess(ids.index("litellm"), ids.index("open-webui"))
        first_application = next(index for index, item in enumerate(expanded) if item["role"] == "application")
        self.assertTrue(all(item["role"] == "infrastructure" for item in expanded[:first_application]))

    def test_memory_projection_uses_floor_reserve_and_shared_service_once(self):
        gib = 1024 ** 3
        items = [
            {"service_id": "ollama", "peak_bytes": 2 * gib, "projected_bytes": gib},
            {"service_id": "open-webui", "peak_bytes": 0, "projected_bytes": 0},
        ]
        projected = _project_batch_memory(items, gib)
        self.assertEqual(projected, gib + int((2 * gib + 768 * 1024 ** 2) * 1.15))
        self.assertFalse(_memory_gate_exceeded(projected, 8 * gib))
        self.assertTrue(_memory_gate_exceeded(7 * gib, 8 * gib))


if __name__ == "__main__":
    unittest.main()

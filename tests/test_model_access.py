import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ctl.app import _freellmapi_providers, _sync_freellmapi_gateway


class ModelAccessTests(unittest.TestCase):
    def make_database(self, root: Path) -> Path:
        path = root / "freeapi.db"
        connection = sqlite3.connect(path)
        connection.executescript(
            """
            CREATE TABLE api_keys (
                platform TEXT NOT NULL,
                encrypted_key TEXT NOT NULL,
                status TEXT NOT NULL,
                enabled INTEGER NOT NULL
            );
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO api_keys VALUES ('google', 'ciphertext-never-returned', 'healthy', 1);
            INSERT INTO api_keys VALUES ('groq', 'another-secret', 'error', 1);
            INSERT INTO settings VALUES ('unified_api_key', 'host-only-gateway-key');
            """
        )
        connection.commit()
        connection.close()
        return path

    def test_provider_inventory_contains_status_but_never_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            database = self.make_database(Path(directory))
            with patch("ctl.app._freellmapi_database", return_value=database):
                providers = _freellmapi_providers()
        self.assertEqual([item["name"] for item in providers], ["Google Gemini", "Groq"])
        self.assertTrue(providers[0]["healthy"])
        self.assertFalse(providers[1]["healthy"])
        self.assertNotIn("encrypted_key", providers[0])
        self.assertNotIn("ciphertext", repr(providers))

    def test_gateway_sync_writes_the_generated_key_without_returning_it(self):
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text("LITELLM_MASTER_KEY=existing\nFREE_LLMAPI_API_KEY=old\n")
            with patch("ctl.app._env_path", return_value=env_path), patch(
                "ctl.app._freellmapi_gateway_key", return_value="host-only-gateway-key"
            ):
                changed = _sync_freellmapi_gateway()
            self.assertTrue(changed)
            self.assertIn("FREE_LLMAPI_API_KEY=host-only-gateway-key", env_path.read_text())


if __name__ == "__main__":
    unittest.main()

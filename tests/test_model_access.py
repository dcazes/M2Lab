import asyncio
import io
import json
import sqlite3
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from ctl.app import (
    _freellmapi_providers,
    _sync_freellmapi_gateway,
    _validate_ollama_access,
    _validate_provider_key,
    validate_model_access,
)


class JsonResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


class ValidationRequest:
    def __init__(self, body):
        self.body = body

    async def json(self):
        return self.body


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

    def test_nvidia_validation_uses_bearer_key_without_returning_it(self):
        secret = "nvapi-test-secret"
        response = JsonResponse(json.dumps({"data": [{"id": "model-a"}]}).encode())
        with patch("ctl.app.urllib.request.urlopen", return_value=response) as urlopen:
            result = _validate_provider_key("nvidia", secret)
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), f"Bearer {secret}")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(json.loads(request.data)["max_tokens"], 1)
        self.assertEqual(result, {"status": "valid", "message": "API key accepted", "model_count": None})
        self.assertNotIn(secret, repr(result))

    def test_gemini_validation_uses_header_and_counts_models(self):
        response = JsonResponse(json.dumps({"models": [{"name": "a"}, {"name": "b"}]}).encode())
        with patch("ctl.app.urllib.request.urlopen", return_value=response) as urlopen:
            result = _validate_provider_key("gemini", "AIzaSy-secret")
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header("X-goog-api-key"), "AIzaSy-secret")
        self.assertEqual(result["status"], "valid")
        self.assertEqual(result["model_count"], 2)

    def test_provider_rejection_and_unavailability_are_safe(self):
        rejected = urllib.error.HTTPError("https://provider.invalid", 401, "secret-bearing reason", {}, None)
        with patch("ctl.app.urllib.request.urlopen", side_effect=rejected):
            invalid = _validate_provider_key("nvidia", "nvapi-secret")
        with patch("ctl.app.urllib.request.urlopen", side_effect=TimeoutError("secret-bearing timeout")):
            unavailable = _validate_provider_key("gemini", "AIzaSy-secret")
        self.assertEqual(invalid["status"], "invalid")
        self.assertEqual(unavailable["status"], "unavailable")
        self.assertNotIn("secret-bearing", repr((invalid, unavailable)))

    def test_ollama_validation_reports_models_and_unavailable(self):
        response = JsonResponse(json.dumps({"models": [{"name": "nomic-embed-text"}]}).encode())
        with patch("ctl.app.urllib.request.urlopen", return_value=response):
            available = _validate_ollama_access()
        with patch("ctl.app.urllib.request.urlopen", side_effect=OSError("offline")):
            unavailable = _validate_ollama_access()
        self.assertEqual(available["status"], "available")
        self.assertEqual(available["model_count"], 1)
        self.assertEqual(unavailable["status"], "unavailable")

    def test_validation_endpoint_checks_entered_keys_and_does_not_write_env(self):
        request = ValidationRequest({
            "NVIDIA_NIM_API_KEY": " nvapi-secret ",
            "GEMINI_API_KEY": "",
            "check_ollama": True,
        })
        with patch("ctl.app.require_trusted_request"), patch(
            "ctl.app._validate_provider_key",
            return_value={"status": "valid", "message": "API key accepted", "model_count": 4},
        ) as provider, patch(
            "ctl.app._validate_ollama_access",
            return_value={"status": "available", "message": "Ollama is reachable", "model_count": 1},
        ), patch("ctl.app._write_env_file") as write_env:
            result = asyncio.run(validate_model_access(request))
        provider.assert_called_once_with("nvidia", "nvapi-secret")
        write_env.assert_not_called()
        self.assertTrue(result["ok"])
        self.assertEqual(result["providers"]["gemini"]["status"], "not_checked")
        self.assertNotIn("nvapi-secret", repr(result))

    def test_validation_endpoint_requires_a_provider_key(self):
        request = ValidationRequest({"check_ollama": True})
        with patch("ctl.app.require_trusted_request"), self.assertRaises(HTTPException) as raised:
            asyncio.run(validate_model_access(request))
        self.assertEqual(raised.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()

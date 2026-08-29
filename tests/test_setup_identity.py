import asyncio
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from ctl.app import (
    _configure_application_sso,
    _ensure_authentik_oidc,
    _finalize_application_sso,
    _surfsense_bridge_password,
    bridge_surfsense_session,
)


class Headers:
    def __init__(self, cookies=None):
        self.cookies = cookies or []

    def get_all(self, name):
        return self.cookies if name.lower() == "set-cookie" else []


class Response(io.BytesIO):
    def __init__(self, status, payload=b"", cookies=None):
        super().__init__(payload)
        self.status = status
        self.headers = Headers(cookies)


class SetupIdentityTests(unittest.TestCase):
    def test_authentik_oidc_update_is_idempotent_and_reuses_host_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text("M2LAB_OIDC_CLIENT_ID=existing-id\nM2LAB_OIDC_CLIENT_SECRET=existing-secret\n")
            existing = [
                {"pk": "auth-flow", "designation": "authorization"},
                {"pk": "invalid-flow", "designation": "invalidation"},
                {"pk": "signing-key", "name": "default signing certificate"},
                {"pk": 7, "name": "M2Lab Open WebUI"},
                {"slug": "open_webui", "name": "Open WebUI"},
            ]

            def api(method, path, payload=None):
                if method == "GET":
                    return {"results": [{"pk": "scope-openid", "scope_name": "openid"}]}
                if path == "providers/oauth2/7/":
                    self.assertEqual(payload["client_secret"], "existing-secret")
                    return {"pk": 7}
                return {}

            with patch("ctl.app._env_path", return_value=env_path), patch(
                "ctl.app._authentik_application", return_value={"slug": "open_webui", "provider": 7}
            ), patch("ctl.app._authentik_first", side_effect=existing), patch(
                "ctl.app._authentik_api", side_effect=api
            ) as authentik_api:
                result = _ensure_authentik_oidc("open-webui", [{"matching_mode": "strict", "url": "https://app/cb"}])
            self.assertEqual(result["client_id"], "existing-id")
            self.assertFalse(any(call.args[0] == "POST" for call in authentik_api.call_args_list))
            self.assertEqual(env_path.stat().st_mode & 0o777, 0o600)

    def test_native_oidc_adapters_stage_then_enforce_login(self):
        expected = {
            "open-webui": ("ENABLE_LOGIN_FORM", "true", "false"),
            "paperless-ngx": ("PAPERLESS_DISABLE_REGULAR_LOGIN", "false", "true"),
            "actual-budget": ("ACTUAL_OPENID_ENFORCE", "false", "true"),
            "adventurelog": ("FORCE_SOCIALACCOUNT_LOGIN", "false", "true"),
        }
        for sid, (key, staged, final) in expected.items():
            with self.subTest(service=sid), tempfile.TemporaryDirectory() as directory:
                env_path = Path(directory) / ".env"
                env_path.touch()
                with patch("ctl.app._env_path", return_value=env_path), patch(
                    "ctl.app._canonical_app_url", return_value="https://app.example"
                ), patch("ctl.app._ensure_authentik_oidc", return_value={
                    "issuer": "https://auth.example/application/o/app/",
                    "client_id": "client-id", "client_secret": "host-secret",
                }):
                    _configure_application_sso(sid)
                    self.assertIn(f"{key}={staged}", env_path.read_text())
                    _finalize_application_sso(sid)
                    self.assertIn(f"{key}={final}", env_path.read_text())

    def test_open_webui_uses_the_container_reachable_discovery_document(self):
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            with patch("ctl.app._env_path", return_value=env_path), patch(
                "ctl.app._canonical_app_url", return_value="https://127.0.0.1:19456"
            ), patch("ctl.app._ensure_authentik_oidc", return_value={
                "issuer": "https://127.0.0.1:19462/application/o/open_webui/",
                "container_discovery_url": "http://host.docker.internal:19463/application/o/open_webui/.well-known/openid-configuration",
                "client_id": "client-id", "client_secret": "host-secret",
            }):
                _configure_application_sso("open-webui")
            self.assertIn(
                "OPENID_PROVIDER_URL=http://host.docker.internal:19463/application/o/open_webui/.well-known/openid-configuration",
                env_path.read_text(),
            )

    def test_surfsense_password_is_stable_and_app_scoped(self):
        with patch("ctl.app._parse_env_file", return_value={"OMNILAB_SESSION_BRIDGE_SECRET": "host-secret"}):
            first = _surfsense_bridge_password("subject-a")
            self.assertEqual(first, _surfsense_bridge_password("subject-a"))
            self.assertNotEqual(first, _surfsense_bridge_password("subject-b"))
            self.assertNotIn("subject-a", first)

    def test_surfsense_bridge_uses_no_store_same_origin_token_handoff(self):
        token = "browser-token-never-audited"
        responses = [Response(201), Response(200, json.dumps({"access_token": token}).encode())]
        with tempfile.TemporaryDirectory() as directory:
            audit_path = Path(directory) / "audit.jsonl"
            with patch("ctl.app.request_identity", return_value={
                "subject": "authentik-user", "email": "owner@example.test", "groups": ["omnilab-owners"],
            }), patch("ctl.app._surfsense_bridge_password", return_value="derived-password"), patch(
                "ctl.app._surfsense_auth_request", side_effect=responses
            ), patch("ctl.app.request_source", return_value="local"), patch(
                "ctl.app._STATE_DIR", Path(directory)
            ), patch("ctl.app._AUDIT_PATH", audit_path):
                response = asyncio.run(bridge_surfsense_session(object()))
            body = response.body.decode()
            self.assertIn("surfsense_bearer_token", body)
            self.assertIn(token, body)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertIn("nonce-", response.headers["content-security-policy"])
            self.assertNotIn(token, audit_path.read_text())
            self.assertNotIn("owner@example.test", audit_path.read_text())

    def test_surfsense_existing_unmanaged_account_pauses_for_linking(self):
        responses = [Response(409), Response(401)]
        with patch("ctl.app.request_identity", return_value={
            "subject": "subject", "email": "existing@example.test", "groups": [],
        }), patch("ctl.app._surfsense_bridge_password", return_value="derived"), patch(
            "ctl.app._surfsense_auth_request", side_effect=responses
        ), self.assertRaises(HTTPException) as raised:
            asyncio.run(bridge_surfsense_session(object()))
        self.assertEqual(raised.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()

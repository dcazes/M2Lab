import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ctl.catalog import load_catalog
from ctl import mcp_registry


class McpRegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog()

    def test_every_app_has_a_valid_manifest_after_catalog_load(self):
        mcp_registry.validate_catalog_manifests(self.catalog)
        self.assertTrue(all("mcp" in app for app in self.catalog["apps"]))

    def test_community_servers_require_a_pin(self):
        app = {"id": "unsafe", "mcp": {"kind": "community", "transport": "stdio", "tools": []}}
        with self.assertRaisesRegex(ValueError, "version pinned"):
            mcp_registry.validate_manifest(app)

    def test_risk_cannot_be_lowered(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "mcp.json"
            with patch.object(mcp_registry, "STATE_PATH", state_path):
                with self.assertRaisesRegex(ValueError, "cannot be lower"):
                    mcp_registry.update_server("paperless-ngx", {
                        "tools": {"paperless.upload": {"risk": "read"}}
                    })

    def test_overrides_never_contain_endpoint_or_headers(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "mcp.json"
            with patch.object(mcp_registry, "STATE_PATH", state_path):
                mcp_registry.update_server("litellm", {
                    "enabled": False, "endpoint": "https://evil.invalid", "headers": {"Authorization": "secret"}
                })
                raw = state_path.read_text()
                self.assertNotIn("evil.invalid", raw)
                self.assertNotIn("Authorization", raw)

    def test_absent_apps_are_unavailable(self):
        states = {app.get("service_id", ""): "absent" for app in self.catalog["apps"]}
        snapshot = mcp_registry.registry_snapshot(states)
        app_servers = [server for server in snapshot["servers"] if server["app_id"] != "omnilab"]
        self.assertTrue(all(server["state"] == "unavailable" for server in app_servers))


if __name__ == "__main__":
    unittest.main()

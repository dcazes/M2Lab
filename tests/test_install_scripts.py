import os
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class InstallScriptTests(unittest.TestCase):
    def test_launchers_are_executable_and_valid_bash(self):
        scripts = [ROOT / "install.sh", ROOT / "start.sh"]
        for script in scripts:
            self.assertTrue(os.access(script, os.X_OK), script)
        result = subprocess.run(
            ["bash", "-n", *(str(script) for script in scripts)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_installer_help_documents_safe_defaults(self):
        result = subprocess.run(
            [str(ROOT / "install.sh"), "--help"],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertIn("--dry-run", result.stdout)
        self.assertIn("--with-firewall", result.stdout)
        self.assertIn("Tailscale and application stacks are intentionally not installed", result.stdout)

    def test_installer_preserves_service_environment_ownership(self):
        source = (ROOT / "install.sh").read_text(encoding="utf-8")
        self.assertNotIn("cp .env.example", source)
        self.assertNotIn("start-all", source)
        self.assertIn("grep -q '^CTL_MCP_TOKEN=.'", source)

    def test_units_are_portable_templates(self):
        for name in (
            "homelab-ctl.service",
            "homelab-ctl-mcp.service",
            "homelab-app-mcp@.service",
        ):
            unit = (ROOT / "deploy" / name).read_text(encoding="utf-8")
            self.assertIn("@OMNILAB_ROOT@", unit)
            self.assertNotIn("Desktop/Programs/HomeServer", unit)

    def test_committed_dashboard_bundle_is_complete(self):
        index = ROOT / "ctl-web-next" / "dist" / "index.html"
        self.assertTrue(index.is_file())
        html = index.read_text(encoding="utf-8")
        for marker in ('src="/assets/', 'href="/assets/'):
            start = html.find(marker)
            self.assertNotEqual(start, -1, marker)
            asset = html[start + len(marker):].split('"', 1)[0]
            self.assertTrue((index.parent / "assets" / asset).is_file(), asset)


if __name__ == "__main__":
    unittest.main()

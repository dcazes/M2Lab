"""Tailscale is optional for first-run (switch-gated by settings/env)."""
import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ctl.registry import SETTINGS, tailscale_required


class TailscaleRequiredSwitchTests(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("OMNILAB_REQUIRE_TAILSCALE", None)

    def test_default_is_permissive(self):
        self.assertFalse(tailscale_required())

    def test_env_true_wins(self):
        os.environ["OMNILAB_REQUIRE_TAILSCALE"] = "true"
        self.assertTrue(tailscale_required())

    def test_env_false_overrides_yaml(self):
        with patch.dict(SETTINGS, {"tailscale_required": True}):
            self.assertTrue(tailscale_required())
            os.environ["OMNILAB_REQUIRE_TAILSCALE"] = "false"
            self.assertFalse(tailscale_required())


class ExternalUrlModeTests(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("OMNILAB_REQUIRE_TAILSCALE", None)

    def test_loopback_when_not_required(self):
        os.environ["OMNILAB_REQUIRE_TAILSCALE"] = "false"
        from ctl.identity import external_url
        self.assertEqual(external_url("authentik"), "http://127.0.0.1:9001/")

    def test_tailnet_when_required(self):
        os.environ["OMNILAB_REQUIRE_TAILSCALE"] = "true"
        from ctl.identity import external_url
        self.assertTrue(external_url("authentik").startswith(SETTINGS["tailnet_base"]))


class FoundationPreflightTests(unittest.TestCase):
    """Preflight must not gate on Tailscale when it isn't required."""

    def tearDown(self):
        os.environ.pop("OMNILAB_REQUIRE_TAILSCALE", None)

    def _run(self, required):
        os.environ["OMNILAB_REQUIRE_TAILSCALE"] = "true" if required else "false"
        with patch("ctl.app.update_job"), \
             patch("ctl.app._docker_available", return_value=True), \
             patch("ctl.app.DLI") as dli, \
             patch("ctl.app._tailscale_snapshot", return_value={
                 "installed": False, "connected": False, "hostname": None, "serve_ports": [],
             }):
            dli.networks.get.return_value = object()
            return asyncio.run(_run_preflight("job1"))

    def test_no_tailscale_no_block_when_not_required(self):
        # Should complete without raising.
        self._run(required=False)

    def test_tailscale_missing_blocks_when_required(self):
        from ctl import app
        from fastapi import HTTPException
        os.environ["OMNILAB_REQUIRE_TAILSCALE"] = "true"
        with patch("ctl.app.update_job"), \
             patch("ctl.app._docker_available", return_value=True), \
             patch("ctl.app.DLI") as dli, \
             patch("ctl.app._tailscale_snapshot", return_value={
                 "installed": False, "connected": False, "hostname": None, "serve_ports": [],
             }):
            dli.networks.get.return_value = object()
            with self.assertRaises(RuntimeError):
                asyncio.run(_run_preflight("job2"))


async def _run_preflight(job_id):
    from ctl import app
    await app._foundation_preflight(job_id)


if __name__ == "__main__":
    unittest.main()

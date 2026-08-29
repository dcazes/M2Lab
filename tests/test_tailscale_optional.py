"""Tailscale is the required private browser entrypoint."""
import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ctl.registry import SETTINGS, tailscale_required


class TailscaleRequiredTests(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("OMNILAB_REQUIRE_TAILSCALE", None)

    def test_tailscale_is_always_required(self):
        self.assertTrue(tailscale_required())

    def test_env_true_keeps_requirement_enabled(self):
        os.environ["OMNILAB_REQUIRE_TAILSCALE"] = "true"
        self.assertTrue(tailscale_required())

    def test_env_false_cannot_disable_requirement(self):
        with patch.dict(SETTINGS, {"tailscale_required": True}):
            self.assertTrue(tailscale_required())
            os.environ["OMNILAB_REQUIRE_TAILSCALE"] = "false"
            self.assertTrue(tailscale_required())


class ExternalUrlTests(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("OMNILAB_REQUIRE_TAILSCALE", None)

    def test_loopback_override_cannot_expose_a_browser_url(self):
        os.environ["OMNILAB_REQUIRE_TAILSCALE"] = "false"
        from ctl.identity import external_url
        self.assertTrue(external_url("authentik").startswith(SETTINGS["tailnet_base"]))

    def test_tailnet_when_required(self):
        os.environ["OMNILAB_REQUIRE_TAILSCALE"] = "true"
        from ctl.identity import external_url
        self.assertTrue(external_url("authentik").startswith(SETTINGS["tailnet_base"]))


class FoundationPreflightTests(unittest.TestCase):
    """Preflight always blocks when the required Tailscale session is absent."""

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

    def test_no_tailscale_blocks_even_with_legacy_false_override(self):
        with self.assertRaises(RuntimeError):
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

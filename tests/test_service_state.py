import unittest
from unittest.mock import patch

from ctl import app


class FakeContainer:
    def __init__(self, name, state, health=None, service="web"):
        health_value = {"Status": health} if health else None
        self.attrs = {"Name": name, "State": {"Status": state, "Health": health_value}}
        self.labels = {"com.docker.compose.service": service}


class ServiceStateTests(unittest.TestCase):
    service = {"project": "example"}

    def state(self, *containers):
        with patch.object(app, "project_containers", return_value=list(containers)):
            return app.svc_state(self.service)["overall"]

    def test_restart_loop_is_degraded(self):
        self.assertEqual(self.state(FakeContainer("web", "restarting", "unhealthy")), "degraded")

    def test_starting_health_is_not_ready(self):
        self.assertEqual(self.state(FakeContainer("web", "running", "starting")), "degraded")

    def test_all_required_containers_must_be_healthy(self):
        self.assertEqual(self.state(
            FakeContainer("web", "running", "healthy"),
            FakeContainer("db", "running", "unhealthy", "db"),
        ), "degraded")
        self.assertEqual(self.state(
            FakeContainer("web", "running", "healthy"),
            FakeContainer("db", "running", "healthy", "db"),
        ), "running")


if __name__ == "__main__":
    unittest.main()

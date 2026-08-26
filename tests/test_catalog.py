import unittest

from ctl.catalog import discover_capabilities, discover_workflows, load_catalog, policy_decision


class CatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog()

    def test_profile_references_resolve(self):
        app_ids = {app["id"] for app in self.catalog["apps"]}
        for profile in self.catalog["profiles"]:
            self.assertTrue(profile["apps"], profile["id"])
            self.assertTrue(set(profile["apps"]).issubset(app_ids), profile["id"])

    def test_service_references_resolve(self):
        import yaml
        from ctl.registry import ROOT

        registered = {service["id"] for service in yaml.safe_load((ROOT / "services.yaml").read_text())["services"]}
        for app in self.catalog["apps"]:
            if app.get("service_id"):
                self.assertIn(app["service_id"], registered, app["id"])

    def test_service_presentation_and_lifecycle_metadata_are_valid(self):
        import yaml
        from ctl.registry import ROOT

        services = yaml.safe_load((ROOT / "services.yaml").read_text())["services"]
        roles = {"application", "infrastructure"}
        visibility = {"user", "system", "hidden"}
        lifecycles = {"managed", "always_on", "dependency"}
        for service in services:
            role = service.get("role", "application")
            surface = service.get("visibility", "user")
            lifecycle = service.get("lifecycle", "managed")
            self.assertIn(role, roles, service["id"])
            self.assertIn(surface, visibility, service["id"])
            self.assertIn(lifecycle, lifecycles, service["id"])
            if role == "infrastructure":
                self.assertNotEqual(surface, "user", service["id"])

        by_id = {service["id"]: service for service in services}
        for service_id in ("authentik", "sso-ingress"):
            self.assertEqual(by_id[service_id]["role"], "infrastructure")
            self.assertEqual(by_id[service_id]["visibility"], "system")
            self.assertEqual(by_id[service_id]["lifecycle"], "always_on")
        for service_id in ("ollama", "litellm", "freellmapi", "firecrawl"):
            self.assertNotEqual(by_id[service_id].get("lifecycle", "managed"), "always_on")

    def test_authentik_custom_blueprint_does_not_hide_bundled_blueprints(self):
        import yaml
        from ctl.registry import ROOT

        compose = yaml.safe_load((ROOT / "authentik" / "docker-compose.yml").read_text())
        for service_id in ("server", "worker"):
            mounts = compose["services"][service_id]["volumes"]
            self.assertIn("./blueprints/omnilab.yaml:/blueprints/omnilab.yaml:ro", mounts)
            self.assertNotIn("./blueprints:/blueprints:ro", mounts)

    def test_install_dependencies_resolve_to_registered_apps(self):
        app_ids = {app["id"] for app in self.catalog["apps"] if app.get("service_id")}
        for app in self.catalog["apps"]:
            self.assertTrue(set(app.get("dependencies", [])).issubset(app_ids), app["id"])

    def test_workflow_references_resolve(self):
        app_ids = {app["id"] for app in self.catalog["apps"]}
        for workflow in self.catalog["workflows"]:
            self.assertTrue(set(workflow["apps"]).issubset(app_ids), workflow["id"])
        matches = discover_workflows("receipt budget", self.catalog)
        self.assertIn("receipt-to-budget", {workflow["id"] for workflow in matches})

    def test_receipt_discovery_is_progressive(self):
        matches = discover_capabilities("archive receipts and prepare budget transactions", self.catalog)
        matched_apps = {match["app_id"] for match in matches}
        self.assertIn("actual-budget", matched_apps)
        self.assertIn("paperless-ngx", matched_apps)
        self.assertLessEqual(len(matches), 12)

    def test_policy_defaults_safe(self):
        self.assertEqual(policy_decision("read")["decision"], "allow")
        self.assertEqual(policy_decision("write")["decision"], "require_approval")
        self.assertEqual(policy_decision("privileged")["decision"], "deny")
        self.assertEqual(policy_decision("unexpected")["decision"], "deny")


if __name__ == "__main__":
    unittest.main()

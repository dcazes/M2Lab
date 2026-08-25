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

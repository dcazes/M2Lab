import unittest

from ctl.initiate import prepare_environment


class InitiateTests(unittest.TestCase):
    def token(self, length: int) -> str:
        return f"generated-{length}"

    def test_litellm_generates_coupled_database_credentials(self):
        values, changed = prepare_environment(
            "litellm",
            {},
            {
                "LITELLM_MASTER_KEY": "change_me",
                "LITELLM_MCP_KEY": "change_me",
                "POSTGRES_PASSWORD": "change_me",
                "DATABASE_URL": "postgresql://litellm:change_me@litellm-db:5432/litellm",
            },
            token_factory=self.token,
        )
        self.assertEqual(values["POSTGRES_PASSWORD"], "generated-24")
        self.assertIn("generated-24", values["DATABASE_URL"])
        self.assertIn("DATABASE_URL", changed)

    def test_existing_credentials_are_preserved(self):
        values, changed = prepare_environment(
            "firecrawl",
            {"TEST_API_KEY": "existing-key", "POSTGRES_PASSWORD": "existing-password"},
            {"POSTGRES_USER": "postgres", "POSTGRES_DB": "postgres"},
            token_factory=self.token,
        )
        self.assertEqual(values["TEST_API_KEY"], "existing-key")
        self.assertEqual(values["POSTGRES_PASSWORD"], "existing-password")
        self.assertEqual(changed, [])

    def test_existing_stack_does_not_rotate_placeholder(self):
        values, changed = prepare_environment(
            "firecrawl",
            {"TEST_API_KEY": "", "POSTGRES_PASSWORD": "postgres"},
            {},
            replace_placeholders=False,
            token_factory=self.token,
        )
        self.assertEqual(values["POSTGRES_PASSWORD"], "postgres")
        self.assertEqual(values["TEST_API_KEY"], "generated-32")
        self.assertEqual(changed, ["TEST_API_KEY"])

    def test_nextcloud_bootstraps_shared_identity(self):
        values, changed = prepare_environment(
            "nextcloud",
            {},
            {"NEXTCLOUD_DBPASSWORD": "changeme"},
            identity={"email": "omnilab@example.invalid", "password": "shared-password"},
            token_factory=self.token,
        )
        self.assertEqual(values["NEXTCLOUD_ADMIN_USER"], "omnilab@example.invalid")
        self.assertEqual(values["NEXTCLOUD_ADMIN_PASSWORD"], "shared-password")
        self.assertIn("NEXTCLOUD_DBPASSWORD", changed)

    def test_surfsense_receives_password_without_exposing_identity_email(self):
        values, _ = prepare_environment(
            "surfsense",
            {},
            {"SECRET_KEY": "change_me"},
            identity={"email": "omnilab@example.invalid", "password": "shared-password"},
            token_factory=self.token,
        )
        self.assertEqual(values["ZERO_ADMIN_PASSWORD"], "shared-password")
        self.assertNotIn("OMNILAB_IDENTITY_EMAIL", values)

    def test_surfsense_generates_required_infrastructure_secrets(self):
        values, changed = prepare_environment(
            "surfsense", {}, {}, token_factory=self.token,
        )
        for key in ("SECRET_KEY", "DB_PASSWORD", "SEARXNG_SECRET", "OPENSANDBOX_API_KEY", "ZERO_ADMIN_PASSWORD"):
            self.assertEqual(values[key], "generated-24" if key != "SECRET_KEY" else "generated-32")
            self.assertIn(key, changed)

    def test_new_core_placeholders_are_replaced(self):
        freellm, _ = prepare_environment(
            "freellmapi",
            {},
            {"ENCRYPTION_KEY": "your_64_char_hex_key"},
            token_factory=self.token,
        )
        webui, _ = prepare_environment(
            "open-webui",
            {},
            {"WEBUI_SECRET_KEY": "your_generated_secret_key_here"},
            token_factory=self.token,
        )
        self.assertEqual(freellm["ENCRYPTION_KEY"], "generated-32")
        self.assertEqual(webui["WEBUI_SECRET_KEY"], "generated-32")


if __name__ == "__main__":
    unittest.main()

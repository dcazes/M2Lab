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


if __name__ == "__main__":
    unittest.main()

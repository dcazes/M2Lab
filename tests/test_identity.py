import unittest

from ctl.identity import APPS, GATE, MACHINE, NATIVE, app_inventory, status
from ctl.registry import SERVICES


class IdentityTests(unittest.TestCase):
    def test_every_identity_target_is_a_registered_service(self):
        registered = {service["id"] for service in SERVICES}
        self.assertTrue({item["id"] for item in APPS}.issubset(registered))

    def test_inventory_never_contains_credentials(self):
        for item in app_inventory({}):
            serialized = repr(item).lower()
            self.assertNotIn("secret", serialized)
            self.assertNotIn("password", serialized)

    def test_modes_are_explicit(self):
        result = status({})
        self.assertEqual(result["apps"][NATIVE], 10)
        self.assertEqual(result["apps"][GATE], 4)
        self.assertEqual(result["apps"][MACHINE], 1)


if __name__ == "__main__":
    unittest.main()

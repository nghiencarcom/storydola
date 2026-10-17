import tempfile
import unittest
from pathlib import Path

from store import TaskStore


class UserApiKeyLimitTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = TaskStore(str(Path(self.temp_dir.name) / "tasks.db"))

    def tearDown(self):
        self.store._conn.close()
        self.temp_dir.cleanup()

    def test_user_can_have_only_one_active_key(self):
        self.store.create_key("First", owner_id="owner-a")
        with self.assertRaisesRegex(ValueError, "chỉ được có 1 API key đang hoạt động"):
            self.store.create_key("Second", owner_id="owner-a")

        # The limit is per owner, not a global limit for the whole Gateway.
        second_owner_key = self.store.create_key("Other owner", owner_id="owner-b")
        self.assertTrue(second_owner_key["key"])

    def test_revoked_key_is_not_recreated_on_every_list_request(self):
        first_key = self.store.ensure_user_key("owner-a")
        self.assertIsNotNone(first_key)

        key_id = self.store.hash_api_key(first_key["key"])
        self.assertTrue(self.store.delete_user_key("owner-a", key_id))
        self.assertIsNone(self.store.ensure_user_key("owner-a"))

        replacement = self.store.create_key("Replacement", owner_id="owner-a")
        self.assertTrue(replacement["key"])
        active_keys = [key for key in self.store.list_user_keys("owner-a") if key["enabled"]]
        self.assertEqual(len(active_keys), 1)


if __name__ == "__main__":
    unittest.main()

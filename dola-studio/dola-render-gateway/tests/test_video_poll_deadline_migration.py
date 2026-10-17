import json
import os
import tempfile
import time
import unittest

from store import TaskStore


class VideoPollDeadlineMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = TaskStore(os.path.join(self.temp_dir.name, "tasks.db"))
        self.addCleanup(self.store._conn.close)
        self.addCleanup(self.temp_dir.cleanup)
        created_at = time.time()
        self.store.create_many(
            [
                {
                    "id": task_id,
                    "model": "seedance-2.5",
                    "prompt": "test prompt",
                    "ratio": "9:16",
                    "duration": 5,
                    "created_at": created_at,
                }
                for task_id in ("active", "recent-timeout", "old-timeout")
            ]
        )
        now = time.time()
        self.old_deadlines = {
            "active": now + 60,
            "recent-timeout": now - 120,
            "old-timeout": now - 900,
        }
        for task_id, deadline in self.old_deadlines.items():
            status = "processing" if task_id == "active" else "failed"
            failure_code = None if status == "processing" else "RENDER_TIMEOUT"
            self.store._conn.execute(
                "UPDATE tasks SET status=?,account=?,conversation_id=?,deadline_at=?,"
                "failure_code=?,error=?,timings_json='{}' WHERE id=?",
                (
                    status,
                    "profile-a",
                    "conversation-" + task_id,
                    deadline,
                    failure_code,
                    "Dola vẫn đang tạo video sau 72s",
                    task_id,
                ),
            )
        self.store._conn.commit()

    def test_extends_old_deadlines_once_and_recovers_recent_timeout(self):
        migrated = self.store.migrate_video_poll_deadlines(1200, 1800)

        self.assertCountEqual(migrated, ["active", "recent-timeout"])
        for task_id in ("active", "recent-timeout"):
            old_deadline = self.old_deadlines[task_id]
            row = self.store.get(task_id)
            self.assertAlmostEqual(row["deadline_at"], old_deadline + 600, delta=0.01)
            timings = json.loads(row["timings_json"])
            self.assertEqual(timings["conversation_poll_max_wait_sec"], 1800)
        old_timeout = self.store.get("old-timeout")
        self.assertEqual(old_timeout["deadline_at"], self.old_deadlines["old-timeout"])
        self.assertEqual(json.loads(old_timeout["timings_json"]), {})

        self.assertEqual(self.store.migrate_video_poll_deadlines(1200, 1800), [])
        self.assertEqual(self.store.get("active")["deadline_at"], self.old_deadlines["active"] + 600)
        self.assertEqual(
            [row["id"] for row in self.store.recoverable_failed_poll_tasks()],
            ["recent-timeout"],
        )


if __name__ == "__main__":
    unittest.main()

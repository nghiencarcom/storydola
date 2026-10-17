import os
import tempfile
import unittest

from store import TaskStore


class TaskQueueQueryTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = TaskStore(os.path.join(self.temp_dir.name, "tasks.db"))
        self.addCleanup(self.store._conn.close)
        self.addCleanup(self.temp_dir.cleanup)

    @staticmethod
    def task(task_id, created_at):
        return {
            "id": task_id,
            "model": "seedance-2.5",
            "prompt": "test prompt",
            "ratio": "9:16",
            "duration": 5,
            "created_at": created_at,
        }

    def test_owner_queue_is_filtered_sorted_and_projected(self):
        owner_a = "a" * 64
        owner_b = "b" * 64
        self.store.create_many(
            [self.task("a-old", 100), self.task("a-new", 200)],
            owner_id=owner_a,
        )
        self.store.create_many([self.task("b-task", 300)], owner_id=owner_b)

        rows = self.store.recent_queue_tasks(limit=500, owner_id=owner_a)

        self.assertEqual([row["id"] for row in rows], ["a-new", "a-old"])
        self.assertEqual(self.store.count_tasks(owner_id=owner_a), 2)
        self.assertNotIn("api_key_hash", rows[0])
        self.assertEqual(
            {item["owner_id"]: item["count"] for item in self.store.task_owner_summaries()},
            {owner_a: 2, owner_b: 1},
        )

    def test_owner_queue_uses_owner_creation_index(self):
        owner_id = "c" * 64
        plan = self.store._conn.execute(
            "EXPLAIN QUERY PLAN SELECT id FROM tasks WHERE owner_id=? "
            "ORDER BY created_at DESC, id DESC LIMIT 500",
            (owner_id,),
        ).fetchall()

        self.assertTrue(any("idx_tasks_owner_created_id" in row[3] for row in plan), plan)


if __name__ == "__main__":
    unittest.main()

import ast
import asyncio
import time
import unittest
import uuid
from pathlib import Path


class LoginJobCollisionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        tree = ast.parse((Path(__file__).parents[1] / "server.py").read_text())
        names = {
            "_is_active_job",
            "_login_job_is_active",
            "_new_login_job",
            "_profile_sync_job_is_current",
            "_cancel_profile_sync_for_login",
            "_start_profile_sync",
        }
        functions = [
            node for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name in names
        ]
        self.jobs = {}
        self.sync_tasks = {}
        scope = {
            "asyncio": asyncio,
            "time": time,
            "uuid": uuid,
            "JOBS": self.jobs,
            "LOGIN_TASKS": {},
            "PROFILE_SYNC_TASKS": self.sync_tasks,
            "ACTIVE_LOGIN_JOB_STATUSES": {"queued", "running"},
        }
        exec(compile(ast.Module(body=functions, type_ignores=[]), "server.py", "exec"), scope)
        self.scope = scope

    async def test_login_job_blocks_close_sync_before_task_creation(self):
        self.jobs["haicutene"] = {
            "kind": "relogin",
            "status": "queued",
            "id": "login-job",
        }
        self.assertIsNone(self.scope["_start_profile_sync"]("haicutene", {}))
        self.assertEqual(self.jobs["haicutene"]["id"], "login-job")
        self.assertEqual(self.sync_tasks, {})

    async def test_close_sync_reserves_job_slot_before_coroutine_runs(self):
        async def fake_sync(name, session, sync_id):
            del name, session, sync_id

        self.scope["_run_profile_sync"] = fake_sync
        task = self.scope["_start_profile_sync"]("haicutene", {})
        self.assertIsNotNone(task)
        self.assertEqual(self.jobs["haicutene"]["kind"], "profile-sync")
        self.assertEqual(self.jobs["haicutene"]["status"], "queued")
        self.assertTrue(self.jobs["haicutene"]["id"])
        await task

    async def test_login_cancels_and_removes_active_close_sync(self):
        started = asyncio.Event()

        async def worker():
            started.set()
            await asyncio.Event().wait()

        task = asyncio.create_task(worker())
        self.sync_tasks["haicutene"] = task
        self.jobs["haicutene"] = {
            "kind": "profile-sync",
            "status": "running",
            "id": "sync-job",
        }
        await started.wait()
        await self.scope["_cancel_profile_sync_for_login"]("haicutene")
        self.assertTrue(task.cancelled())
        self.assertNotIn("haicutene", self.jobs)


if __name__ == "__main__":
    unittest.main()

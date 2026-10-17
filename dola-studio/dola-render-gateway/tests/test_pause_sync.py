import ast
import asyncio
import time
import unittest
from unittest.mock import MagicMock
from pathlib import Path
from fastapi import HTTPException


class PauseSyncTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        tree = ast.parse((Path(__file__).parents[1] / "server.py").read_text())
        function = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "pause_profile_sync")
        function.decorator_list = []
        self.jobs = {"test": {"kind": "profile-sync", "status": "running", "id": "one"}}
        self.tasks = {}
        scope = dict(asyncio=asyncio, time=time, JOBS=self.jobs,
                     PROFILE_SYNC_TASKS=self.tasks, HTTPException=HTTPException,
                     Header=lambda **kwargs: None, _admin_auth=lambda key: None)
        exec(compile(ast.Module(body=[function], type_ignores=[]), "server.py", "exec"), scope)
        self.pause = scope["pause_profile_sync"]

    async def test_pause_waits_for_worker_cleanup_and_is_repeatable(self):
        started = asyncio.Event()
        cleaned = asyncio.Event()
        async def worker():
            try:
                started.set()
                await asyncio.Event().wait()
            finally:
                cleaned.set()
        task = asyncio.create_task(worker())
        self.tasks["test"] = task
        await started.wait()
        await self.pause("test")
        self.assertTrue(task.cancelled())
        self.assertTrue(cleaned.is_set())
        self.assertEqual(self.jobs["test"]["status"], "paused")
        self.assertEqual(await self.pause("test"), {"ok": True, "status": "paused"})

    async def test_does_not_cancel_login_jobs(self):
        self.jobs["test"]["kind"] = "add"
        with self.assertRaises(HTTPException) as error:
            await self.pause("test")
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.jobs["test"]["status"], "running")


class PauseLoginTests(PauseSyncTests):
    def setUp(self):
        tree = ast.parse((Path(__file__).parents[1] / "server.py").read_text())
        function = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "pause_account_login")
        function.decorator_list = []
        self.jobs = {"test": {"kind": "add", "status": "running"}}
        self.tasks = {}
        self.pool = MagicMock()
        scope = dict(asyncio=asyncio, time=time, JOBS=self.jobs,
                     LOGIN_TASKS=self.tasks, pool=self.pool, HTTPException=HTTPException,
                     Header=lambda **kwargs: None, _admin_auth=lambda key: None)
        exec(compile(ast.Module(body=[function], type_ignores=[]), "server.py", "exec"), scope)
        self.pause = scope["pause_account_login"]

    async def test_does_not_cancel_login_jobs(self):
        # The login pause route must not cancel a session-sync job.
        self.jobs["test"]["kind"] = "profile-sync"
        with self.assertRaises(HTTPException) as error:
            await self.pause("test")
        self.assertEqual(error.exception.status_code, 409)
        self.pool.set_scheduling.assert_not_called()

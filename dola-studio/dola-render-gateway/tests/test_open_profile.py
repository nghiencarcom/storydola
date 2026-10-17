"""Exercise the real profile opener without initializing production stores."""
import ast
import asyncio
from pathlib import Path
import threading
import unittest
from unittest.mock import AsyncMock, MagicMock


class OpenProfileTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        tree = ast.parse((Path(__file__).parents[1] / "server.py").read_text())
        function = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef)
                        and n.name == "_open_account_profile")
        self.lock = asyncio.Lock()
        self.pool = MagicMock()
        self.pool.account_is_busy.return_value = False
        self.pool.account_lock.return_value = self.lock
        self.playwright = MagicMock()
        self.playwright.return_value.start = AsyncMock(side_effect=RuntimeError("launch failed"))
        scope = dict(asyncio=asyncio, OPEN_PROFILE_GUARD=asyncio.Lock(),
                     OPEN_PROFILE_SESSIONS={}, JOBS={}, pool=self.pool,
                     async_playwright=self.playwright)
        exec(compile(ast.Module(body=[function], type_ignores=[]), "server.py", "exec"), scope)
        self.open_profile = scope["_open_account_profile"]

    async def test_proxy_failure_releases_lock_and_allows_retry(self):
        self.pool.proxy_for_account.side_effect = ValueError("proxy unavailable")
        for _ in range(2):
            with self.assertRaisesRegex(ValueError, "proxy unavailable"):
                await self.open_profile("test-profile")
            self.assertFalse(self.lock.locked())

    async def test_gateway_loop_remains_responsive_during_proxy_wait(self):
        entered, release = threading.Event(), threading.Event()

        def slow_proxy(_):
            entered.set()
            release.wait(2)

        self.pool.proxy_for_account.side_effect = slow_proxy
        task = asyncio.create_task(self.open_profile("test-profile"))
        try:
            for _ in range(100):
                if entered.is_set():
                    break
                await asyncio.sleep(0.005)
            self.assertTrue(entered.is_set())
            self.assertFalse(task.done(), "Proxy preparation blocked the event loop")
            self.assertTrue(self.lock.locked())
        finally:
            release.set()
            with self.assertRaisesRegex(RuntimeError, "launch failed"):
                await task
        self.assertFalse(self.lock.locked())

    async def test_cancellation_releases_lock(self):
        self.pool.proxy_for_account.side_effect = asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            await self.open_profile("test-profile")
        self.assertFalse(self.lock.locked())

import asyncio
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import browser_pool


class FairSchedulingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        for index in range(21):
            (root / "accounts" / f"p{index:02}").mkdir(parents=True)
        self.pool = browser_pool.BrowserPool(
            accounts_dir=root / "accounts", db_path=root / "pool.db",
            max_concurrency=20,
        )
        self.addCleanup(self.pool._conn.close)
        self.pool.list_accounts()
        for target, value in [("SUBMISSION_INTERVAL_SEC", 0)]:
            patcher = patch.object(browser_pool.config, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        proxy = patch.object(self.pool, "proxy_for_account", return_value=None)
        proxy.start()
        self.addCleanup(proxy.stop)

    async def test_completed_counts_stay_balanced(self):
        selected = []

        async def generate(account, *args, **kwargs):
            selected.append(account)
            return {"conversation_id": str(len(selected))}

        with patch.object(browser_pool, "generate_video", side_effect=generate):
            for _ in range(25):
                await self.pool._generate_video_once("test")
        counts = [a["used_today"] for a in self.pool.list_accounts()]
        self.assertLessEqual(max(counts) - min(counts), 1)
        self.assertEqual(len(set(selected[:21])), 21)

    async def test_provider_busy_recovery_skips_profiles_already_tried(self):
        selected = []

        async def generate(account, *args, **kwargs):
            del args, kwargs
            selected.append(account)
            return {"conversation_id": "conversation-next"}

        excluded = {f"p{index:02}" for index in range(20)}
        with patch.object(browser_pool, "generate_video", side_effect=generate):
            await self.pool._generate_video_once(
                "test", excluded_accounts=excluded
            )

        self.assertEqual(selected, ["p20"])

    async def test_twenty_distinct_profiles_can_run_together(self):
        started = []
        full = asyncio.Event()
        release = asyncio.Event()

        async def generate(account, *args, **kwargs):
            started.append(account)
            if len(started) == 20:
                full.set()
            await release.wait()
            return {"conversation_id": account}

        with patch.object(browser_pool, "generate_video", side_effect=generate):
            jobs = [asyncio.create_task(self.pool._generate_video_once("test")) for _ in range(21)]
            try:
                await asyncio.wait_for(full.wait(), 5)
                self.assertEqual(len(started), 20)
                self.assertEqual(len(set(started)), 20)
            finally:
                release.set()
                await asyncio.gather(*jobs)

    async def test_profile_startup_is_not_held_by_provider_submission_interval(self):
        started = []
        submitted_at = []
        profiles_ready = asyncio.Event()

        async def generate(account, *args, **kwargs):
            del args
            started.append(account)
            if len(started) == 3:
                profiles_ready.set()
            await profiles_ready.wait()
            await kwargs["before_submission"]()
            submitted_at.append(time.monotonic())
            return {"conversation_id": f"conversation-{account}"}

        # A recent send should delay only the provider-submit callback. All
        # three tasks must have selected and opened a profile before that wait.
        self.pool._last_submission_at = time.monotonic()
        with patch.object(browser_pool.config, "SUBMISSION_INTERVAL_SEC", 0.15), \
             patch.object(browser_pool, "generate_video", side_effect=generate):
            jobs = [
                asyncio.create_task(self.pool._generate_video_once("test"))
                for _ in range(3)
            ]
            try:
                await asyncio.wait_for(profiles_ready.wait(), 0.25)
                results = await asyncio.wait_for(asyncio.gather(*jobs), 2)
            finally:
                for job in jobs:
                    if not job.done():
                        job.cancel()
                await asyncio.gather(*jobs, return_exceptions=True)

        self.assertEqual(len(started), 3)
        self.assertEqual(len(set(started)), 3)
        self.assertEqual(len(results), 3)
        self.assertTrue(all(
            later - earlier >= 0.14
            for earlier, later in zip(submitted_at, submitted_at[1:])
        ))

    async def test_proxy_usage_completes_one_cycle_before_repeating(self):
        """The proxy tie-breaker uses all 15 proxies before a repeat."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            account_names = [f"proxy-account-{index:02d}" for index in range(30)]
            for name in account_names:
                (root / "accounts" / name).mkdir(parents=True)
            pool = browser_pool.BrowserPool(
                accounts_dir=root / "accounts", db_path=root / "pool.db",
                max_concurrency=20,
            )
            self.addCleanup(pool._conn.close)
            self.addCleanup(pool.proxy_manager._conn.close)
            pool.list_accounts()
            proxy_ids = []
            for index in range(15):
                proxy = pool.proxy_manager.create_or_update({
                    "name": f"Proxy {index + 1}",
                    "protocol": "HTTP",
                    "mode": "rotating",
                    "host": f"198.51.100.{index + 1}",
                    "port": 18080 + index,
                })
                proxy_ids.append(proxy["id"])
            pool.proxy_manager.assign_evenly(account_names, proxy_ids)

            selected_accounts = []

            async def generate(account, *args, **kwargs):
                del args, kwargs
                selected_accounts.append(account)
                return {"conversation_id": f"conversation-{len(selected_accounts)}"}

            with patch.object(pool, "proxy_for_account", return_value=None), \
                 patch.object(browser_pool, "generate_video", side_effect=generate), \
                 patch.object(browser_pool.config, "SUBMISSION_INTERVAL_SEC", 0):
                for _ in range(30):
                    await pool._generate_video_once("test")

            selected_proxy_ids = [pool._meta(account)["proxy_id"] for account in selected_accounts]
            self.assertEqual(len(set(selected_proxy_ids[:15])), 15)
            self.assertEqual(set(selected_proxy_ids[:15]), set(proxy_ids))
            self.assertEqual(len(set(selected_proxy_ids[15:30])), 15)
            rows = pool._conn.execute(
                "SELECT proxy_id, dispatches FROM proxy_usage WHERE day=?",
                (browser_pool._usage_day(),),
            ).fetchall()
            self.assertEqual(
                {row["proxy_id"]: row["dispatches"] for row in rows},
                {proxy_id: 2 for proxy_id in proxy_ids},
            )

    async def test_batch_prefers_lowest_accounts_and_avoids_active_proxy_reuse(self):
        """A concurrent batch chooses low-count profiles on distinct proxies."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            account_names = [f"batch-account-{index:02d}" for index in range(10)]
            for name in account_names:
                (root / "accounts" / name).mkdir(parents=True)
            pool = browser_pool.BrowserPool(
                accounts_dir=root / "accounts", db_path=root / "pool.db",
                max_concurrency=5,
            )
            self.addCleanup(pool._conn.close)
            self.addCleanup(pool.proxy_manager._conn.close)
            pool.list_accounts()
            proxy_ids = []
            for index in range(5):
                proxy = pool.proxy_manager.create_or_update({
                    "name": f"Batch Proxy {index + 1}",
                    "protocol": "HTTP",
                    "mode": "rotating",
                    "host": f"192.0.2.{index + 1}",
                    "port": 20080 + index,
                })
                proxy_ids.append(proxy["id"])
            pool.proxy_manager.assign_evenly(account_names, proxy_ids)

            day = browser_pool._usage_day()
            pool._conn.executemany(
                "INSERT INTO usage(account, day, used) VALUES (?,?,?)",
                [(name, day, 0 if index < 5 else 5) for index, name in enumerate(account_names)],
            )
            # Make the first proxy historically lighter.  Account quota must
            # still win, so the other four low-count accounts should be used
            # before the second profile on the first proxy.
            pool._conn.executemany(
                "INSERT INTO proxy_usage(proxy_id, day, dispatches, last_used_at) VALUES (?,?,?,0)",
                [(proxy_id, day, index * 100) for index, proxy_id in enumerate(proxy_ids)],
            )
            pool._conn.commit()

            selected_accounts = []
            all_started = asyncio.Event()
            release = asyncio.Event()

            async def generate(account, *args, **kwargs):
                del args, kwargs
                selected_accounts.append(account)
                if len(selected_accounts) == 5:
                    all_started.set()
                await release.wait()
                return {"conversation_id": f"batch-{len(selected_accounts)}-{account}"}

            with patch.object(pool, "proxy_for_account", return_value=None), \
                 patch.object(browser_pool, "generate_video", side_effect=generate), \
                 patch.object(browser_pool.config, "SUBMISSION_INTERVAL_SEC", 0):
                jobs = [
                    asyncio.create_task(pool._generate_video_once("test"))
                    for _ in range(5)
                ]
                try:
                    await asyncio.wait_for(all_started.wait(), 5)
                    selected_proxy_ids = [pool._meta(account)["proxy_id"] for account in selected_accounts]
                    self.assertEqual(set(selected_accounts), set(account_names[:5]))
                    self.assertEqual(set(selected_proxy_ids), set(proxy_ids))
                finally:
                    release.set()
                    await asyncio.gather(*jobs)

    async def test_higher_count_profile_falls_back_when_low_count_proxy_fails(self):
        """A dead proxy must not block an otherwise usable next profile."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            account_names = ["fallback-low", "fallback-healthy"]
            for name in account_names:
                (root / "accounts" / name).mkdir(parents=True)
            pool = browser_pool.BrowserPool(
                accounts_dir=root / "accounts", db_path=root / "pool.db",
                max_concurrency=2,
            )
            self.addCleanup(pool._conn.close)
            self.addCleanup(pool.proxy_manager._conn.close)
            pool.list_accounts()
            day = browser_pool._usage_day()
            pool._conn.execute(
                "INSERT INTO usage(account, day, used) VALUES (?,?,?)",
                ("fallback-healthy", day, 1),
            )
            pool._conn.commit()

            selected = []

            def resolve_proxy(account, **kwargs):
                del kwargs
                if account == "fallback-low":
                    raise browser_pool.ProxyFBError("dead proxy")
                return None

            async def generate(account, *args, **kwargs):
                del args, kwargs
                selected.append(account)
                return {"conversation_id": "fallback-conversation"}

            with patch.object(pool, "proxy_for_account", side_effect=resolve_proxy), \
                 patch.object(browser_pool, "generate_video", side_effect=generate), \
                 patch.object(browser_pool.config, "SUBMISSION_INTERVAL_SEC", 0):
                result = await pool._generate_video_once("test")

            self.assertEqual(result["conversation_id"], "fallback-conversation")
            self.assertEqual(selected, ["fallback-healthy"])

    async def test_all_proxy_failures_keep_task_waiting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            account = "proxy-wait-account"
            (root / "accounts" / account).mkdir(parents=True)
            pool = browser_pool.BrowserPool(
                accounts_dir=root / "accounts", db_path=root / "pool.db",
                max_concurrency=1,
            )
            self.addCleanup(pool._conn.close)
            self.addCleanup(pool.proxy_manager._conn.close)
            pool.list_accounts()

            with patch.object(
                pool,
                "proxy_for_account",
                side_effect=browser_pool.ProxyFBError("cached proxy failure"),
            ):
                with self.assertRaises(browser_pool.AccountsBusyError):
                    await pool._generate_video_once("test")

    async def test_concurrent_dispatch_reservations_keep_proxy_cycle_balanced(self):
        """Twenty concurrent workers still reserve proxy turns fairly."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            account_names = [f"concurrent-account-{index:02d}" for index in range(30)]
            for name in account_names:
                (root / "accounts" / name).mkdir(parents=True)
            pool = browser_pool.BrowserPool(
                accounts_dir=root / "accounts", db_path=root / "pool.db",
                max_concurrency=20,
            )
            self.addCleanup(pool._conn.close)
            self.addCleanup(pool.proxy_manager._conn.close)
            pool.list_accounts()
            proxy_ids = []
            for index in range(15):
                proxy = pool.proxy_manager.create_or_update({
                    "name": f"Concurrent Proxy {index + 1}",
                    "protocol": "HTTP",
                    "mode": "rotating",
                    "host": f"203.0.113.{index + 1}",
                    "port": 19080 + index,
                })
                proxy_ids.append(proxy["id"])
            pool.proxy_manager.assign_evenly(account_names, proxy_ids)

            selected_accounts = []
            all_started = asyncio.Event()
            release = asyncio.Event()

            async def generate(account, *args, **kwargs):
                del args, kwargs
                selected_accounts.append(account)
                if len(selected_accounts) == 20:
                    all_started.set()
                await release.wait()
                return {"conversation_id": f"concurrent-{len(selected_accounts)}-{account}"}

            with patch.object(pool, "proxy_for_account", return_value=None), \
                 patch.object(browser_pool, "generate_video", side_effect=generate):
                jobs = [
                    asyncio.create_task(pool._generate_video_once("test"))
                    for _ in range(20)
                ]
                try:
                    await asyncio.wait_for(all_started.wait(), 5)
                    rows = pool._conn.execute(
                        "SELECT proxy_id, dispatches FROM proxy_usage WHERE day=?",
                        (browser_pool._usage_day(),),
                    ).fetchall()
                    dispatches = {row["proxy_id"]: row["dispatches"] for row in rows}
                    self.assertEqual(set(dispatches), set(proxy_ids))
                    self.assertEqual(sum(dispatches.values()), 20)
                    self.assertLessEqual(max(dispatches.values()) - min(dispatches.values()), 1)
                finally:
                    release.set()
                    await asyncio.gather(*jobs)

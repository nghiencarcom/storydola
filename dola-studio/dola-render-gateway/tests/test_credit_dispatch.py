import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from browser_pool import BrowserPool


class CreditDispatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        (root / 'accounts' / 'test').mkdir(parents=True)
        self.pool = BrowserPool(accounts_dir=root / 'accounts', db_path=root / 'pool.db')
        self.pool._ensure_meta('test')
        self.addCleanup(self.pool._conn.close)
        self.addCleanup(self.pool.proxy_manager._conn.close)

    def test_credit_rejection_disables_dispatch_and_auto_restore(self):
        self.pool._conn.execute("UPDATE accounts_meta SET cooldown_auto_restore=1 WHERE name='test'")
        self.pool._conn.commit()
        self.pool._mark_quota_blocked('test', 'Requires 6 credits, only 4 left')
        row = self.pool._meta('test')
        # Quota is a temporary scheduler block, not a user preference toggle.
        self.assertEqual(row['scheduling'], 1)
        self.assertEqual(row['credit_disabled'], 1)
        self.assertEqual(row['cooldown_auto_restore'], 0)
        account = self.pool.list_accounts()[0]
        self.assertFalse(account['dispatch_eligible'])
        self.assertIn('chờ Dola reset', account['scheduler_reason'])
        self.assertTrue(self.pool.all_accounts_quota_blocked)

    def test_only_manual_enable_releases_credit_disable(self):
        self.pool._mark_quota_blocked('test', 'No credit')
        self.pool.set_scheduling('test', False, manual=True)
        self.pool.set_scheduling('test', True)
        self.assertEqual(self.pool._meta('test')['scheduling'], 0)
        self.pool.set_scheduling('test', True, manual=True)
        self.assertEqual(self.pool._meta('test')['scheduling'], 1)
        self.assertEqual(self.pool._meta('test')['credit_disabled'], 0)

    def test_remaining_balance_disables_future_dispatch_without_counting_video(self):
        self.pool._set_credit_balance('test', 0, 'You still have 0 video credits left today')
        self.assertEqual(self.pool._meta('test')['scheduling'], 1)
        self.assertFalse(self.pool.available)

    def test_sufficient_balance_does_not_disable_dispatch(self):
        self.pool._set_credit_balance('test', 4)
        self.assertEqual(self.pool._meta('test')['scheduling'], 1)

    def test_low_credit_cache_is_stale_only_after_provider_day_changes(self):
        now = time.time()
        self.assertFalse(self.pool._credit_cache_is_stale(0, now, now=now))
        self.assertTrue(
            self.pool._credit_cache_is_stale(0, now, now=now + 2 * 24 * 60 * 60)
        )

    def test_stale_low_credit_profile_reenters_internal_fair_queue(self):
        stale_time = time.time() - 2 * 24 * 60 * 60
        self.pool._conn.execute(
            "UPDATE accounts_meta SET credit_balance=0, credit_checked_at=?, "
            "quota_blocked_until=0, scheduling=1 WHERE name='test'",
            (stale_time,),
        )
        self.pool._conn.commit()
        account = self.pool.list_accounts()[0]
        self.assertTrue(account['credit_stale'])
        self.assertTrue(self.pool._schedulable(account))
        self.assertIn('cache đã cũ', account['scheduler_reason'])

    def test_provider_reset_invalidates_old_low_balance_without_changing_manual_toggle(self):
        self.pool._set_credit_balance('test', 0, 'No credit')
        self.pool._conn.execute(
            "UPDATE accounts_meta SET quota_blocked_until=?, scheduling=1 "
            "WHERE name='test'",
            (time.time() - 1,),
        )
        self.pool._conn.commit()

        self.pool._clear_expired_rate_limits()
        row = self.pool._meta('test')
        self.assertEqual(row['credit_balance'], None)
        self.assertEqual(row['credit_checked_at'], 0)
        self.assertEqual(row['credit_disabled'], 0)
        self.assertEqual(row['scheduling'], 1)
        self.assertTrue(self.pool.list_accounts()[0]['dispatch_eligible'])

    def test_provider_reset_does_not_reenable_manually_disabled_profile(self):
        self.pool._set_credit_balance('test', 0, 'No credit')
        self.pool.set_scheduling('test', False, manual=True)
        self.pool._conn.execute(
            "UPDATE accounts_meta SET quota_blocked_until=? WHERE name='test'",
            (time.time() - 1,),
        )
        self.pool._conn.commit()

        self.pool._clear_expired_rate_limits()
        row = self.pool._meta('test')
        self.assertEqual(row['scheduling'], 0)
        self.assertEqual(row['credit_disabled'], 0)

    def test_rolling_seven_day_limit_blocks_until_period_reset(self):
        self.pool._mark_daily_limit(
            'test',
            'Account daily limit after submit: You have reached the video generation limit for 7 days.',
        )
        row = self.pool._meta('test')
        self.assertGreater(row['rate_limited_until'], time.time() + (6 * 24 * 60 * 60))
        self.assertIn('7 days', row['limit_reason'])

    def test_explicit_provider_reset_timestamp_is_honored(self):
        provider_tz = timezone(timedelta(hours=8))
        reset_time = datetime.now(provider_tz).replace(second=0, microsecond=0) + timedelta(days=5)
        self.pool._mark_daily_limit(
            'test',
            "You've reached the 7-day free limit. Come back on "
            + reset_time.strftime("%B %d, %Y, %H:%M")
            + " (GMT+08:00) to try again",
        )
        row = self.pool._meta('test')
        expected = reset_time.timestamp()
        self.assertAlmostEqual(row['rate_limited_until'], expected, delta=1)


class CreditPreflightTests(unittest.IsolatedAsyncioTestCase):
    async def test_preflight_does_not_trust_untimestamped_historical_balance(self):
        from video_worker_ui import _preflight_balance

        class Page:
            async def evaluate(self, _script, _args):
                return {"texts": ["You still have 0 video credits left"]}

        observed = []
        result = await _preflight_balance(
            Page(), "", "", 2,
            on_balance=lambda balance, source: observed.append((balance, source)),
        )

        self.assertIsNone(result["balance"])
        self.assertEqual(observed, [])

    async def test_preflight_ignores_yesterday_balance_after_provider_day_reset(self):
        from video_worker_ui import _preflight_balance

        class Page:
            async def evaluate(self, _script, _args):
                return {"messages": [{
                    "text": "You still have 0 video credits left",
                    "timestamp": time.time() - 2 * 24 * 60 * 60,
                }]}

        result = await _preflight_balance(Page(), "", "", 2)
        self.assertIsNone(result["balance"])

    async def test_preflight_blocks_from_timestamped_same_day_low_balance(self):
        from video_worker_ui import CreditInsufficientError, _preflight_balance

        class Page:
            async def evaluate(self, _script, _args):
                return {"messages": [{
                    "text": "You still have 0 video credits left",
                    "timestamp": time.time(),
                }]}

        observed = []
        with self.assertRaises(CreditInsufficientError):
            await _preflight_balance(
                Page(), "", "", 2,
                on_balance=lambda balance, source: observed.append((balance, source)),
            )

        self.assertEqual(observed[0][0], 0)
        self.assertIn("credits left", observed[0][1])

    async def test_preflight_refreshes_cache_when_balance_is_sufficient(self):
        from video_worker_ui import _preflight_balance

        class Page:
            async def evaluate(self, _script, _args):
                return {"messages": [{
                    "text": "You still have 4 video credits left",
                    "timestamp": time.time(),
                }]}

        observed = []
        result = await _preflight_balance(
            Page(), "", "", 2,
            on_balance=lambda balance, source: observed.append((balance, source)),
        )

        self.assertEqual(result["balance"], 4)
        self.assertEqual(observed[0][0], 4)

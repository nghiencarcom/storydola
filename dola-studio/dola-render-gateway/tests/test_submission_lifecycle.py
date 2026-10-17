import asyncio
import subprocess
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import video_worker_ui as worker
import browser_pool


class ConversationCaptureTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # These lifecycle fixtures intentionally omit SQLite persistence.
        dispatch = patch.object(browser_pool.BrowserPool, "_mark_dispatch")
        dispatch.start()
        self.addCleanup(dispatch.stop)

    def test_navigation_timeout_is_safe_pre_submit_error(self):
        self.assertTrue(worker._is_pre_submit_navigation_timeout(
            "Page.goto: net::ERR_TIMED_OUT at https://www.dola.com/chat"
        ))
        self.assertTrue(worker._is_pre_submit_navigation_timeout(
            "Page.reload: Timeout 60000ms exceeded"
        ))
        self.assertFalse(worker._is_pre_submit_navigation_timeout(
            "Page.evaluate: TypeError: Failed to fetch"
        ))

    async def test_captured_numeric_id_without_navigation(self):
        page = MagicMock(url="https://www.dola.com/chat")
        page.evaluate = AsyncMock(return_value="38417524502917137")
        self.assertEqual(await worker._page_conversation_id(page), "38417524502917137")
        self.assertEqual(worker._extract_conversation_id({"message_id": "38417524502917137"}), "")

    async def test_ack_is_durable_before_page_closes(self):
        page = MagicMock(url="https://www.dola.com/chat")
        page.is_closed.return_value = False
        page.goto = AsyncMock()
        page.reload = AsyncMock()
        page.expose_function = AsyncMock()
        page.locator.return_value.first.wait_for = AsyncMock()
        page.route = AsyncMock()
        page.unroute = AsyncMock()
        page.evaluate = AsyncMock(return_value="")
        page.wait_for_timeout = AsyncMock()
        page.keyboard.press = AsyncMock()
        context = MagicMock(pages=[page])
        context.cookies = AsyncMock(return_value=[{"name": "sessionid", "value": "test"}])
        context.close = AsyncMock()
        saved = []
        bound = []
        send_order = []

        async def expose(_, binding):
            # A restored tab may emit its old conversation before Enter.
            binding("38417524502917000")
            self.assertEqual(saved, [])

        page.expose_function.side_effect = expose

        async def before_submission():
            send_order.append("slot")

        async def press(_):
            send_order.append("enter")
            binding = page.expose_function.call_args.args[1]
            binding("38417524502917137")
            binding("38417524502917137")
            self.assertEqual(len(saved), 1)
            raise RuntimeError("Target page, context or browser has been closed")

        page.keyboard.press.side_effect = press
        with patch.object(worker, "async_playwright") as playwright, \
             patch.object(worker, "launch_account_context", AsyncMock(return_value=context)), \
             patch.object(worker, "_page_has_logged_out_marker", AsyncMock(return_value=False)), \
             patch.object(worker, "_preflight_balance", AsyncMock()), \
             patch.object(worker, "_set_default_chat_mode", AsyncMock()), \
             patch.object(worker, "_select_chat_pro", AsyncMock()), \
             patch.object(worker, "_select_chat_mode", AsyncMock()), \
             patch.object(worker, "_open_fresh_chat", AsyncMock()), \
             patch.object(worker, "_wait_for_prompt_editor", AsyncMock()), \
             patch.object(worker, "attach_reference_images", AsyncMock()), \
             patch.object(worker, "_select_model", AsyncMock()), \
             patch.object(worker, "_fill_prompt_with_seedance_extension", AsyncMock()), \
             patch.object(worker, "_fill_prompt_fast", AsyncMock()), \
             patch.object(worker, "_focus_prompt_editor", AsyncMock()), \
             patch.object(worker, "_wait_for_extension_ready", AsyncMock()):
            playwright.return_value.__aenter__ = AsyncMock()
            playwright.return_value.__aexit__ = AsyncMock(return_value=False)
            with self.assertRaisesRegex(RuntimeError, "has been closed"):
                await worker.generate_video(
                    "same-profile", "test", reference_image_paths=["image.png"],
                    on_profile_bound=bound.append,
                    on_conversation_id=lambda *args: saved.append(args),
                    before_submission=before_submission,
                )
        self.assertEqual(bound, ["same-profile"])
        self.assertEqual(saved[0][:2], ("same-profile", "38417524502917137"))
        self.assertEqual(send_order[:2], ["slot", "enter"])
        context.close.assert_awaited_once()

    async def test_initial_login_button_relogs_same_profile_before_retry(self):
        """A guest Dola page must relogin Gmail before retrying the same task."""
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._provider_cooldown_until = 0.0
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool._provider_cooldown_remaining = MagicMock(return_value=0.0)
        pool.list_accounts = MagicMock(return_value=[{
            "name": "profile-login",
            "email": "owner@example.com",
            "scheduling": True,
            "cooling": False,
            "rate_limited": False,
            "quota_blocked": False,
            "used_today": 0,
        }])
        pool._schedulable = MagicMock(return_value=True)
        pool.account_lock = MagicMock(return_value=asyncio.Lock())
        pool.proxy_for_account = MagicMock(return_value=None)
        pool.set_login_status = MagicMock()
        pool.set_scheduling = MagicMock()
        pool._relogin_account_from_profile = AsyncMock(return_value=True)
        pool._claim = MagicMock()
        pool._conn = MagicMock()
        calls = []

        async def generate(account, *args, **kwargs):
            calls.append(account)
            if len(calls) == 1:
                raise worker.PreSubmitSessionExpiredError(
                    "Dola Log In button detected at initial page check"
                )
            return {"conversation_id": "38417873944741393"}

        with patch.object(browser_pool, "generate_video", generate):
            result = await pool._generate_video_once("test", model="seedance_v2.5")

        self.assertEqual(result["conversation_id"], "38417873944741393")
        self.assertEqual(calls, ["profile-login", "profile-login"])
        pool._relogin_account_from_profile.assert_awaited_once_with(
            "profile-login",
            "owner@example.com",
            timeout_sec=browser_pool.config.AUTO_RELOGIN_TIMEOUT_SEC,
        )

    async def test_expiring_proxy_skips_profile_before_opening_video(self):
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._provider_cooldown_until = 0.0
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool._provider_cooldown_remaining = MagicMock(return_value=0.0)
        pool.list_accounts = MagicMock(return_value=[
            {
                "name": "expiring-proxy",
                "scheduling": True,
                "cooling": False,
                "rate_limited": False,
                "quota_blocked": False,
                "used_today": 0,
            },
            {
                "name": "fresh-proxy",
                "scheduling": True,
                "cooling": False,
                "rate_limited": False,
                "quota_blocked": False,
                "used_today": 0,
            },
        ])
        pool._schedulable = MagicMock(return_value=True)
        pool.account_lock = MagicMock(side_effect=lambda _: asyncio.Lock())
        pool.proxy_for_account = MagicMock(side_effect=[
            browser_pool.ProxyLeaseExpiringError(
                "Proxy lease còn 90s (< 120s)"
            ),
            {"server": "http://198.51.100.43:18080"},
        ])
        pool._claim = MagicMock()
        pool._conn = MagicMock()
        calls = []

        async def generate(account, *args, **kwargs):
            del args, kwargs
            calls.append(account)
            return {"conversation_id": "fresh-conversation"}

        with patch.object(browser_pool, "generate_video", generate):
            result = await pool._generate_video_once("test")

        self.assertEqual(result["conversation_id"], "fresh-conversation")
        self.assertEqual(calls, ["fresh-proxy"])
        self.assertEqual(
            pool.proxy_for_account.call_args_list[0].kwargs[
                "minimum_remaining_sec"
            ],
            browser_pool.config.VIDEO_PROXY_MIN_REMAINING_SEC,
        )

    async def test_idle_broken_proxy_does_not_block_active_healthy_proxy(self):
        """An unhealthy idle proxy must not act as a concurrency reservation."""
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._provider_cooldown_until = 0.0
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool._provider_cooldown_remaining = MagicMock(return_value=0.0)
        pool._active_proxy_dispatches = {"healthy-proxy": 1}
        accounts = [
            {
                "name": "profile-healthy",
                "proxy_id": "healthy-proxy",
                "proxy_status": "healthy",
                "scheduling": True,
                "cooling": False,
                "rate_limited": False,
                "quota_blocked": False,
                "used_today": 0,
                "login_ok": True,
                "credit_balance": None,
                "proxy_dispatches_today": 0,
                "last_used_at": 0,
            },
            {
                "name": "profile-broken-proxy",
                "proxy_id": "broken-proxy",
                "proxy_status": "error",
                "scheduling": True,
                "cooling": False,
                "rate_limited": False,
                "quota_blocked": False,
                "used_today": 0,
                "login_ok": True,
                "credit_balance": None,
                "proxy_dispatches_today": 0,
                "last_used_at": 0,
            },
        ]
        pool.list_accounts = MagicMock(return_value=accounts)
        pool._schedulable = MagicMock(return_value=True)
        pool.account_lock = MagicMock(side_effect=lambda _: asyncio.Lock())
        pool._claim = MagicMock()
        pool._conn = MagicMock()

        def proxy_for_account(account, **kwargs):
            del kwargs
            if account == "profile-broken-proxy":
                raise browser_pool.ProxyFBError("ProxyFB đang backoff")
            return {"server": "http://healthy.proxy"}

        pool.proxy_for_account = MagicMock(side_effect=proxy_for_account)
        calls = []

        async def generate(account, *args, **kwargs):
            del args, kwargs
            calls.append(account)
            return {"conversation_id": "healthy-conversation"}

        with patch.object(browser_pool, "generate_video", generate):
            result = await pool._generate_video_once("test")

        self.assertEqual(result["conversation_id"], "healthy-conversation")
        self.assertEqual(calls, ["profile-healthy"])
        self.assertEqual(pool._active_proxy_dispatches, {"healthy-proxy": 1})

    async def test_profile_risk_cooldown_does_not_block_other_profiles(self):
        """A persisted risk pause on one profile must not gate the whole pool."""
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool._provider_cooldown_remaining = MagicMock(return_value=3600.0)
        pool.list_accounts = MagicMock(return_value=[
            {
                "name": "profile-risky",
                "scheduling": True,
                "cooling": True,
                "rate_limited": False,
                "quota_blocked": False,
                "used_today": 0,
            },
            {
                "name": "profile-healthy",
                "scheduling": True,
                "cooling": False,
                "rate_limited": False,
                "quota_blocked": False,
                "used_today": 0,
            },
        ])
        pool._schedulable = MagicMock(side_effect=lambda item: not item["cooling"])
        pool.account_lock = MagicMock(side_effect=lambda _: asyncio.Lock())
        pool.proxy_for_account = MagicMock(return_value=None)
        pool._claim = MagicMock()
        pool._conn = MagicMock()
        calls = []

        async def generate(account, *args, **kwargs):
            del args, kwargs
            calls.append(account)
            return {"conversation_id": "healthy-conversation"}

        with patch.object(browser_pool, "generate_video", generate):
            result = await pool._generate_video_once("test")

        self.assertEqual(result["conversation_id"], "healthy-conversation")
        self.assertEqual(calls, ["profile-healthy"])
        pool._provider_cooldown_remaining.assert_not_called()

    async def test_accepted_risk_response_does_not_replay_same_task_on_another_profile(self):
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool.list_accounts = MagicMock(return_value=[
            {"name": "profile-first", "scheduling": True, "cooling": False,
             "rate_limited": False, "quota_blocked": False, "used_today": 0},
            {"name": "profile-second", "scheduling": True, "cooling": False,
             "rate_limited": False, "quota_blocked": False, "used_today": 0},
        ])
        pool._schedulable = MagicMock(return_value=True)
        pool.account_lock = MagicMock(side_effect=lambda _: asyncio.Lock())
        pool.proxy_for_account = MagicMock(return_value=None)
        pool._mark_risk_control = MagicMock()
        pool._claim = MagicMock()
        pool._conn = MagicMock()
        calls = []

        async def generate(account, *args, **kwargs):
            del args
            calls.append(account)
            kwargs["on_conversation_id"](account, "accepted-conversation", 0.0)
            raise worker.RiskControlError("Dola yêu cầu xác minh chống bot")

        with patch.object(browser_pool, "generate_video", generate):
            with self.assertRaisesRegex(worker.RiskControlError, "xác minh chống bot"):
                await pool._generate_video_once("test", task_id="risk-task")

        self.assertEqual(calls, ["profile-first"])
        pool._mark_risk_control.assert_called_once_with(
            "profile-first", "Dola yêu cầu xác minh chống bot"
        )

    async def test_bound_profile_does_not_rotate_on_composer_failure(self):
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._provider_cooldown_until = 0.0
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool.list_accounts = MagicMock(return_value=[
            {
                "name": "first", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
            {
                "name": "second", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
        ])
        pool._schedulable = MagicMock(return_value=True)
        pool.account_lock = MagicMock(return_value=asyncio.Lock())
        calls = []

        async def generate(account, *args, **kwargs):
            calls.append(account)
            kwargs["on_profile_bound"](account)
            raise RuntimeError("Failed to set model after image upload")

        with patch.object(browser_pool, "generate_video", generate):
            with self.assertRaisesRegex(RuntimeError, "Failed to set model"):
                await pool._generate_video_once("test", reference_image_paths=["image.png"])
        self.assertEqual(calls, ["first"])

    async def test_post_submit_credit_rotates_to_next_profile(self):
        """An explicit Dola credit response after ACK moves to the next profile."""
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._provider_cooldown_until = 0.0
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool._provider_cooldown_remaining = MagicMock(return_value=0.0)
        pool.list_accounts = MagicMock(return_value=[
            {
                "name": "first", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
            {
                "name": "second", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
        ])
        pool._schedulable = MagicMock(return_value=True)
        pool.account_lock = MagicMock(side_effect=lambda _: asyncio.Lock())
        pool.proxy_for_account = MagicMock(return_value=None)
        pool._mark_quota_blocked = MagicMock()
        pool._claim = MagicMock()
        pool._conn = MagicMock()
        calls = []
        rotations = []

        async def generate(account, *args, **kwargs):
            del args
            calls.append(account)
            if account == "first":
                kwargs["on_conversation_id"](account, "old-conversation", 0)
                raise worker.PostSubmitCreditError("Insufficient quota after submit")
            return {"conversation_id": "new-conversation"}

        with patch.object(browser_pool, "generate_video", generate), \
             patch.object(browser_pool.config, "SUBMISSION_INTERVAL_SEC", 0):
            result = await pool._generate_video_once(
                "test",
                on_account_rotation=lambda account, reason: rotations.append((account, reason)),
            )

        self.assertEqual(result["conversation_id"], "new-conversation")
        self.assertEqual(calls, ["first", "second"])
        pool._mark_quota_blocked.assert_called_once_with(
            "first", "Insufficient quota after submit"
        )
        self.assertEqual(rotations, [("first", "Insufficient quota after submit")])

    async def test_duration_capability_mismatch_bubbles_without_duration_fallback(self):
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._provider_cooldown_until = 0.0
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool._provider_cooldown_remaining = MagicMock(return_value=0.0)
        pool.list_accounts = MagicMock(return_value=[
            {
                "name": "first", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
            {
                "name": "second", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
        ])
        pool._schedulable = MagicMock(return_value=True)
        pool.account_lock = MagicMock(side_effect=lambda _: asyncio.Lock())
        pool.proxy_for_account = MagicMock(return_value=None)
        calls = []

        async def generate(account, *args, **kwargs):
            calls.append(account)
            raise worker.DurationCapabilityMismatchError(
                worker.DURATION_CAPABILITY_MESSAGE
            )

        with patch.object(browser_pool, "generate_video", generate):
            with self.assertRaises(worker.DurationCapabilityMismatchError):
                await pool._generate_video_once("test", duration=15)
        self.assertEqual(calls, ["first"])

    async def test_generic_provider_retry_error_bubbles_without_profile_rotation(self):
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._provider_cooldown_until = 0.0
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool._provider_cooldown_remaining = MagicMock(return_value=0.0)
        pool.list_accounts = MagicMock(return_value=[
            {
                "name": "first", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
            {
                "name": "second", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
        ])
        pool._schedulable = MagicMock(return_value=True)
        pool.account_lock = MagicMock(side_effect=lambda _: asyncio.Lock())
        pool.proxy_for_account = MagicMock(return_value=None)
        calls = []

        async def generate(account, *args, **kwargs):
            calls.append(account)
            raise worker.SomethingWentWrongError(
                worker.SOMETHING_WENT_WRONG_MESSAGE
            )

        with patch.object(browser_pool, "generate_video", generate):
            with self.assertRaises(worker.SomethingWentWrongError):
                await pool._generate_video_once("test", duration=15)
        self.assertEqual(calls, ["first"])

    async def test_provider_busy_error_does_not_pause_shared_provider(self):
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._provider_cooldown_until = 0.0
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool._provider_cooldown_remaining = MagicMock(return_value=0.0)
        pool.list_accounts = MagicMock(return_value=[{"name": "first"}])
        pool._schedulable = MagicMock(return_value=True)
        pool.account_lock = MagicMock(side_effect=lambda _: asyncio.Lock())
        pool.proxy_for_account = MagicMock(return_value=None)
        pool._mark_risk_control = MagicMock()

        async def generate(account, *args, **kwargs):
            del account, args, kwargs
            raise worker.ProviderBusyError(
                "Dola đang quá tải, chưa chấp nhận conversation; hãy thử lại sau"
            )

        with patch.object(browser_pool, "generate_video", generate):
            with self.assertRaises(worker.ProviderBusyError):
                await pool._generate_video_once("test", duration=15)

        pool._mark_risk_control.assert_not_called()

    async def test_pre_submit_setup_error_rotates_after_binding(self):
        """A missing model control must not strand the whole batch."""
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._provider_cooldown_until = 0.0
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool.list_accounts = MagicMock(return_value=[
            {
                "name": "first", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
            {
                "name": "second", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
        ])
        pool._schedulable = MagicMock(return_value=True)
        pool.account_lock = MagicMock(side_effect=lambda _: asyncio.Lock())
        calls = []

        async def generate(account, *args, **kwargs):
            calls.append(account)
            kwargs["on_profile_bound"](account)
            raise browser_pool.PreSubmitSetupError("Failed to set model (seedance_v2.5)")

        with patch.object(browser_pool, "generate_video", generate):
            with self.assertRaisesRegex(RuntimeError, "No available accounts"):
                await pool._generate_video_once("test", reference_image_paths=["image.png"])
        self.assertEqual(calls, ["first", "second"])

    async def test_stale_attachment_payload_retries_same_profile_once(self):
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._provider_cooldown_until = 0.0
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool._provider_cooldown_remaining = MagicMock(return_value=0.0)
        pool.list_accounts = MagicMock(return_value=[
            {
                "name": "first", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
            {
                "name": "second", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
        ])
        pool._schedulable = MagicMock(return_value=True)
        pool.account_lock = MagicMock(return_value=asyncio.Lock())
        pool.proxy_for_account = MagicMock(return_value=None)
        pool._claim = MagicMock()
        pool._conn = MagicMock()
        calls = []

        async def generate(account, *args, **kwargs):
            del args
            calls.append(account)
            kwargs["on_profile_bound"](account)
            if len(calls) == 1:
                raise worker.PreSubmitAttachmentSetupError(
                    "Dola payload có thừa ảnh tham chiếu (19/3)"
                )
            return {"conversation_id": "same-profile-conversation"}

        with patch.object(browser_pool, "generate_video", generate), \
             patch.object(browser_pool.config, "SUBMISSION_INTERVAL_SEC", 0):
            result = await pool._generate_video_once(
                "test", reference_image_paths=["one.png", "two.png", "three.png"]
            )

        self.assertEqual(result["conversation_id"], "same-profile-conversation")
        self.assertEqual(calls, ["first", "first"])

    async def test_pre_submit_browser_closed_rotates_after_binding(self):
        """A closed composer before ACK must not stop the whole queue."""
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._provider_cooldown_until = 0.0
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool.list_accounts = MagicMock(return_value=[
            {
                "name": "first", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
            {
                "name": "second", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
        ])
        pool._schedulable = MagicMock(return_value=True)
        pool.account_lock = MagicMock(side_effect=lambda _: asyncio.Lock())
        calls = []

        async def generate(account, *args, **kwargs):
            calls.append(account)
            kwargs["on_profile_bound"](account)
            raise RuntimeError(
                "Page.wait_for_timeout: Target page, context or browser has been closed"
            )

        with patch.object(browser_pool, "generate_video", generate):
            with self.assertRaisesRegex(RuntimeError, "No available accounts"):
                await pool._generate_video_once("test", reference_image_paths=["image.png"])
        self.assertEqual(calls, ["first", "second"])

    async def test_pre_submit_browser_closed_patchright_error_rotates(self):
        """Patchright may raise a non-RuntimeError for the same shutdown."""
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._provider_cooldown_until = 0.0
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool.list_accounts = MagicMock(return_value=[
            {
                "name": "first", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
            {
                "name": "second", "scheduling": True, "cooling": False,
                "rate_limited": False, "quota_blocked": False, "used_today": 0,
            },
        ])
        pool._schedulable = MagicMock(return_value=True)
        pool.account_lock = MagicMock(side_effect=lambda _: asyncio.Lock())
        calls = []

        async def generate(account, *args, **kwargs):
            calls.append(account)
            kwargs["on_profile_bound"](account)
            raise ValueError(
                "Page.wait_for_timeout: Target page, context or browser has been closed"
            )

        with patch.object(browser_pool, "generate_video", generate):
            with self.assertRaisesRegex(RuntimeError, "No available accounts"):
                await pool._generate_video_once("test")
        self.assertEqual(calls, ["first", "second"])

    async def test_pre_submit_risk_rotates_profiles_and_stops_at_cap(self):
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._provider_cooldown_until = 0.0
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool.list_accounts = MagicMock(
            return_value=[{"name": "first"}, {"name": "second"}, {"name": "third"}]
        )
        pool._schedulable = MagicMock(return_value=True)
        pool.account_lock = MagicMock(side_effect=lambda _: asyncio.Lock())
        pool._mark_risk_control = MagicMock()
        calls = []

        async def generate(account, *args, **kwargs):
            calls.append(account)
            # The callback may already have bound the composer (for example
            # after an image upload), but a logout before conversation ACK is
            # still safe to rotate because no provider request is durable.
            kwargs["on_profile_bound"](account)
            raise browser_pool.PreSubmitRiskControlError("Dola logged out")

        with patch.object(browser_pool, "generate_video", generate), \
             patch.object(browser_pool.config, "RISK_CONTROL_MAX_PROFILES", 3):
            with self.assertRaisesRegex(browser_pool.RiskControlError, "3 profile"):
                await pool._generate_video_once("test", reference_image_paths=["image.png"])

        self.assertEqual(calls, ["first", "second", "third"])
        self.assertEqual(pool._mark_risk_control.call_count, 3)
        self.assertTrue(
            all(not call.kwargs.get("pause_provider") for call in pool._mark_risk_control.call_args_list)
        )

    async def test_untyped_no_conversation_risk_also_rotates_after_binding(self):
        """Keep older workers from turning a profile-local risk into a global pause."""
        pool = object.__new__(browser_pool.BrowserPool)
        pool.semaphore = asyncio.Semaphore(1)
        pool._provider_cooldown_until = 0.0
        pool._submission_gate = asyncio.Lock()
        pool._last_submission_at = 0.0
        pool.list_accounts = MagicMock(return_value=[{"name": "first"}, {"name": "second"}])
        pool._schedulable = MagicMock(return_value=True)
        pool.account_lock = MagicMock(side_effect=lambda _: asyncio.Lock())
        pool._mark_risk_control = MagicMock()
        calls = []

        async def generate(account, *args, **kwargs):
            calls.append(account)
            kwargs["on_profile_bound"](account)
            raise browser_pool.RiskControlError(
                "Dola đang giới hạn tần suất tạo video, chưa chấp nhận conversation"
            )

        with patch.object(browser_pool, "generate_video", generate), \
             patch.object(browser_pool.config, "RISK_CONTROL_MAX_PROFILES", 2):
            with self.assertRaisesRegex(browser_pool.RiskControlError, "2 profile"):
                await pool._generate_video_once("test", reference_image_paths=["image.png"])

        self.assertEqual(calls, ["first", "second"])
        self.assertEqual(pool._mark_risk_control.call_count, 2)
        self.assertTrue(
            all(not call.kwargs.get("pause_provider") for call in pool._mark_risk_control.call_args_list)
        )

    async def test_login_modal_does_not_become_upload_timeout(self):
        page = MagicMock()
        page.wait_for_timeout = AsyncMock()
        with patch.object(worker, "_page_has_logged_out_marker", AsyncMock(return_value=True)):
            with self.assertRaises(worker.PreSubmitRiskControlError):
                await worker._wait_for_file_input(page)
        page.wait_for_timeout.assert_not_awaited()

    def test_sse_split_chunks_preserve_full_id_and_notify(self):
        script = """
const assert = require('node:assert/strict');
(async () => {
  const chunks = ['data: {"conver', 'sation_id":"384175', '24502917137"}' + String.fromCharCode(10)];
  const ids = [];
  global.window = {
    __dolaPersistConversation: async id => ids.push(id),
    fetch: async () => new Response(new ReadableStream({start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      // Leave SSE open: ACK must be saved before the response finishes.
    }})),
  };
  (""" + worker._INSTALL_CONVERSATION_CAPTURE_JS + """)();
  await window.fetch('/chat/completion');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(window.__dolaRenderConversationCapture.ids, ['38417524502917137']);
  assert.deepEqual(ids, ['38417524502917137']);
})().catch(error => { console.error(error); process.exit(1); });
"""
        subprocess.run(["node", "-e", script], check=True, capture_output=True, text=True)


if __name__ == "__main__":
    unittest.main()

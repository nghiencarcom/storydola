import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import browser
import add_account
from browser_pool import BrowserPool
from profile_identity import (
    canonical_google_email,
    google_emails_match,
    save_google_profile_identity,
)


class _FakeLocator:
    def __init__(self, visible=None, text=""):
        self._visible = list(visible or [])
        self._text = text

    async def count(self):
        return len(self._visible)

    def nth(self, index):
        return _FakeLocator([self._visible[index]], self._text)

    async def is_visible(self):
        return bool(self._visible and self._visible[0])

    async def inner_text(self, timeout=None):
        return self._text

    async def click(self, timeout=None):
        del timeout


class _FakePage:
    def __init__(self, selectors=None, body=""):
        self._selectors = selectors or {}
        self._body = body

    def locator(self, selector):
        if selector == "body":
            return _FakeLocator([True], self._body)
        value = self._selectors.get(selector, [])
        if isinstance(value, dict):
            return _FakeLocator(value.get("visible", []), value.get("text", ""))
        return _FakeLocator(value)

    def get_by_role(self, role, name, exact=False):
        return _FakeLocator(self._selectors.get((role, name, exact), []))


class _FakeDolaPage(_FakePage):
    def __init__(self, url, selectors=None, body=""):
        super().__init__(selectors, body)
        self.url = url

    def is_closed(self):
        return False


class _FakeContext:
    def __init__(self, pages):
        self.pages = pages

    async def cookies(self, url):
        del url
        return [{"name": "sessionid", "value": "persisted-session"}]


class LoginMarkerTests(unittest.IsolatedAsyncioTestCase):
    def test_gmail_dot_aliases_are_the_same_google_identity(self):
        self.assertEqual(
            canonical_google_email("HuynhThiKimNgan011984@gmail.com"),
            "huynhthikimngan011984@gmail.com",
        )
        self.assertTrue(
            google_emails_match(
                "huynhthikimngan011984@gmail.com",
                "huynh.thi.kim.ngan.011984@gmail.com",
            )
        )

    async def test_existing_google_session_accepts_gmail_dot_alias(self):
        page = _FakeDolaPage(
            "https://accounts.google.com/o/oauth2/auth",
            body="Huynh Thi Kim Ngan huynh.thi.kim.ngan.011984@gmail.com",
        )
        self.assertTrue(
            await add_account._advance_google_session(
                page,
                "huynhthikimngan011984@gmail.com",
                False,
            )
        )

    def test_profile_identity_marker_contains_email_only(self):
        with tempfile.TemporaryDirectory() as directory:
            profile = Path(directory) / "profile"
            self.assertTrue(save_google_profile_identity(profile, "profile@gmail.com"))
            marker = profile / "DolaProfileIdentity.json"
            self.assertTrue(marker.exists())
            self.assertNotIn("password", marker.read_text())

    async def test_click_first_visible_skips_hidden_duplicate(self):
        page = _FakePage({"button:has-text('Log In')": [False, True]})
        self.assertEqual(
            await add_account.click_first_visible(
                page, ["button:has-text('Log In')"]
            ),
            "button:has-text('Log In')",
        )

    async def test_dola_login_is_clicked_before_google_option(self):
        page = MagicMock()
        page.wait_for_timeout = AsyncMock()
        order = []

        async def detect_login(_page):
            order.append("detect-login")
            return True

        async def click_first(_page, selectors, timeout=12000):
            del timeout
            order.append(
                "click-login"
                if selectors is add_account.DOLA_LOGIN_SELECTORS
                else "click-google"
            )
            return order[-1]

        with patch.object(add_account, "_page_has_login_button", AsyncMock(side_effect=detect_login)), \
             patch.object(add_account, "click_first_visible", side_effect=click_first):
            _, google = await add_account._click_dola_login_then_google(page)

        self.assertEqual(google, "click-google")
        self.assertEqual(order, ["detect-login", "click-login", "click-google"])

    async def test_nested_header_login_button_is_detected(self):
        page = _FakePage({
            'button:has-text("Log In")': {"visible": [True], "text": "Log In"}
        })
        self.assertTrue(await browser._page_has_login_button(page))

    async def test_login_label_nested_in_span_detected_by_accessible_name(self):
        page = _FakePage({('button', 'Log In', True): [True]})
        self.assertTrue(await browser._page_has_logged_out_marker(page))

    async def test_exact_visible_login_button_is_logout_marker(self):
        page = _FakePage(
            {'button:text-is("Log In")': [True]},
            "Dola New Chat Log In Create Videos",
        )
        self.assertTrue(await browser._page_has_logged_out_marker(page))

    async def test_login_words_in_history_are_not_logout(self):
        self.assertFalse(await browser._page_has_logged_out_marker(
            _FakePage(body="How do I Log In to another website?")
        ))

    async def test_google_login_dialog_remains_logout_marker(self):
        page = _FakePage(
            {"[role='dialog'] button:has-text('Google')": [True]},
            "Continue with Google",
        )
        self.assertTrue(await browser._page_has_logged_out_marker(page))

    async def test_gmail_login_button_is_logout_marker(self):
        page = _FakePage({"button:has-text('Gmail')": [True]})
        self.assertTrue(await browser._page_has_google_login_button(page))
        self.assertTrue(await browser._page_has_logged_out_marker(page))

    async def test_gmail_login_flow_can_start_without_header_login(self):
        page = MagicMock()
        page.wait_for_timeout = AsyncMock()
        order = []

        async def detect_header(_page):
            order.append("detect-login")
            return False

        async def detect_google(_page):
            order.append("detect-google")
            return True

        async def click_first(_page, selectors, timeout=12000):
            del timeout
            order.append("click-google")
            self.assertIs(selectors, add_account.DOLA_GOOGLE_SELECTORS)
            return "button:has-text('Gmail')"

        with patch.object(add_account, "_page_has_login_button", AsyncMock(side_effect=detect_header)), \
             patch.object(add_account, "_page_has_google_login_button", AsyncMock(side_effect=detect_google)), \
             patch.object(add_account, "click_first_visible", side_effect=click_first):
            login, google = await add_account._click_dola_login_then_google(page)

        self.assertEqual(login, "")
        self.assertEqual(google, "button:has-text('Gmail')")
        self.assertEqual(order, ["detect-google", "click-google"])

    async def test_first_login_waits_for_google_button_after_header_click(self):
        page = MagicMock()
        page.wait_for_timeout = AsyncMock()
        google_attempts = 0

        async def detect_google(_page):
            return False

        async def detect_header(_page):
            return True

        async def click_first(_page, selectors, timeout=12000):
            nonlocal google_attempts
            del timeout
            if selectors is add_account.DOLA_LOGIN_SELECTORS:
                return "click-login"
            google_attempts += 1
            return "" if google_attempts == 1 else "click-google"

        with patch.object(add_account, "_page_has_login_button", AsyncMock(side_effect=detect_header)), \
             patch.object(add_account, "_page_has_google_login_button", AsyncMock(side_effect=detect_google)), \
             patch.object(add_account, "click_first_visible", side_effect=click_first):
            login, google = await add_account._click_dola_login_then_google(
                page, login_timeout=1000, google_timeout=1000
            )

        self.assertEqual(login, "click-login")
        self.assertEqual(google, "click-google")
        self.assertEqual(google_attempts, 2)

    async def test_session_check_accepts_authenticated_callback_tab(self):
        stale_login_page = _FakeDolaPage(
            "https://www.dola.com/chat",
            {"button:has-text('Log In')": [True]},
        )
        callback_page = _FakeDolaPage(
            "https://www.dola.com/chat/callback",
            body="Create Videos",
        )
        context = _FakeContext([stale_login_page, callback_page])

        self.assertTrue(
            await add_account._has_active_dola_session(context, stale_login_page)
        )


class AccountStatusTests(unittest.IsolatedAsyncioTestCase):
    async def test_dashboard_readiness_uses_dispatch_rules_not_login_flag(self):
        with tempfile.TemporaryDirectory() as directory:
            accounts_dir = Path(directory) / "accounts"
            names = (
                "profile-ready",
                "profile-risk",
                "profile-rate",
                "profile-expired",
            )
            for name in names:
                (accounts_dir / name).mkdir(parents=True)
            pool = BrowserPool(accounts_dir=accounts_dir, db_path=Path(directory) / "pool.db")
            self.addAsyncCleanup(self._close_pool, pool)
            pool.list_accounts()
            for name in names:
                pool.set_scheduling(name, True, manual=True)
            pool.set_login_status("profile-risk", True)
            pool.set_login_status("profile-rate", True)
            pool.set_login_status("profile-expired", False)

            pool._mark_risk_control("profile-risk", "verification challenge")
            pool._mark_daily_limit("profile-rate", "Dola daily limit")
            rows = {row["name"]: row for row in pool.list_accounts()}

            # Unknown cached credits are still valid candidates: the
            # dispatcher performs a fresh preflight before submitting.
            self.assertTrue(rows["profile-ready"]["dispatch_eligible"])
            self.assertEqual(
                rows["profile-ready"]["scheduler_reason"],
                "Chưa có số dư cache; sẽ kiểm tra trước khi gửi",
            )
            self.assertFalse(rows["profile-risk"]["dispatch_eligible"])
            self.assertFalse(rows["profile-rate"]["dispatch_eligible"])
            self.assertFalse(rows["profile-expired"]["dispatch_eligible"])
            self.assertEqual(
                rows["profile-expired"]["scheduler_reason"],
                "Session Dola cần đăng nhập lại",
            )

            # If no profile is a valid or unknown-session candidate, /health
            # must not report the pool available just because SQLite returned
            # the integer 0 instead of the Python singleton False.
            pool.set_login_status("profile-ready", False)
            self.assertFalse(pool.health_snapshot()["available"])

    async def test_manual_enable_after_video_test_clears_provider_pause_markers(self):
        with tempfile.TemporaryDirectory() as directory:
            accounts_dir = Path(directory) / "accounts"
            name = "profile-manual-provider-check"
            (accounts_dir / name).mkdir(parents=True)
            pool = BrowserPool(accounts_dir=accounts_dir, db_path=Path(directory) / "pool.db")
            self.addAsyncCleanup(self._close_pool, pool)
            pool._ensure_meta(name)
            pool._conn.execute(
                "UPDATE accounts_meta SET login_ok=0, scheduling=0, "
                "cooldown_until=?, cooldown_reason='risk_control', "
                "cooldown_auto_restore=1, cooldown_global=1, "
                "rate_limited_until=?, limit_reason='provider rate limit' WHERE name=?",
                (time.time() + 3600, time.time() + 7200, name),
            )
            pool._conn.commit()

            pool.set_scheduling(name, True, manual=True)

            row = pool._conn.execute(
                "SELECT login_ok, scheduling, cooldown_until, cooldown_reason, "
                "cooldown_auto_restore, cooldown_global, rate_limited_until, limit_reason "
                "FROM accounts_meta WHERE name=?",
                (name,),
            ).fetchone()
            self.assertEqual(row["login_ok"], 1)
            self.assertEqual(row["scheduling"], 1)
            self.assertEqual(row["cooldown_until"], 0)
            self.assertEqual(row["cooldown_reason"], "")
            self.assertEqual(row["cooldown_auto_restore"], 0)
            self.assertEqual(row["cooldown_global"], 0)
            self.assertEqual(row["rate_limited_until"], 0)
            self.assertEqual(row["limit_reason"], "")

    async def test_risk_control_is_exposed_as_temporary_scheduler_reason(self):
        with tempfile.TemporaryDirectory() as directory:
            accounts_dir = Path(directory) / "accounts"
            name = "profile-temporary-risk"
            (accounts_dir / name).mkdir(parents=True)
            pool = BrowserPool(accounts_dir=accounts_dir, db_path=Path(directory) / "pool.db")
            self.addAsyncCleanup(self._close_pool, pool)
            pool.set_scheduling(name, True, manual=True)

            pool._mark_risk_control(name, "verification challenge")

            account = next(item for item in pool.list_accounts() if item["name"] == name)
            self.assertTrue(account["scheduling"])
            self.assertTrue(account["cooling"])
            self.assertEqual(account["scheduler_reason"], "Tạm nghỉ do risk-control")

    async def test_provider_busy_cooldown_expires_after_thirty_minutes_without_login_check(self):
        with tempfile.TemporaryDirectory() as directory:
            accounts_dir = Path(directory) / "accounts"
            name = "profile-provider-busy"
            (accounts_dir / name).mkdir(parents=True)
            pool = BrowserPool(accounts_dir=accounts_dir, db_path=Path(directory) / "pool.db")
            self.addAsyncCleanup(self._close_pool, pool)
            pool.set_scheduling(name, True, manual=True)

            marked_at = time.time()
            pool._mark_provider_busy(name, "high demand")

            account = next(item for item in pool.list_accounts() if item["name"] == name)
            self.assertTrue(account["scheduling"])
            self.assertTrue(account["cooling"])
            self.assertFalse(account["dispatch_eligible"])
            self.assertEqual(account["cooldown_reason"], "provider_busy")
            self.assertEqual(account["scheduler_reason"], "Tạm nghỉ do Dola quá tải")
            self.assertGreaterEqual(account["cooldown_until"], marked_at + 30 * 60)
            self.assertLess(account["cooldown_until"], marked_at + 30 * 60 + 2)

            pool._conn.execute(
                "UPDATE accounts_meta SET cooldown_until=? WHERE name=?",
                (time.time() - 1, name),
            )
            pool._conn.commit()
            recovered = next(item for item in pool.list_accounts() if item["name"] == name)
            self.assertTrue(recovered["scheduling"])
            self.assertFalse(recovered["cooling"])
            self.assertTrue(recovered["dispatch_eligible"])
            self.assertEqual(recovered["cooldown_reason"], "")

    async def test_legacy_global_risk_marker_is_migrated_to_profile_only(self):
        with tempfile.TemporaryDirectory() as directory:
            accounts_dir = Path(directory) / "accounts"
            name = "profile-global-risk"
            (accounts_dir / name).mkdir(parents=True)
            db_path = Path(directory) / "pool.db"
            pool = BrowserPool(accounts_dir=accounts_dir, db_path=db_path)
            pool.list_accounts()
            pool._conn.execute(
                "UPDATE accounts_meta SET scheduling=1, cooldown_until=?, "
                "cooldown_reason='risk_control', cooldown_global=1 WHERE name=?",
                (time.time() + 3600, name),
            )
            pool._conn.commit()
            await self._close_pool(pool)

            recovered = BrowserPool(accounts_dir=accounts_dir, db_path=db_path)
            self.addAsyncCleanup(self._close_pool, recovered)
            row = recovered._conn.execute(
                "SELECT scheduling, cooldown_until, cooldown_reason, cooldown_global "
                "FROM accounts_meta WHERE name=?",
                (name,),
            ).fetchone()

            self.assertEqual(row["scheduling"], 1)
            self.assertEqual(row["cooldown_reason"], "risk_control")
            self.assertEqual(row["cooldown_global"], 0)
            self.assertGreater(row["cooldown_until"], time.time())

    async def test_successful_verify_clears_risk_and_restores_dispatch(self):
        with tempfile.TemporaryDirectory() as directory:
            accounts_dir = Path(directory) / "accounts"
            name = "profile-a"
            (accounts_dir / name).mkdir(parents=True)
            pool = BrowserPool(accounts_dir=accounts_dir, db_path=Path(directory) / "pool.db")
            self.addAsyncCleanup(self._close_pool, pool)
            pool._conn.execute(
                "UPDATE accounts_meta SET login_ok=1, scheduling=0, "
                "cooldown_until=?, cooldown_reason='risk_control', "
                "cooldown_auto_restore=1, cooldown_global=0 WHERE name=?",
                (time.time() + 3600, name),
            )
            pool._conn.commit()

            with patch(
                "browser.check_login_state_details",
                new=AsyncMock(return_value={
                    "ok": True,
                    "risk_control": False,
                    "session_cookie": True,
                    "login_ui": False,
                    "url": "https://www.dola.com/chat",
                }),
            ):
                self.assertTrue(await pool.verify_account(name))

            row = pool._conn.execute(
                "SELECT login_ok, scheduling, cooldown_until, cooldown_reason, "
                "cooldown_auto_restore, cooldown_global FROM accounts_meta WHERE name=?",
                (name,),
            ).fetchone()
            self.assertEqual(tuple(row), (1, 1, 0.0, "", 0, 0))

    async def test_explicit_login_success_clears_risk_even_when_dispatch_was_off(self):
        with tempfile.TemporaryDirectory() as directory:
            accounts_dir = Path(directory) / "accounts"
            name = "profile-b"
            (accounts_dir / name).mkdir(parents=True)
            pool = BrowserPool(accounts_dir=accounts_dir, db_path=Path(directory) / "pool.db")
            self.addAsyncCleanup(self._close_pool, pool)
            pool._conn.execute(
                "UPDATE accounts_meta SET login_ok=0, scheduling=0, "
                "cooldown_until=?, cooldown_reason='risk_control', "
                "cooldown_auto_restore=1, cooldown_global=0 WHERE name=?",
                (time.time() + 3600, name),
            )
            pool._conn.commit()

            self.assertTrue(pool.mark_session_verified(name, enable_scheduling=True))
            row = pool._conn.execute(
                "SELECT login_ok, scheduling, cooldown_until, cooldown_reason, "
                "cooldown_auto_restore, cooldown_global FROM accounts_meta WHERE name=?",
                (name,),
            ).fetchone()
            self.assertEqual(tuple(row), (1, 1, 0.0, "", 0, 0))

    async def test_page_verification_keeps_risk_cookie_out_of_dispatch(self):
        with tempfile.TemporaryDirectory() as directory:
            accounts_dir = Path(directory) / "accounts"
            name = "profile-chat-probe"
            (accounts_dir / name).mkdir(parents=True)
            pool = BrowserPool(accounts_dir=accounts_dir, db_path=Path(directory) / "pool.db")
            self.addAsyncCleanup(self._close_pool, pool)

            with patch(
                "browser.check_login_state_details",
                new=AsyncMock(return_value={
                    "ok": False,
                    "risk_control": True,
                    "session_cookie": True,
                    "login_ui": True,
                    "response_seen": False,
                }),
            ):
                self.assertFalse(await pool.verify_account(name, chat_probe=True))

            row = pool._conn.execute(
                "SELECT login_ok, scheduling, cooldown_reason, "
                "cooldown_auto_restore FROM accounts_meta WHERE name=?",
                (name,),
            ).fetchone()
            self.assertEqual(tuple(row), (0, 0, "risk_control", 1))

    @staticmethod
    async def _close_pool(pool):
        pool._conn.close()
        pool.proxy_manager._conn.close()


if __name__ == "__main__":
    unittest.main()

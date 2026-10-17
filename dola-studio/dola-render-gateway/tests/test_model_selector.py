import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import video_worker_ui as worker


class ModelSelectorTests(unittest.IsolatedAsyncioTestCase):
    async def _assert_default_chat_mode_is_set(self, mode):
        events = []
        mode_xpath = f'xpath=//span[text()="{mode}"]'

        class Page:
            def __init__(self):
                self.modal_open = False
                self.selected_mode = ""
                self.default_mode_clicked = False
                self.mode_clicked = False
                self.wait_for_timeout = AsyncMock()

            def locator(self, selector):
                return Locator(self, selector)

        class Locator:
            def __init__(self, page, selector):
                self.page = page
                self.selector = selector

            async def is_visible(self):
                if self.selector == 'xpath=//div[@data-testid="setting-modal-close"]':
                    return self.page.modal_open
                if self.selector == mode_xpath:
                    return self.page.selected_mode == mode
                return True

            async def count(self):
                if self.selector == mode_xpath:
                    return int(self.page.selected_mode == mode)
                return 1

            def nth(self, _index):
                return self

            async def wait_for(self, *, state, timeout):
                events.append(("wait", self.selector, state))
                if self.selector == 'xpath=//div[@data-testid="setting-modal-close"]':
                    if (state == "visible") != self.page.modal_open:
                        raise AssertionError("unexpected settings modal visibility")
                elif self.selector == mode_xpath and not self.page.default_mode_clicked:
                    raise AssertionError("mode option waited for before opening default mode")

            async def click(self, *, timeout):
                events.append(("click", self.selector))
                if self.selector == 'xpath=//button[@aria-label="Settings"]':
                    self.page.modal_open = True
                elif self.selector == 'xpath=//div[text()="Set Default Mode"]':
                    self.page.default_mode_clicked = True
                elif self.selector == mode_xpath:
                    self.page.mode_clicked = True
                    self.page.selected_mode = mode
                    self.assert_default_mode_opened()
                elif self.selector == 'xpath=//div[@data-testid="setting-modal-close"]':
                    self.page.modal_open = False

            def assert_default_mode_opened(self):
                if not self.page.default_mode_clicked:
                    raise AssertionError("mode was selected before the default mode setting")

        page = Page()
        await worker._set_default_chat_mode(page, mode, "profile-a")

        self.assertTrue(page.default_mode_clicked)
        self.assertTrue(page.mode_clicked)
        self.assertFalse(page.modal_open)
        self.assertEqual(
            [event[1] for event in events if event[0] == "click"],
            [
                'xpath=//button[@aria-label="Settings"]',
                'xpath=//div[text()="Set Default Mode"]',
                mode_xpath,
                'xpath=//div[@data-testid="setting-modal-close"]',
            ],
        )

    async def test_chat_settings_default_is_set_to_pro_and_modal_is_closed(self):
        await self._assert_default_chat_mode_is_set("Pro")

    async def test_chat_settings_default_switches_to_fast_and_modal_is_closed(self):
        await self._assert_default_chat_mode_is_set("Fast")

    async def _assert_already_selected_mode_only_closes_settings(self, mode):
        events = []
        mode_xpath = f'xpath=//span[text()="{mode}"]'

        class Page:
            def __init__(self):
                self.modal_open = False
                self.selected_mode = mode
                self.wait_for_timeout = AsyncMock()

            def locator(self, selector):
                return Locator(self, selector)

        class Locator:
            def __init__(self, page, selector):
                self.page = page
                self.selector = selector

            async def is_visible(self):
                if self.selector == 'xpath=//div[@data-testid="setting-modal-close"]':
                    return self.page.modal_open
                if self.selector == mode_xpath:
                    return self.page.selected_mode == mode
                return True

            async def count(self):
                return int(self.page.selected_mode == mode) if self.selector == mode_xpath else 1

            def nth(self, _index):
                return self

            async def wait_for(self, *, state, timeout):
                if self.selector == 'xpath=//div[@data-testid="setting-modal-close"]':
                    if (state == "visible") != self.page.modal_open:
                        raise AssertionError("unexpected settings modal visibility")

            async def click(self, *, timeout):
                events.append(self.selector)
                if self.selector == 'xpath=//button[@aria-label="Settings"]':
                    self.page.modal_open = True
                elif self.selector == 'xpath=//div[@data-testid="setting-modal-close"]':
                    self.page.modal_open = False

        page = Page()
        await worker._set_default_chat_mode(page, mode, "profile-a")

        self.assertEqual(
            events,
            [
                'xpath=//button[@aria-label="Settings"]',
                'xpath=//div[@data-testid="setting-modal-close"]',
            ],
        )
        self.assertFalse(page.modal_open)

    async def test_already_pro_skips_default_mode_change_and_closes_settings(self):
        await self._assert_already_selected_mode_only_closes_settings("Pro")

    async def test_already_fast_skips_default_mode_change_and_closes_settings(self):
        await self._assert_already_selected_mode_only_closes_settings("Fast")

    async def test_chat_route_applies_default_mode_even_when_already_open(self):
        page = MagicMock(url="https://www.dola.com/chat")
        context = MagicMock()
        configure = AsyncMock()
        with patch.object(worker, "_set_default_chat_mode", configure):
            await worker._ensure_dola_chat_route(
                page, context, "profile-a", default_mode="Fast"
            )
        configure.assert_awaited_once_with(page, "Fast", "profile-a")

    async def test_closes_account_settings_modal_before_mode_selection(self):
        class Page:
            def __init__(self):
                self.modal_open = True
                self.close_clicked = False
                self.close_available = False
                self.close_wait_polls = 0
                self.keyboard = MagicMock()
                self.keyboard.press = AsyncMock()
                self.wait_for_timeout = AsyncMock()

            async def evaluate(self, script):
                if script == worker._ACCOUNT_SETTINGS_MODAL_STATE_JS:
                    return {
                        "open": self.modal_open,
                        "closeAvailable": self.close_available,
                    }
                if script == worker._CLOSE_ACCOUNT_SETTINGS_MODAL_JS:
                    if not self.close_available:
                        return False
                    self.close_clicked = True
                    self.modal_open = False
                    return True
                raise AssertionError("unexpected browser evaluation")

            async def wait_for_function(self, script, *, timeout, polling):
                assert polling == 250
                if script == worker._ACCOUNT_SETTINGS_MODAL_CLOSE_READY_JS:
                    assert timeout == worker.SETTINGS_MODAL_BUTTON_WAIT_MS
                    # Simulate two browser polling intervals before Dola
                    # mounts the close button.
                    self.close_wait_polls += 2
                    self.close_available = True
                    if self.close_available:
                        return True
                elif script == worker._ACCOUNT_SETTINGS_MODAL_CLOSED_JS:
                    assert timeout == worker.SETTINGS_MODAL_CLOSE_WAIT_MS
                    if not self.modal_open:
                        return True
                raise TimeoutError("condition not ready")

        page = Page()
        dismissed = await worker._dismiss_account_settings_modal(page, "profile-a")
        self.assertTrue(dismissed)
        self.assertTrue(page.close_clicked)
        self.assertEqual(page.close_wait_polls, 2)
        page.keyboard.press.assert_not_awaited()

    async def test_mode_check_runs_after_modal_is_closed(self):
        events = []

        class Page:
            url = "https://www.dola.com/chat"

            def __init__(self):
                self.modal_open = True
                self.keyboard = MagicMock()
                self.keyboard.press = AsyncMock()
                self.wait_for_timeout = AsyncMock()

            async def evaluate(self, script):
                if script == worker._ACCOUNT_SETTINGS_MODAL_STATE_JS:
                    return {
                        "open": self.modal_open,
                        "closeAvailable": self.modal_open,
                    }
                if script == worker._CLOSE_ACCOUNT_SETTINGS_MODAL_JS:
                    events.append("modal-closed")
                    self.modal_open = False
                    return True
                raise AssertionError("unexpected browser evaluation")

            async def wait_for_function(self, script, **_kwargs):
                if script == worker._ACCOUNT_SETTINGS_MODAL_CLOSE_READY_JS and self.modal_open:
                    return True
                if script == worker._ACCOUNT_SETTINGS_MODAL_CLOSED_JS and not self.modal_open:
                    return True
                raise TimeoutError("condition not ready")

        async def wait_for_editor(*_args, **_kwargs):
            events.append("editor-ready")

        async def find_mode(*_args, **_kwargs):
            events.append("mode-checked")
            return object()

        with patch.object(worker, "_wait_for_prompt_editor", wait_for_editor), \
                patch.object(worker, "_wait_visible_chat_control", find_mode):
            await worker._select_chat_mode(Page(), "Pro", "profile-a")

        self.assertEqual(events, ["modal-closed", "editor-ready", "mode-checked"])

    async def test_modal_opened_by_model_click_is_closed_before_clean_retry(self):
        class Page:
            url = "https://www.dola.com/chat"

            def __init__(self):
                self.modal_open = False
                self.keyboard = MagicMock()
                self.keyboard.press = AsyncMock()
                self.wait_for_timeout = AsyncMock()

            async def evaluate(self, script):
                if script == worker._ACCOUNT_SETTINGS_MODAL_STATE_JS:
                    return {
                        "open": self.modal_open,
                        "closeAvailable": self.modal_open,
                    }
                if script == worker._CLOSE_ACCOUNT_SETTINGS_MODAL_JS:
                    self.modal_open = False
                    return True
                raise AssertionError("unexpected browser evaluation")

            async def wait_for_function(self, script, **_kwargs):
                if script == worker._ACCOUNT_SETTINGS_MODAL_CLOSE_READY_JS and self.modal_open:
                    return True
                if script == worker._ACCOUNT_SETTINGS_MODAL_CLOSED_JS and not self.modal_open:
                    return True
                raise TimeoutError("condition not ready")

        page = Page()

        class FastControl:
            async def bounding_box(self):
                return {"x": 50, "y": 800, "width": 80, "height": 32}

            async def click(self, **_kwargs):
                page.modal_open = True

        async def find_control(_page, _label, **_kwargs):
            if find_control.calls == 0:
                find_control.calls += 1
                return None
            return FastControl()

        find_control.calls = 0
        retry = AsyncMock(return_value=True)
        with patch.object(worker, "_wait_visible_chat_control", find_control), \
                patch.object(worker, "_reopen_dola_chat_and_retry_mode", retry):
            result = await worker._select_chat_mode(page, "Pro", "profile-a")

        self.assertTrue(result)
        self.assertFalse(page.modal_open)
        retry.assert_awaited_once()
        self.assertIn("mở modal cài đặt tài khoản", retry.await_args.args[3])

    async def test_stops_before_mode_selection_when_settings_modal_cannot_close(self):
        class Page:
            def __init__(self):
                self.keyboard = MagicMock()
                self.keyboard.press = AsyncMock()
                self.wait_for_timeout = AsyncMock()

            async def evaluate(self, script):
                if script == worker._ACCOUNT_SETTINGS_MODAL_STATE_JS:
                    return {"open": True, "closeAvailable": False}
                if script == worker._CLOSE_ACCOUNT_SETTINGS_MODAL_JS:
                    return False
                raise AssertionError("unexpected browser evaluation")

        page = Page()
        with self.assertRaisesRegex(worker.PreSubmitSetupError, "cài đặt tài khoản"):
            await worker._dismiss_account_settings_modal(page, "profile-a")
        page.keyboard.press.assert_awaited_once_with("Escape")

    async def test_menu_pro_match_is_anchored_to_open_model_menu(self):
        class Control:
            def __init__(self, label, in_model_menu):
                self.label = label
                self.in_model_menu = in_model_menu

            async def is_visible(self):
                return True

            async def inner_text(self):
                return self.label

            async def get_attribute(self, _name):
                return None

            async def evaluate(self, _script, anchor=None):
                return self.in_model_menu if anchor else True

        model_menu_pro = Control("Pro", True)
        account_pro = Control("Pro", False)

        class Locator:
            def __init__(self, controls):
                self.controls = controls

            async def count(self):
                return len(self.controls)

            def nth(self, index):
                return self.controls[index]

        class Page:
            def locator(self, _selector):
                # The page-wide reverse scan encounters the account Pro first.
                return Locator([model_menu_pro, account_pro])

        found = await worker._find_visible_chat_control(
            Page(), "Pro", menu=True,
            anchor_box={"x": 50, "y": 800, "width": 100, "height": 32},
        )
        self.assertIs(found, model_menu_pro)
        self.assertIsNone(
            await worker._find_visible_chat_control(Page(), "Pro", menu=True)
        )

    async def test_clicks_fast_then_semantic_pro_menu_control(self):
        state = {"selected": False, "menu_open": False}

        class Control:
            def __init__(self, label, on_click=None):
                self.label = label
                self.on_click = on_click
                self.click_count = 0

            async def is_visible(self):
                return True

            async def inner_text(self):
                return self.label

            async def get_attribute(self, name):
                return self.label if name in {"aria-label", "title"} else None

            async def evaluate(self, _script, anchor=None):
                return True

            async def bounding_box(self):
                return {"x": 50, "y": 800, "width": 80, "height": 32}

            async def click(self, **kwargs):
                self.click_count += 1
                if self.on_click:
                    self.on_click()

        fast = Control("Fast", lambda: state.update(menu_open=True))
        pro = Control("Pro", lambda: state.update(selected=True, menu_open=False))

        class Locator:
            def __init__(self, controls):
                self.controls = controls

            async def count(self):
                return len(self.controls)

            @property
            def first(self):
                return self.controls[0] if self.controls else Control("missing")

            def nth(self, index):
                return self.controls[index]

        class Page:
            url = "https://www.dola.com/chat"

            async def wait_for_timeout(self, _ms):
                return None

            def get_by_role(self, _role, name):
                if "Pro" in str(name):
                    return Locator([pro] if state["selected"] else [])
                return Locator([fast] if not state["selected"] else [])

            def locator(self, _selector):
                # Before opening the menu only Fast is visible. The portal
                # exposes the Pro option after Fast has been clicked.
                if state["menu_open"]:
                    return Locator([pro])
                return Locator([fast] if not state["selected"] else [pro])

        await worker._select_chat_pro(Page())
        self.assertTrue(state["selected"])
        self.assertEqual(fast.click_count, 1)
        self.assertEqual(pro.click_count, 1)

    async def test_already_selected_model_does_not_require_duplicate_menu_option(self):
        page = MagicMock()
        page.wait_for_timeout = AsyncMock()
        trigger = MagicMock()
        trigger.is_visible = AsyncMock(return_value=True)
        trigger.inner_text = AsyncMock(return_value="Model 2.5")
        trigger.click = AsyncMock()
        page.locator.return_value.count = AsyncMock(return_value=1)
        page.locator.return_value.nth.return_value = trigger
        await worker._select_model(page, "seedance_v2.5")
        trigger.click.assert_not_awaited()

    async def test_interrupted_reload_is_retried_before_prompt(self):
        page = MagicMock()
        page.reload = AsyncMock(side_effect=[RuntimeError("Page.reload: net::ERR_ABORTED; maybe frame was detached?"), None])
        page.wait_for_timeout = AsyncMock()
        await worker._reload_before_submit(page)
        self.assertEqual(page.reload.await_count, 2)

    async def test_repeated_reload_failure_has_clear_pre_submit_error(self):
        page = MagicMock()
        page.reload = AsyncMock(side_effect=RuntimeError("Page.reload: net::ERR_ABORTED"))
        page.wait_for_timeout = AsyncMock()
        with self.assertRaises(worker.PreSubmitSetupError):
            await worker._reload_before_submit(page)
        self.assertEqual(page.reload.await_count, 2)

    async def test_opens_current_25_to_select_requested_20(self):
        page = MagicMock()
        page.wait_for_timeout = AsyncMock()
        trigger = MagicMock()
        trigger.inner_text = AsyncMock(return_value="Model 2.5")
        trigger.element_handle = AsyncMock(return_value=object())
        matched_options = []

        async def click_text(page, pattern, **kwargs):
            if "skip_element" not in kwargs:
                return trigger if pattern.search("Model 2.5") else None
            matched_options.append(pattern)
            return MagicMock() if pattern.search("Seedance 2.0 Fast") else None

        # Skip the stable-control wait to exercise the visible-label fallback.
        clock = MagicMock()
        clock.monotonic.side_effect = [0, 31, 32, 33, 34, 35, 36]
        with patch.object(worker, "time", clock), \
             patch.object(worker, "_click_visible_text", side_effect=click_text):
            await worker._select_model(page, "seedance_v2.0")
        self.assertTrue(matched_options)
        self.assertTrue(all(not pattern.search("Seedance 2.5") for pattern in matched_options))

    async def test_original_extension_attachment_is_ready_without_page_flag(self):
        extension = MagicMock(url="chrome-extension://example/service-worker.js")
        extension.evaluate = AsyncMock(return_value=True)
        page = MagicMock(url="https://www.dola.com/chat")
        page.context.service_workers = [extension]
        page.wait_for_timeout = AsyncMock()
        await worker._wait_for_extension_ready(page)
        extension.evaluate.assert_awaited_once()
        self.assertEqual(extension.evaluate.call_args.args[1], page.url)
        page.wait_for_timeout.assert_not_awaited()

import unittest
from unittest.mock import AsyncMock, MagicMock, call

from browser import _restore_visible_window, _minimize_render_window


class VisibleWindowTests(unittest.IsolatedAsyncioTestCase):
    async def test_minimizes_to_dock_with_restorable_on_screen_bounds(self):
        page = MagicMock()
        page.wait_for_timeout = AsyncMock()
        cdp = MagicMock()
        cdp.send = AsyncMock(return_value={"windowId": 7})
        cdp.detach = AsyncMock()
        context = MagicMock(pages=[page])
        context.new_cdp_session = AsyncMock(return_value=cdp)
        await _minimize_render_window(context)
        bounds = cdp.send.await_args_list[2].args[1]["bounds"]
        self.assertGreaterEqual(bounds["left"], 0)
        self.assertGreaterEqual(bounds["top"], 0)
        self.assertEqual(cdp.send.await_args_list[-1].args[1]["bounds"],
                         {"windowState": "minimized"})
        cdp.detach.assert_awaited_once()

    async def test_restores_normal_bounds_and_foreground(self):
        page = MagicMock()
        page.bring_to_front = AsyncMock()
        cdp = MagicMock()
        cdp.send = AsyncMock(return_value={"windowId": 7})
        cdp.detach = AsyncMock()
        context = MagicMock(pages=[page])
        context.new_cdp_session = AsyncMock(return_value=cdp)
        await _restore_visible_window(context)
        self.assertEqual(cdp.send.await_args_list[1], call(
            "Browser.setWindowBounds", {
                "windowId": 7, "bounds": {"windowState": "normal"},
            }))
        bounds = cdp.send.await_args_list[2].args[1]["bounds"]
        self.assertGreaterEqual(bounds["left"], 0)
        self.assertGreaterEqual(bounds["top"], 0)
        page.bring_to_front.assert_awaited_once()
        cdp.detach.assert_awaited_once()

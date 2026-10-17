import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import video_worker_ui as worker


class RatioSelectorTests(unittest.IsolatedAsyncioTestCase):
    async def test_opens_current_ratio_when_requested_ratio_is_hidden(self):
        page = MagicMock()
        page.wait_for_timeout = AsyncMock()
        opened = False

        async def click_text(page, pattern, **kwargs):
            nonlocal opened
            if kwargs.get("selector") and pattern.search("9:16"):
                opened = True
                return MagicMock()
            if opened and pattern.search("16:9"):
                return MagicMock()
            return None

        with patch.object(worker, "_click_visible_text", side_effect=click_text):
            await worker._select_ratio(page, "16:9")
        self.assertTrue(opened)

    async def test_missing_ratio_still_fails_before_submission(self):
        page = MagicMock()
        page.wait_for_timeout = AsyncMock()
        page.locator.return_value.count = AsyncMock(return_value=0)
        with patch.object(worker, "_click_visible_text", AsyncMock(return_value=None)):
            with self.assertRaisesRegex(RuntimeError, "16:9"):
                await worker._select_ratio(page, "16:9")

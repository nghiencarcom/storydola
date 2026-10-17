import unittest
from unittest.mock import AsyncMock, MagicMock, patch
import video_worker_ui as worker


class DurationConfirmationTests(unittest.IsolatedAsyncioTestCase):
    async def test_blocks_confirmation_that_loses_video_parameters(self):
        page = MagicMock(url="https://www.dola.com/chat/123")
        page.evaluate = AsyncMock(side_effect=[None, None])
        page.route = AsyncMock()
        page.unroute = AsyncMock()
        request_route = MagicMock()
        request_route.request.method = "POST"
        request_route.request.post_data = '{}'
        request_route.abort = AsyncMock()
        request_route.continue_ = AsyncMock()

        async def enter(_):
            await page.route.call_args.args[1](request_route)

        page.keyboard.press = AsyncMock(side_effect=enter)
        with patch.object(worker, "_click_video_entry", AsyncMock()), \
             patch.object(worker, "_select_model", AsyncMock()) as select_model, \
             patch.object(worker, "_select_duration", AsyncMock()) as select_duration, \
             patch.object(worker, "_fill_prompt_fast", AsyncMock()):
            with self.assertRaisesRegex(RuntimeError, "Đã chặn"):
                await worker._confirm_duration_in_chat(page, "123", 15, [], model="seedance-2.5")
        select_model.assert_awaited_once_with(page, "seedance_v2.5")
        select_duration.assert_awaited_once_with(page, 15)
        request_route.abort.assert_awaited_once()
        request_route.continue_.assert_not_awaited()
        page.unroute.assert_awaited_once()

    def test_previous_reply_removed_but_repeated_new_rejection_preserved(self):
        self.assertEqual(worker._texts_after_confirmation(["old", "old", "new"], ["old"]), ["old", "new"])

    async def test_send_once_preserving_duration_text(self):
        page = MagicMock(url="https://www.dola.com/chat/123")
        page.evaluate = AsyncMock(side_effect=[None, None])
        page.keyboard.press = AsyncMock()
        with patch.object(worker, "_fill_prompt_fast", AsyncMock()) as fill:
            result = await worker._confirm_duration_in_chat(page, "123", 15, ["old"])
        self.assertIn("15s", fill.call_args.args[1])
        self.assertTrue(fill.call_args.kwargs["prepared"])
        self.assertEqual(result["previous_texts"], ["old"])
        page.keyboard.press.assert_awaited_once_with("Enter")

    async def test_resume_does_not_send_duplicate_confirmation(self):
        page = MagicMock()
        page.evaluate = AsyncMock(return_value={"previous_texts": ["old"]})
        page.keyboard.press = AsyncMock()
        await worker._confirm_duration_in_chat(page, "123", 15, ["old"])
        page.keyboard.press.assert_not_awaited()

    async def test_wrong_conversation_never_sends(self):
        page = MagicMock(url="https://www.dola.com/chat/other")
        page.evaluate = AsyncMock(return_value=None)
        page.keyboard.press = AsyncMock()
        with self.assertRaises(RuntimeError):
            await worker._confirm_duration_in_chat(page, "123", 15, [])
        page.keyboard.press.assert_not_awaited()

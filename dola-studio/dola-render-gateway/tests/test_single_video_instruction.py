import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import video_worker_ui as worker


MESSAGE = (
    "Only two videos can be generated at a time. I'll start by generating the "
    "first 15-second segment for you. The remaining segments will need to be "
    "generated in subsequent rounds."
)


class SingleVideoInstructionTests(unittest.IsolatedAsyncioTestCase):
    def test_recognizes_segmented_generation_response(self):
        self.assertTrue(worker._is_multi_video_segment_response(MESSAGE))
        self.assertFalse(worker._is_multi_video_segment_response("Create one video."))

    async def test_sends_one_correction_and_persists_before_enter(self):
        page = MagicMock(url="https://www.dola.com/chat/123")
        page.evaluate = AsyncMock(side_effect=[None, None])
        page.keyboard.press = AsyncMock()
        with patch.object(worker, "_fill_prompt_fast", AsyncMock()) as fill:
            result = await worker._confirm_single_video_in_chat(page, "123", [MESSAGE])
        self.assertEqual(result["previous_texts"], [MESSAGE])
        self.assertIn("exactly one video", fill.call_args.args[1])
        self.assertTrue(fill.call_args.kwargs["prepared"])
        page.keyboard.press.assert_awaited_once_with("Enter")

    async def test_saved_correction_is_not_sent_again(self):
        page = MagicMock(url="https://www.dola.com/chat/123")
        page.evaluate = AsyncMock(return_value={"previous_texts": [MESSAGE]})
        page.keyboard.press = AsyncMock()
        result = await worker._confirm_single_video_in_chat(page, "123", [MESSAGE])
        self.assertEqual(result["previous_texts"], [MESSAGE])
        page.keyboard.press.assert_not_awaited()

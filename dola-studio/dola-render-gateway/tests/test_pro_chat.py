import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from prompt_format import (
    PRO_VIDEO_INSTRUCTION,
    pro_video_prompt,
    strip_generated_video_envelope,
)
from video_worker_ui import _rewrite_generation_request, PromptPayloadError, _select_chat_pro


class ProPromptTests(unittest.TestCase):
    def test_exact_example(self):
        self.assertEqual(pro_video_prompt('Chú mèo đang dạo chơi ngoài công viên'),
            'Tạo video: Chú mèo đang dạo chơi ngoài công viên, tỉ lệ 16:9, thời lượng 15s, mô hình Seedance 2.5, ' + PRO_VIDEO_INSTRUCTION)

    def test_parameters_and_idempotence(self):
        for duration in (5, 10, 15, 30):
            prompt = pro_video_prompt('Chú mèo', '9:16', duration)
            self.assertIn(f'tỉ lệ 9:16, thời lượng {duration}s', prompt)
            self.assertEqual(pro_video_prompt(prompt, '9:16', duration), prompt)

    def test_existing_ratio_is_not_added_again(self):
        cases = (
            ('Cat, tỉ lệ dựng 9:16', '9:16', 'tỉ lệ dựng 9:16'),
            ('Cat, tỉ lệ 16 : 9', '9:16', 'tỉ lệ 16:9'),
            ('Cat, aspect ratio 16:9', '16:9', 'aspect ratio 16:9'),
        )
        for source, selected_ratio, expected_ratio in cases:
            with self.subTest(source=source):
                result = pro_video_prompt(source, selected_ratio, 15)
                self.assertIn(expected_ratio, result)
                self.assertNotIn(f', tỉ lệ {selected_ratio},', result)
                self.assertEqual(result.count('thời lượng'), 1)
                self.assertEqual(result.count(PRO_VIDEO_INSTRUCTION), 1)

    def test_ratio_without_label_is_not_duplicated(self):
        result = pro_video_prompt('Cat 9:16', '9:16', 15)
        self.assertEqual(result.count('9:16'), 1)
        self.assertNotIn(', tỉ lệ 9:16,', result)

    def test_existing_ratio_remains_single_on_retry(self):
        prompt = pro_video_prompt('Cat, tỉ lệ dựng 9:16', '9:16', 15)
        retried = pro_video_prompt(prompt, '9:16', 15)
        self.assertEqual(retried, prompt)
        self.assertEqual(retried.count('9:16'), 1)

    def test_ratio_suffix_is_added_when_prompt_has_no_ratio(self):
        result = pro_video_prompt('Cat in a park', '16:9', 15)
        self.assertIn(', tỉ lệ 16:9, thời lượng 15s', result)

    def test_supported_ratios_with_trailing_punctuation_are_not_duplicated(self):
        cases = (
            ('Cat, tỉ lệ 9:16.', '9:16'),
            ('Cat, tỉ lệ 16:9.', '16:9'),
            ('Cat, tỉ lệ 3:4,', '3:4'),
            ('Cat, tỉ lệ 4:3.', '4:3'),
        )
        for source, token in cases:
            with self.subTest(source=source):
                result = pro_video_prompt(source, token, 15)
                self.assertEqual(result.count(token), 1)
                self.assertEqual(result.count(f'tỉ lệ {token}'), 1)

    def test_reserves_required_suffix(self):
        prompt = pro_video_prompt('a' * 1000, max_chars=200)
        self.assertEqual(len(prompt), 200)
        self.assertTrue(prompt.startswith('Tạo video: '))
        self.assertTrue(prompt.endswith(PRO_VIDEO_INSTRUCTION))

    def test_default_prompt_limit_is_12000_characters(self):
        prompt = pro_video_prompt('a' * 12000)
        self.assertEqual(len(prompt), 12000)

    def test_retry_through_legacy_normalizer_does_not_duplicate(self):
        from prompt_format import video_prompt
        source = 'Cảnh đầu 5s, cảnh sau 10s'
        result = pro_video_prompt(source)
        for _ in range(4):
            result = pro_video_prompt(video_prompt(result), '9:16', 10)
        self.assertEqual(result, pro_video_prompt(source, '9:16', 10))
        self.assertEqual(result.count('thời lượng'), 1)
        self.assertEqual(result.count('Tạo video:'), 1)
        self.assertEqual(result.count(PRO_VIDEO_INSTRUCTION), 1)

    def test_repeated_generated_envelopes_are_collapsed(self):
        result = pro_video_prompt('Cat')
        suffix = result[len('Tạo video: Cat'):]
        duplicated = 'Tạo video: ' + result + suffix
        self.assertEqual(pro_video_prompt(duplicated), result)
        self.assertEqual(pro_video_prompt(result + ' ' + result), result)

    def test_alternate_generated_suffix_order_does_not_duplicate_parameters(self):
        source = (
            'tạo video: Cat, mô hình Seedance 2.5, '
            'tạo video luôn không hỏi lại, gửi dưới dạng human artifact, '
            'tỉ lệ 16:9, thời lượng 15s'
        )
        self.assertEqual(
            pro_video_prompt(source, '16:9', 15),
            pro_video_prompt('Cat', '16:9', 15),
        )

    def test_alternate_suffix_cleanup_preserves_scene_duration(self):
        source = (
            'Cat action lasts 5s, mô hình Seedance 2.5, '
            'tạo video luôn không hỏi lại, gửi dưới dạng human artifact, '
            'tỉ lệ 16:9, thời lượng 15s'
        )
        result = pro_video_prompt(source, '16:9', 15)
        self.assertIn('Cat action lasts 5s', result)
        self.assertEqual(result.count('thời lượng'), 1)

    def test_plain_repeated_scene_text_is_not_collapsed(self):
        self.assertEqual(
            strip_generated_video_envelope('Cat Cat'),
            'Cat Cat',
        )

    def test_invalid_parameters(self):
        for kwargs in ({'duration': 31}, {'ratio': 'invalid'}, {'max_chars': 10}):
            with self.assertRaises(ValueError):
                pro_video_prompt('Cat', **kwargs)

    def test_user_durations_are_preserved(self):
        from prompt_format import video_prompt
        source = 'Cảnh đầu 5s, cảnh sau 10s, tổng thời lượng 15s'
        self.assertIn(source, video_prompt(source))
        result = pro_video_prompt(video_prompt(source), duration=15)
        self.assertIn(source, result)
        self.assertIn('thời lượng 15s, mô hình Seedance 2.5', result)


class ProChatTests(unittest.IsolatedAsyncioTestCase):
    async def test_fast_to_pro_clicks_both_controls(self):
        import video_worker_ui as worker
        page = MagicMock()
        page.url = "https://www.dola.com/chat"
        page.get_by_role.return_value.count = AsyncMock(return_value=0)
        page.wait_for_timeout = AsyncMock()
        fast, option, selected = AsyncMock(), AsyncMock(), AsyncMock()
        with patch.object(worker, '_wait_visible_chat_control', AsyncMock(side_effect=[None, fast, option, selected])), patch.object(worker, '_find_visible_chat_control', AsyncMock(return_value=None)):
            await worker._select_chat_pro(page)
        fast.click.assert_awaited_once()
        option.click.assert_awaited_once()

    async def test_still_fast_blocks_submission(self):
        import video_worker_ui as worker
        page = MagicMock()
        page.url = "https://www.dola.com/chat"
        page.get_by_role.return_value.count = AsyncMock(return_value=0)
        page.wait_for_timeout = AsyncMock()
        fast, option = AsyncMock(), AsyncMock()
        with patch.object(worker, '_wait_visible_chat_control', AsyncMock(side_effect=[None, fast, option, option])), patch.object(worker, '_find_visible_chat_control', AsyncMock(return_value=fast)):
            with self.assertRaises(worker.PreSubmitSetupError):
                await worker._select_chat_pro(page, allow_chat_retry=False)

    async def test_chat_request_preserved_and_verified(self):
        prompt = pro_video_prompt('Cat')
        route = MagicMock()
        route.continue_ = AsyncMock()
        route.request.post_data = json.dumps({'messages': [{'content': prompt}]})
        result = await _rewrite_generation_request(route, 'seedance_2.5', 15, prompt, '16:9', pro_chat=True)
        self.assertTrue(result['prompt_verified'])
        route.continue_.assert_awaited_once_with()

    async def test_incomplete_chat_prompt_blocked(self):
        route = MagicMock()
        route.continue_ = AsyncMock()
        route.request.post_data = json.dumps({'messages': [{'content': 'Cat'}]})
        with self.assertRaises(PromptPayloadError):
            await _rewrite_generation_request(route, 'seedance_2.5', 15, pro_video_prompt('Cat'), pro_chat=True)
        route.continue_.assert_not_awaited()

    async def test_already_pro_does_not_toggle(self):
        import video_worker_ui as worker
        page = MagicMock()
        page.url = "https://www.dola.com/chat"
        selected_control = object()
        with patch.object(
            worker, "_wait_visible_chat_control", AsyncMock(return_value=selected_control)
        ):
            await _select_chat_pro(page)
        page.get_by_text.assert_not_called()
        page.get_by_role.assert_not_called()

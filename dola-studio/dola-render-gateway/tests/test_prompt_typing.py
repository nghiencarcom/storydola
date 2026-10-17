import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import video_worker_ui as worker


class PromptTypingTests(unittest.IsolatedAsyncioTestCase):
    source_prompt = 'Huế đẹp\nBình minh'

    async def test_focus_avoids_pointer_overlay(self):
        page = MagicMock(keyboard=AsyncMock())
        editor = AsyncMock()
        editor.click.side_effect = TimeoutError('menu intercepts pointer events')
        editor.evaluate.return_value = True
        with patch.object(worker, '_wait_for_prompt_editor', AsyncMock(return_value=editor)):
            await worker._focus_prompt_editor(page)
        page.keyboard.press.assert_awaited_once_with('Escape')
        editor.focus.assert_awaited_once_with(timeout=60000)
        editor.click.assert_not_awaited()

    async def test_failed_focus_stops_before_typing(self):
        page = MagicMock(keyboard=AsyncMock())
        editor = AsyncMock()
        editor.evaluate.return_value = False
        with patch.object(worker, '_wait_for_prompt_editor', AsyncMock(return_value=editor)):
            with self.assertRaises(worker.PreSubmitSetupError):
                await worker._fill_prompt_fast(page, 'test')
        page.keyboard.type.assert_not_awaited()

    async def test_reload_proxy_failure_is_pre_submit_setup_error(self):
        page = AsyncMock()
        page.reload.side_effect = RuntimeError('Page.reload: net::ERR_PROXY_CONNECTION_FAILED')
        with self.assertRaisesRegex(worker.PreSubmitSetupError, 'ERR_PROXY_CONNECTION_FAILED'):
            await worker._reset_video_composer(page)

    async def test_goto_proxy_failure_is_pre_submit_setup_error(self):
        page = AsyncMock()
        page.goto.side_effect = RuntimeError('Page.goto: net::ERR_TUNNEL_CONNECTION_FAILED')
        with self.assertRaises(worker.PreSubmitSetupError):
            await worker._goto_dola_chat(page)

    async def run_typing(self, values):
        page = MagicMock()
        page.keyboard = AsyncMock()
        editor = AsyncMock()
        with patch.object(worker, '_wait_for_prompt_editor', AsyncMock(return_value=editor)), \
             patch.object(worker.config, 'PROMPT_KEY_DELAY_MS', 1), \
             patch.object(worker, '_wait_for_prompt_value', AsyncMock(side_effect=values)):
            await worker._fill_prompt_fast(page, 'Huế đẹp\nBình minh')
        editor.fill.assert_not_awaited()
        page.keyboard.insert_text.assert_not_awaited()
        return page

    async def test_types_unicode_multiline_input_as_one_line(self):
        expected = worker._truncate_prompt(self.source_prompt)
        page = await self.run_typing([expected])
        self.assertEqual(page.keyboard.type.await_count, 1)
        page.keyboard.type.assert_awaited_once_with(expected, delay=1)
        self.assertNotIn('Enter', [c.args[0] for c in page.keyboard.press.await_args_list])

    async def test_prepared_prompt_is_not_rewritten_again(self):
        prompt = worker._truncate_prompt('A dramatic shot')
        page = MagicMock(keyboard=AsyncMock())
        with patch.object(worker, '_focus_prompt_editor', AsyncMock()), \
             patch.object(worker, '_wait_for_prompt_value', AsyncMock(return_value=prompt)), \
             patch.object(worker, '_truncate_prompt', side_effect=AssertionError('Already prepared')):
            await worker._fill_prompt_fast(page, prompt, prepared=True)
        self.assertEqual(page.keyboard.type.await_args.args[0], prompt)

    async def test_mismatch_retries_by_typing_not_pasting(self):
        expected = worker._truncate_prompt(self.source_prompt)
        page = await self.run_typing(['missing', expected])
        self.assertEqual(page.keyboard.type.await_count, 2)
        page.keyboard.type.assert_any_await(expected, delay=5)

    async def test_persistent_mismatch_fails(self):
        with self.assertRaisesRegex(RuntimeError, 'gõ từng ký tự'):
            await self.run_typing(['missing', 'missing'])

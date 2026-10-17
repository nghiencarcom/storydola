import json
import unittest
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path
import video_worker_ui as worker
from prompt_format import video_prompt, SINGLE_VIDEO_INSTRUCTION


class ProAttachmentTests(unittest.IsolatedAsyncioTestCase):
    async def test_seedance_extension_fills_exact_prompt_without_formatting_again(self):
        prompt = (
            "Tạo video: Cat, tỉ lệ 16:9, thời lượng 15s, mô hình Seedance 2.5, "
            "tạo video luôn không hỏi lại, gửi dưới dạng human artifact"
        )
        page = MagicMock()
        page.evaluate = AsyncMock(return_value={
            "success": True,
            "prompt": prompt,
        })
        editor = MagicMock()
        with patch.object(worker, "_wait_for_prompt_editor", AsyncMock(return_value=editor)), patch.object(
            worker, "_wait_for_prompt_value", AsyncMock(return_value=prompt)
        ):
            result = await worker._fill_prompt_with_seedance_extension(page, prompt)

        self.assertEqual(result, prompt)
        payload = json.loads(page.evaluate.await_args.args[1]["detail"])
        self.assertEqual(
            page.evaluate.await_args.args[1]["requestEvent"],
            worker.SEEDANCE_WORKER_PROMPT_REQUEST_EVENT,
        )
        self.assertEqual(payload["prompt"], prompt)
        self.assertFalse(payload["autoSubmit"])
        self.assertEqual(
            page.evaluate.await_args.args[1]["repeatMs"],
            worker.SEEDANCE_PROMPT_BRIDGE_REPEAT_MS,
        )

    async def test_seedance_prompt_bridge_retries_a_lost_first_dispatch(self):
        prompt = "Tạo video: Cat, tỉ lệ 16:9, thời lượng 15s, mô hình Seedance 2.5"
        page = MagicMock()
        page.evaluate = AsyncMock(side_effect=[
            {
                "success": False,
                "error": worker.SEEDANCE_PROMPT_BRIDGE_TIMEOUT_ERROR,
            },
            {"success": True, "prompt": prompt},
        ])
        page.wait_for_timeout = AsyncMock()
        editor = MagicMock()
        with patch.object(worker, "_wait_for_prompt_editor", AsyncMock(return_value=editor)), patch.object(
            worker, "_wait_for_prompt_value", AsyncMock(return_value=prompt)
        ):
            result = await worker._fill_prompt_with_seedance_extension(page, prompt)

        self.assertEqual(result, prompt)
        self.assertEqual(page.evaluate.await_count, 2)
        page.wait_for_timeout.assert_awaited_once()

    async def test_seedance_bridge_falls_back_to_main_world_assignment(self):
        page = MagicMock()
        page.evaluate = AsyncMock(side_effect=[
            {"success": False, "committed": False, "error": "__seedance_image_bridge_timeout__"},
            {"success": True, "committed": True, "method": "main-existing-file-input"},
        ])
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "reference.png"
            image_path.write_bytes(b"fake-png")
            result = await worker._seedance_main_world_attach(page, image_path)

        self.assertTrue(result["committed"])
        self.assertEqual(page.evaluate.await_count, 2)
        first_args = page.evaluate.await_args_list[0].args[1]
        second_args = page.evaluate.await_args_list[1].args[1]
        self.assertEqual(
            first_args["requestEvent"], worker.SEEDANCE_WORKER_IMAGE_REQUEST_EVENT
        )
        self.assertEqual(
            second_args["requestEvent"], worker.SEEDANCE_MAIN_IMAGE_REQUEST_EVENT
        )
        first_payload = json.loads(first_args["detail"])
        second_payload = json.loads(second_args["detail"])
        self.assertIn("data:image/png;base64,ZmFrZS1wbmc=", first_args["detail"])
        self.assertFalse(first_payload["image"]["replaceExisting"])
        self.assertFalse(second_payload["image"]["replaceExisting"])

    async def test_first_seedance_reference_requests_replacement_mode(self):
        page = MagicMock()
        page.evaluate = AsyncMock(return_value={
            "success": True,
            "committed": True,
            "method": "main-existing-file-input",
        })
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "reference.png"
            image_path.write_bytes(b"fake-png")
            await worker._seedance_main_world_attach(
                page, image_path, replace_existing=True
            )

        payload = json.loads(page.evaluate.await_args.args[1]["detail"])
        self.assertTrue(payload["image"]["replaceExisting"])

    async def test_seedance_verified_bridge_result_is_accepted(self):
        page = MagicMock()
        page.evaluate = AsyncMock(return_value={
            "success": True,
            "verified": True,
            "method": "main-silent-plus-file-input",
        })
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "reference.webp"
            image_path.write_bytes(b"fake-webp")
            result = await worker._seedance_main_world_attach(page, image_path)

        self.assertTrue(result["verified"])
        page.evaluate.assert_awaited_once()

    async def test_drop_assignment_can_wait_for_storage_confirmation(self):
        page = MagicMock()
        page.evaluate = AsyncMock(return_value={
            "success": True, "committed": True,
            "inputAccept": "drop-fallback",
        })
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "reference.png"
            image_path.write_bytes(b"fake-png")
            result = await worker._seedance_main_world_attach(page, image_path)
        self.assertTrue(result["committed"])

    async def test_unlabeled_popup_left_of_pro_is_opened(self):
        page = MagicMock()
        named = MagicMock()
        named.count = AsyncMock(return_value=0)
        trigger = MagicMock()
        trigger.bounding_box = AsyncMock(return_value={'x': 350, 'y': 730, 'width': 60, 'height': 30})
        page.get_by_role.side_effect = [named, MagicMock(first=trigger)]
        popups = trigger.locator.return_value.locator.return_value
        popups.count = AsyncMock(return_value=1)
        popup = popups.nth.return_value
        popup.bounding_box = AsyncMock(return_value={'x': 300, 'y': 730, 'width': 32, 'height': 30})
        popup.inner_text = AsyncMock(return_value='')
        popup.click = AsyncMock()
        popup.get_attribute = AsyncMock(return_value="closed")
        self.assertTrue(await worker._open_reference_attachment_menu(page))
        popup.click.assert_awaited_once()

    async def test_native_chooser_uploads_all_references(self):
        chooser = MagicMock()
        chooser.set_files = AsyncMock()
        adapter = await worker._wait_for_reference_input(MagicMock(), [chooser], 1000)
        await adapter.set_input_files(['one.png', 'two.png'])
        chooser.set_files.assert_awaited_once_with(['one.png', 'two.png'])

    async def test_missing_input_opens_attachment_menu(self):
        page = MagicMock()
        page.locator.return_value.count = AsyncMock(side_effect=[0, 1])
        page.wait_for_timeout = AsyncMock()
        with patch.object(worker, '_page_has_logged_out_marker', AsyncMock(return_value=False)), patch.object(worker, '_open_reference_attachment_menu', AsyncMock(return_value=True)) as open_menu:
            result = await worker._wait_for_file_input(page, timeout=1000)
        open_menu.assert_awaited_once()
        self.assertIs(result, page.locator.return_value.first)
        page.remove_listener.assert_called_once()

    def test_retired_instruction_removed_without_stripping_duration(self):
        self.assertEqual(video_prompt('Cat 15s ' + SINGLE_VIDEO_INSTRUCTION), 'Cat 15s')

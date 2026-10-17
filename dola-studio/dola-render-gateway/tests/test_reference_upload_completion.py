import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import video_worker_ui as worker


class ReferenceUploadCompletionTests(unittest.IsolatedAsyncioTestCase):
    def test_reference_manifest_is_ordered_and_unique(self):
        self.assertEqual(
            worker._dedupe_reference_paths([
                " first.png ", "second.png", "first.png", "", None,
            ]),
            ("first.png", "second.png"),
        )

    async def test_verified_extension_result_does_not_repeat_native_upload(self):
        page = MagicMock()
        page.wait_for_timeout = AsyncMock()
        page.context.on = MagicMock()
        page.context.remove_listener = MagicMock()
        bridge = AsyncMock(return_value=[{
            "verified": True,
            "method": "main-silent-plus-file-input",
        }])
        with patch.object(worker, "_reference_image_snapshot", AsyncMock(return_value=[])), \
             patch.object(worker, "_attach_references_with_seedance_bridge", bridge), \
             patch.object(worker, "_wait_for_file_input", AsyncMock()) as native, \
             patch.object(worker, "_reset_video_composer", AsyncMock()) as reset, \
             patch.object(worker, "_clear_composer_reference_attachments", AsyncMock(
                 return_value={"composer": True, "attachmentCount": 0,
                                "fileInputsWithFiles": 0, "remaining": 0}
             )):
            await worker.attach_reference_images(page, ["one.png"])

        bridge.assert_awaited_once()
        native.assert_not_awaited()
        reset.assert_not_awaited()

    async def test_bridge_error_retries_clean_composer_with_native_input(self):
        page = MagicMock()
        page.wait_for_timeout = AsyncMock()
        native = MagicMock()
        native.set_input_files = AsyncMock()
        bridge = AsyncMock(side_effect=worker.SeedanceImageBridgeError("upload not confirmed"))
        reset = AsyncMock()
        ticks = iter(range(0, 10000, 200))
        with patch.object(worker.time, "monotonic", side_effect=lambda: next(ticks)), \
             patch.object(worker, "_reference_image_snapshot", AsyncMock(return_value=[])), \
             patch.object(worker, "_attach_references_with_seedance_bridge", bridge), \
             patch.object(worker, "_wait_for_file_input", AsyncMock(return_value=native)), \
             patch.object(worker, "_reset_video_composer", reset), \
             patch.object(worker, "_clear_composer_reference_attachments", AsyncMock(
                 return_value={"composer": True, "attachmentCount": 0,
                                "fileInputsWithFiles": 0, "remaining": 0}
             )):
            with self.assertRaises(worker.ReferenceImageUploadTimeoutError):
                await worker.attach_reference_images(page, ["one.png"])
        bridge.assert_awaited_once()
        reset.assert_awaited_once()
        native.set_input_files.assert_awaited_once_with(["one.png"])

    async def test_committed_bridge_without_upload_signal_retries_early(self):
        page = MagicMock()
        page.wait_for_timeout = AsyncMock()
        native = MagicMock()
        native.set_input_files = AsyncMock()
        bridge = AsyncMock()

        async def commit_without_upload(page, paths, task_label="", wait_for_upload=None):
            await wait_for_upload(1, {"committed": True})

        bridge.side_effect = commit_without_upload
        ticks = iter(range(0, 10000, 5))
        with patch.object(worker.time, "monotonic", side_effect=lambda: next(ticks)), \
             patch.object(worker, "_reference_image_snapshot", AsyncMock(return_value=[])), \
             patch.object(worker, "_attach_references_with_seedance_bridge", bridge), \
             patch.object(worker, "_wait_for_file_input", AsyncMock(return_value=native)), \
             patch.object(worker, "_reset_video_composer", AsyncMock()) as reset, \
             patch.object(worker, "_clear_composer_reference_attachments", AsyncMock(
                 return_value={"composer": True, "attachmentCount": 0,
                                "fileInputsWithFiles": 0, "remaining": 0}
             )):
            with self.assertRaises(worker.ReferenceImageUploadTimeoutError):
                await worker.attach_reference_images(page, ["one.png"])
        bridge.assert_awaited_once()
        reset.assert_awaited_once()
        native.set_input_files.assert_awaited_once_with(["one.png"])

    async def test_committed_and_thumbnails_cannot_complete_missing_upload(self):
        page = MagicMock()
        page.wait_for_timeout = AsyncMock()
        ticks = iter(range(0, 10000, 200))
        reset = AsyncMock()
        with patch.object(worker.time, "monotonic", side_effect=lambda: next(ticks)), \
             patch.object(worker, "_reference_image_snapshot", AsyncMock(return_value=[{"src": "blob:preview"}])), \
             patch.object(worker, "_attach_references_with_seedance_bridge", AsyncMock(return_value=[{"committed": True}])), \
             patch.object(worker, "_reset_video_composer", reset), \
             patch.object(worker, "_clear_composer_reference_attachments", AsyncMock(
                 return_value={"composer": True, "attachmentCount": 0,
                                "fileInputsWithFiles": 0, "remaining": 0}
             )):
            with self.assertRaises(worker.ReferenceImageUploadTimeoutError):
                await worker.attach_reference_images(page, ["one.png"])
        reset.assert_awaited_once()

    async def test_clear_failure_stops_before_assigning_reference(self):
        page = MagicMock()
        page.wait_for_timeout = AsyncMock()
        native = AsyncMock()
        bridge = AsyncMock()
        reset = AsyncMock()
        clear = AsyncMock(side_effect=[
            {"composer": False, "remaining": None},
            {"composer": False, "remaining": None},
        ])
        with patch.object(worker, "_clear_composer_reference_attachments", clear), \
             patch.object(worker, "_reset_video_composer", reset), \
             patch.object(worker, "_attach_references_with_seedance_bridge", bridge), \
             patch.object(worker, "_wait_for_file_input", native):
            with self.assertRaises(worker.PreSubmitAttachmentSetupError):
                await worker.attach_reference_images(page, ["one.png"])
        reset.assert_awaited_once()
        bridge.assert_not_awaited()
        native.assert_not_awaited()

    async def test_next_image_waits_for_previous_storage_ack(self):
        page = MagicMock()
        page.wait_for_timeout = AsyncMock()
        events = []

        async def attach(page, path, replace_existing=False):
            events.append(("assign", path, replace_existing))
            return {"committed": True}

        async def acknowledge(index):
            events.append(("uploaded", index))

        with patch.object(worker, "_seedance_main_world_attach", side_effect=attach):
            await worker._attach_references_with_seedance_bridge(
                page, ["one.png", "two.png"], wait_for_upload=acknowledge
            )
        self.assertEqual(events, [
            ("assign", "one.png", True), ("uploaded", 1),
            ("assign", "two.png", False), ("uploaded", 2),
        ])

    async def test_failed_ack_stops_before_assigning_next_image(self):
        page = MagicMock()
        attach = AsyncMock(return_value={"committed": True})
        with patch.object(worker, "_seedance_main_world_attach", attach):
            with self.assertRaises(worker.SeedanceImageBridgeError):
                await worker._attach_references_with_seedance_bridge(
                    page, ["one.png", "two.png"],
                    wait_for_upload=AsyncMock(side_effect=worker.SeedanceImageBridgeError("timeout")),
                )
        attach.assert_awaited_once_with(page, "one.png", replace_existing=True)

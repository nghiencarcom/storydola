import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import server
from sketch_fallback import SketchFallbackError


class SketchRetryFailureTests(unittest.IsolatedAsyncioTestCase):
    async def test_sketch_generation_failure_is_terminal_and_not_fresh_chat_retry(self):
        row = {
            "id": "video-sketch-failure",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-a",
            "reference_image_mode": "none",
            "reference_images": json.dumps(["https://example.test/source.png"]),
            "reference_image_names": json.dumps(["source.png"]),
            "prompt": "Tạo video từ ảnh tham chiếu",
            "retry_count": 1,
            "timings_json": json.dumps({}),
        }
        store_update = MagicMock()
        pencil_failure = AsyncMock(
            side_effect=SketchFallbackError("MaiVideo tạo ảnh chì quá thời gian chờ.")
        )

        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update", store_update),
            patch.object(server, "create_pencil_sketches", pencil_failure),
            patch.object(server.config, "AUTO_SKETCH_RETRY_ENABLED", True),
            patch.object(server.config, "AUTO_SKETCH_RETRY_LIMIT", 1),
        ):
            handled = await server._schedule_sketch_reference_retry(row, "Dola từ chối")

        self.assertTrue(handled)
        pencil_failure.assert_awaited_once_with(["https://example.test/source.png"])
        fields = store_update.call_args.kwargs
        self.assertEqual(fields["status"], "failed")
        self.assertEqual(fields["failure_code"], "SKETCH_REFERENCE_GENERATION_FAILED")
        self.assertIn("MaiVideo tạo ảnh chì quá thời gian chờ", fields["error"])
        timings = json.loads(fields["timings_json"])
        self.assertEqual(timings["auto_sketch_retry_count"], 1)
        self.assertEqual(
            timings["last_auto_retry_reason"],
            "sketch_reference_generation_failed",
        )


if __name__ == "__main__":
    unittest.main()

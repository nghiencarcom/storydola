import time
import unittest
from unittest.mock import patch

import server


class TimeoutFailureClassificationTests(unittest.TestCase):
    def test_timeout_without_conversation_is_submission_failure(self):
        row = {
            "id": "video-pre-submit-timeout",
            "status": "submitting",
            "account": "profile-a",
            "conversation_id": None,
            "created_at": time.time() - 252,
            "started_at": time.time() - 252,
            "deadline_at": None,
            "timings_json": "{}",
        }
        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as update,
        ):
            handled = server._record_timeout_failure(
                row["id"], TimeoutError("Không tìm thấy ô nhập prompt trên Dola")
            )

        self.assertTrue(handled)
        fields = update.call_args.kwargs
        self.assertEqual(fields["failure_code"], "SUBMIT_FAILED")
        self.assertIn("chưa thể xác nhận video đã bắt đầu render", fields["error"])
        self.assertIn("Không tìm thấy ô nhập prompt", fields["error"])
        self.assertNotIn("RENDER_TIMEOUT", fields["error"])

    def test_timeout_with_accepted_conversation_is_render_timeout(self):
        row = {
            "id": "video-accepted-timeout",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-123",
            "created_at": time.time() - 2000,
            "started_at": time.time() - 2000,
            "deadline_at": time.time() - 5,
            "timings_json": "{}",
        }
        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as update,
        ):
            handled = server._record_timeout_failure(
                row["id"], TimeoutError("poll window ended")
            )

        self.assertTrue(handled)
        fields = update.call_args.kwargs
        self.assertEqual(fields["failure_code"], "RENDER_TIMEOUT")
        self.assertIn("giới hạn tổng", fields["error"])

    def test_terminal_task_is_not_overwritten_by_timeout_cleanup(self):
        row = {
            "id": "video-already-cancelled",
            "status": "cancelled",
            "conversation_id": None,
        }
        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as update,
        ):
            handled = server._record_timeout_failure(
                row["id"], TimeoutError("late timeout")
            )

        self.assertFalse(handled)
        update.assert_not_called()


if __name__ == "__main__":
    unittest.main()

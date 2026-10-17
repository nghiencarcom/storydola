import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import video_worker


class _FakeCapture:
    def __init__(self, values):
        self.values = values

    def isOpened(self):
        return True

    def get(self, key):
        return self.values.get(key, 0)

    def release(self):
        return None


class VideoValidationTests(unittest.TestCase):
    def test_duration_mismatch_keeps_playable_file_and_returns_warning(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "result.mp4"
            path.write_bytes(b"playable-placeholder")
            capture = _FakeCapture({
                video_worker.cv2.CAP_PROP_FRAME_WIDTH: 720,
                video_worker.cv2.CAP_PROP_FRAME_HEIGHT: 1280,
                video_worker.cv2.CAP_PROP_FPS: 24,
                video_worker.cv2.CAP_PROP_FRAME_COUNT: 288,  # 12 seconds
            })
            with patch.object(video_worker.cv2, "VideoCapture", return_value=capture), \
                 patch.object(video_worker.config, "VALIDATE_VIDEO_OUTPUT", True), \
                 patch.object(video_worker.config, "VIDEO_DURATION_TOLERANCE_SEC", 0.5):
                metadata = video_worker.validate_video_output(path, 30, "9:16")

            self.assertTrue(path.is_file())
            self.assertTrue(metadata["duration_mismatch"])
            self.assertEqual(metadata["requested_duration"], 30)
            self.assertAlmostEqual(metadata["duration"], 12.0)
            self.assertIn("Đã tải video", metadata["duration_warning"])

    def test_unreadable_file_is_still_a_terminal_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "broken.mp4"
            path.write_bytes(b"broken")
            capture = _FakeCapture({})
            with patch.object(video_worker.cv2, "VideoCapture", return_value=capture), \
                 patch.object(video_worker.config, "VALIDATE_VIDEO_OUTPUT", True):
                with self.assertRaises(video_worker.VideoValidationError):
                    video_worker.validate_video_output(path, 30, "9:16")

import unittest
from unittest.mock import AsyncMock, patch

import video_worker_ui as worker


MESSAGE = ('For likeness protection, Dreamina Seedance 2.5 only supports generating '
           'videos featuring yourself. Use another image, or create a video from text.')


class LikenessRejectionTests(unittest.IsolatedAsyncioTestCase):
    def test_submission_response_classifies_image_rejection(self):
        self.assertEqual(worker._classify_submission_error(MESSAGE), worker.LIKENESS_REJECTION_MESSAGE)
        self.assertEqual(worker._classify_submission_error(MESSAGE.upper()), worker.LIKENESS_REJECTION_MESSAGE)
        self.assertIsNone(worker.LIKENESS_REJECTION_PATTERN.search('Create a video from text.'))

    async def test_poll_stops_on_first_rejection_without_downloading(self):
        page = AsyncMock()
        context = AsyncMock()
        context.cookies.return_value = []
        page.evaluate.return_value = {
            'ok': True,
            'texts': [{'text': MESSAGE[:120], 'role': 'assistant', 'status': 'done'}],
            'videos': [],
        }
        with patch.object(worker, '_download_video_source', AsyncMock()) as download:
            with self.assertRaises(worker.ImageLikenessRejectedError):
                await worker.poll_conversation('account', page, context, '123', timeout=60)
        page.evaluate.assert_awaited_once()
        download.assert_not_awaited()

import unittest
import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

import server


class AdminProfileBatchTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.accounts = [
            {"name": "new-profile-a", "email": "a@example.test"},
            {"name": "new-profile-b", "email": "b@example.test"},
        ]
        self.pool = SimpleNamespace(
            accounts=["new-profile-a", "new-profile-b"],
            available=True,
            list_accounts=MagicMock(return_value=self.accounts),
        )
        self.client = {
            "api_key_hash": "studio-test-owner",
            "api_key_name": "MaiVideo Studio",
            "daily_limit": 0,
            "concurrency_limit": 0,
            "allowed_durations": [5, 10, 15],
            "owner_id": "test-owner",
        }
        self.tracked = []

        def capture_track(task_id, coroutine):
            self.tracked.append(task_id)
            if inspect.iscoroutine(coroutine):
                coroutine.close()

        self.patches = [
            patch.object(server, "render_pool", self.pool),
            patch.object(server, "_auth", return_value=self.client),
            patch.object(server, "_user_key_admin_auth"),
            patch.object(server, "_validate_video_config", side_effect=lambda client, model, prompt, duration, size=None, ratio=None: (model, prompt, ratio or "16:9", duration or 5)),
            patch.object(server, "validate_reference_urls", new=AsyncMock(return_value=[])),
            patch.object(server, "_reference_image_names_for_urls", return_value=[]),
            patch.object(server, "_normalize_reference_image_mode", return_value="none"),
            patch.object(server.store, "create_many"),
            patch.object(server, "_run_task", return_value=MagicMock()),
            patch.object(server, "_track_video_task", side_effect=capture_track),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    async def test_admin_batch_pins_each_prompt_to_its_requested_profile(self):
        request = server.VideoBatchRequest(
            prompts=["first test prompt", "second test prompt"],
            duration=5,
            ratio="16:9",
            accounts=["a@example.test", "new-profile-b"],
        )

        result = await server.create_video_batch(
            request,
            x_admin_key="test-admin",
            x_dola_admin_request="1",
        )

        self.assertEqual([row["account"] for row in server.store.create_many.call_args.args[0]], [
            "new-profile-a",
            "new-profile-b",
        ])
        self.assertEqual([call.kwargs["preferred_account"] for call in server._run_task.call_args_list], [
            "new-profile-a",
            "new-profile-b",
        ])
        self.assertEqual([job["account"] for job in result["jobs"]], [
            "new-profile-a",
            "new-profile-b",
        ])
        self.assertEqual(len(self.tracked), 2)

    async def test_profile_target_is_rejected_without_admin_request_marker(self):
        request = server.VideoBatchRequest(
            prompts=["test prompt"],
            duration=5,
            accounts=["new-profile-a"],
        )

        with self.assertRaises(HTTPException) as raised:
            await server.create_video_batch(request)

        self.assertEqual(raised.exception.status_code, 403)
        server.store.create_many.assert_not_called()

    async def test_batch_requires_one_distinct_profile_per_prompt(self):
        mismatched = server.VideoBatchRequest(
            prompts=["first", "second"],
            duration=5,
            accounts=["new-profile-a"],
        )
        duplicate = server.VideoBatchRequest(
            prompts=["first", "second"],
            duration=5,
            accounts=["new-profile-a", "a@example.test"],
        )

        for request in (mismatched, duplicate):
            with self.subTest(accounts=request.accounts):
                with self.assertRaises(HTTPException) as raised:
                    await server.create_video_batch(
                        request,
                        x_admin_key="test-admin",
                        x_dola_admin_request="1",
                    )
                self.assertEqual(raised.exception.status_code, 422)

        server.store.create_many.assert_not_called()


if __name__ == "__main__":
    unittest.main()

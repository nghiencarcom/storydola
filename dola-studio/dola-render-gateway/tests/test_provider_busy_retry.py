import json
import unittest
from unittest.mock import AsyncMock, patch

import server


class ProviderBusyRetryTests(unittest.IsolatedAsyncioTestCase):
    def _row(self, *, account="profile-a", conversation_id="conversation-a", timings=None):
        return {
            "id": "video-provider-busy",
            "status": "processing",
            "account": account,
            "conversation_id": conversation_id,
            "model": "seedance-2.5",
            "prompt": "A short cinematic scene",
            "ratio": "9:16",
            "duration": 10,
            "reference_images": "[]",
            "reference_image_names": "[]",
            "retry_count": 2,
            "timings_json": json.dumps(timings or {}),
        }

    async def test_provider_busy_retries_on_an_untried_profile(self):
        row = self._row()
        other_profiles = [{"name": "profile-b"}, {"name": "profile-c"}]
        scheduled = []

        async def fake_run_task(*args, **kwargs):
            return None

        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as store_update,
            patch.object(server.render_pool, "_mark_provider_busy") as mark_provider_busy,
            patch.object(server.render_pool, "list_accounts", return_value=other_profiles),
            patch.object(server.render_pool, "_schedulable", return_value=True),
            patch.object(server, "_task_client", return_value={}),
            patch.object(server, "_task_reference_images", return_value=[]),
            patch.object(server, "_task_reference_image_names", return_value=[]),
            patch.object(server, "_run_task", side_effect=fake_run_task) as run_task,
            patch.object(
                server, "_track_video_task",
                side_effect=lambda task_id, coroutine: scheduled.append((task_id, coroutine)),
            ),
            patch.object(server.config, "AUTO_PROVIDER_BUSY_RETRIES", 5),
        ):
            handled = server._schedule_provider_busy_retry(row, "Dola đang quá tải")
            await scheduled[0][1]

        self.assertTrue(handled)
        mark_provider_busy.assert_called_once_with("profile-a", "Dola đang quá tải")
        self.assertEqual(scheduled[0][0], row["id"])
        self.assertEqual(run_task.call_args.kwargs["excluded_accounts"], ["profile-a"])
        fields = store_update.call_args.kwargs
        self.assertEqual(fields["status"], "submitting")
        self.assertIsNone(fields["account"])
        timings = json.loads(fields["timings_json"])
        self.assertEqual(timings["auto_provider_busy_retry_count"], 1)
        self.assertEqual(timings["provider_busy_tried_accounts"], ["profile-a"])
        self.assertEqual(timings["last_auto_retry_reason"], "provider_busy_profile_rotation")

    async def test_provider_busy_stops_when_no_untried_profile_exists(self):
        row = self._row()
        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as store_update,
            patch.object(server.render_pool, "_mark_provider_busy") as mark_provider_busy,
            patch.object(server.render_pool, "list_accounts", return_value=[{"name": "profile-a"}]),
            patch.object(server.render_pool, "_schedulable", return_value=True),
            patch.object(server, "_track_video_task") as track_task,
            patch.object(server.config, "AUTO_PROVIDER_BUSY_RETRIES", 5),
        ):
            handled = server._schedule_provider_busy_retry(row, "Dola đang quá tải")

        self.assertFalse(handled)
        mark_provider_busy.assert_called_once_with("profile-a", "Dola đang quá tải")
        track_task.assert_not_called()
        timings = json.loads(store_update.call_args.kwargs["timings_json"])
        self.assertEqual(timings["provider_busy_tried_accounts"], ["profile-a"])
        self.assertEqual(timings["provider_busy_retry_stop_reason"], "no_untried_profiles")

    async def test_provider_busy_retry_budget_is_separate_and_bounded(self):
        row = self._row(
            timings={
                "auto_cannot_answer_retry_count": 1,
                "auto_provider_busy_retry_count": 1,
                "provider_busy_tried_accounts": ["profile-a"],
            }
        )
        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as store_update,
            patch.object(server.render_pool, "_mark_provider_busy") as mark_provider_busy,
            patch.object(server.render_pool, "list_accounts", return_value=[{"name": "profile-b"}]),
            patch.object(server.render_pool, "_schedulable", return_value=True),
            patch.object(server, "_track_video_task") as track_task,
            patch.object(server.config, "AUTO_PROVIDER_BUSY_RETRIES", 1),
        ):
            handled = server._schedule_provider_busy_retry(row, "Dola đang quá tải")

        self.assertFalse(handled)
        mark_provider_busy.assert_called_once_with("profile-a", "Dola đang quá tải")
        track_task.assert_not_called()
        timings = json.loads(store_update.call_args.kwargs["timings_json"])
        self.assertEqual(timings["provider_busy_retry_stop_reason"], "retry_limit")
        self.assertEqual(timings["auto_cannot_answer_retry_count"], 1)

    async def test_resumed_poll_provider_busy_uses_profile_rotation(self):
        row = self._row()
        row.update({"deadline_at": 0, "api_key_hash": None, "started_at": None})
        scheduled = []

        async def fake_run_task(*args, **kwargs):
            return None

        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update"),
            patch.object(server.render_pool, "_mark_provider_busy") as mark_provider_busy,
            patch.object(
                server.render_pool,
                "resume_video",
                new=AsyncMock(side_effect=server.ProviderBusyError("Dola đang quá tải")),
            ),
            patch.object(server.render_pool, "release_poll_reservation"),
            patch.object(server.render_pool, "list_accounts", return_value=[{"name": "profile-b"}]),
            patch.object(server.render_pool, "_schedulable", return_value=True),
            patch.object(server.key_limiter, "acquire", new=AsyncMock()),
            patch.object(server.key_limiter, "release", new=AsyncMock()),
            patch.object(server, "_task_client", return_value={}),
            patch.object(server, "_task_reference_images", return_value=[]),
            patch.object(server, "_task_reference_image_names", return_value=[]),
            patch.object(server, "_run_task", side_effect=fake_run_task) as run_task,
            patch.object(
                server, "_track_video_task",
                side_effect=lambda task_id, coroutine: scheduled.append((task_id, coroutine)),
            ),
            patch.object(server.config, "AUTO_PROVIDER_BUSY_RETRIES", 5),
        ):
            await server._resume_task(row)
            await scheduled[0][1]

        self.assertEqual(run_task.call_args.kwargs["excluded_accounts"], ["profile-a"])
        mark_provider_busy.assert_called_once_with("profile-a", "Dola đang quá tải")


if __name__ == "__main__":
    unittest.main()

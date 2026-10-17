import json
import time
import unittest
from unittest.mock import AsyncMock, patch

import server


class PostSubmitAccountLimitRetryTests(unittest.IsolatedAsyncioTestCase):
    def _row(self, *, account="profile-limited", conversation_id="conversation-a"):
        return {
            "id": "video-daily-limit",
            "status": "processing",
            "account": account,
            "conversation_id": conversation_id,
            "model": "seedance_v2.5",
            "prompt": "A short cinematic scene",
            "ratio": "9:16",
            "duration": 10,
            "reference_images": "[]",
            "reference_image_names": "[]",
            "retry_count": 0,
            "timings_json": json.dumps({
                "provider_busy_tried_accounts": ["profile-overloaded"],
            }),
        }

    async def test_daily_limit_schedules_an_untried_profile(self):
        row = self._row()
        profiles = [
            {"name": "profile-limited"},
            {"name": "profile-overloaded"},
            {"name": "profile-next"},
        ]
        scheduled = []

        async def fake_run_task(*args, **kwargs):
            return None

        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as store_update,
            patch.object(server.render_pool, "list_accounts", return_value=profiles),
            patch.object(server, "_task_client", return_value={}),
            patch.object(server, "_run_task", side_effect=fake_run_task) as run_task,
            patch.object(
                server,
                "_track_video_task",
                side_effect=lambda task_id, coroutine: scheduled.append((task_id, coroutine)),
            ),
        ):
            handled = server._schedule_post_submit_account_limit_retry(
                row, "Dola 7-day free limit"
            )
            await scheduled[0][1]

        self.assertTrue(handled)
        self.assertEqual(scheduled[0][0], row["id"])
        self.assertEqual(
            run_task.call_args.kwargs["excluded_accounts"],
            ["profile-overloaded", "profile-limited"],
        )
        fields = store_update.call_args.kwargs
        self.assertEqual(fields["status"], "submitting")
        self.assertIsNone(fields["account"])
        self.assertIsNone(fields["conversation_id"])
        timings = json.loads(fields["timings_json"])
        self.assertEqual(timings["daily_limit_tried_accounts"], ["profile-limited"])
        self.assertEqual(timings["auto_daily_limit_retry_count"], 1)

    def test_does_not_schedule_when_every_profile_was_tried(self):
        row = self._row()
        profiles = [
            {"name": "profile-limited"},
            {"name": "profile-overloaded"},
        ]
        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as store_update,
            patch.object(server.render_pool, "list_accounts", return_value=profiles),
            patch.object(server, "_track_video_task") as track_task,
        ):
            handled = server._schedule_post_submit_account_limit_retry(
                row, "Dola 7-day free limit"
            )

        self.assertFalse(handled)
        track_task.assert_not_called()
        timings = json.loads(store_update.call_args.kwargs["timings_json"])
        self.assertEqual(timings["daily_limit_tried_accounts"], ["profile-limited"])

    async def test_fresh_generation_defers_daily_limit_to_profile_rotation(self):
        task_id = "video-daily-limit"
        initial = {
            "id": task_id,
            "status": "submitting",
            "account": None,
            "conversation_id": None,
            "created_at": time.time(),
            "timings_json": "{}",
        }
        submitted = {
            **initial,
            "status": "processing",
            "account": "profile-limited",
            "conversation_id": "conversation-a",
        }

        async def reject_daily_limit(*args, **kwargs):
            kwargs["on_profile_bound"]("profile-limited")
            kwargs["on_conversation_id"](
                "profile-limited", "conversation-a", time.time() + 60
            )
            raise server.PostSubmitAccountLimitError("Dola 7-day free limit")

        with (
            patch.object(server.store, "get", side_effect=[initial, submitted, submitted]),
            patch.object(server.store, "update"),
            patch.object(server.key_limiter, "acquire", new=AsyncMock()),
            patch.object(server.key_limiter, "release", new=AsyncMock()),
            patch.object(
                server,
                "download_reference_images",
                new=AsyncMock(return_value=(None, [])),
            ),
            patch.object(
                server.render_pool,
                "generate_video",
                new=AsyncMock(side_effect=reject_daily_limit),
            ),
            patch.object(server.render_pool, "release_poll_reservation"),
            patch.object(
                server,
                "_schedule_post_submit_account_limit_retry",
                return_value=True,
            ) as schedule_retry,
        ):
            await server._run_task(
                task_id,
                "seedance_v2.5",
                "A short cinematic scene",
                "9:16",
                10,
                [],
                {"api_key_hash": None, "concurrency_limit": 0},
            )

        schedule_retry.assert_called_once_with(
            submitted, "Dola 7-day free limit"
        )

    async def test_resumed_poll_rotates_after_daily_limit(self):
        row = self._row()
        row.update({
            "deadline_at": time.time() + 120,
            "api_key_hash": None,
            "client_concurrency_limit": 0,
            "started_at": time.time(),
        })
        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update"),
            patch.object(server.key_limiter, "acquire", new=AsyncMock()),
            patch.object(server.key_limiter, "release", new=AsyncMock()),
            patch.object(
                server.render_pool,
                "resume_video",
                new=AsyncMock(
                    side_effect=server.PostSubmitAccountLimitError(
                        "Dola 7-day free limit"
                    )
                ),
            ),
            patch.object(server.render_pool, "release_poll_reservation"),
            patch.object(
                server,
                "_schedule_post_submit_account_limit_retry",
                return_value=True,
            ) as schedule_retry,
        ):
            await server._resume_task(row)

        schedule_retry.assert_called_once_with(row, "Dola 7-day free limit")


if __name__ == "__main__":
    unittest.main()

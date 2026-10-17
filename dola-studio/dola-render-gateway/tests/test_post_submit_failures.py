import asyncio
import json
from pathlib import Path
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import browser_pool
import server
import video_worker
import video_worker_ui


class PostSubmitFailureClassificationTests(unittest.IsolatedAsyncioTestCase):
    def test_accepted_rate_limit_is_normalized_for_profile_rotation(self):
        original = video_worker.RateLimitError("Dola rate limited after submit")
        retryable = browser_pool._post_submit_rate_limit_error(original)
        self.assertIsInstance(retryable, video_worker.PostSubmitRateLimitError)
        self.assertIn("after accepting conversation", str(retryable))

        already_normalized = video_worker.PostSubmitRateLimitError("already normalized")
        self.assertIs(
            browser_pool._post_submit_rate_limit_error(already_normalized),
            already_normalized,
        )

    def test_rate_limit_is_distinct_from_risk_control_and_provider_busy(self):
        self.assertIsInstance(
            video_worker_ui._submission_error_exception(
                "710022002", conversation_accepted=True
            ),
            video_worker.PostSubmitRateLimitError,
        )
        self.assertIsInstance(
            video_worker_ui._submission_error_exception(
                "710022002", conversation_accepted=False
            ),
            video_worker.RateLimitError,
        )
        self.assertIsInstance(
            video_worker_ui._terminal_provider_response_error(
                "Dola returned error_code=710022002"
            ),
            video_worker.PostSubmitRateLimitError,
        )
        self.assertIsInstance(
            video_worker_ui._terminal_provider_response_error(
                "The service is experiencing high demand. Please try again later."
            ),
            video_worker_ui.ProviderBusyError,
        )

    async def test_poll_http_429_is_terminal_rate_limit(self):
        page = SimpleNamespace(evaluate=AsyncMock(return_value={
            "ok": False,
            "status": 429,
            "providerErrors": ["HTTP 429 rate limit"],
            "texts": [],
            "videos": [],
        }))
        context = SimpleNamespace(cookies=AsyncMock(return_value=[]))

        with self.assertRaises(video_worker.PostSubmitRateLimitError):
            await video_worker_ui.poll_conversation(
                "profile-limited", page, context, "conversation-a", timeout=30
            )

    async def test_poll_http_200_final_rate_limit_reply_is_terminal(self):
        page = SimpleNamespace(evaluate=AsyncMock(return_value={
            "ok": True,
            "status": 200,
            "providerErrors": [],
            "texts": [{
                "text": "Rate limit exceeded. Please try again later.",
                "role": "assistant",
                "status": "completed",
                "isFinal": True,
            }],
            "videos": [],
        }))
        context = SimpleNamespace(cookies=AsyncMock(return_value=[]))

        with self.assertRaises(video_worker.PostSubmitRateLimitError):
            await video_worker_ui.poll_conversation(
                "profile-limited", page, context, "conversation-a", timeout=30
            )

    async def test_poll_final_generic_vietnamese_no_video_is_terminal(self):
        page = SimpleNamespace(evaluate=AsyncMock(return_value={
            "ok": True,
            "status": 200,
            "providerErrors": [],
            "texts": [{
                "text": (
                    "Thông báo: Tôi tạm thời không thể tạo nội dung bạn vừa yêu cầu. "
                    "Bạn vui lòng thử nhập các yêu cầu khác, tôi sẽ cố gắng hỗ trợ tốt nhất có thể."
                ),
                "role": "assistant",
                "status": "completed",
                "isFinal": True,
            }],
            "videos": [],
        }))
        context = SimpleNamespace(cookies=AsyncMock(return_value=[]))

        with self.assertRaises(video_worker_ui.CannotAnswerQuestionError):
            await video_worker_ui.poll_conversation(
                "profile-a", page, context, "conversation-a", timeout=30
            )

    async def test_concrete_video_payload_takes_precedence_over_provider_error(self):
        page = SimpleNamespace(evaluate=AsyncMock(return_value={
            "ok": True,
            "status": 200,
            "providerErrors": [
                "The video generation request was blocked by the content safety filter."
            ],
            "texts": [],
            "videos": ["https://media.example/video.mp4"],
            "videoSources": [{
                "url": "https://media.example/video.mp4",
                "source": "download_url",
                "watermarkFree": True,
            }],
        }))
        context = SimpleNamespace(cookies=AsyncMock(return_value=[]))

        with tempfile.TemporaryDirectory() as directory:
            local_video = Path(directory) / "video.mp4"
            local_video.write_bytes(b"video")
            with (
                patch.object(
                    video_worker_ui,
                    "_download_video_source",
                    new=AsyncMock(return_value=(
                        local_video, "https://media.example/video.mp4", True, False
                    )),
                ) as download,
                patch.object(
                    video_worker_ui,
                    "validate_video_output",
                    return_value={"duration": 10},
                ),
            ):
                result = await video_worker_ui.poll_conversation(
                    "profile-a", page, context, "conversation-a", timeout=30
                )

        download.assert_awaited_once()
        self.assertEqual(result["local_path"], str(local_video))
        self.assertEqual(result["account"], "profile-a")

    async def test_poll_detects_terminal_overload_before_assistant_message_is_final(self):
        # A completed content-policy refusal is handled by the final-response
        # tests below; an in-progress message can be a transient filter retry.
        responses = (
            (
                "The service is experiencing high demand. Please try again later.",
                video_worker_ui.ProviderBusyError,
            ),
        )
        for text, expected_error in responses:
            with self.subTest(expected_error=expected_error.__name__):
                page = SimpleNamespace(evaluate=AsyncMock(side_effect=[
                    {
                        "ok": True,
                        "status": 200,
                        "providerErrors": [],
                        "texts": [{
                            "text": text,
                            "role": "assistant",
                            "status": "generating",
                            "isFinal": False,
                        }],
                        "videos": [],
                    },
                    "",
                ]))
                context = SimpleNamespace(cookies=AsyncMock(return_value=[]))

                with self.assertRaises(expected_error):
                    await video_worker_ui.poll_conversation(
                        "profile-a", page, context, "conversation-a", timeout=30
                    )

    async def test_poll_visible_body_fallback_detects_overload_after_fetch_failure(self):
        prompt = "Create a calm scene in a kitchen."
        visible_chat = (
            f"{prompt} The service is experiencing high demand. Please try again later. "
            "Download the Dola desktop app for faster access to the Pro Mode."
        )

        async def evaluate(script, args=None):
            if script == video_worker_ui.POLL_JS:
                raise RuntimeError("TypeError: Failed to fetch")
            if script == video_worker_ui.VISIBLE_PROVIDER_TEXT_JS:
                self.assertEqual(args, {"conversationId": "conversation-a"})
                return visible_chat
            return ""

        page = SimpleNamespace(evaluate=AsyncMock(side_effect=evaluate))
        context = SimpleNamespace(cookies=AsyncMock(return_value=[]))

        with self.assertRaises(video_worker_ui.ProviderBusyError):
            await video_worker_ui.poll_conversation(
                "profile-a", page, context, "conversation-a", timeout=30,
                prompt_text=prompt,
            )

    async def test_poll_visible_body_fallback_detects_vietnamese_policy_refusal(self):
        prompt = "Create a short, calm office scene."
        refusal = (
            "Yêu cầu tạo video này bị hệ thống chặn tạo nội dung và không được phép "
            "thử lại với cùng yêu cầu. Thông báo: Tôi tạm thời không thể tạo nội dung "
            "bạn vừa yêu cầu."
        )

        async def evaluate(script, args=None):
            if script == video_worker_ui.POLL_JS:
                raise RuntimeError("TypeError: Failed to fetch")
            if script == video_worker_ui.VISIBLE_PROVIDER_TEXT_JS:
                self.assertEqual(args, {"conversationId": "conversation-a"})
                return f"{prompt} {refusal}"
            return ""

        page = SimpleNamespace(evaluate=AsyncMock(side_effect=evaluate))
        context = SimpleNamespace(cookies=AsyncMock(return_value=[]))

        with self.assertRaises(video_worker_ui.ContentPolicyRejectedError):
            await video_worker_ui.poll_conversation(
                "profile-a", page, context, "conversation-a", timeout=30,
                prompt_text=prompt,
            )

    async def test_visible_body_fallback_does_not_classify_prompt_as_provider_reply(self):
        prompt = (
            'A poster says "The service is experiencing high demand. '
            'Please try again later."'
        )

        async def evaluate(script, args=None):
            if script == video_worker_ui.POLL_JS:
                raise RuntimeError("TypeError: Failed to fetch")
            if script == video_worker_ui.VISIBLE_PROVIDER_TEXT_JS:
                return prompt
            return ""

        page = SimpleNamespace(evaluate=AsyncMock(side_effect=evaluate))
        context = SimpleNamespace(cookies=AsyncMock(return_value=[]))

        with self.assertRaises(video_worker_ui.RenderStillProcessingError):
            await video_worker_ui.poll_conversation(
                "profile-a", page, context, "conversation-a", timeout=0.1,
                prompt_text=prompt,
            )

    async def test_poll_keeps_checking_after_generating_then_handles_later_refusal(self):
        responses = (
            (
                "The service is experiencing high demand. Please try again later.",
                video_worker_ui.ProviderBusyError,
            ),
            (
                "The requested video was blocked by the safety filter. "
                "The system will not allow another retry with the same prompt.",
                video_worker_ui.ContentPolicyRejectedError,
            ),
            (
                "Để tôi tạo được video, bạn có thể chọn một trong các hướng sửa: "
                "Bạn muốn tôi thử lại theo hướng nào? Tôi sẽ viết lại prompt và tạo ngay "
                "khi có yêu cầu điều chỉnh.",
                video_worker_ui.ProfileRotationRetryError,
            ),
        )
        for refusal, expected_error in responses:
            with self.subTest(expected_error=expected_error.__name__):
                poll_responses = iter((
                    {
                        "ok": True,
                        "status": 200,
                        "providerErrors": [],
                        "texts": [{
                            "text": "Dola is creating your video.",
                            "role": "assistant",
                            "status": "generating",
                            "isFinal": False,
                        }],
                        "videos": [],
                    },
                    {
                        "ok": True,
                        "status": 200,
                        "providerErrors": [],
                        "texts": [{
                            "text": refusal,
                            "role": "assistant",
                            "status": "completed",
                            "isFinal": True,
                        }],
                        "videos": [],
                    },
                ))

                async def evaluate(script, *_args):
                    if script == video_worker_ui.POLL_JS:
                        return next(poll_responses)
                    return ""

                page = SimpleNamespace(evaluate=AsyncMock(side_effect=evaluate))
                context = SimpleNamespace(cookies=AsyncMock(return_value=[]))
                with patch("video_worker_ui.asyncio.sleep", new=AsyncMock()):
                    with self.assertRaises(expected_error):
                        await video_worker_ui.poll_conversation(
                            "profile-a", page, context, "conversation-a", timeout=60
                        )

                poll_calls = [
                    call for call in page.evaluate.await_args_list
                    if call.args[0] == video_worker_ui.POLL_JS
                ]
                self.assertEqual(len(poll_calls), 2)

    async def test_content_policy_retry_submits_only_a_safe_rewritten_prompt(self):
        row = {
            "id": "video-content-policy-rewrite",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-a",
            "model": "seedance-2.5",
            "prompt": (
                "Walter is chopping vegetables with a kitchen knife during "
                "a tense confrontation in the kitchen."
            ),
            "ratio": "16:9",
            "duration": 10,
            "reference_images": "[]",
            "reference_image_names": "[]",
            "retry_count": 0,
            "timings_json": "{}",
        }
        scheduled = []

        async def fake_run_task(*_args, **_kwargs):
            return None

        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as store_update,
            patch.object(server, "_task_client", return_value={}),
            patch.object(server, "_task_reference_images", return_value=[]),
            patch.object(server, "_task_reference_image_names", return_value=[]),
            patch.object(server, "_run_task", side_effect=fake_run_task) as run_task,
            patch.object(
                server,
                "_track_video_task",
                side_effect=lambda task_id, coroutine: scheduled.append((task_id, coroutine)),
            ),
            patch.object(server.config, "AUTO_CANNOT_ANSWER_RETRIES", 1),
        ):
            handled = server._schedule_cannot_answer_retry(
                row, "Dola blocked the safety filter", safety_rewrite=True
            )
            await scheduled[0][1]

        self.assertTrue(handled)
        safe_prompt = run_task.call_args.args[2]
        self.assertIn("is preparing vegetables at the counter", safe_prompt)
        self.assertIn("calm, serious conversation", safe_prompt)
        self.assertNotRegex(
            safe_prompt, r"(?i)\bknife\b|\bchops?\b|\btense\b|\bconfrontation\b"
        )
        self.assertEqual(store_update.call_args.kwargs["prompt"], safe_prompt)

    async def test_content_policy_refusal_does_not_resend_an_unchanged_prompt(self):
        prompt = "A quiet office conversation with two characters filling out a form."
        row = {
            "id": "video-policy-unchanged",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-a",
            "model": "seedance-2.5",
            "prompt": prompt,
            "retry_count": 0,
            "timings_json": "{}",
        }
        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as store_update,
            patch.object(server, "_track_video_task") as track_task,
        ):
            scheduled = server._schedule_cannot_answer_retry(
                row, "Dola blocked this request by content policy", safety_rewrite=True
            )

        self.assertFalse(scheduled)
        store_update.assert_not_called()
        track_task.assert_not_called()

    def test_final_policy_refusal_marks_only_the_matching_conversation_failed(self):
        row = {
            "id": "video-final-policy-refusal",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-a",
        }
        with patch.object(server.store, "get", return_value=row), \
                patch.object(server.store, "update") as store_update:
            handled = server._fail_final_content_policy_refusal(
                row,
                "Dola xác nhận không thể thử lại yêu cầu này nữa.",
            )

        self.assertTrue(handled)
        self.assertEqual(store_update.call_args.args[0], row["id"])
        self.assertEqual(store_update.call_args.kwargs["status"], "failed")
        self.assertEqual(
            store_update.call_args.kwargs["failure_code"],
            "CONTENT_POLICY_REJECTED",
        )
        self.assertIn("không thể thử lại", store_update.call_args.kwargs["error"])

    def test_final_policy_refusal_does_not_overwrite_a_replacement_conversation(self):
        source_row = {
            "id": "video-final-policy-stale",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-old",
        }
        replacement = {
            **source_row,
            "account": "profile-b",
            "conversation_id": "conversation-new",
        }
        with patch.object(server.store, "get", return_value=replacement), \
                patch.object(server.store, "update") as store_update:
            handled = server._fail_final_content_policy_refusal(
                source_row, "Dola refused the original request."
            )

        self.assertFalse(handled)
        store_update.assert_not_called()

    async def test_generic_no_video_retry_excludes_the_profile_that_failed(self):
        row = {
            "id": "video-generic-no-video",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-a",
            "model": "seedance-2.5",
            "prompt": "A quiet office conversation.",
            "ratio": "16:9",
            "duration": 10,
            "reference_images": "[]",
            "reference_image_names": "[]",
            "retry_count": 0,
            "timings_json": "{}",
        }
        scheduled = []

        async def fake_run_task(*_args, **_kwargs):
            return None

        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as store_update,
            patch.object(
                server.render_pool,
                "list_accounts",
                return_value=[{"name": "profile-a"}, {"name": "profile-b"}],
            ),
            patch.object(server.render_pool, "_schedulable", return_value=True),
            patch.object(server, "_task_client", return_value={}),
            patch.object(server, "_task_reference_images", return_value=[]),
            patch.object(server, "_task_reference_image_names", return_value=[]),
            patch.object(server, "_run_task", side_effect=fake_run_task) as run_task,
            patch.object(
                server,
                "_track_video_task",
                side_effect=lambda task_id, coroutine: scheduled.append((task_id, coroutine)),
            ),
            patch.object(server.config, "AUTO_CANNOT_ANSWER_RETRIES", 1),
        ):
            scheduled_retry = server._schedule_cannot_answer_retry(
                row,
                "Thông báo: Tôi tạm thời không thể tạo nội dung bạn vừa yêu cầu.",
            )
            await scheduled[0][1]

        self.assertTrue(scheduled_retry)
        self.assertEqual(run_task.call_args.kwargs["excluded_accounts"], ["profile-a"])
        timings = json.loads(store_update.call_args.kwargs["timings_json"])
        self.assertEqual(timings["cannot_answer_tried_accounts"], ["profile-a"])

    async def test_prompt_adjustment_response_retries_same_video_on_another_profile(self):
        row = {
            "id": "video-prompt-adjustment-retry",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-a",
            "model": "seedance-2.5",
            "prompt": "A quiet office conversation.",
            "ratio": "16:9",
            "duration": 10,
            "reference_images": "[]",
            "reference_image_names": "[]",
            "retry_count": 0,
            "timings_json": "{}",
            "deadline_at": 2_000_000_000,
            "api_key_hash": None,
            "client_concurrency_limit": 0,
            "started_at": None,
        }
        response = (
            "Để tôi tạo được video, bạn có thể chọn một trong các hướng sửa: "
            "Bạn muốn tôi thử lại theo hướng nào? Tôi sẽ viết lại prompt và tạo ngay "
            "khi có yêu cầu điều chỉnh."
        )
        scheduled = []

        async def fake_run_task(*_args, **_kwargs):
            return None

        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as store_update,
            patch.object(server.key_limiter, "acquire", new=AsyncMock()),
            patch.object(server.key_limiter, "release", new=AsyncMock()),
            patch.object(
                server.render_pool,
                "resume_video",
                new=AsyncMock(
                    side_effect=video_worker_ui.ProfileRotationRetryError(response)
                ),
            ),
            patch.object(
                server.render_pool,
                "release_poll_reservation",
            ) as release_poll,
            patch.object(
                server.render_pool,
                "list_accounts",
                return_value=[{"name": "profile-a"}, {"name": "profile-b"}],
            ),
            patch.object(server.render_pool, "_schedulable", return_value=True),
            patch.object(server, "_task_client", return_value={}),
            patch.object(server, "_task_reference_images", return_value=[]),
            patch.object(server, "_task_reference_image_names", return_value=[]),
            patch.object(server, "_run_task", side_effect=fake_run_task) as run_task,
            patch.object(
                server,
                "_track_video_task",
                side_effect=lambda task_id, coroutine: scheduled.append((task_id, coroutine)),
            ),
            patch.object(server.config, "AUTO_CANNOT_ANSWER_RETRIES", 1),
        ):
            await server._resume_task(row)
            self.assertEqual(len(scheduled), 1)
            await scheduled[0][1]

        release_poll.assert_called_once_with("profile-a")
        self.assertEqual(run_task.call_args.args[2], row["prompt"])
        self.assertEqual(run_task.call_args.kwargs["excluded_accounts"], ["profile-a"])
        retry_update = next(
            call.kwargs for call in store_update.call_args_list
            if call.kwargs.get("status") == "submitting"
        )
        self.assertIsNone(retry_update["conversation_id"])

    async def test_generic_no_video_retry_fails_cleanly_without_an_alternate_profile(self):
        row = {
            "id": "video-no-alternate-profile",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-a",
            "prompt": "A quiet office conversation.",
            "retry_count": 0,
            "timings_json": "{}",
        }
        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as store_update,
            patch.object(server.render_pool, "list_accounts", return_value=[{"name": "profile-a"}]),
            patch.object(server.render_pool, "_schedulable", return_value=True),
            patch.object(server, "_track_video_task") as track_task,
            patch.object(server.config, "AUTO_CANNOT_ANSWER_RETRIES", 1),
        ):
            scheduled = server._schedule_cannot_answer_retry(
                row,
                "Thông báo: Tôi tạm thời không thể tạo nội dung bạn vừa yêu cầu.",
            )

        self.assertFalse(scheduled)
        store_update.assert_called_once()
        self.assertEqual(
            json.loads(store_update.call_args.kwargs["timings_json"])[
                "cannot_answer_retry_stop_reason"
            ],
            "no_untried_profiles",
        )
        track_task.assert_not_called()

    async def test_poll_http_200_empty_task_id_reply_is_terminal(self):
        reply = (
            "Rất tiếc, tôi không thể tạo video được vào lúc này sau nhiều lần thử. "
            "Image-to-video bị chặn bởi chính sách an toàn nội dung. "
            "Text-to-video liên tục trả về task_id is empty sau ba lần thử."
        )
        page = SimpleNamespace(evaluate=AsyncMock(return_value={
            "ok": True,
            "status": 200,
            "providerErrors": [],
            "texts": [{
                "text": reply,
                "role": "assistant",
                "status": "completed",
                "isFinal": True,
            }],
            "videos": [],
        }))
        context = SimpleNamespace(cookies=AsyncMock(return_value=[]))

        with self.assertRaises(video_worker_ui.ContentPolicyRejectedError):
            await video_worker_ui.poll_conversation(
                "profile-a", page, context, "conversation-a", timeout=30
            )

    async def test_poll_http_200_task_id_empty_without_policy_is_retryable(self):
        page = SimpleNamespace(evaluate=AsyncMock(return_value={
            "ok": True,
            "status": 200,
            "providerErrors": [],
            "texts": [{
                "text": "Text-to-video failed: task_id is empty after three attempts.",
                "role": "assistant",
                "status": "completed",
                "isFinal": True,
            }],
            "videos": [],
        }))
        context = SimpleNamespace(cookies=AsyncMock(return_value=[]))

        with self.assertRaises(video_worker_ui.ProviderTaskIdEmptyError):
            await video_worker_ui.poll_conversation(
                "profile-a", page, context, "conversation-a", timeout=30
            )

    async def test_poll_stops_on_repeated_unreadable_provider_responses(self):
        async def evaluate(script, *_args):
            if script == video_worker_ui.POLL_JS:
                return {
                    "ok": False,
                    "status": 503,
                    "providerErrors": [],
                    "texts": [],
                    "videos": [],
                }
            return ""

        page = SimpleNamespace(evaluate=AsyncMock(side_effect=evaluate))
        context = SimpleNamespace(cookies=AsyncMock(return_value=[]))
        with patch("video_worker_ui.asyncio.sleep", new=AsyncMock()):
            with self.assertRaisesRegex(RuntimeError, "no readable data 3 times"):
                await video_worker_ui.poll_conversation(
                    "profile-a", page, context, "conversation-a", timeout=60
                )

    async def test_download_failure_after_both_media_urls_is_explicit(self):
        with patch.object(
            video_worker,
            "_download",
            new=AsyncMock(side_effect=[OSError("primary unavailable"), OSError("fallback unavailable")]),
        ) as download:
            with self.assertRaisesRegex(
                video_worker.VideoDownloadError, "both original and fallback"
            ):
                await video_worker._download_video_source(
                    {"url": "https://media.example/original", "fallbackUrl": "https://media.example/fallback"},
                    "profile-a",
                )

        self.assertEqual(download.await_count, 2)

    async def test_rate_limited_accepted_job_rotates_once_to_untried_profile(self):
        row = {
            "id": "video-rate-limit",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-a",
            "model": "seedance-2.5",
            "prompt": "A short cinematic scene",
            "ratio": "9:16",
            "duration": 10,
            "reference_images": "[]",
            "reference_image_names": "[]",
            "retry_count": 0,
            "timings_json": json.dumps({"provider_busy_tried_accounts": ["profile-b"]}),
        }
        scheduled = []

        async def fake_run_task(*args, **kwargs):
            return None

        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as store_update,
            patch.object(server.render_pool, "_mark_rate_limited") as mark_rate_limited,
            patch.object(
                server.render_pool,
                "list_accounts",
                return_value=[{"name": "profile-a"}, {"name": "profile-b"}, {"name": "profile-c"}],
            ),
            patch.object(server.render_pool, "_schedulable", return_value=True),
            patch.object(server, "_task_client", return_value={}),
            patch.object(server, "_task_reference_images", return_value=[]),
            patch.object(server, "_task_reference_image_names", return_value=[]),
            patch.object(server, "_run_task", side_effect=fake_run_task) as run_task,
            patch.object(
                server,
                "_track_video_task",
                side_effect=lambda task_id, coroutine: scheduled.append((task_id, coroutine)),
            ),
        ):
            handled = server._schedule_provider_busy_retry(
                row, "Dola rate limit 710022002", rate_limited=True
            )
            await scheduled[0][1]

        self.assertTrue(handled)
        mark_rate_limited.assert_called_once_with("profile-a", "Dola rate limit 710022002")
        self.assertEqual(run_task.call_args.kwargs["excluded_accounts"], ["profile-a", "profile-b"])
        fields = store_update.call_args.kwargs
        self.assertEqual(fields["status"], "submitting")
        timings = json.loads(fields["timings_json"])
        self.assertEqual(timings["rate_limit_tried_accounts"], ["profile-a"])
        self.assertEqual(timings["auto_rate_limit_retry_count"], 1)

    async def test_download_failure_marks_task_failed_without_new_generation(self):
        row = {
            "id": "video-download-failure",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-a",
            "deadline_at": 0,
            "timings_json": "{}",
            "api_key_hash": None,
            "client_concurrency_limit": 0,
            "started_at": None,
        }
        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as store_update,
            patch.object(server.key_limiter, "acquire", new=AsyncMock()),
            patch.object(server.key_limiter, "release", new=AsyncMock()),
            patch.object(
                server.render_pool,
                "resume_video",
                new=AsyncMock(side_effect=video_worker.VideoDownloadError("media fetch failed")),
            ),
            patch.object(server.render_pool, "release_poll_reservation"),
            patch.object(server, "_schedule_provider_busy_retry") as schedule_retry,
        ):
            await server._resume_task(row)

        failed_update = next(
            call.kwargs for call in store_update.call_args_list
            if call.kwargs.get("failure_code") == "VIDEO_DOWNLOAD_FAILED"
        )
        self.assertEqual(failed_update["status"], "failed")
        self.assertEqual(failed_update["error"], "media fetch failed")
        schedule_retry.assert_not_called()

    async def test_resume_rate_limit_releases_poll_and_rotates_profile(self):
        row = {
            "id": "video-resume-rate-limit",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-a",
            "deadline_at": 2_000_000_000,
            "timings_json": "{}",
            "api_key_hash": None,
            "client_concurrency_limit": 0,
            "started_at": None,
        }
        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update"),
            patch.object(server.key_limiter, "acquire", new=AsyncMock()),
            patch.object(server.key_limiter, "release", new=AsyncMock()),
            patch.object(
                server.render_pool,
                "resume_video",
                new=AsyncMock(
                    side_effect=video_worker.PostSubmitRateLimitError("Dola rate limit")
                ),
            ),
            patch.object(server.render_pool, "release_poll_reservation") as release_poll,
            patch.object(server, "_schedule_provider_busy_retry", return_value=True) as rotate,
        ):
            await server._resume_task(row)

        release_poll.assert_called_once_with("profile-a")
        rotate.assert_called_once_with(
            row, "Dola rate limit", rate_limited=True
        )

    def test_unexpected_poll_errors_stop_after_configured_consecutive_limit(self):
        row = {
            "id": "video-repeated-poll-error",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-a",
            "deadline_at": 2_000_000_000,
            "timings_json": json.dumps({"consecutive_unexpected_poll_errors": 2}),
        }
        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as store_update,
            patch.object(server, "_schedule_video_poll") as schedule_poll,
        ):
            keep_polling = server._continue_video_polling(
                row["id"], "unexpected worker error", unexpected_error=True
            )

        self.assertFalse(keep_polling)
        schedule_poll.assert_not_called()
        timings = json.loads(store_update.call_args.kwargs["timings_json"])
        self.assertEqual(timings["consecutive_unexpected_poll_errors"], 3)

    def test_poll_window_end_keeps_task_processing_until_total_deadline(self):
        row = {
            "id": "video-poll-window-end",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-a",
            "deadline_at": 2_000_001_000,
            "timings_json": json.dumps({"conversation_poll_max_wait_sec": 1800}),
        }
        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as store_update,
            patch.object(server.time, "time", return_value=2_000_000_000),
            patch.object(server.render_pool, "reserve_for_poll") as reserve_poll,
            patch.object(server, "_schedule_video_poll", return_value=True) as schedule_poll,
        ):
            keep_polling = server._continue_video_polling(
                row["id"], "Dola vẫn đang tạo video; cửa sổ poll 72s đã kết thúc"
            )

        self.assertTrue(keep_polling)
        reserve_poll.assert_called_once_with("profile-a")
        schedule_poll.assert_called_once_with(row["id"], None)
        fields = store_update.call_args.kwargs
        self.assertEqual(fields["status"], "processing")
        self.assertIsNone(fields["failure_code"])
        self.assertIn("cửa sổ poll vừa kết thúc, chưa hết hạn chờ tổng", fields["error"])
        self.assertIn("còn khoảng 1000s/1800s", fields["error"])

    def test_proxy_backoff_does_not_exhaust_poll_error_streak(self):
        row = {
            "id": "video-proxy-backoff",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-a",
            "deadline_at": 2_000_000_000,
            "timings_json": json.dumps({"consecutive_unexpected_poll_errors": 2}),
        }
        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update") as store_update,
            patch.object(server, "_schedule_video_poll") as schedule_poll,
        ):
            keep_polling = server._continue_video_polling(
                row["id"],
                "ProxyFB đang backoff thêm khoảng 299s sau lỗi trước",
                recoverable_error=True,
                retry_delay_sec=server._proxy_poll_retry_delay(
                    "ProxyFB đang backoff thêm khoảng 299s sau lỗi trước"
                ),
            )

        self.assertTrue(keep_polling)
        schedule_poll.assert_called_once_with(row["id"], 299)
        timings = json.loads(store_update.call_args.kwargs["timings_json"])
        self.assertEqual(timings["consecutive_unexpected_poll_errors"], 0)

    def test_transient_dola_navigation_timeout_is_not_terminal(self):
        self.assertTrue(server._is_recoverable_poll_dependency_error(
            RuntimeError(
                "Page.goto: net::ERR_TIMED_OUT at "
                "https://www.dola.com/chat/conversation-a"
            )
        ))
        self.assertTrue(server._is_recoverable_poll_dependency_error(
            RuntimeError(
                "Dola poll failed to return a readable response 3 times in a row: "
                "Page.evaluate: TypeError: Failed to fetch"
            )
        ))
        self.assertTrue(server._is_recoverable_poll_dependency_error(
            RuntimeError("Dola poll returned no readable data 3 times in a row")
        ))
        self.assertFalse(server._is_recoverable_poll_dependency_error(
            RuntimeError("unexpected worker state")
        ))

    async def test_resume_poll_is_bounded_by_remaining_total_deadline(self):
        row = {
            "id": "video-poll-deadline-budget",
            "status": "processing",
            "account": "profile-a",
            "conversation_id": "conversation-a",
            "deadline_at": time.time() + 0.05,
            "timings_json": json.dumps({"conversation_poll_max_wait_sec": 1800}),
            "api_key_hash": None,
            "client_concurrency_limit": 0,
            "started_at": time.time(),
        }
        updates = []

        async def slow_resume(*_args, **_kwargs):
            await asyncio.sleep(1)

        started = time.monotonic()
        with (
            patch.object(server.store, "get", return_value=row),
            patch.object(server.store, "update", side_effect=lambda *args, **kwargs: updates.append(kwargs)),
            patch.object(server.key_limiter, "acquire", new=AsyncMock()),
            patch.object(server.key_limiter, "release", new=AsyncMock()),
            patch.object(server.render_pool, "resume_video", new=AsyncMock(side_effect=slow_resume)),
            patch.object(server.render_pool, "release_poll_reservation"),
        ):
            await server._resume_task(row)
        elapsed = time.monotonic() - started

        self.assertLess(elapsed, 0.5)
        failed_updates = [item for item in updates if item.get("status") == "failed"]
        self.assertEqual(failed_updates[-1]["failure_code"], "RENDER_TIMEOUT")


if __name__ == "__main__":
    unittest.main()

import json
import unittest
from unittest.mock import AsyncMock, MagicMock

import video_worker_ui as worker


class VideoPayloadTests(unittest.IsolatedAsyncioTestCase):
    def test_original_thirty_second_payload_is_recognized(self):
        self.assertEqual(worker._coerce_duration("30"), 30)
        self.assertIsNone(worker._coerce_duration("31"))

    def test_generation_failed_without_charge_is_terminal_not_credit_exhaustion(self):
        text = "I can't generate the video. No credits were used."
        self.assertIsNotNone(worker.PROVIDER_REJECTION_PATTERN.search(text))
        self.assertFalse(worker._is_credit_cost_exceeded_error(text))
        self.assertIn("từ chối", worker._classify_submission_error(text))

    def test_credit_cost_gate_is_terminal_and_reports_requested_balance(self):
        text = (
            "Generating with the current parameters will use 18 video credits. "
            "You only have 4 left today. Change the parameters and try again."
        )
        self.assertTrue(worker._is_credit_cost_exceeded_error(text))
        message = worker._classify_submission_error(text)
        self.assertIn("18", message)
        self.assertIn("4", message)
        self.assertIn("dừng trước khi chờ render", message)

    def test_accepted_generation_balance_message_is_not_cost_rejection(self):
        text = (
            "The video will be generated using the Dreamina Seedance 2.5 model. "
            "It will use 4 credits and be ready in 15 minutes. "
            "You still have 0 video credits left today."
        )
        self.assertFalse(worker._is_credit_cost_exceeded_error(text))

    def test_rolling_seven_day_limit_is_terminal_not_render_timeout(self):
        for text in [
            "You have reached the video generation limit for 7 days. Please try again later.",
            "Video generation is limited for the next 7-day period. Try again after 7 days.",
            "Bạn đã đạt hạn mức tạo video trong 7 ngày.",
        ]:
            self.assertTrue(worker.DAILY_LIMIT_PATTERN.search(text), text)
            self.assertEqual(
                worker._classify_submission_error(text),
                worker.VIDEO_LIMIT_MESSAGE,
            )

    def test_daily_limit_requires_explicit_exhaustion_not_a_prompt_mention(self):
        actual_limit = "You have reached your daily video generation limit. Please try again tomorrow."
        for text in [
            actual_limit,
            "The daily video generation limit has been reached.",
            "You have reached the daily quota.",
        ]:
            self.assertTrue(worker.DAILY_LIMIT_PATTERN.search(text), text)
        self.assertEqual(
            worker._classify_submission_error(actual_limit),
            worker.VIDEO_LIMIT_MESSAGE,
        )

        for text in [
            "Write a story that mentions a daily limit but do not stop the video.",
            "The video will be generated; you still have 0 video credits left today.",
        ]:
            self.assertFalse(worker.DAILY_LIMIT_PATTERN.search(text), text)

        self.assertIsNone(worker._terminal_provider_response_error(
            "User prompt: You have reached your daily video generation limit."
        ))

    def test_poll_texts_accept_only_final_assistant_messages(self):
        poll = {
            "texts": [
                {"text": "Prompt mentions daily limit", "role": "user", "status": "done"},
                {"text": "Thinking: checking the quota", "role": "assistant", "status": "thinking"},
                {"text": "Still streaming", "role": "assistant", "status": "streaming"},
                {"text": "You have reached your daily video generation limit.",
                 "role": "assistant", "status": "done", "isFinal": True},
                "unattributed legacy text",
            ]
        }
        self.assertEqual(
            worker.provider_response_texts(poll),
            ["You have reached your daily video generation limit."],
        )
        self.assertEqual(
            worker.provider_response_texts(poll, include_in_progress=True),
            [
                "Thinking: checking the quota",
                "Still streaming",
                "You have reached your daily video generation limit.",
            ],
        )

    def test_provider_policy_refusal_mentions_blocked_safety_filter(self):
        text = (
            "The requested video was blocked by the safety filter. "
            "The system will not allow another retry with the same prompt."
        )
        self.assertTrue(worker._is_content_policy_rejection_error(text))
        self.assertIsInstance(
            worker._terminal_provider_response_error(text),
            worker.ContentPolicyRejectedError,
        )

    def test_duration_capability_response_is_classified(self):
        text = 'Video generation currently supports durations from 4 to 15 seconds. I can generate it at the nearest supported duration.'
        self.assertIsNotNone(worker.PROVIDER_REJECTION_PATTERN.search(text))
        self.assertTrue(worker._is_duration_capability_error(text))
        self.assertEqual(
            worker._classify_submission_error(text),
            worker.DURATION_CAPABILITY_MESSAGE,
        )

    def test_duration_capability_response_accepts_dash_variant(self):
        text = "Video generation currently supports durations from 4–15 seconds."
        self.assertTrue(worker._is_duration_capability_error(text))

    def test_something_went_wrong_response_is_classified(self):
        text = "Something went wrong. Please try again."
        self.assertIsNotNone(worker.PROVIDER_REJECTION_PATTERN.search(text))
        self.assertTrue(worker._is_something_went_wrong_error(text))
        self.assertTrue(worker._is_fresh_chat_retry_error(text))
        self.assertEqual(
            worker._classify_submission_error(text),
            worker.SOMETHING_WENT_WRONG_MESSAGE,
        )

    def test_submit_overload_with_ack_uses_profile_rotation_not_global_cooldown(self):
        raw = (
            "The service is experiencing high demand. Please try again later. "
            "[Download the Dola desktop app](https://www.dola.com/download/desktop) "
            "for faster access to the Pro Mode."
        )
        message = worker._classify_submission_error(raw)
        self.assertIn("quá tải", message)

        error = worker._submission_error_exception(
            message,
            conversation_accepted=True,
        )

        self.assertIsInstance(error, worker.ProviderBusyError)
        self.assertNotIsInstance(error, worker.RiskControlError)

    def test_sse_capture_keeps_reading_after_ack_for_plain_text_overload(self):
        script = worker._INSTALL_CONVERSATION_CAPTURE_JS
        self.assertIn("STREAM_MSG_NOTIFY", script)
        self.assertIn("STREAM_CHUNK", script)
        self.assertIn("text_block", script)
        self.assertIn("provider_busy_response:", script)
        self.assertNotIn("if (state.ids.length) break;", script)

    def test_real_risk_control_with_ack_still_uses_global_risk_path(self):
        message = worker._classify_submission_error(
            {"error_code": "710022004", "message": "shark_admin verification required"}
        )

        error = worker._submission_error_exception(
            message,
            conversation_accepted=True,
        )

        self.assertIsInstance(error, worker.RiskControlError)
        self.assertNotIsInstance(error, worker.ProviderBusyError)

    def test_cannot_answer_response_is_classified_for_fresh_chat_retry(self):
        text = "I can't answer your question"
        self.assertTrue(worker._is_cannot_answer_question_error(text))
        self.assertFalse(worker._is_content_policy_rejection_error(text))
        self.assertTrue(worker._is_fresh_chat_retry_error(text))
        self.assertEqual(
            worker._classify_submission_error(text),
            worker.CANNOT_ANSWER_QUESTION_MESSAGE,
        )
        self.assertEqual(
            worker.CannotAnswerQuestionError.failure_code,
            "PROVIDER_CANNOT_ANSWER",
        )

    def test_temporary_image_video_decline_is_retryable(self):
        for text, expected in [
            (
                "I am temporarily unable to generate the video content you requested. "
                "The image-to-video generation system has declined this particular request.",
                worker.PROFILE_ROTATION_NO_VIDEO_MESSAGE,
            ),
            (
                "The system indicates that the requested video generation cannot be performed temporarily.",
                worker.CANNOT_ANSWER_QUESTION_MESSAGE,
            ),
        ]:
            self.assertTrue(worker._is_cannot_answer_question_error(text))
            self.assertEqual(
                worker._classify_submission_error(text),
                expected,
            )

    def test_confirmation_round_response_is_retryable_in_a_fresh_chat(self):
        text = (
            "It is identified that a confirmation round is required before proceeding "
            "with the video generation as specified by the creative-video skill rules."
        )
        self.assertTrue(worker._is_cannot_answer_question_error(text))
        self.assertTrue(worker._is_fresh_chat_retry_error(text))
        self.assertEqual(
            worker._classify_submission_error(text),
            worker.CANNOT_ANSWER_QUESTION_MESSAGE,
        )
        terminal = worker._terminal_provider_response_error(text)
        self.assertIsInstance(terminal, worker.CannotAnswerQuestionError)

    def test_generic_unable_to_generate_content_is_not_credit_failure(self):
        text = (
            "I am temporarily unable to generate the content you requested. "
            "Please try entering a different prompt."
        )
        # The broad legacy credit regex also matches "unable to generate";
        # classify this no-video response before the credit fallback.
        self.assertTrue(worker.CREDIT_FAIL_PATTERN.search(text))
        self.assertTrue(worker._is_cannot_answer_question_error(text))
        self.assertEqual(
            worker._classify_submission_error(text),
            worker.PROFILE_ROTATION_NO_VIDEO_MESSAGE,
        )

    def test_vietnamese_generic_no_video_response_is_fresh_chat_retry(self):
        text = (
            "Tôi tạm thời không thể tạo nội dung bạn yêu cầu. "
            "Vui lòng thử nhập các yêu cầu khác, tôi sẽ cố gắng hỗ trợ bạn tốt nhất có thể."
        )
        self.assertTrue(worker._is_cannot_answer_question_error(text))
        self.assertFalse(worker._is_content_policy_rejection_error(text))
        self.assertTrue(worker._is_fresh_chat_retry_error(text))
        self.assertEqual(
            worker._classify_submission_error(text),
            worker.CANNOT_ANSWER_QUESTION_MESSAGE,
        )

    def test_exact_vietnamese_temporary_no_video_response_is_not_policy_refusal(self):
        text = (
            "Thông báo: Tôi tạm thời không thể tạo nội dung bạn vừa yêu cầu. "
            "Bạn vui lòng thử nhập các yêu cầu khác, tôi sẽ cố gắng hỗ trợ tốt nhất có thể."
        )
        self.assertTrue(worker._is_cannot_answer_question_error(text))
        self.assertFalse(worker._is_content_policy_rejection_error(text))
        self.assertIsInstance(
            worker._terminal_provider_response_error(text),
            worker.CannotAnswerQuestionError,
        )

    def test_vietnamese_current_no_video_response_is_fresh_chat_retry(self):
        text = (
            "Hiện tôi chưa thể tạo được video cho cảnh này. "
            "Vui lòng thử nhập các yêu cầu khác."
        )
        self.assertTrue(worker._is_cannot_answer_question_error(text))
        self.assertFalse(worker._is_content_policy_rejection_error(text))
        self.assertTrue(worker._is_fresh_chat_retry_error(text))
        self.assertEqual(
            worker._classify_submission_error(text),
            worker.CANNOT_ANSWER_QUESTION_MESSAGE,
        )

    def test_vietnamese_mixed_no_video_and_content_block_is_policy_refusal(self):
        text = (
            "Hiện tôi chưa thể tạo được video cho cảnh này. Cả hai đường tạo video "
            "đều gặp lỗi: một lần bị chặn nội dung và hai lần lỗi kỹ thuật "
            "(không nhận được task_id)."
        )
        self.assertTrue(worker._is_cannot_answer_question_error(text))
        self.assertTrue(worker._is_content_policy_rejection_error(text))
        error = worker._terminal_provider_response_error(text)
        self.assertIsInstance(error, worker.ContentPolicyRejectedError)

    def test_vietnamese_generic_no_video_response_is_fresh_chat_retry(self):
        text = (
            "Tôi hiện không thể tạo nội dung video bạn yêu cầu. "
            "Vui lòng thử nhập các yêu cầu khác."
        )
        self.assertTrue(worker._is_cannot_answer_question_error(text))
        self.assertFalse(worker._is_content_policy_rejection_error(text))
        self.assertTrue(worker._is_fresh_chat_retry_error(text))
        self.assertEqual(
            worker._classify_submission_error(text),
            worker.CANNOT_ANSWER_QUESTION_MESSAGE,
        )

    def test_prompt_adjustment_question_rotates_to_an_untried_profile(self):
        text = (
            "Để tôi tạo được video, bạn có thể chọn một trong các hướng sửa: "
            "Bạn muốn tôi thử lại theo hướng nào? Tôi sẽ viết lại prompt và tạo ngay "
            "khi có yêu cầu điều chỉnh."
        )

        self.assertTrue(worker._is_profile_rotation_no_video_error(text))
        self.assertFalse(worker._provider_is_retrying_after_filter_error(text))
        self.assertTrue(worker._is_fresh_chat_retry_error(text))
        self.assertEqual(
            worker._classify_submission_error(text),
            worker.PROFILE_ROTATION_NO_VIDEO_MESSAGE,
        )
        self.assertIsInstance(
            worker._terminal_provider_response_error(text),
            worker.ProfileRotationRetryError,
        )

    def test_vietnamese_blocked_video_response_is_policy_refusal(self):
        text = (
            "Rất tiếc, tôi tạm thời không thể tạo được nội dung video bạn yêu cầu "
            "(hệ thống đã chặn yêu cầu này và không cho phép thử lại)."
        )
        self.assertTrue(worker._is_content_policy_rejection_error(text))
        self.assertTrue(worker._is_cannot_answer_question_error(text))
        self.assertEqual(
            worker._classify_submission_error(text),
            worker.CONTENT_POLICY_REJECTION_MESSAGE,
        )
        error = worker._terminal_provider_response_error(text)
        self.assertIsInstance(error, worker.ContentPolicyRejectedError)

    def test_final_vietnamese_content_block_stops_instead_of_polling_or_retrying(self):
        text = (
            "Nội dung yêu cầu vừa rồi bị hệ thống chặn tạm thời. "
            "Tôi sẽ thử lại một lần với mô tả được điều chỉnh nhẹ nhàng hơn. "
            "Rất tiếc, hệ thống an toàn nội dung đã tạm thời chặn việc tạo video "
            "cho cảnh này (có thể do vũ khí và không khí đối đầu căng thẳng trong "
            "khung hình tham chiếu), và tôi không thể thử lại yêu cầu này nữa. "
            "Vui lòng chọn khung hình tham chiếu mới không chứa vũ khí."
        )
        self.assertTrue(worker._is_content_policy_rejection_error(text))
        self.assertTrue(worker._is_final_content_policy_refusal(text))
        self.assertFalse(worker._provider_is_retrying_after_filter_error(text))
        error = worker._terminal_provider_response_error(text)
        self.assertIsInstance(error, worker.ContentPolicyFinalRefusalError)

    def test_intermediate_policy_retry_is_not_a_final_refusal(self):
        text = (
            "The content filter blocked this attempt. I will try another "
            "Seedance route with the same safe scene."
        )
        self.assertTrue(worker._is_content_policy_rejection_error(text))
        self.assertFalse(worker._is_final_content_policy_refusal(text))

    def test_english_prohibited_generation_is_not_misclassified_as_credit(self):
        text = (
            "The system has prohibited the video generation; retries are not allowed, "
            "and the service is unable to generate the requested video."
        )
        self.assertTrue(worker.CREDIT_FAIL_PATTERN.search(text))
        self.assertTrue(worker._is_content_policy_rejection_error(text))
        self.assertEqual(
            worker._classify_submission_error(text),
            worker.CONTENT_POLICY_REJECTION_MESSAGE,
        )
        error = worker._terminal_provider_response_error(text)
        self.assertIsInstance(error, worker.ContentPolicyRejectedError)

    async def test_poll_fetch_failure_checks_visible_policy_refusal(self):
        page = MagicMock(url="https://www.dola.com/chat/38417877323882001")
        page.evaluate = AsyncMock(side_effect=[
            RuntimeError("Page.evaluate: TypeError: Failed to fetch"),
            (
                "Rất tiếc, tôi tạm thời không thể tạo được nội dung video bạn yêu cầu "
                "(hệ thống đã chặn yêu cầu này và không cho phép thử lại)."
            ),
        ])
        context = MagicMock()
        context.cookies = AsyncMock(return_value=[])
        with self.assertRaises(worker.ContentPolicyRejectedError):
            await worker.poll_conversation(
                "profile", page, context, "38417877323882001", timeout=60
            )
        self.assertEqual(page.evaluate.await_count, 2)

    async def test_poll_success_without_media_checks_visible_policy_refusal(self):
        page = MagicMock(url="https://www.dola.com/chat/38417877323882001")
        page.evaluate = AsyncMock(side_effect=[
            {"ok": True, "texts": [], "videos": [], "providerErrors": []},
            "The video generation request was blocked by the content safety filter.",
        ])
        context = MagicMock()
        context.cookies = AsyncMock(return_value=[])
        with self.assertRaises(worker.ContentPolicyRejectedError):
            await worker.poll_conversation(
                "profile", page, context, "38417877323882001", timeout=60
            )
        self.assertEqual(page.evaluate.await_count, 2)

    async def test_submission_blocks_extra_reference_images(self):
        body = {
            "messages": [{
                "role": "user",
                "attachments": [
                    {"image_url": "https://cdn.example.test/reference-1.png"},
                    {"image_url": "https://cdn.example.test/stale-reference-2.png"},
                ],
            }],
        }
        route = MagicMock()
        route.request.post_data = json.dumps(body)
        route.continue_ = AsyncMock()

        with self.assertRaises(worker.PromptPayloadError) as raised:
            await worker._rewrite_generation_request(
                route,
                "seedance_v2.5",
                15,
                expected_reference_count=1,
                pro_chat=True,
            )

        self.assertIn("thừa ảnh tham chiếu", str(raised.exception))
        route.continue_.assert_not_awaited()

    async def test_text_only_submission_blocks_stale_reference_images(self):
        body = {
            "messages": [{
                "role": "user",
                "attachments": [{"image_url": "https://cdn.example.test/stale.png"}],
            }],
        }
        route = MagicMock()
        route.request.post_data = json.dumps(body)
        route.continue_ = AsyncMock()

        with self.assertRaises(worker.PromptPayloadError) as raised:
            await worker._rewrite_generation_request(
                route,
                "seedance_v2.5",
                15,
                expected_reference_count=0,
                pro_chat=True,
            )

        self.assertIn("thừa ảnh tham chiếu", str(raised.exception))
        route.continue_.assert_not_awaited()

    async def test_verified_upload_allows_schema_that_hides_current_images(self):
        body = {
            "messages": [{
                "role": "user",
                "content": "Tạo video: current prompt",
                "attachments": [],
            }],
        }
        route = MagicMock()
        route.request.post_data = json.dumps(body)
        route.continue_ = AsyncMock()

        result = await worker._rewrite_generation_request(
            route,
            "seedance_v2.5",
            15,
            expected_prompt="Tạo video: current prompt",
            expected_reference_count=2,
            expected_references_verified=True,
            pro_chat=True,
        )

        self.assertTrue(result["generation"])
        self.assertEqual(result["reference_count"], 0)
        route.continue_.assert_awaited_once_with()

    async def test_content_image_block_is_counted_before_submission(self):
        body = {
            "messages": [{
                "role": "user",
                "content": [{
                    "type": "image",
                    "image_url": "https://cdn.example.test/reference-1.png",
                }],
            }],
        }
        route = MagicMock()
        route.request.post_data = json.dumps(body)
        route.continue_ = AsyncMock()

        with self.assertRaises(worker.PromptPayloadError) as raised:
            await worker._rewrite_generation_request(
                route,
                "seedance_v2.5",
                15,
                expected_reference_count=0,
                pro_chat=True,
            )

        self.assertIn("thừa ảnh tham chiếu", str(raised.exception))
        route.continue_.assert_not_awaited()

    def test_reference_count_is_anchored_to_current_prompt_not_history(self):
        body = {
            "messages": [
                {
                    "role": "user",
                    "content": "old prompt",
                    "attachments": [
                        {"image_url": f"https://cdn.example.test/old-{index}.png"}
                        for index in range(1, 20)
                    ],
                },
                {
                    "role": "user",
                    "content": "Tạo video: current prompt, thời lượng 15s",
                    "attachments": [
                        {"image_url": f"https://cdn.example.test/current-{index}.png"}
                        for index in range(1, 4)
                    ],
                },
            ],
        }
        self.assertEqual(
            worker._extract_submission_reference_count(
                body, expected_prompt="Tạo video: current prompt, thời lượng 15s"
            ),
            3,
        )

    def test_text_only_current_prompt_ignores_image_history(self):
        body = {
            "messages": [
                {
                    "role": "user",
                    "content": "old prompt",
                    "attachments": [{"image_url": "https://cdn.example.test/old.png"}],
                },
                {"role": "user", "content": "Tạo video: text only"},
            ],
        }
        self.assertEqual(
            worker._extract_submission_reference_count(
                body, expected_prompt="Tạo video: text only"
            ),
            0,
        )

    def test_vietnamese_content_standards_refusal_is_not_render_timeout(self):
        text = (
            "Yêu cầu chứa các yếu tố căng thẳng liên quan đến bị trói buộc, "
            "nguy cơ ngạt thở và tình huống sinh tồn cực đoan có thể không phù hợp "
            "với tiêu chuẩn nội dung cho phép"
        )
        self.assertTrue(worker._is_content_policy_rejection_error(text))
        self.assertFalse(worker._is_cannot_answer_question_error(text))
        self.assertTrue(worker._is_fresh_chat_retry_error(text))
        self.assertEqual(
            worker._classify_submission_error(text),
            worker.CONTENT_POLICY_REJECTION_MESSAGE,
        )

    def test_vietnamese_story_policy_refusal_is_not_render_timeout(self):
        text = (
            "Tôi tạm thời không thể tạo nội dung video bạn yêu cầu do có các yếu tố "
            "liên quan đến vũ khí, tình huống đối đầu căng thẳng và lệnh bắn súng "
            "trong cốt truyện."
        )
        self.assertTrue(worker._is_content_policy_rejection_error(text))
        self.assertFalse(worker._is_cannot_answer_question_error(text))
        self.assertTrue(worker._is_fresh_chat_retry_error(text))
        self.assertEqual(
            worker._classify_submission_error(text),
            worker.CONTENT_POLICY_REJECTION_MESSAGE,
        )

    def test_english_content_refusal_is_terminal_not_timeout(self):
        text = "I can't generate the requested content. Try something else."
        self.assertIsNotNone(worker.PROVIDER_REJECTION_PATTERN.search(text))
        self.assertEqual(
            worker._classify_submission_error(text),
            "Dola từ chối nội dung yêu cầu, chưa chấp nhận conversation",
        )

    def test_system_prohibits_generation_is_content_policy_retry(self):
        text = (
            "The system prohibits content generation for the requested video "
            "creation task, indicating that the related request cannot be fulfilled as planned."
        )
        self.assertTrue(worker._is_content_policy_rejection_error(text))
        self.assertTrue(worker._is_fresh_chat_retry_error(text))
        self.assertEqual(
            worker._classify_submission_error(text),
            worker.CONTENT_POLICY_REJECTION_MESSAGE,
        )

    def test_generated_video_wrapper_keeps_commas_inside_prompt(self):
        prompt = "Scene one, close-up, warm light, then pan left, keep the title, and fade out."
        wrapped = worker._prompt_text_with_wrapper(
            "Generated video: old prompt, 9:16", prompt, "9:16"
        )
        self.assertEqual(wrapped, f"Generated video: {prompt}, 9:16")
        self.assertEqual(worker._prompt_without_wrapper(wrapped, "9:16"), prompt)

    def test_ratio_suffix_only_strips_terminal_separator(self):
        prompt = "Keep the phrase, 9:16, visible in the scene, then zoom out."
        wrapped = f"Generated video: {prompt}, 9:16"
        self.assertEqual(worker._prompt_without_wrapper(wrapped, "9:16"), prompt)

    async def test_native_wrapper_with_many_commas_verifies_full_prompt(self):
        prompt = "Shot one, shot two, camera pans, sparks fly, then fade to black."
        route = self.route()
        body = json.loads(route.request.post_data)
        body["messages"][0]["content"] = f"Generated video: {prompt}, 9:16"
        ability_param = json.loads(body["chat_ability"]["ability_param"])
        ability_param["input_box_content"]["user_input_content"] = prompt
        body["chat_ability"]["ability_param"] = json.dumps(ability_param)
        route.request.post_data = json.dumps(body)
        result = await worker._rewrite_generation_request(
            route,
            "seedance_v2.5",
            15,
            expected_prompt=prompt,
            expected_ratio="9:16",
            force_video_payload=True,
        )
        self.assertTrue(result["prompt_verified"])
        self.assertEqual(result["prompt_chars"], len(prompt))
        route.continue_.assert_awaited_once_with()

    def route(self, duration=15):
        body = {
            "chat_ability": worker._new_video_ability_config(
                "seedance_v2.5", duration, "A landscape", "9:16"
            ),
            "messages": [{"role": "user", "content": "A landscape"}],
        }
        route = MagicMock()
        route.request.post_data = json.dumps(body, indent=2)
        route.continue_ = AsyncMock()
        return route

    async def submit(self, route):
        return await worker._rewrite_generation_request(
            route, "seedance_v2.5", 15,
            expected_prompt="A landscape", expected_ratio="9:16",
            force_video_payload=True,
        )

    async def test_valid_15s_keeps_original_request_bytes(self):
        route = self.route()
        result = await self.submit(route)
        self.assertFalse(result["payload_changed"])
        self.assertTrue(result["prompt_verified"])
        route.continue_.assert_awaited_once_with()

    async def test_native_english_wrapper_keeps_request_bytes(self):
        route = self.route()
        body = json.loads(route.request.post_data)
        body['messages'][0]['content'] = 'Generated video: A landscape, 9:16'
        route.request.post_data = json.dumps(body)
        result = await self.submit(route)
        self.assertFalse(result['payload_changed'])
        route.continue_.assert_awaited_once_with()

    async def test_wrong_prompt_is_blocked(self):
        route = self.route()
        body = json.loads(route.request.post_data)
        body['messages'][0]['content'] = 'Another landscape'
        route.request.post_data = json.dumps(body)
        with self.assertRaises(worker.PromptPayloadError):
            await self.submit(route)
        route.continue_.assert_not_awaited()

    async def test_wrong_native_ratio_or_ability_prompt_is_blocked(self):
        for field, value in [('ratio', '16:9'), ('input_box_content', {'user_input_content': 'wrong'})]:
            with self.subTest(field=field):
                route = self.route()
                body = json.loads(route.request.post_data)
                param = json.loads(body['chat_ability']['ability_param'])
                param[field] = value
                body['chat_ability']['ability_param'] = json.dumps(param)
                route.request.post_data = json.dumps(body)
                with self.assertRaises(worker.PromptPayloadError):
                    await self.submit(route)
                route.continue_.assert_not_awaited()

    async def test_valid_fast_variant_and_parameter_whitespace_preserved(self):
        route = self.route()
        body = json.loads(route.request.post_data)
        param = json.loads(body["chat_ability"]["ability_param"])
        param["model"] = "seedance_v2.5_fast"
        body["chat_ability"]["ability_param"] = json.dumps(param, indent=2)
        route.request.post_data = json.dumps(body, indent=2)
        result = await self.submit(route)
        self.assertFalse(result["payload_changed"])
        route.continue_.assert_awaited_once_with()

    def test_error_diagnostics_exclude_secrets_and_prompt(self):
        self.assertEqual(worker._submission_error_codes(
            {'error_code': 710022002, 'token': 'secret', 'prompt': 'private'}
        ), ['710022002'])

    async def test_stale_duration_is_blocked_not_rewritten(self):
        route = self.route(duration=10)
        with self.assertRaises(worker.PromptPayloadError):
            await self.submit(route)
        route.continue_.assert_not_awaited()

    async def test_plain_chat_is_not_fabricated_into_video(self):
        route = self.route()
        route.request.post_data = json.dumps({"messages": [{"content": "A landscape"}]})
        with self.assertRaisesRegex(worker.PromptPayloadError, "chat thường"):
            await self.submit(route)
        route.continue_.assert_not_awaited()

    async def test_unrelated_chat_is_untouched_outside_submission(self):
        route = self.route()
        route.request.post_data = '{"messages": []}'
        result = await worker._rewrite_generation_request(route, "seedance_v2.5", 15)
        self.assertFalse(result["generation"])
        route.continue_.assert_awaited_once_with()

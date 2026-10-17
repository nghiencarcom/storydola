import json
import unittest

from browser import _chat_probe_response_text, _chat_probe_result_is_valid


class LoginChatProbeTests(unittest.TestCase):
    def test_extracts_text_block_from_sse(self):
        payload = {
            "content": {
                "content_block": [
                    {"content": {"text_block": {"text": "OK"}}}
                ]
            }
        }
        raw = "event: STREAM_MSG_NOTIFY\ndata: " + json.dumps(payload) + "\n\n"
        self.assertEqual(_chat_probe_response_text(raw), "OK")
        self.assertTrue(_chat_probe_result_is_valid("OK"))

    def test_extracts_text_from_patch_event(self):
        payload = {
            "patch_op": [{
                "patch_value": {
                    "content_block": [
                        {"content": {"text_block": {"text": "Tôi có thể giúp bạn."}}}
                    ]
                }
            }]
        }
        raw = "data: " + json.dumps(payload) + "\n\n"
        self.assertEqual(
            _chat_probe_response_text(raw),
            "Tôi có thể giúp bạn.",
        )

    def test_rejects_login_or_no_result_response(self):
        self.assertFalse(
            _chat_probe_result_is_valid("Please log in to continue.")
        )
        self.assertFalse(
            _chat_probe_result_is_valid("I can't answer your question.")
        )


if __name__ == "__main__":
    unittest.main()

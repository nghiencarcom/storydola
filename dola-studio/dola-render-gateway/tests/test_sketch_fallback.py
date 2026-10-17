import time
import unittest
from unittest.mock import patch

import sketch_fallback


class SketchFallbackTests(unittest.TestCase):
    def test_api_key_auth_does_not_mix_session_credentials(self):
        with patch.object(sketch_fallback.config, "MAIVIDEO_API_KEY", "api-key"), patch.object(
            sketch_fallback.config, "MAIVIDEO_AUTH_TOKEN", "session-token"
        ):
            headers = sketch_fallback._headers()

        self.assertEqual(headers["X-API-Key"], "api-key")
        self.assertNotIn("Authorization", headers)
        self.assertNotIn("X-Auth-Token", headers)

    def test_session_auth_uses_documented_bearer_header(self):
        with patch.object(sketch_fallback.config, "MAIVIDEO_API_KEY", ""), patch.object(
            sketch_fallback.config, "MAIVIDEO_AUTH_TOKEN", "session-token"
        ):
            headers = sketch_fallback._headers()

        self.assertEqual(headers["Authorization"], "Bearer session-token")
        self.assertNotIn("X-API-Key", headers)
        self.assertNotIn("X-Auth-Token", headers)

    def test_image_generation_create_and_poll_use_public_api_base(self):
        requested = []

        async def fake_read_json(session, url, *, method="GET", body=None):
            requested.append((method, url))
            if method == "POST":
                return {"status": "queued", "job_id": "image-job-1"}
            return {
                "status": "completed",
                "images": [{
                    "model": "gemini-3.1-flash",
                    "file_url": "https://cdn.example.test/sketch.png",
                }],
            }

        async def run_test():
            with patch.object(
                sketch_fallback.config, "MAIVIDEO_PUBLIC_URL", "https://maivideo.top"
            ), patch("sketch_fallback._read_json", side_effect=fake_read_json):
                return await sketch_fallback._create_one(
                    object(),
                    "https://example.test/reference.png",
                    time.monotonic() + 60,
                )

        import asyncio

        result = asyncio.run(run_test())
        self.assertEqual(result, "https://cdn.example.test/sketch.png")
        self.assertEqual(
            requested,
            [
                ("POST", "https://maivideo.top/api/v1/image-generation"),
                ("GET", "https://maivideo.top/api/v1/image-generation/image-job-1"),
            ],
        )

    def test_media_proxy_reference_becomes_public_static_url(self):
        source = (
            "https://seedance.maivideo.top/api/media/files?source=uploads"
            "&path=folder/My%20Reference.png&session_id=user_abc"
        )
        with patch.object(sketch_fallback.config, "MAIVIDEO_PUBLIC_URL", "https://maivideo.top"):
            result = sketch_fallback._public_reference_url(source)
        self.assertEqual(
            result,
            "https://maivideo.top/static/uploads/folder/My%20Reference.png?session_id=user_abc",
        )

    def test_local_result_url_becomes_public_static_url(self):
        with patch.object(sketch_fallback.config, "MAIVIDEO_PUBLIC_URL", "https://maivideo.top"), patch.object(
            sketch_fallback.config, "MAIVIDEO_API_KEY", ""
        ), patch.object(sketch_fallback.config, "MAIVIDEO_AUTH_TOKEN", ""):
            result = sketch_fallback._public_output_url(
                "http://127.0.0.1:8000/static/outputs/sketch.png",
                "user_abc",
            )
        self.assertEqual(
            result,
            "https://maivideo.top/static/outputs/sketch.png?session_id=user_abc",
        )

    def test_public_result_url_receives_source_session(self):
        with patch.object(sketch_fallback.config, "MAIVIDEO_PUBLIC_URL", "https://maivideo.top"), patch.object(
            sketch_fallback.config, "MAIVIDEO_API_KEY", ""
        ), patch.object(sketch_fallback.config, "MAIVIDEO_AUTH_TOKEN", ""):
            result = sketch_fallback._public_output_url(
                "https://maivideo.top/static/exports/sketch.png",
                "user_abc",
            )
        self.assertEqual(
            result,
            "https://maivideo.top/static/exports/sketch.png?session_id=user_abc",
        )

    def test_server_owned_result_drops_source_session(self):
        with patch.object(sketch_fallback.config, "MAIVIDEO_PUBLIC_URL", "https://maivideo.top"), patch.object(
            sketch_fallback.config, "MAIVIDEO_API_KEY", "service-key"
        ), patch.object(sketch_fallback.config, "MAIVIDEO_AUTH_TOKEN", ""):
            result = sketch_fallback._public_output_url(
                "http://127.0.0.1:8000/static/exports/sketch.png?session_id=user_abc",
                "user_abc",
            )
        self.assertEqual(result, "https://maivideo.top/static/exports/sketch.png")

    def test_non_loopback_provider_url_is_preserved(self):
        source = "https://cdn.example.test/reference.png"
        self.assertEqual(sketch_fallback._public_reference_url(source), source)

    def test_source_reference_session_can_be_reused_for_sketch_output(self):
        source = "https://maivideo.top/static/uploads/reference.png?session_id=user_abc"
        self.assertEqual(
            sketch_fallback._session_id_from_reference_url(source),
            "user_abc",
        )

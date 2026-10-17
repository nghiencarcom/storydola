import unittest
from unittest.mock import patch

import media


class LocalMediaRouteTests(unittest.TestCase):
    def test_only_own_validated_media_route_is_localized(self):
        with patch.object(media.config, "PUBLIC_BASE", "https://studio.example"), patch.object(
            media.config, "STUDIO_URL", "http://127.0.0.1:3107"
        ):
            path = "/api/media/files?source=uploads&path=image.png"
            self.assertEqual(media._local_media_download_url("https://studio.example" + path),
                             "http://127.0.0.1:3107" + path)
            for url in [
                "https://other.example" + path,
                "https://studio.example/api/admin/tasks",
                "https://studio.example/api/media/files?source=uploads&path=../secret",
                "https://user@studio.example" + path,
                "https://studio.example" + path + "#fragment",
            ]:
                self.assertEqual(media._local_media_download_url(url), url)

    def test_local_media_route_has_public_maivideo_fallback(self):
        source = (
            "http://localhost:3107/api/media/files?source=uploads"
            "&path=library%2Fuser_abc%2Flibrary_123_My%20Reference.png"
            "&session_id=user_abc"
        )
        with patch.object(media.config, "STUDIO_URL", "http://127.0.0.1:3107"), patch.object(
            media.config, "MAIVIDEO_PUBLIC_URL", "https://maivideo.top"
        ):
            self.assertEqual(
                media._public_media_download_url(source),
                "https://maivideo.top/static/uploads/library/user_abc/library_123_My%20Reference.png?session_id=user_abc",
            )

    def test_untrusted_url_is_not_rewritten_as_public_media(self):
        source = "https://other.example/api/media/files?source=uploads&path=image.png"
        with patch.object(media.config, "STUDIO_URL", "http://127.0.0.1:3107"), patch.object(
            media.config, "MAIVIDEO_PUBLIC_URL", "https://maivideo.top"
        ):
            self.assertEqual(media._public_media_download_url(source), source)

    def test_server_owned_export_can_be_retried_without_stale_user_session(self):
        source = "https://maivideo.top/static/exports/pixverse_image_29810.png?session_id=user_old"
        with patch.object(media.config, "MAIVIDEO_PUBLIC_URL", "https://maivideo.top"), patch.object(
            media.config, "MAIVIDEO_API_KEY", "service-key"
        ), patch.object(media.config, "MAIVIDEO_AUTH_TOKEN", ""):
            self.assertEqual(
                media._server_authenticated_export_url(source),
                "https://maivideo.top/static/exports/pixverse_image_29810.png",
            )

    def test_service_credentials_are_not_sent_with_user_owned_session_url(self):
        with patch.object(media.config, "MAIVIDEO_PUBLIC_URL", "https://maivideo.top"), patch.object(
            media.config, "MAIVIDEO_API_KEY", "service-key"
        ), patch.object(media.config, "MAIVIDEO_AUTH_TOKEN", ""):
            self.assertNotIn(
                "X-API-Key",
                media._reference_download_headers(
                    "https://maivideo.top/static/exports/image.png?session_id=user_source"
                ),
            )
            self.assertEqual(
                media._reference_download_headers("https://maivideo.top/static/exports/image.png")["X-API-Key"],
                "service-key",
            )

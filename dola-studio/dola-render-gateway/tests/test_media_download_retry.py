import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import aiohttp
import media


class _FakeResponse:
    def __init__(self, status, headers, session):
        self.status = status
        self.headers = headers
        self.content = object()
        self._session = session

    async def __aenter__(self):
        self._session.active += 1
        self._session.peak = max(self._session.peak, self._session.active)
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        self._session.active -= 1


class _FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []
        self.active = 0
        self.peak = 0

    def get(self, url, **kwargs):
        self.requests.append((url, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        status, headers = response
        return _FakeResponse(status, headers, self)


async def _validated_url(url):
    return url


class ReferenceDownloadRetryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)

    async def test_retries_transient_503_and_saves_image(self):
        session = _FakeSession([(503, {"Retry-After": "0"}), (200, {})])

        async def read_image(_response):
            return b"verified-image", ".png"

        with patch.object(media, "_validate_url_async", _validated_url), patch.object(
            media, "_read_response_image", read_image
        ), patch.object(media.config, "PROXY", ""):
            target = Path(self.temp_dir.name) / "reference.png"
            result = await media.download_one_image(
                session, "https://images.example/reference.png", target
            )

        self.assertEqual(result, target)
        self.assertEqual(target.read_bytes(), b"verified-image")
        self.assertEqual(len(session.requests), 2)

    async def test_does_not_retry_non_transient_404(self):
        session = _FakeSession([(404, {})])

        with patch.object(media, "_validate_url_async", _validated_url), patch.object(
            media.config, "PROXY", ""
        ):
            with self.assertRaisesRegex(ValueError, "HTTP 404"):
                await media.download_one_image(
                    session,
                    "https://images.example/missing.png",
                    Path(self.temp_dir.name) / "missing.png",
                )

        self.assertEqual(len(session.requests), 1)

    async def test_retries_transient_connection_error(self):
        session = _FakeSession(
            [aiohttp.ClientConnectionError("temporary connection reset"), (200, {})]
        )

        async def read_image(_response):
            return b"verified-image", ".png"

        with patch.object(media, "_validate_url_async", _validated_url), patch.object(
            media, "_read_response_image", read_image
        ), patch.object(media.config, "PROXY", ""):
            result = await media.download_one_image(
                session,
                "https://images.example/reference.png",
                Path(self.temp_dir.name) / "connection.png",
            )

        self.assertEqual(result.read_bytes(), b"verified-image")
        self.assertEqual(len(session.requests), 2)

    async def test_redirects_do_not_consume_retry_attempts(self):
        session = _FakeSession(
            [
                (302, {"Location": "/middle.png"}),
                (302, {"Location": "/final.png"}),
                (200, {}),
            ]
        )

        async def read_image(_response):
            return b"verified-image", ".png"

        with patch.object(media, "_validate_url_async", _validated_url), patch.object(
            media, "_read_response_image", read_image
        ), patch.object(media.config, "PROXY", ""):
            result = await media.download_one_image(
                session,
                "https://images.example/reference.png",
                Path(self.temp_dir.name) / "reference.png",
            )

        self.assertEqual(result.read_bytes(), b"verified-image")
        self.assertEqual(
            [request[0] for request in session.requests],
            [
                "https://images.example/reference.png",
                "https://images.example/middle.png",
                "https://images.example/final.png",
            ],
        )

    async def test_global_download_limit_bounds_concurrent_jobs(self):
        session = _FakeSession([(200, {}) for _ in range(6)])

        async def read_image(_response):
            await asyncio.sleep(0.01)
            return b"verified-image", ".png"

        with patch.object(media, "_validate_url_async", _validated_url), patch.object(
            media, "_read_response_image", read_image
        ), patch.object(media.config, "PROXY", ""), patch.object(
            media.config, "REFERENCE_DOWNLOAD_GLOBAL_CONCURRENCY", 2
        ):
            await asyncio.gather(
                *(
                    media.download_one_image(
                        session,
                        f"https://images.example/{index}.png",
                        Path(self.temp_dir.name) / f"{index}.png",
                    )
                    for index in range(6)
                )
            )

        self.assertEqual(session.peak, 2)


if __name__ == "__main__":
    unittest.main()

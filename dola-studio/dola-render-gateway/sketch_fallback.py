"""Bounded MaiVideo reference-image preparation for provider refusals.

The normal Studio path prepares pencil references before a task reaches the
Gateway. This module is only used for one automatic recovery attempt when a
task was admitted with original references and Dola returns a no-video
image/prompt refusal. It keeps the original order and filenames, and returns
only public image URLs that the Gateway can download again.
"""

import asyncio
import json
import time
from urllib.parse import parse_qs, quote, urlencode, urlparse, urlunparse

import aiohttp

import config


PENCIL_SKETCH_PROMPT = " ".join([
    "Edit the supplied reference image in place with a selective regional edit, not a full-image grayscale conversion.",
    "Convert only the recognizable human character or characters into faithful black-and-white graphite pencil drawing: preserve their identity, facial features, skin, hair, body proportions, pose, clothing silhouette, and exact placement.",
    "Keep every non-character element exactly as it appears in the original image, including products, packaging, props, logos, readable text, furniture, architecture, landscape, lighting, materials, textures, and all of their original colors.",
    "Do not desaturate, redraw, recolor, crop, replace, blur, or move any product, prop, or background. Preserve the original composition, camera angle, framing, and product shape and placement.",
    "If no recognizable human character is present, return the reference image unchanged. No new objects, no invented text, no extra logo, and no watermark.",
])

_MAX_REFERENCE_URL_LENGTH = 4096
_SUCCESS_STATUSES = {"completed", "done"}
_TERMINAL_STATUSES = {
    "completed", "done", "partial", "error", "failed", "refunded"
}


class SketchFallbackError(RuntimeError):
    """The one-time automatic sketch preparation could not complete."""


def _is_http_url(value) -> bool:
    return bool(urlparse(str(value or "").strip()).scheme in {"http", "https"})


def _public_reference_url(value: str) -> str:
    """Turn the Studio media proxy URL into a MaiVideo-readable public URL."""
    raw = str(value or "").strip()
    if not _is_http_url(raw) or len(raw) > _MAX_REFERENCE_URL_LENGTH:
        return raw
    try:
        parsed = urlparse(raw)
        if parsed.path == "/api/media/files":
            from urllib.parse import parse_qs, urlencode, urlunparse

            query = parse_qs(parsed.query)
            source = (query.get("source") or [""])[0]
            relative = (query.get("path") or query.get("relative_path") or [""])[0]
            relative = relative.replace("\\", "/")
            segments = [segment for segment in relative.split("/") if segment]
            if source in {"uploads", "downloads", "exports"} and segments:
                path = "/static/" + quote(source, safe="") + "/" + "/".join(
                    quote(segment, safe="") for segment in segments
                )
                session_id = (query.get("session_id") or [""])[0]
                new_query = urlencode({"session_id": session_id}) if session_id else ""
                return urlunparse((
                    urlparse(config.MAIVIDEO_PUBLIC_URL).scheme,
                    urlparse(config.MAIVIDEO_PUBLIC_URL).netloc,
                    path,
                    "",
                    new_query,
                    "",
                ))

        # A local MaiVideo response may expose /static/... on loopback. Replace
        # only that known service origin; arbitrary provider URLs stay intact.
        if parsed.path.startswith("/static/") and parsed.hostname in {
            "localhost", "127.0.0.1", "::1"
        }:
            public = urlparse(config.MAIVIDEO_PUBLIC_URL)
            return urlunparse((
                public.scheme, public.netloc, parsed.path, "", parsed.query, ""
            ))
    except Exception:
        return raw
    return raw


def _public_output_url(value: str, session_id: str = "") -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    use_server_credentials = _has_server_media_credentials()
    try:
        parsed = urlparse(raw)
        public = urlparse(config.MAIVIDEO_PUBLIC_URL)
        if not parsed.scheme:
            query = parsed.query
            if use_server_credentials and parsed.path.startswith("/static/"):
                query = _without_session_id(query)
            elif session_id and parsed.path.startswith("/static/"):
                query = urlencode({"session_id": session_id})
            return urlunparse((public.scheme, public.netloc, parsed.path, "", query, ""))
        if parsed.hostname in {"localhost", "127.0.0.1", "::1"}:
            query = parsed.query
            if use_server_credentials and parsed.path.startswith("/static/"):
                query = _without_session_id(query)
            elif session_id and parsed.path.startswith("/static/"):
                query = urlencode({"session_id": session_id})
            return urlunparse((public.scheme, public.netloc, parsed.path, "", query, ""))
        # MaiVideo may return a fully-qualified public static URL without the
        # session query, even though the download endpoint requires it. Keep
        # other provider/CDN URLs untouched and only repair our own origin.
        if (
            parsed.path.startswith("/static/")
            and parsed.hostname == public.hostname
            and (parsed.port or public.port) == (public.port or parsed.port)
        ):
            query = parse_qs(parsed.query, keep_blank_values=True)
            if use_server_credentials:
                query.pop("session_id", None)
                return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))
            if session_id and (not query.get("session_id") or not query["session_id"][0]):
                query["session_id"] = [session_id]
                return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))
    except Exception:
        return ""
    return raw


def _headers() -> dict[str, str]:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if config.MAIVIDEO_API_KEY:
        headers["X-API-Key"] = config.MAIVIDEO_API_KEY
    elif config.MAIVIDEO_AUTH_TOKEN:
        headers["Authorization"] = "Bearer " + config.MAIVIDEO_AUTH_TOKEN
    return headers


def _job_status(payload: dict) -> str:
    return str(payload.get("status") or payload.get("job", {}).get("status") or "").strip().lower()


def _job_id(payload: dict) -> str:
    return str(
        payload.get("job_id")
        or payload.get("job", {}).get("id")
        or payload.get("id")
        or ""
    ).strip()


def _session_id(payload: dict, fallback: str = "") -> str:
    value = (
        payload.get("job", {}).get("session_id")
        or payload.get("session_id")
        or fallback
    )
    return str(value or "").strip()


def _session_id_from_reference_url(value: str) -> str:
    """Reuse the MaiVideo session attached to the source reference URL."""
    try:
        query = parse_qs(urlparse(str(value or "")).query)
        return str((query.get("session_id") or [""])[0] or "").strip()
    except Exception:
        return ""


def _has_server_media_credentials() -> bool:
    """Return whether Gateway can authenticate its own generated media."""
    return bool(
        str(config.MAIVIDEO_API_KEY or "").strip()
        or str(config.MAIVIDEO_AUTH_TOKEN or "").strip()
    )


def _without_session_id(query: str) -> str:
    values = parse_qs(query, keep_blank_values=True)
    values.pop("session_id", None)
    return urlencode(values, doseq=True)


def _result_items(payload: dict) -> list:
    direct = payload.get("images") if isinstance(payload.get("images"), list) else []
    job_items = payload.get("job", {}).get("items")
    if not isinstance(job_items, list):
        job_items = []
    completed = [
        (item.get("result"), item.get("model"))
        for item in job_items
        if isinstance(item, dict)
        and str(item.get("status") or "").lower() in _SUCCESS_STATUSES
        and isinstance(item.get("result"), dict)
    ]
    return [(item, item.get("model")) for item in direct if isinstance(item, dict)] + completed


def _result_url(payload: dict, session_id: str) -> str:
    for item, item_model in _result_items(payload):
        raw = item.get("file_url") or item.get("image_url") or item.get("url") or item.get("src")
        value = _public_output_url(raw, session_id)
        if value:
            actual_model = str(item.get("model") or item_model or "").strip()
            if not actual_model:
                raise SketchFallbackError(
                    "MaiVideo không trả về model thực tế; Dola không thể xác minh ảnh tham chiếu."
                )
            if (
                actual_model not in config.ALLOWED_MAIVIDEO_IMAGE_MODELS
                or actual_model != config.MAIVIDEO_IMAGE_MODEL
            ):
                raise SketchFallbackError(
                    "MaiVideo được yêu cầu dùng model " + config.MAIVIDEO_IMAGE_MODEL
                    + " nhưng trả về model " + actual_model + "."
                )
            return value
    return ""


async def _read_json(session, url: str, *, method: str = "GET", body: dict | None = None):
    timeout = aiohttp.ClientTimeout(total=max(10, int(config.REFERENCE_DOWNLOAD_TIMEOUT)))
    try:
        async with session.request(
            method,
            url,
            headers=_headers(),
            json=body,
            timeout=timeout,
        ) as response:
            raw = await response.text()
    except asyncio.TimeoutError as exc:
        raise SketchFallbackError("MaiVideo tạo ảnh chì bị timeout.") from exc
    except aiohttp.ClientError as exc:
        raise SketchFallbackError("Không kết nối được MaiVideo để tạo ảnh chì.") from exc
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except ValueError:
        payload = {"detail": raw[:300]}
    if response.status < 200 or response.status >= 300 or payload.get("success") is False or payload.get("ok") is False:
        detail = payload.get("detail") or payload.get("error") or payload.get("message") or "MaiVideo từ chối tạo ảnh chì."
        raise SketchFallbackError(str(detail)[:300])
    return payload


async def _create_one(
    session,
    reference_url: str,
    deadline: float,
    fallback_session_id: str = "",
) -> str:
    public_reference = _public_reference_url(reference_url)
    if not _is_http_url(public_reference) or len(public_reference) > _MAX_REFERENCE_URL_LENGTH:
        raise SketchFallbackError("Ảnh tham chiếu không phải URL hợp lệ để tạo ảnh chì.")
    payload = await _read_json(
        session,
        config.MAIVIDEO_PUBLIC_URL + "/api/v1/image-generation",
        method="POST",
        body={
            "prompt": PENCIL_SKETCH_PROMPT,
            "model": config.MAIVIDEO_IMAGE_MODEL,
            "quality": config.MAIVIDEO_IMAGE_QUALITY,
            "aspect_ratio": "1:1",
            "n": 1,
            "reference_image_urls": [public_reference],
        },
    )
    session_id = _session_id(payload, fallback_session_id)
    immediate = _result_url(payload, session_id)
    if immediate:
        return immediate
    image_job_id = _job_id(payload)
    if not image_job_id:
        raise SketchFallbackError("MaiVideo không trả về mã job ảnh chì.")
    last_status = "queued"
    while time.monotonic() < deadline:
        status_payload = await _read_json(
            session,
            config.MAIVIDEO_PUBLIC_URL + "/api/v1/image-generation/" + quote(image_job_id, safe=""),
        )
        session_id = _session_id(status_payload, session_id)
        last_status = _job_status(status_payload) or last_status
        result = _result_url(status_payload, session_id)
        if result and (last_status in _SUCCESS_STATUSES or last_status == "partial"):
            return result
        if last_status in _TERMINAL_STATUSES:
            raise SketchFallbackError(
                "MaiVideo tạo ảnh chì thất bại (trạng thái: " + last_status + ")."
            )
        await asyncio.sleep(min(config.AUTO_SKETCH_IMAGE_POLL_SEC, max(0.25, deadline - time.monotonic())))
    raise SketchFallbackError("MaiVideo tạo ảnh chì quá thời gian chờ.")


async def create_pencil_sketches(
    reference_urls: list[str],
    session_id: str = "",
) -> list[str]:
    """Create one sketch per reference URL, preserving order."""
    values = []
    seen = set()
    for value in reference_urls or []:
        url = str(value or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        values.append(url)
    if not values:
        return []
    if not config.AUTO_SKETCH_RETRY_ENABLED or not config.AUTO_SKETCH_RETRY_LIMIT:
        raise SketchFallbackError("Tự động chuyển ảnh chì đang bị tắt.")
    if not config.MAIVIDEO_API_KEY and not config.MAIVIDEO_AUTH_TOKEN:
        raise SketchFallbackError("Chưa cấu hình thông tin xác thực MaiVideo để tạo ảnh chì.")
    deadline = time.monotonic() + config.AUTO_SKETCH_IMAGE_TIMEOUT_SEC
    connector = aiohttp.TCPConnector(limit=1)
    async with aiohttp.ClientSession(connector=connector) as session:
        result = []
        for value in values:
            if time.monotonic() >= deadline:
                raise SketchFallbackError("MaiVideo tạo ảnh chì quá thời gian chờ.")
            result.append(await _create_one(
                session,
                value,
                deadline,
                str(session_id or "").strip() or _session_id_from_reference_url(value),
            ))
        return result

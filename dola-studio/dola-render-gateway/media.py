"""Public reference media download and security validation (SSRF protected)."""
import asyncio
import ipaddress
import math
import random
import re
import socket
import tempfile
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urljoin, urlparse, urlunparse

import aiohttp
from PIL import Image

import config

_ALLOWED_IMAGE_FORMATS = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}
_PRESERVED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
_MEDIA_PROXY_PATH = "/api/media/files"
_MEDIA_SOURCES = {"uploads", "downloads", "exports"}
_SESSION_ID_PATTERN = r"^(?:user|public|sess)_[A-Za-z0-9_-]{1,96}$"
_LOCAL_HOSTNAMES = {"localhost", "127.0.0.1", "::1"}
_STORYAI_REFERENCE_PATH = re.compile(
    r"^/api/seedance/references/[A-Za-z0-9_-]{1,160}/[A-Za-z0-9_-]{1,160}$"
)
_REFERENCE_DOWNLOAD_MAX_ATTEMPTS = 6
_REFERENCE_DOWNLOAD_RETRYABLE_STATUSES = {408, 425, 429, 500, 502, 503, 504}
_REFERENCE_DOWNLOAD_MAX_RETRY_AFTER_SEC = 30.0


def _global_reference_download_semaphore() -> asyncio.Semaphore:
    """Share a download cap across all jobs on the Gateway event loop."""
    loop = asyncio.get_running_loop()
    semaphore = getattr(loop, "_dola_reference_download_semaphore", None)
    if semaphore is None:
        semaphore = asyncio.Semaphore(config.REFERENCE_DOWNLOAD_GLOBAL_CONCURRENCY)
        setattr(loop, "_dola_reference_download_semaphore", semaphore)
    return semaphore


def _reference_download_retry_delay(retry_after: str | None, attempt: int) -> float:
    value = str(retry_after or "").strip()
    if value:
        delay = None
        try:
            delay = float(value)
        except ValueError:
            try:
                retry_at = parsedate_to_datetime(value)
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=timezone.utc)
                delay = (retry_at - datetime.now(timezone.utc)).total_seconds()
            except (TypeError, ValueError, OverflowError):
                pass
        if delay is not None and math.isfinite(delay):
            bounded = min(max(0.0, delay), _REFERENCE_DOWNLOAD_MAX_RETRY_AFTER_SEC)
            # Spread a busy origin's Retry-After wakeups across workers.
            return min(
                bounded + random.uniform(0.0, 1.0),
                _REFERENCE_DOWNLOAD_MAX_RETRY_AFTER_SEC,
            )
    exponential = min(2.0 ** max(0, attempt), 16.0)
    # Jitter prevents simultaneous batch jobs from re-hitting a failing media
    # origin in lockstep after each 5xx response.
    return min(
        exponential * random.uniform(0.8, 1.2),
        _REFERENCE_DOWNLOAD_MAX_RETRY_AFTER_SEC,
    )


class ReferenceImageSizeError(ValueError):
    """A reference image is larger than the Gateway's configured limit."""


def _reference_image_size_error(actual_bytes: int | None = None) -> ReferenceImageSizeError:
    limit_mb = config.REFERENCE_IMAGE_MAX_BYTES / (1024 * 1024)
    limit_label = f"{limit_mb:.1f}".rstrip("0").rstrip(".")
    detail = f"Reference image exceeds single file size limit (maximum {limit_label} MB"
    if actual_bytes:
        actual_mb = actual_bytes / (1024 * 1024)
        detail += f", received {actual_mb:.1f} MB"
    return ReferenceImageSizeError(detail + ")")


def _normalize_media_path(value: str) -> str:
    normalized = str(value or "").strip().replace("\\", "/")
    if not normalized or normalized.startswith("/") or "\x00" in normalized:
        return ""
    segments = [segment for segment in normalized.split("/") if segment]
    if not segments or any(
        segment in {".", ".."} or "\x00" in segment for segment in segments
    ):
        return ""
    return "/".join(segments)


def _is_trusted_local_media_url(url: str) -> bool:
    """Allow only Dola's loopback media proxy, never arbitrary private URLs."""
    if not isinstance(url, str) or len(url) > 4096:
        return False
    if _is_trusted_storyai_reference_url(url):
        return True
    try:
        parsed = urlparse(url)
        configured = urlparse(config.STUDIO_URL)
        configured_port = configured.port or (443 if configured.scheme == "https" else 80)
        parsed_port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError:
        return False

    if (
        parsed.scheme != "http"
        or configured.scheme != "http"
        or parsed.hostname not in _LOCAL_HOSTNAMES
        or configured.hostname not in _LOCAL_HOSTNAMES
        or parsed_port != configured_port
        or parsed.path != _MEDIA_PROXY_PATH
        or parsed.username
        or parsed.password
        or parsed.fragment
    ):
        return False

    query = parse_qs(parsed.query, keep_blank_values=True)
    if set(query) - {"source", "path", "relative_path", "session_id"}:
        return False
    if "path" in query and "relative_path" in query:
        return False

    def one(name: str) -> str:
        values = query.get(name, [])
        return values[0].strip() if len(values) == 1 else ""

    source = one("source")
    relative_path = _normalize_media_path(one("path") or one("relative_path"))
    session_id = one("session_id")
    if source not in _MEDIA_SOURCES or not relative_path:
        return False
    if session_id and session_id != "global":
        if not re.fullmatch(_SESSION_ID_PATTERN, session_id):
            return False
    return True


def _is_trusted_storyai_reference_url(url: str) -> bool:
    """Allow signed StoryAI reference images on one configured loopback origin."""
    try:
        parsed = urlparse(url)
        configured = urlparse(config.STORYAI_LOCAL_URL)
        parsed_port = parsed.port or (80 if parsed.scheme == "http" else 443)
        configured_port = configured.port or (80 if configured.scheme == "http" else 443)
    except ValueError:
        return False
    if (
        parsed.scheme != "http"
        or configured.scheme != "http"
        or parsed.hostname not in _LOCAL_HOSTNAMES
        or parsed.hostname != configured.hostname
        or parsed_port != configured_port
        or not _STORYAI_REFERENCE_PATH.fullmatch(parsed.path)
        or parsed.username
        or parsed.password
        or parsed.fragment
    ):
        return False
    query = parse_qs(parsed.query, keep_blank_values=True)
    if set(query) - {"owner", "expires", "signature", "type"}:
        return False
    if any(len(values) != 1 for values in query.values()):
        return False
    owner = query.get("owner", [""])[0]
    expires = query.get("expires", [""])[0]
    signature = query.get("signature", [""])[0]
    reference_type = query.get("type", ["character"])[0]
    return bool(
        re.fullmatch(r"[A-Za-z0-9_-]{1,128}", owner)
        and expires.isdigit()
        and re.fullmatch(r"[a-fA-F0-9]{64}", signature)
        and reference_type in {"character", "scene", "location"}
    )


def validate_public_url(url: str) -> str:
    """Accepts only public HTTP(S) URLs, blocks localhost, private network, and credentials."""
    if not isinstance(url, str) or len(url) > 4096:
        raise ValueError("Invalid reference image URL")
    parsed = urlparse(url)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Reference image only supports public http/https URLs")
    if parsed.username or parsed.password:
        raise ValueError("Reference image URL must not contain authentication credentials")
    host = parsed.hostname
    try:
        # SSRF check: check direct IP and DNS resolution against private/reserved ranges
        addresses = {ipaddress.ip_address(host)}
    except ValueError:
        try:
            infos = awaitable_getaddrinfo(host)
            addresses = {ipaddress.ip_address(x) for x in infos}
        except Exception as exc:
            raise ValueError(f"Failed to resolve reference image domain: {host}") from exc
    if not addresses or any(
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
        or ip.is_multicast or ip.is_unspecified
        for ip in addresses
    ):
        raise ValueError("Reference image points to private or reserved IP address (SSRF blocked)")
    return url


def awaitable_getaddrinfo(host: str) -> list[str]:
    """Synchronous DNS resolution wrapper."""
    return [item[4][0] for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)]


async def _validate_url_async(url: str) -> str:
    if not isinstance(url, str) or len(url) > 4096:
        raise ValueError("Invalid reference image URL")
    parsed = urlparse(url)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Reference image only supports public http/https URLs")
    if parsed.username or parsed.password:
        raise ValueError("Reference image URL must not contain authentication credentials")
    if _is_trusted_local_media_url(url):
        return url
    host = parsed.hostname
    try:
        addresses = {ipaddress.ip_address(host)}
    except ValueError:
        try:
            resolved = await asyncio.to_thread(awaitable_getaddrinfo, host)
            addresses = {ipaddress.ip_address(x) for x in resolved}
        except Exception as exc:
            raise ValueError(f"Failed to resolve reference image domain: {host}") from exc
    if not addresses or any(
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
        or ip.is_multicast or ip.is_unspecified
        for ip in addresses
    ):
        raise ValueError("Reference image points to private or reserved IP address (SSRF blocked)")
    return url


async def validate_reference_urls(urls: list[str]) -> list[str]:
    if len(urls) > config.REFERENCE_IMAGE_MAX_COUNT:
        raise ValueError(f"Maximum of {config.REFERENCE_IMAGE_MAX_COUNT} reference images allowed")
    normalized = []
    seen = set()
    for raw in urls:
        url = await _validate_url_async(raw)
        if url not in seen:
            normalized.append(url)
            seen.add(url)
    return normalized


async def _read_response_image(resp: aiohttp.ClientResponse) -> tuple[bytes, str]:
    content_length = resp.headers.get("Content-Length")
    try:
        content_length_bytes = int(content_length) if content_length else 0
    except (TypeError, ValueError):
        content_length_bytes = 0
    if content_length_bytes > config.REFERENCE_IMAGE_MAX_BYTES:
        raise _reference_image_size_error(content_length_bytes)
    chunks = []
    total = 0
    async for chunk in resp.content.iter_chunked(64 * 1024):
        total += len(chunk)
        if total > config.REFERENCE_IMAGE_MAX_BYTES:
            raise _reference_image_size_error(total)
        chunks.append(chunk)
    data = b"".join(chunks)
    try:
        with Image.open(BytesIO(data)) as image:
            image.verify()
            fmt = image.format
    except Exception as exc:
        raise ValueError("Reference file is not a valid image") from exc
    if fmt not in _ALLOWED_IMAGE_FORMATS:
        raise ValueError("Reference image only supports JPEG, PNG, WEBP")
    return data, _ALLOWED_IMAGE_FORMATS[fmt]


def _local_media_download_url(url: str) -> str:
    """Fetch our own public media through the same loopback route.

    Preserve the stored user URL; avoid the public tunnel for server-to-server
    access. Only the configured public origin and validated media route qualify.
    """
    try:
        parsed, public = urlparse(url), urlparse(config.PUBLIC_BASE)
        if (parsed.scheme, parsed.netloc) != (public.scheme, public.netloc):
            return url
        local = urlparse(config.STUDIO_URL)
        candidate = urlunparse((local.scheme, local.netloc, parsed.path, "", parsed.query, parsed.fragment))
        if not parsed.username and not parsed.password and _is_trusted_local_media_url(candidate):
            return candidate
    except ValueError:
        pass
    return url


def _public_media_download_url(url: str) -> str:
    """Turn a trusted Studio media proxy URL into a public MaiVideo URL.

    The Studio proxy is useful in a browser because it can carry the user's
    auth cookie. A Gateway worker has no browser cookie, however. MaiVideo's
    media endpoint also accepts the validated ``session_id`` query parameter,
    so use the public static route as a server-to-server fallback for library
    images selected during retry.
    """
    if not _is_trusted_local_media_url(url):
        return url
    try:
        parsed = urlparse(url)
        query = parse_qs(parsed.query, keep_blank_values=True)

        def one(name: str) -> str:
            values = query.get(name, [])
            return values[0].strip() if len(values) == 1 else ""

        source = one("source")
        relative_path = _normalize_media_path(one("path") or one("relative_path"))
        if source not in _MEDIA_SOURCES or not relative_path:
            return url
        public = urlparse(config.MAIVIDEO_PUBLIC_URL)
        if public.scheme not in {"http", "https"} or not public.netloc:
            return url
        public_path = "/static/" + quote(source, safe="") + "/" + "/".join(
            quote(segment, safe="") for segment in relative_path.split("/")
        )
        session_id = one("session_id")
        public_query = urlencode({"session_id": session_id}) if session_id else ""
        return urlunparse((
            public.scheme,
            public.netloc,
            public_path,
            "",
            public_query,
            "",
        ))
    except (TypeError, ValueError):
        return url


def _is_configured_maivideo_static_url(url: str) -> bool:
    """Match only MaiVideo's configured public static origin."""
    try:
        parsed = urlparse(url)
        configured = urlparse(config.MAIVIDEO_PUBLIC_URL)
        parsed_port = parsed.port or (443 if parsed.scheme == "https" else 80)
        configured_port = configured.port or (443 if configured.scheme == "https" else 80)
        return bool(
            parsed.scheme in {"http", "https"}
            and configured.scheme in {"http", "https"}
            and parsed.hostname
            and parsed.hostname.lower() == (configured.hostname or "").lower()
            and parsed_port == configured_port
            and parsed.path.startswith("/static/")
        )
    except ValueError:
        return False


def _server_authenticated_export_url(url: str) -> str:
    """Remove a stale user session from Gateway-owned MaiVideo exports.

    The image API is called with the Gateway's server credential, so generated
    exports belong to that credential's MaiVideo account, not to the end user's
    source-image session. Keep the original URL first; this variant is only a
    fallback for old rows that persisted the wrong session_id.
    """
    if not (config.MAIVIDEO_API_KEY or config.MAIVIDEO_AUTH_TOKEN):
        return ""
    if not _is_configured_maivideo_static_url(url):
        return ""
    parsed = urlparse(url)
    if not parsed.path.startswith("/static/exports/"):
        return ""
    query = parse_qs(parsed.query, keep_blank_values=True)
    if not query.get("session_id"):
        return ""
    query.pop("session_id", None)
    return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))


def _reference_download_headers(url: str) -> dict[str, str]:
    headers = {"User-Agent": "dola-pool-reference-fetch/1.0"}
    # Never send the service credential while a user session is present: the
    # MaiVideo static route correctly rejects a mismatched session_id. For a
    # Gateway-owned export without that query, API-key/token auth is the
    # authoritative ownership proof. User-library uploads must stay scoped to
    # their own session even when the URL happens to omit its query string.
    try:
        parsed = urlparse(url)
        query = parse_qs(parsed.query, keep_blank_values=True)
    except ValueError:
        parsed = None
        query = {}
    if (
        parsed is not None
        and _is_configured_maivideo_static_url(url)
        and parsed.path.startswith("/static/exports/")
        and not query.get("session_id")
    ):
        if config.MAIVIDEO_API_KEY:
            headers["X-API-Key"] = config.MAIVIDEO_API_KEY
        if config.MAIVIDEO_AUTH_TOKEN:
            headers["X-Auth-Token"] = config.MAIVIDEO_AUTH_TOKEN
            headers["Authorization"] = "Bearer " + config.MAIVIDEO_AUTH_TOKEN
    return headers


async def download_one_image(session: aiohttp.ClientSession, url: str, dest: Path) -> Path:
    url = _local_media_download_url(url)
    candidate_urls = []
    for candidate in (url, _public_media_download_url(url)):
        if candidate and candidate not in candidate_urls:
            candidate_urls.append(candidate)
        authenticated_variant = _server_authenticated_export_url(candidate)
        if authenticated_variant and authenticated_variant not in candidate_urls:
            candidate_urls.append(authenticated_variant)
    last_error = None
    for candidate_url in candidate_urls:
        current = await _validate_url_async(candidate_url)
        # Try configured proxy first, fall back to direct connection if blocked
        # External MaiVideo URLs may use the configured egress proxy. Local
        # Dola media is always fetched directly and never sent through it.
        proxies = [None] if _is_trusted_local_media_url(candidate_url) else []
        if not proxies:
            if config.PROXY:
                proxies.append(config.PROXY)
            proxies.append(None)
        for proxy in proxies:
            for attempt in range(_REFERENCE_DOWNLOAD_MAX_ATTEMPTS):
                current = await _validate_url_async(candidate_url)
                redirects = 0
                should_retry = False
                retry_after = None
                response_status = None
                try:
                    while True:
                        async with _global_reference_download_semaphore():
                            async with session.get(
                                current,
                                allow_redirects=False,
                                proxy=proxy,
                                timeout=aiohttp.ClientTimeout(total=config.REFERENCE_DOWNLOAD_TIMEOUT),
                                headers=_reference_download_headers(current),
                            ) as resp:
                                if 300 <= resp.status < 400 and resp.headers.get("Location"):
                                    redirects += 1
                                    if redirects > 10:
                                        last_error = ValueError(
                                            "Too many redirects while downloading reference image"
                                        )
                                        break
                                    current = await _validate_url_async(
                                        urljoin(current, resp.headers["Location"])
                                    )
                                    continue
                                if resp.status != 200:
                                    response_status = resp.status
                                    last_error = ValueError(
                                        f"Failed to download reference image: HTTP {resp.status}"
                                    )
                                    retry_after = resp.headers.get("Retry-After")
                                    should_retry = (
                                        resp.status in _REFERENCE_DOWNLOAD_RETRYABLE_STATUSES
                                    )
                                    break
                                data, suffix = await _read_response_image(resp)
                                # Keep the original uploaded filename whenever it has a
                                # safe, browser-recognised image suffix. This name is
                                # later passed to SeedancePro's File bridge. For a URL
                                # without a usable suffix, retain the original stem and
                                # add the verified image suffix returned by PIL.
                                path = (
                                    dest
                                    if dest.suffix.lower() in _PRESERVED_IMAGE_SUFFIXES
                                    else dest.with_suffix(suffix)
                                )
                                path.write_bytes(data)
                                return path
                except ReferenceImageSizeError:
                    # Retrying the same response through another proxy cannot
                    # make an oversized file smaller. Preserve the typed error
                    # so the task handler can report a clear size-specific
                    # failure instead of falling back to SUBMIT_FAILED.
                    raise
                except Exception as exc:
                    last_error = exc
                    should_retry = isinstance(
                        exc,
                        (aiohttp.ClientError, asyncio.TimeoutError, TimeoutError),
                    )
                if not should_retry or attempt + 1 >= _REFERENCE_DOWNLOAD_MAX_ATTEMPTS:
                    break
                delay = _reference_download_retry_delay(retry_after, attempt)
                host = urlparse(current).hostname or "unknown"
                status_label = (
                    str(response_status)
                    if response_status is not None
                    else type(last_error).__name__
                )
                print(
                    f"[media] retry reference download host={host} status={status_label} "
                    f"retry={attempt + 1}/{_REFERENCE_DOWNLOAD_MAX_ATTEMPTS - 1} "
                    f"wait={delay:.1f}s",
                    flush=True,
                )
                await asyncio.sleep(delay)
    raise ValueError(str(last_error) if last_error else "Failed to download reference image")


def _reference_destination_names(names, count: int) -> list[str]:
    """Build safe, stable temporary names without losing uploaded filenames."""
    values = list(names) if isinstance(names, (list, tuple)) else []
    used: set[str] = set()
    result: list[str] = []
    for index in range(max(0, int(count))):
        raw = str(values[index] if index < len(values) else "").strip()
        # A browser File name may contain a path when it came from a drag/drop
        # source. Only its leaf is meaningful to Dola and it must never escape
        # the task-owned temporary directory.
        raw = re.split(r"[\\/]", raw)[-1]
        raw = re.sub(r"[\x00-\x1f\x7f]", "", raw).strip()
        if raw in {"", ".", ".."}:
            raw = f"reference-{index + 1}"
        raw = raw[:180]
        candidate = raw
        duplicate = 2
        stem = Path(raw).stem or f"reference-{index + 1}"
        suffix = Path(raw).suffix
        while candidate.casefold() in used:
            candidate = f"{stem}-{duplicate}{suffix}"
            duplicate += 1
        used.add(candidate.casefold())
        result.append(candidate)
    return result


async def download_reference_images(
    urls: list[str], task_id: str, names: list[str] | None = None
) -> tuple[Path | None, list[str]]:
    """Download references, retaining their uploaded filenames where safe."""
    urls = await validate_reference_urls(urls)
    if not urls:
        return None, []
    root = Path(tempfile.mkdtemp(prefix=f"dola_ref_{task_id}_"))
    try:
        destination_names = _reference_destination_names(names, len(urls))
        connector = aiohttp.TCPConnector(
            limit=max(1, config.REFERENCE_DOWNLOAD_CONCURRENCY)
        )
        async with aiohttp.ClientSession(connector=connector) as session:
            semaphore = asyncio.Semaphore(
                min(config.REFERENCE_DOWNLOAD_CONCURRENCY, len(urls))
            )

            async def download_at(index: int, url: str) -> tuple[int, str]:
                async with semaphore:
                    path = await download_one_image(session, url, root / destination_names[index])
                    return index, str(path)

            downloaded = await asyncio.gather(
                *(download_at(index, url) for index, url in enumerate(urls))
            )
            paths = [path for _, path in sorted(downloaded)]
        return root, paths
    except Exception:
        for child in root.glob("*"):
            child.unlink(missing_ok=True)
        root.rmdir()
        raise

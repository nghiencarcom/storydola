"""Dola Pool: OpenAI-compatible Video API (FastAPI) and Admin Dashboard.

Endpoints (Asynchronous 2-stage):
POST /v1/videos/generations -> Create task (status=queued)
GET  /v1/videos/<id>         -> Query task status (queued/submitting/processing/completed/failed)
GET  /videos/<file>          -> Static video download server

Admin Dashboard: GET / -> web/index.html; Admin API /api/admin/*
"""
import asyncio
import hashlib
import hmac
import json
import re
import shutil
import tempfile
import time
import uuid
from collections import defaultdict
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

from fastapi import FastAPI, Header, HTTPException
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import config
from prompt_format import video_prompt, pro_video_prompt
from prompt_format import ensure_sketch_color_restoration, SKETCH_COLOR_RESTORATION_MARKER
from prompt_safety import rewrite_sensitive_prompt
from sketch_fallback import SketchFallbackError, create_pencil_sketches
from browser import (
    check_login_state_details,
    _page_has_logged_out_marker,
    has_dola_session,
    login_browser_channel,
    launch_account_context,
)
from add_account import add_account_flow, relogin_existing_account_flow
from browser_pool import AllAccountsLimitedError, AllAccountsQuotaBlockedError, BrowserPool
from credential_store import AccountCredentialStore, CredentialStoreError
from media import ReferenceImageSizeError, download_reference_images, validate_reference_urls
from patchright.async_api import async_playwright
from proxy_manager import (
    MAX_PROXYFB_LINES,
    MAX_TEST_ITEMS,
    ProxyFBError,
    ProxyValidationError,
)
from store import PendingTaskLimitExceeded, TaskQuotaExceeded, TaskStore
from video_worker import (
    PostSubmitRateLimitError,
    RateLimitError,
    VideoDownloadError,
    VideoValidationError,
)
from video_worker_ui import (
    _extension_requires_legacy_handshake,
    _wait_for_extension_ready,
    _reload_before_submit,
    _is_content_policy_rejection_error,
    _is_duration_capability_error,
    _terminal_provider_response_error,
    AccountLimitedError,
    CannotAnswerQuestionError,
    CONTENT_POLICY_FINAL_MESSAGE,
    ContentPolicyFinalRefusalError,
    ContentPolicyRejectedError,
    CONTENT_POLICY_NO_RETRY_MESSAGE,
    CreditInsufficientError,
    DurationCapabilityMismatchError,
    FastModeFallbackError,
    FreshChatRetryError,
    ImageLikenessRejectedError,
    NoVideoCreationError,
    PostSubmitAccountLimitError,
    PostSubmitCreditError,
    ProfileRotationRetryError,
    ProviderBusyError,
    ProviderGenerationRejectedError,
    ProviderTaskIdEmptyError,
    ReferenceImageUploadTimeoutError,
    RenderStillProcessingError,
    RiskControlError,
    SessionExpiredError,
    SomethingWentWrongError,
)

Path(config.DOWNLOAD_DIR).mkdir(parents=True, exist_ok=True)
Path("web").mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="MaiVideo Seedance Video API",
    version="1.0.0",
    description="""
API tạo video Seedance qua Dola Gateway. Trong MaiVideo Studio, mở **Cài đặt → API cá nhân** để tự tạo key đầu tiên; key chỉ hiển thị đầy đủ một lần. Gửi key trong header `Authorization: Bearer <API_KEY>`. Key chỉ xác thực request; video tiêu thụ credit của các profile Seedance đã kết nối với Gateway.

## Bắt đầu nhanh

Thay `YOUR_API_KEY` bằng key cá nhân. Lưu `id` trong phản hồi để poll trạng thái:

```bash
curl -X POST "https://seedance.maivideo.top/v1/videos/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"seedance-2.5","prompt":"A cinematic shot of a red boat crossing a misty lake.","duration":10,"ratio":"16:9"}'
```

## Tạo một video

Gọi `POST /v1/videos/generations` với `model` (`seedance-2.0` hoặc `seedance-2.5`), `prompt`, `duration` (chỉ 5, 10 hoặc 15 giây) và tuỳ chọn `ratio` (`9:16`, `16:9`, `1:1`, `4:3`, `3:4`) hoặc `reference_images` (URL ảnh có thể truy cập được từ Gateway). API trả về `id` và `status=queued` ngay khi nhận job.

## Theo dõi và tạo hàng loạt

Poll `GET /v1/videos/{task_id}` đến khi `status` là `completed` hoặc `failed`; video hoàn tất có `video_url`, job lỗi có `error` và `failure_code`. Gửi nhiều prompt trong một request bằng `POST /v1/videos/batches` (tối đa 100 prompt). Mỗi key chỉ đọc và retry được job thuộc về người dùng đã tạo key đó.

Giới hạn sử dụng còn phụ thuộc vào số profile Seedance khả dụng, quota phía nhà cung cấp và giới hạn vận hành của Gateway.
""".strip(),
    openapi_tags=[
        {"name": "Video", "description": "Tạo, theo dõi và retry video Seedance."},
        {"name": "System", "description": "Kiểm tra trạng thái Gateway."},
    ],
)


def _custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
        tags=app.openapi_tags,
    )
    schemes = schema.setdefault("components", {}).setdefault("securitySchemes", {})
    schemes["BearerAuth"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "API key",
        "description": "Dán API key được tạo trong MaiVideo Studio → Cài đặt → API cá nhân.",
    }
    for path, operations in schema.get("paths", {}).items():
        if path.startswith("/v1/videos/"):
            for operation in operations.values():
                if isinstance(operation, dict):
                    operation.setdefault("security", [{"BearerAuth": []}])
    app.openapi_schema = schema
    return app.openapi_schema


app.openapi = _custom_openapi

store = TaskStore(config.DB_PATH)
pool = BrowserPool(max_concurrency=config.MAX_CONCURRENCY)
credential_store = AccountCredentialStore()

class VideoStaticFiles(StaticFiles):
    """Serve videos inline by default and as attachments for explicit downloads."""

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        query = parse_qs(bytes(scope.get("query_string", b"")).decode("latin-1"))
        if query.get("download", [""])[0] == "1" and response.status_code in (200, 206):
            requested = str(query.get("filename", ["video.mp4"])[0])[:180]
            filename = re.sub(r'[\\/\r\n\u0000-\u001f\u007f";]', "_", requested).strip()
            filename = filename or "video.mp4"
            ascii_filename = filename.encode("ascii", "ignore").decode("ascii") or "video.mp4"
            ascii_filename = re.sub(r'[\\/\r\n\u0000-\u001f\u007f";]', "_", ascii_filename)
            response.headers["Content-Disposition"] = (
                f'attachment; filename="{ascii_filename}"; '
                f"filename*=UTF-8''{quote(filename, safe='')}"
            )
        return response


app.mount("/videos", VideoStaticFiles(directory=config.DOWNLOAD_DIR), name="videos")


@app.middleware("http")
async def no_cache_video_downloads(request, call_next):
    """Keep a prior watermarked response from being reused by a tunnel/CDN."""
    response = await call_next(request)
    if request.url.path.startswith("/videos/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response

# Background jobs (add/verify/profile-sync), in-memory
JOBS: dict[str, dict] = {}
LOGIN_TASKS: dict[str, asyncio.Task] = {}
ACTIVE_LOGIN_JOB_STATUSES = {"queued", "running"}


def _is_active_job(job: dict | None) -> bool:
    return bool(job and job.get("status") in ACTIVE_LOGIN_JOB_STATUSES)


def _login_job_is_active(name: str) -> bool:
    """Return whether a real login worker owns this profile right now.

    Profile synchronization uses the same per-profile ``JOBS`` slot as login
    jobs.  Checking both the slot and the task map closes the small scheduling
    window between queuing a login and its coroutine starting.
    """
    job = JOBS.get(name, {})
    if job.get("kind") != "profile-sync" and _is_active_job(job):
        return True
    task = LOGIN_TASKS.get(name)
    return task is not None and not task.done()


def _new_login_job(kind: str) -> dict:
    return {
        "kind": kind,
        "status": "queued",
        "error": "",
        "queued_at": time.time(),
        "started_at": 0,
        "finished_at": 0,
        "id": uuid.uuid4().hex,
    }


def _update_job_if_current(name: str, job_id: str, **updates) -> bool:
    """Update a background job only while it is still the current job."""
    current = JOBS.get(name, {})
    if job_id and current.get("id") != job_id:
        return False
    JOBS[name] = {**current, **updates}
    return True


def _start_login_job(name: str, coroutine, job_id: str | None = None):
    job_id = job_id or JOBS.get(name, {}).get("id")
    task = asyncio.create_task(coroutine)
    LOGIN_TASKS[name] = task
    def clear(done):
        if LOGIN_TASKS.get(name) is done:
            LOGIN_TASKS.pop(name, None)
        if done.cancelled():
            return
        try:
            error = done.exception()
        except asyncio.CancelledError:
            return
        if error is None:
            return
        current = JOBS.get(name, {})
        if job_id and current.get("id") != job_id:
            return
        if _is_active_job(current):
            JOBS[name] = {
                **current,
                "status": "failed",
                "error": str(error)[:300],
                "finished_at": time.time(),
            }
            print(
                f"[admin] Login worker crashed name={name}: {str(error)[:240]}",
                flush=True,
            )
    task.add_done_callback(clear)
    return task

# A profile-sync task is intentionally separate from the interactive profile
# session.  The browser must be fully released before a headless verifier can
# open the same persistent profile, and the result should remain visible to
# the dashboard while that hand-off is happening.
PROFILE_SYNC_TASKS: dict[str, asyncio.Task] = {}

# Interactive admin profile sessions, in-memory.  The lock is deliberately
# held for the lifetime of the visible Chromium window so a render cannot
# start using the same persistent profile while an operator is inspecting it.
OPEN_PROFILE_SESSIONS: dict[str, dict] = {}
OPEN_PROFILE_GUARD = asyncio.Lock()

# A poll window uses a short-lived Chromium context. When Dola is still
# rendering, the task remains durable in SQLite and this map schedules the
# next context without creating a second conversation.
VIDEO_POLL_TASKS: dict[str, asyncio.Task] = {}

# Keep references to the top-level generation/recovery workers so an admin
# can stop a stuck local Chromium session instead of only removing its row
# from SQLite. Poll windows are tracked separately above because they hand
# off to one another while an accepted Dola conversation is still rendering.
VIDEO_WORKER_TASKS: dict[str, asyncio.Task] = {}
VIDEO_CANCELLED_TASKS: set[str] = set()
TASK_REFERENCE_IMAGE_CACHE: dict[str, dict] = {}
ACTIVE_VIDEO_STATUSES = {"queued", "submitting", "processing"}

# Login is deliberately serialized. Google OAuth may open an interactive
# window and can trigger 2FA or an identity check, so opening several login
# windows at once creates avoidable risk and makes manual verification unclear.
ACCOUNT_ADD_LOCK = asyncio.Lock()
ACCOUNT_ADD_LAST_FINISHED = 0.0

SIZE_TO_RATIO = {
    "1280x720": "16:9", "1920x1080": "16:9",
    "720x1280": "9:16", "1080x1920": "9:16",
    "1024x1024": "1:1", "1440x1080": "4:3", "1080x1440": "3:4",
}
SUPPORTED_DURATIONS = (5, 10, 15)
ENABLED_MODEL_KEYS = {
    "seedance_2.0", "seedance_v2.0", "seedance_20", "seedance_v20",
    "seedance_2.5", "seedance_v2.5", "seedance_25", "seedance_v25",
}
NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
OWNER_ID_RE = re.compile(r"^[0-9a-f]{64}$")


def _normalize_owner_id(value, *, required=False):
    """Validate the Studio's opaque MaiVideo-owner identifier."""
    owner_id = str(value or "").strip().lower()
    if not owner_id:
        if required:
            raise HTTPException(401, "missing task owner")
        return None
    if not OWNER_ID_RE.fullmatch(owner_id):
        raise HTTPException(400, "invalid task owner")
    return owner_id


render_pool = pool

# A risk-controlled profile is temporarily unavailable, rather than logged
# out. This task checks expired cooldowns in the background and restores only
# profiles whose persisted Dola session is valid again.
RISK_RECOVERY_TASK: asyncio.Task | None = None
# Rotating ProxyFB keys are refreshed in the background before their endpoint
# lifetime expires, so opening a profile normally only consumes the cached
# fresh endpoint and does not need to call changeProxy synchronously.
PROXY_ROTATION_TASK: asyncio.Task | None = None
STARTUP_RECOVERY_TASK: asyncio.Task | None = None


async def _risk_control_recovery_loop():
    # Let Uvicorn answer its readiness probe before an expired risk profile is
    # reopened. The profile check also runs off the main event loop, but this
    # grace period avoids competing with durable task recovery during a cold
    # restart.
    await asyncio.sleep(config.STARTUP_RECOVERY_DELAY_SEC)
    while True:
        try:
            # Risk verification opens Chromium and should wait until the
            # render queue is idle. Starting it beside a batch of 20 video
            # workers can otherwise exhaust browser/CPU resources and make
            # the Gateway appear dead even though the checks are auxiliary.
            pending = await asyncio.to_thread(store.pending_task_count)
            if pending:
                await asyncio.sleep(config.RISK_CONTROL_RECOVERY_INTERVAL_SEC)
                continue
            await pool.recover_expired_risk_accounts()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # Recovery is auxiliary; a transient browser/SQLite failure must
            # not stop the API or video workers.
            print(
                f"[risk-recovery] kiểm tra profile hết cooldown thất bại: {str(exc)[:240]}",
                flush=True,
            )
        await asyncio.sleep(config.RISK_CONTROL_RECOVERY_INTERVAL_SEC)


async def _proxy_rotation_loop():
    """Keep ProxyFB endpoints fresh without changing an active render's route."""
    while True:
        try:
            # ProxyFB rotates a shared leased endpoint. Chromium keeps the
            # proxy it started with, so refreshing a key during an active
            # render disconnects every browser currently using that key from
            # Dola. Defer those keys until their browser contexts release them.
            async with pool._dispatch_selection_lock:
                active_proxy_ids = {
                    proxy_id
                    for proxy_id, active_count in pool._active_proxy_dispatches.items()
                    if active_count > 0
                }
            result = await asyncio.to_thread(
                pool.proxy_manager.rotate_due_proxyfb,
                active_proxy_ids,
            )
            rotated = result.get("rotated", [])
            deferred = result.get("deferred", [])
            failed = result.get("failed", [])
            if rotated or deferred or failed:
                print(
                    f"[proxy-rotation] checked={result.get('checked', 0)} "
                    f"rotated={len(rotated)} deferred_active={len(deferred)} "
                    f"failed={len(failed)}",
                    flush=True,
                )
                for item in failed:
                    print(
                        f"[proxy-rotation] {item.get('name', item.get('proxy_id'))}: "
                        f"{str(item.get('error') or '')[:240]}",
                        flush=True,
                    )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # Rotation is auxiliary. A transient ProxyFB/API/SQLite failure
            # must not stop the Gateway; the next short scan retries it.
            print(
                f"[proxy-rotation] kiểm tra tự động thất bại: {str(exc)[:240]}",
                flush=True,
            )
        await asyncio.sleep(config.PROXYFB_ROTATION_CHECK_INTERVAL_SEC)


def _profile_sync_job_is_current(name: str, sync_id: str) -> bool:
    job = JOBS.get(name, {})
    return (
        job.get("id") == sync_id
        and job.get("kind") == "profile-sync"
        and job.get("status") in ACTIVE_LOGIN_JOB_STATUSES
        and not _login_job_is_active(name)
    )


async def _cancel_profile_sync_for_login(name: str):
    """Stop the auxiliary close-profile verifier before queuing OAuth."""
    task = PROFILE_SYNC_TASKS.get(name)
    if task is not None and not task.done():
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    current = JOBS.get(name, {})
    if current.get("kind") == "profile-sync" and _is_active_job(current):
        if JOBS.get(name) is current:
            JOBS.pop(name, None)
        print(
            f"[admin] Cancelled profile-sync before login name={name}",
            flush=True,
        )


async def _run_profile_sync(name: str, session: dict, sync_id: str) -> bool | None:
    """Refreshes login metadata after an interactive profile is closed.

    Google/Dola may commit the browser cookie shortly after the operator
    finishes OAuth.  A short delayed retry avoids the false "not logged in"
    result that previously required pressing the manual Verify button.
    """
    await asyncio.sleep(config.PROFILE_SYNC_RETRY_DELAY_SEC)
    if not _profile_sync_job_is_current(name, sync_id):
        print(
            f"[admin] Profile {name} sync skipped because a login job owns the profile",
            flush=True,
        )
        return None
    started_at = time.time()
    result = False
    last_error = ""
    attempts = config.PROFILE_SYNC_ATTEMPTS
    attempt = 0
    for attempt in range(1, attempts + 1):
        current_job = JOBS.get(name, {})
        if not _profile_sync_job_is_current(name, sync_id):
            print(
                f"[admin] Profile {name} sync stopped because its job was superseded",
                flush=True,
            )
            return None
        JOBS[name] = {
            **current_job,
            "status": "running",
            "started_at": started_at,
            "attempt": attempt,
        }
        try:
            # Login/session verification is intentionally page-based. A
            # A post-login test chat can block on Dola's send control after
            # OAuth has already completed and falsely mark a valid profile failed.
            result = await pool.verify_account(name)
            if result:
                break
        except Exception as exc:
            last_error = str(exc)[:300]
        if attempt < attempts:
            await asyncio.sleep(config.PROFILE_SYNC_RETRY_DELAY_SEC)

    if not _profile_sync_job_is_current(name, sync_id):
        print(
            f"[admin] Profile {name} sync result discarded because its job was superseded",
            flush=True,
        )
        return None
    session["verified_login_ok"] = bool(result)
    finished_at = time.time()
    current_job = JOBS.get(name, {})
    if not _profile_sync_job_is_current(name, sync_id):
        return None
    JOBS[name] = {
        **current_job,
        "status": "success" if result else "failed",
        "ok": bool(result),
        "error": "" if result else (last_error or "Dola chưa có session sau khi đóng profile"),
        "attempt": attempt,
        "finished_at": finished_at,
    }
    print(
        f"[admin] Profile {name} closed; session sync "
        f"{'succeeded' if result else 'did not find a Dola session'} "
        f"after {attempt} attempt(s)",
        flush=True,
    )
    return bool(result)


def _start_profile_sync(name: str, session: dict) -> asyncio.Task | None:
    """Starts one post-close verification task and deduplicates callbacks."""
    if _login_job_is_active(name):
        print(
            f"[admin] Profile {name} close-sync skipped because login is queued/running",
            flush=True,
        )
        return None
    existing = PROFILE_SYNC_TASKS.get(name)
    if existing is not None and not existing.done():
        return existing
    sync_id = uuid.uuid4().hex
    JOBS[name] = {
        "kind": "profile-sync",
        "status": "queued",
        "ok": None,
        "error": "",
        "queued_at": time.time(),
        "started_at": 0,
        "finished_at": 0,
        "attempt": 0,
        "id": sync_id,
    }
    task = asyncio.create_task(_run_profile_sync(name, session, sync_id))
    PROFILE_SYNC_TASKS[name] = task

    def clear_task(done_task):
        if PROFILE_SYNC_TASKS.get(name) is done_task:
            PROFILE_SYNC_TASKS.pop(name, None)

    task.add_done_callback(clear_task)
    return task


async def _watch_open_profile(name: str, session: dict):
    """Detects a native Chromium close when Patchright emits no close event."""
    probe_failures = 0
    next_probe_at = 0.0
    next_auth_check_at = 0.0
    try:
        while not session.get("cleaned"):
            await asyncio.sleep(1)
            if session.get("cleaned"):
                return
            context = session.get("context")
            if context is None:
                await _cleanup_open_profile(name, session)
                return
            try:
                pages = context.pages
                open_pages = [page for page in pages if not page.is_closed()]
                if not open_pages:
                    await _cleanup_open_profile(name, session)
                    return
                now = time.monotonic()
                if now >= next_probe_at:
                    next_probe_at = now + 2
                    await asyncio.wait_for(
                        open_pages[0].evaluate("() => document.readyState"),
                        timeout=4,
                    )
                    probe_failures = 0
                # A user may finish the Dola OAuth flow inside this still-open
                # profile. Check the live Dola tab periodically so a previous
                # risk marker is cleared without requiring a close/reopen or a
                # separate Verify click. Generic header "Log In" text is
                # intentionally ignored by _page_has_logged_out_marker.
                if now >= next_auth_check_at:
                    next_auth_check_at = now + 5
                    try:
                        dola_page = next(
                            (
                                page for page in open_pages
                                if "dola.com" in str(page.url or "")
                            ),
                            None,
                        )
                        if dola_page is not None and "from_logout" not in str(dola_page.url or ""):
                            cookies = await context.cookies("https://www.dola.com")
                            if has_dola_session(cookies) and not await _page_has_logged_out_marker(dola_page):
                                pool.mark_session_verified(name)
                                session["verified_login_ok"] = True
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        # Auth probing is best-effort while the operator is
                        # navigating OAuth; a transient page change must not
                        # be mistaken for a closed native profile.
                        pass
            except asyncio.CancelledError:
                raise
            except Exception:
                # A transient navigation can briefly reject the probe. Two
                # consecutive failures are enough to identify a disconnected
                # native window without reacting to one slow page load.
                probe_failures += 1
                if probe_failures >= 2:
                    await _cleanup_open_profile(name, session)
                    return
    except asyncio.CancelledError:
        raise


async def _cleanup_open_profile(name: str, session: dict):
    """Releases the profile and starts automatic post-close verification."""
    if session.get("cleaned"):
        return
    session["cleaned"] = True
    if OPEN_PROFILE_SESSIONS.get(name) is session:
        OPEN_PROFILE_SESSIONS.pop(name, None)

    watch_task = session.get("watch_task")
    if watch_task is not None and watch_task is not asyncio.current_task():
        watch_task.cancel()
        try:
            await watch_task
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    manager = session.get("playwright")
    if manager is not None:
        try:
            await manager.stop()
        except Exception:
            pass

    lock = session.get("lock")
    if session.get("lock_acquired"):
        session["lock_acquired"] = False
        if lock is not None and lock.locked():
            lock.release()

    # If the operator logged in while the window was open, refresh the
    # persisted account status automatically after the window closes. The
    # verification starts only after the profile lock is released, so it can
    # safely reopen the same persistent profile in headless mode.
    if session.get("verify_on_close") and not session.get("verification_started"):
        session["verification_started"] = True
        sync_task = _start_profile_sync(name, session)
        if sync_task is not None and session.get("wait_for_verify"):
            try:
                session["verified_login_ok"] = await sync_task
            except Exception:
                session["verified_login_ok"] = False
        elif sync_task is None:
            # A login worker has taken ownership of the profile. Do not let a
            # skipped close-sync make the close endpoint report a false login
            # result while the OAuth job is still queued/running.
            session["verified_login_ok"] = None


def _schedule_open_profile_cleanup(name: str, session: dict):
    """Schedules cleanup when the operator closes Chromium manually."""
    if session.get("closing") or session.get("cleaned") or session.get("cleanup_scheduled"):
        return
    session["cleanup_scheduled"] = True
    asyncio.create_task(_cleanup_open_profile(name, session))


async def _navigate_open_profile_to_dola(page) -> tuple[bool, str]:
    """Open the public Dola sign-in entry point, then try chat as a fallback."""
    errors = []
    for url in ("https://www.dola.com/", "https://www.dola.com/chat"):
        try:
            await page.goto(
                url,
                timeout=config.OPEN_PROFILE_NAV_TIMEOUT_SEC * 1000,
                wait_until="domcontentloaded",
            )
            title = (await page.title()).casefold()
            if "attention required" in title or "cloudflare" in title:
                raise RuntimeError("Dola trả về trang chặn Cloudflare qua proxy hiện tại")
            return True, ""
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {str(exc)[:140]}")
    return False, " | ".join(errors)[:240]


async def _open_account_profile(name: str) -> dict:
    """Opens one persisted account profile in a visible Chromium window."""
    async with OPEN_PROFILE_GUARD:
        existing = OPEN_PROFILE_SESSIONS.get(name)
        if existing is not None:
            try:
                pages = existing["context"].pages
                page = pages[0] if pages else await existing["context"].new_page()
                page_host = urlparse(page.url).hostname or ""
                is_google_login = page_host == "accounts.google.com" or page_host.endswith(".accounts.google.com")
                needs_dola_navigation = not is_google_login and (
                    page_host not in {"dola.com", "www.dola.com"}
                    or existing.get("dola_navigation_ok") is False
                )
                if needs_dola_navigation:
                    ok, error = await _navigate_open_profile_to_dola(page)
                    existing["dola_navigation_ok"] = ok
                    existing["dola_navigation_error"] = error
                    if not ok:
                        print(
                            f"[admin] Existing profile {name} could not load Dola: {error}",
                            flush=True,
                        )
                await page.bring_to_front()
                return {
                    "already_open": True,
                    "opened_at": existing["opened_at"],
                    "extension_loaded": existing["extension_loaded"],
                    "proxy_id": existing.get("proxy_id"),
                    "proxy_name": existing.get("proxy_name", "Global mặc định"),
                    "proxy_status": existing.get("proxy_status", "default"),
                    "dola_navigation_ok": existing.get("dola_navigation_ok", True),
                    "dola_navigation_error": existing.get("dola_navigation_error", ""),
                }
            except Exception:
                # A native window may have been closed between requests. Let
                # the normal cleanup path release its lock before reopening.
                await _cleanup_open_profile(name, existing)

        job = JOBS.get(name, {})
        if job.get("status") in {"queued", "running"}:
            raise RuntimeError("account login is queued or running")
        if pool.account_is_busy(name):
            raise RuntimeError("account profile is busy; wait for the current operation to finish")

        profile_dir = pool.accounts_dir / name
        if not profile_dir.is_dir():
            raise FileNotFoundError(f"Profile does not exist: {profile_dir}")

        lock = pool.account_lock(name)
        if lock.locked():
            raise RuntimeError("account profile is busy; wait for the current operation to finish")
        await lock.acquire()

        manager = None
        context = None
        dola_navigation_ok = False
        dola_navigation_error = ""
        try:
            # ProxyFB activation and IP checks perform blocking I/O and may
            # wait up to 120 seconds. Keep the HTTP event loop responsive throughout.
            proxy = await asyncio.to_thread(pool.proxy_for_account, name)
            proxy_metadata = await asyncio.to_thread(pool.proxy_manager.account_public, name)
            manager = await async_playwright().start()
            # Manual profile windows use the configured extension as video
            # workers. This keeps every persisted profile consistent when an
            # operator opens it from /tai-khoan-seedance and inspects the
            # configured 15s/unwatermarked capability for that profile.
            extension_loaded = False
            context = await launch_account_context(
                manager,
                name,
                headless=False,
                use_extension=True,
                hide_window=False,
                proxy=proxy,
                browser_channel=login_browser_channel(),
            )
            extension_loaded = True
            page = context.pages[0] if context.pages else await context.new_page()
            # Start at Dola's public sign-in entry point. If that route is not
            # available through the assigned proxy, try the chat route before
            # leaving the account profile open for manual recovery.
            dola_navigation_ok, dola_navigation_error = await _navigate_open_profile_to_dola(page)
            if dola_navigation_ok:
                if _extension_requires_legacy_handshake():
                    await _wait_for_extension_ready(page)
                    await _reload_before_submit(page)
                    await _wait_for_extension_ready(page)
            else:
                try:
                    open_pages = [item for item in context.pages if not item.is_closed()]
                except Exception:
                    open_pages = []
                if not open_pages:
                    raise RuntimeError(dola_navigation_error or "Dola page did not open")
                print(
                    f"[admin] Profile {name} opened, but Dola navigation did not complete: "
                    f"{dola_navigation_error}",
                    flush=True,
                )
            try:
                # Opening a profile is also a safe opportunity to correct a
                # stale "Chưa xác minh/Hết phiên" flag when the session cookie
                # is already present.
                cookies = await context.cookies("https://www.dola.com")
                if has_dola_session(cookies):
                    # A cookie alone is not enough: risk-control pages can
                    # retain the old cookie while showing a login wall. When
                    # the opened page is usable, clear a stale risk marker
                    # immediately; otherwise leave it for post-close verify.
                    if await _page_has_logged_out_marker(page):
                        pool.set_login_status(name, True)
                    else:
                        pool.mark_session_verified(name)
            except Exception:
                pass
            session = {
                "context": context,
                "playwright": manager,
                "lock": lock,
                "lock_acquired": True,
                "opened_at": time.time(),
                "extension_loaded": extension_loaded,
                "verify_on_close": True,
                "proxy_id": proxy_metadata.get("proxy_id"),
                "proxy_name": proxy_metadata.get("proxy_name", "Global mặc định"),
                "proxy_status": proxy_metadata.get("proxy_status", "default"),
                "dola_navigation_ok": dola_navigation_ok,
                "dola_navigation_error": dola_navigation_error,
            }
            OPEN_PROFILE_SESSIONS[name] = session
            context.on("close", lambda *_args: _schedule_open_profile_cleanup(name, session))
            session["watch_task"] = asyncio.create_task(_watch_open_profile(name, session))
            try:
                await page.bring_to_front()
            except Exception:
                pass
            return {
                "already_open": False,
                "opened_at": session["opened_at"],
                "extension_loaded": extension_loaded,
                "proxy_id": session["proxy_id"],
                "proxy_name": session["proxy_name"],
                "proxy_status": session["proxy_status"],
                "dola_navigation_ok": dola_navigation_ok,
                "dola_navigation_error": dola_navigation_error,
            }
        except BaseException:
            if context is not None:
                try:
                    await context.close()
                except Exception:
                    pass
            if manager is not None:
                try:
                    await manager.stop()
                except Exception:
                    pass
            if lock.locked():
                lock.release()
            raise


async def _close_open_profile(
    name: str,
    verify_on_close: bool = True,
    wait_for_verify: bool = True,
) -> tuple[bool, bool | None]:
    """Closes a profile opened from the admin dashboard."""
    session = OPEN_PROFILE_SESSIONS.get(name)
    if session is None:
        return False, None
    session["closing"] = True
    session["verify_on_close"] = verify_on_close
    session["wait_for_verify"] = bool(verify_on_close and wait_for_verify)
    try:
        await session["context"].close()
    except Exception:
        pass
    finally:
        await _cleanup_open_profile(name, session)
    return True, session.get("verified_login_ok")


@app.on_event("shutdown")
async def _close_all_open_profiles():
    """Does not leave native Chromium processes behind on Gateway shutdown."""
    global RISK_RECOVERY_TASK, PROXY_ROTATION_TASK, STARTUP_RECOVERY_TASK
    if STARTUP_RECOVERY_TASK is not None:
        STARTUP_RECOVERY_TASK.cancel()
        try:
            await STARTUP_RECOVERY_TASK
        except asyncio.CancelledError:
            pass
        STARTUP_RECOVERY_TASK = None
    if RISK_RECOVERY_TASK is not None:
        RISK_RECOVERY_TASK.cancel()
        try:
            await RISK_RECOVERY_TASK
        except asyncio.CancelledError:
            pass
        RISK_RECOVERY_TASK = None
    if PROXY_ROTATION_TASK is not None:
        PROXY_ROTATION_TASK.cancel()
        try:
            await PROXY_ROTATION_TASK
        except asyncio.CancelledError:
            pass
        PROXY_ROTATION_TASK = None
    for name in list(OPEN_PROFILE_SESSIONS):
        await _close_open_profile(name, verify_on_close=False)


def _generated_profile_name(email: str) -> str:
    """Create a stable, filesystem-safe Chromium profile id from an email."""
    normalized = email.strip().lower()
    local = normalized.split("@", 1)[0]
    base = re.sub(r"[^A-Za-z0-9_-]+", "-", local).strip("-_") or "account"
    suffix = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:8]
    max_base_length = 32 - len(suffix) - 1
    return base[:max_base_length] + "-" + suffix


class KeyConcurrencyLimiter:
    """Concurrency limits per API Key; 0 = unlimited."""

    def __init__(self):
        self._condition = asyncio.Condition()
        self._active: defaultdict[str, int] = defaultdict(int)

    async def acquire(self, api_key_hash: str | None, limit: int):
        if not api_key_hash or limit <= 0:
            return
        async with self._condition:
            while self._active[api_key_hash] >= limit:
                await self._condition.wait()
            self._active[api_key_hash] += 1

    async def release(self, api_key_hash: str | None):
        if not api_key_hash:
            return
        async with self._condition:
            if self._active[api_key_hash] > 0:
                self._active[api_key_hash] -= 1
            if self._active[api_key_hash] == 0:
                self._active.pop(api_key_hash, None)
            self._condition.notify_all()



key_limiter = KeyConcurrencyLimiter()


# ===== Authentication =====


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _anonymous_client() -> dict:
    return {
        "api_key_hash": None,
        "api_key_name": "Anonymous",
        "daily_limit": 0,
        "concurrency_limit": 0,
        "allowed_durations": list(SUPPORTED_DURATIONS),
        "owner_id": None,
    }


def _env_client(key: str) -> dict:
    return {
        "api_key_hash": _hash_key(key),
        "api_key_name": f"Env Key ({key[:8]}…)",
        "daily_limit": 0,
        "concurrency_limit": 0,
        "allowed_durations": list(SUPPORTED_DURATIONS),
        "owner_id": None,
    }


def _signed_studio_owner(owner_id: str | None, signature: str | None) -> str | None:
    """Accept an owner scope only when it is signed by the Studio server."""
    if not owner_id or not signature:
        return None
    normalized_owner = _normalize_owner_id(owner_id)
    message = ("dola-studio-owner:" + normalized_owner).encode("utf-8")
    secrets = [config.ADMIN_KEY, *config.API_KEYS, config.TASK_OWNER_SECRET]
    for secret in dict.fromkeys(str(value or "").strip() for value in secrets):
        if not secret:
            continue
        expected = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, str(signature).strip().lower()):
            return normalized_owner
    return None


def _auth(authorization, owner_header=None, internal_signature=None):
    """Returns client policy; signed Studio requests remain separate from user keys."""
    internal_owner = _signed_studio_owner(owner_header, internal_signature)
    if internal_owner:
        return {
            "api_key_hash": _hash_key("studio:" + internal_owner),
            "api_key_name": "MaiVideo Studio",
            "daily_limit": 0,
            "concurrency_limit": 0,
            "allowed_durations": list(SUPPORTED_DURATIONS),
            "owner_id": internal_owner,
        }

    if not config.API_KEYS and not store.has_enabled_keys() and not store.has_user_keys():
        return _anonymous_client()
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing bearer token")
    key = authorization[7:].strip()
    if not key:
        raise HTTPException(401, "missing bearer token")
    if key in config.API_KEYS:
        client = _env_client(key)
    else:
        record = store.get_key(key)
        if not record or not store.is_key_valid(key):
            raise HTTPException(401, "invalid api key")
        store.touch_key(key)
        client = {
            "api_key_hash": _hash_key(key),
            "api_key_name": record["name"] or "Unnamed Client",
            "daily_limit": record["daily_limit"],
            "concurrency_limit": record["concurrency_limit"],
            "allowed_durations": record["allowed_durations"],
            "owner_id": _normalize_owner_id(record.get("owner_id")),
        }

    bound_owner = client.get("owner_id")
    if bound_owner and owner_header:
        requested_owner = _normalize_owner_id(owner_header)
        if requested_owner != bound_owner:
            raise HTTPException(403, "API key không thuộc task owner được yêu cầu")
    return client


def _admin_auth(x_admin_key: str | None):
    if not config.ADMIN_KEY:
        raise HTTPException(503, "Cần cấu hình DOLA_ADMIN_KEY để quản lý Gateway")
    if x_admin_key != config.ADMIN_KEY:
        raise HTTPException(401, "invalid admin key")


def _user_key_admin_auth(x_admin_key: str | None):
    """Never expose user-key management through an unprotected Gateway."""
    if not config.ADMIN_KEY:
        raise HTTPException(503, "Cần cấu hình DOLA_ADMIN_KEY để quản lý API key người dùng")
    _admin_auth(x_admin_key)


def _resolve_profile_names(values: list[str]) -> list[str]:
    """Resolve admin supplied profile names/emails to canonical pool names."""
    aliases = {}
    for item in render_pool.list_accounts():
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        aliases[name.casefold()] = name
        email = str(item.get("email") or "").strip()
        if email:
            aliases[email.casefold()] = name

    resolved = []
    for value in values:
        alias = str(value or "").strip().casefold()
        canonical = aliases.get(alias)
        if not canonical:
            raise HTTPException(404, f"Không tìm thấy profile: {value}")
        resolved.append(canonical)
    return resolved


def _normalize_allowed_durations(values) -> list[int]:
    if values is None:
        return list(SUPPORTED_DURATIONS)
    try:
        normalized = sorted({int(value) for value in values})
    except (TypeError, ValueError):
        raise HTTPException(422, "allowed_durations must be an array of 5, 10, or 15")
    if not normalized or any(value not in SUPPORTED_DURATIONS for value in normalized):
        raise HTTPException(422, "allowed_durations must contain at least one of 5, 10, or 15")
    return normalized


# ===== Client API =====


class VideoGenRequest(BaseModel):
    model: str = "seedance-2.5"
    chat_mode: str = "Fast"
    prompt: str = Field(..., min_length=1)
    # Admin-only profile pin used for controlled profile smoke tests.
    account: str | None = Field(default=None, min_length=1, max_length=128)
    size: str | None = None
    ratio: str | None = None
    duration: int | None = Field(
        None,
        ge=5,
        le=15,
        description="Only 5, 10, or 15 seconds are accepted.",
        json_schema_extra={"enum": [5, 10, 15]},
    )
    reference_images: list[str] = Field(default_factory=list)
    # Optional original browser filenames, kept in the same order as the
    # reference_images manifest so retries and extension uploads are stable.
    reference_image_names: list[str] = Field(default_factory=list, max_length=30)
    reference_image_mode: str = "none"

    model_config = {
        "json_schema_extra": {
            "examples": [{
                "model": "seedance-2.5",
                "prompt": "A cinematic shot of a small red boat crossing a misty lake at sunrise.",
                "duration": 10,
                "ratio": "16:9",
                "reference_images": [],
            }]
        }
    }


class VideoBatchRequest(BaseModel):
    model: str = "seedance-2.5"
    chat_mode: str = "Fast"
    prompts: list[str] = Field(..., min_length=1, max_length=100)
    # Admin-only, one canonical profile/email per prompt. This remains
    # optional so existing clients continue to use normal pool scheduling.
    accounts: list[str] | None = Field(default=None, max_length=100)
    size: str | None = None
    ratio: str | None = None
    duration: int | None = Field(
        None,
        ge=5,
        le=15,
        description="Only 5, 10, or 15 seconds are accepted.",
        json_schema_extra={"enum": [5, 10, 15]},
    )
    reference_images: list[str] = Field(default_factory=list)
    reference_image_names: list[str] = Field(default_factory=list, max_length=30)
    reference_image_mode: str = "none"

    model_config = {
        "json_schema_extra": {
            "examples": [{
                "model": "seedance-2.5",
                "prompts": [
                    "A cinematic shot of a red boat crossing a misty lake.",
                    "A close-up of a lighthouse beam cutting through fog.",
                ],
                "duration": 10,
                "ratio": "16:9",
            }]
        }
    }


class TaskRetryRequest(BaseModel):
    # Admin retries may pin a logical task to the profile selected by the
    # operator. The public client retry path remains pool-managed.
    account: str | None = Field(default=None, min_length=1, max_length=128)
    # Admin retries can exclude profiles already used by the same logical job.
    excluded_accounts: list[str] | None = Field(default=None, max_length=50)
    # The Studio may repair a legacy task by sending the same images from its
    # local reference store with URLs that the Gateway can fetch.
    reference_images: list[str] | None = Field(default=None, max_length=30)
    reference_image_names: list[str] | None = Field(default=None, max_length=30)
    reference_image_mode: str | None = None


class AdminNoVideoRetryRequest(BaseModel):
    # The operator copies the final assistant response observed in the Dola
    # conversation. The route accepts only a generic no-video response and
    # keeps policy refusals on their separate handling path.
    response: str = Field(min_length=1, max_length=5000)


class TaskResponse(BaseModel):
    id: str
    status: str
    model: str | None = None
    chat_mode: str = "Fast"
    duration: int | None = None
    prompt: str | None = None
    # Logical Chromium/Dola profile that accepted the composer input. This is
    # intentionally exposed to the dashboard so an operator can inspect the
    # exact profile used by a task.
    account: str | None = None
    video_url: str | None = None
    error: str | None = None
    failure_code: str | None = None
    video_metadata: dict | None = None
    timings: dict | None = None
    reference_image_names: list[str] = Field(default_factory=list)
    reference_image_mode: str = "none"
    retry_of: str | None = None
    retry_count: int = 0


def _resolve_ratio(size, ratio):
    if size and size in SIZE_TO_RATIO:
        return SIZE_TO_RATIO[size]
    return ratio


def _truncate_prompt(prompt) -> str:
    """Normalize one prompt and remove content beyond Dola's input limit."""
    return video_prompt(prompt, config.MAX_PROMPT_CHARS)


def _normalize_reference_image_mode(value, prompt="") -> str:
    """Keep the reference-mode state explicit, including legacy sketch rows."""
    raw = str(value or "").strip().lower()
    if raw == "sketch":
        return "sketch"
    if SKETCH_COLOR_RESTORATION_MARKER.lower() in str(prompt or "").lower():
        return "sketch"
    return "none"


def _normalize_chat_mode(value) -> str:
    normalized = str(value or "Fast").strip().casefold()
    if normalized not in {"fast", "pro"}:
        raise ValueError("Chế độ tạo video phải là Fast hoặc Pro")
    return "Pro" if normalized == "pro" else "Fast"


def _task_chat_mode(timings: dict) -> str:
    raw_mode = timings.get("chat_mode_override") or timings.get("chat_mode_default") or "Fast"
    try:
        return _normalize_chat_mode(raw_mode)
    except ValueError:
        return "Fast"


def _validate_video_config(client: dict, model, prompt, duration, size=None, ratio=None):
    """Validate and normalize one generation config for all client endpoints."""
    prompt_value = _truncate_prompt(prompt)
    if not prompt_value:
        raise HTTPException(422, "prompt must not be empty")

    duration_value = int(duration or 15)
    if duration_value not in SUPPORTED_DURATIONS:
        raise HTTPException(422, "Currently supports durations of 5s, 10s, and 15s")

    model_value = str(model or "seedance-2.5").strip()
    model_key = model_value.lower().replace("-", "_")
    if model_key not in ENABLED_MODEL_KEYS:
        raise HTTPException(422, "Chỉ hỗ trợ Seedance 2.0 hoặc Seedance 2.5")
    if duration_value not in client["allowed_durations"]:
        raise HTTPException(422, f"Current API Key is not allowed to generate {duration_value}s videos")

    resolved_ratio = _resolve_ratio(size, ratio)
    if resolved_ratio and resolved_ratio not in {"9:16", "16:9", "1:1", "4:3", "3:4"}:
        raise HTTPException(422, "Invalid aspect ratio")
    resolved_ratio = resolved_ratio or "16:9"
    prompt_value = pro_video_prompt(prompt_value, resolved_ratio, duration_value, config.MAX_PROMPT_CHARS)
    return model_value, prompt_value, resolved_ratio, duration_value


def _encode_video_metadata(result: dict) -> str | None:
    metadata = result.get("video_metadata") if isinstance(result, dict) else None
    if not isinstance(metadata, dict) or not metadata:
        return None
    return json.dumps(metadata, ensure_ascii=False, separators=(",", ":"))


def _decode_video_metadata(raw) -> dict | None:
    if not raw:
        return None
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _encode_task_timings(timings: dict) -> str | None:
    if not isinstance(timings, dict) or not timings:
        return None
    return json.dumps(timings, ensure_ascii=False, separators=(",", ":"))


def _decode_task_timings(raw) -> dict | None:
    value = _decode_video_metadata(raw)
    return value if isinstance(value, dict) else None


def _task_response(row: dict) -> TaskResponse:
    timings = _decode_task_timings(row.get("timings_json")) or {}
    return TaskResponse(
        id=row["id"], status=row["status"], model=row["model"],
        chat_mode=_task_chat_mode(timings),
        duration=row.get("duration"), prompt=row["prompt"],
        account=row.get("account"),
        video_url=row.get("video_url"), error=row.get("error"),
        failure_code=row.get("failure_code"),
        video_metadata=_decode_video_metadata(row.get("video_metadata")),
        timings=timings or None,
        reference_image_names=_task_reference_image_names(row.get("reference_image_names")),
        reference_image_mode=_normalize_reference_image_mode(
            row.get("reference_image_mode"), row.get("prompt")
        ),
        retry_of=row.get("retry_of"),
        retry_count=max(0, int(row.get("retry_count") or 0)),
    )


def _task_status_response(row: dict) -> dict:
    """Small payload for queue polling; prompts and references are sent once on list load."""
    timings = _decode_task_timings(row.get("timings_json")) or {}
    return {
        "id": row["id"],
        "status": row["status"],
        "model": row.get("model"),
        "chat_mode": _task_chat_mode(timings),
        "duration": row.get("duration"),
        "account": row.get("account"),
        "video_url": row.get("video_url"),
        "error": row.get("error"),
        "failure_code": row.get("failure_code"),
        "video_metadata": _decode_video_metadata(row.get("video_metadata")),
        "timings": timings or None,
    }


def _track_video_task(task_id: str, coroutine):
    """Create and retain a cancellable task worker for one logical video."""
    VIDEO_CANCELLED_TASKS.discard(task_id)
    task = asyncio.create_task(coroutine)
    VIDEO_WORKER_TASKS[task_id] = task

    def cleanup(done):
        if VIDEO_WORKER_TASKS.get(task_id) is done:
            VIDEO_WORKER_TASKS.pop(task_id, None)

    task.add_done_callback(cleanup)
    return task


def _clear_task_reference_cache(task_id: str):
    cached = TASK_REFERENCE_IMAGE_CACHE.pop(task_id, None)
    if cached and cached.get("root"):
        shutil.rmtree(cached["root"], ignore_errors=True)


def _cleanup_reference_cache_after_attempt(task_id: str):
    current_task = asyncio.current_task()
    replacement = VIDEO_WORKER_TASKS.get(task_id)
    retry_is_running = bool(
        task_id not in VIDEO_CANCELLED_TASKS
        and replacement
        and replacement is not current_task
        and not replacement.done()
    )
    if not retry_is_running:
        _clear_task_reference_cache(task_id)


def _schedule_video_poll(task_id: str, delay_sec: int | None = None):
    """Schedules one follow-up poll for an accepted conversation."""
    if task_id in VIDEO_CANCELLED_TASKS:
        return False
    existing = VIDEO_POLL_TASKS.get(task_id)
    current_task = asyncio.current_task()
    if existing and existing is not current_task and not existing.done():
        return True
    if existing is current_task:
        # The current poll window is handing off to the next one. Replace its
        # entry before creating the delayed task so the scheduler does not
        # mistake the current coroutine for an already queued follow-up.
        VIDEO_POLL_TASKS.pop(task_id, None)

    async def run_follow_up():
        try:
            delay = config.VIDEO_POLL_RETRY_DELAY_SEC
            if delay_sec is not None:
                delay = max(delay, int(delay_sec))
            await asyncio.sleep(delay)
            row = store.get(task_id)
            if not row or row.get("status") not in {"submitting", "processing"}:
                return
            if not row.get("account") or not row.get("conversation_id"):
                return
            await _resume_task(row)
        except asyncio.CancelledError:
            row = store.get(task_id)
            if row and row.get("account"):
                render_pool.release_poll_reservation(row["account"])
            raise
        except Exception as exc:
            row = store.get(task_id)
            if row and row.get("status") in {"submitting", "processing"}:
                store.update(task_id, status="failed", error=str(exc)[:500],
                             failure_code="POLL_FAILED", finished_at=time.time())
                render_pool.release_poll_reservation(row.get("account"))
        finally:
            if VIDEO_POLL_TASKS.get(task_id) is asyncio.current_task():
                VIDEO_POLL_TASKS.pop(task_id, None)

    VIDEO_POLL_TASKS[task_id] = asyncio.create_task(run_follow_up())
    return True


def _record_video_poll_success(task_id: str, now: float):
    """Persist poll activity and clear a streak of unexpected poll failures."""
    row = store.get(task_id)
    if not row:
        return
    timings = _decode_task_timings(row.get("timings_json")) or {}
    if timings.get("consecutive_unexpected_poll_errors"):
        timings["consecutive_unexpected_poll_errors"] = 0
        store.update(
            task_id,
            last_poll_at=now,
            timings_json=_encode_task_timings(timings),
        )
    else:
        store.update(task_id, last_poll_at=now)


def _continue_video_polling(
    task_id: str, detail: str = "", *, unexpected_error: bool = False,
    recoverable_error: bool = False, retry_delay_sec: int | None = None,
) -> bool:
    """Keep polling an accepted conversation, with a cap for unknown failures."""
    if task_id in VIDEO_CANCELLED_TASKS:
        return False
    row = store.get(task_id)
    if not row or row.get("status") not in {"submitting", "processing"}:
        return False
    if not row.get("account") or not row.get("conversation_id"):
        return False

    timings = _decode_task_timings(row.get("timings_json")) or {}
    if unexpected_error:
        try:
            error_streak = max(
                0, int(timings.get("consecutive_unexpected_poll_errors") or 0)
            ) + 1
        except (TypeError, ValueError):
            error_streak = 1
        timings["consecutive_unexpected_poll_errors"] = error_streak
        if error_streak >= max(
            1, int(getattr(config, "VIDEO_POLL_UNEXPECTED_ERROR_RETRIES", 3))
        ):
            store.update(task_id, timings_json=_encode_task_timings(timings))
            return False
    elif recoverable_error and timings.get("consecutive_unexpected_poll_errors"):
        # A transient dependency failure (for example ProxyFB's health-check
        # backoff) breaks a streak of unexpected worker exceptions. It should
        # not consume the small terminal-error budget for this conversation.
        timings["consecutive_unexpected_poll_errors"] = 0

    now = time.time()
    deadline = float(row.get("deadline_at") or 0)
    if not deadline:
        deadline = now + config.VIDEO_MAX_WAIT_SEC
        timings["conversation_poll_max_wait_sec"] = config.VIDEO_MAX_WAIT_SEC
        store.update(
            task_id,
            deadline_at=deadline,
            timings_json=_encode_task_timings(timings),
        )
    if deadline <= now:
        return False

    render_pool.reserve_for_poll(row["account"])
    try:
        max_wait = max(
            1,
            int(timings.get("conversation_poll_max_wait_sec") or config.VIDEO_MAX_WAIT_SEC),
        )
    except (TypeError, ValueError):
        max_wait = config.VIDEO_MAX_WAIT_SEC
    remaining_sec = max(0, int(deadline - now))
    message = (
        "Dola vẫn đang tạo video; cửa sổ poll vừa kết thúc, chưa hết hạn chờ tổng "
        f"(còn khoảng {remaining_sec}s/{max_wait}s). Gateway sẽ tiếp tục poll tự động."
    )
    if detail:
        message += f" {detail[:300]}"
    store.update(task_id, status="processing", error=message,
                 failure_code=None, last_poll_at=now,
                 **({"timings_json": _encode_task_timings(timings)}
                    if unexpected_error or recoverable_error else {}))
    if retry_delay_sec is not None:
        retry_delay_sec = min(
            max(config.VIDEO_POLL_RETRY_DELAY_SEC, int(retry_delay_sec)),
            max(config.VIDEO_POLL_RETRY_DELAY_SEC, int(deadline - now)),
        )
    scheduled = _schedule_video_poll(task_id, retry_delay_sec)
    if not scheduled:
        render_pool.release_poll_reservation(row["account"])
    return scheduled


def _render_timeout_error(task_id: str, poll_detail: str) -> str:
    """Explain the total provider deadline separately from the last poll window."""
    row = store.get(task_id) or {}
    timings = _decode_task_timings(row.get("timings_json")) or {}
    try:
        max_wait = max(
            1,
            int(timings.get("conversation_poll_max_wait_sec") or config.VIDEO_MAX_WAIT_SEC),
        )
    except (TypeError, ValueError):
        max_wait = config.VIDEO_MAX_WAIT_SEC

    deadline = float(row.get("deadline_at") or 0)
    if deadline:
        wait_started_at = deadline - max_wait
    else:
        wait_started_at = float(row.get("started_at") or row.get("created_at") or time.time())
    elapsed = max(0, int(time.time() - wait_started_at))
    detail = str(poll_detail or "").strip()
    suffix = f" Cửa sổ poll cuối: {detail[:200]}" if detail else ""
    return (
        f"Dola vẫn đang tạo video sau tổng {elapsed}s; "
        f"giới hạn tổng {max_wait}s.{suffix}"
    )


def _record_timeout_failure(task_id: str, error) -> bool:
    """Classify exhausted wait errors only as render timeouts after Dola ACKs.

    Browser setup can raise ``TimeoutError`` before Dola has accepted a prompt
    (for example, when a profile has no visible prompt editor). That is a
    submission failure; the render deadline starts only after a conversation
    id has been persisted.
    """
    row = store.get(task_id) or {}
    if row.get("status") not in {"submitting", "processing"}:
        return False

    conversation_id = str(row.get("conversation_id") or "").strip()
    if conversation_id:
        failure_code = "RENDER_TIMEOUT"
        message = _render_timeout_error(task_id, str(error))
    else:
        failure_code = "SUBMIT_FAILED"
        detail = str(error or "").strip()
        message = (
            "Gateway chưa nhận được conversation_id từ Dola; chưa thể xác nhận "
            "video đã bắt đầu render."
        )
        if detail:
            message += f" Chi tiết: {detail[:300]}"

    store.update(
        task_id,
        status="failed",
        error=message[:500],
        failure_code=failure_code,
        finished_at=time.time(),
    )
    return True


def _proxy_poll_retry_delay(error: str) -> int:
    """Respect ProxyFB's cached backoff instead of retrying the dead check."""
    match = re.search(
        r"backoff\s+thêm\s+khoảng\s+(\d+)s", str(error or ""), re.IGNORECASE
    )
    if not match:
        return config.VIDEO_POLL_RETRY_DELAY_SEC
    return max(config.VIDEO_POLL_RETRY_DELAY_SEC, int(match.group(1)))


def _is_recoverable_poll_dependency_error(error: Exception) -> bool:
    """Recognize temporary proxy and network failures while reopening a chat."""
    if isinstance(error, ProxyFBError):
        return True
    message = str(error or "").lower()
    return any(
        marker in message
        for marker in (
            "net::err_timed_out",
            "net::err_connection_reset",
            "net::err_connection_closed",
            "net::err_proxy_connection_failed",
            "net::err_tunnel_connection_failed",
            "net::err_network_changed",
            "proxy checker hết thời gian phản hồi",
            "proxyfb đang backoff",
            "failed to fetch",
            "poll failed to return a readable response",
            "poll returned no readable data",
        )
    )


def _schedule_post_submit_credit_retry(row: dict, detail: str = "") -> bool:
    """Start one fresh logical attempt after an accepted conversation runs out of credit.

    The old provider conversation is deliberately discarded. The account pool
    has already marked its profile as quota-blocked, so the new run can select
    another eligible profile without creating a second task row.
    """
    task_id = str(row.get("id") or "").strip()
    if not task_id or task_id in VIDEO_CANCELLED_TASKS:
        return False
    current = store.get(task_id)
    if not current or current.get("status") not in {"submitting", "processing"}:
        return False
    # Prevent two recovery workers from scheduling duplicate fresh chats for
    # the same accepted conversation.
    if (
        current.get("account") != row.get("account")
        or current.get("conversation_id") != row.get("conversation_id")
    ):
        return False

    store.update(
        task_id,
        status="submitting",
        account=None,
        conversation_id=None,
        deadline_at=None,
        last_poll_at=0,
        error="Dola báo profile hiện tại hết credit; đang chuyển sang profile khác.",
        failure_code=None,
        finished_at=None,
    )
    ratio = current.get("ratio")
    if ratio == "default":
        ratio = None
    _track_video_task(
        task_id,
        _run_task(
            task_id,
            current.get("model") or "seedance-2.5",
            current.get("prompt") or "",
            ratio,
            current.get("duration"),
            _task_reference_images(current.get("reference_images")),
            _task_client(current),
            reference_image_names=_task_reference_image_names(
                current.get("reference_image_names")
            ),
        ),
    )
    print(
        f"[pool] task={task_id} post-submit credit error; scheduled a fresh "
        f"profile attempt: {str(detail)[:180]}",
        flush=True,
    )
    return True


def _schedule_post_submit_account_limit_retry(row: dict, detail: str = "") -> bool:
    """Retry an accepted task on another profile after an explicit Dola limit.

    Dola's account-limit response confirms that the accepted conversation
    cannot produce a video. The profile is already marked rate-limited by the
    pool; discard that conversation and continue the same logical task on an
    untried profile. Persist the tried set so a Gateway restart cannot send
    this task back to a profile that already returned the limit.
    """
    task_id = str(row.get("id") or "").strip()
    if not task_id or task_id in VIDEO_CANCELLED_TASKS:
        return False
    current = store.get(task_id)
    if not current or current.get("status") not in {"submitting", "processing"}:
        return False
    if (
        current.get("account") != row.get("account")
        or current.get("conversation_id") != row.get("conversation_id")
    ):
        return False

    limited_account = str(current.get("account") or "").strip()
    if not limited_account:
        return False

    timings = _decode_task_timings(current.get("timings_json")) or {}
    daily_tried = timings.get("daily_limit_tried_accounts")
    daily_tried = [
        str(name).strip()
        for name in daily_tried
        if str(name).strip()
    ] if isinstance(daily_tried, (list, tuple, set)) else []
    if limited_account not in daily_tried:
        daily_tried.append(limited_account)

    provider_tried = timings.get("provider_busy_tried_accounts")
    provider_tried = [
        str(name).strip()
        for name in provider_tried
        if str(name).strip()
    ] if isinstance(provider_tried, (list, tuple, set)) else []
    rate_limit_tried = timings.get("rate_limit_tried_accounts")
    rate_limit_tried = [
        str(name).strip()
        for name in rate_limit_tried
        if str(name).strip()
    ] if isinstance(rate_limit_tried, (list, tuple, set)) else []
    excluded_accounts = list(dict.fromkeys(
        provider_tried + daily_tried + rate_limit_tried
    ))
    available_names = {
        str(account.get("name") or "").strip()
        for account in render_pool.list_accounts()
    }
    if not any(name and name not in excluded_accounts for name in available_names):
        timings["daily_limit_tried_accounts"] = daily_tried
        store.update(task_id, timings_json=_encode_task_timings(timings))
        return False

    try:
        retry_count = max(0, int(timings.get("auto_daily_limit_retry_count") or 0))
    except (TypeError, ValueError):
        retry_count = 0
    timings["daily_limit_tried_accounts"] = daily_tried
    timings["auto_daily_limit_retry_count"] = retry_count + 1
    timings["last_auto_retry_reason"] = "provider_daily_limit_profile_rotation"
    timings["last_auto_retry_at"] = time.time()

    store.update(
        task_id,
        status="submitting",
        account=None,
        conversation_id=None,
        deadline_at=None,
        last_poll_at=0,
        error="Dola báo profile hiện tại hết lượt; đang chuyển sang profile khác.",
        failure_code=None,
        finished_at=None,
        timings_json=_encode_task_timings(timings),
    )
    ratio = current.get("ratio")
    if ratio == "default":
        ratio = None
    _track_video_task(
        task_id,
        _run_task(
            task_id,
            current.get("model") or "seedance-2.5",
            current.get("prompt") or "",
            ratio,
            current.get("duration"),
            _task_reference_images(current.get("reference_images")),
            _task_client(current),
            reference_image_names=_task_reference_image_names(
                current.get("reference_image_names")
            ),
            excluded_accounts=excluded_accounts,
        ),
    )
    print(
        f"[pool] task={task_id} account daily limit; scheduled another profile "
        f"attempt ({len(daily_tried)} profile(s) limited): {str(detail)[:180]}",
        flush=True,
    )
    return True


def _schedule_fast_mode_fallback(row: dict, detail: str = "") -> bool:
    """Retry a 7-day Pro limit once in Fast on the same profile and task."""
    task_id = str(row.get("id") or "").strip()
    if not task_id or task_id in VIDEO_CANCELLED_TASKS:
        return False
    current = store.get(task_id)
    if not current or current.get("status") not in {"submitting", "processing"}:
        return False
    if (
        current.get("account") != row.get("account")
        or current.get("conversation_id") != row.get("conversation_id")
    ):
        return False

    account = str(current.get("account") or "").strip()
    if not account:
        return False

    timings = _decode_task_timings(current.get("timings_json")) or {}
    try:
        fallback_count = max(
            0, int(timings.get("auto_fast_mode_fallback_count") or 0)
        )
    except (TypeError, ValueError):
        fallback_count = 0
    current_model = str(current.get("model") or "seedance-2.5")
    fast_mode_already_used = (
        str(timings.get("chat_mode_override") or "").strip().casefold() == "fast"
    )
    if fallback_count >= 1 or fast_mode_already_used:
        timings["fast_mode_fallback_stop_reason"] = (
            "already_fast" if fast_mode_already_used else "retry_limit"
        )
        store.update(task_id, timings_json=_encode_task_timings(timings))
        return False

    fallback_count += 1
    timings["auto_fast_mode_fallback_count"] = fallback_count
    timings["requested_model_before_fast_mode_fallback"] = current_model
    timings["fast_mode_fallback_account"] = account
    timings["chat_mode_override"] = "Fast"
    timings["last_auto_retry_reason"] = "pro_seven_day_limit_fast_mode"
    timings["last_auto_retry_at"] = time.time()
    try:
        total_retry_count = max(0, int(current.get("retry_count") or 0)) + 1
    except (TypeError, ValueError):
        total_retry_count = 1

    ratio = current.get("ratio")
    if ratio == "default":
        ratio = None
    prompt = current.get("prompt") or ""
    references = _task_reference_images(current.get("reference_images"))
    reference_names = _task_reference_image_names(
        current.get("reference_image_names")
    )
    client = _task_client(current)
    store.update(
        task_id,
        status="submitting",
        account=None,
        conversation_id=None,
        deadline_at=None,
        last_poll_at=0,
        video_url=None,
        video_metadata=None,
        error="Dola đạt giới hạn 7 ngày ở Pro; đang chuyển sang Fast và gửi lại cùng prompt.",
        failure_code=None,
        started_at=None,
        finished_at=None,
        retry_count=total_retry_count,
        last_retry_at=time.time(),
        timings_json=_encode_task_timings(timings),
    )
    _track_video_task(
        task_id,
        _run_task(
            task_id,
            current_model,
            prompt,
            ratio,
            current.get("duration"),
            references,
            client,
            preferred_account=account,
            reference_image_names=reference_names,
        ),
    )
    print(
        f"[pool] task={task_id} Pro 7-day free limit; retrying once in Fast "
        f"on the same profile {account}: {str(detail)[:180]}",
        flush=True,
    )
    return True


def _mark_fast_mode_fallback_failed(row: dict, detail: str = "") -> None:
    """Fail only the source attempt if its one Fast fallback cannot be queued."""
    task_id = str(row.get("id") or "").strip()
    current = store.get(task_id) if task_id else None
    if (
        not current
        or current.get("status") not in {"submitting", "processing"}
        or current.get("account") != row.get("account")
        or current.get("conversation_id") != row.get("conversation_id")
    ):
        return
    message = (
        "Dola yêu cầu chuyển sang Fast sau khi hết giới hạn Pro 7 ngày, "
        "nhưng không thể thử lại trên profile hiện tại. "
        f"{str(detail)[:260]}"
    )
    store.update(
        task_id,
        status="failed",
        error=message[:500],
        failure_code="FAST_MODE_FALLBACK_FAILED",
        finished_at=time.time(),
    )


class FastToProLimitError(RuntimeError):
    """The one Pro retry after Fast credit exhaustion did not complete."""


def _is_fast_to_pro_retry(timings: dict | None) -> bool:
    timings = timings if isinstance(timings, dict) else {}
    try:
        fallback_count = int(timings.get("auto_fast_to_pro_fallback_count") or 0)
    except (TypeError, ValueError):
        fallback_count = 0
    return (
        fallback_count > 0
        and str(timings.get("chat_mode_override") or "").strip().casefold() == "pro"
    )


def _fast_to_pro_limit_message(detail: str = "") -> str:
    message = (
        "Fast đã hết credit; hệ thống đã thử lại Seedance 2.5 ở chế độ Pro "
        "nhưng vẫn thất bại. Limit: kiểm tra credit/lượt tạo video của tài khoản Dola."
    )
    detail = str(detail or "").strip()
    if detail:
        message += f" Chi tiết: {detail[:220]}"
    return message[:500]


def _mark_fast_to_pro_limit(row: dict, detail: str = "") -> None:
    task_id = str(row.get("id") or "").strip()
    current = store.get(task_id) if task_id else None
    if (
        not current
        or current.get("status") not in {"submitting", "processing"}
        or current.get("account") != row.get("account")
        or current.get("conversation_id") != row.get("conversation_id")
    ):
        return
    store.update(
        task_id,
        status="failed",
        error=_fast_to_pro_limit_message(detail),
        failure_code="LIMIT",
        finished_at=time.time(),
    )


def _schedule_fast_to_pro_fallback(row: dict, detail: str = "") -> bool:
    """Retry a Fast credit rejection once in Pro on the same profile/task."""
    task_id = str(row.get("id") or "").strip()
    if not task_id or task_id in VIDEO_CANCELLED_TASKS:
        return False
    current = store.get(task_id)
    if not current or current.get("status") not in {"submitting", "processing"}:
        return False
    if (
        current.get("account") != row.get("account")
        or current.get("conversation_id") != row.get("conversation_id")
    ):
        return False

    account = str(current.get("account") or "").strip()
    timings = _decode_task_timings(current.get("timings_json")) or {}
    if str(timings.get("chat_mode_override") or "").strip().casefold() != "fast":
        return False
    try:
        fallback_count = max(
            0, int(timings.get("auto_fast_to_pro_fallback_count") or 0)
        )
    except (TypeError, ValueError):
        fallback_count = 0
    if fallback_count >= 1 or (not account and current.get("conversation_id")):
        return False

    timings["auto_fast_to_pro_fallback_count"] = 1
    timings["fast_to_pro_fallback_account"] = account or None
    timings["chat_mode_override"] = "Pro"
    timings["last_auto_retry_reason"] = "fast_credit_exhausted_pro_mode"
    timings["last_auto_retry_at"] = time.time()
    try:
        total_retry_count = max(0, int(current.get("retry_count") or 0)) + 1
    except (TypeError, ValueError):
        total_retry_count = 1

    ratio = current.get("ratio")
    if ratio == "default":
        ratio = None
    references = _task_reference_images(current.get("reference_images"))
    reference_names = _task_reference_image_names(
        current.get("reference_image_names")
    )
    retry_message = (
        "Dola báo Fast hết credit; đang thử lại cùng yêu cầu bằng Seedance 2.5 Pro."
    )
    store.update(
        task_id,
        status="submitting",
        account=None,
        conversation_id=None,
        deadline_at=None,
        last_poll_at=0,
        video_url=None,
        video_metadata=None,
        error=retry_message,
        failure_code=None,
        started_at=None,
        finished_at=None,
        retry_count=total_retry_count,
        last_retry_at=time.time(),
        timings_json=_encode_task_timings(timings),
    )
    _track_video_task(
        task_id,
        _run_task(
            task_id,
            current.get("model") or "seedance-2.5",
            current.get("prompt") or "",
            ratio,
            current.get("duration"),
            references,
            _task_client(current),
            preferred_account=account or None,
            reference_image_names=reference_names,
        ),
    )
    print(
        f"[pool] task={task_id} Fast credit exhausted; retrying once in Pro "
        f"on {account or 'an available profile'}: {str(detail)[:180]}",
        flush=True,
    )
    return True


def _schedule_cannot_answer_retry(
    row: dict, detail: str = "", *, safety_rewrite: bool = False
) -> bool:
    """Start one bounded fresh attempt after Dola says it cannot answer.

    The provider response contains no video, so the accepted conversation is
    safe to discard. Keep the same durable task id, clear its provider
    conversation, and let the pool select a fresh profile/chat. A dedicated
    counter in timings_json is used instead of retry_count because the latter
    also includes explicit user retries; an old task must still receive its
    one automatic recovery opportunity.
    """
    task_id = str(row.get("id") or "").strip()
    if not task_id or task_id in VIDEO_CANCELLED_TASKS:
        return False
    current = store.get(task_id)
    if not current or current.get("status") not in {"submitting", "processing"}:
        return False
    # The task may have been completed/requeued by another worker between the
    # provider exception and this cleanup. Never clear a newer conversation.
    if (
        current.get("account") != row.get("account")
        or current.get("conversation_id") != row.get("conversation_id")
    ):
        return False

    timings = _decode_task_timings(current.get("timings_json")) or {}
    counter_key = (
        "auto_content_policy_retry_count"
        if safety_rewrite else "auto_cannot_answer_retry_count"
    )
    try:
        retry_count = max(0, int(timings.get(counter_key) or 0))
    except (TypeError, ValueError):
        retry_count = 0
    retry_limit = max(0, int(getattr(config, "AUTO_CANNOT_ANSWER_RETRIES", 1)))
    if retry_count >= retry_limit:
        timings["cannot_answer_retry_stop_reason"] = "retry_limit_reached"
        store.update(task_id, timings_json=_encode_task_timings(timings))
        return False

    # A generic no-video response is not evidence that the prompt violates
    # policy. Discard that conversation and make the bounded recovery on a
    # different profile, preserving the tried set across a Gateway restart.
    excluded_accounts = []
    if not safety_rewrite:
        tried_accounts = []
        for key in (
            "cannot_answer_tried_accounts",
            "provider_busy_tried_accounts",
            "daily_limit_tried_accounts",
            "rate_limit_tried_accounts",
            "manual_retry_excluded_accounts",
        ):
            values = timings.get(key)
            if isinstance(values, (list, tuple, set)):
                tried_accounts.extend(
                    str(name).strip() for name in values if str(name).strip()
                )
        failed_account = str(current.get("account") or "").strip()
        if failed_account and failed_account not in tried_accounts:
            tried_accounts.append(failed_account)
        tried_accounts = list(dict.fromkeys(tried_accounts))
        excluded_accounts = tried_accounts
        other_profile_exists = any(
            str(profile.get("name") or "").strip()
            and str(profile.get("name") or "").strip() not in excluded_accounts
            for profile in render_pool.list_accounts()
        )
        if not other_profile_exists:
            timings["cannot_answer_tried_accounts"] = tried_accounts
            timings["cannot_answer_retry_stop_reason"] = "no_untried_profiles"
            store.update(task_id, timings_json=_encode_task_timings(timings))
            return False
        # Do not pre-check every alternate profile's current health here.
        # The shared pool selects an eligible profile and waits if its profile
        # locks are temporarily busy; a transient busy state must not turn the
        # automatic retry into a failed task.
        timings["cannot_answer_tried_accounts"] = tried_accounts
        timings["cannot_answer_retry_stop_reason"] = None

    retry_count += 1
    timings[counter_key] = retry_count
    timings["last_auto_retry_reason"] = (
        "content_policy_safe_rewrite"
        if safety_rewrite else "provider_cannot_answer"
    )
    timings["last_auto_retry_at"] = time.time()
    # Older tasks may have been admitted before the safety rewrite knew about
    # restraint/asphyxia/survival wording. Rewrite before the fresh chat so a
    # provider content refusal never causes the same unsafe prompt to be sent
    # again. New tasks are already normalized at API admission; this also
    # repairs legacy rows and explicit retries in one place.
    safe_prompt = _truncate_prompt(current.get("prompt") or "")
    if safety_rewrite:
        safe_prompt = _truncate_prompt(
            rewrite_sensitive_prompt(
                safe_prompt, provider_refused=True
            ).text
        )
    if not safe_prompt:
        return False
    # A policy response without any supported risky wording cannot be safely
    # improved by this deterministic rewrite. Do not resend the same prompt
    # merely to evade the provider's decision.
    if safety_rewrite and safe_prompt == str(current.get("prompt") or ""):
        return False
    if safe_prompt != str(current.get("prompt") or ""):
        timings["prompt_safety_rewritten_on_retry"] = True
    total_retry_count = max(0, int(current.get("retry_count") or 0)) + 1
    ratio = current.get("ratio")
    if ratio == "default":
        ratio = None
    retry_message = (
        "Dola từ chối nội dung; đã viết lại prompt theo hướng an toàn và "
        f"đang tạo lại bằng chat/profile mới ({retry_count}/{retry_limit})."
        if safety_rewrite else
        "Dola chưa tạo được video; đang tạo lại yêu cầu "
        f"bằng chat/profile mới ({retry_count}/{retry_limit})."
    )
    store.update(
        task_id,
        status="submitting",
        account=None,
        conversation_id=None,
        deadline_at=None,
        last_poll_at=0,
        video_url=None,
        video_metadata=None,
        prompt=safe_prompt,
        error=retry_message,
        failure_code=None,
        started_at=None,
        finished_at=None,
        retry_count=total_retry_count,
        last_retry_at=time.time(),
        timings_json=_encode_task_timings(timings),
    )
    _track_video_task(
        task_id,
        _run_task(
            task_id,
            current.get("model") or "seedance-2.5",
            safe_prompt,
            ratio,
            current.get("duration"),
            _task_reference_images(current.get("reference_images")),
            _task_client(current),
            reference_image_names=_task_reference_image_names(
                current.get("reference_image_names")
            ),
            excluded_accounts=excluded_accounts,
        ),
    )
    print(
        f"[pool] task={task_id} provider "
        f"{'content-policy' if safety_rewrite else 'cannot-answer'} response; scheduled fresh "
        f"chat attempt {retry_count}/{retry_limit}: {str(detail)[:180]}",
        flush=True,
    )
    return True


def _cannot_answer_retry_failure_message(row: dict) -> str:
    timings = _decode_task_timings(row.get("timings_json")) or {}
    if timings.get("cannot_answer_retry_stop_reason") == "no_untried_profiles":
        return (
            "Dola không tạo được video trên profile hiện tại; trong Gateway "
            "không có profile khác để tự động thử."
        )
    if timings.get("cannot_answer_retry_stop_reason") == "retry_limit_reached":
        return "Dola không tạo được video sau số lần retry tự động đã giới hạn."
    return "Dola chưa tạo được video sau lần thử tự động; đã hết số lần tạo lại an toàn."


def _fail_final_content_policy_refusal(row: dict, detail: str = "") -> bool:
    """Stop an accepted conversation when Dola explicitly forbids retrying it."""
    task_id = str((row or {}).get("id") or "").strip()
    current = store.get(task_id) if task_id else None
    if (
        not current
        or current.get("status") not in {"submitting", "processing"}
        or current.get("account") != row.get("account")
        or current.get("conversation_id") != row.get("conversation_id")
    ):
        return False
    store.update(
        task_id,
        status="failed",
        error=(
            f"{CONTENT_POLICY_NO_RETRY_MESSAGE} {str(detail)[:240]}"
        )[:500],
        failure_code="CONTENT_POLICY_REJECTED",
        finished_at=time.time(),
    )
    return True


def _schedule_provider_busy_retry(
    row: dict, detail: str = "", *, rate_limited: bool = False
) -> bool:
    """Retry a provider-limited task on a profile not tried for this task.

    Dola has acknowledged the first conversation but returned an explicit
    overload/no-video response. The conversation is safe to discard. Keep the
    durable task id, track every profile that received this task, and cap the
    number of alternate profiles independently from cannot-answer recovery.
    """
    task_id = str(row.get("id") or "").strip()
    if not task_id or task_id in VIDEO_CANCELLED_TASKS:
        return False
    current = store.get(task_id)
    if not current or current.get("status") not in {"submitting", "processing"}:
        return False
    if (
        current.get("account") != row.get("account")
        or current.get("conversation_id") != row.get("conversation_id")
    ):
        return False

    # Pause the source profile even if this task has exhausted its retry budget
    # or no alternate profile is currently available. Rate limits are shown in
    # the dedicated profile status; high-demand responses use provider-busy.
    account = str(current.get("account") or "").strip()
    if account:
        if rate_limited:
            render_pool._mark_rate_limited(account, detail)
        else:
            render_pool._mark_provider_busy(account, detail)

    timings = _decode_task_timings(current.get("timings_json")) or {}
    tried_key = (
        "rate_limit_tried_accounts" if rate_limited
        else "provider_busy_tried_accounts"
    )
    retry_count_key = (
        "auto_rate_limit_retry_count" if rate_limited
        else "auto_provider_busy_retry_count"
    )
    stop_reason_key = (
        "rate_limit_retry_stop_reason" if rate_limited
        else "provider_busy_retry_stop_reason"
    )
    raw_tried = timings.get(tried_key)
    profile_tried = [
        str(name).strip()
        for name in raw_tried
        if str(name).strip()
    ] if isinstance(raw_tried, (list, tuple, set)) else []
    if account and account not in profile_tried:
        profile_tried.append(account)
    all_tried_accounts = list(profile_tried)
    for key in (
        "provider_busy_tried_accounts",
        "daily_limit_tried_accounts",
        "rate_limit_tried_accounts",
        "cannot_answer_tried_accounts",
        "manual_retry_excluded_accounts",
    ):
        values = timings.get(key)
        if isinstance(values, (list, tuple, set)):
            all_tried_accounts.extend(
                str(name).strip() for name in values if str(name).strip()
            )
    tried_accounts = list(dict.fromkeys(all_tried_accounts))

    try:
        retry_count = max(0, int(timings.get(retry_count_key) or 0))
    except (TypeError, ValueError):
        retry_count = 0
    retry_limit = max(
        0,
        int(getattr(
            config,
            "AUTO_RATE_LIMIT_RETRIES" if rate_limited else "AUTO_PROVIDER_BUSY_RETRIES",
            5,
        )),
    )
    untried_profiles = [
        item for item in render_pool.list_accounts()
        if str(item.get("name") or "").strip() not in tried_accounts
        and render_pool._schedulable(item)
    ]
    timings[tried_key] = profile_tried
    timings["last_auto_retry_reason"] = (
        "provider_rate_limit_profile_rotation"
        if rate_limited else "provider_busy_profile_rotation"
    )
    timings[stop_reason_key] = None
    if retry_count >= retry_limit:
        timings[stop_reason_key] = "retry_limit"
        store.update(task_id, timings_json=_encode_task_timings(timings))
        return False
    if not untried_profiles:
        timings[stop_reason_key] = "no_untried_profiles"
        store.update(task_id, timings_json=_encode_task_timings(timings))
        return False

    retry_count += 1
    timings[retry_count_key] = retry_count
    timings["last_auto_retry_at"] = time.time()
    total_retry_count = max(0, int(current.get("retry_count") or 0)) + 1
    ratio = current.get("ratio")
    if ratio == "default":
        ratio = None
    store.update(
        task_id,
        status="submitting",
        account=None,
        conversation_id=None,
        deadline_at=None,
        last_poll_at=0,
        video_url=None,
        video_metadata=None,
        error=(
            (
                "Dola giới hạn tần suất trên profile hiện tại; đang chuyển sang profile chưa thử "
                if rate_limited else
                "Dola đang quá tải; đang chuyển sang profile chưa thử "
            )
            + f"({retry_count}/{retry_limit}, đã tránh {len(tried_accounts)} profile)."
        ),
        failure_code=None,
        started_at=None,
        finished_at=None,
        retry_count=total_retry_count,
        last_retry_at=time.time(),
        timings_json=_encode_task_timings(timings),
    )
    _track_video_task(
        task_id,
        _run_task(
            task_id,
            current.get("model") or "seedance-2.5",
            current.get("prompt") or "",
            ratio,
            current.get("duration"),
            _task_reference_images(current.get("reference_images")),
            _task_client(current),
            reference_image_names=_task_reference_image_names(
                current.get("reference_image_names")
            ),
            excluded_accounts=tried_accounts,
        ),
    )
    print(
        f"[pool] task={task_id} {'provider rate limit' if rate_limited else 'provider overload'}; "
        "rotating to an untried profile "
        f"({retry_count}/{retry_limit}, tried={len(tried_accounts)}): {str(detail)[:180]}",
        flush=True,
    )
    return True


def _provider_busy_failure_message(
    detail: str, timings_json, *, rate_limited: bool = False
) -> str:
    timings = _decode_task_timings(timings_json) or {}
    tried_profiles = timings.get(
        "rate_limit_tried_accounts" if rate_limited
        else "provider_busy_tried_accounts"
    )
    tried_count = (
        len(tried_profiles)
        if isinstance(tried_profiles, (list, tuple, set))
        else 0
    )
    stop_reason_key = (
        "rate_limit_retry_stop_reason" if rate_limited
        else "provider_busy_retry_stop_reason"
    )
    if timings.get(stop_reason_key) == "no_untried_profiles":
        stop_detail = "không còn profile khả dụng chưa thử"
    else:
        stop_detail = "đã đạt giới hạn retry an toàn"
    return (
        f"{str(detail or '')[:340]} Đã thử {tried_count} profile; {stop_detail}."
    )[:500]


async def _schedule_sketch_reference_retry(row: dict, detail: str = "") -> bool:
    """Retry once with generated graphite references after an image refusal.

    This is deliberately a separate, bounded path from profile rotation. It
    only applies when the task still uses original references; a task that was
    already submitted in sketch mode is never transformed or resubmitted by
    this helper. If MaiVideo cannot prepare every reference, the task is
    failed immediately with the sketch-preparation error instead of falling
    through to another video retry or sending a partial manifest.
    """
    task_id = str(row.get("id") or "").strip()
    if not task_id or task_id in VIDEO_CANCELLED_TASKS:
        return False
    current = store.get(task_id)
    if not current or current.get("status") not in {"submitting", "processing"}:
        return False
    if (
        current.get("account") != row.get("account")
        or current.get("conversation_id") != row.get("conversation_id")
    ):
        return False

    current_mode = _normalize_reference_image_mode(
        current.get("reference_image_mode"), current.get("prompt")
    )
    source_references = _task_reference_images(current.get("reference_images"))
    if current_mode == "sketch" or not source_references:
        return False

    timings = _decode_task_timings(current.get("timings_json")) or {}
    try:
        sketch_retry_count = max(0, int(timings.get("auto_sketch_retry_count") or 0))
    except (TypeError, ValueError):
        sketch_retry_count = 0
    retry_limit = max(0, int(getattr(config, "AUTO_SKETCH_RETRY_LIMIT", 1)))
    if not getattr(config, "AUTO_SKETCH_RETRY_ENABLED", True) or sketch_retry_count >= retry_limit:
        return False

    sketch_attempt_count = sketch_retry_count + 1

    def fail_sketch_retry(reason: str) -> bool:
        """Stop at the fallback stage and persist its actionable failure."""
        reason_text = str(reason or "MaiVideo không tạo được ảnh chì.").strip()[:300]
        timings["auto_sketch_retry_count"] = sketch_attempt_count
        timings["auto_sketch_retry_attempted"] = True
        timings["auto_sketch_retry_error"] = reason_text[:240]
        timings["last_auto_retry_reason"] = "sketch_reference_generation_failed"
        timings["last_auto_retry_at"] = time.time()
        error = (
            "Không thể tạo ảnh chì tham chiếu để thử lại video: "
            f"{reason_text}"
        )[:500]
        store.update(
            task_id,
            status="failed",
            error=error,
            failure_code="SKETCH_REFERENCE_GENERATION_FAILED",
            finished_at=time.time(),
            timings_json=_encode_task_timings(timings),
        )
        print(
            f"[pool] task={task_id} dừng ngay tại bước tạo ảnh chì: "
            f"{reason_text[:180]}",
            flush=True,
        )
        return True

    try:
        sketch_references = await create_pencil_sketches(source_references)
    except SketchFallbackError as exc:
        return fail_sketch_retry(str(exc))
    except Exception as exc:
        return fail_sketch_retry(
            "Lỗi không mong đợi khi chuẩn bị ảnh chì: " + str(exc)
        )

    if len(sketch_references) != len(source_references):
        return fail_sketch_retry(
            f"MaiVideo trả về thiếu ảnh chì ({len(sketch_references)}/{len(source_references)})"
        )

    safe_prompt = _truncate_prompt(current.get("prompt") or "")
    if not safe_prompt:
        return False
    sketch_prompt = ensure_sketch_color_restoration(
        safe_prompt, config.MAX_PROMPT_CHARS
    )
    timings["auto_sketch_retry_count"] = sketch_retry_count + 1
    timings["auto_sketch_source_reference_count"] = len(source_references)
    timings["auto_sketch_reference_count"] = len(sketch_references)
    timings["last_auto_retry_reason"] = "provider_image_or_prompt_refusal_sketch"
    timings["last_auto_retry_at"] = time.time()
    total_retry_count = max(0, int(current.get("retry_count") or 0)) + 1
    ratio = current.get("ratio")
    if ratio == "default":
        ratio = None
    reference_names = _task_reference_image_names(
        current.get("reference_image_names")
    )[:len(sketch_references)]
    reference_names.extend([""] * (len(sketch_references) - len(reference_names)))
    retry_message = (
        "Dola từ chối prompt hoặc ảnh tham chiếu; đã chuyển sang ảnh chì đen trắng "
        "và đang tạo lại một lần bằng chat/profile mới."
    )
    store.update(
        task_id,
        status="submitting",
        account=None,
        conversation_id=None,
        deadline_at=None,
        last_poll_at=0,
        video_url=None,
        video_metadata=None,
        reference_images=json.dumps(sketch_references, ensure_ascii=False),
        reference_image_names=json.dumps(reference_names, ensure_ascii=False),
        reference_image_mode="sketch",
        prompt=sketch_prompt,
        error=retry_message,
        failure_code=None,
        started_at=None,
        finished_at=None,
        retry_count=total_retry_count,
        last_retry_at=time.time(),
        timings_json=_encode_task_timings(timings),
    )
    _track_video_task(
        task_id,
        _run_task(
            task_id,
            current.get("model") or "seedance-2.5",
            sketch_prompt,
            ratio,
            current.get("duration"),
            sketch_references,
            _task_client(current),
            reference_image_names=reference_names,
        ),
    )
    print(
        f"[pool] task={task_id} provider refusal; prepared "
        f"{len(sketch_references)} graphite reference(s) and scheduled the bounded "
        f"sketch retry: {str(detail)[:160]}",
        flush=True,
    )
    return True


async def _run_task(
    task_id,
    model,
    prompt,
    ratio,
    duration,
    reference_images,
    client,
    preferred_account=None,
    reference_image_names=None,
    excluded_accounts=None,
):
    # Freeze the task's reference manifest before any asynchronous work starts.
    # Batch requests share the input list between workers; keeping a private
    # tuple prevents a later retry or UI update from changing this task's
    # expected count while its browser is uploading.
    raw_reference_images = reference_images if isinstance(reference_images, (list, tuple)) else []
    raw_reference_names = (
        reference_image_names
        if isinstance(reference_image_names, (list, tuple))
        else []
    )
    normalized_reference_images = []
    normalized_reference_names = []
    seen_reference_images = set()
    for index, value in enumerate(raw_reference_images):
        if value is None:
            continue
        text = str(value).strip()
        if not text or text in seen_reference_images:
            continue
        seen_reference_images.add(text)
        normalized_reference_images.append(text)
        normalized_reference_names.append(
            str(raw_reference_names[index] or "").strip()
            if index < len(raw_reference_names) else ""
        )
    reference_images = tuple(normalized_reference_images)
    normalized_reference_names.extend(
        [""] * (len(reference_images) - len(normalized_reference_names))
    )
    reference_image_names = tuple(normalized_reference_names)
    api_key_hash = client.get("api_key_hash")
    acquired = False
    keep_polling = False
    reference_root = None
    task_started = time.monotonic()
    existing_row = store.get(task_id)
    reference_manifest = (reference_images, reference_image_names)
    timings = _decode_task_timings(
        existing_row.get("timings_json") if existing_row else None
    ) or {}
    chat_mode_override = str(timings.get("chat_mode_override") or "").strip() or None
    if not chat_mode_override and "2.5" in str(model or "").casefold():
        chat_mode_override = "Fast"
        timings["chat_mode_override"] = chat_mode_override
        timings["chat_mode_default"] = chat_mode_override
    stored_exclusions = []
    for key in (
        "provider_busy_tried_accounts",
        "daily_limit_tried_accounts",
        "rate_limit_tried_accounts",
        "cannot_answer_tried_accounts",
        "manual_retry_excluded_accounts",
    ):
        values = timings.get(key)
        if isinstance(values, (list, tuple, set)):
            stored_exclusions.extend(
                str(name).strip() for name in values if str(name).strip()
            )
    explicit_exclusions = (
        [str(name).strip() for name in excluded_accounts if str(name).strip()]
        if isinstance(excluded_accounts, (list, tuple, set))
        else []
    )
    excluded_accounts = list(dict.fromkeys(explicit_exclusions + stored_exclusions))
    cannot_answer_retry_row = None
    cannot_answer_retry_detail = None
    cannot_answer_retry_failure_code = "PROVIDER_NO_VIDEO"
    cannot_answer_retry_sketch = False
    content_policy_retry_row = None
    content_policy_retry_detail = None
    content_policy_final_row = None
    content_policy_final_detail = None
    provider_rejection_retry_row = None
    provider_rejection_retry_detail = None
    provider_busy_retry_row = None
    provider_busy_retry_detail = None
    fast_mode_fallback_row = None
    fast_mode_fallback_detail = None
    fast_to_pro_fallback_row = None
    fast_to_pro_fallback_detail = None
    post_submit_account_limit_retry_row = None
    post_submit_account_limit_retry_detail = None
    post_submit_rate_limit_retry_row = None
    post_submit_rate_limit_retry_detail = None
    bound_account = {"value": existing_row.get("account") if existing_row else None}
    if existing_row and existing_row.get("created_at"):
        timings["queue_wait_ms"] = round(
            max(0.0, time.time() - float(existing_row["created_at"])) * 1000
        )
    try:
        await key_limiter.acquire(api_key_hash, client.get("concurrency_limit", 0))
        acquired = True
        # Keep a durable pre-conversation state. If the process stops before
        # Dola returns a conversation id, startup can safely pick this task up
        # instead of leaving it permanently stuck in processing.
        store.update(task_id, status="submitting", started_at=time.time())

        def on_conversation_id(account, conversation_id, deadline_at):
            bound_account["value"] = account
            conversation_row = store.get(task_id) or {}
            conversation_timings = _decode_task_timings(
                conversation_row.get("timings_json")
            ) or {}
            conversation_timings["conversation_poll_max_wait_sec"] = (
                config.VIDEO_MAX_WAIT_SEC
            )
            store.update(task_id, status="processing", account=account,
                         conversation_id=conversation_id, deadline_at=deadline_at,
                         last_poll_at=time.time(), error=None,
                         failure_code=None, finished_at=None,
                         timings_json=_encode_task_timings(conversation_timings))

        def on_account_rotation(account, reason):
            """Clear the old accepted conversation before trying another profile."""
            del account, reason
            bound_account["value"] = None
            store.update(
                task_id,
                status="submitting",
                account=None,
                conversation_id=None,
                deadline_at=None,
                last_poll_at=0,
                error="Dola báo profile hiện tại hết credit; đang chuyển sang profile khác.",
                failure_code=None,
                finished_at=None,
            )

        def on_profile_bound(account):
            bound_account["value"] = account
            # Persist the profile as soon as reference/prompt input has been
            # accepted by the composer. If the browser fails before exposing a
            # conversation id, recovery keeps the profile binding. The explicit
            # post-submit credit path above is the only exception and clears
            # the old conversation before switching profiles.
            store.update(task_id, status="submitting", account=account)

        def on_waiting():
            # A task can spend time in the pool before any profile has received
            # its prompt. Keep that state visibly queued instead of reporting
            # "submitting" while it is only waiting for a healthy profile.
            current = store.get(task_id)
            if (
                current
                and current.get("status") == "submitting"
                and not current.get("account")
                and not current.get("conversation_id")
            ):
                store.update(
                    task_id,
                    status="queued",
                    error="Đang chờ profile khả dụng; hệ thống sẽ tự thử lại.",
                    failure_code=None,
                    finished_at=None,
                )

        def on_poll(now):
            _record_video_poll_success(task_id, now)

        def on_timing(name, value):
            timings[str(name)] = value
            store.update(task_id, timings_json=_encode_task_timings(timings))

        timings["reference_requested_count"] = len(reference_images)
        store.update(task_id, timings_json=_encode_task_timings(timings))
        cached_references = TASK_REFERENCE_IMAGE_CACHE.get(task_id)
        cached_paths = (
            list(cached_references.get("paths") or [])
            if cached_references
            and cached_references.get("manifest") == reference_manifest
            else []
        )
        cached_root = cached_references.get("root") if cached_paths else None
        can_reuse_references = bool(
            cached_root
            and Path(cached_root).is_dir()
            and len(cached_paths) == len(reference_images)
            and all(Path(path).is_file() for path in cached_paths)
        )
        if can_reuse_references:
            reference_root = Path(cached_root)
            reference_paths = cached_paths
            timings["reference_download_reused"] = True
            timings["reference_download_ms"] = 0
        else:
            if cached_references:
                _clear_task_reference_cache(task_id)
            reference_started = time.monotonic()
            reference_root, reference_paths = await download_reference_images(
                reference_images or [], task_id, list(reference_image_names)
            )
            timings["reference_download_reused"] = False
            timings["reference_download_ms"] = round(
                (time.monotonic() - reference_started) * 1000
            )
            if reference_root and reference_paths:
                TASK_REFERENCE_IMAGE_CACHE[task_id] = {
                    "manifest": reference_manifest,
                    "root": reference_root,
                    "paths": tuple(reference_paths),
                }
        timings["reference_downloaded_count"] = len(reference_paths)
        store.update(task_id, timings_json=_encode_task_timings(timings))
        if len(reference_paths) != len(reference_images):
            raise RuntimeError(
                "Reference image manifest mismatch before Dola upload "
                f"(requested={len(reference_images)}, downloaded={len(reference_paths)})"
            )
        generation_started = time.monotonic()
        preferred_generation_account = (
            preferred_account
            or (
                existing_row.get("account")
                if existing_row and not existing_row.get("conversation_id")
                else None
            )
        )
        try:
            result = await render_pool.generate_video(
                prompt, ratio, duration, model,
                on_conversation_id=on_conversation_id, on_poll=on_poll,
                reference_image_paths=reference_paths, on_timing=on_timing,
                task_id=task_id, on_profile_bound=on_profile_bound,
                on_account_rotation=on_account_rotation,
                on_waiting=on_waiting,
                preferred_account=preferred_generation_account,
                excluded_accounts=excluded_accounts,
                chat_mode=chat_mode_override,
                stop_on_credit=(
                    str(chat_mode_override or "").casefold() == "fast"
                    or _is_fast_to_pro_retry(timings)
                ),
            )
        except RenderStillProcessingError:
            raise
        except Exception as exc:
            if _is_fast_to_pro_retry(timings):
                raise FastToProLimitError(str(exc)) from exc
            raise
        timings["generation_and_poll_ms"] = round(
            (time.monotonic() - generation_started) * 1000
        )
        public_url = f"{config.PUBLIC_BASE}/videos/{Path(result['local_path']).name}"
        store.update(task_id, status="completed", video_url=public_url,
                     account=result.get("account"), last_poll_at=time.time(),
                     video_metadata=_encode_video_metadata(result),
                     error=None, failure_code=None, finished_at=time.time())
    except FastToProLimitError as e:
        store.update(
            task_id,
            status="failed",
            error=_fast_to_pro_limit_message(str(e)),
            failure_code="LIMIT",
            finished_at=time.time(),
        )
    except RenderStillProcessingError as e:
        keep_polling = _continue_video_polling(task_id, str(e))
        if not keep_polling:
            _record_timeout_failure(task_id, e)
    except (AllAccountsLimitedError, AllAccountsQuotaBlockedError) as e:
        store.update(task_id, status="failed", error=str(e)[:500],
                     failure_code="429", finished_at=time.time())
    except AccountLimitedError as e:
        store.update(task_id, status="failed", error=str(e)[:500],
                     failure_code="DAILY_LIMIT", finished_at=time.time())
    except CreditInsufficientError as e:
        if str(chat_mode_override or "").casefold() == "fast":
            fast_to_pro_fallback_row = store.get(task_id)
            fast_to_pro_fallback_detail = str(e)
        else:
            store.update(task_id, status="failed", error=str(e)[:500],
                         failure_code="CREDIT", finished_at=time.time())
    except VideoDownloadError as e:
        store.update(task_id, status="failed", error=str(e)[:500],
                     failure_code="VIDEO_DOWNLOAD_FAILED", finished_at=time.time())
    except VideoValidationError as e:
        store.update(task_id, status="failed", error=str(e)[:500],
                     failure_code="OUTPUT_INVALID", finished_at=time.time())
    except PostSubmitRateLimitError as e:
        post_submit_rate_limit_retry_row = store.get(task_id)
        post_submit_rate_limit_retry_detail = str(e)
    except RateLimitError as e:
        store.update(task_id, status="failed", error=str(e)[:500],
                     failure_code="RATE_LIMIT", finished_at=time.time())
    except RiskControlError as e:
        store.update(task_id, status="failed", error=str(e)[:500],
                     failure_code="RISK_CONTROL", finished_at=time.time())
    except SessionExpiredError as e:
        keep_polling = _continue_video_polling(
            task_id,
            "Dola session đã hết; Gateway sẽ đăng nhập lại bằng Gmail trong profile "
            "và tiếp tục conversation cũ.",
        )
        if not keep_polling:
            store.update(task_id, status="failed", error=str(e)[:500],
                         failure_code="AUTH_EXPIRED", finished_at=time.time())
    except ContentPolicyFinalRefusalError as e:
        # Dola explicitly forbade another attempt at this content. Stop the
        # task after releasing its poll/profile reservation; do not rotate to
        # another profile or submit a rewritten version automatically.
        content_policy_final_row = store.get(task_id)
        content_policy_final_detail = str(e)
    except ContentPolicyRejectedError as e:
        # Dola returned a policy refusal after accepting the conversation.
        # Defer the safe fresh-chat transition until the current browser
        # reservation and API-key slot are released.
        content_policy_retry_row = store.get(task_id)
        content_policy_retry_detail = str(e)
    except ImageLikenessRejectedError as e:
        # An image-specific refusal can be retried once with the explicit
        # graphite-reference mode when the original task used raw images.
        provider_rejection_retry_row = store.get(task_id)
        provider_rejection_retry_detail = str(e)
    except FastModeFallbackError as e:
        # Dola explicitly offered Fast after exhausting the Pro allowance.
        # Defer the same-profile resubmit until this browser reservation and
        # API-key slot have been released.
        fast_mode_fallback_row = store.get(task_id)
        fast_mode_fallback_detail = str(e)
    except ProviderBusyError as e:
        # Provider overload is task-local and recoverable. Do not let it enter
        # the global risk-control cooldown path used for actual bot/risk walls.
        provider_busy_retry_row = store.get(task_id)
        provider_busy_retry_detail = str(e)
    except (
        CannotAnswerQuestionError,
        NoVideoCreationError,
        ProviderTaskIdEmptyError,
        SomethingWentWrongError,
    ) as e:
        # Dola returned a no-video assistant answer. Defer the fresh-chat
        # transition until finally, after the current browser reservation and
        # API-key slot are released; this prevents two profiles from racing.
        # Technical no-video responses (including an empty task id) receive
        # the same bounded one-time retry in a fresh chat.
        cannot_answer_retry_row = store.get(task_id)
        cannot_answer_retry_detail = str(e)
        cannot_answer_retry_failure_code = getattr(e, "failure_code", "PROVIDER_NO_VIDEO")
        cannot_answer_retry_sketch = isinstance(
            e, (CannotAnswerQuestionError, NoVideoCreationError)
        ) and not isinstance(e, ProfileRotationRetryError)
    except ProviderGenerationRejectedError as e:
        # Keep duration/transient fresh-chat errors terminal. Other provider
        # refusals may be image/prompt related and get the one-time sketch
        # fallback below when this task still has original references.
        if isinstance(e, FreshChatRetryError):
            store.update(task_id, status="failed", error=str(e)[:500],
                         failure_code=getattr(e, "failure_code", "PROVIDER_REJECTED"), finished_at=time.time())
        else:
            provider_rejection_retry_row = store.get(task_id)
            provider_rejection_retry_detail = str(e)
    except PostSubmitCreditError as e:
        if str(chat_mode_override or "").casefold() == "fast":
            fast_to_pro_fallback_row = store.get(task_id)
            fast_to_pro_fallback_detail = str(e)
        else:
            store.update(task_id, status="failed", error=str(e)[:500],
                         failure_code="CREDIT_DURING_RENDER", finished_at=time.time())
    except PostSubmitAccountLimitError as e:
        # The provider explicitly rejected this account's quota after ACK.
        # Defer profile rotation until the current browser/key reservations are
        # released so the same conversation cannot race with a fresh attempt.
        post_submit_account_limit_retry_row = store.get(task_id)
        post_submit_account_limit_retry_detail = str(e)
    except ReferenceImageUploadTimeoutError as e:
        store.update(task_id, status="failed", error=str(e)[:500],
                     failure_code="REFERENCE_UPLOAD_TIMEOUT", finished_at=time.time())
    except ReferenceImageSizeError as e:
        store.update(task_id, status="failed", error=str(e)[:500],
                     failure_code="REFERENCE_IMAGE_TOO_LARGE", finished_at=time.time())
    except TimeoutError as e:
        keep_polling = _continue_video_polling(task_id, "Poll bị timeout; sẽ kiểm tra lại conversation cũ.")
        if not keep_polling:
            _record_timeout_failure(task_id, e)
    except Exception as e:
        # A headed Chromium context can take a few seconds to release its
        # persistent-profile lock after a poll window closes. Retry transient
        # failures, but stop after a short consecutive streak so a terminal
        # worker error cannot leave the task processing until its 30-minute
        # deadline.
        transient_poll_dependency_error = _is_recoverable_poll_dependency_error(e)
        if _continue_video_polling(
            task_id,
            "Chưa đọc được kết quả; Gateway sẽ poll lại conversation cũ. " + str(e)[:160],
            unexpected_error=not transient_poll_dependency_error,
            recoverable_error=transient_poll_dependency_error,
            retry_delay_sec=(
                _proxy_poll_retry_delay(str(e)) if transient_poll_dependency_error else None
            ),
        ):
            keep_polling = True
        else:
            current_row = store.get(task_id)
            store.update(task_id, status="failed", error=str(e)[:500],
                         failure_code="POLL_FAILED" if current_row and current_row.get("conversation_id")
                         else "SUBMIT_FAILED",
                         finished_at=time.time())
    finally:
        latest_row = store.get(task_id)
        latest_timings = (
            _decode_task_timings(latest_row.get("timings_json")) if latest_row else {}
        ) or {}
        persisted_poll_error_streak = latest_timings.get(
            "consecutive_unexpected_poll_errors"
        )
        latest_timings.update(timings)
        if persisted_poll_error_streak is not None:
            latest_timings["consecutive_unexpected_poll_errors"] = persisted_poll_error_streak
        latest_timings["worker_total_ms"] = round(
            (time.monotonic() - task_started) * 1000
        )
        store.update(task_id, timings_json=_encode_task_timings(latest_timings))
        if not keep_polling:
            row = store.get(task_id)
            if row and row.get("account"):
                render_pool.release_poll_reservation(row["account"])
        if acquired:
            await key_limiter.release(api_key_hash)
        if (
            fast_to_pro_fallback_detail
            and fast_to_pro_fallback_row
            and task_id not in VIDEO_CANCELLED_TASKS
        ):
            if not _schedule_fast_to_pro_fallback(
                fast_to_pro_fallback_row, fast_to_pro_fallback_detail
            ):
                _mark_fast_to_pro_limit(
                    fast_to_pro_fallback_row, fast_to_pro_fallback_detail
                )
        if (
            content_policy_final_detail
            and content_policy_final_row
            and task_id not in VIDEO_CANCELLED_TASKS
        ):
            _fail_final_content_policy_refusal(
                content_policy_final_row, content_policy_final_detail
            )
        if (
            fast_mode_fallback_detail
            and fast_mode_fallback_row
            and task_id not in VIDEO_CANCELLED_TASKS
        ):
            if not _schedule_fast_mode_fallback(
                fast_mode_fallback_row, fast_mode_fallback_detail
            ):
                _mark_fast_mode_fallback_failed(
                    fast_mode_fallback_row, fast_mode_fallback_detail
                )
        if (
            post_submit_account_limit_retry_detail
            and post_submit_account_limit_retry_row
            and task_id not in VIDEO_CANCELLED_TASKS
        ):
            if not _schedule_post_submit_account_limit_retry(
                post_submit_account_limit_retry_row,
                post_submit_account_limit_retry_detail,
            ):
                current = store.get(task_id)
                if (
                    current
                    and current.get("status") in {"submitting", "processing"}
                    and current.get("account")
                    == post_submit_account_limit_retry_row.get("account")
                    and current.get("conversation_id")
                    == post_submit_account_limit_retry_row.get("conversation_id")
                ):
                    store.update(
                        task_id,
                        status="failed",
                        error=post_submit_account_limit_retry_detail[:500],
                        failure_code="DAILY_LIMIT_DURING_RENDER",
                        finished_at=time.time(),
                    )
        if (
            post_submit_rate_limit_retry_detail
            and post_submit_rate_limit_retry_row
            and task_id not in VIDEO_CANCELLED_TASKS
        ):
            if not _schedule_provider_busy_retry(
                post_submit_rate_limit_retry_row,
                post_submit_rate_limit_retry_detail,
                rate_limited=True,
            ):
                current = store.get(task_id)
                if (
                    current
                    and current.get("status") in {"submitting", "processing"}
                    and current.get("account")
                    == post_submit_rate_limit_retry_row.get("account")
                    and current.get("conversation_id")
                    == post_submit_rate_limit_retry_row.get("conversation_id")
                ):
                    store.update(
                        task_id,
                        status="failed",
                        error=_provider_busy_failure_message(
                            post_submit_rate_limit_retry_detail,
                            current.get("timings_json"),
                            rate_limited=True,
                        ),
                        failure_code="RATE_LIMIT_DURING_RENDER",
                        finished_at=time.time(),
                    )
        if (
            content_policy_retry_detail
            and content_policy_retry_row
            and task_id not in VIDEO_CANCELLED_TASKS
        ):
            if not _schedule_cannot_answer_retry(
                content_policy_retry_row,
                content_policy_retry_detail,
                safety_rewrite=True,
            ):
                current = store.get(task_id)
                if (
                    current
                    and current.get("status") in {"submitting", "processing"}
                    and current.get("account") == content_policy_retry_row.get("account")
                    and current.get("conversation_id") == content_policy_retry_row.get("conversation_id")
                ):
                    store.update(
                        task_id,
                        status="failed",
                        error=(
                            f"{CONTENT_POLICY_FINAL_MESSAGE} "
                            f"{content_policy_retry_detail[:260]}"
                        )[:500],
                        failure_code="CONTENT_POLICY_REJECTED",
                        finished_at=time.time(),
                    )
        if (
            provider_rejection_retry_detail
            and provider_rejection_retry_row
            and task_id not in VIDEO_CANCELLED_TASKS
        ):
            if not await _schedule_sketch_reference_retry(
                provider_rejection_retry_row, provider_rejection_retry_detail
            ):
                current = store.get(task_id)
                if (
                    current
                    and current.get("status") in {"submitting", "processing"}
                    and current.get("account") == provider_rejection_retry_row.get("account")
                    and current.get("conversation_id") == provider_rejection_retry_row.get("conversation_id")
                ):
                    store.update(
                        task_id,
                        status="failed",
                        error=str(provider_rejection_retry_detail)[:500],
                        failure_code="PROVIDER_REJECTED",
                        finished_at=time.time(),
                    )
        if cannot_answer_retry_detail and cannot_answer_retry_row and task_id not in VIDEO_CANCELLED_TASKS:
            sketch_scheduled = False
            if cannot_answer_retry_sketch:
                sketch_scheduled = await _schedule_sketch_reference_retry(
                    cannot_answer_retry_row, cannot_answer_retry_detail
                )
            if not sketch_scheduled and not _schedule_cannot_answer_retry(
                cannot_answer_retry_row, cannot_answer_retry_detail
            ):
                current = store.get(task_id)
                if (
                    current
                    and current.get("status") in {"submitting", "processing"}
                    and current.get("account") == cannot_answer_retry_row.get("account")
                    and current.get("conversation_id") == cannot_answer_retry_row.get("conversation_id")
                ):
                    store.update(
                        task_id,
                        status="failed",
                        error=_cannot_answer_retry_failure_message(current)[:500],
                        failure_code=cannot_answer_retry_failure_code,
                        finished_at=time.time(),
                    )
        if provider_busy_retry_detail and provider_busy_retry_row and task_id not in VIDEO_CANCELLED_TASKS:
            if not _schedule_provider_busy_retry(
                provider_busy_retry_row, provider_busy_retry_detail
            ):
                current = store.get(task_id)
                if (
                    current
                    and current.get("status") in {"submitting", "processing"}
                    and current.get("account") == provider_busy_retry_row.get("account")
                    and current.get("conversation_id") == provider_busy_retry_row.get("conversation_id")
                ):
                    store.update(
                        task_id,
                        status="failed",
                        error=_provider_busy_failure_message(
                            provider_busy_retry_detail,
                            current.get("timings_json"),
                        ),
                        failure_code="PROVIDER_BUSY",
                        finished_at=time.time(),
                    )
        _cleanup_reference_cache_after_attempt(task_id)


async def _resume_task(row: dict):
    task_id = row["id"]
    if task_id in VIDEO_CANCELLED_TASKS:
        return
    task_timings = _decode_task_timings(row.get("timings_json")) or {}
    confirm_duration_now = bool(task_timings.get("duration_confirmation_pending"))
    if confirm_duration_now and task_timings.pop("consecutive_unexpected_poll_errors", None) is not None:
        # Earlier failures may have come from the confirmation attempt itself.
        # Give the corrected same-chat reply a fresh transient-error budget.
        store.update(task_id, timings_json=_encode_task_timings(task_timings))
    poll_started = time.monotonic()
    deadline = float(row.get("deadline_at") or 0)
    if not deadline:
        deadline = time.time() + config.VIDEO_MAX_WAIT_SEC
        store.update(task_id, deadline_at=deadline)
    api_key_hash = row.get("api_key_hash")
    acquired = False
    keep_polling = False
    post_submit_credit_detail = None
    post_submit_account_limit_detail = None
    post_submit_rate_limit_detail = None
    cannot_answer_detail = None
    cannot_answer_failure_code = "PROVIDER_NO_VIDEO"
    cannot_answer_sketch = False
    provider_busy_detail = None
    fast_mode_fallback_detail = None
    fast_to_pro_fallback_detail = None
    content_policy_detail = None
    content_policy_final_detail = None
    provider_rejection_row = None
    provider_rejection_detail = None
    try:
        remaining = max(0.0, deadline - time.time())
        if remaining <= 0:
            raise TimeoutError("Tổng thời gian chờ render đã hết trước khi bắt đầu poll.")
        await asyncio.wait_for(
            key_limiter.acquire(
                api_key_hash, int(row.get("client_concurrency_limit") or 0)
            ),
            timeout=remaining,
        )
        acquired = True
        remaining = max(0.0, deadline - time.time())
        if remaining <= 0:
            raise TimeoutError("Tổng thời gian chờ render đã hết trước khi mở poll.")
        poll_window = min(
            config.VIDEO_POLL_WINDOW_SEC,
            max(1, int(remaining)),
        )
        store.update(task_id, status="processing", last_poll_at=time.time(),
                     started_at=row.get("started_at") or time.time())

        def on_poll(now):
            _record_video_poll_success(task_id, now)

        remaining = max(0.0, deadline - time.time())
        if remaining <= 0:
            raise TimeoutError("Tổng thời gian chờ render đã hết trước khi poll conversation.")
        try:
            result = await asyncio.wait_for(
                render_pool.resume_video(
                    row["account"], row["conversation_id"], poll_window, on_poll=on_poll,
                    duration=row.get("duration"),
                    model=row.get("model"),
                    ratio=None if row.get("ratio") in (None, "default") else row.get("ratio"),
                    confirm_duration=confirm_duration_now,
                    prompt_text=row.get("prompt"),
                    task_id=task_id),
                timeout=remaining,
            )
        except RenderStillProcessingError:
            raise
        except Exception as exc:
            if _is_fast_to_pro_retry(task_timings):
                raise FastToProLimitError(str(exc)) from exc
            raise
        public_url = f"{config.PUBLIC_BASE}/videos/{Path(result['local_path']).name}"
        store.update(task_id, status="completed", video_url=public_url,
                     account=result.get("account"), last_poll_at=time.time(),
                     video_metadata=_encode_video_metadata(result),
                     error=None, failure_code=None, finished_at=time.time())
        if confirm_duration_now:
            latest = store.get(task_id) or {}
            timings = _decode_task_timings(latest.get("timings_json")) or {}
            if timings.pop("duration_confirmation_pending", None) is not None:
                store.update(task_id, timings_json=_encode_task_timings(timings))
    except FastToProLimitError as e:
        store.update(
            task_id,
            status="failed",
            error=_fast_to_pro_limit_message(str(e)),
            failure_code="LIMIT",
            finished_at=time.time(),
        )
    except RenderStillProcessingError as e:
        keep_polling = _continue_video_polling(task_id, str(e))
        if not keep_polling:
            _record_timeout_failure(task_id, e)
    except VideoDownloadError as e:
        store.update(task_id, status="failed", error=str(e)[:500],
                     failure_code="VIDEO_DOWNLOAD_FAILED", finished_at=time.time())
    except VideoValidationError as e:
        store.update(task_id, status="failed", error=str(e)[:500],
                     failure_code="OUTPUT_INVALID", finished_at=time.time())
    except PostSubmitRateLimitError as e:
        post_submit_rate_limit_detail = str(e)
    except RateLimitError as e:
        store.update(task_id, status="failed", error=str(e)[:500],
                     failure_code="RATE_LIMIT", finished_at=time.time())
    except RiskControlError as e:
        store.update(task_id, status="failed", error=str(e)[:500],
                     failure_code="RISK_CONTROL", finished_at=time.time())
    except SessionExpiredError as e:
        keep_polling = _continue_video_polling(
            task_id,
            "Dola session đã hết khi poll; Gateway sẽ đăng nhập lại bằng Gmail trong profile "
            "và tiếp tục conversation cũ.",
        )
        if not keep_polling:
            store.update(task_id, status="failed", error=str(e)[:500],
                         failure_code="AUTH_EXPIRED", finished_at=time.time())
    except ContentPolicyFinalRefusalError as e:
        # A final safety denial cannot be recovered by sending the same scene
        # from another profile. Mark it after releasing this poll window.
        content_policy_final_detail = str(e)
    except ContentPolicyRejectedError as e:
        # The accepted conversation is a policy refusal. Release this poll
        # reservation, then allow one fresh attempt with a safe prompt rewrite.
        content_policy_detail = str(e)
    except ImageLikenessRejectedError as e:
        provider_rejection_row = store.get(task_id)
        provider_rejection_detail = str(e)
    except (
        CannotAnswerQuestionError,
        NoVideoCreationError,
        ProviderTaskIdEmptyError,
        SomethingWentWrongError,
    ) as e:
        # This response proves the old conversation produced no video. Let the
        # cleanup block release the poll reservation before starting one fresh
        # logical attempt with a new conversation. Transient no-video tool
        # errors use the same bounded retry path.
        cannot_answer_detail = str(e)
        cannot_answer_failure_code = getattr(e, "failure_code", "PROVIDER_NO_VIDEO")
        cannot_answer_sketch = isinstance(
            e, (CannotAnswerQuestionError, NoVideoCreationError)
        ) and not isinstance(e, ProfileRotationRetryError)
    except ProviderBusyError as e:
        # Dola's explicit overload/no-video response is safe to resubmit, but
        # the next fresh chat must use a profile not already tried for this task.
        provider_busy_detail = str(e)
    except FastModeFallbackError as e:
        # Dola offered Fast after this conversation reached the Pro free limit.
        # Let the cleanup block release its poll reservation before retrying.
        fast_mode_fallback_detail = str(e)
    except FreshChatRetryError as e:
        # A resumed poll can see the same provider response after a Gateway
        # restart. Supported requests stay within the native 5/10/15s range;
        # never submit a second conversation as a duration fallback.
        store.update(task_id, status="failed", error=str(e)[:500],
                     failure_code=getattr(e, "failure_code", "PROVIDER_REJECTED"),
                     finished_at=time.time())
    except ProviderGenerationRejectedError as e:
        if isinstance(e, FreshChatRetryError):
            store.update(task_id, status="failed", error=str(e)[:500],
                         failure_code=getattr(e, "failure_code", "PROVIDER_REJECTED"), finished_at=time.time())
        else:
            provider_rejection_row = store.get(task_id)
            provider_rejection_detail = str(e)
    except PostSubmitCreditError as e:
        if str(task_timings.get("chat_mode_override") or "").casefold() == "fast":
            fast_to_pro_fallback_detail = str(e)
        else:
            # For older jobs or other modes, retain the existing profile-rotation
            # recovery behavior.
            post_submit_credit_detail = str(e)
    except PostSubmitAccountLimitError as e:
        # resume_video marks the limited profile before raising. After the old
        # poll reservation is released, start a fresh attempt on another one.
        post_submit_account_limit_detail = str(e)
    except TimeoutError as e:
        keep_polling = _continue_video_polling(task_id, "Poll bị timeout; sẽ kiểm tra lại conversation cũ.")
        if not keep_polling:
            _record_timeout_failure(task_id, e)
    except Exception as e:
        # A headed Chromium context can take a few seconds to release its
        # persistent-profile lock after a poll window closes. Retry transient
        # failures, but stop after a short consecutive streak so a terminal
        # worker error cannot leave the task processing until its 30-minute
        # deadline.
        transient_poll_dependency_error = _is_recoverable_poll_dependency_error(e)
        if _continue_video_polling(
            task_id,
            "Chưa đọc được kết quả; Gateway sẽ poll lại conversation cũ. " + str(e)[:160],
            unexpected_error=not transient_poll_dependency_error,
            recoverable_error=transient_poll_dependency_error,
            retry_delay_sec=(
                _proxy_poll_retry_delay(str(e)) if transient_poll_dependency_error else None
            ),
        ):
            keep_polling = True
        else:
            current_row = store.get(task_id)
            store.update(task_id, status="failed", error=str(e)[:500],
                         failure_code="POLL_FAILED" if current_row and current_row.get("conversation_id")
                         else "SUBMIT_FAILED",
                         finished_at=time.time())
    finally:
        current = store.get(task_id)
        timings = _decode_task_timings(current.get("timings_json")) if current else {}
        timings = timings or {}
        timings["poll_window_ms"] = round((time.monotonic() - poll_started) * 1000)
        timings["poll_window_count"] = int(timings.get("poll_window_count") or 0) + 1
        store.update(task_id, timings_json=_encode_task_timings(timings))
        if not keep_polling:
            render_pool.release_poll_reservation(row.get("account"))
        if acquired:
            await key_limiter.release(api_key_hash)
        if fast_to_pro_fallback_detail and task_id not in VIDEO_CANCELLED_TASKS:
            if not _schedule_fast_to_pro_fallback(row, fast_to_pro_fallback_detail):
                _mark_fast_to_pro_limit(row, fast_to_pro_fallback_detail)
        if content_policy_final_detail and task_id not in VIDEO_CANCELLED_TASKS:
            _fail_final_content_policy_refusal(row, content_policy_final_detail)
        if fast_mode_fallback_detail and task_id not in VIDEO_CANCELLED_TASKS:
            if not _schedule_fast_mode_fallback(row, fast_mode_fallback_detail):
                _mark_fast_mode_fallback_failed(row, fast_mode_fallback_detail)
        if (
            post_submit_account_limit_detail
            and task_id not in VIDEO_CANCELLED_TASKS
        ):
            if not _schedule_post_submit_account_limit_retry(
                row, post_submit_account_limit_detail
            ):
                current = store.get(task_id)
                if (
                    current
                    and current.get("status") in {"submitting", "processing"}
                    and current.get("account") == row.get("account")
                    and current.get("conversation_id") == row.get("conversation_id")
                ):
                    store.update(
                        task_id,
                        status="failed",
                        error=post_submit_account_limit_detail[:500],
                        failure_code="DAILY_LIMIT_DURING_RENDER",
                        finished_at=time.time(),
                    )
        if post_submit_rate_limit_detail and task_id not in VIDEO_CANCELLED_TASKS:
            if not _schedule_provider_busy_retry(
                row, post_submit_rate_limit_detail, rate_limited=True
            ):
                current = store.get(task_id)
                if (
                    current
                    and current.get("status") in {"submitting", "processing"}
                    and current.get("account") == row.get("account")
                    and current.get("conversation_id") == row.get("conversation_id")
                ):
                    store.update(
                        task_id,
                        status="failed",
                        error=_provider_busy_failure_message(
                            post_submit_rate_limit_detail,
                            current.get("timings_json"),
                            rate_limited=True,
                        ),
                        failure_code="RATE_LIMIT_DURING_RENDER",
                        finished_at=time.time(),
                    )
        if post_submit_credit_detail and task_id not in VIDEO_CANCELLED_TASKS:
            if not _schedule_post_submit_credit_retry(row, post_submit_credit_detail):
                current = store.get(task_id)
                if (
                    current
                    and current.get("status") in {"submitting", "processing"}
                    and current.get("conversation_id") == row.get("conversation_id")
                ):
                    store.update(
                        task_id,
                        status="failed",
                        error=post_submit_credit_detail[:500],
                        failure_code="CREDIT_DURING_RENDER",
                        finished_at=time.time(),
                    )
        if content_policy_detail and task_id not in VIDEO_CANCELLED_TASKS:
            if not _schedule_cannot_answer_retry(
                row,
                content_policy_detail,
                safety_rewrite=True,
            ):
                current = store.get(task_id)
                if (
                    current
                    and current.get("status") in {"submitting", "processing"}
                    and current.get("account") == row.get("account")
                    and current.get("conversation_id") == row.get("conversation_id")
                ):
                    store.update(
                        task_id,
                        status="failed",
                        error=(
                            f"{CONTENT_POLICY_FINAL_MESSAGE} "
                            f"{content_policy_detail[:260]}"
                        )[:500],
                        failure_code="CONTENT_POLICY_REJECTED",
                        finished_at=time.time(),
                    )
        if provider_rejection_detail and provider_rejection_row and task_id not in VIDEO_CANCELLED_TASKS:
            if not await _schedule_sketch_reference_retry(
                provider_rejection_row,
                provider_rejection_detail,
            ):
                current = store.get(task_id)
                if (
                    current
                    and current.get("status") in {"submitting", "processing"}
                    and current.get("account") == provider_rejection_row.get("account")
                    and current.get("conversation_id") == provider_rejection_row.get("conversation_id")
                ):
                    store.update(
                        task_id,
                        status="failed",
                        error=str(provider_rejection_detail)[:500],
                        failure_code="PROVIDER_REJECTED",
                        finished_at=time.time(),
                    )
        if cannot_answer_detail and task_id not in VIDEO_CANCELLED_TASKS:
            sketch_scheduled = False
            if cannot_answer_sketch:
                sketch_scheduled = await _schedule_sketch_reference_retry(
                    row,
                    cannot_answer_detail,
                )
            if not sketch_scheduled and not _schedule_cannot_answer_retry(row, cannot_answer_detail):
                current = store.get(task_id)
                if (
                    current
                    and current.get("status") in {"submitting", "processing"}
                    and current.get("account") == row.get("account")
                    and current.get("conversation_id") == row.get("conversation_id")
                ):
                    store.update(
                        task_id,
                        status="failed",
                        error=_cannot_answer_retry_failure_message(current)[:500],
                        failure_code=cannot_answer_failure_code,
                        finished_at=time.time(),
                    )
        if provider_busy_detail and task_id not in VIDEO_CANCELLED_TASKS:
            if not _schedule_provider_busy_retry(row, provider_busy_detail):
                current = store.get(task_id)
                if (
                    current
                    and current.get("status") in {"submitting", "processing"}
                    and current.get("account") == row.get("account")
                    and current.get("conversation_id") == row.get("conversation_id")
                ):
                    store.update(
                        task_id,
                        status="failed",
                        error=_provider_busy_failure_message(
                            provider_busy_detail,
                            current.get("timings_json"),
                        ),
                        failure_code="PROVIDER_BUSY",
                        finished_at=time.time(),
                    )
        _cleanup_reference_cache_after_attempt(task_id)


async def _cancel_video_runtime(task_id: str):
    """Stop all local workers/poll windows for a task and release reservations."""
    VIDEO_CANCELLED_TASKS.add(task_id)
    running = []
    for registry in (VIDEO_WORKER_TASKS, VIDEO_POLL_TASKS):
        task = registry.get(task_id)
        if task and not task.done() and task not in running:
            task.cancel()
            running.append(task)

    if running:
        gathered = asyncio.gather(*running, return_exceptions=True)
        try:
            await asyncio.wait_for(gathered, timeout=5)
        except asyncio.TimeoutError:
            # A provider/browser call that is stuck in native code cannot be
            # awaited forever. Its task remains cancelled and its profile
            # reservation is kept until its own finally block runs.
            pass

    remaining = [
        registry[task_id]
        for registry in (VIDEO_WORKER_TASKS, VIDEO_POLL_TASKS)
        if task_id in registry and not registry[task_id].done()
    ]
    row = store.get(task_id)
    if row and row.get("account") and not remaining:
        render_pool.release_poll_reservation(row["account"])
    if not remaining:
        _clear_task_reference_cache(task_id)
        VIDEO_CANCELLED_TASKS.discard(task_id)


def _task_client(row: dict) -> dict:
    """Restores client context from task snapshot."""
    return {
        "api_key_hash": row.get("api_key_hash"),
        "api_key_name": row.get("api_key_name") or "Historical Task",
        "daily_limit": 0,
        "concurrency_limit": int(row.get("client_concurrency_limit") or 0),
        "allowed_durations": list(SUPPORTED_DURATIONS),
    }


def _task_reference_images(raw) -> list[str]:
    try:
        values = json.loads(raw or "[]")
    except (TypeError, json.JSONDecodeError):
        return []
    if not isinstance(values, list):
        return []
    # Legacy rows can contain the same public URL more than once. Preserve
    # order but make the durable task manifest one-image-per-URL before any
    # download or browser upload is started.
    normalized = []
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            normalized.append(text)
    return list(dict.fromkeys(normalized))


def _task_reference_image_names(raw) -> list[str]:
    """Decode the media-title manifest without shifting names between images."""
    try:
        values = json.loads(raw or "[]")
    except (TypeError, json.JSONDecodeError):
        return []
    if not isinstance(values, list):
        return []
    return [str(value or "").strip() for value in values[:30]]


def _reference_image_names_for_urls(raw_urls, raw_names, normalized_urls) -> list[str]:
    """Align client media titles with Gateway's de-duplicated URL manifest."""
    urls = list(raw_urls) if isinstance(raw_urls, (list, tuple)) else []
    names = list(raw_names) if isinstance(raw_names, (list, tuple)) else []
    seen = set()
    aligned = []
    for index, raw_url in enumerate(urls):
        url = str(raw_url or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        aligned.append(str(names[index] or "").strip() if index < len(names) else "")
    return (aligned + [""] * max(0, len(normalized_urls) - len(aligned)))[:len(normalized_urls)]


async def _start_recovered_tasks(recovery_items: list[tuple[str, dict]]):
    """Start durable task recovery after the HTTP server is ready.

    A previous process can leave many ``submitting`` rows without an account
    or conversation. They are safe to retry, but launching all Chromium
    contexts from the startup callback makes the readiness probe compete with
    recovery. Staggering only this initial hand-off preserves the normal
    configured ``MAX_CONCURRENCY`` limit once the process is running.
    """
    async def start_one(kind: str, original: dict):
        row = store.get(original["id"])
        if not row or row.get("status") not in {"queued", "submitting", "processing"}:
            return None
        if kind == "resume":
            if not row.get("account") or not row.get("conversation_id"):
                return None
            return _track_video_task(row["id"], _resume_task(row))
        ratio = row.get("ratio")
        if ratio == "default":
            ratio = None
        return _track_video_task(row["id"], _run_task(
            row["id"], row["model"], row["prompt"], ratio, row["duration"],
            _task_reference_images(row.get("reference_images")), _task_client(row),
            reference_image_names=_task_reference_image_names(
                row.get("reference_image_names")
            ),
        ))

    running: set[asyncio.Task] = set()
    try:
        await asyncio.sleep(config.STARTUP_RECOVERY_DELAY_SEC)
        waiting = list(recovery_items)
        while waiting or running:
            while waiting and len(running) < config.STARTUP_RECOVERY_CONCURRENCY:
                kind, original = waiting.pop(0)
                task = await start_one(kind, original)
                if task is not None:
                    running.add(task)
                if config.STARTUP_RECOVERY_STAGGER_SEC > 0:
                    await asyncio.sleep(config.STARTUP_RECOVERY_STAGGER_SEC)
            if running:
                done, running = await asyncio.wait(
                    running, return_when=asyncio.FIRST_COMPLETED
                )
                for task in done:
                    # _run_task/_resume_task persist their own failure state;
                    # consuming the exception here prevents an unhandled-task
                    # warning from hiding the next recovery item.
                    try:
                        task.result()
                    except asyncio.CancelledError:
                        pass
                    except Exception as exc:
                        print(
                            f"[startup-recovery] task worker failed: {str(exc)[:240]}",
                            flush=True,
                        )
    except asyncio.CancelledError:
        for task in running:
            task.cancel()
        if running:
            await asyncio.gather(*running, return_exceptions=True)
        raise


@app.on_event("startup")
async def resume_incomplete_tasks():
    """Recover accepted sessions and pending tasks after startup readiness."""
    global RISK_RECOVERY_TASK, PROXY_ROTATION_TASK, STARTUP_RECOVERY_TASK
    recovered_failed_ids = set()
    recovery_items: list[tuple[str, dict]] = []
    migrated_deadlines = store.migrate_video_poll_deadlines(
        config.VIDEO_LEGACY_MAX_WAIT_SEC,
        config.VIDEO_MAX_WAIT_SEC,
    )
    if migrated_deadlines:
        print(
            f"[startup-recovery] Extended accepted-conversation deadlines for "
            f"{len(migrated_deadlines)} task(s) to the configured "
            f"{config.VIDEO_MAX_WAIT_SEC}s total wait.",
            flush=True,
        )
    for row in store.recoverable_failed_poll_tasks():
        # The task reached the provider boundary before the local browser
        # failed. Reopen it as a poll-only task; never submit its prompt again.
        store.update(
            row["id"],
            status="processing",
            error="Gateway đang khôi phục poll conversation đã được Dola chấp nhận.",
            failure_code=None,
            finished_at=None,
        )
        render_pool.reserve_for_poll(row.get("account"))
        recovery_items.append(("resume", row))
        recovered_failed_ids.add(row["id"])
    for row in store.recoverable_tasks():
        if row["id"] in recovered_failed_ids:
            continue
        render_pool.reserve_for_poll(row.get("account"))
        recovery_items.append(("resume", row))
    for row in store.recoverable_queued_tasks():
        recovery_items.append(("submit", row))
    if recovery_items:
        STARTUP_RECOVERY_TASK = asyncio.create_task(
            _start_recovered_tasks(recovery_items)
        )
    if (
        RISK_RECOVERY_TASK is None or RISK_RECOVERY_TASK.done()
    ):
        RISK_RECOVERY_TASK = asyncio.create_task(_risk_control_recovery_loop())
    if PROXY_ROTATION_TASK is None or PROXY_ROTATION_TASK.done():
        PROXY_ROTATION_TASK = asyncio.create_task(_proxy_rotation_loop())


@app.post("/v1/videos/generations", response_model=TaskResponse, tags=["Video"])
async def create_video(
    req: VideoGenRequest,
    authorization: str | None = Header(default=None),
    x_dola_owner: str | None = Header(default=None, alias="X-Dola-Owner", include_in_schema=False),
    x_dola_internal_signature: str | None = Header(default=None, alias="X-Dola-Internal-Signature", include_in_schema=False),
    x_admin_key: str | None = Header(default=None),
    x_dola_admin_request: str | None = Header(default=None, alias="X-Dola-Admin-Request"),
):
    client = _auth(authorization, x_dola_owner, x_dola_internal_signature)
    owner_id = client.get("owner_id")
    try:
        chat_mode = _normalize_chat_mode(req.chat_mode)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    preferred_account = None
    if req.account:
        if str(x_dola_admin_request or "").strip() != "1":
            raise HTTPException(403, "Chỉ admin mới có thể chỉ định profile tạo video")
        _user_key_admin_auth(x_admin_key)
        preferred_account = _resolve_profile_names([req.account])[0]
    model, prompt, ratio, duration = _validate_video_config(
        client, req.model, req.prompt, req.duration, req.size, req.ratio
    )
    try:
        reference_images = await validate_reference_urls(req.reference_images)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    reference_image_names = _reference_image_names_for_urls(
        req.reference_images, req.reference_image_names, reference_images
    )
    reference_image_mode = _normalize_reference_image_mode(req.reference_image_mode, prompt)
    # Queue task when accounts are busy; reject only when pool is fully exhausted.
    if not render_pool.available and render_pool.all_accounts_limited:
        raise HTTPException(429, "Rate limited: All accounts reached Dola daily video limit, please try again tomorrow")
    if not render_pool.available and render_pool.all_accounts_quota_blocked:
        raise HTTPException(429, "Insufficient credits: All accounts lack points, waiting for refresh")
    if not render_pool.accounts:
        raise HTTPException(503, "no account in pool")
    task_id = "video_" + uuid.uuid4().hex
    try:
        store.create(
            task_id,
            model,
            prompt,
            ratio or "default",
            duration,
            account=preferred_account,
            reference_images=json.dumps(reference_images, ensure_ascii=False),
            reference_image_names=json.dumps(reference_image_names, ensure_ascii=False),
            reference_image_mode=reference_image_mode,
            api_key_hash=client["api_key_hash"],
            api_key_name=client["api_key_name"],
            daily_limit=client["daily_limit"],
            concurrency_limit=client["concurrency_limit"],
            max_pending=config.MAX_PENDING_TASKS,
            owner_id=owner_id,
        )
    except TaskQuotaExceeded as exc:
        raise HTTPException(429, str(exc)) from exc
    except PendingTaskLimitExceeded as exc:
        raise HTTPException(429, str(exc)) from exc
    store.update(
        task_id,
        timings_json=_encode_task_timings({
            "chat_mode_override": chat_mode,
            "chat_mode_default": chat_mode,
        }),
    )
    _track_video_task(task_id, _run_task(
        task_id, model, prompt, ratio, duration, reference_images, client,
        preferred_account=preferred_account,
        reference_image_names=reference_image_names,
    ))
    return TaskResponse(
        id=task_id,
        status="queued",
        model=model,
        chat_mode=chat_mode,
        duration=duration,
        prompt=prompt,
        account=preferred_account,
        reference_image_names=reference_image_names,
        reference_image_mode=reference_image_mode,
    )


@app.post("/v1/videos/batches", tags=["Video"])
async def create_video_batch(
    req: VideoBatchRequest,
    authorization: str | None = Header(default=None),
    x_dola_owner: str | None = Header(default=None, alias="X-Dola-Owner", include_in_schema=False),
    x_dola_internal_signature: str | None = Header(default=None, alias="X-Dola-Internal-Signature", include_in_schema=False),
    x_admin_key: str | None = Header(default=None),
    x_dola_admin_request: str | None = Header(default=None, alias="X-Dola-Admin-Request"),
):
    """Admit an entire prompt batch atomically and start its workers.

    This avoids one HTTP round-trip per prompt. The provider work remains
    bounded by BrowserPool, while SQLite receives one transaction for the
    batch so pending/API-key quotas cannot be over-admitted by a race.
    """
    client = _auth(authorization, x_dola_owner, x_dola_internal_signature)
    owner_id = client.get("owner_id")
    try:
        chat_mode = _normalize_chat_mode(req.chat_mode)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    prompts = [_truncate_prompt(value) for value in req.prompts]
    if not prompts or any(not value for value in prompts):
        raise HTTPException(422, "prompts không được chứa dòng trống")

    preferred_accounts = None
    if req.accounts is not None:
        if str(x_dola_admin_request or "").strip() != "1":
            raise HTTPException(403, "Chỉ admin mới có thể chỉ định profile cho batch")
        _user_key_admin_auth(x_admin_key)
        if len(req.accounts) != len(prompts):
            raise HTTPException(422, "accounts phải có đúng một profile cho mỗi prompt")
        preferred_accounts = _resolve_profile_names(req.accounts)
        if len({name.casefold() for name in preferred_accounts}) != len(preferred_accounts):
            raise HTTPException(422, "Mỗi prompt trong batch phải dùng một profile khác nhau")

    model, _, ratio, duration = _validate_video_config(
        client, req.model, prompts[0], req.duration, req.size, req.ratio
    )
    try:
        reference_images = await validate_reference_urls(req.reference_images)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    reference_image_names = _reference_image_names_for_urls(
        req.reference_images, req.reference_image_names, reference_images
    )
    reference_image_mode = _normalize_reference_image_mode(req.reference_image_mode, prompts[0])

    # Queue while profiles are busy; reject only a genuinely exhausted pool.
    if not render_pool.available and render_pool.all_accounts_limited:
        raise HTTPException(
            429,
            "Rate limited: All accounts reached Dola daily video limit, please try again tomorrow",
        )
    if not render_pool.available and render_pool.all_accounts_quota_blocked:
        raise HTTPException(
            429,
            "Insufficient credits: All accounts lack points, waiting for refresh",
        )
    if not render_pool.accounts:
        raise HTTPException(503, "no account in pool")

    batch_id = "batch_" + uuid.uuid4().hex[:16]
    task_rows = []
    for index, prompt in enumerate(prompts):
        preferred_account = preferred_accounts[index] if preferred_accounts else None
        task_rows.append({
            "id": "video_" + uuid.uuid4().hex,
            "model": model,
            "prompt": prompt,
            "ratio": ratio or "default",
            "duration": duration,
            "account": preferred_account,
            "reference_images": json.dumps(reference_images, ensure_ascii=False),
            "reference_image_names": json.dumps(reference_image_names, ensure_ascii=False),
            "reference_image_mode": reference_image_mode,
            "api_key_hash": client["api_key_hash"],
            "api_key_name": client["api_key_name"],
            "client_concurrency_limit": client["concurrency_limit"],
            "owner_id": owner_id,
        })
    try:
        store.create_many(
            task_rows,
            max_pending=config.MAX_PENDING_TASKS,
            daily_limit=client["daily_limit"],
            api_key_hash=client["api_key_hash"],
            owner_id=owner_id,
        )
    except TaskQuotaExceeded as exc:
        raise HTTPException(429, str(exc)) from exc
    except PendingTaskLimitExceeded as exc:
        raise HTTPException(429, str(exc)) from exc

    for row in task_rows:
        store.update(
            row["id"],
            timings_json=_encode_task_timings({
                "chat_mode_override": chat_mode,
                "chat_mode_default": chat_mode,
            }),
        )
        _track_video_task(row["id"], _run_task(
            row["id"], row["model"], row["prompt"],
            None if row["ratio"] == "default" else row["ratio"],
            row["duration"], reference_images, client,
            preferred_account=row.get("account"),
            reference_image_names=reference_image_names,
        ))

    jobs = [TaskResponse(
        id=row["id"], status="queued", model=row["model"],
        chat_mode=chat_mode,
        duration=row["duration"], prompt=row["prompt"],
        account=row.get("account"),
        reference_image_names=reference_image_names,
        reference_image_mode=reference_image_mode,
    ).model_dump() for row in task_rows]
    return {
        "batch_id": batch_id,
        "status": "queued",
        "summary": {"total": len(jobs), "accepted": len(jobs), "failed": 0},
        "jobs": jobs,
    }


@app.get("/v1/videos/status", tags=["Video"])
async def get_video_statuses(
    ids: str = "",
    authorization: str | None = Header(default=None),
    x_dola_owner: str | None = Header(default=None, alias="X-Dola-Owner", include_in_schema=False),
    x_dola_internal_signature: str | None = Header(default=None, alias="X-Dola-Internal-Signature", include_in_schema=False),
):
    """Return many task states in one authorized request for queue monitors."""
    client = _auth(authorization, x_dola_owner, x_dola_internal_signature)
    owner_id = client.get("owner_id")
    task_ids = []
    seen = set()
    for raw_id in str(ids or "").split(","):
        task_id = raw_id.strip()
        if not task_id or task_id in seen:
            continue
        seen.add(task_id)
        task_ids.append(task_id)
    if not task_ids:
        raise HTTPException(422, "ids must contain at least one task id")
    if len(task_ids) > 100:
        raise HTTPException(422, "A maximum of 100 task ids can be queried at once")
    rows = []
    for task_id in task_ids:
        row = store.get_for_client(task_id, client["api_key_hash"], owner_id=owner_id)
        if row:
            rows.append(_task_status_response(row))
    return {"tasks": rows}


@app.post("/api/admin/tasks/{task_id}/confirm-duration")
async def confirm_task_duration(task_id: str, x_admin_key: str | None = Header(default=None)):
    """Resume the same rejected conversation for one duration clarification."""
    _admin_auth(x_admin_key)
    row = store.get(task_id)
    if not row:
        raise HTTPException(404, "task not found")
    timings = _decode_task_timings(row.get("timings_json")) or {}
    if (
        row.get("status") != "failed"
        or not row.get("conversation_id")
        or not row.get("account")
        or row.get("duration") not in SUPPORTED_DURATIONS
        or not (
            row.get("failure_code") == DurationCapabilityMismatchError.failure_code
            or _is_duration_capability_error(row.get("error"))
            or timings.get("duration_confirmation_pending") is True
        )
    ):
        raise HTTPException(409, "Task không phải chat bị Dola yêu cầu xác nhận thời lượng")
    if render_pool.account_is_busy(row["account"]):
        raise HTTPException(409, "Profile đang được sử dụng; thử lại sau")
    timings["duration_confirmation_pending"] = True
    timings.pop("consecutive_unexpected_poll_errors", None)
    store.update(task_id, status="processing", error=None, failure_code=None,
                 finished_at=None, deadline_at=time.time() + config.VIDEO_MAX_WAIT_SEC,
                 timings_json=_encode_task_timings(timings))
    render_pool.reserve_for_poll(row["account"])
    _track_video_task(task_id, _resume_task(store.get(task_id)))
    return {"id": task_id, "status": "processing", "conversation_id": row["conversation_id"]}


@app.post("/v1/videos/{task_id}/retry", response_model=TaskResponse, tags=["Video"])
async def retry_video(
    task_id: str,
    req: TaskRetryRequest | None = None,
    authorization: str | None = Header(default=None),
    x_dola_owner: str | None = Header(default=None, alias="X-Dola-Owner", include_in_schema=False),
    x_dola_internal_signature: str | None = Header(default=None, alias="X-Dola-Internal-Signature", include_in_schema=False),
    x_admin_key: str | None = Header(default=None),
    x_dola_admin_request: str | None = Header(default=None, alias="X-Dola-Admin-Request"),
):
    """Retry a failed logical task while keeping its durable task id."""
    admin_request = str(x_dola_admin_request or "").strip() == "1"
    if admin_request:
        _admin_auth(x_admin_key)
        source = store.get(task_id)
        client = _task_client(source) if source else _anonymous_client()
        owner_id = None
    else:
        client = _auth(authorization, x_dola_owner, x_dola_internal_signature)
        owner_id = client.get("owner_id")
        source = store.get_for_client(task_id, client["api_key_hash"], owner_id=owner_id)
    if not source:
        raise HTTPException(404, "task not found")
    if source.get("status") != "failed":
        raise HTTPException(409, "Only failed tasks can be retried")
    if (source.get("account") and source.get("conversation_id")
            and not source.get("video_url")
            and source.get("failure_code") in (
                None, "POLL_FAILED", "RENDER_TIMEOUT", "AUTH_EXPIRED",
                "VIDEO_DOWNLOAD_FAILED",
            )):
        # Poll the accepted conversation before any new-generation validation,
        # quota checks, reference downloads, or destructive requeue operation.
        resumed = store.resume_failed_poll(
            task_id, source["account"], source["conversation_id"],
            max(float(source.get("deadline_at") or 0), time.time() + config.VIDEO_MAX_WAIT_SEC),
        )
        if not resumed:
            raise HTTPException(409, "Task đã đổi trạng thái; hãy tải lại")
        timings = _decode_task_timings(resumed.get("timings_json")) or {}
        timings["conversation_poll_max_wait_sec"] = config.VIDEO_MAX_WAIT_SEC
        store.update(task_id, timings_json=_encode_task_timings(timings))
        resumed["timings_json"] = _encode_task_timings(timings)
        render_pool.reserve_for_poll(resumed["account"])
        _track_video_task(task_id, _resume_task(resumed))
        return _task_response(resumed)
    # This is an explicit user retry, not an automatic rejection loop.
    # PROVIDER_REJECTED also includes duration responses and generic errors;
    # it does not establish that a portrait policy was involved.

    model = str(source.get("model") or "seedance-2.5")
    duration = int(source.get("duration") or 10)
    model_key = model.lower().replace("-", "_")
    if duration not in SUPPORTED_DURATIONS:
        raise HTTPException(422, "Currently supports durations of 5s, 10s, and 15s")
    if model_key not in ENABLED_MODEL_KEYS:
        raise HTTPException(422, "Chỉ hỗ trợ Seedance 2.0 hoặc Seedance 2.5")
    if duration not in client["allowed_durations"]:
        raise HTTPException(422, f"Current API Key is not allowed to generate {duration}s videos")

    requested_reference_images = (
        list(req.reference_images)
        if req is not None and req.reference_images is not None
        else _task_reference_images(source.get("reference_images"))
    )
    try:
        reference_images = await validate_reference_urls(requested_reference_images)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not render_pool.available and render_pool.all_accounts_limited:
        raise HTTPException(429, "Rate limited: All accounts reached Dola daily video limit, please try again tomorrow")
    if not render_pool.available and render_pool.all_accounts_quota_blocked:
        raise HTTPException(429, "Insufficient credits: All accounts lack points, waiting for refresh")
    if not render_pool.accounts:
        raise HTTPException(503, "no account in pool")

    retry_source_prompt = _truncate_prompt(source.get("prompt") or "")
    if not retry_source_prompt:
        raise HTTPException(422, "prompt must not be empty")

    preferred_account = None
    retry_exclusions = []
    source_timings = _decode_task_timings(source.get("timings_json")) or {}
    for key in (
        "provider_busy_tried_accounts",
        "daily_limit_tried_accounts",
        "rate_limit_tried_accounts",
        "cannot_answer_tried_accounts",
        "manual_retry_excluded_accounts",
    ):
        values = source_timings.get(key)
        if isinstance(values, (list, tuple, set)):
            retry_exclusions.extend(
                str(name).strip() for name in values if str(name).strip()
            )
    requested_exclusions = req.excluded_accounts if req else None
    if requested_exclusions:
        if not admin_request:
            raise HTTPException(403, "Chỉ admin mới có thể loại trừ profile khi retry")
        accounts_by_alias = {}
        for item in render_pool.list_accounts():
            name = str(item.get("name") or "").strip()
            if name:
                accounts_by_alias[name.casefold()] = name
            email = str(item.get("email") or "").strip()
            if email:
                accounts_by_alias[email.casefold()] = name
        for value in requested_exclusions:
            alias = str(value or "").strip().casefold()
            canonical = accounts_by_alias.get(alias)
            if not canonical:
                raise HTTPException(404, f"Không tìm thấy profile cần loại trừ: {value}")
            retry_exclusions.append(canonical)
    retry_exclusions = list(dict.fromkeys(retry_exclusions))

    requested_account = str((req.account if req else "") or "").strip().casefold()
    if requested_account:
        if not admin_request:
            raise HTTPException(403, "Chỉ admin mới có thể chỉ định profile retry")
        account_matches = [
            item
            for item in render_pool.list_accounts()
            if requested_account in {
                str(item.get("name") or "").strip().casefold(),
                str(item.get("email") or "").strip().casefold(),
            }
        ]
        if not account_matches:
            raise HTTPException(404, f"Không tìm thấy profile: {req.account}")
        preferred_account = account_matches[0]["name"]
        retry_exclusions = [
            name for name in retry_exclusions
            if name.casefold() != str(preferred_account).strip().casefold()
        ]

    ratio = source.get("ratio") or "default"
    retry_ratio = "16:9" if ratio == "default" else ratio
    # Historical tasks may already contain the generated Pro envelope. Build
    # one canonical envelope before persisting the retry so the queue row,
    # retry response, and next browser submission all use the same prompt.
    retry_prompt = pro_video_prompt(
        retry_source_prompt,
        retry_ratio,
        duration,
        config.MAX_PROMPT_CHARS,
    )
    requested_reference_names = (
        list(req.reference_image_names)
        if req is not None and req.reference_image_names is not None
        else _task_reference_image_names(source.get("reference_image_names"))
    )
    reference_image_names = _reference_image_names_for_urls(
        requested_reference_images,
        requested_reference_names,
        reference_images,
    )
    reference_image_mode = _normalize_reference_image_mode(
        req.reference_image_mode if req is not None and req.reference_image_mode is not None
        else source.get("reference_image_mode"),
        retry_source_prompt,
    )
    try:
        retried = store.requeue_failed(
            task_id,
            client["api_key_hash"],
            daily_limit=client["daily_limit"],
            max_pending=config.MAX_PENDING_TASKS,
            owner_id=owner_id,
        )
        if not retried:
            raise HTTPException(404, "task not found")
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    except TaskQuotaExceeded as exc:
        raise HTTPException(429, str(exc)) from exc
    except PendingTaskLimitExceeded as exc:
        raise HTTPException(429, str(exc)) from exc

    # Older failed tasks may predate the automatic single-video instruction.
    # Persist the normalized prompt so the task/API response and the browser
    # payload remain identical on retry.
    retry_timings = {
        "chat_mode_override": _normalize_chat_mode(
            source_timings.get("chat_mode_override") or source_timings.get("chat_mode_default") or "Fast"
        ),
        "chat_mode_default": _normalize_chat_mode(
            source_timings.get("chat_mode_override") or source_timings.get("chat_mode_default") or "Fast"
        ),
    }
    if retry_exclusions:
        retry_timings["manual_retry_excluded_accounts"] = retry_exclusions
    store.update(
        task_id,
        prompt=retry_prompt,
        reference_images=json.dumps(reference_images, ensure_ascii=False),
        reference_image_names=json.dumps(reference_image_names, ensure_ascii=False),
        reference_image_mode=reference_image_mode,
        timings_json=_encode_task_timings(retry_timings),
    )

    # The failed provider conversation is never reused. Requeueing only
    # resets this logical task row; the worker below starts a new conversation.
    _track_video_task(task_id, _run_task(
        task_id,
        model,
        retry_prompt,
        None if ratio == "default" else ratio,
        duration,
        reference_images,
        client,
        preferred_account=preferred_account,
        reference_image_names=reference_image_names,
        excluded_accounts=retry_exclusions,
    ))
    retry_count = max(0, int(retried.get("retry_count") or 0))
    return TaskResponse(
        id=task_id,
        status="queued",
        model=model,
        chat_mode=retry_timings["chat_mode_override"],
        duration=duration,
        prompt=retry_prompt,
        reference_image_names=reference_image_names,
        reference_image_mode=reference_image_mode,
        retry_of=retried.get("retry_of"),
        retry_count=retry_count,
    )


@app.get("/v1/videos/{task_id}", response_model=TaskResponse, tags=["Video"])
async def get_video(
    task_id: str,
    authorization: str | None = Header(default=None),
    x_dola_owner: str | None = Header(default=None, alias="X-Dola-Owner", include_in_schema=False),
    x_dola_internal_signature: str | None = Header(default=None, alias="X-Dola-Internal-Signature", include_in_schema=False),
):
    client = _auth(authorization, x_dola_owner, x_dola_internal_signature)
    owner_id = client.get("owner_id")
    row = store.get_for_client(task_id, client["api_key_hash"], owner_id=owner_id)
    if not row:
        raise HTTPException(404, "task not found")
    return _task_response(row)


@app.get("/health/live", tags=["System"])
async def health_live():
    """Cheap liveness probe that never scans accounts or task state."""
    return {"ok": True}


@app.get("/health/ready")
async def health_ready():
    """Launcher probe kept independent from the heavy admin health payload."""
    try:
        pending_tasks = await asyncio.wait_for(
            asyncio.to_thread(store.pending_task_count),
            timeout=1.5,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(503, "task store đang bận") from exc
    return {
        "ok": True,
        "render_backend": config.RENDER_BACKEND,
        "studio_url": config.STUDIO_URL,
        "pending_tasks": pending_tasks,
        "max_pending_tasks": config.MAX_PENDING_TASKS,
    }


def _health_details():
    snapshot = render_pool.health_snapshot()
    return {
        "ok": True,
        "render_backend": config.RENDER_BACKEND,
        "studio_url": config.STUDIO_URL,
        "accounts": snapshot["accounts"],
        "available": snapshot["available"],
        "pending_tasks": store.pending_task_count(),
        "max_pending_tasks": config.MAX_PENDING_TASKS,
    }


@app.get("/health")
async def health():
    # The dashboard health payload includes synchronous filesystem/SQLite
    # work for every profile. Keep it off the Uvicorn event loop so a status
    # refresh cannot block batch admission or task polling.
    return await asyncio.to_thread(_health_details)


# ===== Admin Dashboard API =====


class AdminLogin(BaseModel):
    key: str


class AccountPatch(BaseModel):
    scheduling: bool | None = None
    note: str | None = None
    email: str | None = None
    proxy_id: str | None = None


class ProxyBulkImport(BaseModel):
    text: str = ""
    protocol: str = "HTTP"
    mode: str = "rotating"
    name_prefix: str = "Proxy"


class ProxyCreateUpdate(BaseModel):
    name: str = "Proxy"
    protocol: str = "HTTP"
    mode: str = "rotating"
    host: str
    port: int
    username: str = ""
    password: str | None = None


class ProxyRename(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)


class ProxyBulkAction(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=MAX_TEST_ITEMS)
    all: bool = False


class ProxyFBCreate(BaseModel):
    name: str = "ProxyFB rotating"
    api_key: str
    location_id: str = ""
    force_change: bool = True


class ProxyFBBulkImport(BaseModel):
    text: str = ""
    location_id: str = ""
    name_prefix: str = "ProxyFB"


class AccountBulkProxy(BaseModel):
    names: list[str] = Field(default_factory=list, min_length=1, max_length=100)
    proxy_id: str | None = None


class AccountProxyDistribution(BaseModel):
    """Evenly assign enabled proxies to selected or all local profiles."""

    names: list[str] = Field(default_factory=list)
    proxy_ids: list[str] = Field(default_factory=list)


class AccountAdd(BaseModel):
    name: str | None = None
    email: str
    password: str
    totp: str = ""


class ManualProfileCreate(BaseModel):
    name: str | None = Field(default=None, max_length=32)


class AccountRelogin(BaseModel):
    email: str | None = None
    password: str | None = None
    totp: str = ""


class AccountBulkDelete(BaseModel):
    names: list[str] = Field(default_factory=list, min_length=1, max_length=100)


class AccountBulkRelogin(BaseModel):
    names: list[str] = Field(default_factory=list, min_length=1, max_length=50)
    mode: str = "saved-credentials"


class AccountBulkLoginItem(BaseModel):
    email: str
    password: str
    totp: str = ""


class AccountBulkLogin(BaseModel):
    accounts: list[AccountBulkLoginItem] = Field(default_factory=list, min_length=1, max_length=50)


class TaskBulkDelete(BaseModel):
    ids: list[str] = Field(default_factory=list, min_length=1, max_length=500)


class KeyCreate(BaseModel):
    name: str = ""
    daily_limit: int = Field(0, ge=0, le=1_000_000)
    concurrency_limit: int = Field(0, ge=0, le=1_000)
    allowed_durations: list[int] = Field(default_factory=lambda: list(SUPPORTED_DURATIONS))
    expires_at: float | None = Field(None, ge=0)


class KeyPatch(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    daily_limit: int | None = Field(None, ge=0, le=1_000_000)
    concurrency_limit: int | None = Field(None, ge=0, le=1_000)
    allowed_durations: list[int] | None = None
    expires_at: float | None = Field(None, ge=0)


class UserApiKeyCreate(BaseModel):
    name: str = Field("Seedance API", min_length=1, max_length=64)


@app.get("/api/tasks")
async def client_tasks(
    limit: int = 100,
    offset: int = 0,
    x_dola_owner: str | None = Header(default=None, alias="X-Dola-Owner"),
):
    """Return only tasks owned by the authenticated MaiVideo user."""
    owner_id = _normalize_owner_id(x_dola_owner, required=True)
    page_limit = min(max(limit, 1), 500)
    page_offset = max(offset, 0)
    tasks = store.recent_queue_tasks(page_limit, owner_id=owner_id, offset=page_offset)
    total = store.count_tasks(owner_id=owner_id)
    return {
        "tasks": tasks,
        "total": total,
        "limit": page_limit,
        "offset": page_offset,
        "has_more": page_offset + len(tasks) < total,
    }


@app.post("/api/admin/login")
async def admin_login(body: AdminLogin):
    if not config.ADMIN_KEY:
        raise HTTPException(503, "Cần cấu hình DOLA_ADMIN_KEY để quản lý Gateway")
    if body.key == config.ADMIN_KEY:
        return {"ok": True, "auth_required": True}
    raise HTTPException(401, "wrong admin key")


@app.get("/api/admin/accounts")
async def admin_accounts(x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    accounts = pool.list_accounts()
    for account in accounts:
        account["credentials_saved"] = credential_store.has(account["name"])
    return {"accounts": accounts}


@app.get("/api/admin/proxies")
async def admin_proxies(x_admin_key: str | None = Header(default=None)):
    """Return managed proxy metadata without exposing credentials."""
    _admin_auth(x_admin_key)
    manager = pool.proxy_manager
    return {"proxies": manager.list_public(), "summary": manager.summary()}


@app.post("/api/admin/proxies/bulk")
async def admin_proxies_bulk(body: ProxyBulkImport,
                             x_admin_key: str | None = Header(default=None)):
    """Import/update up to 1000 proxy endpoints in one request."""
    _admin_auth(x_admin_key)
    try:
        result = pool.proxy_manager.bulk_upsert(
            body.text,
            protocol=body.protocol,
            mode=body.mode,
            name_prefix=body.name_prefix,
        )
    except ProxyValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True, **result}


@app.post("/api/admin/proxies/proxyfb")
async def admin_proxyfb_create(body: ProxyFBCreate,
                                x_admin_key: str | None = Header(default=None)):
    """Create one managed proxy from a ProxyFB API key and location."""
    _admin_auth(x_admin_key)
    try:
        action, proxy = await asyncio.to_thread(
            pool.proxy_manager.create_proxyfb,
            name=body.name,
            api_key=body.api_key,
            location_id=body.location_id,
            force_change=body.force_change,
        )
    except (ProxyFBError, ProxyValidationError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True, "action": action, "proxy": proxy}


@app.post("/api/admin/proxies/proxyfb/bulk")
async def admin_proxies_proxyfb_bulk(body: ProxyFBBulkImport,
                                     x_admin_key: str | None = Header(default=None)):
    """Create/update up to the safe ProxyFB key batch limit sequentially."""
    _admin_auth(x_admin_key)
    try:
        result = await pool.proxy_manager.bulk_create_proxyfb(
            body.text,
            default_location=body.location_id,
            name_prefix=body.name_prefix,
        )
    except (ProxyFBError, ProxyValidationError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True, "max_lines": MAX_PROXYFB_LINES, **result}


@app.post("/api/admin/proxies")
async def admin_proxy_create(body: ProxyCreateUpdate,
                             x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    try:
        proxy = pool.proxy_manager.create_or_update(
            body.model_dump(exclude={"password"}),
            password=body.password,
        )
    except (ProxyValidationError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True, "proxy": proxy}


@app.post("/api/admin/proxies/bulk-test")
async def admin_proxies_bulk_test(body: ProxyBulkAction,
                                  x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    try:
        result = await pool.proxy_manager.test_many(body.ids, all_enabled=body.all)
    except ProxyValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    return result


@app.post("/api/admin/proxies/bulk-rotate")
async def admin_proxies_bulk_rotate(body: ProxyBulkAction,
                                    x_admin_key: str | None = Header(default=None)):
    """Request new IPs for selected or all enabled ProxyFB API profiles."""
    _admin_auth(x_admin_key)
    try:
        result = await asyncio.to_thread(
            pool.proxy_manager.rotate_proxyfb_many,
            body.ids,
            all_enabled=body.all,
        )
    except ProxyValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True, **result}


@app.post("/api/admin/proxies/bulk-delete")
async def admin_proxies_bulk_delete(body: ProxyBulkAction,
                                    x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    ids = body.ids
    if body.all:
        ids = [item["id"] for item in pool.proxy_manager.list_public()]
    if not ids:
        raise HTTPException(422, "Hãy chọn ít nhất một proxy để xóa.")
    return {"ok": True, "deleted": pool.proxy_manager.delete_many(ids)}


@app.post("/api/admin/proxies/{proxy_id}/test")
async def admin_proxy_test(proxy_id: str,
                           x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    try:
        return (await pool.proxy_manager.test_many([proxy_id]))
    except ProxyValidationError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/admin/proxies/{proxy_id}/rotate")
async def admin_proxy_rotate(proxy_id: str,
                             x_admin_key: str | None = Header(default=None)):
    """Ask ProxyFB for a new IP for one API-backed profile."""
    _admin_auth(x_admin_key)
    try:
        proxy = await asyncio.to_thread(pool.proxy_manager.rotate_proxyfb, proxy_id)
    except (ProxyFBError, ProxyValidationError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True, "proxy": proxy}


@app.patch("/api/admin/proxies/{proxy_id}/name")
async def admin_proxy_rename(proxy_id: str, body: ProxyRename,
                             x_admin_key: str | None = Header(default=None)):
    """Rename a managed proxy while preserving its endpoint and credentials."""
    _admin_auth(x_admin_key)
    try:
        proxy = pool.proxy_manager.rename(proxy_id, body.name)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ProxyValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True, "proxy": proxy}


@app.patch("/api/admin/proxies/{proxy_id}")
async def admin_proxy_update(proxy_id: str, body: ProxyCreateUpdate,
                             x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    if not any(item["id"] == proxy_id for item in pool.proxy_manager.list_public()):
        raise HTTPException(404, "Không tìm thấy proxy profile.")
    try:
        proxy = pool.proxy_manager.create_or_update(
            body.model_dump(exclude={"password"}),
            password=body.password,
            proxy_id=proxy_id,
        )
    except (ProxyValidationError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True, "proxy": proxy}


@app.delete("/api/admin/proxies/{proxy_id}")
async def admin_proxy_delete(proxy_id: str,
                             x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    if not pool.proxy_manager.delete(proxy_id):
        raise HTTPException(404, "Không tìm thấy proxy profile.")
    return {"ok": True}


@app.post("/api/admin/accounts/bulk-proxy")
async def admin_accounts_bulk_proxy(body: AccountBulkProxy,
                                     x_admin_key: str | None = Header(default=None)):
    """Assign one proxy (or clear it) for several selected local profiles."""
    _admin_auth(x_admin_key)
    existing = {item["name"] for item in pool.list_accounts()}
    names = list(dict.fromkeys(str(name).strip() for name in body.names if str(name).strip()))
    if not names:
        raise HTTPException(422, "Hãy chọn ít nhất một profile.")
    results = []
    for name in names:
        if name not in existing:
            results.append({"name": name, "ok": False, "error": "Không tìm thấy profile."})
            continue
        try:
            results.append({"name": name, "ok": True, **pool.set_proxy(name, body.proxy_id)})
        except (KeyError, ValueError) as exc:
            results.append({"name": name, "ok": False, "error": str(exc)})
    return {
        "ok": any(item["ok"] for item in results),
        "results": results,
        "updated": sum(1 for item in results if item["ok"]),
        "failed": sum(1 for item in results if not item["ok"]),
    }


@app.post("/api/admin/accounts/distribute-proxy")
async def admin_accounts_distribute_proxy(body: AccountProxyDistribution,
                                             x_admin_key: str | None = Header(default=None)):
    """Assign enabled proxies round-robin across selected or all local profiles."""
    _admin_auth(x_admin_key)
    names = list(dict.fromkeys(str(name).strip() for name in body.names if str(name).strip()))
    if not names:
        names = [str(item["name"]) for item in pool.list_accounts() if str(item.get("name") or "").strip()]
    try:
        return pool.proxy_manager.assign_evenly(names, body.proxy_ids)
    except (KeyError, ProxyValidationError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/admin/accounts/bulk-delete")
async def admin_accounts_bulk_delete(body: AccountBulkDelete,
                                     x_admin_key: str | None = Header(default=None)):
    """Delete several profiles while leaving busy login/render sessions intact."""
    _admin_auth(x_admin_key)

    names = []
    seen = set()
    for raw_name in body.names:
        name = str(raw_name).strip()
        if name and name not in seen:
            names.append(name)
            seen.add(name)
    if not names:
        raise HTTPException(422, "Hãy chọn ít nhất một tài khoản")

    existing_accounts = {account["name"]: account for account in pool.list_accounts()}
    existing = set(existing_accounts)
    deleted = []
    failed = []
    for name in names:
        if not NAME_RE.match(name):
            failed.append({"name": name, "error": "invalid account name"})
            continue
        if name not in existing:
            failed.append({"name": name, "error": "account not found"})
            continue
        add_job = JOBS.get(name, {})
        if add_job.get("status") in {"queued", "running"}:
            failed.append({"name": name, "email": existing_accounts[name].get("email", ""), "error": "account login is queued or running"})
            continue
        if name in OPEN_PROFILE_SESSIONS:
            failed.append({"name": name, "email": existing_accounts[name].get("email", ""), "error": "profile Chromium đang mở; hãy đóng profile trước"})
            continue
        try:
            # Remove the encrypted credential before deleting the profile so
            # a failed profile removal can never leave a reusable secret
            # behind for an account that is no longer visible.
            credential_store.delete(name)
            pool.delete_account(name)
            JOBS.pop(name, None)
            deleted.append(name)
        except CredentialStoreError:
            failed.append({"name": name, "email": existing_accounts[name].get("email", ""), "error": "Không thể xoá thông tin đăng nhập đã mã hoá"})
        except RuntimeError as exc:
            failed.append({"name": name, "email": existing_accounts[name].get("email", ""), "error": str(exc)})

    return {
        "ok": True,
        "deleted": deleted,
        "failed": failed,
        "summary": {"requested": len(names), "deleted": len(deleted), "failed": len(failed)},
    }


@app.post("/api/admin/accounts/bulk-login", status_code=202)
async def admin_accounts_bulk_login(body: AccountBulkLogin,
                                    x_admin_key: str | None = Header(default=None)):
    """Adds/relogs profiles and saves their credentials in the encrypted vault.

    Existing profiles are authenticated in a temporary staging profile and are
    replaced only after OAuth succeeds. Passwords and TOTP values are never
    returned to the dashboard; they are encrypted at rest for later relogin.
    """
    _admin_auth(x_admin_key)

    existing_accounts = {account["name"]: account for account in pool.list_accounts()}
    existing_by_email = {
        account["email"].strip().lower(): account
        for account in existing_accounts.values()
        if account.get("email", "").strip()
    }
    results = []
    seen_emails = set()

    for item in body.accounts:
        email = item.email.strip()
        identity = email.lower()
        password = item.password
        totp_secret = item.totp.strip()
        error = ""
        if identity in seen_emails:
            error = "Tài khoản bị lặp trong danh sách"
        else:
            seen_emails.add(identity)
        if not error and not re.match(r"^\S+@\S+\.\S+$", email):
            error = "invalid Google email"
        elif not error and not password:
            error = "Google password is required"

        current = existing_by_email.get(identity)
        if current is None and email:
            current = existing_accounts.get(_generated_profile_name(email))
        name = current["name"] if current else (_generated_profile_name(email) if email else "")
        credentials_only = False

        if not error and current is not None:
            await _cancel_profile_sync_for_login(name)
            current_job = JOBS.get(name, {})
            if current_job.get("status") in {"queued", "running"}:
                error = "account login is queued or running"
            elif name in OPEN_PROFILE_SESSIONS:
                error = "profile Chromium đang mở; hãy đóng profile trước"
            elif current.get("login_ok") == 1:
                # An already healthy profile does not need a second OAuth
                # window just to remember its credentials. Save-only keeps
                # the current session untouched and enables future relogin.
                credentials_only = True
            elif current.get("busy"):
                error = "account is generating video, please relogin later"
        elif not error:
            current_job = JOBS.get(name, {})
            if current_job.get("status") in {"queued", "running"}:
                error = "account login is queued or running"

        if error:
            results.append({"name": name, "email": email, "status": "failed", "error": error})
            continue

        staged_profile_dir = None
        try:
            credential_store.save(name, email, password, totp_secret)
            if credentials_only:
                results.append({
                    "name": name,
                    "email": email,
                    "status": "accepted",
                    "job": "saved",
                    "mode": "credentials-only",
                    "credentials_saved": True,
                })
                continue
            if current is not None:
                # Keep the existing session recoverable until the new OAuth
                # flow completes successfully.
                pool.accounts_dir.mkdir(parents=True, exist_ok=True)
                staged_profile_dir = Path(tempfile.mkdtemp(
                    prefix=f".relogin-{name}-", dir=pool.accounts_dir
                ))
                pool.set_scheduling(name, False)

            job_kind = "relogin" if current is not None else "add"
            login_job = _new_login_job(job_kind)
            JOBS[name] = login_job
            _start_login_job(name, _run_add_job(
                name,
                email,
                password,
                totp_secret,
                staged_profile_dir=staged_profile_dir,
            ), job_id=login_job["id"])
            print(
                f"[admin] Login queued name={name} email={email} kind={job_kind}",
                flush=True,
            )
            results.append({
                "name": name,
                "email": email,
                "status": "accepted",
                "job": "queued",
                "mode": "relogin" if current is not None else "add",
            })
        except Exception as exc:
            if staged_profile_dir is not None and staged_profile_dir.exists():
                shutil.rmtree(staged_profile_dir, ignore_errors=True)
            results.append({
                "name": name,
                "email": email,
                "status": "failed",
                "error": str(exc)[:300],
            })

    accepted = sum(1 for result in results if result["status"] == "accepted")
    return {
        "ok": True,
        "summary": {
            "total": len(body.accounts),
            "accepted": accepted,
            "failed": len(body.accounts) - accepted,
        },
        "results": results,
        "login_interval_sec": config.LOGIN_INTERVAL_SEC,
    }


@app.post("/api/admin/accounts/bulk-relogin", status_code=202)
async def admin_accounts_bulk_relogin(body: AccountBulkRelogin,
                                      x_admin_key: str | None = Header(default=None)):
    """Queues relogin jobs for selected inactive profiles.

    Prefer the encrypted credentials saved when the profile was added. Legacy
    profiles without saved credentials keep the previous session-based flow so
    they remain usable without forcing a destructive migration. The explicit
    ``gmail-session`` mode always uses the existing persistent profile and its
    already signed-in Google session.
    """
    _admin_auth(x_admin_key)

    relogin_mode = str(body.mode or "saved-credentials").strip().lower()
    if relogin_mode not in {"saved-credentials", "gmail-session"}:
        raise HTTPException(422, "mode phải là saved-credentials hoặc gmail-session")

    existing_accounts = {account["name"]: account for account in pool.list_accounts()}
    results = []
    seen_names = set()
    names = []
    for raw_name in body.names:
        name = str(raw_name).strip()
        if name not in seen_names:
            seen_names.add(name)
            names.append(name)

    for name in names:
        current = existing_accounts.get(name)
        credentials = None
        if relogin_mode == "saved-credentials":
            try:
                credentials = credential_store.get(name) if current is not None else None
            except CredentialStoreError:
                results.append({
                    "name": name,
                    "email": (current or {}).get("email", ""),
                    "status": "failed",
                    "error": "Không thể đọc thông tin đăng nhập đã mã hoá",
                })
                continue

        has_saved_credentials = credentials is not None
        email = (credentials or {}).get("email") or (current or {}).get("email", "")
        error = ""

        if not name or not NAME_RE.match(name):
            error = "invalid account name"
        elif name not in existing_accounts:
            error = "account not found"

        if not error and current is not None:
            await _cancel_profile_sync_for_login(name)
            current_job = JOBS.get(name, {})
            risk_control = current.get("cooldown_reason") == "risk_control"
            if current_job.get("status") in {"queued", "running"}:
                error = "account login is queued or running"
            elif name in OPEN_PROFILE_SESSIONS:
                error = "profile Chromium đang mở; hãy đóng profile trước"
            elif current.get("login_ok") == 1 and not (relogin_mode == "gmail-session" and risk_control):
                error = "account is active; verify it before relogin"
            elif current.get("busy"):
                error = "account is generating video, please relogin later"

        if error:
            results.append({
                "name": name,
                "email": email,
                "status": "failed",
                "credentials_saved": has_saved_credentials,
                "error": error,
            })
            continue

        staged_profile_dir = None
        try:
            pool.set_scheduling(name, False)
            if has_saved_credentials and relogin_mode == "saved-credentials":
                # Keep the old browser session until the fresh credential
                # login succeeds, matching the safe replacement path used by
                # bulk-login.
                pool.accounts_dir.mkdir(parents=True, exist_ok=True)
                staged_profile_dir = Path(tempfile.mkdtemp(
                    prefix=f".relogin-{name}-", dir=pool.accounts_dir
                ))
                login_job = _new_login_job("relogin")
                JOBS[name] = login_job
                _start_login_job(name, _run_add_job(
                    name,
                    credentials["email"],
                    credentials["password"],
                    credentials.get("totp", ""),
                    staged_profile_dir=staged_profile_dir,
                ), job_id=login_job["id"])
                mode = "saved-credentials"
            else:
                login_job = _new_login_job("relogin-existing")
                JOBS[name] = login_job
                _start_login_job(
                    name,
                    _run_existing_relogin_job(name, email),
                    job_id=login_job["id"],
                )
                mode = "gmail-session" if relogin_mode == "gmail-session" else "saved-session"
            print(
                f"[admin] Login queued name={name} email={email} kind={login_job['kind']} mode={mode}",
                flush=True,
            )
            results.append({
                "name": name,
                "email": email,
                "status": "accepted",
                "job": "queued",
                "mode": mode,
                "credentials_saved": has_saved_credentials,
            })
        except Exception as exc:
            if staged_profile_dir is not None and staged_profile_dir.exists():
                shutil.rmtree(staged_profile_dir, ignore_errors=True)
            results.append({
                "name": name,
                "email": email,
                "status": "failed",
                "credentials_saved": has_saved_credentials,
                "error": str(exc)[:300],
            })

    accepted = sum(1 for item in results if item["status"] == "accepted")
    return {
        "ok": True,
        "summary": {"total": len(names), "accepted": accepted, "failed": len(names) - accepted},
        "results": results,
        "login_interval_sec": config.LOGIN_INTERVAL_SEC,
    }


@app.patch("/api/admin/accounts/{name}")
async def admin_account_patch(name: str, body: AccountPatch,
                              x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    if name not in pool.accounts:
        raise HTTPException(404, "account not found")
    add_job = JOBS.get(name, {})
    if add_job.get("status") in {"queued", "running"}:
        raise HTTPException(409, "account login is queued or running")
    if body.scheduling is not None:
        pool.set_scheduling(name, body.scheduling, manual=True)
    if body.note is not None:
        pool.set_note(name, body.note)
    if body.email is not None:
        pool.set_email(name, body.email)
    if body.proxy_id is not None:
        proxy_id = str(body.proxy_id or "").strip() or None
        try:
            pool.set_proxy(name, proxy_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    return {"ok": True}


@app.delete("/api/admin/accounts/{name}")
async def admin_account_delete(name: str, x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    if name not in pool.accounts:
        raise HTTPException(404, "account not found")
    add_job = JOBS.get(name, {})
    if add_job.get("status") in {"queued", "running"}:
        raise HTTPException(409, "account login is queued or running")
    if name in OPEN_PROFILE_SESSIONS:
        raise HTTPException(409, "profile Chromium đang mở; hãy đóng profile trước")
    try:
        credential_store.delete(name)
        pool.delete_account(name)
        JOBS.pop(name, None)
    except CredentialStoreError as exc:
        raise HTTPException(503, "Không thể xoá thông tin đăng nhập đã mã hoá") from exc
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


@app.post("/api/admin/accounts/{name}/verify")
async def admin_account_verify(name: str, x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    add_job = JOBS.get(name, {})
    if add_job.get("status") in {"queued", "running"}:
        raise HTTPException(409, "account login is queued or running")
    if name in OPEN_PROFILE_SESSIONS:
        raise HTTPException(409, "profile Chromium đang mở; hãy đóng profile trước khi kiểm tra")
    try:
        ok = await pool.verify_account(name)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    if add_job.get("kind") == "profile-sync" and add_job.get("status") == "paused" and JOBS.get(name) is add_job:
        JOBS.pop(name, None)
    return {"ok": ok}


@app.post("/api/admin/accounts/{name}/open-profile")
async def admin_account_open_profile(name: str, x_admin_key: str | None = Header(default=None)):
    """Opens a persistent account profile for an admin to inspect manually."""
    _admin_auth(x_admin_key)
    if not NAME_RE.match(name):
        raise HTTPException(400, "invalid account name")
    if name not in pool.accounts:
        raise HTTPException(404, "account not found")
    try:
        result = await _open_account_profile(name)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(503, f"Không mở được profile Chromium: {str(exc)[:240]}")
    return {
        "ok": True,
        "name": name,
        "message": "Profile Chromium đã mở trên máy chạy Gateway",
        **result,
    }


@app.delete("/api/admin/accounts/{name}/open-profile")
async def admin_account_close_profile(name: str, x_admin_key: str | None = Header(default=None)):
    """Closes an interactive profile and releases it back to the render pool."""
    _admin_auth(x_admin_key)
    if not NAME_RE.match(name):
        raise HTTPException(400, "invalid account name")
    if name not in pool.accounts:
        raise HTTPException(404, "account not found")
    # Session verification can launch a fresh Chromium context and retry for
    # several minutes. Start it in the background so this API request only
    # waits for the visible browser to close.
    closed, login_ok = await _close_open_profile(name, wait_for_verify=False)
    return {"ok": True, "name": name, "closed": closed, "login_ok": login_ok}


async def _check_profile_auth_after_login(name: str, profile_dir: Path | None = None,
                                          proxy: dict | None = None) -> bool:
    """Verify a completed login from the persisted Dola session/page state."""
    selected_proxy = (
        proxy
        if proxy is not None
        else await asyncio.to_thread(pool.proxy_for_account, name)
    )
    state = await check_login_state_details(
        name,
        profile_dir=profile_dir,
        proxy=selected_proxy,
        timeout_sec=config.LOGIN_PERSISTENCE_VERIFY_TIMEOUT_SEC,
    )
    if state.get("ok"):
        pool.mark_session_verified(name, enable_scheduling=True)
        return True
    if state.get("risk_control"):
        pool._mark_risk_control(
            name,
            "post-login session verification saw a Dola login wall with a valid cookie",
        )
    detail = str(state.get("error") or "Dola chưa xác nhận session sau đăng nhập")
    raise RuntimeError(detail)


async def _run_add_job(name: str, email: str, password: str, totp: str,
                       staged_profile_dir: Path | None = None):
    global ACCOUNT_ADD_LAST_FINISHED

    staged = staged_profile_dir is not None
    profile_dir = Path(staged_profile_dir) if staged else pool.accounts_dir / name
    previous_account = next(
        (item for item in pool.list_accounts() if item.get("name") == name),
        None,
    ) if staged else None
    initial_job = dict(JOBS.get(name, {}))
    job_id = initial_job.get("id") or uuid.uuid4().hex
    if initial_job.get("id") and JOBS.get(name, {}).get("id") != job_id:
        print(f"[admin] Ignoring stale login worker name={name}", flush=True)
        return
    job_kind = initial_job.get("kind") or "add"
    queued_at = initial_job.get("queued_at") or time.time()
    JOBS[name] = {
        **initial_job,
        "kind": job_kind,
        "id": job_id,
        "status": "queued",
        "error": "",
        "queued_at": queued_at,
        "started_at": 0,
        "finished_at": 0,
    }
    print(
        f"[admin] Login worker started name={name} kind={job_kind} id={job_id}",
        flush=True,
    )

    # Reserve the profile directory while it is waiting, but keep it out of
    # video scheduling until the OAuth flow has completed successfully. A
    # relogin uses a hidden staging directory so the old session can be kept
    # until the new OAuth flow succeeds.
    try:
        profile_dir.mkdir(parents=True, exist_ok=True)
        if not staged:
            # Keep the non-secret identifier visible while the login is queued
            # or running. Passwords and TOTP secrets are never persisted here.
            pool.set_email(name, email)
        pool.set_scheduling(name, False)
    except Exception as e:
        _update_job_if_current(
            name,
            job_id,
            status="failed",
            error=str(e)[:300],
            finished_at=time.time(),
        )
        if staged and profile_dir.exists():
            shutil.rmtree(profile_dir, ignore_errors=True)
        return

    try:
        async with ACCOUNT_ADD_LOCK:
            wait_seconds = max(
                0.0,
                ACCOUNT_ADD_LAST_FINISHED + config.LOGIN_INTERVAL_SEC - time.monotonic(),
            )
            if wait_seconds > 0:
                if not _update_job_if_current(
                    name,
                    job_id,
                    status="queued",
                    wait_seconds=int(wait_seconds + 0.999),
                    scheduled_at=time.time() + wait_seconds,
                ):
                    return
                await asyncio.sleep(wait_seconds)

            started_at = time.time()
            if not _update_job_if_current(
                name,
                job_id,
                status="running",
                started_at=started_at,
                wait_seconds=0,
                scheduled_at=started_at,
            ):
                return
            try:
                await add_account_flow(
                    name,
                    email,
                    password,
                    totp,
                    profile_dir=profile_dir,
                    proxy=await asyncio.to_thread(pool.proxy_for_account, name),
                )
                # add_account_flow returns after the OAuth callback, but the
                # persistent profile may still be flushing cookies while its
                # headed context is closing. Verify the actual profile before
                # installing a staged replacement or marking a new account
                # active; otherwise the next render can immediately see Dola
                # logged out even though the login job reported success.
                if not await _check_profile_auth_after_login(
                    name,
                    profile_dir=profile_dir,
                    proxy=await asyncio.to_thread(pool.proxy_for_account, name),
                ):
                    raise RuntimeError(
                        "Google login completed but a fresh Chromium check "
                        "still shows Dola logged out"
                    )
                if staged:
                    await pool.replace_account_profile(name, profile_dir)
                    # The staged directory was just verified in a fresh
                    # persistent context. Renaming that exact directory does
                    # not change its cookies; avoid a second immediate launch
                    # which can race Chromium's profile lock and make a valid
                    # login look expired again.
                pool.set_email(name, email)
                pool.set_login_status(name, True)
                pool.set_scheduling(name, True)
                _update_job_if_current(
                    name,
                    job_id,
                    status="success",
                    finished_at=time.time(),
                )
            except Exception as e:
                if staged and previous_account is not None:
                    # A staged relogin must never make the last known profile
                    # less usable when the replacement credentials fail. The
                    # original profile was intentionally kept untouched.
                    previous_login_ok = previous_account.get("login_ok")
                    if previous_login_ok is not None:
                        pool.set_login_status(name, previous_login_ok == 1)
                    pool.set_scheduling(name, bool(previous_account.get("scheduling")))
                else:
                    pool.set_login_status(name, False)
                    pool.set_scheduling(name, False)
                _update_job_if_current(
                    name,
                    job_id,
                    status="failed",
                    error=str(e)[:300],
                    finished_at=time.time(),
                )
                print(
                    f"[admin] Login failed name={name} kind={job_kind}: "
                    f"{type(e).__name__}: {str(e)[:260]}",
                    flush=True,
                )
            finally:
                # The login interval is measured from the end of the previous
                # interactive flow, so two Google windows never overlap.
                ACCOUNT_ADD_LAST_FINISHED = time.monotonic()
    finally:
        if staged and profile_dir.exists():
            shutil.rmtree(profile_dir, ignore_errors=True)


async def _run_existing_relogin_job(name: str, email: str):
    """Reauthenticate Dola without replacing the existing Chromium profile."""
    global ACCOUNT_ADD_LAST_FINISHED

    initial_job = dict(JOBS.get(name, {}))
    job_id = initial_job.get("id") or uuid.uuid4().hex
    if initial_job.get("id") and JOBS.get(name, {}).get("id") != job_id:
        print(f"[admin] Ignoring stale relogin worker name={name}", flush=True)
        return
    queued_at = initial_job.get("queued_at") or time.time()
    JOBS[name] = {
        **initial_job,
        "kind": "relogin-existing",
        "id": job_id,
        "status": "queued",
        "error": "",
        "queued_at": queued_at,
        "started_at": 0,
        "finished_at": 0,
    }
    print(
        f"[admin] Login worker started name={name} kind=relogin-existing id={job_id}",
        flush=True,
    )

    try:
        async with ACCOUNT_ADD_LOCK:
            wait_seconds = max(
                0.0,
                ACCOUNT_ADD_LAST_FINISHED + config.LOGIN_INTERVAL_SEC - time.monotonic(),
            )
            if wait_seconds > 0:
                if not _update_job_if_current(
                    name,
                    job_id,
                    status="queued",
                    wait_seconds=int(wait_seconds + 0.999),
                    scheduled_at=time.time() + wait_seconds,
                ):
                    return
                await asyncio.sleep(wait_seconds)

            started_at = time.time()
            if not _update_job_if_current(
                name,
                job_id,
                status="running",
                started_at=started_at,
                wait_seconds=0,
                scheduled_at=started_at,
            ):
                return
            try:
                # The same lock is used by the render pool.  This prevents a
                # render from opening the profile while the visible relogin
                # flow is using it.
                async with pool.account_lock(name):
                    relogin_result = await relogin_existing_account_flow(
                        name, email, proxy=await asyncio.to_thread(pool.proxy_for_account, name)
                    )
                    if not relogin_result:
                        raise RuntimeError("profile relogin did not restore a Dola session")
                # Verify after the headed context has closed.  This catches
                # OAuth callbacks that briefly look valid before Chromium
                # persists the new Dola cookies to the profile directory.
                if not await _check_profile_auth_after_login(name):
                    raise RuntimeError(
                        "Dola relogin completed but a fresh Chromium check "
                        "still shows the profile logged out"
                    )
                if email:
                    pool.set_email(name, email)
                pool.set_login_status(name, True)
                pool.set_scheduling(name, True)
                _update_job_if_current(
                    name,
                    job_id,
                    status="success",
                    finished_at=time.time(),
                )
            except Exception as exc:
                pool.set_login_status(name, False)
                pool.set_scheduling(name, False)
                _update_job_if_current(
                    name,
                    job_id,
                    status="failed",
                    error=str(exc)[:300],
                    finished_at=time.time(),
                )
                print(
                    f"[admin] Login failed name={name} kind=relogin-existing: "
                    f"{type(exc).__name__}: {str(exc)[:260]}",
                    flush=True,
                )
            finally:
                ACCOUNT_ADD_LAST_FINISHED = time.monotonic()
    except asyncio.CancelledError:
        raise


@app.post("/api/admin/accounts/manual-profile", status_code=201)
async def admin_account_create_manual_profile(
    body: ManualProfileCreate,
    x_admin_key: str | None = Header(default=None),
):
    """Create an isolated, unverified profile for a user-led browser login."""
    _admin_auth(x_admin_key)
    name = str(body.name or "").strip()
    if not name:
        name = f"manual-{time.strftime('%Y%m%d')}-{uuid.uuid4().hex[:8]}"
    if not NAME_RE.fullmatch(name):
        raise HTTPException(422, "Tên profile chỉ được gồm 1–32 ký tự A–Z, a–z, 0–9, gạch ngang hoặc gạch dưới")
    if any(
        existing.casefold() == name.casefold()
        and job.get("status") in {"queued", "running"}
        for existing, job in JOBS.items()
    ):
        raise HTTPException(409, "account login is queued or running")
    if any(existing.casefold() == name.casefold() for existing in OPEN_PROFILE_SESSIONS):
        raise HTTPException(409, "profile Chromium đang mở")
    if any(existing.casefold() == name.casefold() for existing in pool.accounts):
        raise HTTPException(409, "profile already exists")

    try:
        pool.accounts_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise HTTPException(503, f"Không tạo được thư mục tài khoản: {str(exc)[:180]}") from exc
    profile_dir = pool.accounts_dir / name
    try:
        # Write the unverified state before making the new directory visible
        # to account discovery and render workers.
        pool.mark_manual_profile_unverified(name)
    except Exception as exc:
        raise HTTPException(503, "Không thể lưu trạng thái profile trong Gateway") from exc

    try:
        profile_dir.mkdir()
    except FileExistsError as exc:
        raise HTTPException(409, "profile already exists") from exc
    except OSError as exc:
        raise HTTPException(503, f"Không tạo được thư mục profile: {str(exc)[:180]}") from exc
    return {"ok": True, "name": name, "login_required": True}


@app.post("/api/admin/accounts", status_code=202)
async def admin_account_add(body: AccountAdd, x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    email = body.email.strip()
    if not re.match(r"^\S+@\S+\.\S+$", email):
        raise HTTPException(422, "invalid Google email")
    if not body.password:
        raise HTTPException(422, "Google password is required")

    requested_name = (body.name or "").strip()
    name = requested_name or _generated_profile_name(email)
    if not NAME_RE.match(name):
        raise HTTPException(400, "invalid account name")
    if name in pool.accounts:
        raise HTTPException(409, "account exists")
    if not requested_name:
        existing = next(
            (account for account in pool.list_accounts()
             if account.get("email", "").strip().lower() == email.lower()),
            None,
        )
        if existing:
            raise HTTPException(409, "account already exists for this email")

    await _cancel_profile_sync_for_login(name)
    existing_job = JOBS.get(name, {})
    if existing_job.get("status") in {"queued", "running"}:
        raise HTTPException(409, "add job queued or running")
    try:
        credential_store.save(name, email, body.password, body.totp.strip())
    except CredentialStoreError as exc:
        raise HTTPException(503, "Không thể lưu thông tin đăng nhập an toàn trên Gateway") from exc
    login_job = _new_login_job("add")
    JOBS[name] = login_job
    _start_login_job(
        name,
        _run_add_job(name, email, body.password, body.totp.strip()),
        job_id=login_job["id"],
    )
    print(
        f"[admin] Login queued name={name} email={email} kind=add",
        flush=True,
    )
    return {
        "ok": True,
        "name": name,
        "job": "queued",
        "login_interval_sec": config.LOGIN_INTERVAL_SEC,
    }


@app.post("/api/admin/accounts/{name}/relogin", status_code=202)
async def admin_account_relogin(name: str, body: AccountRelogin,
                                x_admin_key: str | None = Header(default=None)):
    """Replace a failed/expired profile and queue a fresh Google OAuth flow."""
    _admin_auth(x_admin_key)
    if not NAME_RE.match(name):
        raise HTTPException(400, "invalid account name")
    if name not in pool.accounts:
        raise HTTPException(404, "account not found")
    await _cancel_profile_sync_for_login(name)
    existing_job = JOBS.get(name, {})
    if existing_job.get("status") in {"queued", "running"}:
        raise HTTPException(409, "account login is queued or running")

    requested_email = str(body.email or "").strip()
    requested_password = str(body.password or "")
    requested_totp = str(body.totp or "").strip()
    has_requested_credentials = bool(requested_email or requested_password or requested_totp)
    credentials = None
    if has_requested_credentials:
        if not requested_email or not requested_password:
            raise HTTPException(422, "Cần nhập cả email và mật khẩu Google để cập nhật thông tin đăng nhập")
        email = requested_email
        password = requested_password
        totp_secret = requested_totp
    else:
        try:
            credentials = credential_store.get(name)
        except CredentialStoreError as exc:
            raise HTTPException(503, "Không thể đọc thông tin đăng nhập đã mã hoá") from exc
        if credentials is None:
            raise HTTPException(422, "Profile chưa có thông tin đăng nhập đã lưu; hãy gửi email và mật khẩu một lần")
        email = credentials["email"]
        password = credentials["password"]
        totp_secret = credentials.get("totp", "")

    if not re.match(r"^\S+@\S+\.\S+$", email):
        raise HTTPException(422, "invalid Google email")
    if not password:
        raise HTTPException(422, "Google password is required")

    # Avoid replacing a profile that is still healthy. A failed verify marks
    # login_ok=0, which is the explicit signal used by the UI's relogin button.
    if name in OPEN_PROFILE_SESSIONS:
        raise HTTPException(409, "profile Chromium đang mở; hãy đóng profile trước khi đăng nhập lại")
    current = next((item for item in pool.list_accounts() if item["name"] == name), None)
    if current and current["login_ok"] == 1:
        raise HTTPException(409, "account is active; verify it before relogin")
    if current and current["busy"]:
        raise HTTPException(409, "account is generating video, please relogin later")

    if has_requested_credentials:
        try:
            credential_store.save(name, email, password, totp_secret)
        except CredentialStoreError as exc:
            raise HTTPException(503, "Không thể lưu thông tin đăng nhập an toàn trên Gateway") from exc

    # Keep the old profile until the new OAuth session is completely valid.
    # Hidden staging directories are ignored by account discovery.
    pool.accounts_dir.mkdir(parents=True, exist_ok=True)
    staged_profile_dir = Path(tempfile.mkdtemp(
        prefix=f".relogin-{name}-", dir=pool.accounts_dir
    ))
    pool.set_scheduling(name, False)

    login_job = _new_login_job("add")
    JOBS[name] = login_job
    _start_login_job(name, _run_add_job(
        name,
        email,
        password,
        totp_secret,
        staged_profile_dir=staged_profile_dir,
    ), job_id=login_job["id"])
    print(
        f"[admin] Login queued name={name} email={email} kind=add",
        flush=True,
    )
    return {"ok": True, "job": "queued", "login_interval_sec": config.LOGIN_INTERVAL_SEC}


@app.post("/api/admin/accounts/{name}/relogin-session", status_code=202)
async def admin_account_relogin_session(name: str,
                                        x_admin_key: str | None = Header(default=None)):
    """Queue a Dola relogin through the Google session in the existing profile."""
    _admin_auth(x_admin_key)
    if not NAME_RE.match(name):
        raise HTTPException(400, "invalid account name")
    if name not in pool.accounts:
        raise HTTPException(404, "account not found")

    await _cancel_profile_sync_for_login(name)
    existing_job = JOBS.get(name, {})
    if existing_job.get("status") in {"queued", "running"}:
        raise HTTPException(409, "account login is queued or running")
    if name in OPEN_PROFILE_SESSIONS:
        raise HTTPException(409, "profile Chromium đang mở; hãy đóng profile trước khi đăng nhập lại")

    current = next((item for item in pool.list_accounts() if item["name"] == name), None)
    if current is None:
        raise HTTPException(404, "account not found")
    risk_control = current.get("cooldown_reason") == "risk_control"
    if current.get("login_ok") == 1 and not risk_control:
        raise HTTPException(409, "account is active; verify it before relogin")
    if current.get("busy"):
        raise HTTPException(409, "account is generating video, please relogin later")

    # This path deliberately does not read or replace the encrypted password.
    # It opens the existing persistent profile so an already authenticated
    # Gmail account can complete Dola's OAuth flow in place.
    pool.set_scheduling(name, False)
    login_job = _new_login_job("relogin-existing")
    JOBS[name] = login_job
    _start_login_job(
        name,
        _run_existing_relogin_job(name, current.get("email", "")),
        job_id=login_job["id"],
    )
    print(
        f"[admin] Login queued name={name} email={current.get('email', '')} kind=relogin-existing",
        flush=True,
    )
    return {
        "ok": True,
        "job": "queued",
        "mode": "gmail-session",
        "login_interval_sec": config.LOGIN_INTERVAL_SEC,
    }


@app.post("/api/admin/accounts/{name}/pause-login")
async def pause_account_login(name: str, x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    job = JOBS.get(name, {})
    if job.get("kind") == "profile-sync" or not job:
        raise HTTPException(409, "Profile không có tác vụ đăng nhập")
    if job.get("status") == "paused":
        return {"ok": True, "status": "paused"}
    if job.get("status") not in {"queued", "running"}:
        raise HTTPException(409, "Tác vụ đăng nhập đã kết thúc")
    task = LOGIN_TASKS.get(name)
    if task is None or task.done():
        raise HTTPException(409, "Tác vụ đã kết thúc; hãy tải lại danh sách")
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    pool.set_scheduling(name, False)
    JOBS[name] = {**JOBS.get(name, job), "status": "paused", "error": "", "finished_at": time.time()}
    return {"ok": True, "status": "paused"}


@app.post("/api/admin/accounts/{name}/pause-sync")
async def pause_profile_sync(name: str, x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    job = JOBS.get(name, {})
    if job.get("kind") != "profile-sync":
        raise HTTPException(409, "Profile không có tác vụ đồng bộ session")
    if job.get("status") == "paused":
        return {"ok": True, "status": "paused"}
    if job.get("status") not in {"queued", "running"}:
        raise HTTPException(409, "Đồng bộ session đã kết thúc")
    task = PROFILE_SYNC_TASKS.get(name)
    if task is not None and not task.done():
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    if JOBS.get(name, {}).get("id") != job.get("id"):
        raise HTTPException(409, "Tác vụ đồng bộ đã thay đổi; hãy tải lại")
    JOBS[name] = {**job, "status": "paused", "finished_at": time.time(), "error": ""}
    return {"ok": True, "status": "paused"}


@app.get("/api/admin/jobs")
async def admin_jobs(x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    open_profiles = {
        name: {
            "opened_at": session["opened_at"],
            "extension_loaded": session["extension_loaded"],
        }
        for name, session in OPEN_PROFILE_SESSIONS.items()
        if not session.get("cleaned")
    }
    return {"jobs": JOBS, "open_profiles": open_profiles}


@app.get("/api/admin/tasks")
async def admin_tasks(
    limit: int = 50,
    offset: int = 0,
    owner_id: str | None = None,
    include_owners: bool = False,
    x_admin_key: str | None = Header(default=None),
):
    _admin_auth(x_admin_key)
    selected_owner_id = _normalize_owner_id(owner_id)
    page_limit = min(max(limit, 1), 500)
    page_offset = max(offset, 0)
    tasks = store.recent_queue_tasks(
        page_limit,
        owner_id=selected_owner_id,
        offset=page_offset,
    )
    total = store.count_tasks(owner_id=selected_owner_id)
    result = {
        "tasks": tasks,
        "total": total,
        "limit": page_limit,
        "offset": page_offset,
        "has_more": page_offset + len(tasks) < total,
    }
    if include_owners:
        result["owners"] = store.task_owner_summaries()
    return result


@app.get("/api/admin/tasks/status")
async def admin_tasks_status(ids: str = "", x_admin_key: str | None = Header(default=None)):
    """Return selected task states for the admin queue poller."""
    _admin_auth(x_admin_key)
    task_ids = []
    seen = set()
    for raw_id in str(ids or "").split(","):
        task_id = raw_id.strip()
        if not task_id or task_id in seen:
            continue
        seen.add(task_id)
        task_ids.append(task_id)
    if not task_ids:
        raise HTTPException(422, "ids must contain at least one task id")
    if len(task_ids) > 100:
        raise HTTPException(422, "A maximum of 100 task ids can be queried at once")
    return {
        "tasks": [
            _task_status_response(row)
            for task_id in task_ids
            if (row := store.get(task_id))
        ]
    }


@app.post("/api/admin/tasks/{task_id}/retry-no-video")
async def admin_retry_no_video(
    task_id: str,
    body: AdminNoVideoRetryRequest,
    x_admin_key: str | None = Header(default=None),
):
    """Stop an accepted no-video conversation and retry it on another profile."""
    _admin_auth(x_admin_key)
    response_error = _terminal_provider_response_error(body.response)
    if not isinstance(response_error, CannotAnswerQuestionError):
        raise HTTPException(
            422,
            "Dola response is not a generic no-video reply; use its classified error path.",
        )

    row = store.get(task_id)
    if not row:
        raise HTTPException(404, "task not found")
    if row.get("video_url"):
        raise HTTPException(409, "Task already has a video")
    if row.get("status") in {"submitting", "processing"}:
        if not row.get("account") or not row.get("conversation_id"):
            raise HTTPException(409, "Task has no accepted Dola conversation to replace")
        await _cancel_video_runtime(task_id)
        row = store.get(task_id)
    if row.get("status") not in {"submitting", "processing", "cancelled"}:
        raise HTTPException(409, f"Task is {row.get('status')}; cannot rotate its profile")
    if not row.get("account") or not row.get("conversation_id"):
        raise HTTPException(409, "Task has no accepted Dola conversation to replace")
    if task_id in VIDEO_CANCELLED_TASKS:
        raise HTTPException(409, "The existing worker is still stopping; retry this action shortly")

    # Cancellation preserves task history. Restore the live state just long
    # enough for the guarded retry scheduler to atomically bind a new attempt.
    store.update(
        task_id,
        status="processing",
        error=None,
        failure_code=None,
        finished_at=None,
    )
    row = store.get(task_id)
    if not _schedule_cannot_answer_retry(row, body.response):
        current = store.get(task_id)
        if (
            current
            and current.get("status") in {"submitting", "processing"}
            and current.get("account") == row.get("account")
            and current.get("conversation_id") == row.get("conversation_id")
        ):
            stop_reason = (
                _decode_task_timings(current.get("timings_json")) or {}
            ).get("cannot_answer_retry_stop_reason")
            error = (
                "Dola không tạo video và hiện không còn profile khả dụng khác để thử."
                if stop_reason == "no_untried_profiles"
                else "Dola không tạo video; đã hết lượt thử tự động an toàn."
            )
            store.update(
                task_id,
                status="failed",
                error=error,
                failure_code="PROVIDER_NO_VIDEO",
                finished_at=time.time(),
            )
        return _task_response(store.get(task_id))
    return _task_response(store.get(task_id))


def _local_video_path(video_url: str | None) -> Path | None:
    """Resolve a gateway-owned /videos/<file> URL within DOWNLOAD_DIR."""
    raw_url = str(video_url or "").strip()
    if not raw_url:
        return None
    try:
        path = unquote(urlparse(raw_url).path or "")
    except Exception:
        return None
    marker = "/videos/"
    if marker not in path:
        return None
    relative = path.split(marker, 1)[1].strip("/")
    # Generated files are always a single basename. Reject nested paths so a
    # malformed database row can never escape the configured download folder.
    if not relative or "/" in relative or "\\" in relative:
        return None
    root = Path(config.DOWNLOAD_DIR).resolve()
    candidate = (root / relative).resolve()
    if candidate.parent != root:
        return None
    return candidate


async def _bulk_delete_tasks(ids: list[str], owner_id=None):
    """Cancel local runtimes and remove task rows within an optional owner scope."""
    rows_by_id = {
        row["id"]: row
        for row in store.tasks_by_ids(ids, owner_id=owner_id)
    }
    existing_ids = []
    skipped = []
    for task_id in ids:
        row = rows_by_id.get(task_id)
        if row is None:
            skipped.append({"id": task_id, "error": "task not found"})
            continue
        existing_ids.append(task_id)

    active_ids = [
        task_id for task_id in existing_ids
        if rows_by_id[task_id].get("status") in ACTIVE_VIDEO_STATUSES
    ]
    cancelled_rows = store.cancel_tasks(active_ids)
    cancelled_ids = [row["id"] for row in cancelled_rows]
    if active_ids:
        # Cancel all requested active runtimes before deleting their rows. This
        # closes the local Playwright context/profile and prevents a delayed
        # poll window from recovering the task again after a restart.
        await asyncio.gather(*(_cancel_video_runtime(task_id) for task_id in active_ids))

    # The active status was changed to `cancelled` above. Delete without a
    # status exclusion so a fast task that completed during cancellation is
    # removed as the operator requested as well.
    removed_rows = store.delete_tasks(existing_ids)
    removed_ids = {row["id"] for row in removed_rows}
    for task_id in existing_ids:
        if task_id not in removed_ids:
            latest = next(
                (row for row in store.tasks_by_ids([task_id], owner_id=owner_id)),
                None,
            )
            skipped.append({
                "id": task_id,
                "error": "task not found" if latest is None else "task could not be removed",
            })

    deleted_files = []
    file_errors = []
    for row in removed_rows:
        path = _local_video_path(row.get("video_url"))
        if path is None or not path.exists():
            continue
        try:
            path.unlink()
            deleted_files.append(row["id"])
        except OSError as exc:
            file_errors.append({"id": row["id"], "error": str(exc)[:240]})

    deleted = [row["id"] for row in removed_rows]
    return {
        "ok": True,
        "deleted": deleted,
        "cancelled": cancelled_ids,
        "skipped": skipped,
        "file_deleted": deleted_files,
        "file_errors": file_errors,
        "summary": {
            "requested": len(ids),
            "deleted": len(deleted),
            "skipped": len(skipped),
            "files_deleted": len(deleted_files),
            "file_errors": len(file_errors),
        },
    }


async def _cancel_tasks(ids: list[str], owner_id=None):
    """Stop active runtimes but keep their durable task history."""
    rows_by_id = {
        row["id"]: row
        for row in store.tasks_by_ids(ids, owner_id=owner_id)
    }
    existing_ids = []
    skipped = []
    for task_id in ids:
        row = rows_by_id.get(task_id)
        if row is None:
            skipped.append({"id": task_id, "error": "task not found"})
            continue
        existing_ids.append(task_id)

    active_ids = [
        task_id for task_id in existing_ids
        if rows_by_id[task_id].get("status") in ACTIVE_VIDEO_STATUSES
    ]
    cancelled_rows = store.cancel_tasks(active_ids)
    cancelled_ids = [row["id"] for row in cancelled_rows]
    if cancelled_ids:
        await asyncio.gather(*(_cancel_video_runtime(task_id) for task_id in cancelled_ids))

    cancelled_set = set(cancelled_ids)
    for task_id in existing_ids:
        if task_id in cancelled_set:
            continue
        status = rows_by_id[task_id].get("status")
        skipped.append({
            "id": task_id,
            "error": "task is not active" if status not in ACTIVE_VIDEO_STATUSES
            else "task changed state before it could be cancelled",
        })

    return {
        "ok": True,
        "cancelled": cancelled_ids,
        "skipped": skipped,
        "summary": {
            "requested": len(ids),
            "cancelled": len(cancelled_ids),
            "skipped": len(skipped),
        },
    }


@app.post("/api/tasks/cancel")
async def client_tasks_cancel(
    body: TaskBulkDelete,
    x_dola_owner: str | None = Header(default=None, alias="X-Dola-Owner"),
):
    """Cancel active tasks without deleting their queue records."""
    owner_id = _normalize_owner_id(x_dola_owner, required=True)
    ids = list(dict.fromkeys(str(value).strip() for value in body.ids if str(value).strip()))
    if not ids:
        raise HTTPException(422, "Hãy chọn ít nhất một tác vụ")
    return await _cancel_tasks(ids, owner_id=owner_id)


@app.post("/api/admin/tasks/cancel")
async def admin_tasks_cancel(body: TaskBulkDelete,
                             x_admin_key: str | None = Header(default=None)):
    """Cancel active local workers while preserving selected task records."""
    _admin_auth(x_admin_key)
    ids = list(dict.fromkeys(str(value).strip() for value in body.ids if str(value).strip()))
    if not ids:
        raise HTTPException(422, "Hãy chọn ít nhất một tác vụ")
    return await _cancel_tasks(ids)


@app.post("/api/tasks/bulk-delete")
async def client_tasks_bulk_delete(
    body: TaskBulkDelete,
    x_dola_owner: str | None = Header(default=None, alias="X-Dola-Owner"),
):
    """Delete only tasks belonging to the MaiVideo user represented by the Studio."""
    owner_id = _normalize_owner_id(x_dola_owner, required=True)
    ids = list(dict.fromkeys(str(value).strip() for value in body.ids if str(value).strip()))
    if not ids:
        raise HTTPException(422, "Hãy chọn ít nhất một tác vụ")
    return await _bulk_delete_tasks(ids, owner_id=owner_id)


@app.post("/api/admin/tasks/bulk-delete")
async def admin_tasks_bulk_delete(body: TaskBulkDelete,
                                  x_admin_key: str | None = Header(default=None)):
    """Cancel active local workers and remove selected task records/files."""
    _admin_auth(x_admin_key)
    ids = list(dict.fromkeys(str(value).strip() for value in body.ids if str(value).strip()))
    if not ids:
        raise HTTPException(422, "Hãy chọn ít nhất một tác vụ")
    return await _bulk_delete_tasks(ids)


@app.get("/api/admin/stats")
async def admin_stats(x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    st = store.stats()
    accs = pool.list_accounts()
    sched = [a for a in accs if a["scheduling"] and not a["cooling"]]
    st["total_accounts"] = len(accs)
    st["available_accounts"] = sum(1 for a in sched if a["remaining"] > 0)
    st["total_remaining"] = sum(a["remaining"] for a in sched)
    totals = st.pop("per_account_total", {})
    st["per_account"] = [{**a, "completed_total": totals.get(a["name"], 0)} for a in accs]
    return st


@app.get("/api/admin/keys")
async def admin_keys(x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    keys = []
    for key in store.list_keys():
        usage = store.key_usage(store.hash_api_key(key["key"]))
        keys.append({**key, **{
            "today_total": usage["total"],
            "today_completed": usage["completed"],
            "today_failed": usage["failed"],
            "today_active": usage["active"],
            "today_queued": usage["queued"],
        }})
    return {"keys": keys, "env_keys": len(config.API_KEYS)}


@app.post("/api/admin/keys")
async def admin_key_create(body: KeyCreate, x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    allowed = _normalize_allowed_durations(body.allowed_durations)
    return {"created": store.create_key(
        body.name,
        daily_limit=body.daily_limit,
        concurrency_limit=body.concurrency_limit,
        allowed_durations=allowed,
        expires_at=body.expires_at,
    )}


@app.patch("/api/admin/keys/{key}")
async def admin_key_patch(key: str, body: KeyPatch,
                          x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    if not store.get_key(key):
        raise HTTPException(404, "api key not found")
    fields = {}
    if body.name is not None:
        fields["name"] = body.name
    if body.enabled is not None:
        fields["enabled"] = 1 if body.enabled else 0
    if body.daily_limit is not None:
        fields["daily_limit"] = body.daily_limit
    if body.concurrency_limit is not None:
        fields["concurrency_limit"] = body.concurrency_limit
    if body.allowed_durations is not None:
        fields["allowed_durations"] = _normalize_allowed_durations(body.allowed_durations)
    if body.expires_at is not None:
        fields["expires_at"] = body.expires_at
    store.update_key(key, **fields)
    return {"ok": True}


@app.delete("/api/admin/keys/{key}")
async def admin_key_delete(key: str, x_admin_key: str | None = Header(default=None)):
    _admin_auth(x_admin_key)
    if not store.get_key(key):
        raise HTTPException(404, "api key not found")
    store.delete_key(key)
    return {"ok": True}


@app.get("/api/admin/user-keys")
async def user_api_keys(
    x_admin_key: str | None = Header(default=None),
    x_dola_owner_id: str | None = Header(default=None, alias="X-Dola-Owner-ID"),
):
    """Ensure one API key exists on first use, then list masked key metadata."""
    _user_key_admin_auth(x_admin_key)
    owner_id = _normalize_owner_id(x_dola_owner_id, required=True)
    created = store.ensure_user_key(owner_id, "Seedance API")
    if created:
        created.pop("owner_id", None)
    return {"keys": store.list_user_keys(owner_id), "created": created}


@app.get("/api/admin/user-keys/{key_id}")
async def user_api_key_reveal(
    key_id: str,
    x_admin_key: str | None = Header(default=None),
    x_dola_owner_id: str | None = Header(default=None, alias="X-Dola-Owner-ID"),
):
    """Reveal an active key only to its authenticated owner for copying."""
    _user_key_admin_auth(x_admin_key)
    owner_id = _normalize_owner_id(x_dola_owner_id, required=True)
    if not re.fullmatch(r"[0-9a-f]{64}", str(key_id or "")):
        raise HTTPException(404, "api key not found")
    key = store.get_user_key_secret(owner_id, key_id)
    if not key:
        raise HTTPException(404, "api key not found")
    return JSONResponse({"key": key}, headers={"Cache-Control": "no-store, no-cache, must-revalidate"})


@app.post("/api/admin/user-keys")
async def user_api_key_create(
    body: UserApiKeyCreate,
    x_admin_key: str | None = Header(default=None),
    x_dola_owner_id: str | None = Header(default=None, alias="X-Dola-Owner-ID"),
):
    """Create a user-bound key; the raw secret is returned only in this response."""
    _user_key_admin_auth(x_admin_key)
    owner_id = _normalize_owner_id(x_dola_owner_id, required=True)
    key_name = body.name.strip()
    if not key_name:
        raise HTTPException(422, "Tên API key không được để trống")
    try:
        created = store.create_key(
            key_name,
            allowed_durations=list(SUPPORTED_DURATIONS),
            owner_id=owner_id,
        )
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    created.pop("owner_id", None)
    return {"created": created}


@app.delete("/api/admin/user-keys/{key_id}")
async def user_api_key_delete(
    key_id: str,
    x_admin_key: str | None = Header(default=None),
    x_dola_owner_id: str | None = Header(default=None, alias="X-Dola-Owner-ID"),
):
    """Revoke a key only if its non-secret id belongs to the Studio user."""
    _user_key_admin_auth(x_admin_key)
    owner_id = _normalize_owner_id(x_dola_owner_id, required=True)
    if not re.fullmatch(r"[0-9a-f]{64}", str(key_id or "")):
        raise HTTPException(404, "api key not found")
    if not store.delete_user_key(owner_id, key_id):
        raise HTTPException(404, "api key not found")
    return {"ok": True}


# Dashboard single-file frontend
app.mount("/", StaticFiles(directory="web", html=True), name="web")

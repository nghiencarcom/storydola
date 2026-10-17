"""Dola Pool Configuration: Environment variable based with smart defaults."""
import os
from pathlib import Path


def _load_local_env():
    """Load local env files; inherited environment variables always win."""
    base_dir = Path(__file__).parent
    # .env is the primary local config. Keep .env.local as a legacy fallback;
    # setdefault means the first file wins while a real process env wins both.
    for path in (base_dir / ".env", base_dir / ".env.local"):
        if not path.exists():
            continue
        for raw in path.read_text(encoding="utf-8-sig").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_local_env()

# The Windows workspace ships with a matching Patchright Chromium build under
# `browsers/`. Prefer that project-local cache so a copied workspace does not
# depend on a browser install in the current Windows user's profile.
if os.name == "nt":
    _bundled_browsers = Path(__file__).resolve().parent / "browsers"
    _bundled_chromium = _bundled_browsers / "chromium-1243"
    if (_bundled_chromium / "INSTALLATION_COMPLETE").is_file() and (
        _bundled_chromium / "chrome-win64" / "chrome.exe"
    ).is_file():
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(_bundled_browsers)

HOST = os.getenv("DOLA_HOST", "127.0.0.1")
PORT = int(os.getenv("DOLA_PORT", "8000"))

# Service API keys (comma-separated; empty = no auth, local debug only)
API_KEYS = [k.strip() for k in os.getenv("DOLA_API_KEYS", "").split(",") if k.strip()]

# Account pool cookie file (one dola.com cookie per line)
COOKIES_FILE = os.getenv("DOLA_COOKIES_FILE", "cookies.txt")

# Global ceiling for concurrent video generation tasks. Account internal
# usage/fairness decides which profiles take those slots; proxy assignment does
# not reduce this limit.
MAX_CONCURRENCY = int(os.getenv("DOLA_MAX_CONCURRENCY", "30"))

# Reference images for one task can be fetched concurrently. This only
# affects the preparation phase; browser/profile concurrency remains bounded
# by MAX_CONCURRENCY and the account pool.
REFERENCE_DOWNLOAD_CONCURRENCY = max(
    1, int(os.getenv("DOLA_REFERENCE_DOWNLOAD_CONCURRENCY", "4"))
)
# Per-task limits are not enough when many jobs prepare references together.
# This process-wide cap keeps bursts against the MaiVideo static service bounded.
REFERENCE_DOWNLOAD_GLOBAL_CONCURRENCY = max(
    1, int(os.getenv("DOLA_REFERENCE_DOWNLOAD_GLOBAL_CONCURRENCY", "8"))
)

# How often a queued task retries while all eligible profiles are busy.
ACCOUNT_WAIT_INTERVAL_SEC = max(
    0.2, float(os.getenv("DOLA_ACCOUNT_WAIT_INTERVAL_SEC", "2"))
)

# Minimum spacing between accepted Dola submissions.  A single stable
# profile is safer than rotating through many sessions when Dola is applying
# anti-spam controls.  Zero keeps the setting opt-out for local experiments.
SUBMISSION_INTERVAL_SEC = max(
    0.0, float(os.getenv("DOLA_SUBMISSION_INTERVAL_SEC", "90"))
)

# Account login queue: one interactive OAuth flow at a time, with a cooldown
# between completed login attempts. This is separate from video task concurrency.
LOGIN_INTERVAL_SEC = max(0, int(os.getenv("DOLA_LOGIN_INTERVAL_SEC", "30")))

# Interactive first-login/relogin flows need enough time for Google OAuth,
# 2FA/CAPTCHA and Dola's callback redirect to finish. Keep this separate from
# automatic video relogin, which remains bounded by AUTO_RELOGIN_TIMEOUT_SEC.
LOGIN_FLOW_TIMEOUT_SEC = max(
    180, min(600, int(os.getenv("DOLA_LOGIN_FLOW_TIMEOUT_SEC", "600")))
)
# Dola can expose the callback document before Chromium has committed the
# session cookie to the persistent profile. Poll for a stable authenticated
# read instead of deciding from one immediate page snapshot.
LOGIN_SESSION_VERIFY_TIMEOUT_SEC = max(
    10, min(120, int(os.getenv("DOLA_LOGIN_SESSION_VERIFY_TIMEOUT_SEC", "60")))
)
# A fresh Chromium process opened after OAuth may need longer than the normal
# status check while Cookies/Local State are flushed to disk.
LOGIN_PERSISTENCE_VERIFY_TIMEOUT_SEC = max(
    15, min(180, int(os.getenv("DOLA_LOGIN_PERSISTENCE_VERIFY_TIMEOUT_SEC", "120")))
)
# A manually opened profile is verified after Chromium closes. More attempts
# with a bounded delay prevent a successful first login being shown as
# "chưa có session" while the profile is still flushing cookies.
PROFILE_SYNC_ATTEMPTS = max(
    1, min(10, int(os.getenv("DOLA_PROFILE_SYNC_ATTEMPTS", "6")))
)
PROFILE_SYNC_RETRY_DELAY_SEC = max(
    1.0, min(30.0, float(os.getenv("DOLA_PROFILE_SYNC_RETRY_DELAY_SEC", "4")))
)

# Video workers should not hold a render slot while waiting for an interactive
# Gmail/CAPTCHA flow. A failed automatic relogin can rotate to the next
# profile, while 60s gives an already-authenticated Gmail profile enough time
# to finish the Dola OAuth callback and persist its cookies.
AUTO_RELOGIN_TIMEOUT_SEC = max(
    5, min(60, int(os.getenv("DOLA_AUTO_RELOGIN_TIMEOUT_SEC", "60")))
)

# Dola's anti-abuse/risk response is usually temporary. Keep the affected
# profile in the pool, pause it for a few hours, then verify its persisted
# session before making it schedulable again. Pre-submit logout checks can
# rotate through the bounded profile set; accepted conversations still pause
# shared submissions. Operators can shorten this for local testing with
# DOLA_RISK_CONTROL_COOLDOWN_SEC.
RISK_CONTROL_COOLDOWN_SEC = max(
    5 * 60,
    int(os.getenv("DOLA_RISK_CONTROL_COOLDOWN_SEC", str(3 * 60 * 60))),
)
PROVIDER_RATE_LIMIT_COOLDOWN_SEC = max(
    5 * 60,
    int(os.getenv("DOLA_PROVIDER_RATE_LIMIT_COOLDOWN_SEC", str(3 * 60 * 60))),
)
RISK_CONTROL_RECOVERY_INTERVAL_SEC = max(
    60,
    int(os.getenv("DOLA_RISK_CONTROL_RECOVERY_INTERVAL_SEC", "300")),
)
# Do not reopen Chromium profiles while Uvicorn is still becoming ready. A
# crashed Gateway can have many durable tasks waiting for recovery; launching
# all of them in the same event-loop turn makes the health probe race with
# Patchright's JSON protocol traffic. Recovery is delayed only at process
# startup; normal video concurrency is unchanged.
STARTUP_RECOVERY_DELAY_SEC = max(
    0.0, float(os.getenv("DOLA_STARTUP_RECOVERY_DELAY_SEC", "15"))
)
STARTUP_RECOVERY_STAGGER_SEC = max(
    0.0, float(os.getenv("DOLA_STARTUP_RECOVERY_STAGGER_SEC", "0.25"))
)
STARTUP_RECOVERY_CONCURRENCY = max(
    1,
    min(
        MAX_CONCURRENCY,
        int(os.getenv("DOLA_STARTUP_RECOVERY_CONCURRENCY", str(MAX_CONCURRENCY))),
    ),
)
# A single video request may inspect a bounded number of profiles when Dola
# logs one out before a conversation is accepted. This prevents a
# risk-control response from spinning through the whole pool in one run while
# still giving the task a chance to find a usable session.
RISK_CONTROL_MAX_PROFILES = max(
    1,
    int(os.getenv("DOLA_RISK_CONTROL_MAX_PROFILES", "10")),
)

# Global pending task queue limit (queued + submitting + processing), 0 = unlimited
MAX_PENDING_TASKS = int(os.getenv("DOLA_MAX_PENDING_TASKS", "100"))

# Application cap for Dola web video prompts. Dola does not publish a stable
# numeric limit; Python slicing by Unicode code point matches the Studio's
# Array.from-based counter/truncation.
MAX_PROMPT_CHARS = max(1, int(os.getenv("DOLA_MAX_PROMPT_CHARS", "12000")))
PROMPT_KEY_DELAY_MS = max(1, min(100, int(os.getenv("DOLA_PROMPT_KEY_DELAY_MS", "1"))))

# The video composer can commit a long contenteditable prompt and mount its
# send control asynchronously. Keep the pre-submit acknowledgement window
# separate from the provider render timeout so a transient UI delay is not
# reported as a payload failure.
SUBMISSION_ACK_TIMEOUT_SEC = max(
    15, min(90, int(os.getenv("DOLA_SUBMISSION_ACK_TIMEOUT_SEC", "90")))
)

# Video generation timeout in seconds. Keep the hard cap aligned with the
# configured 30-minute provider wait, even when an environment override asks
# for a longer interval.
VIDEO_HARD_MAX_WAIT_SEC = 30 * 60
# Previous releases capped accepted conversations at 20 minutes even when
# DOLA_VIDEO_MAX_WAIT_SEC was configured to 30. Startup uses this to extend
# active/just-expired poll deadlines once when upgrading.
VIDEO_LEGACY_MAX_WAIT_SEC = 20 * 60
VIDEO_TIMEOUT = max(
    1,
    min(
        VIDEO_HARD_MAX_WAIT_SEC,
        int(os.getenv("DOLA_VIDEO_TIMEOUT", "300")),
    ),
)

# A poll window is deliberately shorter than the overall task lifetime. The
# server can release the Chromium context between windows while Dola continues
# rendering the accepted conversation. Never allow the configured lifetime to
# exceed thirty minutes.
VIDEO_MAX_WAIT_SEC = min(
    VIDEO_HARD_MAX_WAIT_SEC,
    max(
        VIDEO_TIMEOUT,
        int(os.getenv("DOLA_VIDEO_MAX_WAIT_SEC", str(VIDEO_HARD_MAX_WAIT_SEC))),
    ),
)
VIDEO_POLL_WINDOW_SEC = max(
    60, int(os.getenv("DOLA_VIDEO_POLL_WINDOW_SEC", "300"))
)
VIDEO_POLL_RETRY_DELAY_SEC = max(
    5, int(os.getenv("DOLA_VIDEO_POLL_RETRY_DELAY_SEC", "15"))
)
# An accepted conversation is normally re-polled across several browser
# windows. Repeated unexpected exceptions (as opposed to normal timeouts or
# provider "still generating" responses) usually indicate a terminal worker
# problem; cap consecutive failures while allowing transient issues to recover.
VIDEO_POLL_UNEXPECTED_ERROR_RETRIES = max(
    1, min(10, int(os.getenv("DOLA_VIDEO_POLL_UNEXPECTED_ERROR_RETRIES", "3")))
)

# Dola occasionally accepts a chat and then answers "I can't answer your
# question" without producing media.  It is safe to discard that conversation
# because no video was created, but cap the automatic fresh-chat recovery so a
# persistent provider response cannot loop forever.
AUTO_CANNOT_ANSWER_RETRIES = max(
    0, min(2, int(os.getenv("DOLA_AUTO_CANNOT_ANSWER_RETRIES", "1")))
)
# Dola may accept a conversation and then return a temporary overload response.
# Retry that task through distinct profiles, independently of the one-time
# recovery reserved for generic "I can't answer" responses.
AUTO_PROVIDER_BUSY_RETRIES = max(
    0, min(10, int(os.getenv("DOLA_AUTO_PROVIDER_BUSY_RETRIES", "5")))
)
AUTO_RATE_LIMIT_RETRIES = max(
    0, min(10, int(os.getenv("DOLA_AUTO_RATE_LIMIT_RETRIES", "5")))
)

# Validate the downloaded container before reporting a completed video.
VALIDATE_VIDEO_OUTPUT = os.getenv("DOLA_VALIDATE_VIDEO_OUTPUT", "1") == "1"
VIDEO_DURATION_TOLERANCE_SEC = max(
    0.5, float(os.getenv("DOLA_VIDEO_DURATION_TOLERANCE_SEC", "1.5"))
)

# Download-time watermark safeguard.  The normal path resolves Dola's signed
# original resource and does not need a re-encode.  If that signed resource
# expires and the worker has to use Dola's regular download URL, the worker
# applies an FFmpeg cleanup pass before exposing the file to the client.
WATERMARK_CLEANUP_ENABLED = os.getenv("DOLA_WATERMARK_CLEANUP_ENABLED", "1") == "1"
WATERMARK_CLEANUP_TIMEOUT_SEC = max(
    30, int(os.getenv("DOLA_WATERMARK_CLEANUP_TIMEOUT_SEC", "600"))
)
FFMPEG_BINARY = os.getenv("DOLA_FFMPEG_BINARY", "ffmpeg")

# SQLite database path
DB_PATH = os.getenv("DOLA_DB_PATH", "tasks.db")

# Durable local-pool metadata (quota, cooldowns and managed proxy
# assignments).  Keep this separate from task persistence so a proxy update
# never touches a video task row.
POOL_DB_PATH = os.getenv("DOLA_POOL_DB_PATH", "pool_usage.db")

# Encrypted account credentials used by the admin relogin action. The key can
# come from a deployment secret; local development generates a 0600 key file
# once so passwords/TOTP values never need to be exposed to the dashboard.
CREDENTIALS_FILE = os.getenv("DOLA_CREDENTIALS_FILE", "account_credentials.json")
CREDENTIALS_KEY_FILE = os.getenv("DOLA_CREDENTIALS_KEY_FILE", "account_credentials.key")
CREDENTIALS_KEY = os.getenv("DOLA_CREDENTIALS_KEY", "")

# Video download storage directory (served statically by FastAPI)
DOWNLOAD_DIR = os.getenv("DOLA_DOWNLOAD_DIR", "downloads")

# Explicit browser proxy (must point to JP/KR egress; empty = system proxy)
PROXY = os.getenv("DOLA_PROXY", "")

# ProxyFB key-based IPv4 rotating API. The service documents these endpoints
# on the plain HTTP API host; deployments may override the base URL when using
# an HTTPS mirror or an internal egress.
PROXYFB_API_BASE_URL = os.getenv(
    "DOLA_PROXYFB_API_BASE_URL", "http://api.proxyfb.com/api"
).rstrip("/")
PROXYFB_API_TIMEOUT_SEC = max(
    3.0, float(os.getenv("DOLA_PROXYFB_API_TIMEOUT_SEC", "12"))
)
# Request a replacement this long before the reported timeout, after
# ProxyFB's next_change gate has opened.
PROXYFB_REFRESH_MARGIN_SEC = max(
    0.0, float(os.getenv("DOLA_PROXYFB_REFRESH_MARGIN_SEC", "15"))
)
# Optional startup safety window for a rotating proxy lease. Keep this at zero
# by default so a job opens its profile immediately; the ProxyFB rotation and
# health checks still protect expired/invalid endpoints. Set it to 120 only if
# an operator explicitly wants to wait for a full startup lease.
VIDEO_PROXY_MIN_REMAINING_SEC = max(
    0, int(os.getenv("DOLA_VIDEO_PROXY_MIN_REMAINING_SEC", "0"))
)
PROXYFB_ROTATION_CHECK_INTERVAL_SEC = max(
    15, int(os.getenv("DOLA_PROXYFB_ROTATION_CHECK_INTERVAL_SEC", "30"))
)
# Invalid ProxyFB keys and transient endpoint failures must not be retried on
# every 30-second rotation scan. Keep the profile visible, but back off the
# next automatic attempt so proxy failures cannot starve the Gateway event
# loop and batch admission path.
PROXYFB_ERROR_RETRY_SEC = max(
    60, int(os.getenv("DOLA_PROXYFB_ERROR_RETRY_SEC", "300"))
)
# ProxyFB may need more than one minute to activate the endpoint returned by
# changeProxy. Use ProxyFB's own checker instead of a third-party IP echo
# service before Chromium or a render is allowed to use the endpoint.
PROXYFB_IP_CHECK_URL = (
    os.getenv("DOLA_PROXYFB_IP_CHECK_URL", "https://proxyfb.com/check.php").strip()
    or "https://proxyfb.com/check.php"
)
PROXYFB_IP_CHECK_TIMEOUT_SEC = max(
    3.0, float(os.getenv("DOLA_PROXYFB_IP_CHECK_TIMEOUT_SEC", "15"))
)
# First activation check after 60s. Failed checks are retried every 10s until
# the hard 120s activation deadline.
PROXYFB_IP_ACTIVATION_WAIT_SEC = max(
    0.0, float(os.getenv("DOLA_PROXYFB_IP_ACTIVATION_WAIT_SEC", "60"))
)
PROXYFB_IP_ACTIVATION_MAX_WAIT_SEC = max(
    PROXYFB_IP_ACTIVATION_WAIT_SEC,
    float(os.getenv("DOLA_PROXYFB_IP_ACTIVATION_MAX_WAIT_SEC", "120")),
)
PROXYFB_IP_CHECK_INTERVAL_SEC = max(
    1.0, float(os.getenv("DOLA_PROXYFB_IP_CHECK_INTERVAL_SEC", "10"))
)
PROXYFB_IP_CHECK_MAX_ATTEMPTS = max(
    1, min(16, int(os.getenv("DOLA_PROXYFB_IP_CHECK_MAX_ATTEMPTS", "7")))
)
PROXYFB_IP_CHECK_CACHE_SEC = max(
    0.0, float(os.getenv("DOLA_PROXYFB_IP_CHECK_CACHE_SEC", "30"))
)

# Opening a profile is an interactive action. Keep the initial Dola navigation
# bounded so a proxy that can reach Google but cannot reach Dola does not make
# the whole profile-open request hang for a minute.
OPEN_PROFILE_NAV_TIMEOUT_SEC = max(
    5, int(os.getenv("DOLA_OPEN_PROFILE_NAV_TIMEOUT_SEC", "15"))
)

# Run browser in headless mode (login always runs with head)
HEADLESS = os.getenv("DOLA_HEADLESS", "0") == "1"

# Render automation may need a headed Chromium window when the Dola30
# extension is enabled. Minimize to the Dock; never move windows off-screen.
HIDE_RENDER_WINDOWS = os.getenv("DOLA_HIDE_RENDER_WINDOWS", "1") == "1"

# Browser locale and timezone are optional. Leave them empty so Chromium and
# the destination site can use the host/profile defaults and current network
# location; set either variable only when a fixed browser identity is needed.
# Keep these separate from the Seedance request region below: Dola may require
# a JP/KR egress for the service while the browser remains automatic.
LOGIN_LOCALE = os.getenv("DOLA_LOGIN_LOCALE", "").strip()
LOGIN_TIMEZONE = os.getenv("DOLA_LOGIN_TIMEZONE", "").strip()
GOOGLE_LOCALE = os.getenv("DOLA_GOOGLE_LOCALE", "vi")
BROWSER_LOCALE = os.getenv("DOLA_BROWSER_LOCALE", LOGIN_LOCALE).strip()
BROWSER_TIMEZONE = os.getenv("DOLA_BROWSER_TIMEZONE", LOGIN_TIMEZONE).strip()

# Base public URL for returning static video links
PUBLIC_BASE = os.getenv("DOLA_PUBLIC_BASE", f"http://127.0.0.1:{PORT}")

# Dola Studio's local origin. Reference images selected from the Studio media
# library use its read-only /api/media/files proxy. The media downloader may
# trust only this exact loopback origin and route; arbitrary private URLs stay
# blocked by the SSRF validator.
STUDIO_URL = os.getenv("DOLA_STUDIO_URL", "http://127.0.0.1:3007").rstrip("/")
# Local StoryAI origin used only for signed reference-image URLs. The media
# downloader allowlists this exact loopback origin and reference route.
STORYAI_LOCAL_URL = os.getenv("STORYAI_LOCAL_URL", "http://127.0.0.1:3021").rstrip("/")

# Admin web dashboard password (empty = no auth)
ADMIN_KEY = os.getenv("DOLA_ADMIN_KEY", "")
TASK_OWNER_SECRET = os.getenv("DOLA_TASK_OWNER_SECRET", "").strip()

# Seedance duration / Watermark Removal Chromium extension path
EXTENSION_DIR = os.getenv("DOLA_EXTENSION_DIR", "extensions/SeedancePro")
EXTENSION_ENABLED = os.getenv("DOLA_EXTENSION_ENABLED", "1") == "1"

# MaiVideo image-generation settings used by the Studio and by the bounded
# automatic reference-image fallback. The fallback is intentionally disabled
# after one sketch attempt per logical task; it must never become a retry loop.
MAIVIDEO_PUBLIC_URL = os.getenv(
    "MAIVIDEO_PUBLIC_URL", "https://maivideo.top"
).rstrip("/")
MAIVIDEO_API_KEY = os.getenv("MAIVIDEO_API_KEY", "").strip()
MAIVIDEO_AUTH_TOKEN = os.getenv("MAIVIDEO_AUTH_TOKEN", "").strip()
ALLOWED_MAIVIDEO_IMAGE_MODELS = ("gemini-3.0", "gemini-3.1-flash")
DEFAULT_MAIVIDEO_IMAGE_MODEL = "gemini-3.1-flash"
_configured_maivideo_image_model = os.getenv(
    "MAIVIDEO_IMAGE_MODEL", DEFAULT_MAIVIDEO_IMAGE_MODEL
).strip()
MAIVIDEO_IMAGE_MODEL = (
    _configured_maivideo_image_model
    if _configured_maivideo_image_model in ALLOWED_MAIVIDEO_IMAGE_MODELS
    else DEFAULT_MAIVIDEO_IMAGE_MODEL
)
MAIVIDEO_IMAGE_QUALITY = os.getenv("MAIVIDEO_IMAGE_QUALITY", "1440p").strip()
AUTO_SKETCH_RETRY_ENABLED = os.getenv("DOLA_AUTO_SKETCH_RETRY_ENABLED", "1") == "1"
AUTO_SKETCH_RETRY_LIMIT = max(
    0, min(1, int(os.getenv("DOLA_AUTO_SKETCH_RETRY_LIMIT", "1")))
)
AUTO_SKETCH_IMAGE_TIMEOUT_SEC = max(
    30,
    min(
        30 * 60,
        int(os.getenv("DOLA_AUTO_SKETCH_IMAGE_TIMEOUT_SEC", str(30 * 60))),
    ),
)
AUTO_SKETCH_IMAGE_POLL_SEC = max(
    1.0, min(30.0, float(os.getenv("DOLA_AUTO_SKETCH_IMAGE_POLL_SEC", "5")))
)

# Video tasks always use the local Chromium account pool.
RENDER_BACKEND = "local"

# Daily quota and internal-use reset timezone (Vietnam local time by default).
LIMIT_RESET_TZ = os.getenv("DOLA_LIMIT_RESET_TZ", "Asia/Ho_Chi_Minh")

# Local successful-video safety counter shown in /tai-khoan-seedance. Dola's
# provider-side credits/limits remain authoritative; ten is a practical upper
# bound for 15-second videos on one profile and can be lowered per deployment.
INTERNAL_DAILY_LIMIT = max(1, int(os.getenv("DOLA_INTERNAL_DAILY_LIMIT", "10")))

# Public reference image download limits. Keep this aligned with the Studio
# upload route and SeedancePro bridge, both of which accept up to 25 MB per
# image. An explicit environment override remains available for deployments
# that need a smaller limit.
REFERENCE_IMAGE_MAX_BYTES = int(os.getenv("DOLA_REFERENCE_IMAGE_MAX_BYTES", str(25 * 1024 * 1024)))
REFERENCE_DOWNLOAD_TIMEOUT = int(os.getenv("DOLA_REFERENCE_DOWNLOAD_TIMEOUT", "300"))
REFERENCE_IMAGE_MAX_COUNT = int(os.getenv("DOLA_REFERENCE_IMAGE_MAX_COUNT", "30"))

# Extended generation window for reference image tasks (seconds)
REFERENCE_VIDEO_TIMEOUT = int(os.getenv("DOLA_REFERENCE_VIDEO_TIMEOUT", "900"))

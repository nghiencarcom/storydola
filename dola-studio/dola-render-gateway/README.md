# Dola Render Gateway

A high-performance session coordinator and OpenAI-compatible video generation API service.

Provides automated browser session isolation, task queue distribution, extended duration handling, and an intuitive web management dashboard.

---

## 🌟 Key Capabilities

1. **OpenAI-Compatible Video API**:
   - `POST /v1/videos/generations`: Submit generation tasks with prompt, aspect ratio, duration (`5s`, `10s`, `15s`, `30s`), and reference images. Prompt dài hơn giới hạn cấu hình sẽ được tự động cắt tại Gateway. Các cụm thời lượng viết trong prompt được loại bỏ trước khi gửi; thời lượng dùng trường cấu hình riêng. API hỗ trợ Seedance 2.0 và 2.5.
   - `POST /v1/videos/batches`: Admit up to 100 prompts atomically and return task ids in one request.
   - `GET /v1/videos/status?ids=...`: Read up to 100 task states in one request for queue monitors.
   - `GET /v1/videos/<id>`: Poll task lifecycle (`queued` -> `processing` -> `completed` / `failed`).
   - High-speed MP4 streaming and static asset delivery.
2. **Extended Duration & High-Definition Media Export**:
   - Integrated browser automation profile for managing extended duration options.
   - Completed videos are resolved through Dola's signed `fallback_api` with
     `channel=no`, `codec_type=8`, and `logo_type=unwatermarked`; qAAB/AES
     media tokens are decoded in the authenticated page before download.
   - Task metadata records `watermark_free`, `watermark_removed`, and
     `media_source`. If the signed original URL expires, the worker downloads
     Dola's regular URL only as a last resort, runs an FFmpeg cleanup over the
     known dynamic-logo regions, and exposes the cleaned file. If cleanup is
     unavailable or fails, the task fails instead of returning a watermarked
     file. Video responses are marked `no-store` so a tunnel or browser does
     not reuse an older watermarked response.
3. **Multi-Account Browser Pool**:
   - Manages multiple persistent browser profiles in `accounts/`.
   - Automatic concurrency management, mutual exclusion, and session rotation.
   - Built-in verification handling.
4. **Admin Web Dashboard**:
   - Real-time dashboard at `/web` to monitor generation trends, success rate, account statuses, task queues, and API key management.
5. **Project-scoped queue access**:
   - Studio-created tasks can carry an opaque `X-Dola-Owner` scope; `GET /api/tasks`, task status, retry, and bulk delete then operate only on that scope.
   - `GET /api/admin/tasks`, `GET /api/admin/tasks/status`, and `POST /api/admin/tasks/bulk-delete` require the configured `X-Admin-Key` and are reserved for project administrators.
   - The Gateway does not decide MaiVideo roles itself; Dola Studio resolves the MaiVideo session and selects the admin or owner-scoped route before forwarding the request.

6. **Per-user API keys and interactive docs**:
   - OpenAPI/Swagger documentation is served at `/docs`; Dola Studio proxies it at `https://seedance.maivideo.top/docs` along with `/openapi.json` and `/v1/*`.
   - The first key is automatically created when a signed-in user opens **Cài đặt → API cá nhân**. It is bound to that MaiVideo owner, shown in full only once, and can be revoked from the same screen. Each user can have up to 10 active keys.
   - Send `Authorization: Bearer <API_KEY>` to the video endpoints. Keys do not bypass the shared Seedance profile/provider quotas.

---

## 📁 Repository Structure

```
dola-render-gateway/
├── server.py              # FastAPI server (OpenAI-compatible video API & admin routes)
├── browser_pool.py        # Account pool concurrency manager and task scheduler
├── browser.py             # Playwright persistent context launcher
├── video_worker_ui.py     # UI automation worker with verification handler
├── video_worker.py        # Protocol worker and status polling
├── store.py               # SQLite task persistence and API key storage
├── dola_client.py         # API client communication module
├── media.py               # Reference media processor
├── config.py              # Configuration & environment variables
├── add_account.py         # Automated account profile setup
├── web/
│   └── index.html         # Single-page admin management dashboard
└── extensions/
    └── dola30/            # Chromium extension profile
```

---

## 🚀 Quick Start

### 1. Requirements
* Python 3.11+
* Chrome / Chromium browser
* Proxy with JP/KR egress

The Google sign-in window and persistent Chromium profiles leave locale and
timezone unset by default, so Chromium and the destination site can use the
current profile/environment and network location. Set `DOLA_BROWSER_LOCALE` or
`DOLA_BROWSER_TIMEZONE` only when a fixed browser identity is required.
Seedance service request parameters remain on the configured JP/KR egress.
TOTP secrets are processed
locally with RFC 6238; the Gateway does not send them to an OTP website. Raw
Base32 secrets (with spaces) and `otpauth://` URIs are accepted.

### 2. Setup Environment
```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate       # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

On Windows x64, this workspace includes the matching Patchright Chromium build
in `browsers/chromium-1243`; the Gateway selects it automatically. The bundled
browser is Windows-only. On Linux, WSL, or macOS, install the platform browser
with `patchright install chromium`.

### 3. Configure
```bash
# Set your proxy configuration
export DOLA_PROXY="http://127.0.0.1:7890"

# Set API key for client authentication (optional, empty = dev mode)
export DOLA_API_KEYS="sk-your-secret-key"

# Required by MaiVideo Studio's authenticated user-key management proxy
export DOLA_ADMIN_KEY="replace-with-a-long-random-secret"

# Concurrency limits
export DOLA_MAX_CONCURRENCY=8

# Parallel reference-image downloads during task preparation
export DOLA_REFERENCE_DOWNLOAD_CONCURRENCY=4

# Keep headed render profiles minimized/off-screen (default: 1)
export DOLA_HIDE_RENDER_WINDOWS=1

# Local Dola Studio origin used only for the read-only media-library proxy
export DOLA_STUDIO_URL="http://127.0.0.1:3007"

# Verify downloaded duration and aspect ratio before marking a task complete
export DOLA_VALIDATE_VIDEO_OUTPUT=1

# Keep accepted conversations polling while Dola is still rendering
export DOLA_VIDEO_MAX_WAIT_SEC=1800
export DOLA_VIDEO_POLL_WINDOW_SEC=300
export DOLA_VIDEO_POLL_RETRY_DELAY_SEC=15

# The fallback downloader needs FFmpeg to remove the provider logo before the
# file is exposed. Keep this enabled for a no-watermark delivery guarantee.
export DOLA_WATERMARK_CLEANUP_ENABLED=1
# Optional absolute path when ffmpeg is not on PATH:
# export DOLA_FFMPEG_BINARY=/opt/homebrew/bin/ffmpeg

# Interactive account login queue (seconds between completed logins)
export DOLA_LOGIN_INTERVAL_SEC=30
# Automatic video recovery checks the Dola/Gmail session for at most 60s,
# then rotates to the next profile if the session is still not valid.
export DOLA_AUTO_RELOGIN_TIMEOUT_SEC=60

# Profile-open convenience navigation to Dola (the window stays open if it
# times out, so a proxy that reaches Google but not Dola can still be used).
export DOLA_OPEN_PROFILE_NAV_TIMEOUT_SEC=15
```

The interactive OpenAPI/Swagger guide is served at `http://127.0.0.1:8200/docs`. When the Gateway is behind Dola Studio, open `https://seedance.maivideo.top/docs`; a user's first API key is automatically issued when they open **Cài đặt → API cá nhân**. Set Studio's `DOLA_GATEWAY_ADMIN_KEY` to the same value as Gateway's `DOLA_ADMIN_KEY`. User keys are bound to their MaiVideo owner, appear fully only when created, and can be revoked from Studio. The key authenticates access but does not grant credit; generation uses the credits of Seedance profiles connected to the Gateway. Do not expose `DOLA_ADMIN_KEY` or the internal `/api/admin/user-keys` endpoints to browser code.

### 4. Start Server
```bash
uvicorn server:app --host 127.0.0.1 --port 8000
```
Open **http://127.0.0.1:8000/web** to access the Admin Dashboard.

For the Dola Studio setup in this workspace, `.env` selects port 8200, the
direct network route, and up to 30 concurrent video renders. `.env.local` is
also supported as a legacy fallback. On macOS/Linux, start it with:

```bash
./start_server.sh
```

Gateway stdout/stderr (including Uvicorn tracebacks and render-worker errors)
is appended to `dola-gateway.log`. Follow it with `tail -f dola-gateway.log`,
or set `DOLA_LOG_FILE` to an absolute path before starting the Gateway.

Account onboarding is serialized: only one Google OAuth login window is
opened at a time, and the next account waits `DOLA_LOGIN_INTERVAL_SEC` seconds
after the previous flow ends. This protects manual 2FA/CAPTCHA handling and is
independent from video generation concurrency.

Video-render profiles are hidden by default even when the Dola30 extension
requires headed Chromium. Set `DOLA_HIDE_RENDER_WINDOWS=0` to show them while
debugging the render UI. This setting does not hide the interactive Google
login window.

When all eligible profiles are busy, accepted video tasks remain queued and
wait for the next profile instead of failing immediately. Completed downloads
are checked with OpenCV against the requested duration/aspect ratio; an invalid
file is reported as `OUTPUT_INVALID` and is never marked completed.
The account table's `used_today` value is an internal successful-video counter,
not the provider's Dola credit balance. It increments only after Dola returns a
video, the file is downloaded, and output validation succeeds. The daily key
uses `DOLA_LIMIT_RESET_TZ` (default `Asia/Ho_Chi_Minh`) so the dashboard, scheduler,
and reset boundary use the same provider day. The displayed count is read from
successful-result claims inside that local midnight-to-midnight window and is
deduplicated by render task, so it resets automatically without including
queued, failed, or still-polling jobs. Account selection prioritizes the lowest
current `used_today` value and re-checks it immediately before dispatch to keep
concurrent batches balanced. If Dola returns
only a `conversation_id`, the task stays `processing` and the Gateway reopens
the hidden profile to poll again; it does not increment `used_today` or submit a
duplicate conversation. Any actual Dola-credit refund remains under Dola's
provider-side policy.
Credit errors detected after Dola has accepted a conversation are reported as
`CREDIT_DURING_RENDER`; the task is not submitted again on another profile.
Daily-limit responses received after a conversation is created follow the same
rule as `DAILY_LIMIT_DURING_RENDER`: do not resubmit the task.
If a persistent profile loses its Dola session, the account is automatically
disabled for scheduling and is reported as `AUTH_EXPIRED` until it is logged in
again from the account-management screen.

The account-add API accepts `email`, `password`, and optional `totp`; `name` is
optional for backward compatibility. When omitted, the Gateway derives a stable
filesystem-safe browser session id from the email.

The Studio bulk-login form accepts the same `email----password----totp` rows
as well as CSV rows. A new email creates a profile; an email already linked to
an expired profile is relogged in a temporary staging profile and replaces the
old profile only after OAuth succeeds. Credentials are encrypted in the local
Gateway credential vault and are never returned to the Studio UI. Set
`DOLA_CREDENTIALS_KEY` from a deployment secret when the Gateway needs a
stable externally managed encryption key; local development generates a
0600 `account_credentials.key` file automatically. If the profile is already
healthy, resubmitting its credential row only updates the encrypted vault and
does not interrupt the current browser session.

### Dola Studio queue ownership

The SQLite `tasks` table contains an optional `owner_id` column. Dola Studio
writes a stable HMAC-derived owner scope when a logged-in MaiVideo user submits
a task. Existing rows created before this migration may have `owner_id = NULL`;
they remain visible to the admin route but are intentionally hidden from
owner-scoped clients because ownership cannot be inferred safely. Keep the
Studio-side `DOLA_TASK_OWNER_SECRET` unchanged while retaining `tasks.db`.

The account-management UI exposes `POST /api/admin/accounts/bulk-relogin` for
failed or expired profiles. It accepts up to 50 existing profile names, uses
the encrypted credentials saved for each profile when available, and queues one
visible Chromium flow at a time. Legacy profiles without saved credentials
fall back to the Google session already stored in the profile. Send
`mode: "gmail-session"` (or use the UI's “Login Gmail trong profile” action) to
force the in-place flow: it opens `https://www.dola.com/`, selects the Gmail
account already signed in to that profile, and waits for a new Dola session
without replacing the browser profile. If Google needs manual interaction, the
visible profile window remains available for the operator.

For one profile, the equivalent endpoint is
`POST /api/admin/accounts/{name}/relogin-session`.

### Managed rotating proxies

The Studio sidebar has a separate **Quản lý proxy** tab for the managed proxy
pool. Paste one proxy
per line using either `host:port:username:password` (the same format as FB
Publisher) or a URL such as `http://user:password@host:port`. Choose `HTTP`,
`HTTPS`, or `SOCKS5`, and mark the entry as `Rotating` when the provider
rotates the exit IP behind one endpoint. Importing the same endpoint again
updates it instead of creating a duplicate. Up to 1,000 lines can be imported
at once and up to 200 entries can be tested in one batch.

Each local profile can select a different managed proxy in the account table,
or several selected profiles can be assigned together. The selected proxy is
used for Google/Dola login, session checks, video submission, CAPTCHA asset
fetches, polling, and the final download; profiles without an assignment keep
using `DOLA_PROXY`. Proxy passwords are encrypted by the Gateway credential
key and are never returned to the browser. Deleting a proxy automatically
clears its profile assignments.

Use **Đổi tên** beside any proxy in the **Quản lý proxy** table to update its
display name. This changes only the label; endpoint, rotating lease, encrypted
credentials, and profile assignments are preserved. The admin endpoint is
`PATCH /api/admin/proxies/{id}/name`.

The **Chia đều** action assigns the selected enabled proxies across the
selected profiles. If no profiles are selected, it uses every local profile;
if no proxies are selected, it prefers enabled ProxyFB API entries and falls
back to all enabled managed proxies. The groups differ by at most one profile
(for example, 30 profiles and 5 keys gives 6 profiles per key). Profiles
outside the target selection keep their current assignment. The API is
`POST /api/admin/accounts/distribute-proxy`.

Video dispatch also keeps a per-day proxy reservation counter. The scheduler
first selects an eligible account whose assigned proxy has the fewest dispatches
today, then uses the existing per-account successful-video counter as the next
tie-breaker. Therefore, with 15 assigned proxies, the first 15 new dispatches
use one proxy each; the 16th dispatch starts the next proxy cycle. The counter
is persisted in `proxy_usage`, counts the reservation when a job is dispatched
(including a pre-submit attempt), and is seeded once from legacy successful
account usage when an older database is upgraded. This changes only dispatch
ordering; it does not reassign a persistent Chromium profile to another proxy.

When an operator opens a profile from the account table, Chromium is launched
with that profile's selected proxy. The initial Dola tab navigation is only a
convenience; if Dola times out while Google is reachable, the profile remains
open and the UI reports the navigation error instead of closing the browser.

Proxy status checks are sent in batches to
[`proxyfb.com/check.php`](https://proxyfb.com/check.php). HTTP and HTTPS entries
use the checker's `HTTP` mode (the browser still uses the configured scheme),
while SOCKS5 entries use its `SOCKS5` mode. The checker response is mapped back
to each row and stored as `healthy` or `error` in the local proxy pool.

#### ProxyFB API rotating keys

ProxyFB's key-based IPv4 service is a separate source from a pasted endpoint.
The account screen accepts one API key plus `location_id`, or a bulk list using
`API_KEY` / `API_KEY|LOCATION_ID`. The Gateway calls the documented
`getProxy.php` and `changeProxy.php` endpoints at
[`proxyfb.com/APIDocument.html`](https://proxyfb.com/APIDocument.html), stores
the key encrypted, and keeps only the returned IP:port in the browser proxy
profile. A cached lease is reused until its reported timeout; a missing or
expired lease is refreshed before a new Chromium profile or render starts.
The **Đổi IP** action requests a new endpoint for one key. An already running
Chromium context keeps its current endpoint, so close and reopen that profile
after rotating it. `DOLA_PROXYFB_API_BASE_URL` can point to a compatible API
mirror; the documented default is `http://api.proxyfb.com/api`.

The Gateway schedules automatic rotation from ProxyFB's `next_change` and
`timeout` values. `next_change` is the earliest time the provider allows a new
IP request; a healthy finite lease is refreshed shortly before its reported
timeout, after that gate opens. An endpoint that fails its health check is
refreshed as soon as ProxyFB allows it. Timeoutless VIP keys have no automatic
expiry trigger and can still be rotated manually. If a lease expires before
`next_change` opens, the Gateway marks the proxy unavailable and waits rather
than reusing the expired IP or requesting a change too early. Opening a
profile or starting a new render uses the latest cached, verified endpoint.
The proxy stays fixed for an already-running Chromium context, and the next
profile/poll context uses the new endpoint after rotation.

By default, a new video render opens the assigned profile immediately instead
of waiting for a 120-second lease window. The normal ProxyFB rotation and
health checks still run before an expired/invalid endpoint is used. Configure
`DOLA_VIDEO_PROXY_MIN_REMAINING_SEC=120` only when a deployment intentionally
wants to skip leases with less than 120 seconds remaining.

After `changeProxy`, Gateway first waits 60 seconds, then checks the new
endpoint with ProxyFB's own `https://proxyfb.com/check.php` checker. If the
checker still reports a failure, it polls again every 10 seconds at 70, 80,
90, 100, 110, and 120 seconds. The candidate endpoint is saved only after a
successful check; a failed rotation never overwrites the last known endpoint.
The verification result is cached for 30 seconds during one startup flow.
Configure `DOLA_PROXYFB_IP_ACTIVATION_WAIT_SEC`,
`DOLA_PROXYFB_IP_ACTIVATION_MAX_WAIT_SEC`,
`DOLA_PROXYFB_IP_CHECK_INTERVAL_SEC`,
`DOLA_PROXYFB_IP_CHECK_MAX_ATTEMPTS`, `DOLA_PROXYFB_IP_CHECK_TIMEOUT_SEC`,
`DOLA_PROXYFB_IP_CHECK_CACHE_SEC`, or `DOLA_PROXYFB_IP_CHECK_URL` when the
network/provider requires different values.

The corresponding admin endpoints are `GET /api/admin/proxies`,
`POST /api/admin/proxies/bulk`, `POST /api/admin/proxies/bulk-test`,
`POST /api/admin/proxies/bulk-delete`, `POST /api/admin/accounts/bulk-proxy`,
`POST /api/admin/accounts/distribute-proxy`,
`POST /api/admin/proxies/proxyfb`, `POST /api/admin/proxies/proxyfb/bulk`,
`POST /api/admin/proxies/bulk-rotate`,
plus the per-entry `PATCH`, `DELETE`, `/test`, and `/rotate` routes under
`/api/admin/proxies/{id}`. All of them require the Gateway `X-Admin-Key`.

`POST /api/admin/accounts/bulk-delete` accepts up to 100 profile names and
deletes their browser sessions and metadata in one request. Profiles with a
queued/running login or an active video-generation lock are skipped and
returned in the `failed` list.

`POST /api/admin/tasks/bulk-delete` accepts up to 100 task ids from the Studio
queue. Completed, failed, and unknown tasks are removed together with a local
video file under `DOLA_DOWNLOAD_DIR` when one exists. Queued, submitting, or
processing tasks are first marked `cancelled`, their local worker/poll task is
cancelled (closing the Playwright context/profile), and then their records are
removed. The response includes the active ids in `cancelled`; if Dola already
accepted a conversation, provider-side processing and credit are not
guaranteed to be reversible.


### 🌐 SonicVoice (For Voice Clone)

[![Website](https://img.shields.io/badge/Website-SonicVoice.pro-6366f1?style=for-the-badge&logo=google-chrome&logoColor=white)](https://sonicvoice.pro)

### 💬 Admin & Support

[![Telegram](https://img.shields.io/badge/Telegram-Bang%20Ngọc%20Thái-229ED9?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/BangNgocThai47271)

---

## 📜 License
For educational and internal testing purposes.

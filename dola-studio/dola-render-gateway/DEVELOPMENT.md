# Video Generation Gateway - Architecture & Technical Notes

Technical reference for the service architecture, profile coordination, and task pipeline.

---

## 1. Core Architecture

The system operates across three tiers:
1. **API Tier (`server.py`)**: FastAPI application exposing standard OpenAI video endpoints (`/v1/videos/generations`, `/v1/videos/<id>`) and web dashboard routes (`/web`, `/api/admin/*`).
2. **Pool Management Tier (`browser_pool.py`)**: Manages persistent browser profiles in `accounts/`, controlling task concurrency, account locking, and daily quota rotations.
3. **Execution Tier (`video_worker_ui.py`, `video_worker.py`)**:
   - **UI Automation Mode**: Automates browser interactions, authenticates via persistent browser session, injects prompts, and handles verification challenges.
   - **Protocol Mode**: Sends structured SSE requests to completion endpoints and polls status endpoints for video rendering progress.

---

## 2. Duration Configuration

- The browser module manages duration parameters (`5s`, `10s`, `15s`) via request interception.
- Synchronizes with client action bar configuration to present extended duration selections.
- The Dola30 extension is based on the original GitHub extension. Its only
  functional capability change is replacing the injected `30s` duration with
  `15s`; its native model remains Seedance 2.0 Fast. Studio/Gateway default to
  that model, while the API/worker retain aliases for historical 2.5 tasks.

---

## 3. Prompt safety rewrite

Before a task is saved or typed into Dola, `prompt_format.video_prompt` applies
the deterministic rewrite in `prompt_safety.py`. Specific third-party
characters/franchises become original fictional characters or settings;
graphic violence becomes non-graphic action; and nudity/sexual content becomes
fully clothed, non-sexual presentation. The rewrite is semantic and
transparent: it never inserts look-alike characters or obfuscates words to
evade moderation. The worker logs only rewrite categories/counts and does not
log the prompt text.

If a request remains disallowed after this safe rewrite, Dola's rejection is
kept as a real provider rejection for operator review rather than retried in a
loop.

The same normalization removes explicit 5s, 10s, 15s, and 30s wording (including
second/seconds and giây spellings) from the free-text prompt. The structured task
duration is preserved, so this only prevents natural-language text from overriding
the extension capability check.

---

## 4. High-Definition Stream Processing

- Video rendering status is monitored through the event stream.
- On completion, the worker reads the signed `fallback_api` embedded in
  `video_model`, requests the `channel=no` / `codec_type=8` /
  `logo_type=unwatermarked` variant, decrypts qAAB/AES `main_url` tokens in
  the authenticated browser page, and downloads that original stream to
  `downloads/`.
- The normal `download_url` remains a last-resort fallback when the signed
  original resource cannot be resolved. Before that fallback is exposed, the
  worker applies an FFmpeg `delogo` pass to Dola's known dynamic-logo regions.
  `video_metadata` includes `watermark_free`, `watermark_removed`, and
  `media_source` so the dashboard can show whether the source was original or
  cleaned during download. If FFmpeg is unavailable, the task fails rather
  than returning a watermarked file. `/videos/*` responses are `no-store` to
  avoid serving an older cached response through the Cloudflare tunnel.

---

## 5. Verification Handling

- Handles verification challenges using automated visual template alignment to ensure reliable background execution.

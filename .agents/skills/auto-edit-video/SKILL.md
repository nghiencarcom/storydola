---
name: auto-edit-video
description: >-
  Guides Antigravity and Code Agents in building and refining Auto Edit Video timelines
  in StoryAI using Whisper word-level timestamps, Remotion Player/@remotion/captions,
  and deterministic HyperFrames HTML/CSS motion cards.
---

# Auto Edit Video Skill (Whisper + Remotion + HyperFrames)

Use this skill when editing or extending StoryAI's **Auto Edit Video** (`/auto-edit`) pipeline or authoring programmatic overlays and smart-cut Edit Decision Lists (`auto-edit-edl.v1`).

## Architecture & File Map

- **Domain Schema & Timeline Mapper**: `app/lib/auto-edit.ts`
  - `computeAutoEditTimeline()` maps `keep: true` segments onto contiguous output milliseconds, aligns word-level captions, and anchors overlays.
  - `sanitizeHyperframesMarkup()` strips unsafe tags/attributes so HyperFrames HTML/CSS remains 100% deterministic.
- **Whisper + Acoustic VAD**: `app/lib/auto-edit-media.ts`
  - Supports `STORYAI_WHISPER_TRANSCRIBE_PATH`, Apple Silicon `whisperkit-cli`, `whisper-cli` (`whisper.cpp`), and OpenAI `whisper` CLI with automatic fallback to PCM RMS silence detection.
- **Code Agent CLI Director**: `app/lib/auto-edit-worker.ts` & `prompts/auto-edit-code-agent-guide.md`
  - Eliminates dead air, spoken hesitations, and semantic retakes/false starts; alternates dynamic punch-in zoom (`1.0x`–`1.18x`) across jump-cuts.
- **Remotion Live Preview**: `app/components/auto-edit-remotion-composition.tsx`
  - Uses `@remotion/player` and `@remotion/captions` (`createTikTokStyleCaptions`) for real-time interactive browser preview with TikTok/Reels Safe-Zone overlay.
- **HyperFrames + FFmpeg MP4 Renderer**: `app/lib/auto-edit-render.ts`
  - Seekable headless Chromium stage (`window.__seekAutoEditFrame(timeMs)`) driving CSS custom properties `--hf-progress` (`0..1`) and `--hf-enter` (`0..1`), muxed over EBU R128 loudness-normalized smart-cut A-roll.

## HyperFrames Authoring Rules

1. Keep HyperFrames fragments pure HTML + CSS (`div`, `span`, `strong`, `em`) without `<script>`, external `url()`, or network requests.
2. Drive animations deterministically from `var(--hf-progress)` (`0` to `1` across the overlay duration) and `var(--hf-enter)` (`0` to `1` over the first 260ms) rather than wall-clock timers so headless frame-seeking renders without jitter.
3. Respect social vertical `9:16` safe zones: avoid placing text or product cards in the bottom 22% (caption + shop cart) or lower-right 15% (engagement icons).

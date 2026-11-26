import { z } from "zod";
import { getSfxById, isValidSfxId, pickDefaultOverlaySfx } from "./sfx-library";

export const AUTO_EDIT_PRESETS = [
  {
    id: "ugc-review",
    label: "UGC Review tự nhiên",
    summary: "Giữ nhịp thở đời thường, lọc câu nói vấp/lặp ý, Hook 3s đối trọng và thẻ sản phẩm đúng điểm rơi.",
  },
  {
    id: "fast-tiktok",
    label: "TikTok / Reels nhịp nhanh",
    summary: "Cắt sát khoảng lặng, Dynamic Punch-in liên tục giấu jump-cut, phụ đề Karaoke & Emoji nảy mạnh.",
  },
  {
    id: "minimal-aesthetic",
    label: "Tối giản tinh tế",
    summary: "Chuyển cảnh mượt, thẻ sản phẩm kính mờ HyperFrames thanh lịch, tiết chế chữ và emoji.",
  },
  {
    id: "tech-unbox",
    label: "Unbox & Thông số",
    summary: "Nhấn mạnh chi tiết cận cảnh, bảng Spec Card HyperFrames rõ ràng và điểm nhấn ưu/nhược điểm.",
  },
] as const;

export type AutoEditPresetId = (typeof AUTO_EDIT_PRESETS)[number]["id"];
export type AutoEditAspectRatio = "9:16" | "16:9" | "1:1";
export type AutoEditStage = "uploading" | "queued" | "analyzing_media" | "directing" | "ready" | "rendering" | "rendered" | "failed";
export type AutoEditTranscriptKind = "whisper_words" | "whisper_segments" | "manual" | "acoustic_only";
export type AutoEditCutReason = "silence" | "hesitation" | "retake" | "dead_air" | "off_topic" | "manual";
export type AutoEditOverlayKind = "hook_banner" | "product_card" | "callout_pill" | "emoji_burst";
export type AutoEditCardLayout = "floating-right" | "floating-left" | "split-top" | "center-pop";
export type AutoEditHighlightColor = "amber" | "emerald" | "rose" | "cyan";

export const autoEditPresetSchema = z.enum(["ugc-review", "fast-tiktok", "minimal-aesthetic", "tech-unbox"]);
export const autoEditAspectSchema = z.enum(["9:16", "16:9", "1:1"]);
export const autoEditVerticalFitSchema = z.enum(["auto", "blur-fit", "fill-crop"]);
export type AutoEditVerticalFit = z.infer<typeof autoEditVerticalFitSchema>;

export const autoEditOptionsSchema = z.object({
  title: z.string().trim().max(180).default(""),
  sourceUrl: z.string().trim().max(1_000).default(""),
  preset: autoEditPresetSchema.default("ugc-review"),
  aspectRatio: autoEditAspectSchema.default("9:16"),
  verticalFit: autoEditVerticalFitSchema.default("auto"),
  language: z.enum(["vi", "en"]).default("vi"),
  productName: z.string().trim().max(160).default(""),
  productHighlights: z.string().trim().max(2_000).default(""),
  direction: z.string().trim().max(2_000).default(""),
  manualTranscript: z.string().trim().max(24_000).default(""),
  silenceThresholdMs: z.number().int().min(250).max(2_000).default(450),
  voiceTargetPeakDb: z.number().min(-3).max(-0.3).default(-1.2),
  autoSfx: z.boolean().default(true),
  sfxVolumeDb: z.number().min(-26).max(-4).default(-8.5),
  safeZoneGuard: z.boolean().default(true),
});

export type AutoEditOptions = z.infer<typeof autoEditOptionsSchema>;

export type AutoEditSourceVideo = {
  id: string;
  filename: string;
  extension: string;
  size: number;
  order: number;
  durationMs?: number;
  width?: number;
  height?: number;
  aspectRatio?: AutoEditAspectRatio;
  hasAudio?: boolean;
};

export type AutoEditProductImage = {
  id: string;
  filename: string;
  extension: string;
  size: number;
  width: number;
  height: number;
  label: string;
};

export type AutoEditWord = {
  id: string;
  clipId: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  filler?: boolean;
};

export type AutoEditPause = {
  clipId: string;
  startMs: number;
  endMs: number;
  reason: "silence" | "dead_air";
};

export type AutoEditSegment = {
  id: string;
  clipId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  keep: boolean;
  cutReason?: AutoEditCutReason;
  zoom: number;
  zoomFocusY: number;
  transcriptText: string;
  note?: string;
};

export type AutoEditKeywordHighlight = {
  word: string;
  color: AutoEditHighlightColor;
  emoji?: string;
};

export type AutoEditOverlay = {
  id: string;
  kind: AutoEditOverlayKind;
  anchorSegmentId?: string;
  offsetMs: number;
  durationMs: number;
  imageId?: string;
  layout: AutoEditCardLayout;
  badge?: string;
  title: string;
  subtitle?: string;
  priceTag?: string;
  emoji?: string;
  accentColor?: AutoEditHighlightColor;
  /** ID from assets/sfx/catalog.json, or "none" to mute SFX on this overlay. */
  sfxId?: string;
  sfxVolumeDb?: number;
  /** Optional safe HyperFrames HTML fragment using CSS var(--hf-progress) for deterministic frame seeking. */
  hyperframesHtml?: string;
  hyperframesCss?: string;
};

export type AutoEditSfxCue = {
  id: string;
  sfxId: string;
  anchorSegmentId?: string;
  offsetMs: number;
  volumeDb?: number;
  note?: string;
};

export type AutoEditEdl = {
  schema: "auto-edit-edl.v1";
  title: string;
  summary: string;
  hookHeadline: string;
  hookSubtext?: string;
  hookEmoji?: string;
  captionStyle: "karaoke-pop" | "clean-pill" | "minimal-line";
  segments: AutoEditSegment[];
  overlays: AutoEditOverlay[];
  sfxCues?: AutoEditSfxCue[];
  keywordHighlights: AutoEditKeywordHighlight[];
  directorNotes: string[];
};

export type AutoEditAnalysis = {
  transcriptKind: AutoEditTranscriptKind;
  whisperBackend?: string;
  rawDurationMs: number;
  inputMaxVolumeDb?: number;
  inputMeanVolumeDb?: number;
  words: AutoEditWord[];
  pauses: AutoEditPause[];
};

export type AutoEditRenderInfo = {
  status: "idle" | "rendering" | "ready" | "failed";
  outputPath?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
  sizeBytes?: number;
  maxVolumeDb?: number;
  speechPeakDb?: number;
  meanVolumeDb?: number;
  updatedAt: string;
  error?: string;
};

export type AutoEditJob = {
  id: string;
  options: AutoEditOptions;
  status: AutoEditStage;
  progress?: string;
  error?: string;
  agentLabel?: string;
  videos: AutoEditSourceVideo[];
  images: AutoEditProductImage[];
  analysis?: AutoEditAnalysis;
  edl?: AutoEditEdl;
  render?: AutoEditRenderInfo;
  createdAt: string;
  updatedAt: string;
};

export type AutoEditJobSummary = {
  id: string;
  title: string;
  preset: AutoEditPresetId;
  aspectRatio: AutoEditAspectRatio;
  status: AutoEditStage;
  progress?: string;
  error?: string;
  videoCount: number;
  imageCount: number;
  rawDurationMs?: number;
  editedDurationMs?: number;
  cutCount?: number;
  renderReady: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ComputedTimelineSegment = AutoEditSegment & {
  timelineStartMs: number;
  timelineEndMs: number;
  durationMs: number;
};

export type ComputedTimelineWord = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number | null;
  highlightColor?: AutoEditHighlightColor;
  emoji?: string;
};

export type ComputedTimelineOverlay = AutoEditOverlay & {
  timelineStartMs: number;
  timelineEndMs: number;
};

export type ComputedTimelineSfxEvent = {
  id: string;
  sfxId: string;
  filename: string;
  label: string;
  timelineStartMs: number;
  durationMs: number;
  peakDb: number;
  volumeDb: number;
};

export type ComputedAutoEditTimeline = {
  fps: number;
  width: number;
  height: number;
  totalDurationMs: number;
  rawDurationMs: number;
  savedDurationMs: number;
  cutCount: number;
  keptSegments: ComputedTimelineSegment[];
  words: ComputedTimelineWord[];
  overlays: ComputedTimelineOverlay[];
  sfxEvents: ComputedTimelineSfxEvent[];
};

export const agentAutoEditGenerationSchema = z.object({
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().min(1).max(1_200),
  hookHeadline: z.string().trim().min(1).max(90),
  hookSubtext: z.string().trim().max(120).optional().default(""),
  hookEmoji: z.string().trim().max(16).optional().default("🔥"),
  captionStyle: z.enum(["karaoke-pop", "clean-pill", "minimal-line"]).default("karaoke-pop"),
  segments: z.array(z.object({
    id: z.string().trim().min(1).max(64),
    clipId: z.string().trim().min(1).max(64),
    sourceStartMs: z.number().min(0),
    sourceEndMs: z.number().min(1),
    keep: z.boolean(),
    cutReason: z.enum(["silence", "hesitation", "retake", "dead_air", "off_topic", "manual"]).optional(),
    zoom: z.number().min(1).max(1.35).optional().default(1),
    zoomFocusY: z.number().min(0.15).max(0.85).optional().default(0.38),
    transcriptText: z.string().trim().max(600).default(""),
    note: z.string().trim().max(260).optional(),
  })).min(1).max(1_200),
  overlays: z.array(z.object({
    id: z.string().trim().min(1).max(64).optional(),
    kind: z.enum(["hook_banner", "product_card", "callout_pill", "emoji_burst"]),
    anchorSegmentId: z.string().trim().max(64).optional(),
    offsetMs: z.number().min(0).max(600_000).default(0),
    durationMs: z.number().min(600).max(20_000).default(3_000),
    imageId: z.string().trim().max(64).optional(),
    layout: z.enum(["floating-right", "floating-left", "split-top", "center-pop"]).optional().default("floating-right"),
    badge: z.string().trim().max(48).optional(),
    title: z.string().trim().max(110).default(""),
    subtitle: z.string().trim().max(160).optional(),
    priceTag: z.string().trim().max(48).optional(),
    emoji: z.string().trim().max(16).optional(),
    accentColor: z.enum(["amber", "emerald", "rose", "cyan"]).optional().default("amber"),
    sfxId: z.string().trim().max(80).optional(),
    sfxVolumeDb: z.number().min(-32).max(-6).optional(),
    hyperframesHtml: z.string().max(4_000).optional(),
    hyperframesCss: z.string().max(4_000).optional(),
  })).max(60).default([]),
  sfxCues: z.array(z.object({
    id: z.string().trim().min(1).max(64).optional(),
    sfxId: z.string().trim().min(1).max(80),
    anchorSegmentId: z.string().trim().max(64).optional(),
    offsetMs: z.number().min(0).max(600_000).default(0),
    volumeDb: z.number().min(-32).max(-6).optional(),
    note: z.string().trim().max(160).optional(),
  })).max(60).default([]),
  keywordHighlights: z.array(z.object({
    word: z.string().trim().min(1).max(48),
    color: z.enum(["amber", "emerald", "rose", "cyan"]).default("amber"),
    emoji: z.string().trim().max(16).optional(),
  })).max(40).default([]),
  directorNotes: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
});

export function autoEditDimensions(aspectRatio: AutoEditAspectRatio) {
  if (aspectRatio === "16:9") return { width: 1280, height: 720, fps: 30 };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080, fps: 30 };
  return { width: 720, height: 1280, fps: 30 };
}

const VIETNAMESE_FILLERS = new Set([
  "ờ", "ờm", "à", "ừm", "ưm", "uh", "um", "erm", "hmm", "kiểu",
]);

export function isLikelyFillerWord(word: string) {
  const cleaned = word.toLowerCase().replace(/[.,!?;:"'()[\]{}…—–-]+/gu, "").trim();
  return VIETNAMESE_FILLERS.has(cleaned);
}

/**
 * Sanitizes HyperFrames HTML/CSS authored by Code Agent so only safe, deterministic
 * markup and styles render inside the preview & headless Chromium compositor.
 */
export function sanitizeHyperframesMarkup(html?: string, css?: string): { html?: string; css?: string } {
  const cleanHtml = html
    ? html
      .replace(/<\s*(?:script|iframe|object|embed|link|meta|base|form|input|button|textarea|select)[^>]*>[\s\S]*?<\s*\/\s*(?:script|iframe|object|embed|link|meta|base|form|input|button|textarea|select)\s*>/giu, "")
      .replace(/<\s*(?:script|iframe|object|embed|link|meta|base|form|input|button|textarea|select)[^>]*\/?\s*>/giu, "")
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, "")
      .replace(/(?:href|src|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, "")
      .trim()
      .slice(0, 4_000)
    : undefined;

  const cleanCss = css
    ? css
      .replace(/@import[^;]+;?/giu, "")
      .replace(/url\s*\([^)]*\)/giu, "none")
      .replace(/expression\s*\([^)]*\)/giu, "none")
      .replace(/<\s*\/?\s*style[^>]*>/giu, "")
      .trim()
      .slice(0, 4_000)
    : undefined;

  return {
    html: cleanHtml || undefined,
    css: cleanCss || undefined,
  };
}

function normalizeLookupToken(value: string) {
  return value.toLowerCase().replace(/[.,!?;:"'()[\]{}…—–-]+/gu, "").trim();
}

export function computeAutoEditTimeline(
  edl: AutoEditEdl,
  words: readonly AutoEditWord[],
  aspectRatio: AutoEditAspectRatio,
  rawDurationMsInput?: number,
  sfxOptions?: { autoSfx?: boolean; sfxVolumeDb?: number },
): ComputedAutoEditTimeline {
  const { width, height, fps } = autoEditDimensions(aspectRatio);
  let cursorMs = 0;
  const keptSegments: ComputedTimelineSegment[] = [];
  let cutCount = 0;
  let computedRawMs = 0;

  for (const seg of edl.segments) {
    const segDur = Math.max(0, Math.round(seg.sourceEndMs - seg.sourceStartMs));
    computedRawMs += segDur;
    if (!seg.keep || segDur < 120) {
      if (!seg.keep) cutCount += 1;
      continue;
    }
    const timelineStartMs = cursorMs;
    const timelineEndMs = cursorMs + segDur;
    keptSegments.push({
      ...seg,
      timelineStartMs,
      timelineEndMs,
      durationMs: segDur,
    });
    cursorMs = timelineEndMs;
  }

  const totalDurationMs = Math.max(cursorMs, 0);
  const rawDurationMs = Math.max(rawDurationMsInput || 0, computedRawMs, totalDurationMs);
  const savedDurationMs = Math.max(0, rawDurationMs - totalDurationMs);

  const highlightMap = new Map<string, AutoEditKeywordHighlight>();
  for (const item of edl.keywordHighlights) {
    for (const token of item.word.split(/\s+/u)) {
      const normalized = normalizeLookupToken(token);
      if (normalized.length >= 2 && !highlightMap.has(normalized)) {
        highlightMap.set(normalized, item);
      }
    }
  }

  const mappedWords: ComputedTimelineWord[] = [];
  for (const seg of keptSegments) {
    const clipWords = words.filter(
      (word) => word.clipId === seg.clipId && word.endMs > seg.sourceStartMs + 20 && word.startMs < seg.sourceEndMs - 20,
    );
    for (const word of clipWords) {
      const clampedStart = Math.max(seg.sourceStartMs, word.startMs);
      const clampedEnd = Math.min(seg.sourceEndMs, Math.max(clampedStart + 40, word.endMs));
      const outStart = seg.timelineStartMs + (clampedStart - seg.sourceStartMs);
      const outEnd = Math.min(seg.timelineEndMs, seg.timelineStartMs + (clampedEnd - seg.sourceStartMs));
      const normalized = normalizeLookupToken(word.text);
      const highlight = highlightMap.get(normalized);
      mappedWords.push({
        id: `${seg.id}_${word.id}`,
        text: word.text.startsWith(" ") ? word.text : ` ${word.text}`,
        startMs: Math.round(outStart),
        endMs: Math.round(Math.max(outStart + 40, outEnd)),
        confidence: word.confidence ?? 0.95,
        highlightColor: highlight?.color,
        emoji: highlight?.emoji,
      });
    }
  }

  const segmentById = new Map(keptSegments.map((seg) => [seg.id, seg]));
  const computedOverlays: ComputedTimelineOverlay[] = [];
  for (const overlay of edl.overlays) {
    let startMs = Math.max(0, Math.round(overlay.offsetMs));
    if (overlay.anchorSegmentId) {
      const anchor = segmentById.get(overlay.anchorSegmentId);
      if (!anchor) continue;
      startMs = anchor.timelineStartMs + Math.max(0, Math.round(overlay.offsetMs));
    }
    if (totalDurationMs <= 0 || startMs >= totalDurationMs) continue;
    const endMs = Math.min(totalDurationMs, startMs + Math.max(600, Math.round(overlay.durationMs)));
    if (endMs - startMs < 350) continue;
    computedOverlays.push({
      ...overlay,
      timelineStartMs: startMs,
      timelineEndMs: endMs,
    });
  }

  computedOverlays.sort((a, b) => a.timelineStartMs - b.timelineStartMs);

  const sfxEnabled = sfxOptions?.autoSfx !== false;
  const baseSfxDb = Math.min(-4, Math.max(-26, sfxOptions?.sfxVolumeDb ?? -8.5));
  const rawSfxCandidates: ComputedTimelineSfxEvent[] = [];

  if (sfxEnabled && totalDurationMs > 0) {
    // 1. Overlay-bound SFX (Hook Banner, HyperFrames Product Cards, Callouts, Emojis)
    for (const ov of computedOverlays) {
      if (ov.sfxId === "none") continue;
      const entry = getSfxById(ov.sfxId);
      if (!entry) continue;
      rawSfxCandidates.push({
        id: `sfx_ov_${ov.id}`,
        sfxId: entry.id,
        filename: entry.filename,
        label: entry.label,
        timelineStartMs: ov.timelineStartMs,
        durationMs: Math.min(entry.durationMs, 2_400),
        peakDb: entry.peakDb,
        volumeDb: ov.sfxVolumeDb ?? baseSfxDb,
      });
    }

    // 2. Explicit standalone Agent SFX cues
    for (let i = 0; i < (edl.sfxCues || []).length; i++) {
      const cue = edl.sfxCues![i];
      const entry = getSfxById(cue.sfxId);
      if (!entry) continue;
      let startMs = Math.max(0, Math.round(cue.offsetMs));
      if (cue.anchorSegmentId) {
        const anchor = segmentById.get(cue.anchorSegmentId);
        if (!anchor) continue;
        startMs = anchor.timelineStartMs + Math.max(0, Math.round(cue.offsetMs));
      }
      if (startMs >= totalDurationMs) continue;
      rawSfxCandidates.push({
        id: cue.id || `sfx_cue_${i + 1}`,
        sfxId: entry.id,
        filename: entry.filename,
        label: entry.label,
        timelineStartMs: startMs,
        durationMs: Math.min(entry.durationMs, 2_400),
        peakDb: entry.peakDb,
        volumeDb: cue.volumeDb ?? baseSfxDb,
      });
    }

    // 3. Subtle transition whoosh on spaced jump-cut punch-in zooms (>= 5s apart)
    const subtleWhoosh = getSfxById("whoosh-soft");
    if (subtleWhoosh) {
      let lastTransitionMs = -5_000;
      for (let i = 1; i < keptSegments.length; i++) {
        const prev = keptSegments[i - 1];
        const cur = keptSegments[i];
        if (Math.abs(cur.zoom - prev.zoom) >= 0.08 && cur.timelineStartMs - lastTransitionMs >= 5_500) {
          rawSfxCandidates.push({
            id: `sfx_zoom_${cur.id}`,
            sfxId: subtleWhoosh.id,
            filename: subtleWhoosh.filename,
            label: subtleWhoosh.label,
            timelineStartMs: Math.max(0, cur.timelineStartMs - 60),
            durationMs: Math.min(subtleWhoosh.durationMs, 900),
            peakDb: subtleWhoosh.peakDb,
            volumeDb: Math.max(-30, baseSfxDb - 3),
          });
          lastTransitionMs = cur.timelineStartMs;
        }
      }
    }
  }

  rawSfxCandidates.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  const sfxEvents: ComputedTimelineSfxEvent[] = [];
  for (const candidate of rawSfxCandidates) {
    // Prevent overlapping SFX clutter within 240ms
    const prev = sfxEvents[sfxEvents.length - 1];
    if (prev && Math.abs(candidate.timelineStartMs - prev.timelineStartMs) < 240) {
      continue;
    }
    sfxEvents.push(candidate);
  }

  return {
    fps,
    width,
    height,
    totalDurationMs,
    rawDurationMs,
    savedDurationMs,
    cutCount,
    keptSegments,
    words: mappedWords,
    overlays: computedOverlays,
    sfxEvents,
  };
}

/**
 * Splits raw clip durations + pauses + words into candidate baseline segments
 * before Code Agent refines semantic retakes, zoom levels, and overlays.
 */
export function buildCandidateSegments(
  videos: readonly AutoEditSourceVideo[],
  words: readonly AutoEditWord[],
  pauses: readonly AutoEditPause[],
  silenceThresholdMs = 450,
): AutoEditSegment[] {
  const segments: AutoEditSegment[] = [];
  let counter = 1;

  for (const video of videos) {
    const durationMs = Math.max(500, Math.round(video.durationMs || 5_000));
    const clipPauses = pauses
      .filter((pause) => pause.clipId === video.id && pause.endMs - pause.startMs >= silenceThresholdMs)
      .sort((a, b) => a.startMs - b.startMs);

    const clipWords = words.filter((word) => word.clipId === video.id);
    const textInRange = (startMs: number, endMs: number) =>
      clipWords
        .filter((w) => w.endMs > startMs + 30 && w.startMs < endMs - 30)
        .map((w) => w.text.trim())
        .filter(Boolean)
        .join(" ")
        .trim();

    let cursor = 0;
    let keptInClip = 0;

    for (const pause of clipPauses) {
      const pStart = Math.max(cursor, Math.min(durationMs, Math.round(pause.startMs)));
      const pEnd = Math.max(pStart, Math.min(durationMs, Math.round(pause.endMs)));
      if (pStart - cursor >= 260) {
        const text = textInRange(cursor, pStart);
        const onlyFiller = Boolean(text) && text.split(/\s+/u).length <= 2 && text.split(/\s+/u).every(isLikelyFillerWord);
        const keep = !onlyFiller;
        if (keep) keptInClip += 1;
        segments.push({
          id: `seg_${String(counter++).padStart(3, "0")}`,
          clipId: video.id,
          sourceStartMs: cursor,
          sourceEndMs: pStart,
          keep,
          cutReason: onlyFiller ? "hesitation" : undefined,
          zoom: keep && keptInClip % 2 === 0 ? 1.12 : 1,
          zoomFocusY: 0.38,
          transcriptText: text,
        });
      }
      if (pEnd - pStart >= silenceThresholdMs) {
        segments.push({
          id: `seg_${String(counter++).padStart(3, "0")}`,
          clipId: video.id,
          sourceStartMs: pStart,
          sourceEndMs: pEnd,
          keep: false,
          cutReason: pause.reason,
          zoom: 1,
          zoomFocusY: 0.38,
          transcriptText: "",
          note: pause.reason === "dead_air" ? "Khoảng chết đầu/cuối clip" : `Khoảng lặng ${((pEnd - pStart) / 1000).toFixed(1)}s`,
        });
      }
      cursor = pEnd;
    }

    if (durationMs - cursor >= 260) {
      const text = textInRange(cursor, durationMs);
      keptInClip += 1;
      segments.push({
        id: `seg_${String(counter++).padStart(3, "0")}`,
        clipId: video.id,
        sourceStartMs: cursor,
        sourceEndMs: durationMs,
        keep: true,
        zoom: keptInClip % 2 === 0 ? 1.12 : 1,
        zoomFocusY: 0.38,
        transcriptText: text,
      });
    }
  }

  // Never allow 0 kept segments: keep the longest segment as safety fallback.
  if (segments.length > 0 && segments.every((seg) => !seg.keep)) {
    let longest = segments[0];
    for (const seg of segments) {
      if (seg.sourceEndMs - seg.sourceStartMs > longest.sourceEndMs - longest.sourceStartMs) longest = seg;
    }
    longest.keep = true;
    longest.cutReason = undefined;
  }

  return segments;
}

export function normalizeAgentAutoEditEdl(
  raw: unknown,
  videos: readonly AutoEditSourceVideo[],
  images: readonly AutoEditProductImage[],
  words: readonly AutoEditWord[],
  fallbackSegments: readonly AutoEditSegment[],
  options: AutoEditOptions,
): AutoEditEdl {
  const parsed = agentAutoEditGenerationSchema.parse(raw);
  const validClips = new Map(videos.map((v) => [v.id, v]));
  const validImages = new Set(images.map((img) => img.id));

  const normalizedSegments: AutoEditSegment[] = [];
  let idx = 1;
  for (const seg of parsed.segments) {
    const clip = validClips.get(seg.clipId);
    if (!clip) continue;
    const clipMaxMs = Math.max(500, Math.round(clip.durationMs || 600_000));
    const startMs = Math.max(0, Math.min(clipMaxMs - 120, Math.round(seg.sourceStartMs)));
    const endMs = Math.max(startMs + 120, Math.min(clipMaxMs, Math.round(seg.sourceEndMs)));
    const derivedText = seg.transcriptText.trim() || words
      .filter((w) => w.clipId === clip.id && w.endMs > startMs + 30 && w.startMs < endMs - 30)
      .map((w) => w.text.trim())
      .join(" ")
      .trim();

    normalizedSegments.push({
      id: seg.id || `seg_${String(idx).padStart(3, "0")}`,
      clipId: clip.id,
      sourceStartMs: startMs,
      sourceEndMs: endMs,
      keep: seg.keep,
      cutReason: seg.keep ? undefined : (seg.cutReason || "hesitation"),
      zoom: seg.keep ? Math.min(1.28, Math.max(1, Number((seg.zoom || 1).toFixed(3)))) : 1,
      zoomFocusY: Math.min(0.8, Math.max(0.2, Number((seg.zoomFocusY ?? 0.38).toFixed(2)))),
      transcriptText: derivedText,
      note: seg.note,
    });
    idx += 1;
  }

  const finalSegments = normalizedSegments.some((s) => s.keep)
    ? normalizedSegments
    : fallbackSegments.map((s) => ({ ...s }));

  const keptIds = new Set(finalSegments.filter((s) => s.keep).map((s) => s.id));
  const overlays: AutoEditOverlay[] = parsed.overlays.map((ov, index) => {
    const sanitized = sanitizeHyperframesMarkup(ov.hyperframesHtml, ov.hyperframesCss);
    const resolvedImageId = ov.imageId && validImages.has(ov.imageId)
      ? ov.imageId
      : ov.kind === "product_card" && images[0]
        ? images[0].id
        : undefined;
    const resolvedAnchor = ov.anchorSegmentId && keptIds.has(ov.anchorSegmentId) ? ov.anchorSegmentId : undefined;
    const chosenSfx = ov.sfxId && isValidSfxId(ov.sfxId)
      ? ov.sfxId
      : options.autoSfx !== false
        ? pickDefaultOverlaySfx(ov, index, options.preset)
        : undefined;
    return {
      id: ov.id || `ov_${String(index + 1).padStart(2, "0")}`,
      kind: ov.kind,
      anchorSegmentId: resolvedAnchor,
      offsetMs: Math.max(0, Math.round(ov.offsetMs)),
      durationMs: Math.max(800, Math.min(15_000, Math.round(ov.durationMs))),
      imageId: resolvedImageId,
      layout: ov.layout || "floating-right",
      badge: ov.badge,
      title: ov.title || options.productName || parsed.hookHeadline,
      subtitle: ov.subtitle,
      priceTag: ov.priceTag,
      emoji: ov.emoji,
      accentColor: ov.accentColor || "amber",
      sfxId: chosenSfx,
      sfxVolumeDb: ov.sfxVolumeDb,
      hyperframesHtml: sanitized.html,
      hyperframesCss: sanitized.css,
    };
  });

  // Guarantee a 0–3s Hook Banner if none was explicitly placed at the opening
  if (!overlays.some((ov) => ov.kind === "hook_banner")) {
    overlays.unshift({
      id: "ov_hook_00",
      kind: "hook_banner",
      offsetMs: 0,
      durationMs: 2_900,
      layout: "center-pop",
      badge: options.productName || undefined,
      title: parsed.hookHeadline,
      subtitle: parsed.hookSubtext || undefined,
      emoji: parsed.hookEmoji || "🔥",
      accentColor: options.preset === "minimal-aesthetic" ? "cyan" : "amber",
      sfxId: options.autoSfx !== false ? pickDefaultOverlaySfx({ kind: "hook_banner" }, 0, options.preset) : undefined,
    });
  }

  const sfxCues: AutoEditSfxCue[] = (parsed.sfxCues || [])
    .filter((cue) => isValidSfxId(cue.sfxId) && cue.sfxId !== "none")
    .map((cue, idx) => ({
      id: cue.id || `sfx_${String(idx + 1).padStart(2, "0")}`,
      sfxId: cue.sfxId.trim().toLowerCase(),
      anchorSegmentId: cue.anchorSegmentId && keptIds.has(cue.anchorSegmentId) ? cue.anchorSegmentId : undefined,
      offsetMs: Math.max(0, Math.round(cue.offsetMs)),
      volumeDb: cue.volumeDb,
      note: cue.note,
    }));

  return {
    schema: "auto-edit-edl.v1",
    title: parsed.title || options.title || options.productName || "Auto Edit Video",
    summary: parsed.summary,
    hookHeadline: parsed.hookHeadline,
    hookSubtext: parsed.hookSubtext || undefined,
    hookEmoji: parsed.hookEmoji || "🔥",
    captionStyle: parsed.captionStyle,
    segments: finalSegments,
    overlays,
    sfxCues,
    keywordHighlights: parsed.keywordHighlights,
    directorNotes: parsed.directorNotes,
  };
}

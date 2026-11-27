import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import { chromium } from "playwright-core";
import sharp, { type OverlayOptions } from "sharp";
import {
  computeAutoEditTimeline,
  sanitizeOverlayId,
  type AutoEditHighlightColor,
  type AutoEditJob,
  type AutoEditVerticalFit,
  type ComputedAutoEditTimeline,
  type ComputedTimelineOverlay,
} from "./auto-edit";
import { autoEditFfmpeg, measurePcmVoiceLevelsDb } from "./auto-edit-media";
import { readFile as readFileFs } from "node:fs/promises";
import { autoEditOwnerFolder, autoEditRoot } from "./auto-edit-upload";
import {
  claimAutoEditRenderLock,
  clearAutoEditRenderPending,
  getAutoEditJob,
  updateAutoEditJob,
} from "./auto-edit-worker";
import { ensureOverlayFonts, overlayEmojiFontFile, overlayTextFontFile } from "./overlay-fonts";

const exec = promisify(execFile);
const safeInputArgs = ["-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm"];

function findBrowserCandidates() {
  const paths = process.env.PATH?.split(path.delimiter).filter(Boolean) || [];
  const names = process.platform === "win32"
    ? ["chrome.exe", "msedge.exe"]
    : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "microsoft-edge"];
  const onPath = paths.flatMap((dir) => names.map((n) => path.join(dir, n)));
  const system = process.platform === "darwin"
    ? [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ]
    : process.platform === "win32"
      ? [
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
        process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
      ].filter((v): v is string => Boolean(v))
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"];
  let bundled = "";
  try {
    bundled = chromium.executablePath();
  } catch {
    // Fallback to system browser
  }
  return [process.env.STORYAI_BROWSER_PATH?.trim() || "", bundled, ...system, ...onPath].filter(Boolean);
}

async function resolveBrowserExecutable(): Promise<string | undefined> {
  for (const candidate of findBrowserCandidates()) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try next
    }
  }
  return undefined;
}

function accentHex(color?: AutoEditHighlightColor) {
  if (color === "emerald") return "#34d399";
  if (color === "rose") return "#fb7185";
  if (color === "cyan") return "#38bdf8";
  return "#fbbf24";
}

export function escapePangoText(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

export function shouldSkipVoiceNormalization(
  job: Pick<AutoEditJob, "videos" | "analysis">,
): boolean {
  if (!job.videos.some((v) => v.hasAudio)) return true;
  if ((job.analysis?.words.length ?? 0) === 0 && (job.analysis?.inputMaxVolumeDb ?? -90) < -42) {
    return true;
  }
  return false;
}

export function buildSegmentFramingFilter(opts: {
  width: number;
  height: number;
  fps: number;
  zoom: number;
  zoomFocusY: number;
  isLandscapeSource: boolean;
  verticalFit: AutoEditVerticalFit;
  clipWidth?: number;
  clipHeight?: number;
  audioFilter?: string;
}):
  | { mode: "blur-canvas"; filterComplex: string; fgH: number }
  | { mode: "aurora-stage"; filterComplex: string; fgW: number; fgH: number }
  | { mode: "contain" | "cover"; vf: string } {
  const { width, height, fps, isLandscapeSource, verticalFit, clipWidth, clipHeight, audioFilter } = opts;
  const clampedZoom = Math.max(1, opts.zoom);
  const clampedFocusY = Math.min(1, Math.max(0, opts.zoomFocusY));
  const scaledW = Math.round((width * clampedZoom) / 2) * 2;
  const scaledH = Math.round((height * clampedZoom) / 2) * 2;

  if (verticalFit === "aurora-3d") {
    const padX = height > width ? 28 : 88;
    const fgW = Math.max(64, Math.round(((width - padX) / 2)) * 2);
    const scaledFgW = Math.max(fgW, Math.round(((fgW * clampedZoom) / 2)) * 2);
    const rawFgH = clipWidth && clipHeight
      ? Math.max(2, Math.round(((fgW * clipHeight) / clipWidth) / 2) * 2)
      : Math.round(((fgW * 9) / 16) / 2) * 2;
    const fgH = Math.min(Math.max(64, height - 48), rawFgH);
    const filterComplex = [
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=36:6,eq=brightness=-0.32:saturation=1.45,colorbalance=bs=0.28:bm=0.16:gs=0.05,fps=${fps}[bg]`,
      `[0:v]scale=${scaledFgW}:-2,crop=${fgW}:${fgH}:(iw-${fgW})/2:min(ih-${fgH}\\,max(0\\,(ih-${fgH})*${clampedFocusY.toFixed(3)})),fps=${fps}[fg]`,
      "[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[vout]",
      ...(audioFilter ? [`[0:a]${audioFilter}[aout]`] : []),
    ].join(";");
    return { mode: "aurora-stage", filterComplex, fgW, fgH };
  }

  const useVerticalBlurCanvas =
    height > width &&
    (verticalFit === "blur-fit" || (verticalFit === "auto" && isLandscapeSource));

  if (useVerticalBlurCanvas) {
    const rawFgH = clipWidth && clipHeight
      ? Math.max(2, Math.round(((width * clipHeight) / clipWidth) / 2) * 2)
      : Math.round(((width * 9) / 16) / 2) * 2;
    const fgH = Math.min(height, rawFgH);
    const filterComplex = [
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:4,eq=brightness=-0.20,fps=${fps}[bg]`,
      `[0:v]scale=${scaledW}:-2,crop=${width}:${fgH}:(iw-${width})/2:min(ih-${fgH}\\,max(0\\,(ih-${fgH})*${clampedFocusY.toFixed(3)})),fps=${fps}[fg]`,
      "[bg][fg]overlay=0:(H-h)/2,format=yuv420p[vout]",
      ...(audioFilter ? [`[0:a]${audioFilter}[aout]`] : []),
    ].join(";");
    return { mode: "blur-canvas", filterComplex, fgH };
  }

  // Only use contain (decrease + pad) at zoom <= 1.02 when source orientation matches landscape
  if (isLandscapeSource && width > height && clampedZoom <= 1.02) {
    const vf = [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:#0b0f19`,
      `fps=${fps}`,
      "format=yuv420p",
    ].join(",");
    return { mode: "contain", vf };
  }

  const vf = [
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}:(iw-${width})/2:min(ih-${height}\\,max(0\\,(ih-${height})*${clampedFocusY.toFixed(3)}))`,
    `fps=${fps}`,
    "format=yuv420p",
  ].join(",");
  return { mode: "cover", vf };
}

async function renderSegmentClip(
  sourceFile: string,
  hasAudio: boolean,
  isLandscapeSource: boolean,
  verticalFit: AutoEditVerticalFit,
  clipWidth: number | undefined,
  clipHeight: number | undefined,
  startMs: number,
  durationMs: number,
  width: number,
  height: number,
  fps: number,
  zoom: number,
  zoomFocusY: number,
  outPath: string,
) {
  const startSec = (startMs / 1000).toFixed(3);
  const durSec = Math.max(0.12, durationMs / 1000).toFixed(3);
  const fadeOutStart = Math.max(0, Number(durSec) - 0.035).toFixed(3);
  const af = `aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,afade=t=in:st=0:d=0.025,afade=t=out:st=${fadeOutStart}:d=0.030`;

  const framing = buildSegmentFramingFilter({
    width,
    height,
    fps,
    zoom,
    zoomFocusY,
    isLandscapeSource,
    verticalFit,
    clipWidth,
    clipHeight,
    audioFilter: hasAudio ? af : undefined,
  });

  if ("filterComplex" in framing) {
    const blurArgs = hasAudio
      ? [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", startSec,
        "-t", durSec,
        ...safeInputArgs,
        "-i", sourceFile,
        "-filter_complex", framing.filterComplex,
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-c:a", "pcm_s16le",
        outPath,
      ]
      : [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", startSec,
        "-t", durSec,
        ...safeInputArgs,
        "-i", sourceFile,
        "-f", "lavfi", "-t", durSec, "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-filter_complex", framing.filterComplex,
        "-map", "[vout]", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-c:a", "pcm_s16le",
        "-shortest",
        outPath,
      ];
    await exec(autoEditFfmpeg(), blurArgs, { timeout: 180_000, maxBuffer: 8_000_000 });
    return;
  }

  const args = hasAudio
    ? [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-ss", startSec,
      "-t", durSec,
      ...safeInputArgs,
      "-i", sourceFile,
      "-vf", framing.vf,
      "-af", af,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
      "-c:a", "pcm_s16le",
      outPath,
    ]
    : [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-ss", startSec,
      "-t", durSec,
      ...safeInputArgs,
      "-i", sourceFile,
      "-f", "lavfi", "-t", durSec, "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-map", "0:v:0", "-map", "1:a:0",
      "-vf", framing.vf,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
      "-c:a", "pcm_s16le",
      "-shortest",
      outPath,
    ];

  await exec(autoEditFfmpeg(), args, { timeout: 180_000, maxBuffer: 8_000_000 });
}

export async function measureMediaVoiceLevelsDb(filePath: string): Promise<{
  maxVolumeDb: number;
  speechPeakDb: number;
  meanVolumeDb: number;
}> {
  let volMaxDb: number | undefined;
  let volMeanDb: number | undefined;
  try {
    const { stderr } = await exec(
      autoEditFfmpeg(),
      ["-nostdin", "-hide_banner", ...safeInputArgs, "-i", filePath, "-vn", "-af", "volumedetect", "-f", "null", "-"],
      { timeout: 60_000, maxBuffer: 4_000_000 },
    );
    const maxMatch = stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/u);
    const meanMatch = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/u);
    if (maxMatch) volMaxDb = Number(maxMatch[1]);
    if (meanMatch) volMeanDb = Number(meanMatch[1]);
  } catch {
    // Fallback to PCM measurement below
  }

  try {
    const { stdout: pcm } = await exec(
      autoEditFfmpeg(),
      ["-nostdin", "-hide_banner", "-loglevel", "error", ...safeInputArgs, "-i", filePath, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"],
      { timeout: 60_000, maxBuffer: 48_000_000, encoding: "buffer" },
    );
    const pcmStats = measurePcmVoiceLevelsDb(pcm, 8000);
    return {
      maxVolumeDb: volMaxDb ?? pcmStats.maxVolumeDb,
      speechPeakDb: pcmStats.speechPeakDb,
      meanVolumeDb: volMeanDb ?? pcmStats.meanVolumeDb,
    };
  } catch {
    return {
      maxVolumeDb: volMaxDb ?? -1.5,
      speechPeakDb: volMaxDb ?? -1.8,
      meanVolumeDb: volMeanDb ?? -14.0,
    };
  }
}

async function buildBaseCutVideo(
  job: AutoEditJob,
  timeline: ComputedAutoEditTimeline,
  mediaDir: string,
  workDir: string,
): Promise<{ baseVideoPath: string; audioStats: { maxVolumeDb: number; speechPeakDb: number; meanVolumeDb: number } }> {
  const clipById = new Map(job.videos.map((v) => [v.id, v]));
  const segFiles: string[] = [];

  for (let i = 0; i < timeline.keptSegments.length; i++) {
    const seg = timeline.keptSegments[i];
    const clip = clipById.get(seg.clipId);
    if (!clip) continue;
    const srcPath = path.join(mediaDir, "videos", `${clip.id}${clip.extension}`);
    const segOut = path.join(workDir, `seg_${String(i).padStart(3, "0")}.mkv`);
    const isLandscapeSource = clip.width && clip.height
      ? clip.width > clip.height * 1.12
      : clip.aspectRatio === "16:9";
    await renderSegmentClip(
      srcPath,
      Boolean(clip.hasAudio),
      Boolean(isLandscapeSource),
      job.options.verticalFit || "auto",
      clip.width,
      clip.height,
      seg.sourceStartMs,
      seg.durationMs,
      timeline.width,
      timeline.height,
      timeline.fps,
      seg.zoom,
      seg.zoomFocusY,
      segOut,
    );
    segFiles.push(segOut);
  }

  if (!segFiles.length) {
    throw new Error("Không có phân đoạn hợp lệ nào được giữ lại để xuất video.");
  }

  const concatList = path.join(workDir, "concat.txt");
  await writeFile(
    concatList,
    segFiles.map((f) => `file '${f.replace(/'/gu, "'\\''")}'`).join("\n"),
    { mode: 0o600 },
  );

  const pass1Out = path.join(workDir, "base_pass1.mp4");
  if (shouldSkipVoiceNormalization(job)) {
    await exec(
      autoEditFfmpeg(),
      [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", concatList,
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        pass1Out,
      ],
      { timeout: 240_000, maxBuffer: 8_000_000 },
    );
    const silentStats = job.videos.some((v) => v.hasAudio)
      ? await measureMediaVoiceLevelsDb(pass1Out)
      : { maxVolumeDb: -90, speechPeakDb: -90, meanVolumeDb: -90 };
    return { baseVideoPath: pass1Out, audioStats: silentStats };
  }

  // Pass 1: Vocal high-pass + dynamic speech leveling + EBU R128 broadcast density (-12.5 LUFS, LRA 6)
  const targetPeakDb = Math.min(-0.4, Math.max(-2.8, job.options.voiceTargetPeakDb ?? -1.2));
  const pass1AudioFilter = [
    "highpass=f=80",
    "acompressor=threshold=-22dB:ratio=3.5:attack=6:release=110:makeup=4.5dB",
    "loudnorm=I=-12.5:TP=-1.0:LRA=6",
  ].join(",");

  await exec(
    autoEditFfmpeg(),
    [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "concat", "-safe", "0", "-i", concatList,
      "-c:v", "copy",
      "-af", pass1AudioFilter,
      "-c:a", "aac", "-b:a", "192k",
      pass1Out,
    ],
    { timeout: 240_000, maxBuffer: 8_000_000 },
  );

  const pass1Stats = await measureMediaVoiceLevelsDb(pass1Out);
  // Pass 2: Calibrate active voice peak strictly into [0 dB .. -3 dB] (default -1.2 dB, brickwall ceiling -0.4 dB)
  const referenceDb = pass1Stats.speechPeakDb > -45 ? pass1Stats.speechPeakDb : pass1Stats.maxVolumeDb;
  const gainDeltaDb = Number(Math.min(18, Math.max(-12, targetPeakDb - referenceDb)).toFixed(2));

  const baseOut = path.join(workDir, "base_master.mp4");
  if (Math.abs(gainDeltaDb) >= 0.35 || pass1Stats.maxVolumeDb > -0.3 || pass1Stats.speechPeakDb < -2.9) {
    // alimiter limit in linear amplitude: 10^(-0.5 / 20) = 0.944 (~ -0.5 dBFS hard ceiling, never > 0 dB)
    const pass2Filter = `volume=${gainDeltaDb}dB,alimiter=limit=0.944:attack=3:release=45:level=disabled`;
    await exec(
      autoEditFfmpeg(),
      [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", pass1Out,
        "-c:v", "copy",
        "-af", pass2Filter,
        "-c:a", "aac", "-b:a", "192k",
        baseOut,
      ],
      { timeout: 180_000, maxBuffer: 8_000_000 },
    );
    const finalStats = await measureMediaVoiceLevelsDb(baseOut);
    return { baseVideoPath: baseOut, audioStats: finalStats };
  }

  return { baseVideoPath: pass1Out, audioStats: pass1Stats };
}

function buildHyperframesStageHtml(
  job: AutoEditJob,
  timeline: ComputedAutoEditTimeline,
  imageDataUrls: Record<string, string>,
  fontBoldBase64: string,
  fontEmojiBase64: string,
) {
  const remotionCaptions: Caption[] = timeline.words.map((w) => ({
    text: w.text,
    startMs: w.startMs,
    endMs: w.endMs,
    timestampMs: Math.round((w.startMs + w.endMs) / 2),
    confidence: w.confidence,
  }));

  const { pages } = createTikTokStyleCaptions({
    captions: remotionCaptions,
    combineTokensWithinMilliseconds: 1050,
  });

  // Attach highlight & emoji metadata onto caption tokens
  const wordMetaByStart = new Map(timeline.words.map((w) => [`${w.startMs}:${w.text.trim()}`, w]));
  const enrichedPages = pages.map((page) => ({
    startMs: page.startMs,
    endMs: page.startMs + page.durationMs,
    tokens: page.tokens.map((tok) => {
      const meta = wordMetaByStart.get(`${tok.fromMs}:${tok.text.trim()}`);
      return {
        text: tok.text,
        fromMs: tok.fromMs,
        toMs: tok.toMs,
        color: meta?.highlightColor ? accentHex(meta.highlightColor) : null,
        emoji: meta?.emoji || null,
      };
    }),
  }));

  const customStyles = timeline.overlays
    .map((ov, idx) => {
      const safeId = sanitizeOverlayId(ov.id, `ov_${idx}`);
      return ov.hyperframesCss ? `/* ov_${idx} */ #hf-card-${safeId} { ${ov.hyperframesCss} }` : "";
    })
    .filter(Boolean)
    .join("\n");

  const safeBottomPx = job.options.safeZoneGuard && job.options.aspectRatio === "9:16"
    ? Math.round(timeline.height * 0.22)
    : Math.round(timeline.height * 0.1);

  const stagePayload = JSON.stringify({
    width: timeline.width,
    height: timeline.height,
    verticalFit: job.options.verticalFit || "auto",
    motionBlur: job.options.motionBlur !== false,
    overlays: timeline.overlays.map((ov, idx) => ({
      ...ov,
      safeId: sanitizeOverlayId(ov.id, `ov_${idx}`),
    })),
    pages: enrichedPages,
    images: imageDataUrls,
    captionStyle: job.edl?.captionStyle || "karaoke-pop",
  }).replace(/</gu, "\\u003c");

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: "StoryAINoto";
    src: url("data:font/ttf;base64,${fontBoldBase64}") format("truetype");
    font-weight: 700 900;
  }
  @font-face {
    font-family: "StoryAIEmoji";
    src: url("data:font/ttf;base64,${fontEmojiBase64}") format("truetype");
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${timeline.width}px;
    height: ${timeline.height}px;
    overflow: hidden;
    background: transparent;
    font-family: "StoryAINoto", "StoryAIEmoji", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  #stage {
    position: relative;
    width: ${timeline.width}px;
    height: ${timeline.height}px;
  }
  .hook-banner {
    position: absolute;
    top: ${Math.round(timeline.height * 0.075)}px;
    left: 50%;
    transform: translateX(-50%) scale(var(--hf-scale, 1));
    max-width: 88%;
    padding: 14px 22px;
    border-radius: 20px;
    background: rgba(15, 23, 42, 0.88);
    border: 2px solid var(--hf-accent, #fbbf24);
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.42);
    color: #fff;
    text-align: center;
  }
  .hook-badge {
    display: inline-block;
    padding: 3px 10px;
    margin-bottom: 6px;
    border-radius: 999px;
    background: var(--hf-accent, #fbbf24);
    color: #0f172a;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .hook-title {
    font-size: ${timeline.width >= 1000 ? 34 : 27}px;
    font-weight: 900;
    line-height: 1.2;
    text-shadow: 0 2px 10px rgba(0,0,0,.45);
  }
  .hook-sub {
    margin-top: 5px;
    color: #e2e8f0;
    font-size: 15px;
  }
  .product-card {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    border-radius: 22px;
    background: rgba(15, 23, 42, 0.86);
    border: 1.5px solid rgba(255, 255, 255, 0.22);
    box-shadow: 0 20px 44px rgba(0, 0, 0, 0.45);
    color: #fff;
    max-width: ${Math.round(timeline.width * 0.78)}px;
  }
  .product-card.floating-right {
    top: ${Math.round(timeline.height * 0.16)}px;
    right: 26px;
  }
  .product-card.floating-left {
    top: ${Math.round(timeline.height * 0.16)}px;
    left: 26px;
  }
  .product-card.split-top {
    top: ${Math.round(timeline.height * 0.08)}px;
    left: 50%;
    width: 88%;
    max-width: 88%;
  }
  .product-card.center-pop {
    top: ${Math.round(timeline.height * 0.22)}px;
    left: 50%;
  }
  .product-card.stage-3d {
    top: ${Math.round(timeline.height * 0.15)}px;
    right: 28px;
    overflow: hidden;
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.94) 0%, rgba(30, 41, 59, 0.88) 100%);
    border: 1.5px solid var(--hf-accent, #34d399);
    box-shadow: 0 26px 56px rgba(0, 0, 0, 0.6), 0 0 28px rgba(52, 211, 153, 0.22);
  }
  .stage-3d-sheen {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 32%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.16), transparent);
    transform: skewX(-22deg);
    pointer-events: none;
  }
  .product-thumb {
    width: ${timeline.width >= 1000 ? 116 : 96}px;
    height: ${timeline.width >= 1000 ? 116 : 96}px;
    border-radius: 16px;
    object-fit: cover;
    background: #fff;
    flex-shrink: 0;
    border: 2px solid var(--hf-accent, #34d399);
  }
  .product-meta { min-width: 0; flex: 1; }
  .product-badge-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; flex-wrap: wrap; }
  .product-badge {
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--hf-accent, #34d399);
    color: #0f172a;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }
  .product-price {
    padding: 2px 9px;
    border-radius: 999px;
    background: rgba(251, 191, 36, 0.22);
    color: #fde68a;
    font-size: 12px;
    font-weight: 800;
  }
  .product-title { font-size: 20px; font-weight: 800; line-height: 1.22; }
  .product-sub { margin-top: 4px; color: #cbd5e1; font-size: 14px; line-height: 1.35; }
  .callout-pill {
    position: absolute;
    top: ${Math.round(timeline.height * 0.14)}px;
    left: 50%;
    padding: 10px 20px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.9);
    border: 2px solid var(--hf-accent, #38bdf8);
    color: #fff;
    font-size: 21px;
    font-weight: 800;
    box-shadow: 0 12px 28px rgba(0,0,0,.38);
    white-space: nowrap;
  }
  .caption-zone {
    position: absolute;
    left: 6%;
    right: ${job.options.safeZoneGuard && job.options.aspectRatio === "9:16" ? "14%" : "6%"};
    bottom: ${safeBottomPx}px;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .caption-inner {
    display: inline-flex;
    width: fit-content;
    max-width: 100%;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 8px 14px;
    text-align: center;
  }
  .cap-word {
    display: inline-block;
    font-size: ${timeline.width >= 1000 ? 36 : 31}px;
    font-weight: 900;
    line-height: 1.2;
    color: #ffffff;
    text-shadow: 0 3px 0 #090d16, 0 -2px 0 #090d16, 3px 0 0 #090d16, -3px 0 0 #090d16, 0 8px 20px rgba(0,0,0,.65);
  }
  .cap-word.active {
    color: var(--word-accent, #fbbf24);
  }
  .cap-word.active.pop {
    transform: scale(1.12);
  }
  .cap-pill-box {
    padding: 9px 22px;
    border-radius: 16px;
    background: rgba(10, 14, 24, 0.84);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
  }
  ${customStyles}
</style>
</head>
<body>
<div id="stage"></div>
<script>
  const DATA = ${stagePayload};
  const stage = document.getElementById("stage");

  function accentHex(c) {
    if (c === "emerald") return "#34d399";
    if (c === "rose") return "#fb7185";
    if (c === "cyan") return "#38bdf8";
    return "#fbbf24";
  }

  function esc(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  window.__seekAutoEditFrame = function(timeMs) {
    const parts = [];
    const W = DATA.width;
    const H = DATA.height;

    if (DATA.verticalFit === "aurora-3d") {
      // Deterministic 3D wireframe octahedra projected in margin space around Aurora stage
      const crystals = [
        { cx: W * 0.12, cy: H * 0.14, r: 28, speed: 0.0011, phase: 0.4, color: "#38bdf8" },
        { cx: W * 0.88, cy: H * 0.16, r: 24, speed: 0.0014, phase: 1.9, color: "#818cf8" },
        { cx: W * 0.14, cy: H * 0.86, r: 22, speed: 0.0012, phase: 3.1, color: "#34d399" },
        { cx: W * 0.87, cy: H * 0.84, r: 26, speed: 0.0010, phase: 4.5, color: "#fbbf24" },
      ];
      const baseVerts = [
        [0, -1, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, 1, 0],
      ];
      const edges = [
        [0,1],[0,2],[0,3],[0,4],[5,1],[5,2],[5,3],[5,4],[1,2],[2,3],[3,4],[4,1],
      ];
      let svgLines = "";
      for (const c of crystals) {
        const ay = timeMs * c.speed + c.phase;
        const ax = timeMs * c.speed * 0.7 + c.phase;
        const cySin = Math.sin(ay), cyCos = Math.cos(ay);
        const cxSin = Math.sin(ax), cxCos = Math.cos(ax);
        const bobY = Math.sin(timeMs * 0.0016 + c.phase) * 10;
        const pts = baseVerts.map(([vx, vy, vz]) => {
          const x1 = vx * cyCos - vz * cySin;
          const z1 = vx * cySin + vz * cyCos;
          const y2 = vy * cxCos - z1 * cxSin;
          const z2 = vy * cxSin + z1 * cxCos;
          const p = 180 / (180 + z2 * 28);
          return [c.cx + x1 * c.r * p, c.cy + bobY + y2 * c.r * p];
        });
        for (const [i, j] of edges) {
          svgLines += '<line x1="' + pts[i][0].toFixed(1) + '" y1="' + pts[i][1].toFixed(1) + '" x2="' + pts[j][0].toFixed(1) + '" y2="' + pts[j][1].toFixed(1) + '" stroke="' + c.color + '" stroke-opacity="0.38" stroke-width="1.6" />';
        }
      }
      parts.push('<svg width="' + W + '" height="' + H + '" style="position:absolute;inset:0;pointer-events:none">' + svgLines + '</svg>');
    }

    for (const ov of DATA.overlays) {
      if (timeMs < ov.timelineStartMs || timeMs >= ov.timelineEndMs) continue;
      const dur = Math.max(1, ov.timelineEndMs - ov.timelineStartMs);
      const elapsed = timeMs - ov.timelineStartMs;
      const progress = Math.min(1, Math.max(0, elapsed / dur));
      const enter = Math.min(1, elapsed / 260);
      const exit = Math.min(1, (ov.timelineEndMs - timeMs) / 220);
      const visibility = Math.min(enter, exit);
      const scale = (0.88 + 0.12 * visibility).toFixed(3);
      const opacity = visibility.toFixed(3);
      const accent = accentHex(ov.accentColor);
      const blurId = "mblur-" + ov.safeId;
      const blurPx = DATA.motionBlur && elapsed < 220 ? ((1 - elapsed / 220) * 11).toFixed(1) : "0";
      const useBlur = Number(blurPx) > 0.6;
      const filterCss = useBlur ? ";filter:url(#" + blurId + ")" : "";
      if (useBlur) {
        parts.push('<svg width="0" height="0" style="position:absolute"><defs><filter id="' + blurId + '"><feGaussianBlur in="SourceGraphic" stdDeviation="' + blurPx + ',0" /></filter></defs></svg>');
      }

      if (ov.kind === "spotlight_box") {
        const cx = Math.round((ov.targetX ?? 0.5) * W);
        const cy = Math.round((ov.targetY ?? 0.52) * H);
        const bw = Math.round((ov.targetW ?? 0.28) * W);
        const bh = Math.round((ov.targetH ?? 0.13) * H);
        const x0 = Math.max(12, cx - Math.round(bw / 2));
        const y0 = Math.max(12, cy - Math.round(bh / 2));
        const rx = Math.min(22, Math.round(Math.min(bw, bh) * 0.28));
        const drawT = Math.min(1, Math.max(0, elapsed / 360));
        const arrowT = Math.min(1, Math.max(0, (drawT - 0.25) / 0.75));
        const rectPath = "M " + (x0 + rx) + " " + y0 + " H " + (x0 + bw - rx) + " Q " + (x0 + bw) + " " + y0 + " " + (x0 + bw) + " " + (y0 + rx) + " V " + (y0 + bh - rx) + " Q " + (x0 + bw) + " " + (y0 + bh) + " " + (x0 + bw - rx) + " " + (y0 + bh) + " H " + (x0 + rx) + " Q " + x0 + " " + (y0 + bh) + " " + x0 + " " + (y0 + bh - rx) + " V " + (y0 + rx) + " Q " + x0 + " " + y0 + " " + (x0 + rx) + " " + y0 + " Z";
        const arrowStartY = Math.max(28, y0 - 58);
        const arrowPath = "M " + (cx + 56) + " " + arrowStartY + " Q " + (cx + 32) + " " + (y0 - 24) + " " + (cx + 8) + " " + (y0 - 6);
        const pillLeft = Math.min(W - 260, Math.max(16, cx - 90));
        const pillTop = Math.max(14, arrowStartY - 36);
        parts.push(
          '<div style="position:absolute;inset:0;opacity:' + opacity + ';pointer-events:none">' +
            '<svg width="' + W + '" height="' + H + '" style="position:absolute;inset:0">' +
              '<path d="' + rectPath + '" pathLength="1000" fill="none" stroke="' + accent + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1000" stroke-dashoffset="' + ((1 - drawT) * 1000).toFixed(1) + '" style="filter:drop-shadow(0 0 12px ' + accent + ')" />' +
              '<path d="' + arrowPath + '" pathLength="1000" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-dasharray="1000" stroke-dashoffset="' + ((1 - arrowT) * 1000).toFixed(1) + '" />' +
            '</svg>' +
            (ov.title ? '<div style="position:absolute;left:' + pillLeft + 'px;top:' + pillTop + 'px;padding:6px 14px;border-radius:999px;background:' + accent + ';color:#0f172a;font-size:16px;font-weight:900;box-shadow:0 10px 24px rgba(0,0,0,.45);transform:scale(' + scale + ')">' + (ov.emoji ? esc(ov.emoji) + ' ' : '') + esc(ov.title) + '</div>' : '') +
          '</div>'
        );
      } else if (ov.kind === "highlighter") {
        const cx = Math.round((ov.targetX ?? 0.5) * W);
        const cy = Math.round((ov.targetY ?? 0.5) * H);
        const bw = Math.round((ov.targetW ?? 0.34) * W);
        const bh = Math.round((ov.targetH ?? 0.065) * H);
        const wipe = Math.min(1, Math.max(0, elapsed / 280)).toFixed(3);
        const left = cx - Math.round(bw / 2);
        const top = cy - Math.round(bh / 2);
        parts.push(
          '<div style="position:absolute;inset:0;opacity:' + opacity + ';pointer-events:none">' +
            '<div style="position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + bw + 'px;height:' + bh + 'px;border-radius:8px;background:linear-gradient(90deg,' + accent + '88,' + accent + 'cc);box-shadow:0 0 24px ' + accent + '66;transform:skewX(-8deg) scaleX(' + wipe + ');transform-origin:0% 50%"></div>' +
            (ov.title ? '<div style="position:absolute;left:' + cx + 'px;top:' + Math.max(14, top - 38) + 'px;transform:translateX(-50%);padding:4px 12px;border-radius:8px;background:rgba(15,23,42,.92);border:1.5px solid ' + accent + ';color:#fff;font-size:15px;font-weight:800;white-space:nowrap">' + (ov.emoji ? esc(ov.emoji) + ' ' : '') + esc(ov.title) + '</div>' : '') +
          '</div>'
        );
      } else if (ov.kind === "freeze_frame") {
        const flashAlpha = Math.max(0, 1 - elapsed / 190) * 0.72;
        const pad = Math.round(Math.min(W, H) * 0.06);
        const arm = 34;
        const hudPath = "M " + pad + " " + (pad + arm) + " V " + pad + " H " + (pad + arm) + " M " + (W - pad - arm) + " " + pad + " H " + (W - pad) + " V " + (pad + arm) + " M " + pad + " " + (H - pad - arm) + " V " + (H - pad) + " H " + (pad + arm) + " M " + (W - pad - arm) + " " + (H - pad) + " H " + (W - pad) + " V " + (H - pad - arm);
        parts.push(
          '<div style="position:absolute;inset:0;opacity:' + opacity + ';pointer-events:none">' +
            (flashAlpha > 0.01 ? '<div style="position:absolute;inset:0;background:rgba(255,255,255,' + flashAlpha.toFixed(3) + ')"></div>' : '') +
            '<svg width="' + W + '" height="' + H + '" style="position:absolute;inset:0"><path d="' + hudPath + '" fill="none" stroke="' + accent + '" stroke-width="4" stroke-linecap="round" /></svg>' +
            '<div style="position:absolute;top:' + (pad + 14) + 'px;left:' + (pad + 18) + 'px;display:inline-flex;align-items:center;gap:8px;padding:5px 14px;border-radius:999px;background:rgba(15,23,42,.88);border:1.5px solid ' + accent + ';color:#fff;font-size:14px;font-weight:800">' +
              '<span style="width:9px;height:9px;border-radius:99px;background:#ef4444;display:inline-block"></span>' +
              esc(ov.badge || "SNAPSHOT FOCUS") + ' · ' + esc(ov.title) +
            '</div>' +
          '</div>'
        );
      } else if (ov.kind === "hook_banner") {
        parts.push(
          '<div class="hook-banner" style="opacity:' + opacity + ';--hf-scale:' + scale + ';--hf-progress:' + progress.toFixed(3) + ';--hf-accent:' + accent + filterCss + '">' +
            (ov.badge ? '<div class="hook-badge">' + esc(ov.badge) + '</div>' : '') +
            '<div class="hook-title">' + (ov.emoji ? esc(ov.emoji) + ' ' : '') + esc(ov.title) + '</div>' +
            (ov.subtitle ? '<div class="hook-sub">' + esc(ov.subtitle) + '</div>' : '') +
          '</div>'
        );
      } else if (ov.kind === "product_card") {
        const imgSrc = ov.imageId && DATA.images[ov.imageId] ? DATA.images[ov.imageId] : "";
        const isStage3d = ov.layout === "stage-3d";
        const rotY = (-13 + progress * 17).toFixed(2);
        const rotX = (7 - progress * 9).toFixed(2);
        const transformVal = isStage3d
          ? "perspective(1050px) rotateY(" + rotY + "deg) rotateX(" + rotX + "deg) scale(" + scale + ")"
          : (ov.layout === "split-top" || ov.layout === "center-pop" ? "translateX(-50%) " : "") + "scale(" + scale + ")";
        const sheenHtml = isStage3d
          ? '<div class="stage-3d-sheen" style="left:' + Math.round(-35 + progress * 150) + '%"></div>'
          : '';
        parts.push(
          '<div id="hf-card-' + esc(ov.safeId) + '" class="product-card ' + esc(ov.layout) + '" style="opacity:' + opacity + ';transform:' + transformVal + ';--hf-progress:' + progress.toFixed(3) + ';--hf-enter:' + enter.toFixed(3) + ';--hf-accent:' + accent + filterCss + '">' +
            sheenHtml +
            (imgSrc ? '<img class="product-thumb" src="' + imgSrc + '" alt="" />' : '') +
            '<div class="product-meta">' +
              '<div class="product-badge-row">' +
                (ov.badge ? '<span class="product-badge">' + esc(ov.badge) + '</span>' : '') +
                (ov.priceTag ? '<span class="product-price">' + esc(ov.priceTag) + '</span>' : '') +
              '</div>' +
              '<div class="product-title">' + (ov.emoji ? esc(ov.emoji) + ' ' : '') + esc(ov.title) + '</div>' +
              (ov.subtitle ? '<div class="product-sub">' + esc(ov.subtitle) + '</div>' : '') +
              (ov.hyperframesHtml || '') +
            '</div>' +
          '</div>'
        );
      } else {
        parts.push(
          '<div class="callout-pill" style="opacity:' + opacity + ';transform:translateX(-50%) scale(' + scale + ');--hf-accent:' + accent + filterCss + '">' +
            (ov.emoji ? esc(ov.emoji) + ' ' : '') + esc(ov.title) +
          '</div>'
        );
      }
    }

    const activePage = DATA.pages.find((p) => timeMs >= p.startMs && timeMs <= p.endMs);
    if (activePage && activePage.tokens.length) {
      const wordsHtml = activePage.tokens.map((t) => {
        const isCurrent = timeMs >= t.fromMs && timeMs <= t.toMs + 60;
        const popCls = isCurrent && DATA.captionStyle === "karaoke-pop" ? " pop" : "";
        const accent = t.color || "#fbbf24";
        const suffixEmoji = isCurrent && t.emoji ? " " + esc(t.emoji) : "";
        return '<span class="cap-word' + (isCurrent ? ' active' + popCls : '') + '" style="--word-accent:' + accent + '">' + esc(t.text.trim()) + suffixEmoji + '</span>';
      }).join(" ");
      parts.push(
        '<div class="caption-zone"><div class="caption-inner' + (DATA.captionStyle === "clean-pill" ? ' cap-pill-box' : '') + '">' + wordsHtml + '</div></div>'
      );
    }

    stage.innerHTML = parts.join("");
  };
</script>
</body>
</html>`;
}

async function compositeWithHyperframesChromium(
  browserPath: string,
  baseVideoPath: string,
  outVideoPath: string,
  job: AutoEditJob,
  timeline: ComputedAutoEditTimeline,
  mediaDir: string,
) {
  const [fontBoldBuf, fontEmojiBuf] = await Promise.all([
    readFile(overlayTextFontFile),
    readFile(overlayEmojiFontFile),
  ]);

  const imageDataUrls: Record<string, string> = {};
  for (const img of job.images) {
    try {
      const raw = await readFile(path.join(mediaDir, "images", `${img.id}.png`));
      imageDataUrls[img.id] = `data:image/png;base64,${raw.toString("base64")}`;
    } catch {
      // Ignore missing image
    }
  }

  const html = buildHyperframesStageHtml(
    job,
    timeline,
    imageDataUrls,
    fontBoldBuf.toString("base64"),
    fontEmojiBuf.toString("base64"),
  );

  // 15 fps overlay stream gives crisp karaoke + smooth transitions while rendering 2x faster
  const overlayFps = timeline.totalDurationMs <= 30_000 ? 20 : 15;
  const totalFrames = Math.max(1, Math.ceil((timeline.totalDurationMs / 1000) * overlayFps));

  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
  });

  try {
    const page = await browser.newPage({
      viewport: { width: timeline.width, height: timeline.height },
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);

    await new Promise<void>((resolve, reject) => {
      const ffmpegProc = spawn(
        autoEditFfmpeg(),
        [
          "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
          "-i", baseVideoPath,
          "-f", "image2pipe", "-framerate", String(overlayFps), "-c:v", "png", "-i", "pipe:0",
          "-filter_complex", "[0:v][1:v]overlay=0:0:shortest=1,format=yuv420p[v]",
          "-map", "[v]", "-map", "0:a:0",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
          "-c:a", "copy",
          "-movflags", "+faststart",
          outVideoPath,
        ],
        { stdio: ["pipe", "ignore", "pipe"] },
      );

      let stderr = "";
      ffmpegProc.stderr?.setEncoding("utf8");
      ffmpegProc.stderr?.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-4_000);
      });
      ffmpegProc.on("error", reject);
      ffmpegProc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg HyperFrames mux failed (${code}): ${stderr.trim()}`));
      });

      (async () => {
        try {
          for (let frame = 0; frame < totalFrames; frame++) {
            const timeMs = Math.round((frame * 1000) / overlayFps);
            await page.evaluate((ms) => {
              (window as unknown as { __seekAutoEditFrame: (t: number) => void }).__seekAutoEditFrame(ms);
            }, timeMs);
            const png = await page.screenshot({ type: "png", omitBackground: true });
            const canContinue = ffmpegProc.stdin.write(png);
            if (!canContinue) {
              await new Promise<void>((drainResolve) => ffmpegProc.stdin.once("drain", drainResolve));
            }
          }
          ffmpegProc.stdin.end();
        } catch (err) {
          ffmpegProc.kill("SIGTERM");
          reject(err);
        }
      })();
    });
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * Fallback Sharp/Pango static overlay compositor when headless Chrome is unavailable.
 */
async function compositeWithSharpFallback(
  baseVideoPath: string,
  outVideoPath: string,
  job: AutoEditJob,
  timeline: ComputedAutoEditTimeline,
  mediaDir: string,
  workDir: string,
) {
  await ensureOverlayFonts();
  const overlayPngs: Array<{ file: string; startSec: string; endSec: string }> = [];

  for (let i = 0; i < timeline.overlays.length && i < 24; i++) {
    const ov: ComputedTimelineOverlay = timeline.overlays[i];
    const cardPath = path.join(workDir, `sharp_ov_${i}.png`);
    const labelText = `${ov.emoji ? `${ov.emoji} ` : ""}${ov.title}`.slice(0, 80) || " ";

    let thumb: Buffer | undefined;
    if (ov.kind === "product_card" && ov.imageId) {
      try {
        thumb = await sharp(path.join(mediaDir, "images", `${ov.imageId}.png`))
          .resize(84, 84, { fit: "cover" })
          .png()
          .toBuffer();
      } catch {
        thumb = undefined;
      }
    }

    const hasThumb = Boolean(thumb);
    const textLeft = hasThumb ? 114 : 24;
    const textTop = hasThumb ? 28 : 16;
    const constrainedTextW = Math.max(120, timeline.width - (ov.imageId ? 180 : 88));

    let textImg = await sharp({
      text: {
        text: escapePangoText(labelText),
        font: "Noto Sans Bold 28",
        fontfile: overlayTextFontFile,
        width: constrainedTextW,
        wrap: "word-char",
        rgba: true,
      },
    }).png().toBuffer();

    let meta = await sharp(textImg).metadata();
    const maxAllowedTextW = Math.max(60, timeline.width - 20 - textLeft - 24);
    const maxAllowedTextH = Math.max(40, timeline.height - 60 - textTop - 16);
    if ((meta.width || 0) > maxAllowedTextW || (meta.height || 0) > maxAllowedTextH) {
      textImg = await sharp(textImg)
        .resize(maxAllowedTextW, maxAllowedTextH, { fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
      meta = await sharp(textImg).metadata();
    }

    const cardW = Math.min(
      timeline.width,
      Math.max(Math.min(340, timeline.width - 20), textLeft + (meta.width || 0) + 24),
    );
    const cardH = Math.min(
      timeline.height,
      Math.max(hasThumb ? 116 : 76, textTop + (meta.height || 44) + 16),
    );

    const composites: OverlayOptions[] = hasThumb && thumb
      ? [
        { input: thumb, left: 16, top: 16 },
        { input: textImg, left: textLeft, top: textTop },
      ]
      : [{ input: textImg, left: textLeft, top: textTop }];

    const cardBuf = await sharp({
      create: {
        width: cardW,
        height: cardH,
        channels: 4,
        background: { r: 15, g: 23, b: 42, alpha: 0.88 },
      },
    })
      .composite(composites)
      .png()
      .toBuffer();

    const stageLeft = Math.max(0, Math.min(timeline.width - cardW, Math.round((timeline.width - cardW) / 2)));
    const stageTop = Math.max(0, Math.min(timeline.height - cardH, Math.round(timeline.height * 0.1)));

    await sharp({
      create: {
        width: timeline.width,
        height: timeline.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: cardBuf, left: stageLeft, top: stageTop }])
      .png()
      .toFile(cardPath);

    overlayPngs.push({
      file: cardPath,
      startSec: (ov.timelineStartMs / 1000).toFixed(2),
      endSec: (ov.timelineEndMs / 1000).toFixed(2),
    });
  }

  if (!overlayPngs.length) {
    await exec(autoEditFfmpeg(), [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-i", baseVideoPath, "-c", "copy", "-movflags", "+faststart", outVideoPath,
    ]);
    return;
  }

  const inputs = ["-i", baseVideoPath, ...overlayPngs.flatMap((o) => ["-i", o.file])];
  let currentLabel = "0:v";
  const filters: string[] = [];
  overlayPngs.forEach((o, idx) => {
    const nextLabel = idx === overlayPngs.length - 1 ? "vout" : `v${idx + 1}`;
    filters.push(`[${currentLabel}][${idx + 1}:v]overlay=0:0:enable='between(t,${o.startSec},${o.endSec})'[${nextLabel}]`);
    currentLabel = nextLabel;
  });

  await exec(
    autoEditFfmpeg(),
    [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", "[vout]", "-map", "0:a:0",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "copy", "-movflags", "+faststart",
      outVideoPath,
    ],
    { timeout: 240_000 },
  );
}

async function mixSfxIntoMasterVideo(
  voiceMasterPath: string,
  timeline: ComputedAutoEditTimeline,
  workDir: string,
): Promise<string> {
  if (!timeline.sfxEvents.length) return voiceMasterPath;

  const sfxRoots = [
    path.join(process.cwd(), "assets", "sfx"),
    path.resolve(process.cwd(), "..", "..", "assets", "sfx"),
  ];
  const validEvents = [];
  for (const ev of timeline.sfxEvents.slice(0, 40)) {
    const safeName = path.basename(ev.filename);
    for (const root of sfxRoots) {
      const file = path.join(root, safeName);
      try {
        const st = await stat(file);
        if (st.isFile()) {
          validEvents.push({ ...ev, file });
          break;
        }
      } catch {
        // Try next sfx root
      }
    }
  }
  if (!validEvents.length) return voiceMasterPath;

  const inputs = ["-i", voiceMasterPath, ...validEvents.flatMap((ev) => ["-i", ev.file])];
  const filterChains: string[] = [];
  const mixLabels: string[] = ["[0:a]"];

  validEvents.forEach((ev, idx) => {
    const inputIdx = idx + 1;
    const maxSec = Math.max(0.12, Math.min(2.4, ev.durationMs / 1000));
    const fadeStart = Math.max(0, maxSec - 0.12).toFixed(3);
    const gainDb = Number(Math.min(14, Math.max(-32, ev.volumeDb - ev.peakDb)).toFixed(2));
    const delayMs = Math.max(0, Math.round(ev.timelineStartMs));
    const delayFilter = delayMs > 0 ? `,adelay=${delayMs}|${delayMs}` : "";
    const label = `sfx${idx}`;
    filterChains.push(
      `[${inputIdx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${maxSec.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeStart}:d=0.12,volume=${gainDb}dB${delayFilter}[${label}]`,
    );
    mixLabels.push(`[${label}]`);
  });

  // normalize=0 preserves exact 0..-3dB voice level while alimiter=0.944 (-0.5dB) prevents clipping on SFX hits
  filterChains.push(
    `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.944:attack=3:release=40:level=disabled[aout]`,
  );

  const mixedOut = path.join(workDir, "base_with_sfx.mp4");
  await exec(
    autoEditFfmpeg(),
    [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      ...inputs,
      "-filter_complex", filterChains.join(";"),
      "-map", "0:v:0",
      "-map", "[aout]",
      "-c:v", "copy",
      "-c:a", "aac", "-b:a", "192k",
      mixedOut,
    ],
    { timeout: 180_000, maxBuffer: 8_000_000 },
  );

  return mixedOut;
}

export async function renderAutoEditMp4(owner: string, jobId: string): Promise<AutoEditJob> {
  return renderAutoEditMp4ByFolder(autoEditOwnerFolder(owner), jobId, await getAutoEditJob(owner, jobId));
}

export async function renderAutoEditMp4ByFolder(
  folder: string,
  jobId: string,
  preloadedJob?: AutoEditJob,
): Promise<AutoEditJob> {
  const releaseLock = await claimAutoEditRenderLock(folder, jobId);
  if (!releaseLock) {
    clearAutoEditRenderPending(jobId);
    throw new Error("Đang xuất MP4 cho bản dựng này.");
  }

  let workDir: string | undefined;
  try {
    const job = preloadedJob ?? await readFileFs(path.join(autoEditRoot, folder, `${jobId}.json`), "utf8")
      .then((raw) => JSON.parse(raw) as AutoEditJob)
      .catch(() => undefined);
    if (!job || !job.edl) {
      throw new Error("Không tìm thấy bản dựng Auto Edit để xuất MP4.");
    }

    const timeline = computeAutoEditTimeline(
      job.edl,
      job.analysis?.words || [],
      job.options.aspectRatio,
      job.analysis?.rawDurationMs,
      { autoSfx: job.options.autoSfx, sfxVolumeDb: job.options.sfxVolumeDb },
    );
    if (!timeline.keptSegments.length || timeline.totalDurationMs <= 0) {
      throw new Error("Bản dựng hiện không có đoạn video nào được giữ lại.");
    }

    const mediaDir = path.join(autoEditRoot, folder, "jobs", job.id);
    const rendersDir = path.join(mediaDir, "renders");
    await mkdir(rendersDir, { recursive: true, mode: 0o700 });
    const finalMp4Path = path.join(rendersDir, `auto-edit-${job.id}.mp4`);
    const relativeRenderPath = `renders/auto-edit-${job.id}.mp4`;

    await updateAutoEditJob(folder, job.id, (latest) => ({
      ...latest,
      status: "rendering",
      progress: "Đang cắt ghép A-roll, xử lý âm thanh & render lớp đồ hoạ HyperFrames + Captions...",
      render: {
        ...latest.render,
        status: "rendering",
        updatedAt: new Date().toISOString(),
      },
    }));

    workDir = await mkdtemp(path.join(tmpdir(), "storyai-ae-render-"));
    const { baseVideoPath: voiceMaster, audioStats: voiceOnlyStats } = await buildBaseCutVideo(job, timeline, mediaDir, workDir);
    const baseMaster = await mixSfxIntoMasterVideo(voiceMaster, timeline, workDir);
    const audioStats = baseMaster !== voiceMaster
      ? await measureMediaVoiceLevelsDb(baseMaster)
      : voiceOnlyStats;
    const browserPath = await resolveBrowserExecutable();
    if (browserPath) {
      await compositeWithHyperframesChromium(browserPath, baseMaster, finalMp4Path, job, timeline, mediaDir);
    } else {
      await compositeWithSharpFallback(baseMaster, finalMp4Path, job, timeline, mediaDir, workDir);
    }

    const details = await stat(finalMp4Path);
    const now = new Date().toISOString();
    const renderInfo: AutoEditJob["render"] = {
      status: "ready",
      outputPath: relativeRenderPath,
      durationMs: timeline.totalDurationMs,
      width: timeline.width,
      height: timeline.height,
      fps: timeline.fps,
      sizeBytes: details.size,
      maxVolumeDb: audioStats.maxVolumeDb,
      speechPeakDb: audioStats.speechPeakDb,
      meanVolumeDb: audioStats.meanVolumeDb,
      updatedAt: now,
    };

    const completed = await updateAutoEditJob(folder, job.id, (latest) => ({
      ...latest,
      status: "rendered",
      progress: undefined,
      render: renderInfo,
      updatedAt: now,
    }));
    return completed ?? { ...job, status: "rendered", progress: undefined, render: renderInfo, updatedAt: now };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Xuất video MP4 thất bại.";
    const now = new Date().toISOString();
    await updateAutoEditJob(folder, jobId, (latest) => ({
      ...latest,
      status: "ready",
      progress: undefined,
      render: {
        ...latest.render,
        status: "failed",
        error: message,
        updatedAt: now,
      },
      updatedAt: now,
    }));
    throw error;
  } finally {
    clearAutoEditRenderPending(jobId);
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
    await releaseLock();
  }
}

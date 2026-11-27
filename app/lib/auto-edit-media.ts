import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { access, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  isLikelyFillerWord,
  type AutoEditAnalysis,
  type AutoEditAspectRatio,
  type AutoEditOptions,
  type AutoEditPause,
  type AutoEditSourceVideo,
  type AutoEditTranscriptKind,
  type AutoEditWord,
} from "./auto-edit";
import { classifyRemakeSource } from "./video-remake-source";

const exec = promisify(execFile);

function resolveLocalBinary(binaryName: string, configured?: string): string {
  const trimmed = configured?.trim();
  if (trimmed) return trimmed;
  const searchDirs = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(homedir(), ".local", "bin"),
    ...(process.env.PATH || "").split(path.delimiter).filter(Boolean),
  ];
  for (const dir of searchDirs) {
    const candidate = path.join(dir, binaryName);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Check next search directory
    }
  }
  return binaryName;
}

export const autoEditFfmpeg = () =>
  resolveLocalBinary("ffmpeg", process.env.STORYAI_FFMPEG_PATH || process.env.VIBE_FFMPEG_PATH);

export const autoEditFfprobe = () => {
  const configured = process.env.STORYAI_FFPROBE_PATH?.trim();
  if (configured) return configured;
  const customFfmpeg = (process.env.STORYAI_FFMPEG_PATH || process.env.VIBE_FFMPEG_PATH)?.trim();
  if (customFfmpeg) {
    const sibling = path.join(path.dirname(customFfmpeg), "ffprobe");
    try {
      accessSync(sibling, constants.X_OK);
      return sibling;
    } catch {
      // Fall through to standard macOS/PATH search
    }
  }
  return resolveLocalBinary("ffprobe");
};

export const autoEditYtDlp = () =>
  resolveLocalBinary("yt-dlp", process.env.STORYAI_YT_DLP_PATH || process.env.VIBE_TOOL_YT_DLP_PATH);

const safeInputArgs = ["-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm"];

export type ContactSheetEvidence = {
  imagePath: string;
  rows: Array<{ clipId: string; filename: string; framesAtSec: number[] }>;
};

async function findExecutable(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Check next candidate
    }
  }
  return undefined;
}

async function findReadableFile(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate, constants.R_OK);
      const details = await stat(candidate);
      if (details.isFile()) return candidate;
    } catch {
      // Check next candidate
    }
  }
  return undefined;
}

export function extractStreamRotationDegrees(stream?: {
  side_data_list?: Array<{ rotation?: number | string }>;
  tags?: { rotate?: string | number };
}): number {
  if (!stream) return 0;
  const sideRotation = stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation;
  const raw = sideRotation !== undefined ? sideRotation : stream.tags?.rotate;
  const deg = Number(raw ?? 0);
  return Number.isFinite(deg) ? deg : 0;
}

export async function probeAutoEditVideo(filePath: string) {
  let stdout: string;
  try {
    ({ stdout } = await exec(
      autoEditFfprobe(),
      ["-v", "error", ...safeInputArgs, "-show_streams", "-show_format", "-of", "json", filePath],
      { timeout: 30_000, maxBuffer: 2_000_000 },
    ));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Cần cài FFmpeg và FFprobe trên máy chạy StoryAI.");
    }
    throw new Error(`Không đọc được tệp video (${path.basename(filePath)}).`);
  }

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type: string;
      width?: number;
      height?: number;
      duration?: string;
      disposition?: { attached_pic?: number };
      side_data_list?: Array<{ rotation?: number | string }>;
      tags?: { rotate?: string };
    }>;
  };

  const videoStreams = (parsed.streams || []).filter((s) => s.codec_type === "video");
  const videoIndex = videoStreams.findIndex((s) => s.width && s.height && !s.disposition?.attached_pic);
  const stream = videoStreams[videoIndex];
  const durationSec = Number(stream?.duration) || Number(parsed.format?.duration) || 0;
  if (!stream || !Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`Video "${path.basename(filePath)}" không có khung hình hoặc thời lượng hợp lệ.`);
  }

  const rotated = Math.abs(extractStreamRotationDegrees(stream)) % 180 === 90;
  const width = rotated ? stream.height! : stream.width!;
  const height = rotated ? stream.width! : stream.height!;
  const ratio = width / height;
  const aspectRatio: AutoEditAspectRatio = ratio < 0.85 ? "9:16" : ratio > 1.18 ? "16:9" : "1:1";
  const hasAudio = Boolean(parsed.streams?.some((s) => s.codec_type === "audio"));
  const hasSubtitle = Boolean(parsed.streams?.some((s) => s.codec_type === "subtitle"));

  return {
    durationMs: Math.max(200, Math.round(durationSec * 1000)),
    width,
    height,
    aspectRatio,
    hasAudio,
    hasSubtitle,
    videoIndex,
  };
}

function runFfmpegBuffer(args: string[], timeout = 45_000, maxBuffer = 32_000_000) {
  return exec(autoEditFfmpeg(), ["-nostdin", "-hide_banner", "-loglevel", "error", ...args], {
    timeout,
    maxBuffer,
    encoding: "buffer",
  });
}

/**
 * Extracts fine-grained acoustic pauses & dead air from raw 16-bit mono PCM.
 * Leaves a 65ms breathing pad on speech edges so consonant/vowel tails stay natural.
 */
export function measurePcmVoiceLevelsDb(pcm: Buffer, sampleRate: number): {
  maxVolumeDb: number;
  speechPeakDb: number;
  meanVolumeDb: number;
} {
  const totalSamples = Math.floor(pcm.length / 2);
  if (!totalSamples || sampleRate <= 0) {
    return { maxVolumeDb: -90, speechPeakDb: -90, meanVolumeDb: -90 };
  }

  const windowSamples = Math.max(1, Math.round(sampleRate * 0.1)); // 100ms speech windows
  let globalPeak = 0;
  let totalSq = 0;
  const windowPeaksDb: number[] = [];

  for (let pos = 0; pos < totalSamples; pos += windowSamples) {
    const end = Math.min(totalSamples, pos + windowSamples);
    let winPeak = 0;
    let winSq = 0;
    for (let i = pos; i < end; i++) {
      const sample = pcm.readInt16LE(i * 2) / 32768;
      const abs = Math.abs(sample);
      if (abs > winPeak) winPeak = abs;
      if (abs > globalPeak) globalPeak = abs;
      winSq += sample * sample;
    }
    totalSq += winSq;
    const winRms = Math.sqrt(winSq / (end - pos));
    const winRmsDb = winRms > 1e-5 ? 20 * Math.log10(winRms) : -90;
    const winPeakDb = winPeak > 1e-5 ? 20 * Math.log10(winPeak) : -90;
    if (winRmsDb > -42) {
      windowPeaksDb.push(winPeakDb);
    }
  }

  const maxVolumeDb = globalPeak > 1e-5 ? Number((20 * Math.log10(globalPeak)).toFixed(1)) : -90;
  const globalRms = Math.sqrt(totalSq / totalSamples);
  const meanVolumeDb = globalRms > 1e-5 ? Number((20 * Math.log10(globalRms)).toFixed(1)) : -90;

  windowPeaksDb.sort((a, b) => a - b);
  const p90 = windowPeaksDb.length
    ? windowPeaksDb[Math.min(windowPeaksDb.length - 1, Math.floor(windowPeaksDb.length * 0.9))]
    : maxVolumeDb;

  return {
    maxVolumeDb,
    speechPeakDb: Number(p90.toFixed(1)),
    meanVolumeDb,
  };
}

export function extractPcmSilencePauses(
  pcm: Buffer,
  sampleRate: number,
  clipId: string,
  durationMs: number,
  silenceThresholdMs = 450,
): AutoEditPause[] {
  const totalSamples = Math.floor(pcm.length / 2);
  if (!totalSamples || sampleRate <= 0) return [];
  const bucketMs = 50;
  const bucketSamples = Math.max(1, Math.round((sampleRate * bucketMs) / 1000));
  const rmsBuckets: number[] = [];

  for (let pos = 0; pos < totalSamples; pos += bucketSamples) {
    const end = Math.min(totalSamples, pos + bucketSamples);
    let sumSq = 0;
    for (let i = pos; i < end; i++) {
      const sample = pcm.readInt16LE(i * 2) / 32768;
      sumSq += sample * sample;
    }
    const rms = Math.sqrt(sumSq / (end - pos));
    const db = rms > 1e-5 ? 20 * Math.log10(rms) : -90;
    rmsBuckets.push(db);
  }

  const sorted = [...rmsBuckets].sort((a, b) => a - b);
  const p80 = sorted[Math.floor(sorted.length * 0.8)] ?? -35;
  // Adaptive silence floor: quiet room vs noisy mic
  const thresholdDb = Math.min(-32, Math.max(-44, p80 - 14));

  const rawPauses: AutoEditPause[] = [];
  let quietStartBucket: number | null = null;

  for (let i = 0; i < rmsBuckets.length; i++) {
    const isQuiet = rmsBuckets[i] < thresholdDb;
    if (isQuiet && quietStartBucket === null) quietStartBucket = i;
    if (!isQuiet && quietStartBucket !== null) {
      const startMs = quietStartBucket * bucketMs;
      const endMs = i * bucketMs;
      const isLeading = quietStartBucket === 0;
      const minRequired = isLeading ? Math.min(280, silenceThresholdMs) : silenceThresholdMs;
      if (endMs - startMs >= minRequired) {
        const paddedStart = isLeading ? 0 : Math.min(endMs, startMs + 65);
        const paddedEnd = Math.max(paddedStart, endMs - 65);
        if (paddedEnd - paddedStart >= Math.min(240, silenceThresholdMs)) {
          rawPauses.push({
            clipId,
            startMs: paddedStart,
            endMs: paddedEnd,
            reason: isLeading ? "dead_air" : "silence",
          });
        }
      }
      quietStartBucket = null;
    }
  }

  if (quietStartBucket !== null) {
    const startMs = quietStartBucket * bucketMs;
    const endMs = durationMs;
    if (endMs - startMs >= Math.min(280, silenceThresholdMs)) {
      const paddedStart = quietStartBucket === 0 ? 0 : Math.min(endMs, startMs + 65);
      if (endMs - paddedStart >= 220) {
        rawPauses.push({
          clipId,
          startMs: paddedStart,
          endMs,
          reason: "dead_air",
        });
      }
    }
  }

  return rawPauses;
}

export function parseSrtToWords(srtText: string, clipId: string): AutoEditWord[] {
  const blocks = srtText.trim().split(/\r?\n\r?\n+/u);
  const words: AutoEditWord[] = [];
  let idx = 1;

  const parseTimestamp = (raw: string) => {
    const match = raw.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/u);
    if (!match) return null;
    return (
      Number(match[1]) * 3_600_000 +
      Number(match[2]) * 60_000 +
      Number(match[3]) * 1_000 +
      Number(match[4].padEnd(3, "0"))
    );
  };

  for (const block of blocks) {
    const lines = block.split(/\r?\n/u).map((l) => l.trim()).filter(Boolean);
    const timeLineIndex = lines.findIndex((l) => l.includes("-->"));
    if (timeLineIndex < 0) continue;
    const [startStr, endStr] = lines[timeLineIndex].split("-->");
    const startMs = parseTimestamp(startStr || "");
    const endMs = parseTimestamp(endStr || "");
    if (startMs === null || endMs === null || endMs <= startMs) continue;
    const text = lines
      .slice(timeLineIndex + 1)
      .join(" ")
      .replace(/<[^>]+>/gu, "")
      .trim();
    if (!text) continue;
    const tokens = text.split(/\s+/u).filter(Boolean);
    if (!tokens.length) continue;
    const step = (endMs - startMs) / tokens.length;
    for (let i = 0; i < tokens.length; i++) {
      const wStart = Math.round(startMs + i * step);
      const wEnd = Math.round(Math.max(wStart + 40, startMs + (i + 1) * step));
      words.push({
        id: `w_${clipId}_${idx++}`,
        clipId,
        text: tokens[i],
        startMs: wStart,
        endMs: wEnd,
        confidence: 0.88,
        filler: isLikelyFillerWord(tokens[i]),
      });
    }
  }
  return words;
}

/**
 * Parses Whisper JSON output formats from WhisperKit, whisper.cpp, faster-whisper, or OpenAI Whisper CLI.
 */
export function parseWhisperJsonWords(payload: unknown, clipId: string): { kind: "whisper_words" | "whisper_segments"; words: AutoEditWord[] } {
  if (!payload || typeof payload !== "object") return { kind: "whisper_segments", words: [] };
  const segments: unknown[] = Array.isArray(payload)
    ? payload.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const rec = entry as Record<string, unknown>;
      return Array.isArray(rec.segments) ? rec.segments : [];
    })
    : (() => {
      const record = payload as Record<string, unknown>;
      if (Array.isArray(record.segments)) return record.segments;
      if (Array.isArray(record.transcription)) return record.transcription;
      return [];
    })();

  const extractedWords: AutoEditWord[] = [];
  let hasExplicitWordTimestamps = false;
  let counter = 1;

  for (const rawSeg of segments) {
    if (!rawSeg || typeof rawSeg !== "object") continue;
    const seg = rawSeg as Record<string, unknown>;
    const rawWords = Array.isArray(seg.words)
      ? seg.words
      : Array.isArray(seg.tokens)
        ? seg.tokens
        : [];

    const validWordObjects = rawWords.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && (typeof (item as Record<string, unknown>).word === "string" || typeof (item as Record<string, unknown>).text === "string")),
    );

    if (validWordObjects.length > 0) {
      for (const item of validWordObjects) {
        const rawText = String(item.word ?? item.text ?? "")
          .replace(/\[_[^\]]+\]/gu, "")
          .replace(/<\|[^|]+\|>/gu, "")
          .trim();
        if (!rawText) continue;
        const startSec = typeof item.start === "number"
          ? item.start
          : typeof (item.offsets as Record<string, unknown> | undefined)?.from === "number"
            ? Number((item.offsets as Record<string, unknown>).from) / 1000
            : undefined;
        const endSec = typeof item.end === "number"
          ? item.end
          : typeof (item.offsets as Record<string, unknown> | undefined)?.to === "number"
            ? Number((item.offsets as Record<string, unknown>).to) / 1000
            : undefined;
        if (startSec === undefined || endSec === undefined || !Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
        hasExplicitWordTimestamps = true;
        const startMs = Math.max(0, Math.round(startSec * 1000));
        const endMs = Math.max(startMs + 40, Math.round(endSec * 1000));
        const prob = typeof item.probability === "number"
          ? item.probability
          : typeof item.p === "number"
            ? item.p
            : 0.94;
        extractedWords.push({
          id: `w_${clipId}_${counter++}`,
          clipId,
          text: rawText,
          startMs,
          endMs,
          confidence: Math.max(0, Math.min(1, prob)),
          filler: isLikelyFillerWord(rawText),
        });
      }
      continue;
    }

    // Segment-level fallback when words[] array isn't populated
    const segText = String(seg.text ?? "").replace(/<\|[^|]+\|>/gu, "").trim();
    const segStartSec = typeof seg.start === "number"
      ? seg.start
      : typeof (seg.offsets as Record<string, unknown> | undefined)?.from === "number"
        ? Number((seg.offsets as Record<string, unknown>).from) / 1000
        : undefined;
    const segEndSec = typeof seg.end === "number"
      ? seg.end
      : typeof (seg.offsets as Record<string, unknown> | undefined)?.to === "number"
        ? Number((seg.offsets as Record<string, unknown>).to) / 1000
        : undefined;
    if (!segText || segStartSec === undefined || segEndSec === undefined || segEndSec <= segStartSec) continue;

    const tokens = segText.split(/\s+/u).filter(Boolean);
    const startMs = Math.max(0, Math.round(segStartSec * 1000));
    const endMs = Math.max(startMs + 80, Math.round(segEndSec * 1000));
    const step = (endMs - startMs) / Math.max(1, tokens.length);
    for (let i = 0; i < tokens.length; i++) {
      const wStart = Math.round(startMs + i * step);
      const wEnd = Math.round(Math.max(wStart + 40, startMs + (i + 1) * step));
      extractedWords.push({
        id: `w_${clipId}_${counter++}`,
        clipId,
        text: tokens[i],
        startMs: wStart,
        endMs: wEnd,
        confidence: 0.85,
        filler: isLikelyFillerWord(tokens[i]),
      });
    }
  }

  return {
    kind: hasExplicitWordTimestamps ? "whisper_words" : "whisper_segments",
    words: extractedWords,
  };
}

export async function resolveWhisperKitModelDir(
  envModelDir?: string,
  hfModelsRoot?: string,
): Promise<string | undefined> {
  const configured = envModelDir?.trim();
  if (configured) {
    try {
      await access(configured, constants.R_OK);
      const st = await stat(configured);
      if (st.isDirectory()) return configured;
    } catch {
      // Fall back to HuggingFace WhisperKit cache discovery
    }
  }

  const root = hfModelsRoot ?? path.join(homedir(), "Documents", "huggingface", "models", "argmaxinc", "whisperkit-coreml");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const validDirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const fullDir = path.join(root, entry.name);
    try {
      const inner = await readdir(fullDir);
      if (inner.some((f) => f === "config.json" || f.endsWith(".mlmodelc"))) {
        validDirs.push(entry.name);
      }
    } catch {
      // Ignore unreadable model dir
    }
  }

  if (!validDirs.length) return undefined;

  const tierPatterns = [
    /^openai_whisper-large/iu,
    /^openai_whisper-medium/iu,
    /^openai_whisper-small/iu,
    /^openai_whisper-base/iu,
  ];
  for (const pattern of tierPatterns) {
    const matches = validDirs.filter((name) => pattern.test(name)).sort().reverse();
    if (matches[0]) return path.join(root, matches[0]);
  }
  validDirs.sort();
  return path.join(root, validDirs[0]);
}

async function transcribeWavWithWhisper(
  wavPath: string,
  clipId: string,
  language: "vi" | "en",
  workDir: string,
  durationMs = 60_000,
): Promise<{ kind: AutoEditTranscriptKind; backend?: string; words: AutoEditWord[] }> {
  const whisperTimeoutMs = Math.max(180_000, Math.round(durationMs * 2));

  // 1. Check custom STORYAI_WHISPER_TRANSCRIBE_PATH wrapper first
  const configuredWhisper = process.env.STORYAI_WHISPER_TRANSCRIBE_PATH?.trim();
  if (configuredWhisper) {
    const outJson = path.join(workDir, `${clipId}.whisper.json`);
    const outSrt = path.join(workDir, `${clipId}.whisper.srt`);
    try {
      const modelDir = process.env.STORYAI_WHISPER_MODEL_DIR?.trim();
      await exec(
        configuredWhisper,
        [wavPath, "--output-srt", outSrt, ...(modelDir ? ["--model-dir", modelDir] : [])],
        { cwd: workDir, timeout: whisperTimeoutMs },
      );
      const jsonRaw = await readFile(outJson, "utf8").catch(() => "");
      if (jsonRaw) {
        const parsed = parseWhisperJsonWords(JSON.parse(jsonRaw), clipId);
        if (parsed.words.length) return { kind: parsed.kind, backend: "custom-whisper-json", words: parsed.words };
      }
      const srtRaw = await readFile(outSrt, "utf8").catch(() => "");
      if (srtRaw.trim()) {
        const words = parseSrtToWords(srtRaw, clipId);
        if (words.length) return { kind: "whisper_segments", backend: "custom-whisper-srt", words };
      }
    } catch {
      // Fall through to local Whisper CLI discovery
    }
  }

  const home = homedir();
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);

  // 2. Check whisper-cli / whisper-cpp
  const whisperCpp = await findExecutable([
    path.join(home, ".local", "bin", "whisper-cli"),
    "/opt/homebrew/bin/whisper-cli",
    "/usr/local/bin/whisper-cli",
    path.join(home, ".local", "bin", "whisper-cpp"),
    "/opt/homebrew/bin/whisper-cpp",
    "/usr/local/bin/whisper-cpp",
    ...pathDirs.flatMap((d) => [path.join(d, "whisper-cli"), path.join(d, "whisper-cpp")]),
  ]);
  if (whisperCpp) {
    const outPrefix = path.join(workDir, `${clipId}_cpp`);
    const envModelDir = process.env.STORYAI_WHISPER_MODEL_DIR?.trim();
    const modelWeightNames = [
      "ggml-large-v3-turbo.bin",
      "ggml-large-v3.bin",
      "ggml-medium.bin",
      "ggml-small.bin",
      "ggml-base.bin",
    ];
    const modelSearchDirs = [
      ...(envModelDir ? [envModelDir] : []),
      path.join(home, ".cache", "whisper"),
      path.join(home, ".local", "share", "whisper-cpp"),
      "/opt/homebrew/share/whisper-cpp",
      "/opt/homebrew/share/whisper-cpp/models",
      "/usr/local/share/whisper-cpp",
    ];
    const modelCandidates = [
      ...(envModelDir && envModelDir.endsWith(".bin") ? [envModelDir] : []),
      ...modelSearchDirs.flatMap((dir) => modelWeightNames.map((w) => path.join(dir, w))),
    ];
    const modelFile = await findReadableFile(modelCandidates).catch(() => undefined);
    if (modelFile) {
      try {
        await exec(
          whisperCpp,
          ["-m", modelFile, "-f", wavPath, "-l", language, "-ojf", "-of", outPrefix],
          { cwd: workDir, timeout: whisperTimeoutMs },
        );
        const raw = await readFile(`${outPrefix}.json`, "utf8");
        const parsed = parseWhisperJsonWords(JSON.parse(raw), clipId);
        if (parsed.words.length) return { kind: parsed.kind, backend: "whisper.cpp", words: parsed.words };
      } catch {
        // Fall through
      }
    }
  }

  // 3. Check Apple Silicon WhisperKit CLI (`whisperkit-cli`)
  const whisperKit = await findExecutable([
    path.join(home, ".local", "bin", "whisperkit-cli"),
    "/opt/homebrew/bin/whisperkit-cli",
    "/usr/local/bin/whisperkit-cli",
    ...pathDirs.map((d) => path.join(d, "whisperkit-cli")),
  ]);
  if (whisperKit) {
    try {
      const wkReportDir = path.join(workDir, `wk_${clipId}`);
      await mkdir(wkReportDir, { recursive: true });
      const discoveredModelDir = await resolveWhisperKitModelDir(process.env.STORYAI_WHISPER_MODEL_DIR);
      const modelArgs = discoveredModelDir
        ? ["--model-path", discoveredModelDir]
        : ["--model", "base"];
      const { stdout } = await exec(
        whisperKit,
        [
          "transcribe",
          "--audio-path", wavPath,
          "--language", language,
          "--word-timestamps",
          "--verbose",
          "--report",
          "--report-path", wkReportDir,
          ...modelArgs,
        ],
        { cwd: workDir, timeout: whisperTimeoutMs, maxBuffer: 8_000_000 },
      );
      const entries = await readdir(wkReportDir).catch(() => [] as string[]);
      const jsonReports = entries
        .filter((name) => name.toLowerCase().endsWith(".json"))
        .sort((a, b) => (Number(b.includes(clipId)) - Number(a.includes(clipId))) || a.localeCompare(b));
      for (const reportFile of jsonReports) {
        try {
          const raw = await readFile(path.join(wkReportDir, reportFile), "utf8");
          const parsed = parseWhisperJsonWords(JSON.parse(raw), clipId);
          if (parsed.words.length) return { kind: parsed.kind, backend: "whisperkit-cli", words: parsed.words };
        } catch {
          // Try next report JSON file
        }
      }
      if (stdout.trim()) {
        // Parse bracketed timestamp lines like [00:00.12 -> 00:02.40] text
        const words: AutoEditWord[] = [];
        let idx = 1;
        for (const line of stdout.split(/\r?\n/u)) {
          const match = line.match(/\[(\d+(?:\.\d+)?|\d+:\d+(?:\.\d+)?)\s*->\s*(\d+(?:\.\d+)?|\d+:\d+(?:\.\d+)?)\]\s*(.+)/u);
          if (!match) continue;
          const toMs = (s: string) => {
            const parts = s.split(":").map(Number);
            const sec = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
            return Math.round(sec * 1000);
          };
          const sMs = toMs(match[1]);
          const eMs = Math.max(sMs + 80, toMs(match[2]));
          const tokens = match[3].replace(/<\|[^|]+\|>/gu, "").trim().split(/\s+/u).filter(Boolean);
          const step = (eMs - sMs) / Math.max(1, tokens.length);
          tokens.forEach((tok, i) => {
            words.push({
              id: `w_${clipId}_${idx++}`,
              clipId,
              text: tok,
              startMs: Math.round(sMs + i * step),
              endMs: Math.round(Math.max(sMs + i * step + 40, sMs + (i + 1) * step)),
              confidence: 0.9,
              filler: isLikelyFillerWord(tok),
            });
          });
        }
        if (words.length) return { kind: "whisper_segments", backend: "whisperkit-cli", words };
      }
    } catch {
      // Fall through to OpenAI whisper CLI or acoustic VAD
    }
  }

  // 4. Check Python `whisper` CLI
  const pyWhisper = await findExecutable([
    path.join(home, ".local", "bin", "whisper"),
    "/opt/homebrew/bin/whisper",
    "/usr/local/bin/whisper",
    ...pathDirs.map((d) => path.join(d, "whisper")),
  ]);
  if (pyWhisper) {
    try {
      await exec(
        pyWhisper,
        [wavPath, "--language", language, "--output_format", "json", "--word_timestamps", "True", "--output_dir", workDir],
        { cwd: workDir, timeout: whisperTimeoutMs },
      );
      const base = path.basename(wavPath, path.extname(wavPath));
      const raw = await readFile(path.join(workDir, `${base}.json`), "utf8");
      const parsed = parseWhisperJsonWords(JSON.parse(raw), clipId);
      if (parsed.words.length) return { kind: parsed.kind, backend: "openai-whisper", words: parsed.words };
    } catch {
      // Fall through
    }
  }

  return { kind: "acoustic_only", words: [] };
}

export function distributeManualTranscriptWords(
  manualTranscript: string,
  videos: readonly AutoEditSourceVideo[],
  pauses: readonly AutoEditPause[],
): AutoEditWord[] {
  const tokens = manualTranscript.trim().split(/\s+/u).filter(Boolean);
  if (!tokens.length || !videos.length) return [];

  // Collect active speech spans across clips
  const spans: Array<{ clipId: string; startMs: number; endMs: number }> = [];
  for (const video of videos) {
    const dur = Math.max(500, video.durationMs || 5_000);
    const clipPauses = pauses
      .filter((p) => p.clipId === video.id)
      .sort((a, b) => a.startMs - b.startMs);
    let cursor = 0;
    for (const p of clipPauses) {
      if (p.startMs - cursor >= 200) spans.push({ clipId: video.id, startMs: cursor, endMs: p.startMs });
      cursor = Math.max(cursor, p.endMs);
    }
    if (dur - cursor >= 200) spans.push({ clipId: video.id, startMs: cursor, endMs: dur });
  }

  if (!spans.length) {
    spans.push({ clipId: videos[0].id, startMs: 0, endMs: Math.max(1000, videos[0].durationMs || 5000) });
  }

  const totalActiveMs = spans.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
  const words: AutoEditWord[] = [];
  let tokenCursor = 0;
  let counter = 1;

  spans.forEach((span, idx) => {
    const remainingTokens = tokens.length - tokenCursor;
    if (remainingTokens <= 0) return;
    const share = idx === spans.length - 1
      ? remainingTokens
      : Math.max(1, Math.round((tokens.length * (span.endMs - span.startMs)) / Math.max(1, totalActiveMs)));
    const slice = tokens.slice(tokenCursor, tokenCursor + share);
    tokenCursor += slice.length;
    const step = (span.endMs - span.startMs) / Math.max(1, slice.length);
    slice.forEach((tok, i) => {
      const wStart = Math.round(span.startMs + i * step);
      const wEnd = Math.round(Math.max(wStart + 40, span.startMs + (i + 1) * step));
      words.push({
        id: `w_manual_${counter++}`,
        clipId: span.clipId,
        text: tok,
        startMs: wStart,
        endMs: wEnd,
        confidence: 0.92,
        filler: isLikelyFillerWord(tok),
      });
    });
  });

  return words;
}

async function buildClipContactSheets(
  jobMediaDir: string,
  workDir: string,
  videos: Array<AutoEditSourceVideo & { videoIndex: number }>,
): Promise<ContactSheetEvidence[]> {
  const cellW = 320;
  const cellH = 320;
  const cols = 4;
  const rowsPerSheet = 3;
  const sheets: ContactSheetEvidence[] = [];

  const rowSpecs: Array<{ clip: AutoEditSourceVideo & { videoIndex: number }; timesSec: number[] }> = [];
  for (const clip of videos) {
    const durSec = Math.max(0.5, (clip.durationMs || 5_000) / 1000);
    const rowCount = durSec > 25 ? 2 : 1;
    for (let r = 0; r < rowCount; r++) {
      const winStart = (durSec * r) / rowCount;
      const winEnd = (durSec * (r + 1)) / rowCount;
      const timesSec = [0.08, 0.36, 0.64, 0.92].map((p) => Number((winStart + (winEnd - winStart) * p).toFixed(2)));
      rowSpecs.push({ clip, timesSec });
    }
  }

  for (let offset = 0; offset < rowSpecs.length && sheets.length < 6; offset += rowsPerSheet) {
    const chunk = rowSpecs.slice(offset, offset + rowsPerSheet);
    const cells: Array<{ input: Buffer; left: number; top: number }> = [];
    const sheetRows: ContactSheetEvidence["rows"] = [];

    for (let y = 0; y < chunk.length; y++) {
      const { clip, timesSec } = chunk[y];
      const clipFile = path.join(jobMediaDir, "videos", `${clip.id}${clip.extension}`);
      const capturedTimes: number[] = [];

      for (let x = 0; x < timesSec.length; x++) {
        const sec = timesSec[x];
        try {
          const { stdout } = await runFfmpegBuffer([
            "-ss", sec.toFixed(3),
            ...safeInputArgs,
            "-i", clipFile,
            "-map", `0:v:${clip.videoIndex}`,
            "-frames:v", "1",
            "-vf", `scale=${cellW}:${cellH}:force_original_aspect_ratio=decrease`,
            "-c:v", "mjpeg",
            "-f", "image2pipe",
            "pipe:1",
          ], 20_000);
          if (stdout.length) {
            const tile = await sharp(stdout)
              .resize(cellW, cellH, { fit: "contain", background: "#10131a" })
              .jpeg({ quality: 84 })
              .toBuffer();
            cells.push({ input: tile, left: x * cellW, top: y * cellH });
            capturedTimes.push(sec);
          }
        } catch {
          // Skip unreadable sample frame
        }
      }
      sheetRows.push({ clipId: clip.id, filename: clip.filename, framesAtSec: capturedTimes });
    }

    if (cells.length) {
      const outPath = path.join(workDir, `contact-${sheets.length + 1}.jpg`);
      await sharp({
        create: {
          width: cols * cellW,
          height: chunk.length * cellH,
          channels: 3,
          background: "#10131a",
        },
      })
        .composite(cells)
        .jpeg({ quality: 85 })
        .toFile(outPath);
      sheets.push({ imagePath: outPath, rows: sheetRows });
    }
  }

  return sheets;
}

export function parseYoutubeJson3Words(payload: unknown, clipId: string): AutoEditWord[] {
  if (!payload || typeof payload !== "object") return [];
  const events = Array.isArray((payload as { events?: unknown }).events)
    ? ((payload as { events: unknown[] }).events)
    : [];
  const words: AutoEditWord[] = [];
  let counter = 1;

  for (const rawEv of events) {
    if (!rawEv || typeof rawEv !== "object") continue;
    const ev = rawEv as { tStartMs?: unknown; dDurationMs?: unknown; segs?: unknown };
    const baseMs = typeof ev.tStartMs === "number" ? ev.tStartMs : 0;
    const durMs = typeof ev.dDurationMs === "number" ? ev.dDurationMs : 1500;
    if (!Array.isArray(ev.segs) || !ev.segs.length) continue;

    const validSegs = ev.segs
      .filter((s): s is { utf8?: unknown; tOffsetMs?: unknown } => Boolean(s && typeof s === "object"))
      .map((s) => ({
        text: String(s.utf8 ?? "").replace(/\s+/gu, " ").trim(),
        offsetMs: typeof s.tOffsetMs === "number" ? s.tOffsetMs : 0,
      }))
      .filter((s) => Boolean(s.text) && !/^\[.*\]$/u.test(s.text));

    for (let i = 0; i < validSegs.length; i++) {
      const cur = validSegs[i];
      const nextOffset = i + 1 < validSegs.length ? validSegs[i + 1].offsetMs : Math.min(durMs, cur.offsetMs + 480);
      const spanStartMs = Math.max(0, Math.round(baseMs + cur.offsetMs));
      const spanEndMs = Math.max(spanStartMs + 60, Math.round(baseMs + Math.max(cur.offsetMs + 80, nextOffset)));
      const tokens = cur.text.split(/\s+/u).filter(Boolean);
      const step = (spanEndMs - spanStartMs) / Math.max(1, tokens.length);
      for (let t = 0; t < tokens.length; t++) {
        const wStart = Math.round(spanStartMs + t * step);
        const wEnd = Math.round(Math.max(wStart + 45, spanStartMs + (t + 1) * step));
        words.push({
          id: `w_${clipId}_${counter++}`,
          clipId,
          text: tokens[t],
          startMs: wStart,
          endMs: wEnd,
          confidence: 0.91,
          filler: isLikelyFillerWord(tokens[t]),
        });
      }
    }
  }

  // Eliminate roll-up caption overlaps so every word ends cleanly before the next word starts
  words.sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < words.length - 1; i++) {
    const nextStart = words[i + 1].startMs;
    if (words[i].endMs > nextStart) {
      words[i].endMs = Math.max(words[i].startMs + 40, nextStart - 10);
    }
    if (words[i].endMs - words[i].startMs > 700) {
      words[i].endMs = words[i].startMs + 700;
    }
  }
  return words;
}

export async function downloadUrlForAutoEdit(
  rawUrl: string,
  videosDir: string,
  language: "vi" | "en",
): Promise<{ video: AutoEditSourceVideo; preloadedWords: AutoEditWord[] }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl.trim());
  } catch {
    throw new Error("Link video không hợp lệ. Hãy nhập URL HTTPS công khai (YouTube, TikTok, Facebook...).");
  }
  const classified = classifyRemakeSource(parsedUrl);
  if (!classified) {
    throw new Error("Hiện hỗ trợ link công khai từ YouTube, TikTok, Facebook, Instagram hoặc Douyin.");
  }

  const ytDlp = autoEditYtDlp();
  const ffmpegDir = path.dirname(autoEditFfmpeg());
  const ffmpegLocArgs = ffmpegDir && ffmpegDir !== "." ? ["--ffmpeg-location", ffmpegDir] : [];
  const subLang = language === "en" ? "en,en.*" : "vi,vi.*";
  const outputTemplate = path.join(videosDir, "clip_01.%(ext)s");

  try {
    await exec(
      ytDlp,
      [
        "--ignore-config",
        "--no-playlist",
        ...ffmpegLocArgs,
        "--js-runtimes", `node:${process.execPath}`,
        "--socket-timeout", "25",
        "--retries", "2",
        "--match-filter", "!is_live",
        "-f", "bv*[ext=mp4][height<=?1080]+ba[ext=m4a]/b[ext=mp4][height<=?1080]/bv*[height<=?1080]+ba/b[height<=?1080]",
        "--merge-output-format", "mp4",
        "--write-auto-subs",
        "--write-subs",
        "--sub-langs", subLang,
        "--sub-format", "json3",
        "-o", outputTemplate,
        "--",
        classified.url,
      ],
      { timeout: 240_000, maxBuffer: 4_000_000 },
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error("Chưa tìm thấy công cụ yt-dlp để tải link video. Hãy cài đặt yt-dlp hoặc tải tệp MP4 trực tiếp.");
    }
    throw new Error(`Không tải được video từ ${classified.label}. Hãy kiểm tra link công khai hoặc tải tệp trực tiếp.`);
  }

  const files = await readdir(videosDir);
  const videoFile = files.find((f) => /^clip_01\.(?:mp4|m4v|webm|mkv|mov)$/iu.test(f));
  if (!videoFile) {
    throw new Error("Không tìm thấy tệp video sau khi tải từ link.");
  }

  let preloadedWords: AutoEditWord[] = [];
  const json3File = files.find((f) => f.startsWith("clip_01.") && f.endsWith(".json3"));
  if (json3File) {
    try {
      const subPayload = JSON.parse(await readFile(path.join(videosDir, json3File), "utf8"));
      preloadedWords = parseYoutubeJson3Words(subPayload, "clip_01");
    } catch {
      // Ignore subtitle parse error and let Whisper handle audio
    }
  }

  const details = await stat(path.join(videosDir, videoFile));
  const ext = path.extname(videoFile).toLowerCase();

  return {
    video: {
      id: "clip_01",
      filename: `${classified.label}-${videoFile}`,
      extension: ext,
      size: details.size,
      order: 0,
    },
    preloadedWords,
  };
}

export async function analyzeAutoEditMedia(
  jobMediaDir: string,
  workDir: string,
  videosInput: readonly AutoEditSourceVideo[],
  options: AutoEditOptions,
): Promise<{
  videos: AutoEditSourceVideo[];
  analysis: AutoEditAnalysis;
  contactSheets: ContactSheetEvidence[];
}> {
  const probedVideos: Array<AutoEditSourceVideo & { videoIndex: number }> = [];
  const allPauses: AutoEditPause[] = [];
  const allWords: AutoEditWord[] = [];
  let transcriptKind: AutoEditTranscriptKind = "acoustic_only";
  let whisperBackend: string | undefined;
  let inputMaxVolumeDb: number | undefined;
  let inputMeanVolumeDb: number | undefined;

  for (const rawVideo of videosInput) {
    const filePath = path.join(jobMediaDir, "videos", `${rawVideo.id}${rawVideo.extension}`);
    const meta = await probeAutoEditVideo(filePath);
    const enriched = {
      ...rawVideo,
      durationMs: meta.durationMs,
      width: meta.width,
      height: meta.height,
      aspectRatio: meta.aspectRatio,
      hasAudio: meta.hasAudio,
      videoIndex: meta.videoIndex,
    };
    probedVideos.push(enriched);

    let clipTranscribed = false;
    if (meta.hasAudio) {
      // 1. Acoustic PCM analysis for silence & dead-air detection
      try {
        const pcmRate = 1000;
        const { stdout: pcm } = await runFfmpegBuffer([
          ...safeInputArgs,
          "-i", filePath,
          "-vn",
          "-map", "0:a:0",
          "-ac", "1",
          "-ar", String(pcmRate),
          "-f", "s16le",
          "pipe:1",
        ], 45_000, 32_000_000);
        const clipLevels = measurePcmVoiceLevelsDb(pcm, pcmRate);
        if (inputMaxVolumeDb === undefined || clipLevels.maxVolumeDb > inputMaxVolumeDb) {
          inputMaxVolumeDb = clipLevels.maxVolumeDb;
        }
        if (inputMeanVolumeDb === undefined || clipLevels.meanVolumeDb > inputMeanVolumeDb) {
          inputMeanVolumeDb = clipLevels.meanVolumeDb;
        }
        const clipPauses = extractPcmSilencePauses(pcm, pcmRate, rawVideo.id, meta.durationMs, options.silenceThresholdMs);
        allPauses.push(...clipPauses);
      } catch {
        // Proceed without PCM pauses if audio stream decode fails
      }

      // 2. Check pre-downloaded json3 subtitles (e.g. YouTube URL import) before running Whisper
      if (!options.manualTranscript.trim()) {
        try {
          const vDirEntries = await readdir(path.join(jobMediaDir, "videos"));
          const json3Name = vDirEntries.find((f) => f.startsWith(`${rawVideo.id}.`) && f.endsWith(".json3"));
          if (json3Name) {
            const rawJson3 = await readFile(path.join(jobMediaDir, "videos", json3Name), "utf8");
            const ytWords = parseYoutubeJson3Words(JSON.parse(rawJson3), rawVideo.id);
            if (ytWords.length > 0) {
              allWords.push(...ytWords);
              transcriptKind = "whisper_words";
              whisperBackend = "youtube-json3";
              clipTranscribed = true;
            }
          }
        } catch {
          // Proceed to Whisper
        }
      }

      // 3. Whisper word-level speech transcription (unless manual transcript or json3 was used)
      if (!options.manualTranscript.trim() && !clipTranscribed) {
        const wavPath = path.join(workDir, `${rawVideo.id}.wav`);
        try {
          await runFfmpegBuffer([
            ...safeInputArgs,
            "-i", filePath,
            "-vn",
            "-map", "0:a:0",
            "-ac", "1",
            "-ar", "16000",
            wavPath,
          ], 45_000);
          const result = await transcribeWavWithWhisper(wavPath, rawVideo.id, options.language, workDir, meta.durationMs);
          if (result.words.length > 0) {
            allWords.push(...result.words);
            if (result.kind === "whisper_words" || transcriptKind === "acoustic_only") {
              transcriptKind = result.kind;
            }
            whisperBackend = result.backend || whisperBackend;
            clipTranscribed = true;
          }
        } catch {
          // Continue with embedded subtitle check or acoustic VAD if Whisper fails
        }
      }
    }

    // 4. Extract embedded subtitle track 0:s:0 (SRT) if present before falling back to acoustic_only
    if (!options.manualTranscript.trim() && !clipTranscribed && meta.hasSubtitle) {
      const embeddedSrtPath = path.join(workDir, `${rawVideo.id}.embedded.srt`);
      try {
        await runFfmpegBuffer([
          "-y",
          ...safeInputArgs,
          "-i", filePath,
          "-vn",
          "-an",
          "-map", "0:s:0",
          "-c:s", "srt",
          embeddedSrtPath,
        ], 30_000);
        const srtRaw = await readFile(embeddedSrtPath, "utf8").catch(() => "");
        if (srtRaw.trim()) {
          const srtWords = parseSrtToWords(srtRaw, rawVideo.id);
          if (srtWords.length > 0) {
            allWords.push(...srtWords);
            if (transcriptKind === "acoustic_only") {
              transcriptKind = "whisper_segments";
            }
            whisperBackend = whisperBackend || "embedded-srt";
            clipTranscribed = true;
          }
        }
      } catch {
        // Proceed with acoustic_only if embedded subtitle track cannot be converted to SRT
      }
    }
  }

  if (options.manualTranscript.trim()) {
    const manualWords = distributeManualTranscriptWords(options.manualTranscript, probedVideos, allPauses);
    if (manualWords.length) {
      allWords.push(...manualWords);
      transcriptKind = "manual";
    }
  }

  const contactSheets = await buildClipContactSheets(jobMediaDir, workDir, probedVideos);
  const rawDurationMs = probedVideos.reduce((sum, v) => sum + (v.durationMs || 0), 0);

  return {
    videos: probedVideos.map(({ id, filename, extension, size, order, durationMs, width, height, aspectRatio, hasAudio }) => ({
      id,
      filename,
      extension,
      size,
      order,
      durationMs,
      width,
      height,
      aspectRatio,
      hasAudio,
    })),
    analysis: {
      transcriptKind,
      whisperBackend,
      rawDurationMs,
      inputMaxVolumeDb,
      inputMeanVolumeDb,
      words: allWords,
      pauses: allPauses,
    },
    contactSheets,
  };
}

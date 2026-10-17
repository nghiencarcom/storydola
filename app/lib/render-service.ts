import { createHash } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { buildProceduralOverlayFilter, buildRandomPanZoomFilter, DEFAULT_RENDER_SETTINGS, normalizeRenderSettings } from "./render-effects";
import { estimateDialogueDurationMs, hasExplicitDialogueSegments, readDialogueSegments } from "./dialogue-segments";
import { resolveProjectDialogueVoice } from "./project-tts-voice";
import { normalizeAiDramaSceneDuration } from "./ai-drama-scene-timing";
import type { RenderSettings, StoryProject } from "./project-types";
import { readProjectScenes, sceneMediaLocalPath, type StoredScene } from "./scene-store";

const DATA_DIR = path.join(process.cwd(), "data");
const OUTPUT_DIR = path.join(DATA_DIR, "outputs");
const RENDER_DIR = path.join(DATA_DIR, "renders");
const sourceAudioProbeCache = new Map<string, Promise<boolean>>();

export type RenderManifestScene = {
  index: number;
  sceneId: string;
  chunkId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  mediaKind: "image" | "video" | "color";
  mediaPath?: string;
  source: "scene_media" | "hold_previous" | "color";
  fallback?: boolean;
  provider?: string;
  voiceover: string;
  audioPath?: string;
  sourceHasAudio?: boolean;
  audioCues?: RenderManifestAudioCue[];
};

export type RenderManifestAudioCue = {
  id: string;
  text: string;
  speakerName?: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  audioPath?: string;
};

export type RenderManifest = {
  schema: "storyai-render.v1";
  projectSlug: string;
  title: string;
  generatedAt: string;
  settings?: RenderSettings;
  language?: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  audio: { ready: boolean; available: boolean; note: string };
  /** Legacy field name: scenes rendered with fallback/hold/color media. */
  missingMedia: number;
  scenes: RenderManifestScene[];
};

export type RenderEpisodeTarget = {
  chunkId: string;
  episodeNumber: number;
  renderId: string;
  language?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(scene: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = scene[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function numberValue(scene: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(scene[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function dimensions(aspectRatio: string) {
  const [rawWidth, rawHeight] = aspectRatio.split(":").map(Number);
  const ratio = rawWidth > 0 && rawHeight > 0 ? rawWidth / rawHeight : 16 / 9;
  const configuredWidth = Number(process.env.STORYAI_RENDER_WIDTH) || (ratio < 0.92 ? 720 : ratio > 1.08 ? 1280 : 720);
  const width = Math.max(320, Math.floor(configuredWidth / 2) * 2);
  const height = Math.max(320, Math.floor((width / ratio) / 2) * 2);
  return { width, height };
}

function safeProjectPath(project: StoryProject, localPath: string) {
  if (!localPath) return undefined;
  const resolved = path.resolve(process.cwd(), localPath);
  const projectRoot = path.resolve(DATA_DIR, "media", project.slug);
  if (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}${path.sep}`)) return undefined;
  return resolved;
}

function safeDataPath(localPath: string) {
  if (!localPath) return undefined;
  const resolved = path.resolve(process.cwd(), localPath);
  if (resolved !== DATA_DIR && !resolved.startsWith(`${DATA_DIR}${path.sep}`)) return undefined;
  return resolved;
}

async function existingProjectMedia(project: StoryProject, localPath: string | undefined) {
  const resolved = safeProjectPath(project, localPath || "");
  if (!resolved) return undefined;
  try {
    const details = await stat(resolved);
    return details.isFile() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

export class RenderMediaPreflightError extends Error {
  readonly code = "AI_DRAMA_VIDEO_MEDIA_INVALID";
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Chưa thể ghép video AI Drama: ${issues.join(" · ")}`);
    this.name = "RenderMediaPreflightError";
    this.issues = issues;
  }
}

export async function assertAiDramaVideosReady(project: StoryProject, scenes: StoredScene[], expectedSceneCount?: number) {
  if (project.presetId !== "ai-drama") return;
  const issues: string[] = [];
  if (expectedSceneCount !== undefined && scenes.length !== expectedSceneCount) {
    issues.push(`Thiếu cảnh trong kịch bản: có ${scenes.length}/${expectedSceneCount} cảnh.`);
  }

  for (const scene of scenes) {
    const id = String(scene.id || scene.scene_id || `S${String(scene.sceneIndex + 1).padStart(3, "0")}`);
    const videoPrompt = textValue(scene as Record<string, unknown>, "video_prompt", "videoPrompt");
    if (!videoPrompt) issues.push(`${id}: chưa có prompt video để đối chiếu với media.`);
    const media = asRecord(scene.media);
    if (media.kind !== "video") {
      issues.push(`${id}: media hiện tại là ${String(media.kind || "chưa có")}, cần video.`);
      continue;
    }
    if (media.status !== "ready") {
      issues.push(`${id}: video chưa sẵn sàng${media.error ? ` (${String(media.error).slice(0, 100)})` : ""}.`);
      continue;
    }
    if (media.stale === true) {
      issues.push(`${id}: video đã stale sau khi prompt hoặc tham chiếu thay đổi.`);
      continue;
    }
    const mediaPath = typeof media.localPath === "string" ? media.localPath.trim() : "";
    if (!mediaPath || !await existingProjectMedia(project, mediaPath)) {
      issues.push(`${id}: không tìm thấy file video hợp lệ trong thư mục project.`);
    }
  }

  if (issues.length) throw new RenderMediaPreflightError(issues);
}

async function existingDataFile(localPath: string | undefined) {
  const resolved = safeDataPath(localPath || "");
  if (!resolved) return undefined;
  try {
    const details = await stat(resolved);
    return details.isFile() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function ffprobePath() {
  const configuredPath = process.env.STORYAI_FFPROBE_PATH || process.env.VIBE_FFPROBE_PATH;
  if (configuredPath && existsSync(configuredPath)) return configuredPath;

  const bundledPath = path.join(process.cwd(), "ffprobe.exe");
  if (process.platform === "win32" && existsSync(bundledPath)) return bundledPath;
  return "ffprobe";
}

function hasAudioStream(filePath: string) {
  const cached = sourceAudioProbeCache.get(filePath);
  if (cached) return cached;
  const result = new Promise<boolean>((resolve) => {
    let stdout = "";
    let settled = false;
    const finish = (hasAudio: boolean) => {
      if (settled) return;
      settled = true;
      resolve(hasAudio);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(ffprobePath(), ["-v", "error", "-show_streams", "-of", "json", filePath], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      finish(false);
      return;
    }
    child.stdout?.on("data", (chunk) => {
      if (stdout.length < 1_000_000) stdout += String(chunk);
    });
    child.once("error", () => finish(false));
    child.once("close", (code) => {
      if (code !== 0) return finish(false);
      try {
        const payload = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string }> };
        finish(Boolean(payload.streams?.some((stream) => stream.codec_type === "audio")));
      } catch {
        finish(false);
      }
    });
  });
  sourceAudioProbeCache.set(filePath, result);
  return result;
}

function localAudioPath(scene: StoredScene) {
  const audio = asRecord(scene.audio || scene.voice || scene.tts);
  const candidate = textValue(audio, "localPath", "path", "filePath", "file_path") || textValue(scene, "audio_path", "audioPath", "voice_path", "voicePath");
  return safeDataPath(candidate);
}

function localRelative(value: string) {
  return path.relative(process.cwd(), value).split(path.sep).join("/");
}

function subtitleTime(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function srtText(value: string) {
  return value.replace(/\r?\n/g, " ").trim();
}

function writeSrt(scenes: RenderManifestScene[], speed = 1, reverse = false, trimStart = 0, trimEnd: number | null = null) {
  const timelineSpeed = Math.max(0.01, Number(speed) || 1);
  const fullDuration = Math.max(0, ...scenes.map((scene) => scene.endSec / timelineSpeed));
  const safeTrimStart = Math.min(fullDuration, Math.max(0, Number(trimStart) || 0));
  const safeTrimEnd = trimEnd !== null && Number.isFinite(Number(trimEnd))
    ? Math.min(fullDuration, Math.max(safeTrimStart, Number(trimEnd)))
    : fullDuration;
  const outputDuration = Math.max(0, safeTrimEnd - safeTrimStart);
  const sourceCues = scenes.flatMap((scene) => {
    if (scene.audioCues?.length) return scene.audioCues.map((cue) => {
      const startSec = scene.startSec + (cue.startMs / 1000);
      const durationMs = cue.durationMs || estimateDialogueDurationMs(cue.text);
      const endSec = scene.startSec + ((cue.endMs ?? cue.startMs + durationMs) / 1000);
      return { startSec, endSec: Math.min(scene.endSec, endSec), text: cue.text };
    });
    return scene.voiceover ? [{ startSec: scene.startSec, endSec: scene.endSec, text: scene.voiceover }] : [];
  });
  const cues = sourceCues
    .map((cue) => {
      const sceneStart = cue.startSec / timelineSpeed;
      const sceneEnd = cue.endSec / timelineSpeed;
      const timelineStart = reverse ? fullDuration - sceneEnd : sceneStart;
      const timelineEnd = reverse ? fullDuration - sceneStart : sceneEnd;
      const clippedStart = Math.max(safeTrimStart, timelineStart);
      const clippedEnd = Math.min(safeTrimEnd, timelineEnd);
      return {
        subtitleStart: clippedStart - safeTrimStart,
        subtitleEnd: clippedEnd - safeTrimStart,
        text: srtText(cue.text),
      };
    })
    .filter((cue) => cue.subtitleEnd > cue.subtitleStart);
  if (reverse) cues.reverse();
  return cues.map((cue, index) => `${index + 1}\n${subtitleTime(Math.max(0, cue.subtitleStart))} --> ${subtitleTime(Math.max(0, cue.subtitleEnd))}\n${cue.text}\n`).join("\n");
}

export function calculateRenderDuration(manifest: RenderManifest, settings: RenderSettings) {
  return outputTimelineDuration(manifest, settings);
}

export async function buildRenderManifest(project: StoryProject, scenes?: StoredScene[], options: { dialogueLanguage?: string } = {}): Promise<RenderManifest> {
  const sourceScenes = scenes || await readProjectScenes(project);
  const dialogueLanguage = options.dialogueLanguage?.trim();
  const { width, height } = dimensions(project.aspectRatio);
  const manifestScenes: RenderManifestScene[] = [];
  let cursor = 0;
  let previousMedia: { kind: "image" | "video"; path: string; provider?: string } | undefined;

  for (let index = 0; index < sourceScenes.length; index += 1) {
    const scene = sourceScenes[index];
    const record = asRecord(scene);
    const originalStart = numberValue(record, "start_sec", "startSec");
    const originalEnd = numberValue(record, "end_sec", "endSec");
    const requestedDuration = originalStart !== undefined && originalEnd !== undefined ? originalEnd - originalStart : Number(project.sceneDurationSec) || 15;
    const durationSec = project.presetId === "ai-drama"
      ? normalizeAiDramaSceneDuration(requestedDuration)
      : Math.max(1, Math.min(15, Number.isFinite(requestedDuration) && requestedDuration > 0 ? requestedDuration : 15));
    const media = asRecord(scene.media);
    const requestedKind = String(media.kind || record.media_type || record.mediaType || "image").toLowerCase() === "video" ? "video" : "image";
    const mediaIsUsable = (media.kind === "image" || media.kind === "video") && media.status === "ready" && media.stale !== true;
    const currentPath = mediaIsUsable ? await existingProjectMedia(project, sceneMediaLocalPath(scene)) : undefined;
    const provider = media.provider ? String(media.provider) : undefined;
    const sceneAudio = asRecord(record.audio);
    let audioPath = !dialogueLanguage && (!sceneAudio.language || sceneAudio.language === project.language)
      ? await existingDataFile(localAudioPath(scene))
      : undefined;
    let audioCues: RenderManifestAudioCue[] | undefined;
    let voiceover = textValue(record, "dialogue_or_voiceover", "voiceText", "voiceover");
    if (project.presetId === "ai-drama" && hasExplicitDialogueSegments(record)) {
      audioPath = undefined;
      const dialogueSegments = readDialogueSegments(record, project.characters || []);
      const lineProject = {
        ...project,
        voiceId: String(record.ttsVoiceId || record.tts_voice_id || project.voiceId || ""),
        voiceName: String(record.ttsVoiceName || record.tts_voice_name || project.voiceName || ""),
        voiceLanguage: String(record.ttsVoiceLanguage || record.tts_voice_language || project.voiceLanguage || project.language),
      };
      audioCues = [];
      for (const segment of dialogueSegments) {
        const voice = resolveProjectDialogueVoice(segment, lineProject);
        const lineText = dialogueLanguage ? String(segment.translations?.[dialogueLanguage] || "").trim() : segment.text;
        const audio = asRecord(dialogueLanguage ? segment.translatedAudio?.[dialogueLanguage] : segment.audio);
        const textHash = createHash("sha256").update(lineText).digest("hex");
        const expectedLanguage = dialogueLanguage || voice.language;
        const validLanguage = dialogueLanguage ? audio.language === dialogueLanguage : !audio.language || audio.language === expectedLanguage;
        const validAudio = Boolean(lineText) && audio.voiceId === voice.voiceId && audio.textHash === textHash && validLanguage
          ? await existingDataFile(String(audio.localPath || ""))
          : undefined;
        audioCues.push({
          id: segment.id,
          text: lineText,
          speakerName: segment.speakerName || project.characters?.find((character) => character.id === segment.speakerCharacterId)?.name,
          startMs: Math.max(0, segment.startMs),
          ...(segment.endMs !== undefined ? { endMs: segment.endMs } : {}),
          ...(Number(audio.durationMs) > 0 ? { durationMs: Number(audio.durationMs) } : {}),
          audioPath: validAudio ? localRelative(validAudio) : undefined,
        });
      }
      voiceover = dialogueSegments.map((segment) => dialogueLanguage ? String(segment.translations?.[dialogueLanguage] || "").trim() : segment.text).join("\n");
    }
    let source: RenderManifestScene["source"] = "color";
    let mediaKind: RenderManifestScene["mediaKind"] = "color";
    let mediaPath: string | undefined;
    let resolvedProvider = provider;
    if (currentPath) {
      source = "scene_media";
      mediaKind = requestedKind;
      mediaPath = localRelative(currentPath);
      previousMedia = { kind: requestedKind, path: currentPath, provider };
    } else if (previousMedia) {
      source = "hold_previous";
      mediaKind = previousMedia.kind;
      mediaPath = localRelative(previousMedia.path);
      resolvedProvider = previousMedia.provider;
    }
    const sourceHasAudio = mediaKind === "video" && mediaPath
      ? await hasAudioStream(path.resolve(process.cwd(), mediaPath))
      : false;
    manifestScenes.push({
      index,
      sceneId: scene.id,
      chunkId: scene.chunkId,
      startSec: cursor,
      endSec: cursor + durationSec,
      durationSec,
      mediaKind,
      mediaPath,
      source,
      ...(record.mediaFallback === true || record.media_fallback === true ? { fallback: true } : {}),
      provider: resolvedProvider,
      voiceover,
      audioPath: audioPath && localRelative(audioPath),
      ...(sourceHasAudio ? { sourceHasAudio: true } : {}),
      ...(audioCues ? { audioCues } : {}),
    });
    cursor += durationSec;
  }

  const narratedAudio = manifestScenes.flatMap((scene) => scene.audioCues?.length
    ? scene.audioCues.filter((cue) => Boolean(cue.text)).map((cue) => cue.audioPath)
    : scene.voiceover ? [scene.audioPath] : []);
  const audioReady = narratedAudio.length > 0 && narratedAudio.every(Boolean);
  const audioAvailable = audioReady
    || manifestScenes.some((scene) => scene.sourceHasAudio || scene.audioPath || scene.audioCues?.some((cue) => cue.audioPath));
  return {
    schema: "storyai-render.v1",
    projectSlug: project.slug,
    title: project.title,
    ...(dialogueLanguage ? { language: dialogueLanguage } : {}),
    generatedAt: new Date().toISOString(),
    durationSec: Number(cursor.toFixed(3)),
    width,
    height,
    fps: 30,
    audio: {
      ready: audioReady,
      available: audioAvailable,
      note: audioReady
        ? "Audio TTS sẽ được ghép theo timeline; cảnh không có TTS sẽ dùng tiếng gốc nếu video có audio."
        : narratedAudio.length
          ? audioAvailable
            ? "Một số câu chưa có TTS; các cảnh đó sẽ dùng tiếng gốc nếu video có audio."
            : "Một số cảnh có lời đọc chưa có file TTS hoặc tiếng gốc để render."
          : audioAvailable
            ? "Không có TTS; sẽ dùng tiếng gốc từ các video có audio."
            : "Kịch bản chưa có TTS và video nguồn không có audio.",
    },
    missingMedia: manifestScenes.filter((scene) => scene.source !== "scene_media" || scene.fallback === true).length,
    scenes: manifestScenes,
  };
}

async function runProcess(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let errorText = "";
    child.stderr?.on("data", (chunk) => { errorText = `${errorText}${String(chunk)}`.slice(-12_000); });
    child.once("error", (error) => reject(error));
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(errorText.trim() || `ffmpeg exited with code ${code}`)));
  });
}

async function createDialogueMix(ffmpeg: string, scene: RenderManifestScene, tempDir: string) {
  const cues = (scene.audioCues || []).filter((cue) => cue.audioPath);
  if (!cues.length) return undefined;
  const outputPath = path.join(tempDir, `dialogue-mix-${String(scene.index + 1).padStart(4, "0")}.wav`);
  const duration = scene.durationSec.toFixed(3);
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-t", duration, "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"];
  cues.forEach((cue) => args.push("-i", path.resolve(process.cwd(), String(cue.audioPath))));
  const filters = cues.map((cue, index) => {
    const delay = Math.max(0, Math.round(cue.startMs));
    const srtWindowMs = Number(cue.endMs) - Number(cue.startMs);
    const wavDurationMs = Number(cue.durationMs) || 0;
    const fitSpeed = srtWindowMs > 0 && wavDurationMs > srtWindowMs ? wavDurationMs / srtWindowMs : 1;
    const tempo = atempoChain(fitSpeed);
    return `[${index + 1}:a]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo${tempo ? `,${tempo}` : ""},adelay=delays=${delay}|${delay}[line${index}]`;
  });
  const labels = `[0:a]${cues.map((_cue, index) => `[line${index}]`).join("")}`;
  filters.push(`${labels}amix=inputs=${cues.length + 1}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95,atrim=duration=${duration}[outa]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[outa]", "-t", duration, "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", outputPath);
  await runProcess(ffmpeg, args);
  return outputPath;
}

function ffmpegPath() {
  const configuredPath = process.env.STORYAI_FFMPEG_PATH || process.env.VIBE_FFMPEG_PATH;
  if (configuredPath && existsSync(configuredPath)) return configuredPath;

  const bundledPath = path.join(process.cwd(), "ffmpeg.exe");
  if (process.platform === "win32" && existsSync(bundledPath)) return bundledPath;
  return "ffmpeg";
}

function escapeConcatPath(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapeFilterPath(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
}

function renderFontPath() {
  const candidates = [
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function atempoChain(speed: number) {
  let remaining = Math.max(0.5, speed);
  const filters: string[] = [];
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 0.005) filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters.join(",");
}

function colorFilterChain(value: RenderSettings["colorFilter"]) {
  switch (value) {
    case "B&W":
      return "hue=s=0";
    case "Warm":
      return "colorbalance=rm=0.15:bm=-0.15";
    case "Cool":
      return "colorbalance=rm=-0.15:bm=0.15";
    case "Vintage":
      return "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131";
    default:
      return "";
  }
}

function timelineAudioFilterChain(settings: RenderSettings) {
  const filters: string[] = ["asetpts=PTS-STARTPTS"];
  if (settings.reverse) filters.push("areverse");

  const tempo = atempoChain(settings.speed);
  if (tempo) filters.push(tempo);

  if (settings.trimStart > 0 || settings.trimEnd !== null) {
    const end = settings.trimEnd !== null ? `:end=${settings.trimEnd.toFixed(3)}` : "";
    filters.push(`atrim=start=${settings.trimStart.toFixed(3)}${end}`, "asetpts=PTS-STARTPTS");
  }
  return filters.join(",");
}

function outputTimelineDuration(manifest: RenderManifest, settings: RenderSettings) {
  const speedAdjusted = Math.max(0, manifest.durationSec / settings.speed);
  const start = Math.min(speedAdjusted, Math.max(0, settings.trimStart));
  const end = settings.trimEnd === null ? speedAdjusted : Math.min(speedAdjusted, Math.max(start, settings.trimEnd));
  return Math.max(0.1, end - start);
}

function hasPostProcessing(settings: RenderSettings, logoAvailable: boolean) {
  return settings.enableRandomPanZoom || settings.mirror || settings.speed !== 1
    || settings.reverse
    || settings.colorFilter !== "None"
    || settings.trimStart > 0 || settings.trimEnd !== null
    || Boolean(settings.titleText) || Boolean(settings.watermarkText)
    || settings.visualEffect !== "none"
    || ((settings.logo === "maivideo" || settings.logo === "custom") && logoAvailable);
}

async function brandLogoPath() {
  const candidate = path.join(process.cwd(), "public", "branding", "maivideo-logo-accurate-header.png");
  try {
    return (await stat(candidate)).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

async function customLogoPath(settings: RenderSettings) {
  if (settings.logo !== "custom" || !settings.logoPath) return undefined;
  const uploadsRoot = path.resolve(DATA_DIR, "uploads");
  const candidate = path.resolve(process.cwd(), settings.logoPath);
  if (candidate !== uploadsRoot && !candidate.startsWith(`${uploadsRoot}${path.sep}`)) return undefined;
  try {
    return (await stat(candidate)).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

async function resolveLogoPath(settings: RenderSettings) {
  if (settings.logo === "maivideo") return brandLogoPath();
  if (settings.logo === "custom") return customLogoPath(settings);
  return undefined;
}

async function applyFinalRenderEffects({
  basePath,
  outputPath,
  manifest,
  settings,
  tempDir,
  logoPath,
}: {
  basePath: string;
  outputPath: string;
  manifest: RenderManifest;
  settings: RenderSettings;
  tempDir: string;
  logoPath?: string;
}) {
  const filterLines: string[] = [];
  const fontPath = renderFontPath();
  const outputDuration = outputTimelineDuration(manifest, settings);
  let current = "[0:v]";
  let labelIndex = 0;
  const nextLabel = (prefix: string) => `[${prefix}_${labelIndex++}]`;

  if (settings.enableRandomPanZoom) {
    const label = nextLabel("v_pan_zoom");
    filterLines.push(`${current}${buildRandomPanZoomFilter(settings, manifest.width, manifest.height, manifest.fps)}${label}`);
    current = label;
  }
  if (settings.mirror) {
    const label = nextLabel("v_mirror");
    filterLines.push(`${current}hflip${label}`);
    current = label;
  }
  const colorFilter = colorFilterChain(settings.colorFilter);
  if (colorFilter) {
    const label = nextLabel("v_color");
    filterLines.push(`${current}${colorFilter}${label}`);
    current = label;
  }
  if (settings.reverse) {
    const label = nextLabel("v_reverse");
    filterLines.push(`${current}reverse${label}`);
    current = label;
  }
  if (settings.visualEffect !== "none") {
    const label = nextLabel("v_effect");
    filterLines.push(...buildProceduralOverlayFilter(settings.visualEffect, current, label, manifest.width, manifest.height, outputDuration, manifest.fps, `[storyai_effect_${labelIndex}]`));
    current = label;
  }

  if (logoPath) {
    const logoLabel = nextLabel("logo");
    const outputLabel = nextLabel("v_logo");
    const logoWidth = Math.max(48, Math.round((manifest.width * settings.logoScale) / 2) * 2);
    const position = settings.logoPosition === "top-left" ? "x=20:y=20"
      : settings.logoPosition === "top-right" ? "x=main_w-w-20:y=20"
        : settings.logoPosition === "center" ? "x=(main_w-w)/2:y=(main_h-h)/2"
          : settings.logoPosition === "bottom-left" ? "x=20:y=main_h-h-20"
            : "x=main_w-w-20:y=main_h-h-20";
    filterLines.push(`[1:v]scale=${logoWidth}:-2,format=rgba,colorchannelmixer=aa=${settings.logoOpacity.toFixed(3)}${logoLabel}`);
    filterLines.push(`${current}${logoLabel}overlay=${position}:eof_action=repeat:format=auto${outputLabel}`);
    current = outputLabel;
  }

  if (settings.titleText) {
    const titlePath = path.join(tempDir, "render-title.txt");
    await writeFile(titlePath, settings.titleText, "utf8");
    const label = nextLabel("v_title");
    const color = settings.titleColor === "black" ? "black" : settings.titleColor;
    const y = settings.titlePosition === "center" ? "(h-text_h)/2" : settings.titlePosition === "bottom" ? "h-text_h-50" : "50";
    const fontOption = fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : "";
    const drawtext = `drawtext=textfile='${escapeFilterPath(titlePath)}'${fontOption}:fontsize=${settings.titleFontSize}:fontcolor=${color}@0.96:bordercolor=black:borderw=2:box=1:boxcolor=black@0.28:boxborderw=18:x=(w-text_w)/2:y='${y}'`;
    filterLines.push(`${current}${drawtext}${label}`);
    current = label;
  }

  if (settings.watermarkText) {
    const watermarkPath = path.join(tempDir, "render-watermark.txt");
    await writeFile(watermarkPath, settings.watermarkText, "utf8");
    const label = nextLabel("v_watermark");
    const speed = Math.max(20, Math.min(400, settings.watermarkSpeed));
    const xRate = Math.max(0.02, speed / 1600 * (0.85 + Math.random() * 0.3));
    const yRate = Math.max(0.018, speed / 2100 * (0.85 + Math.random() * 0.3));
    const xPosition = `(0.5+0.34*sin(2*PI*t*${xRate.toFixed(6)}+${phaseValue()} )+0.12*sin(2*PI*t*${(xRate * 1.73).toFixed(6)}+${phaseValue()}))`;
    const yPosition = `(0.5+0.30*cos(2*PI*t*${yRate.toFixed(6)}+${phaseValue()} )+0.12*sin(2*PI*t*${(yRate * 1.61).toFixed(6)}+${phaseValue()}))`;
    const fontOption = fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : "";
    const drawtext = `drawtext=textfile='${escapeFilterPath(watermarkPath)}'${fontOption}:fontsize=${settings.watermarkFontSize}:fontcolor=${settings.watermarkColor}@${settings.watermarkOpacity.toFixed(3)}:x='clip((W-tw)*${xPosition},0,max(0,W-tw))':y='clip((H-th)*${yPosition},0,max(0,H-th))':shadowx=2:shadowy=2:shadowcolor=black@0.7`;
    filterLines.push(`${current}${drawtext}${label}`);
    current = label;
  }

  if (settings.speed !== 1) {
    const label = nextLabel("v_speed");
    filterLines.push(`${current}setpts=(PTS-STARTPTS)/${settings.speed.toFixed(4)}${label}`);
    current = label;
  }

  // FastEdit trims the already speed-adjusted timeline inside the filter
  // graph.  Keeping this here avoids the timestamp jumps caused by output
  // level -ss/-t after a setpts transform.
  if (settings.trimStart > 0 || settings.trimEnd !== null) {
    const end = settings.trimEnd !== null ? `:end=${settings.trimEnd.toFixed(3)}` : "";
    const label = nextLabel("v_trim");
    filterLines.push(`${current}trim=start=${settings.trimStart.toFixed(3)}${end},setpts=PTS-STARTPTS${label}`);
    current = label;
  }

  filterLines.push(`${current}format=yuv420p[v_final]`);
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", basePath];
  // Image2's -loop option is not available in every FFmpeg build used by
  // StoryAI.  The overlay's eof_action=repeat keeps one logo frame alive for
  // the full main-video timeline, so no looping input is needed.
  if (logoPath) args.push("-i", logoPath);
  args.push("-filter_complex", filterLines.join(";"), "-map", "[v_final]");
  if (manifest.audio.available) {
    args.push("-map", "0:a:0", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2");
    args.push("-af", timelineAudioFilterChain(settings));
  } else {
    args.push("-an");
  }
  args.push("-shortest", "-fps_mode", "passthrough", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", outputDuration.toFixed(3), outputPath);
  await runProcess(ffmpegPath(), args);
}

function phaseValue() {
  return (Math.random() * Math.PI * 2).toFixed(6);
}

function safeOutputSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "episode";
}

function renderOutputDirectory(project: StoryProject, target?: RenderEpisodeTarget) {
  if (!target) return path.join(OUTPUT_DIR, project.slug);
  return path.join(OUTPUT_DIR, project.slug, "episodes", safeOutputSegment(target.chunkId), safeOutputSegment(target.renderId));
}

export async function renderProjectVideo(project: StoryProject, manifest: RenderManifest, inputSettings?: Partial<RenderSettings>, target?: RenderEpisodeTarget) {
  const ffmpeg = ffmpegPath();
  try {
    await runProcess(ffmpeg, ["-version"]);
  } catch {
    throw new Error("FFMPEG_NOT_AVAILABLE");
  }
  if (!manifest.scenes.length) throw new Error("RENDER_NO_SCENES");

  const renderId = target?.renderId || `render-${Date.now()}`;
  const tempDir = path.join(RENDER_DIR, project.slug, target ? `${safeOutputSegment(target.chunkId)}-${safeOutputSegment(renderId)}` : renderId);
  const segmentDir = path.join(tempDir, "segments");
  const outputDir = renderOutputDirectory(project, target);
  const outputFilename = target ? `tap-${String(target.episodeNumber).padStart(2, "0")}.mp4` : `${renderId}.mp4`;
  const outputPath = path.join(outputDir, outputFilename);
  const basePath = path.join(tempDir, "base.mp4");
  const concatPath = path.join(tempDir, "concat.txt");
  const settings = normalizeRenderSettings(inputSettings || DEFAULT_RENDER_SETTINGS);
  const logoPath = await resolveLogoPath(settings);
  await mkdir(segmentDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  try {
    const baseFilter = `scale=${manifest.width}:${manifest.height}:force_original_aspect_ratio=decrease,pad=${manifest.width}:${manifest.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${manifest.fps},format=yuv420p`;
    const segmentPaths: string[] = [];
    for (const scene of manifest.scenes) {
      const segmentPath = path.join(segmentDir, `${String(scene.index + 1).padStart(4, "0")}.mp4`);
      segmentPaths.push(segmentPath);
      const sourcePath = scene.mediaPath ? path.resolve(process.cwd(), scene.mediaPath) : undefined;
      const validSource = sourcePath && await (async () => {
        try { return (await stat(sourcePath)).isFile(); } catch { return false; }
      })();
      const videoSource = Boolean(validSource && scene.mediaKind === "video");
      const inputArgs: string[] = validSource
        // Loop still images, but never loop short videos from their first frame.
        // Video scenes hold their last frame for the remaining scene duration.
        ? videoSource ? ["-i", sourcePath] : ["-stream_loop", "-1", "-i", sourcePath]
        : ["-f", "lavfi", "-i", `color=c=0x12131e:s=${manifest.width}x${manifest.height}:r=${manifest.fps}`];
      const filter = videoSource
        ? `tpad=stop_mode=clone:stop_duration=${scene.durationSec.toFixed(3)},${baseFilter}`
        : baseFilter;
      const audioAvailable = manifest.audio.available;
      let audioMap: string[] = [];
      if (audioAvailable) {
        const dialogueMixPath = scene.audioCues?.length ? await createDialogueMix(ffmpeg, scene, tempDir) : undefined;
        const sceneAudioPath = scene.audioPath ? await existingDataFile(scene.audioPath) : undefined;
        const ttsAudioPath = dialogueMixPath || sceneAudioPath;
        if (ttsAudioPath) {
          inputArgs.push("-i", ttsAudioPath);
          audioMap = ["-map", "1:a:0"];
        } else if (videoSource && scene.sourceHasAudio) {
          // Keep the provider video’s native soundtrack whenever this scene has
          // no TTS mix. Do not mix both tracks, since they may contain duplicate dialogue.
          audioMap = ["-map", "0:a:0"];
        } else {
          inputArgs.push("-f", "lavfi", "-t", scene.durationSec.toFixed(3), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
          audioMap = ["-map", "1:a:0"];
        }
      }
      const audioArgs = audioAvailable
        ? ["-map", "0:v:0", ...audioMap, "-af", `apad,atrim=duration=${scene.durationSec.toFixed(3)},aresample=async=1:first_pts=0`, "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]
        : ["-map", "0:v:0", "-an"];
      await runProcess(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...inputArgs, "-t", scene.durationSec.toFixed(3), "-vf", filter, ...audioArgs, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", segmentPath]);
    }
    await writeFile(concatPath, segmentPaths.map(escapeConcatPath).map((file) => `file ${file}`).join("\n"));
    const concatOutput = hasPostProcessing(settings, Boolean(logoPath)) ? basePath : outputPath;
    await runProcess(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", "-movflags", "+faststart", concatOutput]);
    if (concatOutput === basePath) {
      await applyFinalRenderEffects({ basePath, outputPath, manifest, settings, tempDir, logoPath });
    }
    return localRelative(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function writeRenderArtifacts(project: StoryProject, manifest: RenderManifest, inputSettings?: Partial<RenderSettings>, target?: RenderEpisodeTarget) {
  const settings = normalizeRenderSettings(inputSettings || DEFAULT_RENDER_SETTINGS);
  const outputDir = renderOutputDirectory(project, target);
  await mkdir(outputDir, { recursive: true });
  const manifestFilename = target ? `tap-${String(target.episodeNumber).padStart(2, "0")}.json` : "render-manifest.json";
  const subtitleFilename = target ? `tap-${String(target.episodeNumber).padStart(2, "0")}.srt` : "render.srt";
  const manifestPath = path.join(outputDir, manifestFilename);
  const subtitlePath = path.join(outputDir, subtitleFilename);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(subtitlePath, writeSrt(manifest.scenes, settings.speed, settings.reverse, settings.trimStart, settings.trimEnd));
  return { manifestPath: localRelative(manifestPath), subtitlePath: localRelative(subtitlePath) };
}

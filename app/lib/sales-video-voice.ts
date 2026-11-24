import { execFile } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { synthesizeOmniVoiceFromSrt } from "./omnivoice-tts-server";
import { salesVideoPath } from "./sales-video-storage";

const exec = promisify(execFile);
const ffmpeg = () => process.env.STORYAI_FFMPEG_PATH || process.env.VIBE_FFMPEG_PATH || "ffmpeg";

type SubtitleCue = { start: number; end: number; text: string };

function timeToSeconds(value: string) {
  const match = value.trim().match(/^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/u);
  if (!match) return Number.NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

export function parseSalesVideoSrt(srt: string, duration: number): SubtitleCue[] {
  const cues = srt.replace(/^\uFEFF/u, "").split(/\r?\n\s*\r?\n/u).flatMap((block) => {
    const lines = block.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) return [];
    const [startText, endText] = lines[timeIndex].split("-->").map((value) => value.trim().split(/\s+/u)[0]);
    const start = timeToSeconds(startText || "");
    const end = timeToSeconds(endText || "");
    const text = lines.slice(timeIndex + 1).join(" ").replace(/<[^>]*>/gu, "").replace(/&nbsp;/giu, " ").trim();
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start >= duration) return [];
    return [{ start, end: Math.min(end, duration), text }];
  });
  if (!cues.length || cues.length > 120) throw new Error("SRT không có cue hợp lệ hoặc vượt quá 120 câu thoại.");
  return cues;
}

export async function regenerateSalesVideoVoice(input: {
  userId: string;
  projectId: string;
  srt: string;
  duration: number;
  language: string;
  voiceId: string;
  signal?: AbortSignal;
}) {
  const source = salesVideoPath(input.userId, input.projectId);
  const sourceStat = await stat(source).catch(() => null);
  if (!sourceStat?.isFile()) throw new Error("Không tìm thấy MP4 hiện tại để thay voice.");
  parseSalesVideoSrt(input.srt, input.duration);
  const work = path.join(path.dirname(source), "voice", `regenerate-${Date.now()}`);
  await mkdir(work, { recursive: true, mode: 0o700 });
  try {
    if (input.signal?.aborted) throw new Error("Đã hủy tạo lại voice.");
    const targetAudio = await synthesizeOmniVoiceFromSrt(
      input.srt,
      input.voiceId,
      input.language,
      path.join(work, "voice-track"),
      input.userId,
      input.signal,
    );

    const temporaryVideo = `${source}.voice-${Date.now()}.tmp.mp4`;
    try {
      await exec(ffmpeg(), ["-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-i", source, "-i", targetAudio,
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-af", "apad", "-t", String(input.duration), "-movflags", "+faststart", temporaryVideo],
      { signal: input.signal, timeout: 600_000 });
      await rename(temporaryVideo, source);
    } catch (error) {
      await rm(temporaryVideo, { force: true }).catch(() => undefined);
      throw error;
    }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

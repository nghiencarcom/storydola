import { execFile } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { synthesizeOmniVoice } from "./omnivoice-tts-server";
import { salesVideoPath } from "./sales-video-storage";

const exec = promisify(execFile);
const ffmpeg = () => process.env.STORYAI_FFMPEG_PATH || process.env.VIBE_FFMPEG_PATH || "ffmpeg";
const ffprobe = () => process.env.STORYAI_FFPROBE_PATH || path.join(path.dirname(ffmpeg()), "ffprobe");

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

async function audioDuration(file: string) {
  const { stdout } = await exec(ffprobe(), ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { timeout: 15_000 });
  const value = Number(stdout.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error("MaiVideo trả về một đoạn voice không hợp lệ.");
  return value;
}

function tempoChain(factor: number) {
  const filters: string[] = [];
  let remaining = factor;
  while (remaining > 2) { filters.push("atempo=2"); remaining /= 2; }
  while (remaining < 0.5) { filters.push("atempo=0.5"); remaining /= 0.5; }
  if (Math.abs(remaining - 1) > 0.01) filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters;
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
  const cues = parseSalesVideoSrt(input.srt, input.duration);
  const work = path.join(path.dirname(source), "voice", `regenerate-${Date.now()}`);
  await mkdir(work, { recursive: true, mode: 0o700 });
  try {
    const files: string[] = [];
    for (const [index, cue] of cues.entries()) {
      if (input.signal?.aborted) throw new Error("Đã hủy tạo lại voice.");
      const output = path.join(work, `cue-${index + 1}.wav`);
      await synthesizeOmniVoice(cue.text, input.voiceId, input.language, output, input.userId, input.signal);
      files.push(output);
    }
    const targetAudio = path.join(work, "voice-track.wav");
    const args = ["-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-t", String(input.duration), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"];
    for (const file of files) args.push("-i", file);
    const filters: string[] = [];
    const mixInputs = ["[0:a]"];
    for (const [index, cue] of cues.entries()) {
      const available = Math.max(0.15, Math.min(cue.end - cue.start, input.duration - cue.start));
      const sourceDuration = await audioDuration(files[index]);
      const tempo = sourceDuration > available ? tempoChain(sourceDuration / available).join(",") : "anull";
      const delay = Math.max(0, Math.round(cue.start * 1000));
      const label = `voice${index}`;
      filters.push(`[${index + 1}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,${tempo},apad,atrim=duration=${available.toFixed(3)},adelay=${delay}|${delay}[${label}]`);
      mixInputs.push(`[${label}]`);
    }
    filters.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:normalize=0,atrim=duration=${input.duration}[mixed]`);
    args.push("-filter_complex", filters.join(";"), "-map", "[mixed]", "-ar", "48000", "-ac", "2", "-t", String(input.duration), targetAudio);
    await exec(ffmpeg(), args, { signal: input.signal, timeout: 600_000 });

    const temporaryVideo = `${source}.voice-${Date.now()}.tmp.mp4`;
    try {
      await exec(ffmpeg(), ["-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-i", source, "-i", targetAudio,
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-t", String(input.duration), "-movflags", "+faststart", temporaryVideo],
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

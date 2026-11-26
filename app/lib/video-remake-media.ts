import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { isIP } from "node:net";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import sharp from "sharp";
import { isPublicIp } from "./public-product-page";
import { ingestSourceUrl } from "./source-ingest";
import { makeRemakeWindows, type RemakeAudioCue, type RemakeInput, type RemakeTranscript, type RemakeWindow } from "./video-remake";

import { classifyRemakeSource } from "./video-remake-source";
import { downloadFromMaiVideo } from "./video-remake-maivideo";

const exec = promisify(execFile);
const ffmpeg = () => process.env.STORYAI_FFMPEG_PATH || process.env.VIBE_FFMPEG_PATH || "ffmpeg";
const ffprobe = () => process.env.STORYAI_FFPROBE_PATH || path.join(path.dirname(ffmpeg()), "ffprobe");
const inputOptions = ["-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm"];
type PlatformSource = NonNullable<ReturnType<typeof classifyRemakeSource>>;

async function openPublicUrl(url: URL, signal?: AbortSignal) {
  const host = url.hostname;
  if (url.protocol !== "https:" || url.port || url.username || url.password || !host.includes(".")
    || isIP(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Link video phải dùng HTTPS công khai.");
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address, family }) => !isPublicIp(address)
    || (family === 6 && !/^[23]/u.test(address)))) throw new Error("Máy chủ video phải có địa chỉ IP công khai.");
  const { address, family } = addresses[0];
  return new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    const request = get(url, {
      signal, family,
      lookup: (_hostname, _options, callback) => callback(null, address, family),
      headers: { "User-Agent": "Mozilla/5.0", Accept: "video/*,application/octet-stream,text/html;q=0.8" },
    }, resolve).once("error", reject);
    request.setTimeout(60_000, () => request.destroy(new Error("Kết nối tải video không truyền dữ liệu trong 60 giây.")));
  });
}

function redirectTarget(response: import("node:http").IncomingMessage, url: URL) {
  return response.headers.location && [301, 302, 303, 307, 308].includes(response.statusCode || 0)
    ? new URL(response.headers.location, url)
    : undefined;
}

async function resolvePlatformLink(source: PlatformSource) {
  let current = source;
  const signal = AbortSignal.timeout(30_000);
  for (let redirects = 0; current.short && redirects < 5; redirects++) {
    const url = new URL(current.url);
    const response = await openPublicUrl(url, signal);
    response.destroy();
    const target = redirectTarget(response, url);
    const next = target && classifyRemakeSource(target);
    if (!next || next.platform !== source.platform) break;
    current = next;
  }
  if (current.short) throw new Error(`Không mở được link rút gọn ${source.label}. Hãy dán link đầy đủ của video công khai.`);
  return current;
}

export async function downloadDirect(source: URL, file: string) {
  let url = source;
  for (let redirects = 0; redirects <= 4; redirects++) {
    const response = await openPublicUrl(url);
    const target = redirectTarget(response, url);
    if (target) {
      response.destroy();
      url = target;
      continue;
    }
    if (response.statusCode !== 200 || !/^(?:video\/|application\/octet-stream\b)/iu.test(response.headers["content-type"] || "")) {
      response.destroy();
      throw new Error("Link này không trả về tệp video. Hãy dùng link nền tảng được hỗ trợ hoặc link trực tiếp tới MP4, MOV, WebM.");
    }
    await pipeline(response, createWriteStream(file, { mode: 0o600 }));
    return;
  }
  throw new Error("Link video chuyển hướng quá nhiều lần.");
}

async function douyinCookieArgs(source: PlatformSource, work: string) {
  const configured = process.env.STORYAI_DOUYIN_COOKIES_PATH?.trim();
  if (source.platform !== "douyin" || !configured) return [];
  const details = await stat(configured).catch(() => undefined);
  if (!details?.isFile() || details.size > 256 * 1024) throw new Error("Tệp cookie Douyin cấu hình trên máy chủ không hợp lệ.");
  const text = await readFile(configured, "utf8").catch(() => "");
  // Only pass the public playback session cookies to yt-dlp.
  const lines = text.split(/\r?\n/u).filter((line) => {
    const [domain, , , , , name] = line.replace(/^#HttpOnly_/u, "").split("\t");
    return /^(?:\.)?(?:(?:www|m)\.)?(?:douyin|iesdouyin)\.com$/iu.test(domain)
      && ["s_v_web_id", "ttwid", "msToken"].includes(name);
  });
  if (!lines.length) throw new Error("Tệp cookie Douyin chưa có cookie của phiên xem công khai.");
  const copy = path.join(work, "douyin-cookies.txt");
  await writeFile(copy, ["# Netscape HTTP Cookie File", ...lines, ""].join("\n"), { mode: 0o600 });
  return ["--cookies", copy];
}

async function downloadPlatformVideo(source: PlatformSource, work: string, maiVideoUrl = source.url) {
  let maiVideoError: Error | undefined;
  try {
    return await downloadFromMaiVideo(maiVideoUrl, work);
  } catch (error) {
    maiVideoError = error instanceof Error ? error : new Error("MaiVideo chưa tải được video.");
  }

  const downloader = process.env.STORYAI_YT_DLP_PATH?.trim() || process.env.VIBE_TOOL_YT_DLP_PATH?.trim() || "yt-dlp";
  let stdout: string;
  try {
    const cookieArgs = await douyinCookieArgs(source, work);
    ({ stdout } = await exec(downloader, [
      "--ignore-config", "--js-runtimes", `node:${process.execPath}`, "--use-extractors", source.extractors,
      "--no-playlist", "--playlist-items", "1", "--no-progress", "--no-cache-dir", ...cookieArgs,
      "--socket-timeout", "25", "--retries", "2",
      "--match-filter", "!is_live",
      "--format", "b[ext=mp4][height<=?720][protocol=https]/b[ext=webm][height<=?720][protocol=https]/bv[height<=?720][protocol=https]+ba[protocol=https]/b[ext=mp4][protocol=https]/b[ext=webm][protocol=https]",
      "--merge-output-format", "mkv", "--no-simulate", "--print", "after_move:filepath",
      "--output", path.join(work, "source.%(ext)s"), "--", source.url,
    ], { maxBuffer: 1_000_000 }));
  } catch (error) {
    const detail = error as NodeJS.ErrnoException & { stderr?: string };
    if (detail.code === "ENOENT") throw new Error(`${maiVideoError.message} yt-dlp chưa được cài hoặc chưa có trong PATH.`);
    if (source.platform === "douyin" && /fresh cookies/iu.test(detail.stderr || "")) {
      throw new Error(`${maiVideoError.message} yt-dlp cũng cần cookie phiên Douyin còn mới; cấu hình STORYAI_DOUYIN_COOKIES_PATH hoặc thử lại sau.`);
    }
    if (/HTTP Error 403/u.test(detail.stderr || "")) {
      throw new Error(`${maiVideoError.message} ${source.label} cũng từ chối yt-dlp (HTTP 403).`);
    }
    throw new Error(`${maiVideoError.message} yt-dlp cũng chưa tải được từ ${source.label}.`);
  }
  const file = stdout.trim().split(/\r?\n/u).find((line) =>
    path.dirname(line) === work && /^source\.(?:mp4|webm|mkv|mov)$/iu.test(path.basename(line)));
  if (!file || !(await stat(file).catch(() => undefined))?.size) {
    throw new Error(`${maiVideoError.message} yt-dlp cũng chưa trả tệp video phù hợp từ ${source.label}.`);
  }
  return file;
}

async function probeVideo(file: string) {
  let stdout: string;
  try {
    ({ stdout } = await exec(ffprobe(), [
      "-v", "error", ...inputOptions, "-show_streams", "-show_format", "-of", "json", file,
    ], { timeout: 30_000, maxBuffer: 2_000_000 }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Cần cài FFmpeg và FFprobe trên máy chạy StoryAI.");
    throw new Error("Không đọc được tệp video. Hãy dùng MP4, MOV hoặc WebM hợp lệ.");
  }
  const { format, streams } = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type: string; width?: number; height?: number; duration?: string;
      disposition?: { attached_pic?: number }; side_data_list?: Array<{ rotation?: number }> }>;
  };
  const videoStreams = streams?.filter(({ codec_type }) => codec_type === "video") || [];
  const videoIndex = videoStreams.findIndex(({ width, height, disposition }) => width && height && !disposition?.attached_pic);
  const video = videoStreams[videoIndex];
  const seconds = Math.round((Number(video?.duration) || Number(format?.duration)) * 1000) / 1000;
  if (!video || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("Không đọc được hình ảnh hoặc thời lượng của video.");
  }
  const rotated = Math.abs(Number(video.side_data_list?.[0]?.rotation || 0)) % 180 === 90;
  const ratio = rotated ? video.height! / video.width! : video.width! / video.height!;
  const aspectRatio = ratio < 0.85 ? "9:16" : ratio > 1.18 ? "16:9" : "1:1";
  return {
    seconds, aspectRatio, videoIndex,
    audio: streams?.some(({ codec_type }) => codec_type === "audio"),
    captions: streams?.some(({ codec_type }) => codec_type === "subtitle"),
  };
}

function runFfmpeg(args: string[], timeout?: number, maxBuffer = 1_000_000) {
  return exec(ffmpeg(), ["-nostdin", "-hide_banner", "-loglevel", "error", ...args], {
    timeout, maxBuffer, encoding: "buffer",
  });
}

export function extractAudioWindowCues(pcm: Buffer, sampleRate: number, windows: RemakeWindow[]): RemakeAudioCue[] {
  const totalSamples = Math.floor(pcm.length / 2);
  if (!totalSamples || sampleRate <= 0) return [];
  const bucketSec = 0.2;
  const bucketSize = Math.max(1, Math.round(sampleRate * bucketSec));
  return windows.map((window, index) => {
    const startSample = Math.max(0, Math.floor(window.sourceStart * sampleRate));
    const endSample = Math.min(totalSamples, Math.ceil(window.sourceEnd * sampleRate));
    if (endSample <= startSample) return { scene: index + 1, rmsDb: null, peaksAt: [], pauses: [] };
    const buckets: Array<{ relTime: number; rmsDb: number; peakDb: number }> = [];
    let sumSqAll = 0;
    for (let pos = startSample; pos < endSample; pos += bucketSize) {
      const limit = Math.min(endSample, pos + bucketSize);
      let sumSq = 0;
      let peak = 0;
      for (let i = pos; i < limit; i++) {
        const sample = pcm.readInt16LE(i * 2) / 32768;
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
        sumSq += sample * sample;
      }
      sumSqAll += sumSq;
      const rms = Math.sqrt(sumSq / (limit - pos));
      const rmsDb = rms > 1e-5 ? 20 * Math.log10(rms) : -90;
      const peakDb = peak > 1e-5 ? 20 * Math.log10(peak) : -90;
      const relTime = Number((((pos - startSample) + (limit - pos) * 0.5) / sampleRate).toFixed(2));
      buckets.push({ relTime, rmsDb, peakDb });
    }
    const windowRms = Math.sqrt(sumSqAll / (endSample - startSample));
    const windowRmsDb = windowRms > 1e-5 ? Math.round(20 * Math.log10(windowRms) * 10) / 10 : null;
    const sortedRms = buckets.map((b) => b.rmsDb).sort((a, b) => a - b);
    const medianRms = sortedRms[Math.floor(sortedRms.length / 2)] ?? -90;
    const spikeCandidates = buckets
      .filter((b) => b.peakDb >= -30 && (b.peakDb - medianRms >= 5.5 || b.rmsDb - medianRms >= 4.5))
      .sort((a, b) => b.peakDb - a.peakDb);
    const peaksAt: number[] = [];
    for (const candidate of spikeCandidates) {
      if (peaksAt.length >= 3) break;
      if (peaksAt.every((existing) => Math.abs(existing - candidate.relTime) >= 0.5)) {
        peaksAt.push(candidate.relTime);
      }
    }
    peaksAt.sort((a, b) => a - b);

    const pauses: Array<[number, number]> = [];
    let quietStart: number | null = null;
    for (let i = 0; i < buckets.length; i++) {
      const isQuiet = buckets[i].rmsDb < -38;
      const tStart = Number((i * bucketSec).toFixed(2));
      if (isQuiet && quietStart === null) quietStart = tStart;
      if (!isQuiet && quietStart !== null) {
        if (tStart - quietStart >= 0.6 && pauses.length < 2) pauses.push([quietStart, tStart]);
        quietStart = null;
      }
    }
    const windowDur = Number((window.sourceEnd - window.sourceStart).toFixed(2));
    if (quietStart !== null && windowDur - quietStart >= 0.6 && pauses.length < 2) {
      pauses.push([quietStart, windowDur]);
    }
    return { scene: index + 1, rmsDb: windowRmsDb, peaksAt, pauses };
  });
}

async function analyzeAudioWindows(source: string, hasAudio: boolean | undefined, windows: RemakeWindow[]): Promise<RemakeAudioCue[]> {
  if (!hasAudio || !windows.length) return [];
  const sampleRate = 500;
  try {
    const { stdout } = await runFfmpeg([
      ...inputOptions, "-i", source, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", String(sampleRate), "-f", "s16le", "pipe:1",
    ], 45_000, 24_000_000);
    return extractAudioWindowCues(stdout, sampleRate, windows);
  } catch {
    return [];
  }
}

type TranscriptEvidence = { kind: RemakeTranscript; text: string };

async function getTranscript(input: RemakeInput, source: string, platform: PlatformSource | undefined, work: string, video: Awaited<ReturnType<typeof probeVideo>>): Promise<TranscriptEvidence> {
  if (input.transcript) return { kind: "manual", text: input.transcript };
  if (video.captions) {
    const file = path.join(work, "embedded.srt");
    const text = await runFfmpeg([...inputOptions, "-i", source, "-map", "0:s:0", file])
      .then(() => readFile(file, "utf8")).then((value) => value.trim()).catch(() => "");
    if (text) return { kind: "captions", text };
  }
  if (!video.audio) return { kind: "silent", text: "" };
  const whisper = process.env.STORYAI_WHISPER_TRANSCRIBE_PATH?.trim();
  if (whisper) {
    const audio = path.join(work, "audio.wav");
    const srt = path.join(work, "speech.srt");
    try {
      await runFfmpeg([...inputOptions, "-i", source, "-map", "0:a:0", "-ac", "1", "-ar", "16000", audio]);
      const modelDir = process.env.STORYAI_WHISPER_MODEL_DIR?.trim();
      await exec(whisper, [audio, "--output-srt", srt, ...(modelDir ? ["--model-dir", modelDir] : [])], { cwd: work });
      const text = (await readFile(srt, "utf8")).trim();
      if (text) return { kind: "transcribed", text };
    } catch {
      // MaiVideo can still provide a transcript on supported platforms.
    }
  }
  if (platform?.maiVideo) {
    const result = await ingestSourceUrl(platform.url, 5 * 60_000).catch(() => undefined);
    if (result?.text) return { kind: "transcribed", text: result.text };
  }
  return { kind: "unavailable", text: "" };
}

async function sampleFrames(file: string, videoIndex: number, window: RemakeWindow, width: number, height: number) {
  const sampleAt = [0.08, 0.35, 0.65, 0.9].map((part) => window.sourceStart + (window.sourceEnd - window.sourceStart) * part);
  const args = (time: number) => ["-ss", time.toFixed(3), ...inputOptions, "-i", file, "-map", `0:v:${videoIndex}`,
    "-frames:v", "1", "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease`, "-c:v", "mjpeg", "-f", "image2pipe", "pipe:1"];
  const frames = [];
  for (const time of sampleAt) {
    const { stdout } = await runFfmpeg(args(time), 30_000);
    if (stdout.length) frames.push({ time: Number(time.toFixed(3)), data: stdout });
  }
  if (!frames.length) {
    const time = Math.max(0, window.sourceStart - 0.25);
    const { stdout } = await runFfmpeg(args(time), 30_000);
    if (!stdout.length) throw new Error(`Không đọc được khung hình ở mốc ${window.sourceStart} giây.`);
    frames.push({ time: Number(time.toFixed(3)), data: stdout });
  }
  return frames;
}

export async function prepareRemakeMedia(input: RemakeInput, work: string, sourceDownloadUrl?: string, localSourceFile?: string) {
  let source: string;
  let platform: PlatformSource | undefined;
  if (localSourceFile) {
    if (!(await stat(localSourceFile).catch(() => undefined))?.isFile()) throw new Error("Không tìm thấy tệp video đã tải lên.");
    source = localSourceFile;
  } else if (sourceDownloadUrl) {
    source = path.join(work, "source.video");
    await downloadDirect(new URL(sourceDownloadUrl), source);
  } else {
    const url = new URL(input.url);
    const classified = classifyRemakeSource(url);
    platform = classified ? await resolvePlatformLink(classified) : undefined;
    if (platform) {
      const maiVideoUrl = platform.platform === "douyin" && classified && !classified.short ? input.url : platform.url;
      source = await downloadPlatformVideo(platform, work, maiVideoUrl);
    } else {
      source = path.join(work, "source.video");
      await downloadDirect(url, source);
    }
  }
  const video = await probeVideo(source);
  const windows = makeRemakeWindows(video.seconds, 5);
  const width = 360;
  const height = video.aspectRatio === "16:9" ? 216 : 360;
  const rowsPerSheet = 3;
  const columnsPerSheet = 4;
  const sheets = [];
  for (let offset = 0; offset < windows.length; offset += rowsPerSheet) {
    const rows = await Promise.all(windows.slice(offset, offset + rowsPerSheet).map((window) =>
      sampleFrames(source, video.videoIndex, window, width, height)));
    const cells = await Promise.all(rows.flatMap((row, y) => row.slice(0, columnsPerSheet).map(async ({ data }, x) => ({
      input: await sharp(data).resize(width, height, { fit: "contain", background: "#111111" }).jpeg().toBuffer(),
      left: x * width, top: y * height,
    }))));
    const imagePath = path.join(work, `frames-${sheets.length + 1}.jpg`);
    await sharp({ create: { width: columnsPerSheet * width, height: rows.length * height, channels: 3, background: "#111111" } })
      .composite(cells).jpeg({ quality: 88 }).toFile(imagePath);
    sheets.push({ imagePath, rows: rows.map((row, index) => ({
      scene: offset + index + 1, framesAt: row.map(({ time }) => time),
    })) });
  }
  const [transcript, audioCues] = await Promise.all([
    getTranscript(input, source, platform, work, video),
    analyzeAudioWindows(source, video.audio, windows),
  ]);
  return { windows, sheets, aspectRatio: video.aspectRatio, transcript, audioCues };
}

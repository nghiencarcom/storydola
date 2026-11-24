import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { createFalClient } from "@fal-ai/client";
import sharp from "sharp";
import { generateMaiVideoPixverseV6ReferenceSegment, generateMaiVideoSalesSegment, generateSalesVideoSegment, generateSeedanceGatewaySalesSegment } from "./media-provider";
import { videoDurationOptions } from "./media-generation-settings";
import type { VideoGenerationModelOption } from "./project-types";
import { pixverseSalesClient } from "./pixverse-sales-video";
import { salesVideoPath, salesVideoSegmentPath, type SalesVideoPostProcessing } from "./sales-video-storage";
import { salesVideoProductReferenceLock, salesVideoProductScriptInstruction, salesVideoWordCount, type salesVideoCreativeTemplates } from "./sales-video-templates";

const exec = promisify(execFile);
const ffmpeg = () => process.env.STORYAI_FFMPEG_PATH || process.env.VIBE_FFMPEG_PATH || "ffmpeg";
const ffprobe = () => process.env.STORYAI_FFPROBE_PATH || path.join(path.dirname(ffmpeg()), "ffprobe");
const videoFormat = ["-format_whitelist", "mov"];
const audioFormats = ["-format_whitelist", "mp3,wav,mov,aac,ogg,flac"];

type SalesVideoTextOverlay = NonNullable<SalesVideoPostProcessing["textOverlay"]>;

function escapeXml(value: string) {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;")
    .replace(/\"/gu, "&quot;").replace(/'/gu, "&apos;");
}

function wrapOverlayText(text: string, maximumLineLength: number, maximumLines: number) {
  const lines: string[] = [];
  const cleanText = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
  const inputLines = cleanText.replace(/\r/gu, "").split("\n");
  for (const inputLine of inputLines) {
    const words = inputLine.trim().split(/\s+/u).filter(Boolean);
    let line = "";
    for (const word of words) {
      const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(word)].map(({ segment }) => segment);
      while (graphemes.length) {
        const part = graphemes.splice(0, maximumLineLength).join("");
        if (!line) {
          line = part;
        } else if (`${line} ${part}`.length <= maximumLineLength) {
          line += ` ${part}`;
        } else {
          lines.push(line);
          line = part;
        }
        if (graphemes.length) {
          lines.push(line);
          line = "";
        }
      }
    }
    if (line) lines.push(line);
    else if (!words.length && lines.length) lines.push("");
  }
  if (lines.length > maximumLines) {
    lines.length = maximumLines;
    lines[maximumLines - 1] = `${lines[maximumLines - 1].slice(0, Math.max(1, maximumLineLength - 1)).trimEnd()}…`;
  }
  return lines.length ? lines : [""];
}

async function renderSalesVideoTextOverlay(
  source: string,
  output: string,
  work: string,
  overlay: SalesVideoTextOverlay,
  duration: number,
  signal?: AbortSignal,
) {
  const { stdout } = await exec(ffprobe(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", source],
    { signal, timeout: 15_000 });
  const stream = (JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> }).streams?.[0];
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) throw new Error("Could not read stitched video dimensions for Text/Emoji overlay.");

  const fontSize = Math.max(26, Math.min(64, Math.round(width * 0.055)));
  const horizontalPadding = Math.round(width * 0.065);
  const contentWidth = width - horizontalPadding * 2;
  const maximumLineLength = Math.max(12, Math.floor((contentWidth - fontSize * 1.1) / (fontSize * 0.57)));
  const lines = wrapOverlayText(overlay.text, maximumLineLength, 4);
  const lineHeight = Math.round(fontSize * 1.24);
  const verticalPadding = Math.round(fontSize * 0.5);
  const cardHeight = lineHeight * lines.length + verticalPadding * 2;
  const top = overlay.position === "top"
    ? Math.round(height * 0.08)
    : overlay.position === "center"
      ? Math.round((height - cardHeight) / 2)
      : Math.round(height * 0.88 - cardHeight);
  const lineMarkup = lines.map((line, index) =>
    `<text x="${width / 2}" y="${top + verticalPadding + fontSize + index * lineHeight}" text-anchor="middle" font-family="Arial, 'Apple Color Emoji', 'Noto Color Emoji', 'Segoe UI Emoji', sans-serif" font-size="${fontSize}" font-weight="700" fill="#fff" stroke="#111827" stroke-opacity=".45" stroke-width="${Math.max(1, Math.round(fontSize * 0.04))}" paint-order="stroke">${escapeXml(line)}</text>`
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="${horizontalPadding}" y="${top}" width="${contentWidth}" height="${cardHeight}" rx="${Math.round(fontSize * 0.45)}" fill="#090b14" fill-opacity=".72"/>${lineMarkup}</svg>`;
  const overlayImage = path.join(work, "text-emoji-overlay.png");
  await sharp(Buffer.from(svg)).png().toFile(overlayImage);
  await exec(ffmpeg(), ["-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-i", source,
    "-loop", "1", "-framerate", "24", "-i", overlayImage,
    "-filter_complex", "[0:v:0][1:v:0]overlay=0:0:shortest=1:format=auto[v]",
    "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-t", String(duration), "-movflags", "+faststart", output], { signal, timeout: 600_000 });
}

function salesVideoOutputSize(ratio: string, quality: string) {
  const normalized = quality.trim().toLowerCase();
  const parsed = Number(normalized.match(/^(\d{3,4})p$/u)?.[1]);
  const shortEdge = normalized === "4k" ? 2160 : Number.isFinite(parsed) && parsed > 0 ? parsed : 720;
  const longEdge = Math.round(shortEdge * 16 / 9 / 2) * 2;
  return ratio === "9:16" ? [shortEdge, longEdge] as const : [longEdge, shortEdge] as const;
}

function scenePlanForSegment(prompt: string, start: number, end: number) {
  const marker = "KỊCH BẢN HÌNH ẢNH VÀ TIMELINE (ưu tiên timeline này; không lặp cảnh):";
  const markerIndex = prompt.indexOf(marker);
  const scenePrompt = markerIndex >= 0 ? prompt.slice(markerIndex + marker.length) : prompt;
  const lines = scenePrompt.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const timeRange = /^(\d+(?:[.,]\d+)?)\s*(?:–|-)\s*(\d+(?:[.,]\d+)?)\s*s?\s*:\s*(.+)$/iu;
  const beats: Array<{ start: number; end: number; description: string }> = [];
  const prelude: string[] = [];
  for (const line of lines) {
    const match = line.match(timeRange);
    if (match) {
      beats.push({ start: Number(match[1].replace(",", ".")), end: Number(match[2].replace(",", ".")), description: match[3] });
    } else if (!beats.length && prelude.join(" ").length < 360) {
      prelude.push(line);
    }
  }
  const selected = beats.filter((beat) => beat.end > start && beat.start < end).map((beat) => {
    const localStart = Math.max(start, beat.start) - start;
    const localEnd = Math.min(end, beat.end) - start;
    return `${localStart}–${localEnd}s: ${beat.description}`;
  });
  if (!selected.length && !beats.length) return (prelude.join(" ") || scenePrompt.trim()).slice(0, 900);
  return [prelude.join(" ").slice(0, 360), ...selected].filter(Boolean).join("\n");
}

export class SalesVideoInputError extends Error {}
export class SalesVideoSegmentError extends Error {
  constructor(readonly segmentIndex: number, message: string) {
    super(message);
    this.name = "SalesVideoSegmentError";
  }
}

async function download(url: string | undefined, file: string, signal: AbortSignal) {
  if (!url || new URL(url).protocol !== "https:") throw new Error("Invalid provider media URL");
  const result = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
  if (!result.ok) throw new Error(`Download failed (${result.status})`);
  await writeFile(file, Buffer.from(await result.arrayBuffer()));
}

// rea-video is optional on deployments that only have FFmpeg. Both paths
// return clip-relative cut timings and leave the source video as the motion reference.
async function referenceShotTiming(clip: string, work: string, index: number, duration: number, signal: AbortSignal) {
  let cuts: number[] = [];
  const rea = process.env.STORYAI_REA_VIDEO_PATH?.trim();
  if (rea) {
    try {
      const out = path.join(work, `analysis-${index}`);
      await exec(rea, ["decompose", clip, "--out", out, "--lang", "en", "--no-vlm", "--no-stems", "--no-ocr", "--no-asr", "--no-packaging"], {
        signal, timeout: 60_000,
        env: { ...process.env, PATH: [path.dirname(rea), path.dirname(ffprobe()), path.dirname(ffmpeg()), process.env.PATH].filter(Boolean).join(path.delimiter) },
      });
      const report = JSON.parse(await readFile(path.join(out, "breakdown.json"), "utf8")) as { shots?: { start?: number }[] };
      cuts = (report.shots || []).map((shot) => Number(shot.start));
    } catch (error) {
      signal.throwIfAborted();
      console.warn("rea-video analysis unavailable", error instanceof Error ? error.name : "UnknownError");
    }
  }
  if (!cuts.length) {
    const { stderr } = await exec(ffmpeg(), ["-nostdin", "-hide_banner", "-loglevel", "info", "-i", clip,
      "-an", "-vf", "select=gt(scene\\,0.35),showinfo", "-f", "null", "-"], { signal, timeout: 30_000 });
    cuts = [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1]));
  }
  const clips = [...new Set(cuts.filter((cut) => cut > 0.1 && cut < duration - 0.1).map((cut) => cut.toFixed(2)))].slice(0, 20);
  return clips.length ? ` Keep the original cuts at approximately ${clips.join(", ")} seconds.` : " Keep the shot continuous.";
}

function splitLabeledDialogue(script: string, durations: number[], totalSeconds: number, language: string) {
  const lines = script.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (!lines.length || !lines.some((line) => /^(?:Người hỏi(?:\s*\(ngoài khung hình\))?|Người trả lời|Người giới thiệu)\s*:/iu.test(line))) return undefined;
  const wordCounts = lines.map((line) => salesVideoWordCount(line, language));
  const totalWords = Math.max(1, wordCounts.reduce((sum, count) => sum + count, 0));
  const boundaries: number[] = [];
  let elapsed = 0;
  for (const duration of durations) boundaries.push(elapsed += duration);
  const result = durations.map(() => [] as string[]);
  let passed = 0;
  lines.forEach((line, index) => {
    const midpoint = ((passed + wordCounts[index] / 2) / totalWords) * totalSeconds;
    const segmentIndex = Math.min(boundaries.findIndex((end) => midpoint <= end) < 0
      ? durations.length - 1 : boundaries.findIndex((end) => midpoint <= end), durations.length - 1);
    result[segmentIndex].push(line);
    passed += wordCounts[index];
  });
  return result.map((segment) => segment.join("\n"));
}

export async function createCreativeSalesVideo(input: {
  id: string;
  userId: string;
  template: typeof salesVideoCreativeTemplates[number];
  images: string[];
  audio?: File;
  video?: File;
  prompt: string;
  promptSegments?: Array<{ start: number; duration: number; prompt: string }>;
  postProcessing?: SalesVideoPostProcessing;
  seconds: number;
  ratio: string;
  videoQuality?: string;
  videoOffPeak?: boolean;
  model: "higgsfield" | "pixverse-avatar";
  maiVideoModel?: VideoGenerationModelOption;
  gatewayVideoModel?: VideoGenerationModelOption;
  pixverseKey?: string;
  voiceKey?: string;
  providerAuthToken: string;
  sourceStart?: number;
  splitDialogue?: { script: string; language: string; audio: boolean; segments: number[]; scriptSegments?: Array<{ start: number; duration: number; script: string }> };
  onlySegmentIndex?: number;
  signal: AbortSignal;
}) {
  const { id, userId, template, images, audio, video, prompt, ratio, signal } = input;
  const output = input.onlySegmentIndex === undefined
    ? salesVideoPath(userId, id)
    : salesVideoSegmentPath(userId, id, input.onlySegmentIndex);
  const work = path.join(path.dirname(salesVideoPath(userId, id)), "work", randomUUID());
  const source = path.join(work, "source");
  const soundtrack = path.join(work, "speech.wav");
  const pixverse = input.model === "higgsfield" || input.maiVideoModel ? undefined : pixverseSalesClient(input.pixverseKey!, signal);
  const sourceStart = input.sourceStart ?? 0;
  const run = (args: string[]) => exec(ffmpeg(), ["-nostdin", "-hide_banner", "-loglevel", "error", ...args], { signal, timeout: 120_000 });
  let seconds = input.seconds;
  await mkdir(work, { recursive: true });
  let currentSegmentIndex: number | undefined;
  try {
    if (video || audio) {
      const file = video || audio!;
      await writeFile(source, Buffer.from(await file.arrayBuffer()));
    }
    if (video) {
      try {
        const { stdout } = await exec(ffprobe(), ["-v", "error", ...videoFormat, "-select_streams", "v:0", "-show_entries", "stream=duration:format=duration", "-of", "json", source], { signal, timeout: 15_000 });
        const metadata = JSON.parse(stdout);
        const length = Number(metadata.streams?.[0]?.duration || metadata.format?.duration);
        if (!metadata.streams?.length || !Number.isFinite(length) || length < 2) throw new Error("Invalid video duration");
        if (template.workflow === "remake" && sourceStart + seconds > length + 0.05) {
          throw new SalesVideoInputError("Đoạn còn lại của video mẫu ngắn hơn thời lượng đã chọn. Hãy chọn mốc bắt đầu sớm hơn hoặc dùng video dài hơn.");
        }
        seconds = Math.min(seconds, length);
      } catch (error) {
        if (error instanceof SalesVideoInputError) throw error;
        throw new SalesVideoInputError("Video mẫu phải đọc được và dài ít nhất 2 giây. Máy chủ cần FFprobe.");
      }
    }
    if (audio) {
      try {
        await run([...audioFormats, "-i", source, "-map", "0:a:0", "-ac", "1", "-ar", "24000", "-t", String(seconds), soundtrack]);
        if ((await readFile(soundtrack)).length < 4800) throw new Error("Empty audio");
      } catch {
        throw new SalesVideoInputError("Tệp âm thanh trống hoặc không đọc được.");
      }
    }
    if (template.workflow === "narration") {
      const client = createFalClient({ credentials: input.voiceKey! });
      const result = await client.subscribe("heygen/heygen-voice", {
        input: { text: prompt, reference_audio_url: await client.storage.upload(new File([new Uint8Array(await readFile(soundtrack))], "voice.wav", { type: "audio/wav" })) },
        abortSignal: signal, timeout: 300_000,
      });
      await download((result.data as { audio?: { url?: string } }).audio?.url, soundtrack, signal);
    }

    const activeVideoModel = input.maiVideoModel || input.gatewayVideoModel;
    const durationOptions = activeVideoModel ? videoDurationOptions(activeVideoModel, activeVideoModel.qualities.includes("720p") ? "720p" : activeVideoModel.qualities[0]) : [];
    const modelLimit = input.splitDialogue ? 15 : activeVideoModel?.id === "wan-3.0" ? 30 : durationOptions.at(-1) || 15;
    const isPairedImageWorkflow = template.workflow === "poses" || template.workflow === "narration";
    const imagePairCount = isPairedImageWorkflow ? Math.ceil(images.length / 2) : 0;
    const plannedDurations = imagePairCount
      ? Array.from({ length: imagePairCount }, (_, index) => Math.floor(seconds / imagePairCount) + (index < seconds % imagePairCount ? 1 : 0))
      : [seconds];
    const durations = input.splitDialogue?.segments ?? plannedDurations.flatMap((length) => {
      const count = Math.ceil(length / modelLimit);
      return Array.from({ length: count }, (_, index) => Math.ceil(length * (index + 1) / count) - Math.ceil(length * index / count));
    });
    const imageGroups = plannedDurations.flatMap((length, index) => Array(Math.ceil(length / modelLimit)).fill(index));
    if (input.onlySegmentIndex !== undefined && (!Number.isInteger(input.onlySegmentIndex)
      || input.onlySegmentIndex < 0 || input.onlySegmentIndex >= durations.length)) {
      throw new SalesVideoInputError("Không tìm thấy clip 15 giây cần tạo lại.");
    }
    const imageIds = pixverse ? await Promise.all(images.map((image) => pixverse.uploadImage(image))) : [];
    const [width, height] = salesVideoOutputSize(ratio, input.videoQuality || "720p");
    const segments: string[] = [];
    const generatedSegments: Array<{ start: number; duration: number; prompt: string }> = [];
    const dialogue = input.splitDialogue;
    const words = dialogue ? [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(dialogue.script)]
      .filter((part) => part.isWordLike) : [];
    const dialogueBoundary = (time: number) => words[Math.round(words.length * time / seconds)]?.index ?? dialogue?.script.length ?? 0;
    const labeledDialogueSegments = dialogue
      ? dialogue.scriptSegments?.map((segment) => segment.script) || splitLabeledDialogue(dialogue.script, durations, seconds, dialogue.language)
      : undefined;
    let start = 0;
    for (const [index, length] of durations.entries()) {
      if (input.onlySegmentIndex !== undefined && index !== input.onlySegmentIndex) {
        start += length;
        continue;
      }
      currentSegmentIndex = index;
      const pairedImages = isPairedImageWorkflow;
      const referenceImages = pairedImages ? images.slice(imageGroups[index] * 2, imageGroups[index] * 2 + 2) : images;
      const referenceIds = pairedImages ? imageIds.slice(imageGroups[index] * 2, imageGroups[index] * 2 + 2) : imageIds;
      const usesMaiVideoReference = input.maiVideoModel?.provider === "maivideo"
        && input.maiVideoModel.id === "v6"
        && (template.workflow === "remake" || template.workflow === "background");
      const productImageCount = Math.max(1, referenceImages.length - 1);
      let sourceVideoId: string | undefined;
      let sourceVideoReference: File | undefined;
      let sourceAudioId: string | undefined;
      let timing = "";
      if (video && (pixverse || usesMaiVideoReference)) {
        const clip = path.join(work, `reference-${index}.mp4`);
        await run([...videoFormat, "-ss", String(sourceStart + start), "-i", source, "-t", String(length), "-an", "-vf",
          "scale=1920:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
          "-r", "24", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
        const clippedReference = new File([new Uint8Array(await readFile(clip))], "reference.mp4", { type: "video/mp4" });
        if (pixverse) {
          timing = await referenceShotTiming(clip, work, index, length, signal);
          sourceVideoId = await pixverse.uploadMedia(clippedReference);
        }
        if (usesMaiVideoReference) sourceVideoReference = clippedReference;
      }
      if (template.workflow === "audio" && pixverse) {
        const clip = path.join(work, `speech-${index}.wav`);
        await run(["-i", soundtrack, "-af", `apad,atrim=start=${start}:duration=${length},asetpts=PTS-STARTPTS`, clip]);
        sourceAudioId = await pixverse.uploadMedia(new File([new Uint8Array(await readFile(clip))], "speech.wav", { type: "audio/wav" }));
      }
      const section = durations.length > 1 ? ` Đây là đoạn ${index + 1}/${durations.length}, từ giây ${start} đến ${start + length}. Chỉ dựng nội dung tương ứng với đoạn này.` : "";
      const scriptSegment = dialogue
        ? labeledDialogueSegments?.[index] ?? dialogue.script.slice(start ? dialogueBoundary(start) : 0, dialogueBoundary(start + length))
        : "";
      const segmentDialogue = dialogue ? salesVideoProductScriptInstruction(scriptSegment, dialogue.language, dialogue.audio) : "";
      const continuity = dialogue ? (index === 0
        ? "Start the ad and begin the demonstration. Do not deliver the final call to action in this clip."
        : index === durations.length - 1
          ? "Continue from the previous clip without repeating the hook. Finish the demonstration and close gently only if the assigned dialogue calls for it."
          : "Continue the same ad and presenter without repeating earlier scenes.")
        : "";
      const productReferenceLockInPrompt = template.workflow === "prompt"
        && template.files.length === 0
        && prompt.startsWith("REFERENCE LOCK — @Image1 is the only presenter");
      const splitProductAd = Boolean(dialogue && durations.length > 1 && template.workflow === "prompt");
      const assignedPrompt = input.promptSegments?.[index];
      const segmentPrompt = assignedPrompt?.prompt || (splitProductAd
        ? [
          `UGC CLIP ${index + 1}/${durations.length}: create only seconds ${start}–${start + length} of the ${seconds}-second ad. This clip is ${length} seconds, aspect ratio ${ratio}. Use only the scene beats below; do not replay scenes from another clip.`,
          salesVideoProductReferenceLock(productImageCount),
          "CAMERA: Keep the same room, eye-level camera axis, natural perspective and soft light across clips. Use a stable medium shot, one clear product close-up and at most one restrained camera move per beat. Keep the product unobstructed and hands natural; no spins, complex moves, focus pumping or glossy CGI.",
          `SCENE BEATS FOR THIS CLIP:\n${scenePlanForSegment(prompt, start, start + length)}`,
          continuity,
          segmentDialogue,
        ].filter(Boolean).join("\n\n")
        : [
          (productReferenceLockInPrompt ? "" : template.instruction) + section + timing,
          prompt && template.workflow !== "narration" ? prompt : "",
          continuity,
          segmentDialogue,
        ].filter(Boolean).join("\n\n"));
      generatedSegments.push({ start, duration: length, prompt: segmentPrompt });
      const rendered = path.join(work, `rendered-${index}.mp4`);
      if (pixverse) {
        await download(await pixverse.generate({
          images: referenceIds, video: sourceVideoId, audio: sourceAudioId, prompt: segmentPrompt,
          duration: Math.max(2, Math.ceil(length)), ratio, sound: template.workflow === "prompt", background: template.workflow === "background",
        }), rendered, signal);
      } else if (input.maiVideoModel && usesMaiVideoReference && sourceVideoReference) {
        await generateMaiVideoPixverseV6ReferenceSegment({
          prompt: segmentPrompt, outputPath: rendered, aspectRatio: ratio,
          durationSec: length, references: referenceImages, referenceVideo: sourceVideoReference,
          authToken: input.providerAuthToken, model: input.maiVideoModel,
          quality: input.videoQuality, signal,
        });
      } else if (input.maiVideoModel) {
        await generateMaiVideoSalesSegment({
          userId, prompt: segmentPrompt, outputPath: rendered, aspectRatio: ratio,
          durationSec: length, references: referenceImages, model: input.maiVideoModel,
          quality: input.videoQuality, offPeak: input.videoOffPeak,
          signal, audio: template.workflow === "prompt",
        });
      } else if (input.gatewayVideoModel) {
        await generateSeedanceGatewaySalesSegment({
          userId, prompt: segmentPrompt, outputPath: rendered, aspectRatio: ratio,
          durationSec: length, references: referenceImages,
          referenceNames: referenceImages.map((_, index) => `Image${index + 1}`),
          model: input.gatewayVideoModel, providerAuthToken: input.providerAuthToken, signal,
        });
      } else {
        await generateSalesVideoSegment({
          prompt: segmentPrompt, outputPath: rendered, aspectRatio: ratio,
          durationSec: [5, 10, 15].find((value) => value >= length) ?? 15,
          references: referenceImages, referenceNames: referenceImages.map((_, index) => `Image${index + 1}`),
          providerAuthToken: input.providerAuthToken, signal, audio: template.workflow === "prompt",
        });
      }
      const segment = `segment-${index}.mp4`;
      // Normalize every segment before joining, including a silent track when the provider sends video only.
      await run(["-i", rendered, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
        "-map", "0:v:0", "-map", "0:a:0?", "-map", "1:a:0", "-t", String(length),
        "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,tpad=stop_mode=clone:stop_duration=${length}`,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", path.join(work, segment)]);
      const segmentOutput = salesVideoSegmentPath(userId, id, index);
      await mkdir(path.dirname(segmentOutput), { recursive: true });
      await copyFile(path.join(work, segment), segmentOutput);
      segments.push(segment);
      start += length;
      currentSegmentIndex = undefined;
    }

    if (input.onlySegmentIndex !== undefined) {
      await rm(work, { recursive: true, force: true });
      return generatedSegments;
    }

    const manifest = path.join(work, "segments.txt");
    await writeFile(manifest, segments.map((segment) => `file '${segment}'\n`).join(""));
    let audioInput = template.workflow === "audio" || template.workflow === "narration" ? soundtrack : video ? source : "";
    if (video) {
      const { stdout } = await exec(ffprobe(), ["-v", "error", ...videoFormat, "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", source], { signal, timeout: 15_000 });
      if (!stdout.trim()) audioInput = "";
    }
    const final = path.join(work, "final.mp4");
    await run(["-f", "concat", "-safe", "1", "-i", manifest, ...(audioInput ? [...(video ? [...videoFormat, "-ss", String(sourceStart)] : ["-format_whitelist", "wav"]), "-i", audioInput] : []),
      "-map", "0:v:0", "-map", audioInput ? "1:a:0" : "0:a:0",
      ...(audioInput ? ["-af", "apad", "-c:a", "aac"] : ["-c:a", "copy"]),
      "-t", String(seconds), "-c:v", "copy", "-movflags", "+faststart", final]);
    await mkdir(path.dirname(output), { recursive: true });
    if (input.postProcessing?.textOverlay) {
      const withOverlay = path.join(work, "final-with-overlay.mp4");
      await renderSalesVideoTextOverlay(final, withOverlay, work, input.postProcessing.textOverlay, seconds, signal);
      await rename(withOverlay, output);
    } else {
      await rename(final, output);
    }
    await rm(work, { recursive: true, force: true });
    return generatedSegments;
  } catch (error) {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
    if (currentSegmentIndex !== undefined) {
      throw new SalesVideoSegmentError(currentSegmentIndex, error instanceof Error ? error.message : "Không tạo được clip.");
    }
    throw error;
  }
}

export async function ensureSalesVideoSegmentFile(userId: string, id: string, index: number, start: number, duration: number) {
  const output = salesVideoSegmentPath(userId, id, index);
  if (await stat(output).catch(() => null)) return output;

  const projectDirectory = path.dirname(salesVideoPath(userId, id));
  const legacySegment = path.join(projectDirectory, `segment-${index}.mp4`);
  if (await stat(legacySegment).catch(() => null)) {
    await mkdir(path.dirname(output), { recursive: true });
    await copyFile(legacySegment, output);
    return output;
  }

  const source = salesVideoPath(userId, id);
  if (!await stat(source).catch(() => null)) throw new Error(`Thiếu clip ${index + 1}.`);
  const work = path.join(projectDirectory, "segment-extract", randomUUID());
  const temporary = path.join(work, `clip-${index + 1}.mp4`);
  await mkdir(work, { recursive: true });
  try {
    await exec(ffmpeg(), ["-nostdin", "-hide_banner", "-loglevel", "error", "-ss", String(start), "-i", source,
      "-t", String(duration), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", temporary],
    { timeout: 120_000 });
    await mkdir(path.dirname(output), { recursive: true });
    await rename(temporary, output);
    return output;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function stitchSalesVideoSegments(
  userId: string,
  id: string,
  segments: Array<{ start: number; duration: number }>,
  duration: number,
  textOverlay?: SalesVideoTextOverlay,
) {
  if (!segments.length || segments.some((segment) => !Number.isInteger(segment.start) || !Number.isInteger(segment.duration) || segment.duration < 1)) {
    throw new Error("Danh sách clip cần ghép không hợp lệ.");
  }
  const segmentFiles = await Promise.all(segments.map((segment, index) => ensureSalesVideoSegmentFile(userId, id, index, segment.start, segment.duration)));
  const output = salesVideoPath(userId, id);
  const work = path.join(path.dirname(output), "stitch", randomUUID());
  await mkdir(work, { recursive: true });
  try {
    const manifest = path.join(work, "segments.txt");
    const entries = segmentFiles.map((file) => `file '${file.replace(/'/gu, "'\\''")}'\n`).join("");
    await writeFile(manifest, entries);
    const final = path.join(work, "final.mp4");
    await exec(ffmpeg(), ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", manifest,
      "-map", "0:v:0", "-map", "0:a:0?", "-t", String(duration), "-c", "copy", "-movflags", "+faststart", final],
    { timeout: 120_000 });
    if (textOverlay) {
      const withOverlay = path.join(work, "final-with-overlay.mp4");
      await renderSalesVideoTextOverlay(final, withOverlay, work, textOverlay, duration);
      await rename(withOverlay, output);
    } else {
      await rename(final, output);
    }
    return output;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

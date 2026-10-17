import { MAX_SCENE_DURATION_SEC, type ScriptFormat, type StoryProject } from "./project-types";
import { imageStylePrompt, visualStylePrompt } from "./visual-styles";

export const MAX_TTS_WORDS_PER_SECOND = 3;
export const SAFE_WORDS_PER_SCENE = 36;

export type ManualScriptCue = {
  id: string;
  text: string;
  startSec: number;
  endSec: number;
};

export type ManualScriptMetrics = {
  narrationDurationSec: number;
  durationSeconds: number;
  sceneCount: number;
  wordCount: number;
  issues: string[];
};

function parseTimestamp(value: string) {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function formatTimestamp(value: number) {
  const milliseconds = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function looksLikeSrt(value: string) {
  return /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(value);
}

export function countScriptWords(value: string) {
  return value.trim().match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length || 0;
}

export function estimateVoiceDurationSec(value: string) {
  const words = countScriptWords(value);
  if (!words) return 0;
  const commas = (value.match(/[,،;；]/g) || []).length;
  const sentenceStops = (value.match(/[.!?。！？]/g) || []).length;
  const pause = Math.min(2.5, commas * 0.12 + sentenceStops * 0.24);
  return Number(Math.max(0.8, words / MAX_TTS_WORDS_PER_SECOND + pause).toFixed(3));
}

export function parseSrt(value: string): ManualScriptCue[] {
  return value
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((block, index) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) return undefined;
      const timing = lines[timingIndex].split("-->").map((item) => item.trim());
      const start = parseTimestamp(timing[0] || "");
      const end = parseTimestamp(timing[1] || "");
      const text = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]+>/g, "").trim();
      if (start === undefined || end === undefined || end <= start || !text) return undefined;
      return { id: lines.slice(0, timingIndex).join(" ") || String(index + 1), text, startSec: start, endSec: end };
    })
    .filter((cue): cue is ManualScriptCue => Boolean(cue));
}

function splitWords(value: string, maxWords = SAFE_WORDS_PER_SCENE) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  for (let index = 0; index < words.length; index += maxWords) parts.push(words.slice(index, index + maxWords).join(" "));
  return parts.length ? parts : [""];
}

function splitPlainText(value: string) {
  const units = value.trim().split(/(?<=[.!?。！？])\s+|\n+/).map((item) => item.trim()).filter(Boolean);
  return units.flatMap((unit) => splitWords(unit));
}

function normalizeSrtCues(cues: ManualScriptCue[], autoTiming: boolean) {
  if (!autoTiming) return cues;
  let cursor = 0;
  return cues.map((cue) => {
    const start = Math.max(cue.startSec, cursor);
    const end = start + Math.max(cue.endSec - cue.startSec, estimateVoiceDurationSec(cue.text));
    cursor = end;
    return { ...cue, startSec: Number(start.toFixed(3)), endSec: Number(end.toFixed(3)) };
  });
}

export function buildManualScriptCues(value: string, format: ScriptFormat = "plain_text", autoTiming = true): ManualScriptCue[] {
  if (!value.trim()) return [];
  if (format === "srt" || looksLikeSrt(value)) {
    const sourceCues = normalizeSrtCues(parseSrt(value), autoTiming);
    const result: ManualScriptCue[] = [];
    for (const cue of sourceCues) {
      const parts = splitWords(cue.text);
      const totalWords = Math.max(1, countScriptWords(cue.text));
      let cursor = cue.startSec;
      for (let index = 0; index < parts.length; index += 1) {
        const partWords = Math.max(1, countScriptWords(parts[index]));
        const proportional = (cue.endSec - cue.startSec) * (partWords / totalWords);
        // Always respect the narration ceiling, even when the user supplied an
        // SRT with long or too-short cue timings. Long source gaps are kept as
        // silent hold scenes by buildManualSceneDrafts; narration itself never
        // becomes a >15s scene or exceeds the 3 words/second target.
        const minimum = Math.max(proportional, estimateVoiceDurationSec(parts[index]));
        const duration = Math.min(MAX_SCENE_DURATION_SEC, Math.max(0.8, minimum));
        result.push({ id: `${cue.id}-${index + 1}`, text: parts[index], startSec: Number(cursor.toFixed(3)), endSec: Number((cursor + duration).toFixed(3)) });
        cursor += duration;
      }
    }
    return result;
  }

  const result: ManualScriptCue[] = [];
  let cursor = 0;
  for (const text of splitPlainText(value)) {
    const duration = estimateVoiceDurationSec(text);
    result.push({ id: String(result.length + 1), text, startSec: Number(cursor.toFixed(3)), endSec: Number((cursor + duration).toFixed(3)) });
    cursor += duration;
  }
  return result;
}

function timelineSceneCount(cues: ManualScriptCue[], durationSeconds: number) {
  let cursor = 0;
  let count = 0;
  for (const cue of cues) {
    const start = Math.max(cursor, cue.startSec);
    if (start > cursor + 0.01) count += Math.ceil((start - cursor) / MAX_SCENE_DURATION_SEC);
    count += 1;
    cursor = Math.max(start, cue.endSec);
  }
  return count + Math.max(0, Math.ceil((durationSeconds - cursor) / MAX_SCENE_DURATION_SEC));
}

export function getManualScriptMetrics({ text, format = "plain_text", durationMode = "auto", targetDurationSeconds = 0 }: { text: string; format?: ScriptFormat; durationMode?: "manual" | "auto"; targetDurationSeconds?: number }): ManualScriptMetrics {
  const cues = buildManualScriptCues(text, format, durationMode === "auto");
  const narrationDurationSec = cues.length ? cues[cues.length - 1].endSec : 0;
  const durationSeconds = Math.max(narrationDurationSec, durationMode === "manual" ? Math.max(0, targetDurationSeconds) : 0);
  const issues: string[] = [];
  let previousEnd = 0;
  for (const cue of cues) {
    const duration = cue.endSec - cue.startSec;
    const rate = countScriptWords(cue.text) / Math.max(0.001, duration);
    if (duration > MAX_SCENE_DURATION_SEC + 0.01) issues.push(`${cue.id}: cảnh dài hơn ${MAX_SCENE_DURATION_SEC}s.`);
    if (rate > MAX_TTS_WORDS_PER_SECOND + 0.01) issues.push(`${cue.id}: tốc độ đọc dự kiến ${rate.toFixed(2)} từ/giây, vượt giới hạn.`);
    if (cue.startSec < previousEnd - 0.01) issues.push(`${cue.id}: timecode bị chồng lên cảnh trước.`);
    previousEnd = Math.max(previousEnd, cue.endSec);
  }
  return {
    narrationDurationSec: Number(narrationDurationSec.toFixed(3)),
    durationSeconds: Number(durationSeconds.toFixed(3)),
    sceneCount: timelineSceneCount(cues, durationSeconds),
    wordCount: countScriptWords(text),
    issues,
  };
}

function visualKeyword(text: string) {
  return text.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 8).join(" ") || "cinematic atmospheric scene";
}

export function buildManualSceneDrafts(project: StoryProject) {
  const format = project.scriptFormat || (looksLikeSrt(project.sourceText) ? "srt" : "plain_text");
  const autoTiming = (project.durationMode || "manual") === "auto";
  const visualDirection = visualStylePrompt(project.visualStyle) || project.visualStyle;
  const renderingStyle = imageStylePrompt(project.imageStyle) || project.imageStyle;
  const styleNotes = `Visual direction: ${visualDirection}. Image style: ${renderingStyle}.`;
  const cues = buildManualScriptCues(project.sourceText, format, autoTiming);
  const scenes: Array<Record<string, unknown> & { sceneNumber: number; start_sec: number; end_sec: number }> = [];
  let cursor = 0;

  function addHold(until: number) {
    while (until > cursor + 0.01) {
      const end = Math.min(until, cursor + MAX_SCENE_DURATION_SEC);
      const sceneNumber = scenes.length + 1;
      const previous = sceneNumber > 1 ? `Tiếp nối trực tiếp cảnh S${String(sceneNumber - 1).padStart(3, "0")}.` : "Mở đầu project bằng nền hình ảnh liên tục.";
      const next = `Dẫn trực tiếp sang cảnh S${String(sceneNumber + 1).padStart(3, "0")} khi đến mốc tiếp theo.`;
      scenes.push({
        id: `S${String(sceneNumber).padStart(3, "0")}`,
        sceneNumber,
        start_sec: Number(cursor.toFixed(3)),
        end_sec: Number(end.toFixed(3)),
        act: "manual-hold",
        purpose: "Giữ hình/nhạc nền theo timeline; không có narration.",
        beat_summary: "",
        dialogue_or_voiceover: "",
        voiceover_target_sec: 0,
        media_type: "video",
        image_keyword: "atmospheric background",
        video_keyword: "atmospheric background",
        image_prompt: `Atmospheric visual hold matching the previous scene. ${styleNotes} Aspect ratio: ${project.aspectRatio}. No readable text in frame.`,
        video_prompt: `Very subtle continuous motion matching the previous scene, no new story information. ${styleNotes} Aspect ratio: ${project.aspectRatio}.`,
        continuity_in: previous,
        continuity_out: next,
        source_basis: "Generated silent hold to preserve the user-selected timeline.",
        risk_flags: [],
        script_text_locked: true,
      });
      cursor = end;
    }
  }

  for (const cue of cues) {
    addHold(Math.max(cursor, cue.startSec));
    const sceneNumber = scenes.length + 1;
    const start = cursor;
    const end = Number((start + Math.max(0.8, cue.endSec - cue.startSec)).toFixed(3));
    const keyword = visualKeyword(cue.text);
    const previous = sceneNumber > 1 ? `Tiếp nối trực tiếp cảnh S${String(sceneNumber - 1).padStart(3, "0")} trong timeline.` : "Mở đầu kịch bản người dùng.";
    const next = `Dẫn trực tiếp sang cảnh S${String(sceneNumber + 1).padStart(3, "0")} theo đúng thứ tự kịch bản người dùng.`;
    scenes.push({
      id: `S${String(sceneNumber).padStart(3, "0")}`,
      sceneNumber,
      start_sec: Number(start.toFixed(3)),
      end_sec: end,
      act: "manual-script",
      purpose: "Minh họa nguyên văn kịch bản người dùng.",
      beat_summary: cue.text,
      dialogue_or_voiceover: cue.text,
      voiceover_target_sec: Number((cue.endSec - cue.startSec).toFixed(3)),
      media_type: "video",
      image_keyword: keyword,
      video_keyword: keyword,
      image_prompt: `Visual illustration of: ${cue.text.slice(0, 420)}. ${styleNotes} Aspect ratio: ${project.aspectRatio}. No readable text in frame.`,
      video_prompt: `Subtle motion that illustrates this user-provided narration without adding story details: ${cue.text.slice(0, 420)}. ${styleNotes} Aspect ratio: ${project.aspectRatio}.`,
      continuity_in: previous,
      continuity_out: next,
      source_basis: "User-provided manual script; narration is locked and must not be rewritten.",
      risk_flags: [],
      script_text_locked: true,
    });
    cursor = end;
  }
  const targetDuration = (project.durationMode || "manual") === "manual" ? Number(project.durationSeconds || project.durationMinutes * 60) : 0;
  addHold(targetDuration);
  return scenes;
}

export function formatDurationLabel(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes} phút ${String(remainder).padStart(2, "0")} giây`;
}

export function formatSrtTimestamp(seconds: number) {
  return formatTimestamp(seconds);
}

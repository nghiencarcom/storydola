import { normalizeEntityName } from "./entity-name";
import { countScriptWords } from "./script-utils";
import type { DialogueDeliveryPace, DialogueSegment, ProjectCharacter } from "./project-types";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function firstText(record: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function numeric(record: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    if (record[key] === null || record[key] === "") continue;
    const value = Number(record[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

function textMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([language, text]) => [language.trim(), typeof text === "string" ? text.trim() : ""] as const)
    .filter(([language, text]) => language && text);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function audioMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, audio]) => audio && typeof audio === "object" && !Array.isArray(audio))
    .map(([language, audio]) => [language.trim(), audio] as const)
    .filter(([language]) => language);
  return entries.length ? Object.fromEntries(entries) as DialogueSegment["translatedAudio"] : undefined;
}

function speakerCharacterId(record: JsonRecord, characters: ProjectCharacter[]) {
  const explicitId = firstText(record, "speakerCharacterId", "speaker_character_id");
  if (explicitId) return characters.find((character) => character.id === explicitId)?.id || "";
  const speakerName = firstText(record, "speakerName", "speaker_name", "speaker_character", "speakerCharacter", "speaker");
  const normalized = normalizeEntityName(speakerName);
  if (!normalized || ["narrator", "voiceover", "none", "n a"].includes(normalized)) return "";
  return characters.find((character) => normalizeEntityName(character.name) === normalized)?.id || "";
}

export function hasExplicitDialogueSegments(scene: JsonRecord) {
  return Array.isArray(scene.dialogueSegments) || Array.isArray(scene.dialogue_segments);
}

/** Reject unedited sample instructions before they can be treated as spoken dialogue. */
export function isTemplateDialogueText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return false;
  return /^\s*\[\s*(?:cảnh\s+\d+\s*s?\s*:|tên nhân vật\s*\]|lời thoại\b|canonical character name\b|replace with\b|placeholder\b)/i.test(text)
    || /^\s*\[[^\]]*\]\s*:\s*\[/i.test(text)
    || /^\s*\[[^\]]*(?:tối thiểu|mục tiêu|voiceover instruction|dialogue instruction|replace this)/i.test(text);
}

/** Read the new cue list, or expose a legacy scene-level line as one editable cue. */
export function readDialogueSegments(scene: JsonRecord, characters: ProjectCharacter[] = []): DialogueSegment[] {
  const raw = Array.isArray(scene.dialogueSegments) ? scene.dialogueSegments : Array.isArray(scene.dialogue_segments) ? scene.dialogue_segments : undefined;
  if (raw) {
    return raw.map((value, index) => {
      const record = asRecord(value);
      const audio = asRecord(record.audio);
      const translations = textMap(record.translations);
      const translatedAudio = audioMap(record.translatedAudio ?? record.translated_audio);
      const text = firstText(record, "text", "dialogue", "line", "dialogue_or_voiceover", "voiceover");
      const startMs = numeric(record, "startMs", "start_ms") ?? ((numeric(record, "start_sec", "startSec") ?? 0) * 1000);
      const endMs = numeric(record, "endMs", "end_ms") ?? ((numeric(record, "end_sec", "endSec") ?? -1) * 1000);
      const rawPace = firstText(record, "deliveryPace", "delivery_pace").toLowerCase();
      const deliveryPace = ["measured", "natural", "brisk"].includes(rawPace) ? rawPace as DialogueDeliveryPace : undefined;
      const pauseAfterMs = numeric(record, "pauseAfterMs", "pause_after_ms")
        ?? (numeric(record, "pauseAfterSec", "pause_after_sec") !== undefined ? Number(record.pauseAfterSec ?? record.pause_after_sec) * 1000 : undefined);
      return {
        id: firstText(record, "id", "segmentId", "segment_id") || `line-${index + 1}`,
        speakerCharacterId: speakerCharacterId(record, characters),
        speakerName: firstText(record, "speakerName", "speaker_name", "speaker_character", "speakerCharacter", "speaker") || undefined,
        text,
        startMs: Math.round(startMs),
        ...(endMs >= 0 ? { endMs: Math.round(endMs) } : {}),
        ...(deliveryPace ? { deliveryPace } : {}),
        ...(pauseAfterMs !== undefined ? { pauseAfterMs: Math.round(pauseAfterMs) } : {}),
        ...(record.intentionalOverlap === true || record.intentional_overlap === true ? { intentionalOverlap: true } : {}),
        ...(Object.keys(audio).length ? { audio: audio as DialogueSegment["audio"] } : {}),
        ...(translations ? { translations } : {}),
        ...(translatedAudio ? { translatedAudio } : {}),
      };
    }).filter((segment) => segment.text && !isTemplateDialogueText(segment.text));
  }

  const text = firstText(scene, "dialogue_or_voiceover", "dialogueOrVoiceover", "voiceText", "voiceover", "ttsVoice", "tts_voice");
  if (!text || isTemplateDialogueText(text)) return [];
  const speakerId = speakerCharacterId(scene, characters);
  const speakerName = firstText(scene, "speaker_character", "speakerCharacter", "speaker_name", "speakerName", "speaker") || undefined;
  const audio = asRecord(scene.audio);
  return [{
    id: "line-1",
    speakerCharacterId: speakerId || undefined,
    speakerName,
    text,
    startMs: 0,
    ...(Object.keys(audio).length ? { audio: audio as DialogueSegment["audio"] } : {}),
  }];
}

export function dialogueSegmentsText(segments: DialogueSegment[]) {
  return segments.map((segment) => segment.text.trim()).filter(Boolean).join("\n");
}

const DIALOGUE_PACE_UNITS_PER_SECOND: Record<DialogueDeliveryPace, number> = {
  measured: 2.1,
  natural: 2.6,
  brisk: 3,
};

function punctuationPauseMs(text: string) {
  const ellipses = (text.match(/(?:…|\.{3,})/g) || []).length;
  const withoutEllipses = text.replace(/(?:…|\.{3,})/g, "");
  const commas = (withoutEllipses.match(/[,،;；:]/g) || []).length;
  const stops = (withoutEllipses.match(/[.!?。！？]/g) || []).length;
  return Math.min(1_500, ellipses * 430 + commas * 120 + stops * 240);
}

/** Approximate spoken time from read units, acting pace, and pauses inside a line. */
export function estimateDialogueDurationMs(text: string, pace: DialogueDeliveryPace = "natural") {
  const units = countScriptWords(text);
  if (!units) return 0;
  const rate = DIALOGUE_PACE_UNITS_PER_SECOND[pace] || DIALOGUE_PACE_UNITS_PER_SECOND.natural;
  const speechMs = units / rate * 1000;
  return Math.max(550, Math.min(14_000, Math.round(speechMs + punctuationPauseMs(text))));
}

export type DialogueTimingAssessment = {
  score: number;
  status: "pass" | "warning" | "fail";
  issues: string[];
  estimatedSpeechMs: number;
  allocatedSpeechMs: number;
};

function inferredTurnPauseMs(text: string) {
  if (/(?:…|\.{3,})\s*$/.test(text)) return 650;
  if (/[.!?。！？]\s*$/.test(text)) return 360;
  if (/[,،;；:]\s*$/.test(text)) return 240;
  return 160;
}

/** Score whether scene-local speaking windows match each line's length and pace. */
export function scoreDialogueTiming(segments: DialogueSegment[], sceneDurationSec: number): DialogueTimingAssessment | undefined {
  const spoken = segments.filter((segment) => segment.text.trim());
  if (!spoken.length) return undefined;

  let score = 100;
  const issues: string[] = [];
  let estimatedSpeechMs = 0;
  let allocatedSpeechMs = 0;
  const cueDurations: number[] = [];
  const cueUnits: number[] = [];
  const sceneDurationMs = Number.isFinite(sceneDurationSec) && sceneDurationSec > 0 ? sceneDurationSec * 1000 : undefined;

  for (const [index, cue] of spoken.entries()) {
    const units = countScriptWords(cue.text);
    const recordedAudioMs = Number(cue.audio?.durationMs);
    const hasRecordedAudioDuration = Number.isFinite(recordedAudioMs) && recordedAudioMs > 0;
    const expectedMs = hasRecordedAudioDuration ? recordedAudioMs : estimateDialogueDurationMs(cue.text, cue.deliveryPace);
    const allocatedMs = cue.endMs === undefined ? undefined : cue.endMs - cue.startMs;
    estimatedSpeechMs += expectedMs;
    cueUnits.push(units);
    cueDurations.push(allocatedMs && allocatedMs > 0 ? allocatedMs : 0);

    if (allocatedMs === undefined || !Number.isFinite(allocatedMs) || allocatedMs <= 0) {
      score -= 40;
      issues.push(`Lượt thoại ${index + 1} thiếu khoảng start/end hợp lệ.`);
      continue;
    }

    allocatedSpeechMs += allocatedMs;
    const startMs = cue.startMs;
    const timingRatio = allocatedMs / Math.max(1, expectedMs);
    if (timingRatio < 0.65) {
      score -= 25;
      issues.push(`Lượt thoại ${index + 1} được cấp ${(allocatedMs / 1000).toFixed(2)}s, ngắn hơn ${hasRecordedAudioDuration ? "audio TTS" : "thời lượng đọc ước tính"} ${(expectedMs / 1000).toFixed(2)}s.`);
    } else if (timingRatio < 0.82) {
      score -= 14;
      issues.push(`Lượt thoại ${index + 1} hơi gấp so với độ dài câu và nhịp ${cue.deliveryPace || "tự nhiên"}.`);
    } else if (timingRatio > 1.9) {
      score -= 18;
      issues.push(`Lượt thoại ${index + 1} dài hơn nhiều so với phần lời cần đọc; kiểm tra timecode hoặc nhịp diễn.`);
    } else if (timingRatio > 1.5) {
      score -= 9;
    }

    const rate = units / Math.max(0.001, allocatedMs / 1000);
    if (rate > 3.5) {
      score -= 25;
      issues.push(`Lượt thoại ${index + 1} vượt trần 3,5 đơn vị đọc/giây (${rate.toFixed(2)}).`);
    } else if (rate > 3) {
      score -= 10;
      issues.push(`Lượt thoại ${index + 1} nhanh hơn mục tiêu 3 đơn vị đọc/giây (${rate.toFixed(2)}).`);
    }

    if (startMs < 0 || (sceneDurationMs !== undefined && cue.endMs! > sceneDurationMs + 20)) {
      score -= 35;
      issues.push(`Lượt thoại ${index + 1} nằm ngoài thời lượng cảnh ${sceneDurationSec.toFixed(1)}s.`);
    }

    const previous = spoken[index - 1];
    if (previous?.endMs !== undefined) {
      const gapMs = cue.startMs - previous.endMs;
      const intentionalOverlap = cue.intentionalOverlap === true || previous.intentionalOverlap === true;
      if (gapMs < 0 && !intentionalOverlap) {
        score -= 20;
        issues.push(`Lượt thoại ${index + 1} chồng lên lượt trước mà chưa đánh dấu là ngắt lời có chủ ý.`);
      } else if (gapMs >= 0) {
        const expectedPause = previous.pauseAfterMs ?? inferredTurnPauseMs(previous.text);
        if (previous.pauseAfterMs !== undefined && gapMs + 100 < expectedPause) {
          score -= 8;
          issues.push(`Khoảng nghỉ sau lượt thoại ${index} ngắn hơn pause_after_sec đã khai báo.`);
        } else if (gapMs < 80 && expectedPause >= 250) {
          score -= 5;
          issues.push(`Thiếu khoảng nghỉ tự nhiên sau lượt thoại ${index}.`);
        }
        if (gapMs > 2_200 && previous.pauseAfterMs === undefined) {
          score -= 5;
          issues.push(`Khoảng nghỉ giữa lượt ${index} và ${index + 1} dài; cần xác nhận đó là nhịp diễn có chủ ý.`);
        }
      }
    }
  }

  const validDurations = cueDurations.filter((duration) => duration > 0);
  if (validDurations.length >= 2 && cueUnits.length >= 2) {
    const sameDuration = Math.max(...validDurations) - Math.min(...validDurations) <= 80;
    const minUnits = Math.min(...cueUnits);
    const maxUnits = Math.max(...cueUnits);
    if (sameDuration && minUnits > 0 && maxUnits - minUnits >= 4 && maxUnits / minUnits >= 1.45) {
      score -= 18;
      issues.push("Các lượt có độ dài lời khác nhau nhưng được gán gần như cùng một thời lượng; hãy chia timecode theo từng câu.");
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    status: score >= 85 ? "pass" : score >= 65 ? "warning" : "fail",
    issues: [...new Set(issues)].slice(0, 6),
    estimatedSpeechMs,
    allocatedSpeechMs,
  };
}

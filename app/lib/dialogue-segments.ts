import { normalizeEntityName } from "./entity-name";
import type { DialogueSegment, ProjectCharacter } from "./project-types";

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
      return {
        id: firstText(record, "id", "segmentId", "segment_id") || `line-${index + 1}`,
        speakerCharacterId: speakerCharacterId(record, characters),
        speakerName: firstText(record, "speakerName", "speaker_name", "speaker_character", "speakerCharacter", "speaker") || undefined,
        text,
        startMs: Math.round(startMs),
        ...(endMs >= 0 ? { endMs: Math.round(endMs) } : {}),
        ...(Object.keys(audio).length ? { audio: audio as DialogueSegment["audio"] } : {}),
        ...(translations ? { translations } : {}),
        ...(translatedAudio ? { translatedAudio } : {}),
      };
    }).filter((segment) => segment.text);
  }

  const text = firstText(scene, "dialogue_or_voiceover", "dialogueOrVoiceover", "voiceText", "voiceover", "ttsVoice", "tts_voice");
  if (!text) return [];
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

export function estimateDialogueDurationMs(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(900, Math.min(14_000, Math.round(words * 360)));
}

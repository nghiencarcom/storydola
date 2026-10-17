import type { DialogueSegment, ProjectCharacter, StoryProject } from "./project-types";
import { normalizeEntityName } from "./entity-name";

type JsonRecord = Record<string, unknown>;

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sceneSpeakerCharacter(scene: JsonRecord, characters: ProjectCharacter[]) {
  const hasExplicitId = Object.prototype.hasOwnProperty.call(scene, "speaker_character_id") || Object.prototype.hasOwnProperty.call(scene, "speakerCharacterId");
  if (hasExplicitId) {
    const explicitId = asText(scene.speaker_character_id ?? scene.speakerCharacterId);
    return characters.find((character) => character.id === explicitId);
  }
  const speaker = [scene.speaker_character, scene.speakerCharacter, scene.speaker_name, scene.speakerName, scene.speaker]
    .map(asText)
    .find(Boolean);
  if (speaker && !["narrator", "voiceover", "none", "n a"].includes(normalizeEntityName(speaker))) {
    const normalizedSpeaker = normalizeEntityName(speaker);
    const match = normalizedSpeaker ? characters.find((character) => normalizeEntityName(character.name) === normalizedSpeaker) : undefined;
    if (match) return match;
  }

  const assignedIds = scene.character_ids ?? scene.characterIds;
  if (Array.isArray(assignedIds) && assignedIds.length === 1) {
    const onlyId = String(assignedIds[0] || "").trim();
    return characters.find((character) => character.id === onlyId);
  }
  return undefined;
}

/** Resolve the selected profile and the independent video speech language for this scene. */
export function resolveProjectSceneVoice(scene: JsonRecord, project: Pick<StoryProject, "presetId" | "characters" | "voiceId" | "voiceName" | "voiceLanguage" | "language">) {
  const speaker = project.presetId === "ai-drama" ? sceneSpeakerCharacter(scene, project.characters || []) : undefined;
  const voiceId = String(speaker?.voiceId || scene.ttsVoiceId || scene.tts_voice_id || project.voiceId || "").trim();
  const voiceName = String(speaker?.voiceName || scene.ttsVoiceName || scene.tts_voice_name || project.voiceName || voiceId || "OmniVoice").trim();
  const profileLanguage = String(speaker?.voiceLanguage || scene.ttsVoiceLanguage || scene.tts_voice_language || project.voiceLanguage || project.language || "vi").trim();
  const language = String(project.language || "vi").trim();
  return { voiceId, voiceName, language, profileLanguage, speakerCharacterId: speaker?.id || "" };
}

/** Resolve each dialogue cue's voice profile while always speaking in the project's video language. */
export function resolveProjectDialogueVoice(segment: DialogueSegment, project: Pick<StoryProject, "characters" | "voiceId" | "voiceName" | "voiceLanguage" | "language">) {
  const speaker = (project.characters || []).find((character) => character.id === segment.speakerCharacterId);
  const voiceId = String(speaker?.voiceId || project.voiceId || "").trim();
  const voiceName = String(speaker?.voiceName || project.voiceName || voiceId || "OmniVoice").trim();
  const profileLanguage = String(speaker?.voiceLanguage || project.voiceLanguage || project.language || "vi").trim();
  const language = String(project.language || "vi").trim();
  return { voiceId, voiceName, language, profileLanguage, speakerCharacterId: speaker?.id || "" };
}

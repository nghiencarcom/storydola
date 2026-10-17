import { estimateDialogueDurationMs, readDialogueSegments } from "./dialogue-segments";
import { voiceLanguagePromptLabel } from "./omnivoice";
import type { DialogueSegment, ProjectCharacter } from "./project-types";
import { generateWithScriptProvider } from "./script-provider";
import { sanitizeDramaVisualPrompt } from "./visual-prompt-safety";
import { AI_DRAMA_VIDEO_PROMPT_GUIDANCE } from "./ai-drama-video-prompt-guidance";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(record: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function sceneCharacterNames(scene: JsonRecord) {
  const raw = scene.characters || scene.character_names || scene.characterNames;
  const names = Array.isArray(raw) ? raw.map((value) => {
    if (typeof value === "string") return value.trim();
    const record = asRecord(value);
    return text(record, "name", "character_name", "characterName");
  }) : [];
  const speaker = text(scene, "speaker_character", "speakerCharacter", "speaker_name", "speakerName", "speaker");
  return [...new Set([...names, speaker].filter((name) => name && !/^narrator$/i.test(name)))];
}

function readExtractionResult(value: unknown, sceneId: string, outputRaw: string) {
  let root = asRecord(value);
  if (root.parse_error && outputRaw) {
    try { root = asRecord(JSON.parse(outputRaw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim())); } catch { /* preserve the provider's parse result */ }
  }
  const rows = Array.isArray(root.scenes) ? root.scenes : [];
  const sceneResult = rows.length
    ? rows.map(asRecord).find((record) => text(record, "scene_id", "sceneId", "id") === sceneId) || {}
    : asRecord(root.scene || root);
  const segments = sceneResult.dialogue_segments || sceneResult.dialogueSegments || sceneResult.segments;
  return { sceneResult, segments };
}

export async function extractSceneDialogueAndDetails({
  scene,
  sceneId,
  characters,
  language,
}: {
  scene: JsonRecord;
  sceneId: string;
  characters: ProjectCharacter[];
  language: string;
}): Promise<{ model: string; segments: DialogueSegment[]; details: Record<string, string> }> {
  const sourceDialogue = text(scene, "dialogue_or_voiceover", "dialogueOrVoiceover", "voiceText", "voiceover", "ttsVoice", "tts_voice");
  if (!sourceDialogue) throw new Error("DIALOGUE_SOURCE_EMPTY");
  const sceneStart = Number(scene.start_sec ?? scene.startSec);
  const sceneEnd = Number(scene.end_sec ?? scene.endSec);
  const durationMs = Number.isFinite(sceneStart) && Number.isFinite(sceneEnd) && sceneEnd > sceneStart ? Math.min(15_000, Math.round((sceneEnd - sceneStart) * 1000)) : 15_000;
  const durationSec = durationMs / 1000;
  const sceneCharacters = sceneCharacterNames(scene);
  const cast = characters.map((character) => ({ name: character.name, description: character.description || "" }));
  const compactScene = {
    id: sceneId,
    purpose: text(scene, "purpose", "scene_objective", "sceneObjective"),
    beat_summary: text(scene, "beat_summary", "beatSummary", "description"),
    source_dialogue: sourceDialogue,
    speaker_hint: text(scene, "speaker_character", "speakerCharacter", "speaker_name", "speakerName", "speaker"),
    scene_characters: sceneCharacters,
    image_prompt: text(scene, "image_prompt", "imagePrompt").slice(0, 1_600),
    existing_video_prompt: text(scene, "video_prompt", "videoPrompt").slice(0, 1_600),
  };
  const prompt = `You are repairing one existing AI Drama scene for a ${durationSec}-second video. Return JSON only.

Do not change the story, add plot facts, or invent dialogue. Preserve the meaning, intent, and tone of source_dialogue. Split it into a separate cue for each actual speaker turn. If the source contains one utterance by one speaker, return exactly one cue. Use only the canonical speaker names from the Character Bible or NARRATOR when the speaker cannot be identified. Do not guess a character solely because they appear in scene_characters.

For each cue, translate or adapt the spoken line into the selected video language, ${voiceLanguagePromptLabel(language || "vi")}, if source_dialogue uses another language. Keep all dialogue_segments.text in that selected video language; do not fall back to Vietnamese unless Vietnamese is selected. Estimate natural speech timecodes for that language from the start of this scene. Cues must be chronological, must not overlap, must stay in 0–${durationSec} seconds, and should leave a short pause between turns. Keep canonical character names in the selected video language where suitable.

Write all production descriptions in English, including acting_beat, blocking, shot_size, camera_movement, eye_line_action, and video_prompt. Keep the first five notes concise. Treat image_prompt as the literal opening frame at 0 seconds and the authority for location, composition, lighting, palette, visible props, and initial blocking. Character reference images are binding identity and costume references. Base details only on the scene purpose, beat, image_prompt, and existing_video_prompt. Never select a voice.
${AI_DRAMA_VIDEO_PROMPT_GUIDANCE}
If dialogue ends before the scene duration, continue purposeful silent performance or a motivated camera move while the established ambience/foley remains natural; do not add filler dialogue or an unrelated sound cue.
Keep the visual prompt suitable for the platform and age-appropriate: use modest clothing and express tension through performance, distance, framing, and reactions. If the source implies an unsafe event, keep it off-screen and suggest it through reactions or the setting. In video_prompt, show only speaker names and cue timecodes; keep the exact spoken words in dialogue_segments and do not copy them into the visual prompt.

Return this shape:
{"scene_id":"${sceneId}","dialogue_segments":[{"speaker_character":"Canonical Character Name or NARRATOR","text":"verbatim utterance","start_sec":0.0,"end_sec":2.5}],"acting_beat":"...","blocking":"...","shot_size":"...","camera_movement":"...","eye_line_action":"...","video_prompt":"..."}

Character Bible:
${JSON.stringify(cast)}

Scene:
${JSON.stringify(compactScene)}
`;
  const generated = await generateWithScriptProvider(prompt);
  const { sceneResult, segments: rawSegments } = readExtractionResult(generated.result, sceneId, generated.raw);
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) throw new Error("DIALOGUE_EXTRACT_EMPTY");
  if (rawSegments.length > 16) throw new Error("DIALOGUE_EXTRACT_TOO_MANY");

  const parsed = readDialogueSegments({ dialogue_segments: rawSegments }, characters);
  if (!parsed.length) throw new Error("DIALOGUE_EXTRACT_EMPTY");
  const normalized: DialogueSegment[] = [];
  let cursorMs = 0;
  for (const [index, cue] of parsed.entries()) {
    const startMs = Math.max(cursorMs, cue.startMs);
    const endMs = Math.max(startMs + 300, cue.endMs ?? startMs + estimateDialogueDurationMs(cue.text));
    if (startMs >= durationMs || endMs > durationMs) throw new Error("DIALOGUE_TIMELINE_OVER_15_SECONDS");
    normalized.push({
      ...cue,
      id: `line-${index + 1}`,
      startMs,
      endMs,
      audio: undefined,
    });
    cursorMs = endMs + (index < parsed.length - 1 ? 120 : 0);
  }

  const details: Record<string, string> = {};
  for (const key of ["acting_beat", "blocking", "shot_size", "camera_movement", "eye_line_action", "video_prompt"] as const) {
    const value = text(sceneResult, key);
    if (value) details[key] = (key === "video_prompt" ? sanitizeDramaVisualPrompt(value) : value).slice(0, key === "video_prompt" ? 4_500 : 500);
  }
  return { model: generated.model, segments: normalized, details };
}

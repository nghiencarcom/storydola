export const AI_DRAMA_SCENE_DURATIONS_SEC = [5, 10, 15] as const;
export type AiDramaSceneDurationSec = (typeof AI_DRAMA_SCENE_DURATIONS_SEC)[number];

type SceneRecord = Record<string, unknown>;

function record(value: unknown): SceneRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as SceneRecord : undefined;
}

function numberValue(source: SceneRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(source[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

export function isAiDramaSceneDuration(value: unknown): value is AiDramaSceneDurationSec {
  const duration = Number(value);
  return Number.isFinite(duration) && AI_DRAMA_SCENE_DURATIONS_SEC.some((allowed) => Math.abs(allowed - duration) < 0.001);
}

/** Round a requested beat up to the next supported AI Drama duration. */
export function normalizeAiDramaSceneDuration(value: number | undefined) {
  if (!Number.isFinite(value) || !value || value <= 0) return 15 as AiDramaSceneDurationSec;
  return AI_DRAMA_SCENE_DURATIONS_SEC.find((duration) => Math.abs(duration - value) < 0.001)
    || AI_DRAMA_SCENE_DURATIONS_SEC.find((duration) => duration >= value)
    || 15;
}

function videoPromptDuration(scene: SceneRecord) {
  const prompt = typeof (scene.video_prompt ?? scene.videoPrompt) === "string" ? String(scene.video_prompt ?? scene.videoPrompt) : "";
  const ranges = [...prompt.matchAll(/(\d+(?:\.\d+)?)\s*(?:–|-|to)\s*(\d+(?:\.\d+)?)\s*(?:s|sec(?:onds?)?)\b/giu)];
  const endpoints = ranges.map((range) => Number(range[2])).filter((value) => Number.isFinite(value) && value > 0);
  return endpoints.length ? Math.max(...endpoints) : undefined;
}

function lastDialogueEnd(scene: SceneRecord) {
  const raw = scene.dialogue_segments ?? scene.dialogueSegments;
  if (!Array.isArray(raw)) return 0;
  return raw.reduce((latest, value) => {
    const cue = record(value);
    if (!cue) return latest;
    const milliseconds = Number(cue.endMs);
    const end = numberValue(cue, "end_sec", "endSec") ?? (Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds / 1000 : undefined);
    return end && end > latest ? end : latest;
  }, 0);
}

/**
 * Give every generated AI Drama scene a real, legal clip length and rebuild
 * absolute timecodes without gaps. Dialogue cues stay scene-relative.
 */
export function normalizeAiDramaSceneTimings(scenes: unknown[], timelineStartSec = 0) {
  let cursor = Number.isFinite(timelineStartSec) ? Math.max(0, timelineStartSec) : 0;
  return scenes.map((value) => {
    const scene = record(value);
    if (!scene) return value;
    const originalStart = numberValue(scene, "start_sec", "startSec") ?? 0;
    const originalEnd = numberValue(scene, "end_sec", "endSec");
    const declaredDuration = numberValue(scene, "duration_sec", "durationSec");
    const sourceDuration = originalEnd !== undefined && originalEnd > originalStart ? originalEnd - originalStart : undefined;
    const requestedDuration = declaredDuration ?? videoPromptDuration(scene) ?? sourceDuration ?? numberValue(scene, "voiceover_target_sec", "voiceoverTargetSec");
    const durationSec = normalizeAiDramaSceneDuration(Math.max(requestedDuration || 0, lastDialogueEnd(scene)));
    const startSec = Number(cursor.toFixed(3));
    cursor += durationSec;
    const endSec = Number(cursor.toFixed(3));
    return { ...scene, start_sec: startSec, end_sec: endSec, duration_sec: durationSec };
  });
}

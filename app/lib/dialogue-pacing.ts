import { isTemplateDialogueText, readDialogueSegments } from "./dialogue-segments";

/** Cue times are relative to the scene. Silence is the complement of their union. */
export function validateDialoguePacing(scene: Record<string, unknown>, duration: number) {
  const segments = readDialogueSegments(scene);
  const mode = String(scene.dialogue_mode ?? scene.dialogueMode ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["visual_led", "silent", "intentional_silence"].includes(mode)) return { errors: [] as string[], warnings: [] as string[], silenceSec: duration };
  const errors: string[] = [];
  const warnings: string[] = [];
  const intervals: Array<[number, number]> = [];
  const rawSegments = Array.isArray(scene.dialogueSegments) ? scene.dialogueSegments : Array.isArray(scene.dialogue_segments) ? scene.dialogue_segments : undefined;
  const missingStartCueIds = new Set<string>();
  rawSegments?.forEach((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const cue = value as Record<string, unknown>;
    const text = [cue.text, cue.dialogue, cue.line, cue.dialogue_or_voiceover, cue.voiceover]
      .find((item) => typeof item === "string" && item.trim()) as string | undefined;
    if (!text || isTemplateDialogueText(text)) return;
    const rawStart = cue.startMs ?? cue.start_ms ?? cue.start_sec ?? cue.startSec;
    const start = Number(rawStart);
    if (rawStart === undefined || rawStart === null || rawStart === "" || !Number.isFinite(start) || start < 0) {
      const providedId = [cue.id, cue.segmentId, cue.segment_id].find((item) => typeof item === "string" && item.trim()) as string | undefined;
      const id = providedId?.trim() || `line-${index + 1}`;
      missingStartCueIds.add(id);
      warnings.push(`cue ${index + 1}: thiếu start time hợp lệ; cue không được tính là thời lượng có thoại`);
    }
  });
  let previousCueStart = Number.NEGATIVE_INFINITY;
  for (const [index, cue] of segments.entries()) {
    if (missingStartCueIds.has(cue.id)) continue;
    const start = cue.startMs / 1000;
    const end = cue.endMs === undefined ? NaN : cue.endMs / 1000;
    if (Number.isFinite(start) && start >= 0) {
      if (start < previousCueStart - 0.001) warnings.push("cue thoại không theo thứ tự thời gian; kiểm tra lại thứ tự lượt nói");
      previousCueStart = start;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration + 0.001) {
      warnings.push(`cue ${index + 1}: cần start/end hợp lệ trong 0–${duration}s`);
      continue;
    }
    intervals.push([start, end]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let previousEnd = 0;
  let longestGap = 0;
  for (const [start, end] of intervals) {
    if (start < previousEnd - 0.001) warnings.push("cue thoại chồng lấn; kiểm tra lại thời điểm diễn");
    longestGap = Math.max(longestGap, start - previousEnd);
    covered += Math.max(0, end - Math.max(start, previousEnd));
    previousEnd = Math.max(previousEnd, end);
  }
  longestGap = Math.max(longestGap, duration - previousEnd);
  if (longestGap > 3.001) errors.push(`khoảng nghỉ liên tục ${longestGap.toFixed(2)}s vượt 3s`);
  const silenceSec = Math.max(0, duration - covered);
  const maxSilenceSec = Math.abs(duration - 10) < 0.001 ? 4 : Math.abs(duration - 15) < 0.001 ? 5 : undefined;
  if (maxSilenceSec !== undefined && silenceSec > maxSilenceSec + 0.001) errors.push(`tổng nghỉ ${silenceSec.toFixed(2)}s vượt ${maxSilenceSec}s cho cảnh ${duration}s`);
  if (!segments.length) warnings.push("cảnh dialogue_led cần ít nhất một cue thoại có timecode");
  return { errors, warnings, silenceSec, leadingSilenceSec: intervals[0]?.[0] ?? duration, trailingSilenceSec: Math.max(0, duration - previousEnd) };
}

/** Only adjacent dialogue-led scenes participate; visual/silent scenes break the chain. */
export function validateDialogueBoundary(previous: Record<string, unknown>, current: Record<string, unknown>) {
  const isDialogueLed = (scene: Record<string, unknown>) => {
    const mode = String(scene.dialogue_mode ?? scene.dialogueMode ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (mode) return mode === "dialogue_led";
    return new Set(readDialogueSegments(scene).map(cue => cue.speakerName || cue.speakerCharacterId).filter(Boolean)).size >= 2;
  };
  if (!isDialogueLed(previous) || !isDialogueLed(current)) return [] as string[];
  const start = (scene: Record<string, unknown>) => Number(scene.start_sec ?? scene.startSec);
  const end = (scene: Record<string, unknown>) => Number(scene.end_sec ?? scene.endSec);
  const before = validateDialoguePacing(previous, end(previous) - start(previous));
  const after = validateDialoguePacing(current, end(current) - start(current));
  const timelineGap = Math.max(0, start(current) - end(previous));
  const gap = (before.trailingSilenceSec ?? 0) + timelineGap + (after.leadingSilenceSec ?? 0);
  return gap > 3.001 ? [`khoảng nghỉ nối cảnh ${gap.toFixed(2)}s vượt 3s (đuôi ${(before.trailingSilenceSec ?? 0).toFixed(2)}s + giữa cảnh ${timelineGap.toFixed(2)}s + đầu ${(after.leadingSilenceSec ?? 0).toFixed(2)}s)`] : [];
}

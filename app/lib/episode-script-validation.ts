import { isAiDramaSceneDuration } from "./ai-drama-scene-timing";
import { validateDialogueBoundary, validateDialoguePacing } from "./dialogue-pacing";

type JsonRecord = Record<string, unknown>;
export type ImportEpisode = { chunkId: string; sceneStart: number; sceneEnd: number; scenes: JsonRecord[]; payload: JsonRecord; warnings: string[] };
const REQUIRED_TEXT_FIELDS = ["act", "purpose", "beat_summary", "dialogue_or_voiceover", "image_keyword", "video_keyword", "image_prompt", "video_prompt", "continuity_in", "continuity_out", "source_basis"];

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function normalizedSceneId(scene: JsonRecord) {
  const candidates = [scene.id, scene.scene_id, scene.sceneId, scene.scene_number, scene.sceneNumber]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
  for (const candidate of candidates) {
    const value = String(candidate).trim().toUpperCase();
    const match = value.match(/^(?:A\d{2,}[-_:])?S\s*(\d+)$/)
      || value.match(/^SCENE[\s_-]*(\d+)$/)
      || value.match(/^(\d+)$/);
    if (!match) continue;
    const number = Number(match[1]);
    if (Number.isSafeInteger(number) && number > 0) return { number, id: `S${String(number).padStart(3, "0")}` };
  }
  return undefined;
}

export function validateEpisode(value: unknown, requireDiscreteDramaDurations = false): { episode?: ImportEpisode; message?: string } {
  const payload = asRecord(value);
  if (!payload || payload.schema !== "scene-script.v1") return { message: "Mỗi phần tử episodes phải có schema scene-script.v1." };
  const chunkId = String(payload.chunk_id || "").trim().toUpperCase();
  if (!/^A\d{2,}$/.test(chunkId)) return { message: `chunk_id không hợp lệ: ${chunkId || "trống"}. Dùng dạng A01, A02…` };
  if (typeof payload.chunk_summary !== "string" || !payload.chunk_summary.trim()) return { message: `${chunkId}: thiếu chunk_summary.` };
  if (!asRecord(payload.continuity_state)) return { message: `${chunkId}: continuity_state phải là object đầy đủ.` };
  if (!Array.isArray(payload.scenes) || payload.scenes.length === 0) return { message: `${chunkId}: scenes phải là mảng có ít nhất một cảnh.` };

  const scenes: JsonRecord[] = [];
  const numbers: number[] = [];
  const warnings: string[] = [];
  for (let index = 0; index < payload.scenes.length; index += 1) {
    const scene = asRecord(payload.scenes[index]);
    if (!scene) return { message: `${chunkId}: cảnh thứ ${index + 1} không phải object.` };
    const normalizedId = normalizedSceneId(scene);
    if (!normalizedId) {
      const suppliedId = [scene.id, scene.scene_id, scene.sceneId, scene.scene_number, scene.sceneNumber]
        .find((value) => value !== undefined && value !== null && String(value).trim() !== "");
      const detail = suppliedId === undefined ? "" : ` (đã nhận ${JSON.stringify(String(suppliedId).trim())})`;
      return { message: `${chunkId}: cảnh ${index + 1} cần ID hợp lệ trong trường id hoặc scene_id, ví dụ S001${detail}. Có thể dùng S001, A01-S001, Scene 1 hoặc số 1.` };
    }
    const id = normalizedId.id;
    const sceneNumber = normalizedId.number;
    numbers.push(sceneNumber);
    if (typeof scene.start_sec !== "number" || !Number.isFinite(scene.start_sec) || scene.start_sec < 0) return { message: `${id}: start_sec phải là số không âm.` };
    if (typeof scene.end_sec !== "number" || !Number.isFinite(scene.end_sec) || scene.end_sec <= scene.start_sec) return { message: `${id}: end_sec phải lớn hơn start_sec.` };
    const sceneDuration = scene.end_sec - scene.start_sec;
    if (sceneDuration > 15.01) return { message: `${id}: thời lượng cảnh vượt quá 15 giây.` };
    if (requireDiscreteDramaDurations && !isAiDramaSceneDuration(sceneDuration)) return { message: `${id}: Phim AI chỉ nhận thời lượng cảnh 5, 10 hoặc 15 giây.` };
    const dialogueMode = String(scene.dialogue_mode ?? scene.dialogueMode ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const dialogueSegments = Array.isArray(scene.dialogue_segments) ? scene.dialogue_segments : Array.isArray(scene.dialogueSegments) ? scene.dialogueSegments : [];
    const dialogueSpeakers = new Set(dialogueSegments.map((item) => {
      const segment = asRecord(item);
      return String(segment?.speaker_character ?? segment?.speakerCharacter ?? segment?.speaker_character_id ?? segment?.speakerCharacterId ?? segment?.speaker ?? segment?.speakerName ?? segment?.speaker_name ?? "").trim();
    }).filter(Boolean));
    const isDialogueLed = dialogueMode === "dialogue_led" || (!dialogueMode && dialogueSpeakers.size >= 2);
    if (requireDiscreteDramaDurations && isDialogueLed) {
      const pacing = validateDialoguePacing(scene, sceneDuration);
      if (pacing.errors.length) return { message: `${chunkId}/${id}: ${pacing.errors.join("; ")}. visual_led/im lặng có chủ đích được miễn.` };
      warnings.push(...pacing.warnings.map(issue => `${chunkId}/${id}: ${issue}`));
    }
    const declaredDuration = scene.duration_sec ?? scene.durationSec;
    if (requireDiscreteDramaDurations && declaredDuration !== undefined
      && (!isAiDramaSceneDuration(declaredDuration) || Math.abs(Number(declaredDuration) - sceneDuration) >= 0.001)) {
      return { message: `${id}: duration_sec phải khớp timecode và chỉ nhận 5, 10 hoặc 15 giây.` };
    }
    if (typeof scene.voiceover_target_sec !== "number" || !Number.isFinite(scene.voiceover_target_sec) || scene.voiceover_target_sec < 0) return { message: `${id}: voiceover_target_sec phải là số không âm.` };
    for (const key of REQUIRED_TEXT_FIELDS) {
      if (typeof scene[key] !== "string") return { message: `${id}: thiếu trường văn bản ${key}.` };
    }
    if (scene.media_type !== "image" && scene.media_type !== "video") return { message: `${id}: media_type chỉ nhận image hoặc video.` };
    if (!Array.isArray(scene.risk_flags) || scene.risk_flags.some((flag) => typeof flag !== "string")) return { message: `${id}: risk_flags phải là mảng chuỗi.` };
    scenes.push({ ...scene, id });
  }

  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index] !== numbers[index - 1] + 1) return { message: `${chunkId}: scene ID phải liên tục; có khoảng trống hoặc ID trùng.` };
    const previous = scenes[index - 1];
    const current = scenes[index];
    if (requireDiscreteDramaDurations) {
      const boundaryErrors = validateDialogueBoundary(previous, current);
      if (boundaryErrors.length) return { message: `${chunkId}/${previous.id} → ${current.id}: ${boundaryErrors.join("; ")}` };
    }
    if (Number(current.start_sec) < Number(previous.end_sec)) return { message: `${chunkId}: timecode bị chồng lấn tại ${String(current.id)}.` };
  }

  return { episode: {
    chunkId,
    warnings,
    sceneStart: numbers[0],
    sceneEnd: numbers[numbers.length - 1],
    scenes,
    payload: { ...payload, chunk_id: chunkId, scenes },
  } };
}

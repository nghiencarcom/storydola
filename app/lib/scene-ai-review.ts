import { generateWithScriptProvider } from "./script-provider";
import { countScriptWords } from "./script-utils";
import { dialogueSegmentsText, readDialogueSegments, scoreDialogueTiming } from "./dialogue-segments";
import type { ProjectChunk, SceneAiCheckStatus, SceneAiReview, StoryProject } from "./project-types";
import { contentGenresLabel, storySettingLabel } from "./content-genres";

type SceneRecord = Record<string, unknown>;

type ModelReview = {
  status: "passed" | "needs_changes";
  score: number;
  summary: string;
  issues: string[];
  checks: Record<string, SceneAiCheckStatus>;
  dialogueTimingScore?: number;
};

export type ChunkAiReviewSummary = {
  requested: number;
  passed: number;
  needsChanges: number;
  errors: number;
  model?: string;
  error?: string;
};

function asRecord(value: unknown): SceneRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as SceneRecord : null;
}

function textValue(record: SceneRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function numberValue(record: SceneRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function sceneId(scene: SceneRecord, fallback: string) {
  return textValue(scene, "id", "scene_id") || fallback;
}

function wordCount(value: string) {
  return countScriptWords(value);
}

function dialogueInfo(scene: SceneRecord) {
  const segments = readDialogueSegments(scene);
  const voice = dialogueSegmentsText(segments) || textValue(scene, "dialogue_or_voiceover", "voiceText", "voiceover");
  const mode = textValue(scene, "dialogue_mode", "dialogueMode").toLowerCase().replace(/[\s-]+/g, "_");
  const speakers = new Set(segments.map((segment) => String(segment.speakerName || segment.speakerCharacterId || "").trim()).filter(Boolean));
  return { voice, mode, dialogueLed: mode === "dialogue_led" || (!mode && speakers.size >= 2), words: wordCount(voice), segments };
}

function clampScore(value: unknown, fallback = 0) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : fallback;
}

function normalizeCheck(value: unknown): SceneAiCheckStatus | undefined {
  const normalized = String(value || "").trim().toLowerCase();
  if (["pass", "passed", "ok", "good", "đạt"].includes(normalized)) return "pass";
  if (["warning", "warn", "caution", "cảnh báo"].includes(normalized)) return "warning";
  if (["fail", "failed", "error", "needs_changes", "needs change", "cần sửa"].includes(normalized)) return "fail";
  return undefined;
}

function normalizeModelStatus(value: unknown): "passed" | "needs_changes" | undefined {
  const normalized = String(value || "").trim().toLowerCase();
  if (["pass", "passed", "ok", "approved", "đạt"].includes(normalized)) return "passed";
  if (["needs_changes", "needs change", "fail", "failed", "warning", "cần sửa", "sửa"].includes(normalized)) return "needs_changes";
  return undefined;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 8);
}

function structuralReview(scene: SceneRecord, index: number, chunk: ProjectChunk, aiDrama: boolean) {
  const fallbackId = `S${String(chunk.sceneStart + index).padStart(3, "0")}`;
  const id = sceneId(scene, fallbackId);
  const checks: Record<string, SceneAiCheckStatus> = {};
  const issues: string[] = [];
  const dialogue = dialogueInfo(scene);
  const voice = dialogue.voice;
  const targetDurationValue = numberValue(scene, "voiceover_target_sec", "voiceoverTargetSec");
  const silentHold = !voice && targetDurationValue === 0;

  const requiredFields: Array<[string, string[]]> = [
    ["narrative", ["purpose", "beat_summary"]],
    ["voiceover", ["dialogue_or_voiceover", "voiceText", "voiceover"]],
    ["prompt", aiDrama ? ["video_prompt", "videoPrompt"] : ["video_prompt", "videoPrompt", "image_prompt", "imagePrompt"]],
  ];
  for (const [check, keys] of requiredFields) {
    if (check === "voiceover" && silentHold) {
      checks[check] = "pass";
      continue;
    }
    if ((check === "voiceover" ? voice : textValue(scene, ...keys))) checks[check] = "pass";
    else {
      checks[check] = "fail";
      issues.push(`${id}: thiếu ${check === "narrative" ? "mô tả beat/purpose" : check === "prompt" && aiDrama ? "prompt video" : check}.`);
    }
  }

  if (aiDrama && checks.prompt === "pass") {
    const prompt = textValue(scene, "video_prompt", "videoPrompt");
    const ranges = [...prompt.matchAll(/(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*(?:s|sec)?\s*:/gi)]
      .map((match) => ({ start: Number(match[1]), end: Number(match[2]) }))
      .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start);
    const overlongRange = ranges.find((range) => range.end - range.start > 3.01);
    const startSec = numberValue(scene, "start_sec", "startSec");
    const endSec = numberValue(scene, "end_sec", "endSec");
    const expectedDuration = numberValue(scene, "duration_sec", "durationSec")
      ?? (startSec !== undefined && endSec !== undefined && endSec > startSec ? endSec - startSec : 15);
    const hasTimecodeDiscontinuity = ranges.some((range, rangeIndex) => rangeIndex > 0 && Math.abs(range.start - ranges[rangeIndex - 1].end) > 0.05);
    const coversScene = ranges.length > 0 && Math.abs(ranges[0].start) <= 0.05 && Math.abs(ranges.at(-1)!.end - expectedDuration) <= 0.05;
    const holdsOpeningFrame = /\b(?:hold|preserve|keep)\b[^.!?]{0,180}\b0\.5\s*(?:s|sec(?:ond)?s?)\b/i.test(prompt);
    if (!ranges.length) {
      checks.camera = "fail";
      checks.prompt = "fail";
      issues.push(`${id}: prompt video chưa chia nhịp camera có timecode; cần góc/khung hình hoặc chuyển động camera mới không muộn hơn mỗi 3 giây.`);
    } else if (overlongRange) {
      checks.camera = "fail";
      checks.prompt = "fail";
      issues.push(`${id}: nhịp camera ${overlongRange.start.toFixed(1)}–${overlongRange.end.toFixed(1)}s kéo dài quá 3 giây; cần thêm thay đổi góc/khung hình hoặc reframe có chủ đích.`);
    } else if (hasTimecodeDiscontinuity || !coversScene) {
      checks.camera = "fail";
      checks.prompt = "fail";
      issues.push(`${id}: nhịp camera chưa phủ liên tục từ 0 đến ${expectedDuration}s; cần đủ timecode, không khoảng trống/chồng lấn và không để đuôi cảnh thiếu chỉ dẫn.`);
    } else if (!holdsOpeningFrame) {
      checks.camera = "fail";
      checks.prompt = "fail";
      issues.push(`${id}: prompt video phải giữ nguyên khung mở đầu 0.5 giây trước khi reframe hoặc di chuyển camera.`);
    } else checks.camera = "pass";
  }

  const continuityIn = textValue(scene, "continuity_in", "continuityIn");
  const continuityOut = textValue(scene, "continuity_out", "continuityOut");
  if (continuityIn && continuityOut) checks.continuity = "pass";
  else {
    checks.continuity = "fail";
    issues.push(`${id}: thiếu continuity_in hoặc continuity_out.`);
  }

  const start = numberValue(scene, "start_sec", "startSec");
  const end = numberValue(scene, "end_sec", "endSec");
  const duration = start !== undefined && end !== undefined ? end - start : undefined;
  const targetDuration = targetDurationValue;
  if (duration === undefined || duration <= 0) {
    checks.timing = "fail";
    issues.push(`${id}: timecode start/end không hợp lệ.`);
  } else if (duration > 15) {
    checks.timing = "fail";
    issues.push(`${id}: thời lượng ${duration.toFixed(1)}s vượt giới hạn 15s.`);
  } else {
    checks.timing = "pass";
  }
  const words = dialogue.words;
  const dialogueTiming = aiDrama ? scoreDialogueTiming(dialogue.segments, duration || 0) : undefined;
  if (dialogueTiming) {
    checks.dialogue_timing = dialogueTiming.status;
    issues.push(...dialogueTiming.issues.map((issue) => `${id}: ${issue}`));
  }
  if (targetDuration !== undefined && ((targetDuration <= 0 && !silentHold) || targetDuration > 15)) {
    checks.voiceover = "fail";
    issues.push(`${id}: voiceover_target_sec phải nằm trong 1–15s.`);
  }

  const maximumWordsForScene = Math.max(1, Math.floor((duration || 0) * 3));
  if (aiDrama && voice && words > maximumWordsForScene) {
    checks.voiceover = "fail";
    issues.push(`${id}: tổng lời thoại ${words} đơn vị đọc vượt khả năng tối đa khoảng ${maximumWordsForScene} đơn vị trong ${duration?.toFixed(1) || "?"}s ở nhịp 3 đơn vị/giây.`);
  } else if (aiDrama && voice && words > maximumWordsForScene * 0.85 && checks.voiceover !== "fail") {
    checks.voiceover = "warning";
    issues.push(`${id}: tổng lời thoại gần chạm giới hạn nhịp đọc của cảnh; cần nghe lại audio sau khi render.`);
  }

  const media = asRecord(scene.media);
  if (!media || String(media.status || "") !== "ready" || media.stale === true) {
    checks.media = "fail";
    issues.push(`${id}: media ${media?.stale === true ? "đã stale" : "chưa sẵn sàng"}${media?.error ? ` (${String(media.error).slice(0, 120)})` : ""}.`);
  } else {
    checks.media = "pass";
    const requestedType = textValue(scene, "media_type", "mediaType").toLowerCase();
    const actualType = String(media.kind || "").toLowerCase();
    if (aiDrama && actualType !== "video") {
      checks.media = "fail";
      issues.push(`${id}: AI Drama cần media video nhưng hiện tại là ${actualType || "chưa xác định"}.`);
    } else if (requestedType && actualType && requestedType !== actualType) {
      checks.media = "warning";
      issues.push(`${id}: scene yêu cầu ${requestedType} nhưng media hiện tại là ${actualType}; cần người dùng xác nhận.`);
    }
  }

  const failCount = Object.values(checks).filter((value) => value === "fail").length;
  const warningCount = Object.values(checks).filter((value) => value === "warning").length;
  const score = Math.max(0, 100 - failCount * 20 - warningCount * 7);
  return { id, checks, issues: uniqueStrings(issues), score, dialogueTimingScore: dialogueTiming?.score };
}

function reviewInput(scene: SceneRecord, index: number, chunk: ProjectChunk) {
  const media = asRecord(scene.media);
  const dialogue = dialogueInfo(scene);
  const fallbackId = `S${String(chunk.sceneStart + index).padStart(3, "0")}`;
  return {
    id: sceneId(scene, fallbackId),
    start_sec: numberValue(scene, "start_sec", "startSec"),
    end_sec: numberValue(scene, "end_sec", "endSec"),
    duration_sec: numberValue(scene, "duration_sec", "durationSec"),
    voiceover_target_sec: numberValue(scene, "voiceover_target_sec", "voiceoverTargetSec"),
    media_type: textValue(scene, "media_type", "mediaType"),
    purpose: textValue(scene, "purpose"),
    beat_summary: textValue(scene, "beat_summary", "beatSummary"),
    dialogue_mode: dialogue.mode || undefined,
    dialogue_word_count: dialogue.words,
    dialogue_or_voiceover: dialogue.voice,
    dialogue_segments: dialogue.segments.map((segment) => ({
      speaker_character: segment.speakerName || segment.speakerCharacterId || "NARRATOR",
      text: segment.text,
      start_sec: Number((segment.startMs / 1000).toFixed(3)),
      ...(segment.endMs !== undefined ? { end_sec: Number((segment.endMs / 1000).toFixed(3)) } : {}),
      ...(segment.deliveryPace ? { delivery_pace: segment.deliveryPace } : {}),
      ...(segment.pauseAfterMs !== undefined ? { pause_after_sec: Number((segment.pauseAfterMs / 1000).toFixed(3)) } : {}),
      ...(segment.intentionalOverlap ? { intentional_overlap: true } : {}),
    })),
    continuity_in: textValue(scene, "continuity_in", "continuityIn"),
    continuity_out: textValue(scene, "continuity_out", "continuityOut"),
    image_keyword: textValue(scene, "image_keyword", "imageKeyword"),
    video_keyword: textValue(scene, "video_keyword", "videoKeyword"),
    image_prompt: textValue(scene, "image_prompt", "imagePrompt").slice(0, 700),
    video_prompt: textValue(scene, "video_prompt", "videoPrompt").slice(0, 2_200),
    media: media ? {
      kind: String(media.kind || ""),
      provider: String(media.provider || ""),
      status: String(media.status || ""),
      stale: media.stale === true,
      query: String(media.query || "").slice(0, 180),
      error: String(media.error || "").slice(0, 180),
    } : null,
  };
}

function buildReviewPrompt(project: StoryProject, chunk: ProjectChunk, scenes: SceneRecord[]) {
  const safeScenes = scenes.map((scene, index) => reviewInput(scene, index, chunk));
  const openingSceneId = `S${String(chunk.sceneStart).padStart(3, "0")}`;
  return `Bạn là AI pre-check cho pipeline StoryAI. Hãy kiểm tra các cảnh dưới đây trước khi người dùng xem.

Mục tiêu: phát hiện lỗi có thể sửa được trong kịch bản và metadata sản xuất: timecode, nhịp camera, voice-over có vừa thời lượng cảnh không, beat/narrative có rõ không, continuity_in/out có nhất quán trong chunk không, prompt có đủ cụ thể không, keyword có dùng được cho stock/AI không, và media đã sẵn sàng chưa. Với AI Drama, mỗi duration_sec phải đúng 5, 10 hoặc 15 giây, timecode phải khớp duration_sec, không có khoảng đuôi rỗng bị kéo dài, video_prompt và media video là bắt buộc; không dùng image_prompt để thay thế video_prompt.

TIÊU CHÍ CHẤT LƯỢNG KỂ CHUYỆN:
- narrative: beat có mục tiêu/xung đột/thay đổi/hậu quả rõ không; cảnh kế tiếp có phát triển hoặc trả lời cảnh trước bằng quan hệ nhân quả không; có lặp beat, recap, twist vô cớ, hay hành động không được chuẩn bị không. Cảnh nên thay đổi ít nhất một yếu tố: mục tiêu, thông tin, quan hệ, rủi ro hoặc quyền chủ động.
- Hook 5 giây: với cảnh mở tập ${openingSceneId}, kiểm tra phần 0–5s đầu trong video_prompt và lời thoại đầu tiên (nếu có). Phải mở thẳng bằng hành động/hình ảnh/câu hỏi/manh mối/xung đột/cứu giúp/hài hước phù hợp, để khán giả lập tức tự hỏi ai/vì sao/điều gì xảy ra tiếp/theo nhân vật có thành công không; khi phù hợp, cho khán giả lý do để đoán diễn biến hoặc chọn phe. Hook phải gắn với nội dung thật, không intro, recap hay teaser chung chung. Nếu thiếu hook hoặc 5 giây đầu chỉ giải thích chậm, đánh dấu narrative fail và needs_changes. Chọn một cách mở phù hợp, không ép đủ mọi kiểu và không ép hài vào cảnh nghiêm túc.
- continuity: đối chiếu continuity_in/out của các cảnh liền nhau; trạng thái hành động, thời gian/địa điểm, đồ vật, kiến thức và cảm xúc phải tiếp nối hoặc có transition hợp lý. Đánh dấu lỗi khi có mâu thuẫn/hard reset rõ ràng, không chỉ vì cách chuyển cảnh mang tính lựa chọn phong cách.
- voiceover/dialogue_timing: với AI Drama, lời thoại phải tự nhiên, đúng ngôn ngữ, có ý đồ/subtext và làm thay đổi nhịp trao đổi; tránh giải thích hình ảnh, nhắc lại thông tin hoặc câu sáo rỗng. dialogue_segments phải chia đúng một cue cho mỗi lượt người nói thực tế, theo thứ tự; không gộp người nói khác nhau. Đánh giá từng cue theo text, delivery_pace, dấu câu, start_sec/end_sec, pause_after_sec và duration_sec. Câu dài cần cửa sổ đọc dài hơn câu ngắn; đừng mặc định mọi cue có cùng thời lượng. Kiểm tra khoảng nghỉ có lý do, cue nằm trong cảnh, tốc độ không vượt 3 đơn vị đọc/giây (3,5 là trần cảnh báo nghiêm trọng), và video_prompt có khớp tên người nói/thời điểm hay không. Chỉ chấm điểm phần không có audio là ước lượng văn bản; không khẳng định chất lượng phát âm. Nếu câu khác độ dài rõ nhưng có cửa sổ gần bằng nhau, hoặc một lượt người nói bị gộp vào cue của người khác, giảm dialogue_timing_score và nêu cue cụ thể. Không ép số từ tối thiểu hoặc thêm thoại để lấp thời gian; visual_led/im lặng có chủ đích được miễn. Chỉ yêu cầu sửa khi có lỗi rõ; dùng warning cho nhận xét chủ quan.
- camera: với AI Drama, yêu cầu khung mở đầu được giữ nguyên 0.5 giây, sau đó có thay đổi góc/khung hình hoặc reframe nhìn thấy được không muộn hơn mỗi 3.0 giây và phủ hết duration_sec. Ưu tiên lưới timecode cố định: 5 giây = 0–2.5, 2.5–5; 10 giây = 0–2.5, 2.5–5, 5–7.5, 7.5–10; 15 giây = 0–3, 3–6, 6–9, 9–12, 12–15. Ưu tiên combo phù hợp: hội thoại (wide establishing → OTS → reverse OTS → MCU → close-up slow push-in), drama/cảm xúc (medium → slow push-in → close-up → rack focus → reaction), đi bộ (medium-wide → tracking → leading → MCU), reveal (OTS/medium → pan → rack focus → push-in), action (wide → tracking → low angle → controlled handheld → close-up reaction), hero reveal (low-angle medium-wide → dolly-in → slight arc → close-up). Dùng như ngôn ngữ quay ưu tiên, không checklist; cắt cảnh không bắt buộc nếu continuous move/reframe đủ nhìn thấy. Chuyển động phải hợp thể loại, cảm xúc và hành động, giữ trục nhìn, không gian và continuity. Mọi đoạn dài hơn 3 giây, thiếu mốc camera, hoặc không giữ khung đầu 0.5 giây đều là lỗi cần sửa.
- Chỉ dùng fail/needs_changes cho lỗi nghiêm trọng, mâu thuẫn hoặc lặp lại có bằng chứng trong dữ liệu; không phạt kịch bản chỉ vì khác sở thích thể loại. Không tự bịa chi tiết nguồn để đánh giá.

Giới hạn quan trọng: bạn chỉ được đánh giá dữ liệu văn bản và metadata được cung cấp. Bạn không được khẳng định chất lượng hình ảnh thực tế, chuyển động, phát âm hay độ khớp pixel nếu không có dữ liệu âm thanh/hình ảnh để xem. Những điểm đó phải ghi là cần người dùng kiểm tra.

Trả về JSON duy nhất theo cấu trúc:
{
  "reviews": [
    {
      "id": "S001",
      "status": "passed" hoặc "needs_changes",
      "score": 0-100,
      "summary": "một câu ngắn",
      "issues": ["..."],
      "dialogue_timing_score": 0-100 or null when the scene is silent,
      "checks": {"timing":"pass|warning|fail","voiceover":"pass|warning|fail","dialogue_timing":"pass|warning|fail","narrative":"pass|warning|fail","continuity":"pass|warning|fail","prompt":"pass|warning|fail","camera":"pass|warning|fail","media":"pass|warning|fail"}
    }
  ]
}

Quy tắc: phải trả đủ đúng một review cho mỗi id; không tự thêm cảnh; nếu có một lỗi nghiêm trọng thì status là needs_changes. Viết summary/issues bằng tiếng Việt.

PROJECT:
- title: ${project.title}
- language: ${project.language}
- chunk: ${chunk.id} · S${String(chunk.sceneStart).padStart(3, "0")}–S${String(chunk.sceneEnd).padStart(3, "0")}
- episode_opening_scene: ${openingSceneId} (hook bắt buộc trong 0–5s đầu)
- story_genres: ${contentGenresLabel(project.contentGenre, project.secondaryGenres)}
- story_setting: ${storySettingLabel(project.storySetting)}${project.settingNotes ? ` · ${project.settingNotes}` : ""}
- image_style (rendering medium and material treatment): ${project.imageStyle}
- aspect_ratio: ${project.aspectRatio}

SCENES:
${JSON.stringify(safeScenes, null, 2)}
`;
}

function parseModelReviews(value: unknown) {
  const root = asRecord(value);
  const list = root && Array.isArray(root.reviews) ? root.reviews : root && Array.isArray(root.scenes) ? root.scenes : [];
  const reviews = new Map<string, ModelReview>();
  for (const item of list) {
    const record = asRecord(item);
    if (!record) continue;
    const id = textValue(record, "id", "scene_id");
    const status = normalizeModelStatus(record.status || record.result || record.recommendation);
    if (!id || !status) continue;
    const rawChecks = asRecord(record.checks);
    const checks: Record<string, SceneAiCheckStatus> = {};
    if (rawChecks) {
      for (const [key, check] of Object.entries(rawChecks)) {
        const normalized = normalizeCheck(check);
        if (normalized) checks[key] = normalized;
      }
    }
    const rawIssues = Array.isArray(record.issues) ? record.issues.map((issue) => String(issue)) : [];
    reviews.set(id, {
      status,
      score: clampScore(record.score, status === "passed" ? 90 : 55),
      summary: textValue(record, "summary", "reason") || (status === "passed" ? "AI pre-check không phát hiện lỗi nghiêm trọng." : "AI phát hiện điểm cần người dùng kiểm tra."),
      issues: uniqueStrings(rawIssues),
      checks,
      ...(record.dialogue_timing_score !== undefined && record.dialogue_timing_score !== null ? { dialogueTimingScore: clampScore(record.dialogue_timing_score) } : {}),
    });
  }
  return reviews;
}

function combineReview(structural: ReturnType<typeof structuralReview>, modelReview: ModelReview | undefined, model: string, modelError: string, scene: SceneRecord): SceneRecord {
  const checks = { ...structural.checks, ...(modelReview?.checks || {}) };
  if (structural.checks.dialogue_timing) checks.dialogue_timing = structural.checks.dialogue_timing;
  for (const [key, value] of Object.entries(structural.checks)) {
    if (value === "fail") checks[key] = "fail";
  }
  const structuralHasFailure = Object.values(structural.checks).some((value) => value === "fail");
  const status: SceneAiReview["status"] = modelError
    ? "error"
    : structuralHasFailure || modelReview?.status === "needs_changes"
      ? "needs_changes"
      : modelReview
        ? "passed"
        : "passed";
  const issues = uniqueStrings([
    ...structural.issues,
    ...(modelReview?.issues || []),
    ...(modelError ? [`AI pre-check chưa hoàn tất: ${modelError}`] : []),
  ]);
  const score = modelReview ? Math.min(structural.score, modelReview.score) : structural.score;
  const review: SceneAiReview = {
    status,
    score,
    dialogueTimingScore: structural.dialogueTimingScore ?? modelReview?.dialogueTimingScore,
    summary: modelReview?.summary || (modelError ? "Chưa có kết quả AI; cần chạy lại pre-check." : "AI pre-check đã kiểm tra cấu trúc cảnh."),
    issues,
    checks,
    model: model || undefined,
    createdAt: new Date().toISOString(),
    error: modelError || undefined,
  };
  return { ...scene, ai_review: review };
}

export async function evaluateChunkScenes({
  project,
  chunk,
  scenes,
  useModel = true,
}: {
  project: StoryProject;
  chunk: ProjectChunk;
  scenes: unknown[];
  useModel?: boolean;
}) {
  const normalizedScenes = scenes.map((value, index) => {
    const record = asRecord(value) || {};
    const fallbackId = `S${String(chunk.sceneStart + index).padStart(3, "0")}`;
    return { ...record, id: sceneId(record, fallbackId) };
  });
  let model = "";
  let modelError = "";
  let modelReviews = new Map<string, ModelReview>();
  if (useModel) {
    try {
      const generated = await generateWithScriptProvider(buildReviewPrompt(project, chunk, normalizedScenes));
      model = generated.model;
      modelReviews = parseModelReviews(generated.result);
      if (!modelReviews.size) modelError = "Model không trả về review hợp lệ cho các cảnh.";
    } catch (cause) {
      modelError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  const evaluatedScenes = normalizedScenes.map((scene, index) => {
    const structural = structuralReview(scene, index, chunk, project.presetId === "ai-drama");
    const id = sceneId(scene, `S${String(chunk.sceneStart + index).padStart(3, "0")}`);
    return combineReview(structural, modelReviews.get(id), model, modelError, scene);
  });
  const reviews = evaluatedScenes.map((scene) => asRecord(scene.ai_review)).filter(Boolean) as SceneRecord[];
  const summary: ChunkAiReviewSummary = {
    requested: evaluatedScenes.length,
    passed: reviews.filter((review) => review.status === "passed").length,
    needsChanges: reviews.filter((review) => review.status === "needs_changes").length,
    errors: reviews.filter((review) => review.status === "error").length,
    model: model || undefined,
    error: modelError || undefined,
  };
  return { scenes: evaluatedScenes, summary, model, error: modelError || undefined };
}

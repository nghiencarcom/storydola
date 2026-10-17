import { NextResponse } from "next/server";
import { extractSceneDialogueAndDetails } from "../../../../../../lib/dialogue-extraction";
import { dialogueSegmentsText, readDialogueSegments } from "../../../../../../lib/dialogue-segments";
import { isProjectRenderActive } from "../../../../../../lib/render-lock";
import { chunkForScene, findProjectScene } from "../../../../../../lib/scene-store";
import type { DialogueSegment, ProjectCharacter } from "../../../../../../lib/project-types";
import { getProjectOrThrow, makeActivity, markLocalizedRendersStale, markRenderStale, now, readChunkOutput, readData, saveChunkOutput, updateData } from "../../../../../../lib/server-store";
import { isProjectTtsActive } from "../../../../../../lib/tts-lock";

export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function sceneDurationMs(scene: JsonRecord) {
  const start = Number(scene.start_sec ?? scene.startSec);
  const end = Number(scene.end_sec ?? scene.endSec);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.min(15_000, Math.round((end - start) * 1000)) : 15_000;
}

function canonicalizeSegments(value: unknown, existing: DialogueSegment[], characters: ProjectCharacter[], durationMs: number) {
  if (!Array.isArray(value)) throw new Error("DIALOGUE_SEGMENTS_REQUIRED");
  const knownIds = new Set(characters.map((character) => character.id));
  const oldById = new Map(existing.map((segment) => [segment.id, segment]));
  const seen = new Set<string>();
  const output: DialogueSegment[] = [];
  for (const [index, raw] of value.entries()) {
    const record = asRecord(raw);
    const id = String(record.id || `line-${index + 1}`).trim().slice(0, 100);
    const text = String(record.text || "").trim().slice(0, 2_000);
    if (!text) continue;
    if (!id || seen.has(id)) throw new Error("DIALOGUE_SEGMENT_ID_INVALID");
    seen.add(id);
    const speakerCharacterId = String(record.speakerCharacterId || "").trim();
    if (speakerCharacterId && !knownIds.has(speakerCharacterId)) throw new Error("DIALOGUE_SPEAKER_INVALID");
    const startMs = Math.round(Number(record.startMs));
    const endValue = record.endMs === null || record.endMs === "" || record.endMs === undefined ? undefined : Math.round(Number(record.endMs));
    if (!Number.isFinite(startMs) || startMs < 0 || startMs >= durationMs) throw new Error("DIALOGUE_START_INVALID");
    if (endValue !== undefined && (!Number.isFinite(endValue) || endValue <= startMs || endValue > durationMs)) throw new Error("DIALOGUE_END_INVALID");
    const old = oldById.get(id);
    const sourceTextUnchanged = old?.text === text;
    const speakerUnchanged = old?.speakerCharacterId === (speakerCharacterId || undefined);
    const audioUnchanged = sourceTextUnchanged && speakerUnchanged;
    const translations = sourceTextUnchanged && record.translations && typeof record.translations === "object" && !Array.isArray(record.translations)
      ? Object.fromEntries(Object.entries(record.translations as Record<string, unknown>).filter(([, translated]) => typeof translated === "string" && translated.trim()).map(([language, translated]) => [language, String(translated).trim().slice(0, 2_000)]))
      : sourceTextUnchanged && old?.translations ? old.translations : undefined;
    const translatedAudio = audioUnchanged && old?.translatedAudio
      ? Object.fromEntries(Object.entries(old.translatedAudio).filter(([language]) => translations?.[language] === old.translations?.[language])) as DialogueSegment["translatedAudio"]
      : undefined;
    output.push({
      id,
      speakerCharacterId: speakerCharacterId || undefined,
      speakerName: speakerCharacterId ? characters.find((character) => character.id === speakerCharacterId)?.name : String(record.speakerName || "").trim() || undefined,
      text,
      startMs,
      ...(endValue !== undefined ? { endMs: endValue } : {}),
      ...(audioUnchanged && old?.audio ? { audio: old.audio } : {}),
      ...(translations ? { translations } : {}),
      ...(translatedAudio ? { translatedAudio } : {}),
    });
  }
  return output;
}

function hasDialogueSourceChanges(existing: DialogueSegment[], next: DialogueSegment[]) {
  if (existing.length !== next.length) return true;
  return existing.some((segment, index) => {
    const candidate = next[index];
    return !candidate || segment.id !== candidate.id || segment.text !== candidate.text
      || segment.speakerCharacterId !== candidate.speakerCharacterId || segment.speakerName !== candidate.speakerName
      || segment.startMs !== candidate.startMs || segment.endMs !== candidate.endMs;
  });
}

export async function POST(_request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await context.params;
  if (isProjectRenderActive(slug) || isProjectTtsActive(slug)) {
    return NextResponse.json({ message: "Project đang tạo TTS hoặc ghép video. Hãy đợi tác vụ hoàn tất rồi hoàn thiện cảnh." }, { status: 409 });
  }
  const snapshot = await readData();
  const project = snapshot.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  if (project.presetId !== "ai-drama") return NextResponse.json({ message: "Hoàn thiện thoại theo nhân vật chỉ áp dụng cho AI Drama." }, { status: 409 });
  const { scene } = await findProjectScene(project, sceneId);
  if (!scene) return NextResponse.json({ message: "Không tìm thấy cảnh." }, { status: 404 });
  const chunk = chunkForScene(project, scene);
  if (!chunk?.outputPath) return NextResponse.json({ message: "Tập của cảnh chưa có kịch bản." }, { status: 409 });

  try {
    const payload = asRecord(await readChunkOutput(chunk));
    const rawScenes = Array.isArray(payload.scenes) ? payload.scenes : [];
    const targetIndex = rawScenes.findIndex((value) => String(asRecord(value).id || asRecord(value).scene_id || "").trim() === scene.id);
    if (targetIndex < 0) return NextResponse.json({ message: "Không tìm thấy cảnh trong file kịch bản của tập." }, { status: 409 });
    const targetRecord = asRecord(rawScenes[targetIndex]);
    if (Array.isArray(targetRecord.dialogueSegments) || Array.isArray(targetRecord.dialogue_segments)) {
      return NextResponse.json({ message: "Cảnh này đã có timeline thoại. Hãy sửa trực tiếp trong editor hoặc dùng nút phân tích lại sau." }, { status: 409 });
    }

    const extracted = await extractSceneDialogueAndDetails({
      scene: targetRecord,
      sceneId: scene.id,
      characters: project.characters || [],
      language: project.language,
    });
    const existing = readDialogueSegments(targetRecord, project.characters || []);
    const segments = canonicalizeSegments(extracted.segments, existing, project.characters || [], sceneDurationMs(targetRecord));
    const updatedScenes = rawScenes.map((value, index) => {
      if (index !== targetIndex) return value;
      const updated = {
        ...targetRecord,
        dialogueSegments: segments,
        dialogue_or_voiceover: dialogueSegmentsText(segments),
      } as JsonRecord;
      for (const [key, detail] of Object.entries(extracted.details)) {
        if (!String(updated[key] || "").trim()) updated[key] = detail;
      }
      // A legacy scene-level TTS file cannot be reused as audio for newly split turns.
      delete updated.audio;
      delete updated.ttsVoiceId;
      delete updated.ttsVoiceName;
      delete updated.ttsVoiceLanguage;
      delete updated.tts_voice_id;
      delete updated.tts_voice_name;
      delete updated.tts_voice_language;
      return updated;
    });
    const outputPath = await saveChunkOutput(slug, chunk.id, { ...payload, scenes: updatedScenes });
    const updatedTarget = asRecord(updatedScenes[targetIndex]);

    await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      const currentChunk = current.chunks.find((item) => item.id === chunk.id);
      if (currentChunk) {
        currentChunk.outputPath = outputPath;
        currentChunk.tts = { status: segments.length ? "idle" : "not_needed", completed: 0, total: segments.length, failed: 0, updatedAt: now() };
        currentChunk.render = markRenderStale(currentChunk.render);
      }
      current.render = markRenderStale(current.render);
      current.updatedAt = now();
      data.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "chunk",
        title: `Đã hoàn thiện timeline thoại cho ${scene.id}`,
        detail: `${chunk.id} · ${segments.length} lượt thoại · model ${extracted.model}`,
        status: "success",
      }));
    });

    return NextResponse.json({ ok: true, model: extracted.model, scene: { ...scene, ...updatedTarget } });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "DIALOGUE_EXTRACT_FAILED";
    const messages: Record<string, string> = {
      SCRIPT_LLM_NOT_CONFIGURED: "Chưa cấu hình Script LLM để AI tách thoại. Bạn vẫn có thể thêm câu thủ công hoặc nạp SRT.",
      DIALOGUE_SOURCE_EMPTY: "Cảnh chưa có lời thoại để phân tích.",
      DIALOGUE_EXTRACT_EMPTY: "AI không trả về các lượt thoại hợp lệ. Hãy thử lại hoặc nhập SRT thủ công.",
      DIALOGUE_EXTRACT_TOO_MANY: "AI trả về quá nhiều lượt thoại cho một cảnh. Hãy thử lại hoặc chia nội dung thành nhiều cảnh.",
      DIALOGUE_TIMELINE_OVER_15_SECONDS: "Các lượt thoại vượt quá 15 giây. Hãy rút gọn lời thoại hoặc chia cảnh.",
    };
    return NextResponse.json({ message: messages[code] || (cause instanceof Error ? cause.message : "Không thể hoàn thiện timeline thoại.") }, { status: code === "SCRIPT_LLM_NOT_CONFIGURED" ? 503 : code === "DIALOGUE_SOURCE_EMPTY" ? 409 : 502 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await context.params;
  if (isProjectRenderActive(slug) || isProjectTtsActive(slug)) {
    return NextResponse.json({ message: "Project đang tạo TTS hoặc ghép video. Hãy đợi tác vụ hoàn tất rồi sửa timeline." }, { status: 409 });
  }
  const snapshot = await readData();
  const project = snapshot.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  if (project.presetId !== "ai-drama") return NextResponse.json({ message: "Timeline nhiều người thoại chỉ áp dụng cho AI Drama." }, { status: 409 });
  const { scene } = await findProjectScene(project, sceneId);
  if (!scene) return NextResponse.json({ message: "Không tìm thấy cảnh." }, { status: 404 });
  const chunk = chunkForScene(project, scene);
  if (!chunk?.outputPath) return NextResponse.json({ message: "Tập của cảnh chưa có kịch bản." }, { status: 409 });
  const body = asRecord(await request.json().catch(() => ({})));

  try {
    const payload = asRecord(await readChunkOutput(chunk));
    const rawScenes = Array.isArray(payload.scenes) ? payload.scenes : [];
    const targetIndex = rawScenes.findIndex((value) => String(asRecord(value).id || asRecord(value).scene_id || "").trim() === scene.id);
    if (targetIndex < 0) return NextResponse.json({ message: "Không tìm thấy cảnh trong file kịch bản của tập." }, { status: 409 });
    const targetRecord = asRecord(rawScenes[targetIndex]);
    const existing = readDialogueSegments(targetRecord, project.characters || []);
    const segments = canonicalizeSegments(body.dialogueSegments, existing, project.characters || [], sceneDurationMs(targetRecord));
    const sourceChanged = hasDialogueSourceChanges(existing, segments);
    const updatedScenes = rawScenes.map((value, index) => index === targetIndex ? {
      ...asRecord(value),
      dialogueSegments: segments,
      dialogue_or_voiceover: dialogueSegmentsText(segments),
    } : value);
    const outputPath = await saveChunkOutput(slug, chunk.id, { ...payload, scenes: updatedScenes });
    const updatedTarget = asRecord(updatedScenes[targetIndex]);
    const total = Array.isArray(updatedTarget.dialogueSegments) ? updatedTarget.dialogueSegments.length : 0;

    await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      const currentChunk = current.chunks.find((item) => item.id === chunk.id);
      if (currentChunk) {
        currentChunk.outputPath = outputPath;
        if (sourceChanged) {
          currentChunk.tts = { status: total ? "idle" : "not_needed", completed: 0, total, failed: 0, updatedAt: now() };
          currentChunk.render = markRenderStale(currentChunk.render);
        } else {
          currentChunk.render = markLocalizedRendersStale(currentChunk.render);
        }
      }
      if (sourceChanged) current.render = markRenderStale(current.render);
      current.updatedAt = now();
      data.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "chunk",
        title: sourceChanged ? `Đã lưu timeline thoại cho ${scene.id}` : `Đã lưu bản thoại ${scene.id}`,
        detail: `${chunk.id} · ${total} câu thoại · tối đa 15 giây/cảnh`,
        status: "success",
      }));
    });

    return NextResponse.json({
      ok: true,
      scene: { ...scene, ...updatedTarget, dialogueSegments: segments },
    });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "DIALOGUE_SAVE_FAILED";
    const messages: Record<string, string> = {
      DIALOGUE_SEGMENTS_REQUIRED: "Thiếu danh sách câu thoại.",
      DIALOGUE_SEGMENT_ID_INVALID: "Mã câu thoại bị thiếu hoặc trùng.",
      DIALOGUE_SPEAKER_INVALID: "Có người thoại không thuộc Character Bible của project.",
      DIALOGUE_START_INVALID: "Thời điểm bắt đầu phải nằm trong khoảng 0–15 giây.",
      DIALOGUE_END_INVALID: "Thời điểm kết thúc phải sau lúc bắt đầu và không vượt quá 15 giây.",
    };
    return NextResponse.json({ message: messages[code] || "Không thể lưu timeline lời thoại." }, { status: 400 });
  }
}

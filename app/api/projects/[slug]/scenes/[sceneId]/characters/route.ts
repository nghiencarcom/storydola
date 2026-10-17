import { NextResponse } from "next/server";
import type { MediaGenerationSettings } from "../../../../../../lib/project-types";
import { chunkForScene, findProjectScene } from "../../../../../../lib/scene-store";
import { resolveMediaGenerationSettings, SEEDANCE_DIRECT_MAX_REFERENCE_IMAGES, shouldUseVideoLocationReference } from "../../../../../../lib/media-generation-settings";
import { getProjectOrThrow, makeActivity, markRenderStale, now, readChunkOutput, readData, saveChunkOutput, updateData } from "../../../../../../lib/server-store";
import { resolveProjectSceneVoice } from "../../../../../../lib/project-tts-voice";
import { sceneReferenceCharacterIds, sceneReferenceLocationId, type SceneReferenceKind } from "../../../../../../lib/scene-reference-assignments";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function POST(request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const { scene } = await findProjectScene(project, sceneId);
  if (!scene) return NextResponse.json({ message: "Không tìm thấy cảnh." }, { status: 404 });
  const chunk = chunkForScene(project, scene);
  if (!chunk?.outputPath) return NextResponse.json({ message: "Chunk của cảnh chưa có output." }, { status: 409 });

  const body = asRecord(await request.json().catch(() => ({}))) || {};
  const requestedIds = Array.isArray(body.characterIds) ? body.characterIds.map((value) => String(value).trim()).filter(Boolean) : [];
  const characterIds = [...new Set(requestedIds)];
  const rawLocationId = String(body.locationId || "").trim();
  const locationId = rawLocationId || "";
  const referenceKind: SceneReferenceKind | undefined = body.referenceKind === "image" || body.referenceKind === "video" ? body.referenceKind : undefined;
  const hasSpeakerCharacter = Object.prototype.hasOwnProperty.call(body, "speakerCharacterId");
  const speakerCharacterId = hasSpeakerCharacter ? String(body.speakerCharacterId || "").trim() : undefined;
  const currentIdsRaw = scene.character_ids ?? scene.characterIds;
  const currentCharacterIds = Array.isArray(currentIdsRaw) ? [...new Set(currentIdsRaw.map((id) => String(id).trim()).filter(Boolean))] : [];
  const currentSceneLocationId = String(scene.location_id ?? scene.locationId ?? scene.environment_id ?? scene.environmentId ?? "");
  const sceneAssignmentChanged = JSON.stringify([...currentCharacterIds].sort()) !== JSON.stringify([...characterIds].sort()) || currentSceneLocationId !== locationId;
  const currentReferenceIds = referenceKind ? sceneReferenceCharacterIds(scene, referenceKind) : currentCharacterIds;
  const currentReferenceLocationId = referenceKind ? sceneReferenceLocationId(scene, referenceKind) : currentSceneLocationId;
  const selectedReferencesChanged = JSON.stringify([...currentReferenceIds].sort()) !== JSON.stringify([...characterIds].sort()) || currentReferenceLocationId !== locationId;
  const referencesChanged = referenceKind ? selectedReferencesChanged : sceneAssignmentChanged;
  const assignmentsForValidation = referenceKind
    ? { ...scene, [`${referenceKind}_reference_character_ids`]: characterIds, [`${referenceKind}_reference_location_id`]: locationId }
    : { ...scene, character_ids: characterIds, location_id: locationId };
  const imageReferenceIds = sceneReferenceCharacterIds(assignmentsForValidation, "image");
  const imageReferenceLocationId = sceneReferenceLocationId(assignmentsForValidation, "image");
  const videoReferenceIds = sceneReferenceCharacterIds(assignmentsForValidation, "video");
  const videoReferenceLocationId = sceneReferenceLocationId(assignmentsForValidation, "video");
  const sceneSettings = asRecord(scene.mediaGeneration || scene.media_generation) as Partial<MediaGenerationSettings> | null;
  const settings = resolveMediaGenerationSettings({ ...project.mediaGeneration, ...sceneSettings });
  const model = settings.videoModel.toLowerCase();
  const configuredLimit = Number(process.env.MAIVIDEO_VIDEO_MAX_REFERENCE_IMAGES);
  const modelLimit = settings.videoProvider === "seedance" ? SEEDANCE_DIRECT_MAX_REFERENCE_IMAGES : 7;
  const referenceLimit = Number.isInteger(configuredLimit) && configuredLimit > 0
    ? Math.min(modelLimit, configuredLimit)
    : modelLimit;
  const videoReferenceCount = Number(settings.videoUseSceneImageReference)
    + (settings.videoUseCharacterReferences ? videoReferenceIds.length : 0)
    + (shouldUseVideoLocationReference(settings, project.presetId === "ai-drama") && videoReferenceLocationId ? 1 : 0);
  if (referencesChanged && (referenceKind === "video" || !referenceKind) && videoReferenceCount > referenceLimit) {
    return NextResponse.json({ message: `Model ${model} nhận tối đa ${referenceLimit} ảnh tham chiếu mỗi cảnh; hiện đang chọn ${videoReferenceCount} ảnh.` }, { status: 400 });
  }
  const configuredImageLimit = Number(process.env.MAIVIDEO_IMAGE_MAX_REFERENCE_IMAGES);
  const imageReferenceLimit = Number.isInteger(configuredImageLimit) && configuredImageLimit > 0 ? Math.min(9, configuredImageLimit) : 9;
  const imageReferenceCount = (settings.imageUseCharacterReferences ? imageReferenceIds.length : 0) + Number(Boolean(imageReferenceLocationId));
  if (referencesChanged && (referenceKind === "image" || !referenceKind) && imageReferenceCount > imageReferenceLimit) {
    return NextResponse.json({ message: `Model ảnh nhận tối đa ${imageReferenceLimit} ảnh tham chiếu; cần chừa 1 ảnh nếu cảnh có bối cảnh.` }, { status: 400 });
  }
  const knownIds = new Set((project.characters || []).map((character) => character.id));
  if (characterIds.some((id) => !knownIds.has(id))) return NextResponse.json({ message: "Danh sách có nhân vật không thuộc project này." }, { status: 400 });
  if (speakerCharacterId && !knownIds.has(speakerCharacterId)) return NextResponse.json({ message: "Nhân vật thoại không thuộc project này." }, { status: 400 });
  if (locationId && !(project.locations || []).some((location) => location.id === locationId)) return NextResponse.json({ message: "Bối cảnh không thuộc project này." }, { status: 400 });

  const saved = await updateData(async (currentData) => {
    const currentProject = getProjectOrThrow(currentData, slug);
    const currentChunk = currentProject.chunks.find((item) => item.id === chunk.id);
    if (!currentChunk?.outputPath) throw new Error("CHUNK_OUTPUT_NOT_FOUND");
    const payload = asRecord(await readChunkOutput(currentChunk));
    const rawScenes = payload && Array.isArray(payload.scenes) ? payload.scenes : [];
    const targetIndex = rawScenes.findIndex((value) => {
      const record = asRecord(value);
      return record && String(record.id || record.scene_id || "").trim() === scene.id;
    });
    if (targetIndex < 0) throw new Error("SCENE_OUTPUT_NOT_FOUND");
    let speakerAssignmentChanged = false;
    const updatedScenes = rawScenes.map((value, index) => {
      if (index !== targetIndex) return value;
      const record = asRecord(value) || {};
      const currentIdsRaw = record.character_ids ?? record.characterIds;
      const currentIds = Array.isArray(currentIdsRaw) ? currentIdsRaw.map(String) : [];
      const currentLocationId = String(record.location_id ?? record.locationId ?? "");
      const sceneAssignmentChanged = !referenceKind && (JSON.stringify([...currentIds].sort()) !== JSON.stringify([...characterIds].sort()) || currentLocationId !== locationId);
      const currentReferenceIds = referenceKind ? sceneReferenceCharacterIds(record, referenceKind) : currentIds;
      const currentReferenceLocationId = referenceKind ? sceneReferenceLocationId(record, referenceKind) : currentLocationId;
      const selectedCharacterReferencesChanged = JSON.stringify([...currentReferenceIds].sort()) !== JSON.stringify([...characterIds].sort());
      const selectedLocationReferenceChanged = currentReferenceLocationId !== locationId;
      const nextRecord = referenceKind
        ? { ...record, [`${referenceKind}_reference_character_ids`]: characterIds, [`${referenceKind}_reference_location_id`]: locationId }
        : { ...record, character_ids: characterIds, location_id: locationId };
      const imageReferenceInputsChanged = referenceKind === "image"
        && ((settings.imageUseCharacterReferences && selectedCharacterReferencesChanged) || selectedLocationReferenceChanged);
      const videoReferenceInputsChanged = referenceKind === "video"
        && ((settings.videoUseCharacterReferences && selectedCharacterReferencesChanged) || (shouldUseVideoLocationReference(settings, currentProject.presetId === "ai-drama") && selectedLocationReferenceChanged));
      const imageInputsChanged = sceneAssignmentChanged || imageReferenceInputsChanged;
      const videoInputsChanged = sceneAssignmentChanged || videoReferenceInputsChanged || (imageReferenceInputsChanged && settings.videoUseSceneImageReference);
      const previousSpeakerId = resolveProjectSceneVoice(record, currentProject).speakerCharacterId;
      const currentMedia = asRecord(record.media);
      const currentReference = asRecord(record.videoReferenceImage || record.video_reference_image) || (currentMedia?.kind === "image" ? currentMedia : null);
      const updated: Record<string, unknown> = {
        ...nextRecord,
        ...(hasSpeakerCharacter ? { speaker_character_id: speakerCharacterId || "" } : {}),
        ...((currentMedia?.kind === "image" && imageInputsChanged || currentMedia?.kind === "video" && videoInputsChanged) ? { media: { ...currentMedia, stale: true } } : {}),
        ...(imageInputsChanged && currentReference?.kind === "image" ? { videoReferenceImage: { ...currentReference, stale: true } } : {}),
        ...(imageInputsChanged ? {
          review_status: "unreviewed",
          review_note: "",
          ai_review: { status: "pending", score: 0, summary: "Ảnh tham chiếu cảnh đã đổi; cần kiểm tra lại media.", issues: ["Media hiện tại được tạo trước khi cập nhật hồ sơ nhân vật hoặc bối cảnh."], checks: {}, createdAt: now() },
        } : {}),
      };
      const speakerChanged = hasSpeakerCharacter && previousSpeakerId !== resolveProjectSceneVoice(updated, currentProject).speakerCharacterId;
      if (speakerChanged) {
        speakerAssignmentChanged = true;
        delete updated.audio;
        delete updated.ttsVoiceId;
        delete updated.ttsVoiceName;
        delete updated.ttsVoiceLanguage;
        delete updated.tts_voice_id;
        delete updated.tts_voice_name;
        delete updated.tts_voice_language;
      }
      return updated;
    });
    const outputPath = await saveChunkOutput(slug, currentChunk.id, { ...(payload || {}), scenes: updatedScenes });
    if (speakerAssignmentChanged) {
      currentChunk.tts = { status: "idle", completed: 0, total: currentChunk.generatedScenes, failed: 0, updatedAt: now() };
      currentChunk.render = markRenderStale(currentChunk.render);
      currentProject.render = markRenderStale(currentProject.render);
    }
    currentProject.updatedAt = now();
    currentData.activities.unshift(makeActivity({
      projectSlug: slug,
      kind: "chunk",
      title: hasSpeakerCharacter
        ? `Đã lưu người thoại cho ${scene.id}`
        : referenceKind ? `Đã lưu tham chiếu ${referenceKind} cho ${scene.id}` : `Đã lưu hồ sơ cảnh cho ${scene.id}`,
      detail: `${currentChunk.id} · ${characterIds.length} nhân vật${locationId ? " · có bối cảnh" : ""}${speakerCharacterId ? " · đã gán voice theo nhân vật" : ""}`,
      status: "success",
    }));
    const updatedSceneRecord = asRecord(updatedScenes[targetIndex]) || {};
    const responseScene = { ...scene, ...updatedSceneRecord };
    if (!referenceKind) Object.assign(responseScene, { characterIds, character_ids: characterIds, locationId, location_id: locationId });
    if (hasSpeakerCharacter) Object.assign(responseScene, { speakerCharacterId: String(updatedSceneRecord.speaker_character_id || "") });
    return { outputPath, scene: responseScene };
  });

  return NextResponse.json({ ok: true, ...saved });
}

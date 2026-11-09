import { NextResponse } from "next/server";
import { generateMaiVideoVideoForScene } from "../../../../../../lib/media-provider";
import { resolveMediaGenerationSettings, shouldUseVideoLocationReference } from "../../../../../../lib/media-generation-settings";
import { isFlowStoryOnlyPreset } from "../../../../../../lib/story-presets";
import { chunkForScene, findProjectScene, previousSceneContinuityReference, sceneReferenceImage } from "../../../../../../lib/scene-store";
import { seedancePublicBaseUrlErrorMessage, seedancePublicBaseUrlIssue } from "../../../../../../lib/seedance-reference-links";
import { saveGeneratedSceneMedia } from "../../../../../../lib/scene-media-output";
import { readData } from "../../../../../../lib/server-store";
import { readMaiVideoAuthCookie } from "../../../../../../lib/maivideo-auth-shared";
import { sceneReferenceCharacterIds, sceneReferenceLocationId } from "../../../../../../lib/scene-reference-assignments";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function POST(request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });

  const { scene, scenes } = await findProjectScene(project, sceneId);
  if (!scene) return NextResponse.json({ message: "Không tìm thấy cảnh." }, { status: 404 });
  const chunk = chunkForScene(project, scene);
  if (!chunk?.outputPath) return NextResponse.json({ message: "Chunk của cảnh chưa có output." }, { status: 409 });

  const sceneSettings = asRecord(scene.mediaGeneration || scene.media_generation) as Record<string, unknown> | null;
  const mediaGeneration = resolveMediaGenerationSettings({
    ...project.mediaGeneration,
    ...sceneSettings,
    ...(isFlowStoryOnlyPreset(project.presetId) ? { flowReferenceMode: "ingredients" as const } : {}),
  });
  const higgsfieldAuthToken = mediaGeneration.videoProvider === "higgsfield" ? readMaiVideoAuthCookie(request.headers.get("cookie")) : "";
  if (mediaGeneration.videoProvider === "higgsfield" && !higgsfieldAuthToken) {
    return NextResponse.json({ code: "HIGGSFIELD_SESSION_REQUIRED", message: "Hãy đăng nhập MaiVideo để dùng Seedance 2.0 · Higgsfield." }, { status: 401 });
  }
  const providerAuthToken = mediaGeneration.videoProvider === "muse" || mediaGeneration.videoProvider === "flow"
    ? readMaiVideoAuthCookie(request.headers.get("cookie"))
    : "";
  if ((mediaGeneration.videoProvider === "muse" || mediaGeneration.videoProvider === "flow") && !providerAuthToken) {
    return NextResponse.json({ code: "PROVIDER_SESSION_REQUIRED", message: "Hãy đăng nhập MaiVideo để dùng API video Muse.ai hoặc Flow." }, { status: 401 });
  }
  const videoReferenceCharacterIds = sceneReferenceCharacterIds(scene, "video");
  const sceneImage = sceneReferenceImage(scene);
  const continuityReference = previousSceneContinuityReference(scenes, scene);
  const flowFramesMode = mediaGeneration.videoProvider === "flow" && mediaGeneration.flowReferenceMode === "frames";
  const flowFrameEndSceneId = String(scene.flowFrameEndSceneId || scene.flow_frame_end_scene_id || "").trim();
  const flowFrameEndScene = scenes.find((item) => item.id === flowFrameEndSceneId);
  const flowFrameEndImage = flowFrameEndScene ? sceneReferenceImage(flowFrameEndScene) : undefined;
  if (flowFramesMode && (flowFrameEndSceneId === sceneId || !sceneImage || sceneImage.kind !== "image" || sceneImage.status !== "ready" || sceneImage.stale === true || !flowFrameEndScene || !flowFrameEndImage || flowFrameEndImage.kind !== "image" || flowFrameEndImage.status !== "ready" || flowFrameEndImage.stale === true)) {
    return NextResponse.json({ code: "FLOW_FRAMES_REQUIRED", message: "Flow Frames cần ảnh khung đầu của cảnh hiện tại và ảnh khung cuối đã chọn." }, { status: 409 });
  }
  if (mediaGeneration.videoUseSceneImageReference && (!sceneImage || sceneImage.status !== "ready")) {
    return NextResponse.json({ code: "SCENE_IMAGE_REQUIRED", message: "Hãy tạo và kiểm tra ảnh cảnh trước khi tạo video." }, { status: 409 });
  }
  const hasCharacterReferenceImage = videoReferenceCharacterIds
    .some((id) => (project.characters || []).some((character) => character.id === id && Boolean(character.referenceImagePath)));
  const locationId = sceneReferenceLocationId(scene, "video");
  const hasLocationReferenceImage = Boolean((project.locations || []).find((location) => location.id === locationId)?.referenceImagePath);
  const seedanceNeedsReferenceUrl = flowFramesMode
    || Boolean(mediaGeneration.videoUseSceneImageReference && sceneImage)
    || Boolean(mediaGeneration.videoUseCharacterReferences && hasCharacterReferenceImage)
    || Boolean(shouldUseVideoLocationReference(mediaGeneration, project.presetId === "ai-drama") && hasLocationReferenceImage)
    || Boolean(continuityReference);
  const publicBaseUrlIssue = (mediaGeneration.videoProvider === "seedance" || mediaGeneration.videoProvider === "muse" || mediaGeneration.videoProvider === "flow") && seedanceNeedsReferenceUrl
    ? seedancePublicBaseUrlIssue()
    : undefined;
  if (publicBaseUrlIssue) {
    return NextResponse.json({ code: publicBaseUrlIssue, message: seedancePublicBaseUrlErrorMessage(publicBaseUrlIssue) }, { status: 503 });
  }
  try {
    const media = await generateMaiVideoVideoForScene({
      projectSlug: slug,
      chunkId: chunk.id,
      scene,
      projectScenes: scenes,
      characters: project.characters || [],
      locations: project.locations || [],
      sceneIndex: scene.sceneIndex,
      aspectRatio: project.aspectRatio,
      mediaGeneration,
      presetId: project.presetId,
      contentGenre: project.contentGenre,
      secondaryGenres: project.secondaryGenres,
      storySetting: project.storySetting,
      settingNotes: project.settingNotes,
      visualStyle: project.visualStyle,
      imageStyle: project.imageStyle,
      continuityReference,
      providerAuthToken,
      higgsfieldAuthToken,
      videoSpokenLanguage: project.language,
      projectVoiceId: project.voiceId,
      projectVoiceName: project.voiceName,
      projectVoiceLanguage: project.voiceLanguage,
    });
    const saved = await saveGeneratedSceneMedia({ projectSlug: slug, sceneId, media, mediaGeneration });
    return NextResponse.json({ ok: true, ...saved, media });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Không tạo được video AI cho cảnh.";
    const publicBaseUrlMessage = seedancePublicBaseUrlErrorMessage(message);
    const userMessage = publicBaseUrlMessage || (message === "SEEDANCE_ACCOUNT_REQUIRED"
      ? "Chưa kết nối API key Seedance / MaiVideo. Hãy thêm tài khoản trong Cài đặt."
      : message === "AI_DRAMA_SCENE_DURATION_UNSUPPORTED"
        ? "Model video này không hỗ trợ đúng thời lượng 5, 10 hoặc 15 giây của cảnh AI Drama. Hãy chọn model khác."
        : message === "SEEDANCE_ACCOUNT_NOT_FOUND"
          ? "Tài khoản API đã chọn không còn tồn tại. Hãy chọn lại tài khoản."
      : message === "SEEDANCE_ENCRYPTION_KEY_REQUIRED"
          ? "Máy chủ chưa cấu hình khóa mã hóa tài khoản API."
        : message === "MAIVIDEO_VIDEO_API_KEY_REQUIRED"
          ? "Hãy thêm API key tạo video MaiVideo trong Cài đặt."
          : message === "MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED"
            ? "Máy chủ chưa cấu hình khóa mã hóa API key MaiVideo."
        : message);
    const status = message === "MAIVIDEO_VIDEO_API_DISABLED"
      || message === "MAIVIDEO_API_KEY_REQUIRED"
      || message === "MAIVIDEO_VIDEO_API_KEY_REQUIRED"
      || message === "MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED"
      || message === "SEEDANCE_ACCOUNT_REQUIRED"
      || message === "SEEDANCE_ACCOUNT_NOT_FOUND"
      || message === "SEEDANCE_ENCRYPTION_KEY_REQUIRED"
      || Boolean(publicBaseUrlMessage)
      ? 503
      : message === "AI_DRAMA_SCENE_DURATION_UNSUPPORTED" ? 409 : 502;
    return NextResponse.json({ code: message, message: userMessage }, { status });
  }
}

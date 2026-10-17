import { NextResponse } from "next/server";
import { resolveMediaGenerationSettings } from "../../../../../../lib/media-generation-settings";
import { previewMaiVideoVideoPromptForScene, type VideoPromptReferenceImage } from "../../../../../../lib/media-provider";
import { chunkForScene, findProjectScene, previousSceneContinuityReference } from "../../../../../../lib/scene-store";
import { readDialogueSegments } from "../../../../../../lib/dialogue-segments";
import { readData } from "../../../../../../lib/server-store";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function POST(request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await context.params;
  const body = asRecord(await request.json().catch(() => ({})));
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });

  const { scene, scenes } = await findProjectScene(project, sceneId);
  if (!scene) return NextResponse.json({ message: "Không tìm thấy cảnh." }, { status: 404 });
  const chunk = chunkForScene(project, scene);
  if (!chunk?.outputPath) return NextResponse.json({ message: "Chunk của cảnh chưa có output." }, { status: 409 });

  const sceneSettings = asRecord(scene.mediaGeneration || scene.media_generation);
  const requestedSettings = asRecord(body?.mediaGeneration);
  const mediaGeneration = resolveMediaGenerationSettings({
    ...project.mediaGeneration,
    ...(sceneSettings || {}),
    ...(requestedSettings || {}),
  });
  let referenceImages: VideoPromptReferenceImage[] = [];
  let referenceImagesComposed = false;
  try {
    const prompt = await previewMaiVideoVideoPromptForScene({
      projectSlug: slug,
      chunkId: chunk.id,
      scene,
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
      continuityReference: previousSceneContinuityReference(scenes, scene),
      videoSpokenLanguage: project.language,
      projectVoiceId: project.voiceId,
      projectVoiceName: project.voiceName,
      projectVoiceLanguage: project.voiceLanguage,
      onVideoReferencesComposed: async (references) => {
        referenceImages = references;
        referenceImagesComposed = true;
      },
    });
    const dialogueCueCount = readDialogueSegments(scene, project.characters || []).length;
    return NextResponse.json({
      ok: true,
      prompt,
      promptLength: prompt.length,
      ...(body?.referenceImagesOnly === true ? { referenceImages } : {}),
      provider: mediaGeneration.videoProvider,
      model: mediaGeneration.videoModel,
      dialogueCueCount,
      dialogueIncluded: prompt.includes("AUTHORITATIVE DIALOGUE CUES"),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    if (body?.referenceImagesOnly === true && referenceImagesComposed) {
      return NextResponse.json({
        ok: true,
        referenceImages,
        provider: mediaGeneration.videoProvider,
        model: mediaGeneration.videoModel,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const message = cause instanceof Error ? cause.message : "Không thể tạo bản xem trước prompt video.";
    const status = message === "AI_DRAMA_SCENE_DURATION_UNSUPPORTED" ? 409 : 422;
    return NextResponse.json({ ok: false, message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

import { NextResponse } from "next/server";
import { generateMaiVideoImageForScene } from "../../../../../../lib/media-provider";
import { resolveMediaGenerationSettings } from "../../../../../../lib/media-generation-settings";
import { chunkForScene, findProjectScene, previousSceneContinuityReference } from "../../../../../../lib/scene-store";
import { saveGeneratedSceneMedia } from "../../../../../../lib/scene-media-output";
import { readData } from "../../../../../../lib/server-store";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function POST(_request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });

  const { scene, scenes } = await findProjectScene(project, sceneId);
  if (!scene) return NextResponse.json({ message: "Không tìm thấy cảnh." }, { status: 404 });
  const chunk = chunkForScene(project, scene);
  if (!chunk?.outputPath) return NextResponse.json({ message: "Chunk của cảnh chưa có output." }, { status: 409 });

  const sceneSettings = asRecord(scene.mediaGeneration || scene.media_generation) as Record<string, unknown> | null;
  const mediaGeneration = resolveMediaGenerationSettings({ ...project.mediaGeneration, ...sceneSettings });
  try {
    const media = await generateMaiVideoImageForScene({
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
    });
    const saved = await saveGeneratedSceneMedia({ projectSlug: slug, sceneId, media, mediaGeneration });
    return NextResponse.json({ ok: true, ...saved, media });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Không tạo được ảnh AI cho cảnh.";
    const requiresConfiguration = message === "MAIVIDEO_API_KEY_REQUIRED"
      || message === "MAIVIDEO_IMAGE_API_KEY_REQUIRED"
      || message === "MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED";
    const userMessage = message === "MAIVIDEO_IMAGE_API_KEY_REQUIRED"
      ? "Hãy thêm API key tạo ảnh MaiVideo trong Cài đặt."
      : message === "MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED"
        ? "Máy chủ chưa cấu hình khóa mã hóa API key MaiVideo."
        : message;
    return NextResponse.json({ code: message, message: userMessage }, { status: requiresConfiguration ? 503 : 502 });
  }
}

import { NextResponse } from "next/server";
import type { MediaGenerationSettings } from "../../../../../../lib/project-types";
import { resolveMediaGenerationSettings } from "../../../../../../lib/media-generation-settings";
import { readProjectScenes } from "../../../../../../lib/scene-store";
import { getProjectOrThrow, makeActivity, now, readChunkOutput, saveChunkOutput, updateData } from "../../../../../../lib/server-store";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function POST(request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await context.params;
  const body = asRecord(await request.json().catch(() => ({}))) || {};
  const requestedSettings = asRecord(body.mediaGeneration) as Partial<MediaGenerationSettings> | null;
  if (!requestedSettings) return NextResponse.json({ message: "Thiếu cấu hình model cho cảnh." }, { status: 400 });

  try {
    const saved = await updateData(async (data) => {
      const project = getProjectOrThrow(data, slug);
      const scene = (await readProjectScenes(project)).find((item) => item.id === sceneId);
      if (!scene) throw new Error("SCENE_NOT_FOUND");
      const chunk = project.chunks.find((item) => item.id === scene.chunkId);
      if (!chunk?.outputPath) throw new Error("CHUNK_OUTPUT_NOT_FOUND");
      if (chunk.status === "processing") throw new Error("CHUNK_IS_PROCESSING");

      const settings = resolveMediaGenerationSettings(requestedSettings);
      const currentSettings = resolveMediaGenerationSettings({ ...project.mediaGeneration, ...(asRecord(scene.mediaGeneration || scene.media_generation) || {}) });
      const imageSettingsChanged = ["imageModel", "imageQuality", "imageDetailLevel", "imageUseCharacterReferences"]
        .some((key) => currentSettings[key as keyof MediaGenerationSettings] !== settings[key as keyof MediaGenerationSettings]);
      const videoSettingsChanged = ["videoProvider", "seedanceAccountId", "videoModel", "videoQuality", "videoDurationMode", "videoDurationSec", "videoMultiShot", "videoAudio", "videoOffPeak", "videoUseCharacterReferences", "videoUseLocationReferences", "videoUseSceneImageReference"]
        .some((key) => currentSettings[key as keyof MediaGenerationSettings] !== settings[key as keyof MediaGenerationSettings]);
      const payload = asRecord(await readChunkOutput(chunk));
      const rawScenes = payload && Array.isArray(payload.scenes) ? payload.scenes : [];
      const targetIndex = rawScenes.findIndex((value) => {
        const record = asRecord(value);
        return record && String(record.id || record.scene_id || "").trim() === sceneId;
      });
      if (targetIndex < 0) throw new Error("SCENE_OUTPUT_NOT_FOUND");
      const updatedScenes = rawScenes.map((value, index) => {
        if (index !== targetIndex) return value;
        const record = asRecord(value) || {};
        const currentMedia = asRecord(record.media);
        const currentReference = asRecord(record.videoReferenceImage || record.video_reference_image)
          || (currentMedia?.kind === "image" ? currentMedia : null);
        return {
          ...record,
          mediaGeneration: settings,
          ...(imageSettingsChanged && currentMedia?.kind === "image" ? { media: { ...currentMedia, stale: true } } : {}),
          ...(videoSettingsChanged && currentMedia?.kind === "video" ? { media: { ...currentMedia, stale: true } } : {}),
          ...(imageSettingsChanged && currentReference?.kind === "image" ? { videoReferenceImage: { ...currentReference, stale: true } } : {}),
        };
      });
      const outputPath = await saveChunkOutput(slug, chunk.id, { ...(payload || {}), scenes: updatedScenes });
      project.updatedAt = now();
      data.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "chunk",
        title: `Đã lưu model media cho ${sceneId}`,
        detail: `${chunk.id} · ảnh ${settings.imageModel} · video ${settings.videoModel}`,
        status: "success",
      }));
      return { outputPath, scene: { ...scene, ...(asRecord(updatedScenes[targetIndex]) || {}), mediaGeneration: settings } };
    });
    return NextResponse.json({ ok: true, ...saved });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Không thể lưu model media cho cảnh.";
    const status = message === "SCENE_NOT_FOUND" ? 404 : message === "CHUNK_IS_PROCESSING" ? 409 : message === "CHUNK_OUTPUT_NOT_FOUND" || message === "SCENE_OUTPUT_NOT_FOUND" ? 409 : 500;
    return NextResponse.json({ message: status === 500 ? "Không thể lưu model media cho cảnh." : message }, { status });
  }
}

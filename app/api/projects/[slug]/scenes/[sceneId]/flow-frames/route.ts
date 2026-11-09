import { NextResponse } from "next/server";
import { findProjectScene, sceneReferenceImage } from "../../../../../../lib/scene-store";
import { isFlowStoryOnlyPreset } from "../../../../../../lib/story-presets";
import { getProjectOrThrow, markRenderStale, now, readChunkOutput, saveChunkOutput, updateData } from "../../../../../../lib/server-store";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function POST(request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await context.params;
  const body = asRecord(await request.json().catch(() => ({}))) || {};
  const endSceneId = String(body.endSceneId || "").trim();

  try {
    const saved = await updateData(async (data) => {
      const project = getProjectOrThrow(data, slug);
      if (isFlowStoryOnlyPreset(project.presetId)) throw new Error("FLOW_FRAMES_STORY_ONLY");
      const { scene, scenes } = await findProjectScene(project, sceneId);
      if (!scene) throw new Error("SCENE_NOT_FOUND");
      if (endSceneId && endSceneId === sceneId) throw new Error("FLOW_FRAME_END_MUST_DIFFER");
      const endScene = endSceneId ? scenes.find((item) => item.id === endSceneId) : undefined;
      if (endSceneId && !endScene) throw new Error("FLOW_FRAME_SCENE_NOT_FOUND");
      if (endScene) {
        const image = sceneReferenceImage(endScene);
        if (!image || image.kind !== "image" || image.status !== "ready" || image.stale === true || !image.localPath) throw new Error("FLOW_FRAME_IMAGE_REQUIRED");
      }

      const chunk = project.chunks.find((item) => item.id === scene.chunkId);
      if (!chunk?.outputPath) throw new Error("CHUNK_OUTPUT_NOT_FOUND");
      if (chunk.status === "processing") throw new Error("CHUNK_IS_PROCESSING");
      const payload = asRecord(await readChunkOutput(chunk));
      const rawScenes = payload && Array.isArray(payload.scenes) ? payload.scenes : [];
      let found = false;
      const updatedScenes = rawScenes.map((value) => {
        const record = asRecord(value) || {};
        if (String(record.id || record.scene_id || "").trim() !== sceneId) return value;
        found = true;
        const media = asRecord(record.media);
        return {
          ...record,
          flowFrameEndSceneId: endSceneId,
          ...(media?.kind === "video" ? { media: { ...media, stale: true } } : {}),
        };
      });
      if (!found) throw new Error("SCENE_OUTPUT_NOT_FOUND");
      chunk.outputPath = await saveChunkOutput(slug, chunk.id, { ...(payload || {}), scenes: updatedScenes });
      chunk.render = markRenderStale(chunk.render);
      project.render = markRenderStale(project.render);
      project.updatedAt = now();
      return { sceneId, flowFrameEndSceneId: endSceneId };
    });
    return NextResponse.json({ ok: true, ...saved });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "FLOW_FRAME_SAVE_FAILED";
    const message = code === "FLOW_FRAMES_STORY_ONLY" ? "Dạng Story chỉ sử dụng Ingredients/References; không thể cấu hình Frames." :
      code === "FLOW_FRAME_END_MUST_DIFFER" ? "Ảnh khung cuối phải là ảnh của cảnh khác với cảnh đang tạo." :
      code === "FLOW_FRAME_IMAGE_REQUIRED" ? "Cảnh được chọn làm khung cuối chưa có ảnh cảnh sẵn sàng." :
      code === "FLOW_FRAME_SCENE_NOT_FOUND" ? "Không tìm thấy cảnh được chọn làm khung cuối trong project." :
      code === "SCENE_NOT_FOUND" ? "Không tìm thấy cảnh." :
      code === "CHUNK_IS_PROCESSING" ? "Không thể đổi ảnh khung khi chunk đang xử lý." :
      code === "CHUNK_OUTPUT_NOT_FOUND" || code === "SCENE_OUTPUT_NOT_FOUND" ? "Không tìm thấy dữ liệu cảnh để lưu ảnh khung." :
      "Không thể lưu ảnh khung cuối Flow.";
    const status = code === "SCENE_NOT_FOUND" || code === "FLOW_FRAME_SCENE_NOT_FOUND" ? 404 :
      ["FLOW_FRAMES_STORY_ONLY", "FLOW_FRAME_END_MUST_DIFFER", "FLOW_FRAME_IMAGE_REQUIRED", "CHUNK_IS_PROCESSING", "CHUNK_OUTPUT_NOT_FOUND", "SCENE_OUTPUT_NOT_FOUND"].includes(code) ? 409 : 500;
    return NextResponse.json({ ok: false, code, message }, { status });
  }
}

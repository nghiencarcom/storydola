import { NextResponse } from "next/server";
import { isProjectRenderActive } from "../../../../../../lib/render-lock";
import { chunkForScene, findProjectScene } from "../../../../../../lib/scene-store";
import { getProjectOrThrow, makeActivity, markRenderStale, now, readChunkOutput, readData, saveChunkOutput, updateData } from "../../../../../../lib/server-store";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function PUT(request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await context.params;
  if (isProjectRenderActive(slug)) return NextResponse.json({ message: "Project đang ghép video. Hãy đợi tác vụ hoàn tất rồi sửa prompt." }, { status: 409 });

  const snapshot = await readData();
  const project = snapshot.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  if (project.presetId !== "ai-drama") return NextResponse.json({ message: "Sửa prompt theo cảnh chỉ áp dụng cho AI Drama." }, { status: 409 });
  if (project.videoQueue?.status === "running") return NextResponse.json({ message: "Queue video đang chạy. Hãy tạm dừng queue trước khi sửa prompt." }, { status: 409 });

  const body = asRecord(await request.json().catch(() => ({})));
  const imagePrompt = typeof body?.imagePrompt === "string" ? body.imagePrompt.trim() : "";
  const videoPrompt = typeof body?.videoPrompt === "string" ? body.videoPrompt.trim() : "";
  if (!imagePrompt || !videoPrompt) return NextResponse.json({ message: "Cần có cả prompt ảnh và prompt video." }, { status: 400 });
  if (imagePrompt.length > 9_000 || videoPrompt.length > 4_500) return NextResponse.json({ message: "Prompt quá dài. Giới hạn là 9.000 ký tự cho ảnh và 4.500 ký tự cho video." }, { status: 413 });

  const { scene } = await findProjectScene(project, sceneId);
  if (!scene) return NextResponse.json({ message: "Không tìm thấy cảnh." }, { status: 404 });
  const chunk = chunkForScene(project, scene);
  if (!chunk?.outputPath) return NextResponse.json({ message: "Tập của cảnh chưa có kịch bản." }, { status: 409 });

  try {
    const saved = await updateData(async (data) => {
      const currentProject = getProjectOrThrow(data, slug);
      if (currentProject.videoQueue?.status === "running") throw new Error("VIDEO_QUEUE_RUNNING");
      const currentChunk = currentProject.chunks.find((item) => item.id === chunk.id);
      if (!currentChunk?.outputPath) throw new Error("CHUNK_OUTPUT_NOT_FOUND");
      if (currentChunk.status === "processing") throw new Error("CHUNK_IS_PROCESSING");

      const payload = asRecord(await readChunkOutput(currentChunk));
      const rawScenes = Array.isArray(payload?.scenes) ? payload.scenes : [];
      const targetIndex = rawScenes.findIndex((value) => {
        const record = asRecord(value);
        return record && String(record.id || record.scene_id || "").trim() === sceneId;
      });
      if (targetIndex < 0) throw new Error("SCENE_OUTPUT_NOT_FOUND");

      const target = asRecord(rawScenes[targetIndex]) || {};
      const previousImagePrompt = String(target.image_prompt || target.imagePrompt || "").trim();
      const previousVideoPrompt = String(target.video_prompt || target.videoPrompt || "").trim();
      const imageChanged = imagePrompt !== previousImagePrompt;
      const videoChanged = videoPrompt !== previousVideoPrompt;
      const currentMedia = asRecord(target.media);
      const currentReference = asRecord(target.videoReferenceImage || target.video_reference_image)
        || (currentMedia?.kind === "image" ? currentMedia : null);
      const nextTarget: Record<string, unknown> = {
        ...target,
        image_prompt: imagePrompt,
        video_prompt: videoPrompt,
        ...(imageChanged || videoChanged ? {
          review_status: "unreviewed",
          review_note: "",
          ai_review: {
            status: "pending",
            score: 0,
            summary: "Prompt đã thay đổi; cần kiểm tra lại media của cảnh.",
            issues: ["Media hiện có được tạo trước khi lưu prompt mới."],
            checks: {},
            createdAt: now(),
          },
        } : {}),
      };
      if (currentMedia && ((currentMedia.kind === "image" && imageChanged) || (currentMedia.kind === "video" && (imageChanged || videoChanged)))) {
        nextTarget.media = { ...currentMedia, stale: true };
      }
      if (currentReference?.kind === "image" && imageChanged) {
        nextTarget.videoReferenceImage = { ...currentReference, stale: true };
      }

      const updatedScenes = rawScenes.map((value, index) => index === targetIndex ? nextTarget : value);
      const outputPath = await saveChunkOutput(slug, currentChunk.id, { ...(payload || {}), scenes: updatedScenes });
      currentChunk.outputPath = outputPath;
      if (imageChanged || videoChanged) {
        currentChunk.render = markRenderStale(currentChunk.render);
        currentProject.render = markRenderStale(currentProject.render);
      }
      currentProject.updatedAt = now();
      data.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "chunk",
        title: `Đã lưu prompt cho ${sceneId}`,
        detail: `${currentChunk.id} · ${imageChanged ? "đã đổi prompt ảnh" : "prompt ảnh giữ nguyên"} · ${videoChanged ? "đã đổi prompt video" : "prompt video giữ nguyên"}`,
        status: "success",
      }));
      return { outputPath, scene: { ...scene, ...nextTarget } };
    });
    return NextResponse.json({ ok: true, ...saved });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Không thể lưu prompt cho cảnh.";
    const status = message === "VIDEO_QUEUE_RUNNING" || message === "CHUNK_IS_PROCESSING" ? 409
      : message === "CHUNK_OUTPUT_NOT_FOUND" || message === "SCENE_OUTPUT_NOT_FOUND" ? 409
        : message === "PROJECT_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ message: status === 500 ? "Không thể lưu prompt cho cảnh." : message }, { status });
  }
}

import { NextResponse } from "next/server";
import { makeActivity, now, readChunkOutput, readData, saveChunkOutput, updateData } from "../../../../../../lib/server-store";
import { chunkForScene, findProjectScene, readProjectScenes, sceneMediaLocalPath, sceneMediaPreviewUrl } from "../../../../../../lib/scene-store";
import type { SceneReviewStatus } from "../../../../../../lib/project-types";

export const runtime = "nodejs";

const REVIEW_STATUSES: SceneReviewStatus[] = ["unreviewed", "approved", "needs_changes"];

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
  const requestedStatus = String(body.status || "unreviewed").trim() as SceneReviewStatus;
  if (!REVIEW_STATUSES.includes(requestedStatus)) {
    return NextResponse.json({ message: "Trạng thái review không hợp lệ." }, { status: 400 });
  }
  const note = String(body.note || "").trim().slice(0, 2_000);

  const payload = asRecord(await readChunkOutput(chunk));
  const rawScenes = payload && Array.isArray(payload.scenes) ? payload.scenes : [];
  const targetIndex = rawScenes.findIndex((value) => {
    const record = asRecord(value);
    return record && String(record.id || record.scene_id || "").trim() === scene.id;
  });
  if (targetIndex < 0) return NextResponse.json({ message: "Không tìm thấy cảnh trong output." }, { status: 409 });

  const updatedScenes = rawScenes.map((value, index) => {
    if (index !== targetIndex) return value;
    const record = asRecord(value) || {};
    return { ...record, review_status: requestedStatus, review_note: note };
  });
  const outputPath = await saveChunkOutput(slug, chunk.id, { ...(payload || {}), scenes: updatedScenes });
  const reviewCount = (await readProjectScenes(project)).filter((item) => String(item.review_status || item.reviewStatus || "unreviewed") === "needs_changes").length;

  await updateData((currentData) => {
    const currentProject = currentData.projects.find((item) => item.slug === slug);
    if (currentProject) {
      currentProject.reviewCount = reviewCount;
      currentProject.updatedAt = now();
      currentData.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "qa",
        title: `${scene.id} · ${requestedStatus === "approved" ? "Đã duyệt" : requestedStatus === "needs_changes" ? "Cần sửa" : "Bỏ đánh giá"}`,
        detail: note || `${chunk.id} · review scene`,
        status: requestedStatus === "needs_changes" ? "warning" : requestedStatus === "approved" ? "success" : "info",
      }));
    }
  });

  const updatedScene = {
    ...scene,
    review_status: requestedStatus,
    review_note: note,
    reviewStatus: requestedStatus,
    reviewNote: note,
    previewUrl: sceneMediaLocalPath(scene) ? sceneMediaPreviewUrl(slug, scene.id, sceneMediaLocalPath(scene)) : "",
  };
  return NextResponse.json({ ok: true, scene: updatedScene, reviewCount, outputPath });
}

import { NextResponse } from "next/server";
import { evaluateChunkScenes } from "../../../../../lib/scene-ai-review";
import { makeActivity, now, readChunkOutput, readData, saveChunkOutput, updateData } from "../../../../../lib/server-store";
import type { StoryProject } from "../../../../../lib/project-types";
import { readProjectScenes } from "../../../../../lib/scene-store";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = asRecord(await request.json().catch(() => ({}))) || {};
  const chunkId = String(body.chunkId || "").trim();
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug) as StoryProject | undefined;
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  if (!chunkId) return NextResponse.json({ message: "Thiếu chunkId để chạy AI pre-check." }, { status: 400 });

  const chunk = project.chunks.find((item) => item.id === chunkId);
  if (!chunk) return NextResponse.json({ message: "Không tìm thấy chunk." }, { status: 404 });
  if (!chunk.outputPath) return NextResponse.json({ message: `${chunk.id} chưa có output để AI đánh giá.` }, { status: 409 });

  const payload = asRecord(await readChunkOutput(chunk));
  const rawScenes = payload && Array.isArray(payload.scenes) ? payload.scenes : [];
  if (!rawScenes.length) return NextResponse.json({ message: `${chunk.id} chưa có cảnh để AI đánh giá.` }, { status: 409 });

  try {
    const result = await evaluateChunkScenes({ project, chunk, scenes: rawScenes, useModel: true });
    const updatedPayload = {
      ...(payload || {}),
      scenes: result.scenes,
      ai_review_summary: result.summary,
    };
    const outputPath = await saveChunkOutput(slug, chunk.id, updatedPayload);
    const aiReviewCount = (await readProjectScenes(project)).filter((item) => {
      const review = item.ai_review && typeof item.ai_review === "object" && !Array.isArray(item.ai_review) ? item.ai_review as Record<string, unknown> : {};
      return String(review.status || "pending") === "needs_changes";
    }).length;
    const updatedProject = await updateData((currentData) => {
      const currentProject = currentData.projects.find((item) => item.slug === slug);
      if (!currentProject) throw new Error("PROJECT_NOT_FOUND");
      const currentChunk = currentProject.chunks.find((item) => item.id === chunk.id);
      if (currentChunk) {
        currentChunk.outputPath = outputPath;
        currentChunk.updatedAt = now();
      }
      currentProject.aiReviewCount = aiReviewCount;
      currentProject.updatedAt = now();
      currentData.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "qa",
        title: `${chunk.id} · AI pre-check hoàn tất`,
        detail: `${result.summary.passed} đạt · ${result.summary.needsChanges} cần sửa · ${result.summary.errors} lỗi AI`,
        status: result.summary.errors || result.summary.needsChanges ? "warning" : "success",
      }));
      return currentProject;
    });
    return NextResponse.json({ ok: true, chunk: updatedProject.chunks.find((item) => item.id === chunk.id), scenes: result.scenes, summary: result.summary, outputPath });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "AI pre-check thất bại.";
    return NextResponse.json({ code: "AI_REVIEW_FAILED", message }, { status: 502 });
  }
}

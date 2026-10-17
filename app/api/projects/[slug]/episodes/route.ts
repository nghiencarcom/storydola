import { NextResponse } from "next/server";
import { claimProjectChunkRun, isProjectChunkRunActive, releaseProjectChunkRun } from "../../../../lib/chunk-generation-lock";
import { claimProjectRender, releaseProjectRender } from "../../../../lib/render-lock";
import { claimProjectTts, releaseProjectTts } from "../../../../lib/tts-lock";
import { makeActivity, markRenderStale, now, readData, updateData } from "../../../../lib/server-store";
import type { ProjectChunk } from "../../../../lib/project-types";

export const runtime = "nodejs";

function busyProject(project: Awaited<ReturnType<typeof readData>>["projects"][number]) {
  return project.chunks.some((chunk) => chunk.status === "processing" || chunk.render?.status === "running" || chunk.tts?.status === "running")
    || project.render?.status === "running"
    || project.videoQueue?.status === "running"
    || project.videoQueue?.jobs.some((job) => job.status === "running");
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = await request.json().catch(() => ({}));
  const episodeCount = Number(body && typeof body === "object" && !Array.isArray(body) ? body.episodeCount : NaN);
  if (!Number.isInteger(episodeCount) || episodeCount < 1 || episodeCount > 10) {
    return NextResponse.json({ message: "Số tập cần thêm phải từ 1 đến 10." }, { status: 400 });
  }

  const snapshot = await readData();
  const existing = snapshot.projects.find((project) => project.slug === slug);
  if (!existing) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  if ((existing.scriptMode || "ai") === "manual") {
    return NextResponse.json({ code: "MANUAL_SCRIPT_CANNOT_EXTEND", message: "Project dùng kịch bản thủ công nên chưa thể tự sinh tập tiếp. Cập nhật toàn bộ kịch bản hiện có thể làm mới tiến độ của project." }, { status: 409 });
  }
  if (busyProject(existing) || isProjectChunkRunActive(slug)) {
    return NextResponse.json({ code: "PROJECT_BUSY", message: "Project đang chạy tác vụ. Hãy đợi tạo kịch bản, TTS, render hoặc queue video hoàn tất rồi thêm tập." }, { status: 409 });
  }

  // Reserve the three project pipelines during the short append operation so
  // a generation, TTS, or render request cannot start halfway through it.
  if (!claimProjectChunkRun(slug)) return NextResponse.json({ code: "PROJECT_BUSY", message: "Một tập của project đang được tạo. Hãy thử lại sau khi tác vụ hoàn tất." }, { status: 409 });
  if (!claimProjectRender(slug)) {
    releaseProjectChunkRun(slug);
    return NextResponse.json({ code: "PROJECT_BUSY", message: "Project đang ghép video. Hãy đợi render hoàn tất rồi thêm tập." }, { status: 409 });
  }
  if (!claimProjectTts(slug)) {
    releaseProjectRender(slug);
    releaseProjectChunkRun(slug);
    return NextResponse.json({ code: "PROJECT_BUSY", message: "Project đang tạo TTS. Hãy đợi tác vụ này hoàn tất rồi thêm tập." }, { status: 409 });
  }

  try {
    const updated = await updateData((data) => {
      const project = data.projects.find((item) => item.slug === slug);
      if (!project) throw new Error("PROJECT_NOT_FOUND");
      if ((project.scriptMode || "ai") === "manual") throw new Error("MANUAL_SCRIPT_CANNOT_EXTEND");
      if (busyProject(project)) throw new Error("PROJECT_BUSY");

      const timestamp = now();
      const chunkSize = Math.max(1, Math.floor(Number(project.chunkSize) || 1));
      const sceneDurationSec = Math.max(1, Number(project.sceneDurationSec) || 15);
      const lastScene = Math.max(project.totalScenes, ...project.chunks.map((chunk) => chunk.sceneEnd));
      const lastChunkNumber = Math.max(0, ...project.chunks.map((chunk) => Number(chunk.id.match(/^A(\d+)$/i)?.[1]) || 0));
      const appendedChunks: ProjectChunk[] = Array.from({ length: episodeCount }, (_, index) => {
        const sceneStart = lastScene + index * chunkSize + 1;
        return {
          id: `A${String(lastChunkNumber + index + 1).padStart(2, "0")}`,
          sceneStart,
          sceneEnd: sceneStart + chunkSize - 1,
          generatedScenes: 0,
          status: "queued",
          updatedAt: timestamp,
        };
      });
      const addedScenes = episodeCount * chunkSize;
      const previousEpisodeCount = project.chunks.length;
      project.chunks.push(...appendedChunks);
      project.totalScenes = lastScene + addedScenes;
      project.totalChunks = project.chunks.length;
      project.durationSeconds = Number(project.durationSeconds || project.durationMinutes * 60) + addedScenes * sceneDurationSec;
      project.durationMinutes = Number((project.durationSeconds / 60).toFixed(3));
      project.continuityQa = undefined;
      if (project.publishingPackage?.series) {
        project.publishingPackage = { ...project.publishingPackage, series: { ...project.publishingPackage.series, stale: true } };
      }
      project.render = markRenderStale(project.render);
      project.status = "processing";
      project.updatedAt = timestamp;
      data.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "project",
        title: `Đã thêm ${episodeCount} tập mới`,
        detail: `Tập ${String(previousEpisodeCount + 1).padStart(2, "0")}–${String(previousEpisodeCount + episodeCount).padStart(2, "0")} · ${addedScenes} cảnh · giữ nguyên các tập đã có`,
        status: "success",
      }));
      return project;
    });
    return NextResponse.json({ ok: true, project: updated, chunks: updated.chunks.slice(-episodeCount) });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "EPISODE_APPEND_FAILED";
    if (code === "PROJECT_NOT_FOUND") return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
    if (code === "MANUAL_SCRIPT_CANNOT_EXTEND") return NextResponse.json({ code, message: "Project dùng kịch bản thủ công nên chưa thể tự sinh tập tiếp. Cập nhật toàn bộ kịch bản hiện có thể làm mới tiến độ của project." }, { status: 409 });
    if (code === "PROJECT_BUSY") return NextResponse.json({ code, message: "Project vừa bắt đầu một tác vụ khác. Hãy đợi tác vụ hoàn tất rồi thêm tập." }, { status: 409 });
    return NextResponse.json({ message: "Không thể thêm tập mới vào project." }, { status: 500 });
  } finally {
    releaseProjectTts(slug);
    releaseProjectRender(slug);
    releaseProjectChunkRun(slug);
  }
}

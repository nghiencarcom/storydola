import { NextResponse } from "next/server";
import { getProviderConfig } from "../../lib/script-provider";
import { makeActivity, readData, updateData } from "../../lib/server-store";
import type { WorkspacePayload } from "../../lib/project-types";
import { getCurrentUserId } from "../../lib/auth-server";
import { isRecoverableSeedancePendingJob, startSceneMediaQueue } from "../../lib/scene-media-queue";
import { isProjectChunkRunActive } from "../../lib/chunk-generation-lock";
import { isVideoQueueJobActive, recoverInterruptedVideoQueue } from "../../lib/video-queue-runtime";
import { createProjectResponse } from "../../lib/project-creation";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getCurrentUserId();
  let data = await readData();
  const needsRecovery = data.projects.some((project) =>
    project.chunks.some((chunk) => chunk.status === "processing") && !isProjectChunkRunActive(project.slug)
    || project.videoQueue?.jobs.some((job) => job.status === "running" && !isVideoQueueJobActive(job.id)),
  );
  if (needsRecovery) {
    await updateData((current) => {
      for (const project of current.projects) {
        if (!isProjectChunkRunActive(project.slug)) {
          const interruptedChunks = project.chunks.filter((chunk) => chunk.status === "processing");
          for (const chunk of interruptedChunks) {
            chunk.status = "failed";
            chunk.error = "Máy chủ đã khởi động lại khi đang viết kịch bản. Job không có task ID để tiếp tục poll; hãy bấm Thử lại.";
            chunk.updatedAt = new Date().toISOString();
            current.activities.unshift(makeActivity({ projectSlug: project.slug, kind: "chunk", title: `${chunk.id} bị gián đoạn sau khi máy chủ khởi động lại`, detail: "Job viết kịch bản đã chuyển sang lỗi để có thể thử lại an toàn.", status: "warning" }));
          }
          if (interruptedChunks.length) {
            project.status = "failed";
            project.updatedAt = new Date().toISOString();
          }
        }
        const queue = project.videoQueue;
        if (queue) {
          const recovered = recoverInterruptedVideoQueue(queue, new Date().toISOString());
          if (recovered) {
            project.updatedAt = new Date().toISOString();
            current.activities.unshift(makeActivity({ projectSlug: project.slug, kind: "chunk", title: "Đã khôi phục queue video sau khi máy chủ khởi động lại", detail: `${recovered} job được phục hồi hoặc đánh dấu cần retry.`, status: "warning" }));
          }
        }
      }
    });
    data = await readData();
  }
  for (const project of data.projects) {
    if (project.sceneMediaJobs?.some((job) => job.status === "queued" || job.status === "running" || isRecoverableSeedancePendingJob(job))) {
      startSceneMediaQueue(userId, project.slug);
    }
  }
  const config = await getProviderConfig();
  const payload: WorkspacePayload = {
    projects: data.projects,
    activities: data.activities.slice(0, 80),
    provider: { baseUrl: config.baseUrl, primaryModel: config.primaryModel, fallbackModels: config.fallbackModels, reasoningEffort: config.reasoningEffort, serviceTier: config.serviceTier, standard: config.standard, keyConfigured: config.keyConfigured },
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const body = (await request.clone().json().catch(() => ({}))) as { presetId?: unknown };
  if (body.presetId === undefined || body.presetId === null || body.presetId === "") {
    return NextResponse.json({ message: "Chưa xác định loại dự án. Hãy chọn AI Drama, AI Story hoặc Audio Story trước khi tạo." }, { status: 400 });
  }
  if (body.presetId !== "ai-story") {
    return NextResponse.json({ message: "Hãy tạo AI Drama hoặc Audio Story từ luồng tạo riêng để không đổi nhầm loại dự án." }, { status: 400 });
  }
  return createProjectResponse(request, "ai-story");
}

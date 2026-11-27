import { NextResponse } from "next/server";
import type { VideoQueueState } from "../../../../../lib/project-types";
import { deleteHiggsfieldSessionToken } from "../../../../../lib/higgsfield-session-store";
import { deleteProviderSessionToken } from "../../../../../lib/provider-session-store";
import { abortVideoQueueJob } from "../../../../../lib/video-queue-runtime";
import { getProjectOrThrow, makeActivity, now, updateData } from "../../../../../lib/server-store";

export const runtime = "nodejs";

function emptyQueue(): VideoQueueState {
  return { status: "idle", concurrency: 20, jobs: [], updatedAt: now() };
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const userId = request.headers.get("x-storyai-user-id")?.trim() || "";
  const body = await request.json().catch(() => ({})) as { action?: string };
  const action = body.action;
  if (!["pause", "resume", "retry_failed", "cancel"].includes(String(action))) {
    return NextResponse.json({ message: "Action không hợp lệ." }, { status: 400 });
  }
  const result = await updateData((data) => {
    const project = getProjectOrThrow(data, slug);
    const queue = project.videoQueue || emptyQueue();
    const cancelledJobs: Array<{ id: string; provider?: string }> = [];
    if (action === "pause") {
      queue.status = "paused";
      for (const job of queue.jobs) if (job.status === "queued") job.status = "paused";
    } else if (action === "resume") {
      for (const job of queue.jobs) if (job.status === "paused") job.status = "queued";
      queue.status = "idle";
    } else if (action === "cancel") {
      const timestamp = now();
      for (const job of queue.jobs) {
        if (job.status === "queued" || job.status === "running" || job.status === "paused") {
          job.status = "cancelled";
          job.finishedAt = timestamp;
          job.updatedAt = timestamp;
          job.stage = undefined;
          job.error = undefined;
          cancelledJobs.push({ id: job.id, provider: job.provider });
        }
      }
      queue.status = queue.jobs.some((job) => job.status === "failed")
        ? "failed"
        : queue.jobs.some((job) => job.status === "completed")
          ? "completed"
          : "idle";
    } else {
      for (const job of queue.jobs) {
        if (job.status === "failed") {
          job.status = "queued";
          job.attempt = 0;
          if (job.retryStrategy === "new_task") {
            job.seedanceTaskId = undefined;
            job.higgsfieldJobId = undefined;
            job.maiVideoJobId = undefined;
          }
          job.stage = job.maiVideoJobId ? "flow_poll" : job.seedanceTaskId ? "seedance_poll" : job.higgsfieldJobId ? "higgsfield_poll" : undefined;
          job.error = undefined;
          job.failureStage = undefined;
          job.retryStrategy = undefined;
          job.requestId = undefined;
          job.finishedAt = undefined;
          job.updatedAt = now();
        }
      }
      queue.status = "idle";
    }
    queue.updatedAt = now();
    project.videoQueue = queue;
    project.updatedAt = now();
    data.activities.unshift(makeActivity({
      projectSlug: slug,
      kind: "chunk",
      title: action === "cancel" ? "Đã huỷ queue video AI" : `Queue video ${action}`,
      detail: action === "cancel"
        ? `Đã huỷ ${cancelledJobs.length} job tạo video`
        : `${queue.jobs.filter((job) => job.status === "queued").length} job đang chờ`,
      status: action === "cancel" ? "warning" : "info",
    }));
    return { project, queue, cancelledJobs };
  });
  if (action === "cancel") {
    for (const job of result.cancelledJobs) {
      abortVideoQueueJob(job.id, new Error("VIDEO_QUEUE_JOB_CANCELLED"));
      if (userId && job.provider === "higgsfield") {
        await deleteHiggsfieldSessionToken(userId, job.id).catch(() => undefined);
      }
      if (userId && (job.provider === "muse" || job.provider === "flow")) {
        await deleteProviderSessionToken(userId, job.id).catch(() => undefined);
      }
    }
  }
  return NextResponse.json({ ok: true, project: result.project, queue: result.queue, cancelledCount: result.cancelledJobs.length });
}

import { NextResponse } from "next/server";
import type { VideoQueueState } from "../../../../../lib/project-types";
import { getProjectOrThrow, makeActivity, now, readData, updateData } from "../../../../../lib/server-store";

export const runtime = "nodejs";

function emptyQueue(): VideoQueueState {
  return { status: "idle", concurrency: 20, jobs: [], updatedAt: now() };
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = await request.json().catch(() => ({})) as { action?: string };
  const action = body.action;
  if (!['pause', 'resume', 'retry_failed'].includes(String(action))) return NextResponse.json({ message: "Action không hợp lệ." }, { status: 400 });
  const result = await updateData((data) => {
    const project = getProjectOrThrow(data, slug);
    const queue = project.videoQueue || emptyQueue();
    if (action === "pause") {
      queue.status = "paused";
      for (const job of queue.jobs) if (job.status === "queued") job.status = "paused";
    } else if (action === "resume") {
      for (const job of queue.jobs) if (job.status === "paused") job.status = "queued";
      queue.status = "idle";
    } else {
      for (const job of queue.jobs) {
        if (job.status === "failed") {
          job.status = "queued";
          job.attempt = 0;
          if (job.retryStrategy === "new_task") job.seedanceTaskId = undefined;
          job.stage = job.seedanceTaskId ? "seedance_poll" : undefined;
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
    data.activities.unshift(makeActivity({ projectSlug: slug, kind: "chunk", title: `Queue video ${action}`, detail: `${queue.jobs.filter((job) => job.status === "queued").length} job đang chờ`, status: "info" }));
    return { project, queue };
  });
  return NextResponse.json({ ok: true, ...result });
}

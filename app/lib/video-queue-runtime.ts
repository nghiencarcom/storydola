import type { VideoGenerationJob, VideoQueueState } from "./project-types";

type VideoQueueRuntimeGlobal = typeof globalThis & {
  __storyAIVideoQueueActiveJobs?: Set<string>;
};

function activeJobs() {
  const runtime = globalThis as VideoQueueRuntimeGlobal;
  runtime.__storyAIVideoQueueActiveJobs ||= new Set<string>();
  return runtime.__storyAIVideoQueueActiveJobs;
}

export function claimVideoQueueJob(jobId: string) {
  const active = activeJobs();
  if (active.has(jobId)) return false;
  active.add(jobId);
  return true;
}

export function isVideoQueueJobActive(jobId: string) {
  return activeJobs().has(jobId);
}

export function releaseVideoQueueJob(jobId: string) {
  activeJobs().delete(jobId);
}

/**
 * Recover persisted queue jobs after a server restart. Seedance jobs with a
 * saved task ID can safely resume polling; requests without a provider task ID
 * are left failed so a retry is an explicit user action.
 */
export function recoverInterruptedVideoQueue(queue: VideoQueueState, timestamp: string) {
  let recovered = 0;
  for (const job of queue.jobs) {
    if (job.status !== "running" || isVideoQueueJobActive(job.id)) continue;
    const canResume = Boolean(job.seedanceTaskId && job.stage !== "seedance_create");
    job.status = canResume ? (queue.status === "paused" ? "paused" : "queued") : "failed";
    job.failureStage = job.stage;
    job.retryStrategy = canResume ? "same_task" : job.seedanceTaskId ? "new_task" : undefined;
    job.error = canResume
      ? "Máy chủ đã khởi động lại; tiếp tục poll task Seedance đã lưu."
      : "Máy chủ đã khởi động lại khi job chưa có task ID để tiếp tục. Hãy kiểm tra lịch sử nhà cung cấp trước khi retry để tránh tạo trùng.";
    job.stage = canResume ? "seedance_poll" : undefined;
    job.updatedAt = timestamp;
    if (!canResume) job.finishedAt = timestamp;
    recovered += 1;
  }

  if (queue.status !== "paused" && (recovered > 0 || queue.status === "running")) {
    if (queue.jobs.some((job) => job.status === "running")) queue.status = "running";
    else if (queue.jobs.some((job) => job.status === "queued")) queue.status = "running";
    else if (queue.jobs.some((job) => job.status === "failed")) queue.status = "failed";
    else queue.status = "completed";
  }

  if (recovered > 0) queue.updatedAt = timestamp;
  return recovered;
}

export function canResumeVideoQueueJob(job: VideoGenerationJob) {
  return Boolean(job.seedanceTaskId && job.stage !== "seedance_create");
}

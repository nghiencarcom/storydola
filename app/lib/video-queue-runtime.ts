import type { VideoGenerationJob, VideoQueueState } from "./project-types";

type VideoQueueRuntimeGlobal = typeof globalThis & {
  __storyAIVideoQueueActiveJobs?: Set<string>;
  __storyAIVideoQueueActiveControllers?: Map<string, AbortController>;
};

function activeControllers() {
  const runtime = globalThis as VideoQueueRuntimeGlobal;
  runtime.__storyAIVideoQueueActiveControllers ||= new Map<string, AbortController>();
  return runtime.__storyAIVideoQueueActiveControllers;
}

export function claimVideoQueueJob(jobId: string) {
  const controllers = activeControllers();
  const legacySet = (globalThis as VideoQueueRuntimeGlobal).__storyAIVideoQueueActiveJobs;
  if (controllers.has(jobId) || legacySet?.has(jobId)) return false;
  controllers.set(jobId, new AbortController());
  return true;
}

export function isVideoQueueJobActive(jobId: string) {
  const legacySet = (globalThis as VideoQueueRuntimeGlobal).__storyAIVideoQueueActiveJobs;
  return activeControllers().has(jobId) || Boolean(legacySet?.has(jobId));
}

export function getVideoQueueJobSignal(jobId: string): AbortSignal | undefined {
  return activeControllers().get(jobId)?.signal;
}

export function abortVideoQueueJob(jobId: string, reason?: unknown) {
  const controller = activeControllers().get(jobId);
  if (controller && !controller.signal.aborted) {
    controller.abort(reason);
  }
}

export function releaseVideoQueueJob(jobId: string) {
  activeControllers().delete(jobId);
  (globalThis as VideoQueueRuntimeGlobal).__storyAIVideoQueueActiveJobs?.delete(jobId);
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
    const canResume = Boolean(job.seedanceTaskId && job.stage !== "seedance_create")
      || Boolean(job.higgsfieldJobId && job.stage !== "higgsfield_create")
      || Boolean(job.maiVideoJobId && job.provider === "flow" && job.stage !== "flow_create");
    job.status = canResume ? (queue.status === "paused" ? "paused" : "queued") : "failed";
    job.failureStage = job.stage;
    job.retryStrategy = canResume ? "same_task" : job.seedanceTaskId || job.higgsfieldJobId || job.provider === "flow" ? "new_task" : undefined;
    job.error = canResume
      ? job.maiVideoJobId && job.provider === "flow" ? "Máy chủ đã khởi động lại; tiếp tục poll job Flow đã lưu." : job.higgsfieldJobId && !job.seedanceTaskId ? "Máy chủ đã khởi động lại; tiếp tục poll job Higgsfield đã lưu." : "Máy chủ đã khởi động lại; tiếp tục poll task Seedance đã lưu."
      : "Máy chủ đã khởi động lại khi job chưa có task ID để tiếp tục. Hãy kiểm tra lịch sử nhà cung cấp trước khi retry để tránh tạo trùng.";
    job.stage = canResume ? job.maiVideoJobId && job.provider === "flow" ? "flow_poll" : job.higgsfieldJobId && !job.seedanceTaskId ? "higgsfield_poll" : "seedance_poll" : undefined;
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
  return Boolean(job.seedanceTaskId && job.stage !== "seedance_create")
    || Boolean(job.higgsfieldJobId && job.stage !== "higgsfield_create")
    || Boolean(job.maiVideoJobId && job.provider === "flow" && job.stage !== "flow_create");
}

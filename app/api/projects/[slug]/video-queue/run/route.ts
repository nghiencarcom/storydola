import { NextResponse } from "next/server";
import { generateMaiVideoVideoForScene, MediaProviderJobPendingError, SeedanceGenerationError } from "../../../../../lib/media-provider";
import type { VideoGenerationJob, VideoQueueState } from "../../../../../lib/project-types";
import { resolveMediaGenerationSettings } from "../../../../../lib/media-generation-settings";
import { isFlowStoryOnlyPreset } from "../../../../../lib/story-presets";
import { chunkForScene, previousSceneContinuityReference, readProjectScenes } from "../../../../../lib/scene-store";
import { getProjectOrThrow, makeActivity, markRenderStale, now, readChunkOutput, readData, saveChunkOutput, updateData } from "../../../../../lib/server-store";
import { seedancePublicBaseUrlErrorMessage } from "../../../../../lib/seedance-reference-links";
import { deleteHiggsfieldSessionToken, getHiggsfieldSessionToken } from "../../../../../lib/higgsfield-session-store";
import { deleteProviderSessionToken, getProviderSessionToken } from "../../../../../lib/provider-session-store";
import { canResumeVideoQueueJob, claimVideoQueueJob, isVideoQueueJobActive, releaseVideoQueueJob } from "../../../../../lib/video-queue-runtime";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function emptyQueue(): VideoQueueState {
  return { status: "idle", concurrency: 20, jobs: [], updatedAt: now() };
}

function queueSummary(queue: VideoQueueState) {
  return queue.jobs.reduce((summary, job) => {
    summary[job.status] += 1;
    return summary;
  }, { queued: 0, running: 0, completed: 0, failed: 0, paused: 0 } as Record<string, number>);
}

function nextQueueStatus(queue: VideoQueueState) {
  if (queue.status === "paused") return "paused" as const;
  if (queue.jobs.some((job) => job.status === "running")) return "running" as const;
  if (queue.jobs.some((job) => job.status === "queued")) return "idle" as const;
  if (queue.jobs.some((job) => job.status === "failed")) return "failed" as const;
  return "completed" as const;
}

function recoverStaleJobs(queue: VideoQueueState) {
  const staleAfter = Number(process.env.STORYAI_VIDEO_JOB_STALE_MS) || 45 * 60 * 1000;
  const nowMs = Date.now();
  for (const job of queue.jobs) {
    if (job.status !== "running") continue;
    if (isVideoQueueJobActive(job.id)) continue;
    const updatedMs = Date.parse(job.updatedAt);
    if (!Number.isFinite(updatedMs) || nowMs - updatedMs < staleAfter) continue;
    const uncertainSeedanceCreate = !job.seedanceTaskId && !job.maiVideoJobId && (job.stage === "seedance_create" || job.stage === "flow_create");
    const canResume = canResumeVideoQueueJob(job);
    const canRetry = !uncertainSeedanceCreate && (canResume || job.attempt < job.maxAttempts);
    job.status = canRetry ? "queued" : "failed";
    job.failureStage = job.stage;
    job.retryStrategy = job.seedanceTaskId || job.maiVideoJobId ? "same_task" : job.provider === "seedance" || job.provider === "muse" || job.provider === "flow" ? "new_task" : undefined;
    job.error = uncertainSeedanceCreate
      ? "Tiến trình dừng khi đang tạo job; chưa xác nhận được ID. Kiểm tra lịch sử nhà cung cấp trước khi gửi lại."
      : "Job được đưa về queue sau khi tiến trình trước bị gián đoạn.";
    job.stage = undefined;
    job.updatedAt = now();
    if (job.status === "failed") job.finishedAt = now();
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = await request.json().catch(() => ({})) as { limit?: number };
  const requestedConcurrency = Math.max(1, Math.min(20, Number(body.limit) || 20));
  const started = await updateData((data) => {
    const project = getProjectOrThrow(data, slug);
    const queue = project.videoQueue || emptyQueue();
    queue.concurrency = requestedConcurrency;
    if (queue.status === "paused") return { project, queue, job: undefined as VideoGenerationJob | undefined };
    recoverStaleJobs(queue);
    const activeJobs = queue.jobs.filter((item) => item.status === "running").length;
    if (activeJobs >= queue.concurrency) return { project, queue, job: undefined as VideoGenerationJob | undefined };
    const job = queue.jobs.find((item) => item.status === "queued");
    if (!job || !claimVideoQueueJob(job.id)) {
      queue.status = nextQueueStatus(queue);
      queue.updatedAt = now();
      project.videoQueue = queue;
      return { project, queue, job: undefined as VideoGenerationJob | undefined };
    }
    job.status = "running";
    job.attempt += 1;
    job.stage = job.maiVideoJobId ? "flow_poll" : job.seedanceTaskId ? "seedance_poll" : job.higgsfieldJobId ? "higgsfield_poll" : undefined;
    job.startedAt = now();
    job.updatedAt = now();
    queue.status = "running";
    queue.updatedAt = now();
    project.videoQueue = queue;
    project.updatedAt = now();
    return { project, queue, job };
  });
  if (!started.job) return NextResponse.json({ ok: true, processed: false, queue: started.queue, summary: queueSummary(started.queue) });

  const job = started.job;
  const project = started.project;
  const userId = request.headers.get("x-storyai-user-id")?.trim() || "";
  try {
    const scenes = await readProjectScenes(project);
    const scene = scenes.find((item) => item.id === job.sceneId);
    if (!scene) throw new Error("SCENE_NOT_FOUND");
    const chunk = chunkForScene(project, scene);
    if (!chunk?.outputPath) throw new Error("CHUNK_OUTPUT_NOT_FOUND");
    const sceneSettings = asRecord(scene.mediaGeneration || scene.media_generation);
    const mediaGeneration = resolveMediaGenerationSettings({
      ...project.mediaGeneration,
      ...sceneSettings,
      ...(isFlowStoryOnlyPreset(project.presetId) ? { flowReferenceMode: "ingredients" as const } : {}),
    });
    const higgsfieldAuthToken = mediaGeneration.videoProvider === "higgsfield" && userId
      ? await getHiggsfieldSessionToken(userId, job.id)
      : "";
    if (mediaGeneration.videoProvider === "higgsfield" && !higgsfieldAuthToken) throw new Error("HIGGSFIELD_SESSION_REQUIRED");
    const usesGateway = mediaGeneration.videoProvider === "muse" || mediaGeneration.videoProvider === "flow";
    const providerAuthToken = usesGateway && userId ? await getProviderSessionToken(userId, job.id) : "";
    if (usesGateway && !providerAuthToken) throw new Error("PROVIDER_SESSION_REQUIRED");
    const continuityReference = previousSceneContinuityReference(scenes, scene);
    const media = await generateMaiVideoVideoForScene({
      projectSlug: slug,
      chunkId: chunk.id,
      scene,
      projectScenes: scenes,
      characters: project.characters || [],
      locations: project.locations || [],
      sceneIndex: scene.sceneIndex,
      aspectRatio: project.aspectRatio,
      mediaGeneration,
      presetId: project.presetId,
      contentGenre: project.contentGenre,
      secondaryGenres: project.secondaryGenres,
      storySetting: project.storySetting,
      settingNotes: project.settingNotes,
      visualStyle: project.visualStyle,
      imageStyle: project.imageStyle,
      continuityReference,
      providerAuthToken,
      higgsfieldAuthToken,
      higgsfieldJobId: job.higgsfieldJobId,
      onHiggsfieldCreateStarted: async () => {
        const checkpointed = await updateData((data) => {
          const current = getProjectOrThrow(data, slug);
          const queue = current.videoQueue || emptyQueue();
          const currentJob = queue.jobs.find((item) => item.id === job.id);
          if (currentJob) {
            currentJob.stage = "higgsfield_create";
            currentJob.updatedAt = now();
          }
          queue.updatedAt = now();
          current.videoQueue = queue;
          current.updatedAt = now();
          return Boolean(currentJob);
        });
        if (!checkpointed) throw new Error("VIDEO_QUEUE_JOB_NOT_FOUND");
      },
      onHiggsfieldJobCreated: async (jobId) => {
        const checkpointed = await updateData((data) => {
          const current = getProjectOrThrow(data, slug);
          const queue = current.videoQueue || emptyQueue();
          const currentJob = queue.jobs.find((item) => item.id === job.id);
          if (currentJob) {
            currentJob.higgsfieldJobId = jobId;
            currentJob.stage = "higgsfield_poll";
            currentJob.updatedAt = now();
          }
          queue.updatedAt = now();
          current.videoQueue = queue;
          current.updatedAt = now();
          return Boolean(currentJob);
        });
        if (!checkpointed) throw new Error("VIDEO_QUEUE_JOB_NOT_FOUND");
      },
      videoSpokenLanguage: project.language,
      projectVoiceId: project.voiceId,
      projectVoiceName: project.voiceName,
      projectVoiceLanguage: project.voiceLanguage,
      maiVideoJobId: job.provider === "flow" ? job.maiVideoJobId : undefined,
      seedanceTaskId: job.seedanceTaskId,
      seedanceTaskCreatedAt: job.seedanceTaskCreatedAt || job.startedAt || job.createdAt,
      onSeedanceCreateStarted: async () => {
        const checkpointed = await updateData((data) => {
          const current = getProjectOrThrow(data, slug);
          const queue = current.videoQueue || emptyQueue();
          const currentJob = queue.jobs.find((item) => item.id === job.id);
          if (currentJob) {
            currentJob.stage = mediaGeneration.videoProvider === "flow" ? "flow_create" : "seedance_create";
            currentJob.updatedAt = now();
          }
          queue.updatedAt = now();
          current.videoQueue = queue;
          current.updatedAt = now();
          return Boolean(currentJob);
        });
        if (!checkpointed) throw new Error("VIDEO_QUEUE_JOB_NOT_FOUND");
      },
      onSeedanceTaskCreated: async (taskId, createdAt) => {
        const checkpointed = await updateData((data) => {
          const current = getProjectOrThrow(data, slug);
          const queue = current.videoQueue || emptyQueue();
          const currentJob = queue.jobs.find((item) => item.id === job.id);
          if (currentJob) {
            if (mediaGeneration.videoProvider === "flow") {
              currentJob.maiVideoJobId = taskId;
              currentJob.stage = "flow_poll";
            } else {
              currentJob.seedanceTaskId = taskId;
              currentJob.seedanceTaskCreatedAt = createdAt;
              currentJob.stage = "seedance_poll";
            }
            currentJob.updatedAt = now();
          }
          queue.updatedAt = now();
          current.videoQueue = queue;
          current.updatedAt = now();
          return Boolean(currentJob);
        });
        if (!checkpointed) throw new Error("VIDEO_QUEUE_JOB_NOT_FOUND");
      },
    });
    const payload = asRecord(await readChunkOutput(chunk));
    const rawScenes = payload && Array.isArray(payload.scenes) ? payload.scenes : [];
    const targetIndex = rawScenes.findIndex((value) => {
      const record = asRecord(value);
      return record && String(record.id || record.scene_id || "").trim() === scene.id;
    });
    if (targetIndex < 0) throw new Error("SCENE_OUTPUT_NOT_FOUND");
    const updatedScenes = rawScenes.map((value, index) => {
      if (index !== targetIndex) return value;
      const record = asRecord(value) || {};
      return {
        ...record,
        media,
        mediaFallback: false,
        review_status: "unreviewed",
        review_note: "",
        ai_review: {
          status: "pending",
          score: 0,
          summary: "Media đã thay đổi; cần chạy lại AI pre-check trước khi người dùng duyệt.",
          issues: ["Media mới chưa được AI đánh giá lại."],
          checks: {},
          createdAt: now(),
        },
      };
    });
    const ready = updatedScenes.filter((value) => {
      const media = asRecord(asRecord(value)?.media);
      return media?.kind === "video" && media.status === "ready" && media.stale !== true;
    }).length;
    const fallback = updatedScenes.filter((value) => asRecord(value)?.mediaFallback === true).length;
    const updatedPayload = {
      ...(payload || {}),
      scenes: updatedScenes,
      media_summary: { ...asRecord(payload?.media_summary), source: media.provider || "maivideo-video", requested: updatedScenes.length, ready, failed: updatedScenes.length - ready, fallback },
    };
    const outputPath = await saveChunkOutput(slug, chunk.id, updatedPayload);
    const updated = await updateData(async (data) => {
      const current = getProjectOrThrow(data, slug);
      const queue = current.videoQueue || emptyQueue();
      const affectedChunk = current.chunks.find((item) => item.id === job.chunkId);
      const currentJob = queue.jobs.find((item) => item.id === job.id);
      if (currentJob) {
        currentJob.status = "completed";
        currentJob.finishedAt = now();
        currentJob.updatedAt = now();
        currentJob.error = undefined;
        currentJob.stage = undefined;
        currentJob.failureStage = undefined;
        currentJob.retryStrategy = undefined;
        currentJob.requestId = undefined;
      }
      queue.status = nextQueueStatus(queue);
      queue.updatedAt = now();
      current.videoQueue = queue;
      if (affectedChunk) affectedChunk.render = markRenderStale(affectedChunk.render);
      current.render = markRenderStale(current.render);
      const scenesAfter = await readProjectScenes(current);
      current.reviewCount = scenesAfter.filter((item) => String(item.review_status || item.reviewStatus || "unreviewed") === "needs_changes").length;
      current.aiReviewCount = scenesAfter.filter((item) => String(asRecord(item.ai_review)?.status || "pending") === "needs_changes").length;
      current.updatedAt = now();
      data.activities.unshift(makeActivity({ projectSlug: slug, kind: "chunk", title: `${job.sceneId} đã tạo video AI trong queue`, detail: `${job.chunkId} · attempt ${job.attempt} · ${outputPath}`, status: "success" }));
      return { project: current, queue };
    });
    if (mediaGeneration.videoProvider === "higgsfield" && userId) await deleteHiggsfieldSessionToken(userId, job.id).catch(() => undefined);
    if (usesGateway && userId) await deleteProviderSessionToken(userId, job.id).catch(() => undefined);
    return NextResponse.json({ ok: true, processed: true, jobId: job.id, media, outputPath, queue: updated.queue, summary: queueSummary(updated.queue), limit: updated.queue.concurrency });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "Video queue job failed";
    const message = seedancePublicBaseUrlErrorMessage(code) || code;
    const seedanceError = cause instanceof SeedanceGenerationError ? cause : undefined;
    const higgsfieldSameTask = cause instanceof MediaProviderJobPendingError && cause.provider === "higgsfield"
      || code === "HIGGSFIELD_SESSION_REQUIRED";
    const higgsfieldTerminalFailure = job.provider === "higgsfield"
      && (/^Higgsfield job (?:error|failed|cancelled|canceled):/i.test(code)
        || /^4\d\d:/.test(code)
        || code === "HIGGSFIELD_SESSION_REQUIRED");
    const gatewayTerminalFailure = (job.provider === "muse" || job.provider === "flow") && code === "PROVIDER_SESSION_REQUIRED";
    const failed = await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      const queue = current.videoQueue || emptyQueue();
      const currentJob = queue.jobs.find((item) => item.id === job.id);
      const ambiguousCreate = Boolean(currentJob && (
        !currentJob.seedanceTaskId && !currentJob.maiVideoJobId && (currentJob.stage === "seedance_create" || currentJob.stage === "flow_create")
        || !currentJob.higgsfieldJobId && currentJob.stage === "higgsfield_create"
      ));
      const retryable = Boolean(currentJob
        && !seedancePublicBaseUrlErrorMessage(code)
        && !higgsfieldTerminalFailure
        && !gatewayTerminalFailure
        && currentJob.attempt < currentJob.maxAttempts
        && (seedanceError ? seedanceError.automaticRetry : !ambiguousCreate));
      if (currentJob) {
        if (seedanceError?.taskId) {
          if (job.provider === "flow") currentJob.maiVideoJobId = seedanceError.taskId;
          else currentJob.seedanceTaskId = seedanceError.taskId;
        }
        if (cause instanceof MediaProviderJobPendingError && cause.provider === "higgsfield") currentJob.higgsfieldJobId = cause.providerJobId;
        if (cause instanceof MediaProviderJobPendingError && cause.provider === "flow-video") currentJob.maiVideoJobId = cause.providerJobId;
        currentJob.status = retryable ? "queued" : "failed";
        currentJob.error = message;
        currentJob.finishedAt = retryable ? undefined : now();
        currentJob.updatedAt = now();
        currentJob.failureStage = seedanceError?.stage
          ? job.provider === "flow" && seedanceError.stage.startsWith("seedance_") ? seedanceError.stage.replace("seedance_", "flow_") as VideoGenerationJob["failureStage"] : seedanceError.stage
          : currentJob.stage;
        currentJob.retryStrategy = seedanceError?.retryStrategy
        || (higgsfieldSameTask || currentJob.seedanceTaskId || currentJob.maiVideoJobId || currentJob.provider !== "higgsfield" && currentJob.higgsfieldJobId ? "same_task" : currentJob.provider === "seedance" || currentJob.provider === "muse" || currentJob.provider === "flow" || currentJob.provider === "higgsfield" ? "new_task" : undefined);
        currentJob.requestId = seedanceError?.requestId;
        currentJob.stage = undefined;
      }
      queue.lastError = message;
      queue.status = nextQueueStatus(queue);
      queue.updatedAt = now();
      current.videoQueue = queue;
      current.updatedAt = now();
      data.activities.unshift(makeActivity({ projectSlug: slug, kind: "chunk", title: `${job.sceneId} queue ${retryable ? "sẽ retry" : "thất bại"}`, detail: `attempt ${job.attempt}/${job.maxAttempts} · ${message}`, status: retryable ? "warning" : "error" }));
      return { queue, retryable };
    });
    if (!failed.retryable && job.provider === "higgsfield" && userId) await deleteHiggsfieldSessionToken(userId, job.id).catch(() => undefined);
    if (!failed.retryable && (job.provider === "muse" || job.provider === "flow") && userId) await deleteProviderSessionToken(userId, job.id).catch(() => undefined);
    return NextResponse.json({ ok: false, processed: true, jobId: job.id, retryQueued: failed.retryable, code, message, queue: failed.queue, summary: queueSummary(failed.queue) });
  } finally {
    releaseVideoQueueJob(job.id);
  }
}

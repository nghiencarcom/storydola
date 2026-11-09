import { randomUUID } from "node:crypto";
import type { SceneMediaJob, SceneMediaJobStatus, SceneMediaAsset, StoryProject } from "./project-types";
import { generateMaiVideoImageForScene, generateMaiVideoVideoForScene, isSeedancePendingStatusMessage, MediaProviderJobPendingError, SeedanceGenerationError } from "./media-provider";
import { isFlowImageModel, isMuseImageModel, resolveMediaGenerationSettings, shouldUseVideoLocationReference } from "./media-generation-settings";
import { isFlowStoryOnlyPreset } from "./story-presets";
import { deleteHiggsfieldSessionToken, getHiggsfieldSessionToken } from "./higgsfield-session-store";
import { deleteProviderSessionToken, getProviderSessionToken } from "./provider-session-store";
import { chunkForScene, previousSceneContinuityReference, readProjectScenes, sceneReferenceImage } from "./scene-store";
import { saveGeneratedSceneMedia } from "./scene-media-output";
import { seedancePublicBaseUrlErrorMessage, seedancePublicBaseUrlIssue } from "./seedance-reference-links";
import { makeActivity, now, readDataForUser, updateDataForUser } from "./server-store";
import { sceneReferenceCharacterIds, sceneReferenceLocationId } from "./scene-reference-assignments";

const CONCURRENCY = 20;
export const INTERRUPTED_PROVIDER_JOB_LEGACY_ERROR = "Máy chủ đã khởi động lại trước khi nhận được kết quả. Bấm tạo lại để chạy job mới.";
export const INTERRUPTED_PROVIDER_JOB_ERROR = "Máy chủ đã khởi động lại trước khi ứng dụng nhận được mã tác vụ từ provider; chưa thể tự kiểm tra trạng thái job này.";
type SceneMediaQueueEntry = {
  userId: string;
  slug: string;
  ready: boolean;
  lastClaimedAt: number;
  revision: number;
};
type SceneMediaQueueRuntime = {
  workerId: string;
  queues: Map<string, SceneMediaQueueEntry>;
  activeJobs: Map<string, { userId: string; promise: Promise<void>; controller: AbortController }>;
  pumpingUsers: Set<string>;
  pumpAgain: Set<string>;
};
const runtimeGlobal = globalThis as typeof globalThis & { __storyAiSceneMediaQueue?: SceneMediaQueueRuntime };
const queueRuntime = runtimeGlobal.__storyAiSceneMediaQueue ||= {
  workerId: randomUUID(),
  queues: new Map<string, SceneMediaQueueEntry>(),
  activeJobs: new Map<string, { userId: string; promise: Promise<void>; controller: AbortController }>(),
  pumpingUsers: new Set<string>(),
  pumpAgain: new Set<string>(),
};
const WORKER_ID = queueRuntime.workerId;

// Keep the runtime usable when Next.js replaces this module during development.
queueRuntime.queues ||= new Map<string, SceneMediaQueueEntry>();
queueRuntime.activeJobs ||= new Map<string, { userId: string; promise: Promise<void>; controller: AbortController }>();
queueRuntime.pumpingUsers ||= new Set<string>();
queueRuntime.pumpAgain ||= new Set<string>();

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function jobById(project: StoryProject, jobId: string) {
  return project.sceneMediaJobs?.find((job) => job.id === jobId);
}

export function isRecoverableSeedancePendingJob(job: SceneMediaJob) {
  return job.status === "failed"
    && job.kind === "video"
    && (job.provider === "seedance" || job.provider === "muse")
    && job.stage === "seedance_poll"
    && Boolean(job.seedanceTaskId)
    && (isSeedancePendingStatusMessage(job.error) || Boolean(job.error?.startsWith("Muse.ai chưa trả trạng thái cuối; sẽ tiếp tục theo dõi job ")));
}

export function isRecoverableHiggsfieldPendingJob(job: SceneMediaJob) {
  return job.status === "failed"
    && job.kind === "video"
    && job.provider === "higgsfield"
    && job.stage === "higgsfield_poll"
    && Boolean(job.higgsfieldJobId)
    && Boolean(job.error?.startsWith("Higgsfield chưa trả trạng thái cuối; sẽ tiếp tục theo dõi job "));
}

export function canReattachInterruptedProviderJob(job: SceneMediaJob) {
  return job.status === "failed"
    && (job.kind === "image" && (job.provider === "maivideo-image" || job.provider === "flow-image")
      || job.kind === "video" && (job.provider === "maivideo-video" || job.provider === "seedance" || job.provider === "muse" || job.provider === "higgsfield" || job.provider === "flow"))
    && !job.maiVideoJobId
    && !job.higgsfieldJobId
    && !job.seedanceTaskId
    && (job.error === INTERRUPTED_PROVIDER_JOB_ERROR
      || job.error === INTERRUPTED_PROVIDER_JOB_LEGACY_ERROR
      || job.provider === "seedance" && Boolean(job.error?.startsWith("Seedance chưa xác nhận task ID; yêu cầu có thể đã được nhận"))
      || job.provider === "muse" && Boolean(job.error?.startsWith("Muse.ai chưa xác nhận task ID; yêu cầu có thể đã được nhận"))
      || (job.provider === "flow" || job.provider === "flow-image") && Boolean(job.error?.startsWith("Flow chưa xác nhận job ID; yêu cầu có thể đã được nhận"))
      || job.provider === "higgsfield" && Boolean(job.error?.startsWith("Higgsfield chưa xác nhận job ID; yêu cầu có thể đã được nhận"))
      || job.provider !== "seedance" && job.provider !== "muse" && job.provider !== "higgsfield" && Boolean(job.error?.startsWith("MaiVideo chưa xác nhận job ID; yêu cầu có thể đã được nhận")));
}

export function isSceneMediaJobSupersededBySavedVideo(
  job: SceneMediaJob,
  mediaValue: unknown,
  jobs: SceneMediaJob[],
) {
  if (job.kind !== "video" || (job.status !== "queued" && job.status !== "running")) return false;
  const media = record(mediaValue);
  if (media.kind !== "video" || media.status !== "ready" || media.stale === true || typeof media.localPath !== "string" || !media.localPath) return false;

  const createdAt = Date.parse(job.createdAt);
  const newerCompletedJob = jobs.some((candidate) => candidate.id !== job.id
    && candidate.sceneId === job.sceneId
    && candidate.kind === "video"
    && candidate.status === "completed"
    && Date.parse(candidate.createdAt) > createdAt);
  if (newerCompletedJob || media.generatedFromJobId === job.id) return true;
  const generatedAt = Date.parse(String(media.generatedAt || ""));
  return Number.isFinite(createdAt) && Number.isFinite(generatedAt) && generatedAt > createdAt;
}

export async function reconcileSceneMediaJobsWithSavedVideos(
  userId: string,
  slug: string,
  scenes: Array<{ id: string; media?: unknown }>,
) {
  const mediaByScene = new Map(scenes.map((scene) => [scene.id, scene.media]));
  const snapshot = await projectForUser(userId, slug);
  if (!snapshot?.sceneMediaJobs?.some((job) => isSceneMediaJobSupersededBySavedVideo(job, mediaByScene.get(job.sceneId), snapshot.sceneMediaJobs || []))) return false;
  const supersededIds = await updateDataForUser(userId, (data) => {
    const project = data.projects.find((item) => item.slug === slug);
    if (!project?.sceneMediaJobs?.length) return [] as string[];
    const jobs = project.sceneMediaJobs;
    const superseded: string[] = [];
    for (const job of jobs) {
      if (!isSceneMediaJobSupersededBySavedVideo(job, mediaByScene.get(job.sceneId), jobs)) continue;
      job.status = "completed";
      job.finishedAt = now();
      job.updatedAt = now();
      job.error = undefined;
      job.workerId = undefined;
      job.stage = undefined;
      superseded.push(job.id);
    }
    if (superseded.length) {
      project.updatedAt = now();
      data.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "chunk",
        title: "Đã đóng job video cũ cho cảnh đã có video",
        detail: `${superseded.length} job đã được đồng bộ theo video đã lưu; dừng poll cục bộ và giải phóng hàng đợi.`,
        status: "info",
      }));
    }
    return superseded;
  });
  for (const jobId of supersededIds) queueRuntime.activeJobs.get(jobId)?.controller?.abort(new Error("SCENE_MEDIA_JOB_SUPERSEDED"));
  return supersededIds.length > 0;
}

async function projectForUser(userId: string, slug: string) {
  const data = await readDataForUser(userId);
  return data.projects.find((item) => item.slug === slug);
}

async function updateJob(userId: string, slug: string, jobId: string, update: (job: SceneMediaJob) => void) {
  return updateDataForUser(userId, (data) => {
    const project = data.projects.find((item) => item.slug === slug);
    const job = project && jobById(project, jobId);
    if (!project || !job || job.status !== "running" || job.workerId !== WORKER_ID) return false;
    update(job);
    job.updatedAt = now();
    project.updatedAt = now();
    return true;
  });
}

/** Persist provider IDs independently of the worker lease. A create response is the
 * only copy of the provider ID we may ever receive, so a lease change must not
 * silently discard it before the first status poll. */
async function checkpointProviderJobId(
  userId: string,
  slug: string,
  jobId: string,
  providerId: string,
  provider: "maivideo" | "higgsfield" | "seedance" | "muse" | "flow",
  providerCreatedAt?: string,
) {
  const localWorkerStillActive = queueRuntime.activeJobs.has(jobId);
  const checkpointed = await updateDataForUser(userId, (data) => {
    const project = data.projects.find((item) => item.slug === slug);
    const job = project && jobById(project, jobId);
    if (!project || !job || job.status === "completed") return false;

    const isMaiVideoJob = job.provider === "maivideo-image" || job.provider === "maivideo-video";
    if ((provider === "maivideo" && !isMaiVideoJob) || (provider === "higgsfield" && job.provider !== "higgsfield") || (provider === "seedance" && job.provider !== "seedance") || (provider === "muse" && job.provider !== "muse") || (provider === "flow" && job.provider !== "flow" && job.provider !== "flow-image")) return false;
    const savedId = provider === "maivideo" || provider === "flow" ? job.maiVideoJobId : provider === "higgsfield" ? job.higgsfieldJobId : job.seedanceTaskId;
    if (savedId && savedId !== providerId) return false;
    const interruptedWithoutProviderId = canReattachInterruptedProviderJob(job);

    if (provider === "maivideo" || provider === "flow") job.maiVideoJobId = providerId;
    if (provider === "flow") job.stage = "flow_poll";
    else if (provider === "higgsfield") {
      job.higgsfieldJobId = providerId;
      job.stage = "higgsfield_poll";
    } else {
      job.seedanceTaskId = providerId;
      job.seedanceTaskCreatedAt ||= providerCreatedAt || job.startedAt || job.createdAt;
      job.stage = "seedance_poll";
    }

    // A response can arrive after another worker recovered the interrupted local
    // job. Restore it to this worker so the same task keeps polling immediately.
    if (job.status === "failed" && interruptedWithoutProviderId) {
      job.status = localWorkerStillActive ? "running" : "queued";
      job.error = undefined;
      job.finishedAt = undefined;
      job.workerId = localWorkerStillActive ? WORKER_ID : undefined;
    } else if (localWorkerStillActive && (job.status === "running" || job.status === "queued")) {
      job.status = "running";
      job.workerId = WORKER_ID;
      job.error = undefined;
      job.finishedAt = undefined;
    }

    job.updatedAt = now();
    project.updatedAt = now();
    return true;
  });

  if (!checkpointed) throw new Error("SCENE_MEDIA_JOB_SUPERSEDED");
  if (!localWorkerStillActive) startSceneMediaQueue(userId, slug);
}

async function recoverInterruptedJobs(userId: string, slug: string) {
  const snapshot = await projectForUser(userId, slug);
  const needsRecovery = snapshot?.sceneMediaJobs?.some((job) => isRecoverableSeedancePendingJob(job) || isRecoverableHiggsfieldPendingJob(job)
    || job.status === "running" && job.workerId !== WORKER_ID);
  if (!needsRecovery) return;

  await updateDataForUser(userId, (data) => {
    const project = data.projects.find((item) => item.slug === slug);
    if (!project) return;
    const resumedScenes: string[] = [];
    let changed = false;
    for (const job of project.sceneMediaJobs || []) {
      if (isRecoverableSeedancePendingJob(job) || isRecoverableHiggsfieldPendingJob(job)) {
        job.status = "queued";
        job.error = undefined;
        job.workerId = undefined;
        job.finishedAt = undefined;
        job.updatedAt = now();
        resumedScenes.push(job.sceneId);
        changed = true;
        continue;
      }
      if (job.status !== "running" || job.workerId === WORKER_ID) continue;
      const canResumeProviderPoll = job.kind === "video" && job.provider === "higgsfield" && Boolean(job.higgsfieldJobId) && job.stage !== "higgsfield_create"
        || job.kind === "video" && (job.provider === "seedance" || job.provider === "muse") && Boolean(job.seedanceTaskId) && job.stage !== "seedance_create"
        || Boolean(job.maiVideoJobId && (job.provider === "maivideo-image" || job.provider === "maivideo-video" || job.provider === "flow-image" || job.provider === "flow"));
      if (canResumeProviderPoll) {
        job.status = "queued";
        job.error = undefined;
        job.workerId = undefined;
        if ((job.provider === "flow" || job.provider === "flow-image") && job.maiVideoJobId) job.stage = "flow_poll";
        job.updatedAt = now();
        changed = true;
        continue;
      }
      job.status = "failed";
      job.error = INTERRUPTED_PROVIDER_JOB_ERROR;
      job.finishedAt = now();
      job.updatedAt = now();
      job.workerId = undefined;
      changed = true;
    }
    if (changed) project.updatedAt = now();
    if (resumedScenes.length) {
      data.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "chunk",
        title: "Đã tiếp tục poll task Seedance còn đang tạo",
        detail: `${[...new Set(resumedScenes)].join(", ")} · dùng lại task ID hiện có, không gửi job tạo mới.`,
        status: "warning",
      }));
    }
  });
}

async function claimNextJob(userId: string, slug: string): Promise<{ job: SceneMediaJob; project: StoryProject } | undefined> {
  return updateDataForUser(userId, (data) => {
    const project = data.projects.find((item) => item.slug === slug);
    if (!project) return undefined;
    project.sceneMediaJobs ||= [];
    if (project.sceneMediaJobs.filter((job) => job.status === "running" && job.workerId === WORKER_ID).length >= CONCURRENCY) return undefined;
    const job = project.sceneMediaJobs.find((item) => item.status === "queued");
    if (!job) return undefined;
    job.status = "running";
    job.attempt += 1;
    job.startedAt = now();
    job.updatedAt = now();
    job.workerId = WORKER_ID;
    job.finishedAt = undefined;
    job.error = undefined;
    job.stage = job.maiVideoJobId && (job.provider === "flow" || job.provider === "flow-image") ? "flow_poll" : job.seedanceTaskId ? "seedance_poll" : undefined;
    project.updatedAt = now();
    return { job: structuredClone(job), project: structuredClone(project) };
  });
}

function userFacingError(value: unknown) {
  const code = value instanceof Error ? value.message : String(value || "");
  if (code === "MAIVIDEO_IMAGE_API_KEY_REQUIRED") return "Hãy thêm API key tạo ảnh MaiVideo trong Cài đặt.";
  if (code === "MAIVIDEO_VIDEO_API_KEY_REQUIRED" || code === "MAIVIDEO_API_KEY_REQUIRED") return "Hãy thêm API key tạo video MaiVideo trong Cài đặt.";
  if (code === "MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED") return "Máy chủ chưa cấu hình khóa mã hóa API key MaiVideo.";
  if (code === "SEEDANCE_ACCOUNT_REQUIRED") return "Chưa kết nối API key Seedance / MaiVideo. Hãy thêm tài khoản trong Cài đặt.";
  if (code === "SEEDANCE_ACCOUNT_NOT_FOUND") return "Tài khoản API đã chọn không còn tồn tại. Hãy chọn lại tài khoản.";
  if (code === "SEEDANCE_ENCRYPTION_KEY_REQUIRED") return "Máy chủ chưa cấu hình khóa mã hóa tài khoản API.";
  if (code === "HIGGSFIELD_SESSION_REQUIRED") return "Phiên đăng nhập MaiVideo đã hết hạn. Hãy đăng nhập lại trước khi tạo video Higgsfield.";
  if (code === "HIGGSFIELD_SESSION_ENCRYPTION_KEY_REQUIRED") return "Máy chủ chưa cấu hình khóa mã hóa để tiếp tục job Higgsfield sau khi khởi động lại.";
  if (code === "PROVIDER_SESSION_REQUIRED") return "Phiên đăng nhập MaiVideo đã hết hạn. Hãy đăng nhập lại trước khi tạo ảnh/video Muse.ai hoặc Flow.";
  if (code === "PROVIDER_SESSION_ENCRYPTION_KEY_REQUIRED") return "Máy chủ chưa cấu hình khóa mã hóa để tiếp tục job Muse.ai/Flow sau khi khởi động lại.";
  if (value instanceof SeedanceGenerationError && value.stage === "seedance_create" && (value.message.includes("Hết thời gian kết nối") || [502, 503, 504].includes(value.statusCode || 0))) {
    return `${value.providerLabel} chưa xác nhận task ID; yêu cầu có thể đã được nhận. Hãy kiểm tra lịch sử ${value.providerLabel} trước khi gửi lại để tránh tạo trùng.`;
  }
  const publicBaseUrlMessage = seedancePublicBaseUrlErrorMessage(code);
  if (publicBaseUrlMessage) return publicBaseUrlMessage;
  if (code === "AI_DRAMA_SCENE_DURATION_UNSUPPORTED") return "Model video này không hỗ trợ đúng thời lượng 5, 10 hoặc 15 giây của cảnh AI Drama. Hãy chọn model khác.";
  if (value instanceof SeedanceGenerationError) return value.message;
  return code || "Không tạo được media cho cảnh.";
}

async function runJob(userId: string, slug: string, job: SceneMediaJob, signal: AbortSignal) {
  try {
    const project = await projectForUser(userId, slug);
    if (!project) throw new Error("Không tìm thấy project.");
    const scenes = await readProjectScenes(project);
    const scene = scenes.find((item) => item.id === job.sceneId);
    if (!scene) throw new Error(`Không tìm thấy cảnh ${job.sceneId}.`);
    const chunk = chunkForScene(project, scene);
    if (!chunk?.outputPath) throw new Error(`Chunk của cảnh ${job.sceneId} chưa có output.`);
    const settings = resolveMediaGenerationSettings({
      ...project.mediaGeneration,
      ...record(scene.mediaGeneration || scene.media_generation),
      ...job.mediaGeneration,
      ...(isFlowStoryOnlyPreset(project.presetId) ? { flowReferenceMode: "ingredients" as const } : {}),
    });
    const higgsfieldAuthToken = job.kind === "video" && settings.videoProvider === "higgsfield"
      ? await getHiggsfieldSessionToken(userId, job.id)
      : "";
    const usesGateway = job.kind === "image"
      ? isMuseImageModel(settings.imageModel) || isFlowImageModel(settings.imageModel)
      : settings.videoProvider === "muse" || settings.videoProvider === "flow";
    const providerAuthToken = usesGateway ? await getProviderSessionToken(userId, job.id) : "";
    if (usesGateway && !providerAuthToken) throw new Error("PROVIDER_SESSION_REQUIRED");
    if (job.kind === "video" && settings.videoProvider === "higgsfield" && !higgsfieldAuthToken) throw new Error("HIGGSFIELD_SESSION_REQUIRED");
    if (job.kind === "video" && (settings.videoProvider === "seedance" || settings.videoProvider === "muse" || settings.videoProvider === "flow")) {
      const videoReferenceCharacterIds = sceneReferenceCharacterIds(scene, "video");
      const sceneImage = sceneReferenceImage(scene);
      const hasCharacterReferenceImage = videoReferenceCharacterIds
        .some((id) => (project.characters || []).some((character) => character.id === id && Boolean(character.referenceImagePath)));
      const locationId = sceneReferenceLocationId(scene, "video");
      const hasLocationReferenceImage = Boolean((project.locations || []).find((location) => location.id === locationId)?.referenceImagePath);
      const flowFramesMode = settings.videoProvider === "flow" && settings.flowReferenceMode === "frames";
      const flowFrameEndSceneId = String(scene.flowFrameEndSceneId || scene.flow_frame_end_scene_id || "").trim();
      const flowFrameEndScene = scenes.find((item) => item.id === flowFrameEndSceneId);
      const flowFrameEndImage = flowFrameEndScene ? sceneReferenceImage(flowFrameEndScene) : undefined;
      if (flowFramesMode && (flowFrameEndSceneId === scene.id || sceneImage?.kind !== "image" || sceneImage.status !== "ready" || sceneImage.stale === true || flowFrameEndImage?.kind !== "image" || flowFrameEndImage.status !== "ready" || flowFrameEndImage.stale === true)) {
        throw new Error(`Flow Frames cần ảnh khung đầu và ảnh khung cuối sẵn sàng cho ${scene.id}.`);
      }
      const needsReference = flowFramesMode || Boolean(settings.videoUseSceneImageReference && sceneImage)
        || Boolean(settings.videoUseCharacterReferences && hasCharacterReferenceImage)
        || Boolean(shouldUseVideoLocationReference(settings, project.presetId === "ai-drama") && hasLocationReferenceImage)
        || Boolean(previousSceneContinuityReference(scenes, scene));
      if (!flowFramesMode && settings.videoUseSceneImageReference && sceneImage?.status !== "ready") throw new Error("Hãy tạo và kiểm tra ảnh cảnh trước khi tạo video.");
      const publicBaseUrlIssue = needsReference ? seedancePublicBaseUrlIssue() : undefined;
      if (publicBaseUrlIssue) throw new Error(publicBaseUrlIssue);
    }
    const continuityReference = previousSceneContinuityReference(scenes, scene);
    let media: SceneMediaAsset;
    if (job.kind === "image") {
      media = await generateMaiVideoImageForScene({
        projectSlug: slug,
        chunkId: chunk.id,
        scene,
        characters: project.characters || [],
        locations: project.locations || [],
        sceneIndex: scene.sceneIndex,
        aspectRatio: project.aspectRatio,
        mediaGeneration: settings,
        providerAuthToken,
        presetId: project.presetId,
        contentGenre: project.contentGenre,
        secondaryGenres: project.secondaryGenres,
        storySetting: project.storySetting,
        settingNotes: project.settingNotes,
        visualStyle: project.visualStyle,
        imageStyle: project.imageStyle,
        continuityReference,
        userId,
        maiVideoJobId: job.maiVideoJobId,
        onMaiVideoJobCreated: async (jobId) => {
          await checkpointProviderJobId(userId, slug, job.id, jobId, isFlowImageModel(settings.imageModel) ? "flow" : "maivideo");
        },
      });
    } else {
      media = await generateMaiVideoVideoForScene({
        projectSlug: slug,
        chunkId: chunk.id,
        scene,
        projectScenes: scenes,
        characters: project.characters || [],
        locations: project.locations || [],
        sceneIndex: scene.sceneIndex,
        aspectRatio: project.aspectRatio,
        mediaGeneration: settings,
        providerAuthToken,
        presetId: project.presetId,
        contentGenre: project.contentGenre,
        secondaryGenres: project.secondaryGenres,
        storySetting: project.storySetting,
        settingNotes: project.settingNotes,
        visualStyle: project.visualStyle,
        imageStyle: project.imageStyle,
        continuityReference,
        videoSpokenLanguage: project.language,
        projectVoiceId: project.voiceId,
        projectVoiceName: project.voiceName,
        projectVoiceLanguage: project.voiceLanguage,
        maiVideoJobId: job.maiVideoJobId,
        onMaiVideoJobCreated: async (jobId) => {
          await checkpointProviderJobId(userId, slug, job.id, jobId, settings.videoProvider === "flow" ? "flow" : "maivideo");
        },
        higgsfieldAuthToken,
        higgsfieldJobId: job.higgsfieldJobId,
        onHiggsfieldCreateStarted: async () => {
          if (!await updateJob(userId, slug, job.id, (current) => { current.stage = "higgsfield_create"; })) throw new Error("SCENE_MEDIA_JOB_SUPERSEDED");
        },
        onHiggsfieldJobCreated: async (providerJobId) => {
          await checkpointProviderJobId(userId, slug, job.id, providerJobId, "higgsfield");
        },
        onPromptComposed: async (prompt) => {
          if (!await updateJob(userId, slug, job.id, (current) => { current.submittedPrompt = prompt; })) throw new Error("SCENE_MEDIA_JOB_SUPERSEDED");
        },
        seedanceTaskId: job.seedanceTaskId,
        seedanceTaskCreatedAt: job.seedanceTaskCreatedAt || job.startedAt || job.createdAt,
        signal,
        userId,
        onSeedanceCreateStarted: async () => {
          if (!await updateJob(userId, slug, job.id, (current) => { current.stage = settings.videoProvider === "flow" ? "flow_create" : "seedance_create"; })) throw new Error("SCENE_MEDIA_JOB_SUPERSEDED");
        },
        onSeedanceTaskCreated: async (taskId, createdAt) => {
          await checkpointProviderJobId(userId, slug, job.id, taskId, settings.videoProvider === "muse" ? "muse" : settings.videoProvider === "flow" ? "flow" : "seedance", createdAt);
        },
      });
    }
    if (signal.aborted) return;
    const saved = await saveGeneratedSceneMedia({ projectSlug: slug, sceneId: job.sceneId, media, mediaGeneration: settings, userId, jobId: job.id, jobCreatedAt: job.createdAt });
    if (signal.aborted) return;
    if (settings.videoProvider === "higgsfield") await deleteHiggsfieldSessionToken(userId, job.id).catch(() => undefined);
    if (usesGateway) await deleteProviderSessionToken(userId, job.id).catch(() => undefined);
    const completed = await updateJob(userId, slug, job.id, (current) => {
      current.status = "completed";
      current.finishedAt = now();
      current.error = undefined;
      current.workerId = undefined;
      current.stage = undefined;
    });
    if (!completed || saved.superseded) return;
    await updateDataForUser(userId, (data) => {
      data.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "chunk",
        title: `${job.sceneId} đã tạo ${job.kind === "image" ? "ảnh" : "video"} AI`,
        detail: `${job.chunkId} · ${media.model || media.provider}${media.quality ? ` · ${media.quality}` : ""}`,
        status: "success",
      }));
    });
  } catch (cause) {
    if (signal.aborted) return;
    const message = userFacingError(cause);
    const pendingProviderId = cause instanceof MediaProviderJobPendingError
      ? cause.providerJobId
      : cause instanceof SeedanceGenerationError && (cause.stage === "seedance_poll" || cause.stage === "seedance_download" || cause.stage === "flow_poll" || cause.stage === "flow_download") && cause.retryStrategy === "same_task"
        ? cause.taskId
        : undefined;
    if (pendingProviderId) {
      const updated = await updateJob(userId, slug, job.id, (current) => {
        current.status = "queued";
        current.finishedAt = undefined;
        current.error = message;
        current.workerId = undefined;
        if (cause instanceof MediaProviderJobPendingError && (cause.provider === "maivideo" || cause.provider === "muse-image" || cause.provider === "flow-image" || cause.provider === "flow-video")) {
          current.maiVideoJobId = pendingProviderId;
          if (cause.provider === "flow-image" || cause.provider === "flow-video") current.stage = "flow_poll";
        }
        if (cause instanceof SeedanceGenerationError && pendingProviderId && (job.provider === "flow" || job.provider === "flow-image")) {
          current.maiVideoJobId = pendingProviderId;
          current.stage = "flow_poll";
        }
        if (cause instanceof MediaProviderJobPendingError && cause.provider === "higgsfield") {
          current.higgsfieldJobId = pendingProviderId;
          current.stage = "higgsfield_poll";
        }
        if (cause instanceof SeedanceGenerationError && job.provider !== "flow" && job.provider !== "flow-image" || cause instanceof MediaProviderJobPendingError && (cause.provider === "seedance" || cause.provider === "muse")) {
          current.seedanceTaskId = cause instanceof SeedanceGenerationError ? cause.taskId || current.seedanceTaskId : pendingProviderId;
          current.seedanceTaskCreatedAt ||= current.startedAt || current.createdAt;
          current.stage = "seedance_poll";
        }
      }).catch(() => undefined);
      if (!updated) return;
      await updateDataForUser(userId, (data) => {
        data.activities.unshift(makeActivity({ projectSlug: slug, kind: "chunk", title: `${job.sceneId} vẫn đang chờ kết quả ${job.kind === "image" ? "ảnh" : "video"}`, detail: "Giữ nguyên ID job và sẽ tiếp tục poll; không gửi lại yêu cầu tạo.", status: "warning" }));
      }).catch(() => undefined);
      return;
    }
    const updated = await updateJob(userId, slug, job.id, (current) => {
      current.status = "failed";
      current.finishedAt = now();
      current.error = message;
      current.workerId = undefined;
      if (cause instanceof SeedanceGenerationError) {
        const flowProvider = job.provider === "flow" || job.provider === "flow-image";
        current.stage = flowProvider && cause.stage.startsWith("seedance_") ? cause.stage.replace("seedance_", "flow_") as SceneMediaJob["stage"] : cause.stage;
        if (flowProvider) current.maiVideoJobId = cause.taskId || current.maiVideoJobId;
        else current.seedanceTaskId = cause.taskId || current.seedanceTaskId;
        if (current.seedanceTaskId) current.seedanceTaskCreatedAt ||= current.startedAt || current.createdAt;
      }
    }).catch(() => undefined);
    if (!updated) return;
    if (job.provider === "higgsfield") await deleteHiggsfieldSessionToken(userId, job.id).catch(() => undefined);
    await updateDataForUser(userId, (data) => {
      data.activities.unshift(makeActivity({ projectSlug: slug, kind: "chunk", title: `${job.sceneId} tạo ${job.kind === "image" ? "ảnh" : "video"} thất bại`, detail: message, status: "error" }));
    }).catch(() => undefined);
  }
}

function queueKey(userId: string, slug: string) {
  return `${userId}:${slug}`;
}

function activeJobCount(userId: string) {
  let count = 0;
  for (const active of queueRuntime.activeJobs.values()) if (active.userId === userId) count += 1;
  return count;
}

function requestUserQueuePump(userId: string) {
  if (queueRuntime.pumpingUsers.has(userId)) {
    queueRuntime.pumpAgain.add(userId);
    return;
  }
  void pumpUserQueue(userId).catch(() => undefined);
}

async function pumpUserQueue(userId: string) {
  if (queueRuntime.pumpingUsers.has(userId)) {
    queueRuntime.pumpAgain.add(userId);
    return;
  }
  queueRuntime.pumpingUsers.add(userId);
  try {
    while (activeJobCount(userId) < CONCURRENCY) {
      const candidates = Array.from(queueRuntime.queues.entries())
        .filter(([, entry]) => entry.userId === userId && entry.ready)
        .sort((left, right) => left[1].lastClaimedAt - right[1].lastClaimedAt);
      if (!candidates.length) break;

      let claimedNext = false;
      for (const [key, entry] of candidates) {
        const revision = entry.revision;
        const claimed = await claimNextJob(entry.userId, entry.slug);
        if (!claimed) {
          if (queueRuntime.queues.get(key) === entry && entry.revision === revision) queueRuntime.queues.delete(key);
          continue;
        }

        entry.lastClaimedAt = Date.now();
        const controller = new AbortController();
        const task = runJob(entry.userId, entry.slug, claimed.job, controller.signal);
        queueRuntime.activeJobs.set(claimed.job.id, { userId, promise: task, controller });
        void task.finally(() => {
          queueRuntime.activeJobs.delete(claimed.job.id);
          requestUserQueuePump(userId);
        }).catch(() => undefined);
        claimedNext = true;
        break;
      }
      if (!claimedNext) break;
    }
  } finally {
    queueRuntime.pumpingUsers.delete(userId);
    if (queueRuntime.pumpAgain.delete(userId)) requestUserQueuePump(userId);
  }
}

export function startSceneMediaQueue(userId: string, slug: string) {
  const key = queueKey(userId, slug);
  let entry = queueRuntime.queues.get(key);
  if (!entry) {
    entry = { userId, slug, ready: false, lastClaimedAt: 0, revision: 0 };
    queueRuntime.queues.set(key, entry);
    void recoverInterruptedJobs(userId, slug).catch(() => undefined).finally(() => {
      const current = queueRuntime.queues.get(key);
      if (current && current === entry) current.ready = true;
      requestUserQueuePump(userId);
    });
    entry.revision += 1;
    return;
  }
  entry.revision += 1;
  if (entry.ready) {
    void recoverInterruptedJobs(userId, slug).catch(() => undefined).finally(() => requestUserQueuePump(userId));
  }
}

export function createSceneMediaJob(input: {
  sceneId: string;
  chunkId: string;
  sceneIndex: number;
  kind: "image" | "video";
  settings: Partial<import("./project-types").MediaGenerationSettings>;
}): SceneMediaJob {
  return {
    id: `mjob-${randomUUID()}`,
    sceneId: input.sceneId,
    chunkId: input.chunkId,
    sceneIndex: input.sceneIndex,
    kind: input.kind,
    status: "queued" as SceneMediaJobStatus,
    attempt: 0,
    maxAttempts: 3,
    createdAt: now(),
    updatedAt: now(),
    provider: input.kind === "image" ? isFlowImageModel(input.settings.imageModel) ? "flow-image" : "maivideo-image" : input.settings.videoProvider === "higgsfield" || input.settings.videoProvider === "seedance" || input.settings.videoProvider === "muse" || input.settings.videoProvider === "flow" ? input.settings.videoProvider : "maivideo-video",
    mediaGeneration: input.settings,
  };
}

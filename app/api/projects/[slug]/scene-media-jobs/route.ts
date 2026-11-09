import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { isFlowImageModel, isMuseImageModel, resolveMediaGenerationSettings } from "../../../../lib/media-generation-settings";
import { isFlowStoryOnlyPreset } from "../../../../lib/story-presets";
import { readMaiVideoAuthCookie } from "../../../../lib/maivideo-auth-shared";
import { createSceneMediaJob, startSceneMediaQueue } from "../../../../lib/scene-media-queue";
import { getSeedanceApiKey } from "../../../../lib/seedance-accounts";
import { providerSessionEncryptionReady, saveProviderSessionToken } from "../../../../lib/provider-session-store";
import { higgsfieldSessionEncryptionReady, saveHiggsfieldSessionToken } from "../../../../lib/higgsfield-session-store";
import { chunkForScene, readProjectScenes, sceneReferenceImage } from "../../../../lib/scene-store";
import { makeActivity, now, readDataForUser, updateDataForUser } from "../../../../lib/server-store";
import type { MediaGenerationSettings, SceneMediaJob, StoryProject } from "../../../../lib/project-types";

export const runtime = "nodejs";

function userIdFromHeaders(headersValue: Headers) {
  return headersValue.get("x-storyai-user-id")?.trim() || "";
}

function settingsRecord(value: unknown): Partial<MediaGenerationSettings> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Partial<MediaGenerationSettings> : {};
}

function activeJob(project: StoryProject, sceneId: string) {
  return project.sceneMediaJobs?.find((job) => job.sceneId === sceneId && (job.status === "queued" || job.status === "running"));
}

function trimJobs(jobs: SceneMediaJob[]) {
  const active = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const finished = jobs.filter((job) => job.status === "completed" || job.status === "failed").slice(-120);
  return [...finished, ...active].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function publicJob(job: SceneMediaJob) {
  return {
    id: job.id,
    sceneId: job.sceneId,
    chunkId: job.chunkId,
    sceneIndex: job.sceneIndex,
    kind: job.kind,
    status: job.status,
    attempt: job.attempt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    provider: job.provider,
    stage: job.stage,
  };
}

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const userId = userIdFromHeaders(await headers());
  if (!userId) return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  const { slug } = await context.params;
  const data = await readDataForUser(userId);
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  return NextResponse.json({ jobs: (project.sceneMediaJobs || []).map(publicJob) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const userId = userIdFromHeaders(await headers());
  if (!userId) return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  const { slug } = await context.params;
  const body = await request.json().catch(() => ({})) as { sceneIds?: unknown; kind?: unknown; mediaGeneration?: unknown };
  const kind = body.kind === "image" || body.kind === "video" ? body.kind : "";
  const sceneIds = Array.isArray(body.sceneIds) ? [...new Set(body.sceneIds.map((id) => String(id || "").trim()).filter(Boolean))] : [];
  if (!kind || !sceneIds.length || sceneIds.length > 500) {
    return NextResponse.json({ message: "Cần chọn loại media và ít nhất một cảnh." }, { status: 400 });
  }
  const data = await readDataForUser(userId);
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const scenes = await readProjectScenes(project);
  const requestedScenes = sceneIds.map((sceneId) => scenes.find((scene) => scene.id === sceneId));
  const missing = sceneIds.filter((_, index) => !requestedScenes[index]);
  if (missing.length) return NextResponse.json({ message: `Không tìm thấy cảnh: ${missing.join(", ")}.` }, { status: 404 });
  const scenesWithoutOutput = requestedScenes.filter((scene) => scene && !chunkForScene(project, scene)?.outputPath).map((scene) => scene?.id).filter(Boolean);
  if (scenesWithoutOutput.length) return NextResponse.json({ message: `Chunk chưa có output ở ${scenesWithoutOutput.join(", ")}.` }, { status: 409 });

  const explicitSettings = settingsRecord(body.mediaGeneration);
  const requestedMediaSettings = requestedScenes.filter((scene): scene is NonNullable<typeof scene> => Boolean(scene)).map((scene) => resolveMediaGenerationSettings({
    ...project.mediaGeneration,
    ...settingsRecord(scene.mediaGeneration || scene.media_generation),
    ...explicitSettings,
    ...(isFlowStoryOnlyPreset(project.presetId) ? { flowReferenceMode: "ingredients" as const } : {}),
  }));
  if (kind === "video") {
    const missingFrames = requestedScenes.flatMap((scene, index) => {
      if (!scene || requestedMediaSettings[index]?.videoProvider !== "flow" || requestedMediaSettings[index]?.flowReferenceMode !== "frames") return [];
      const startImage = sceneReferenceImage(scene);
      const endSceneId = String(scene.flowFrameEndSceneId || scene.flow_frame_end_scene_id || "").trim();
      const endScene = scenes.find((item) => item.id === endSceneId);
      const endImage = endScene ? sceneReferenceImage(endScene) : undefined;
      return endSceneId !== scene.id && startImage?.kind === "image" && startImage.status === "ready" && startImage.stale !== true
        && endImage?.kind === "image" && endImage.status === "ready" && endImage.stale !== true
        ? []
        : [scene.id];
    });
    if (missingFrames.length) return NextResponse.json({
      code: "FLOW_FRAMES_REQUIRED",
      message: `Flow Frames cần ảnh khung đầu và ảnh khung cuối sẵn sàng cho: ${missingFrames.slice(0, 8).join(", ")}${missingFrames.length > 8 ? ` và ${missingFrames.length - 8} cảnh khác` : ""}.`,
      sceneIds: missingFrames,
    }, { status: 409 });
  }
  const higgsfieldJobsRequested = kind === "video" && requestedMediaSettings.some((settings) => settings.videoProvider === "higgsfield");
  const gatewayJobsRequested = requestedMediaSettings.some((settings) => kind === "image"
    ? isMuseImageModel(settings.imageModel) || isFlowImageModel(settings.imageModel)
    : settings.videoProvider === "muse" || settings.videoProvider === "flow");
  const seedanceApiJobsRequested = requestedMediaSettings.some((settings) => kind === "image"
    ? isMuseImageModel(settings.imageModel) || isFlowImageModel(settings.imageModel)
    : settings.videoProvider === "seedance" || settings.videoProvider === "muse" || settings.videoProvider === "flow");
  if (seedanceApiJobsRequested) {
    const accountIds = new Set(requestedMediaSettings
      .filter((settings) => kind === "image"
        ? isMuseImageModel(settings.imageModel) || isFlowImageModel(settings.imageModel)
        : settings.videoProvider === "seedance" || settings.videoProvider === "muse" || settings.videoProvider === "flow")
      .map((settings) => kind === "video" && settings.videoProvider === "seedance" ? settings.seedanceAccountId || "" : ""));
    try {
      for (const accountId of accountIds) await getSeedanceApiKey(accountId, userId);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "SEEDANCE_ACCOUNT_REQUIRED";
      const message = code === "SEEDANCE_ACCOUNT_NOT_FOUND"
        ? "Tài khoản API đã chọn không còn tồn tại. Hãy chọn lại tài khoản."
        : code === "SEEDANCE_ENCRYPTION_KEY_REQUIRED"
          ? "Máy chủ chưa cấu hình khóa mã hóa tài khoản API."
          : "Chưa kết nối API key Seedance / MaiVideo. Hãy thêm tài khoản trong Cài đặt.";
      return NextResponse.json({ code, message }, { status: 503 });
    }
  }
  const higgsfieldAuthToken = higgsfieldJobsRequested ? readMaiVideoAuthCookie(request.headers.get("cookie")) : "";
  if (higgsfieldJobsRequested && !higgsfieldAuthToken) {
    return NextResponse.json({ code: "HIGGSFIELD_SESSION_REQUIRED", message: "Hãy đăng nhập MaiVideo để dùng Seedance 2.0 · Higgsfield." }, { status: 401 });
  }
  if (higgsfieldJobsRequested && !higgsfieldSessionEncryptionReady()) {
    return NextResponse.json({ code: "HIGGSFIELD_SESSION_ENCRYPTION_KEY_REQUIRED", message: "Máy chủ chưa cấu hình khóa mã hóa để chạy và tiếp tục job Higgsfield." }, { status: 503 });
  }
  const providerAuthToken = gatewayJobsRequested ? readMaiVideoAuthCookie(request.headers.get("cookie")) : "";
  if (gatewayJobsRequested && !providerAuthToken) {
    return NextResponse.json({ code: "PROVIDER_SESSION_REQUIRED", message: "Hãy đăng nhập MaiVideo để dùng API Muse.ai hoặc Flow." }, { status: 401 });
  }
  if (gatewayJobsRequested && !providerSessionEncryptionReady()) {
    return NextResponse.json({ code: "PROVIDER_SESSION_ENCRYPTION_KEY_REQUIRED", message: "Máy chủ chưa cấu hình khóa mã hóa để chạy và tiếp tục job Muse.ai/Flow." }, { status: 503 });
  }
  let replacedLegacyVideoJobs = 0;
  let queued: SceneMediaJob[];
  try {
    queued = await updateDataForUser(userId, (workspace) => {
    const current = workspace.projects.find((item) => item.slug === slug);
    if (!current) throw new Error("PROJECT_NOT_FOUND");
    current.sceneMediaJobs ||= [];
    const created: SceneMediaJob[] = [];
    for (const scene of requestedScenes) {
      if (!scene) continue;
      const existing = activeJob(current, scene.id);
      if (existing) {
        if (existing.kind !== kind) throw new Error(`SCENE_MEDIA_JOB_ACTIVE:${scene.id}:${existing.kind}`);
        created.push(existing);
        continue;
      }
      if (kind === "video" && current.videoQueue) {
        const legacyJobsForScene = current.videoQueue.jobs.filter((job) => job.sceneId === scene.id);
        if (legacyJobsForScene.some((job) => job.status === "running")) throw new Error(`SCENE_VIDEO_QUEUE_ACTIVE:${scene.id}`);

        const pendingLegacyIds = new Set(legacyJobsForScene
          .filter((job) => job.status === "queued" || job.status === "paused")
          .map((job) => job.id));
        if (pendingLegacyIds.size) {
          current.videoQueue.jobs = current.videoQueue.jobs.filter((job) => !pendingLegacyIds.has(job.id));
          current.videoQueue.updatedAt = now();
          replacedLegacyVideoJobs += pendingLegacyIds.size;
          if (current.videoQueue.status !== "running" && current.videoQueue.status !== "paused") {
            current.videoQueue.status = current.videoQueue.jobs.some((job) => job.status === "queued")
              ? "idle"
              : current.videoQueue.jobs.some((job) => job.status === "failed")
                ? "failed"
                : current.videoQueue.jobs.some((job) => job.status === "completed")
                  ? "completed"
                  : "idle";
          }
        }
      }
      const chunk = chunkForScene(current, scene);
      if (!chunk?.outputPath) continue;
      const savedSceneSettings = scene.mediaGeneration || scene.media_generation;
      const settings = resolveMediaGenerationSettings({
        ...current.mediaGeneration,
        ...settingsRecord(savedSceneSettings),
        ...explicitSettings,
        ...(isFlowStoryOnlyPreset(current.presetId) ? { flowReferenceMode: "ingredients" as const } : {}),
      });
      const job = createSceneMediaJob({ sceneId: scene.id, chunkId: chunk.id, sceneIndex: scene.sceneIndex, kind, settings });
      current.sceneMediaJobs.push(job);
      created.push(job);
    }
    current.sceneMediaJobs = trimJobs(current.sceneMediaJobs);
      current.updatedAt = now();
      workspace.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "chunk",
        title: `Đã xếp ${kind === "image" ? "ảnh" : "video"} cảnh vào hàng đợi nền`,
        detail: `${created.length} job${replacedLegacyVideoJobs ? ` · thay ${replacedLegacyVideoJobs} job video chờ ở queue cũ` : ""}`,
        status: "info",
      }));
    return created;
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Không thể xếp media vào hàng đợi.";
    if (message.startsWith("SCENE_MEDIA_JOB_ACTIVE:")) {
      const [, sceneId, activeKind] = message.split(":");
      return NextResponse.json({ message: `${sceneId} đang chạy job ${activeKind === "image" ? "tạo ảnh" : "tạo video"}. Hãy đợi job hiện tại hoàn tất.` }, { status: 409 });
    }
    if (message.startsWith("SCENE_VIDEO_QUEUE_ACTIVE:")) {
      const [, sceneId] = message.split(":");
      return NextResponse.json({ message: `${sceneId} đang có video trong hàng đợi cũ. Hãy đợi job hiện tại hoàn tất.` }, { status: 409 });
    }
    throw cause;
  }

  if (higgsfieldJobsRequested) {
    try {
      for (const job of queued) {
        if (job.kind === "video" && job.provider === "higgsfield" && (job.status === "queued" || job.status === "running")) {
          await saveHiggsfieldSessionToken(userId, job.id, higgsfieldAuthToken);
        }
      }
    } catch {
      return NextResponse.json({ code: "HIGGSFIELD_SESSION_STORE_UNAVAILABLE", message: "Không lưu được phiên Higgsfield an toàn; hãy thử xếp job lại." }, { status: 503 });
    }
  }

  if (gatewayJobsRequested) {
    try {
      for (const job of queued) {
        if (job.status !== "queued" && job.status !== "running") continue;
        const settings = resolveMediaGenerationSettings({ ...project.mediaGeneration, ...settingsRecord(job.mediaGeneration) });
        const usesGateway = job.kind === "image"
          ? isMuseImageModel(settings.imageModel) || isFlowImageModel(settings.imageModel)
          : settings.videoProvider === "muse" || settings.videoProvider === "flow";
        if (usesGateway) await saveProviderSessionToken(userId, job.id, providerAuthToken);
      }
    } catch {
      return NextResponse.json({ code: "PROVIDER_SESSION_STORE_UNAVAILABLE", message: "Không lưu được phiên MaiVideo an toàn; hãy thử xếp job lại." }, { status: 503 });
    }
  }

  startSceneMediaQueue(userId, slug);
  return NextResponse.json({ ok: true, jobs: queued.map(publicJob), queued: queued.filter((job) => job.status === "queued").length, replacedLegacyVideoJobs }, { status: 202 });
}


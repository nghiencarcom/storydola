import { statSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { previousSceneContinuityReference, readProjectScenes, sceneReferenceImage } from "../../../../lib/scene-store";
import type { VideoGenerationJob, VideoQueueState } from "../../../../lib/project-types";
import { resolveMediaGenerationSettings, shouldUseVideoLocationReference } from "../../../../lib/media-generation-settings";
import { isFlowStoryOnlyPreset } from "../../../../lib/story-presets";
import { getSeedanceApiKey } from "../../../../lib/seedance-accounts";
import { getMaiVideoApiKey } from "../../../../lib/maivideo-api-keys";
import { readMaiVideoAuthCookie } from "../../../../lib/maivideo-auth-shared";
import { higgsfieldSessionEncryptionReady, saveHiggsfieldSessionToken } from "../../../../lib/higgsfield-session-store";
import { providerSessionEncryptionReady, saveProviderSessionToken } from "../../../../lib/provider-session-store";
import { seedancePublicBaseUrlErrorMessage, seedancePublicBaseUrlIssue } from "../../../../lib/seedance-reference-links";
import { getProjectOrThrow, makeActivity, now, readData, updateData } from "../../../../lib/server-store";
import { sceneReferenceCharacterIds, sceneReferenceLocationId } from "../../../../lib/scene-reference-assignments";

export const runtime = "nodejs";

function emptyQueue(): VideoQueueState {
  return { status: "idle", concurrency: 20, jobs: [], updatedAt: now() };
}

function mediaRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isAlreadyAiVideo(scene: Record<string, unknown>, projectSlug: string) {
  const media = mediaRecord(scene.media);
  if (media.kind !== "video" || media.status !== "ready" || media.stale === true || !["maivideo-video", "flow-video"].some((provider) => String(media.provider || "").startsWith(provider))) return false;
  const localPath = typeof media.localPath === "string" ? media.localPath.trim() : "";
  const resolved = localPath ? path.resolve(process.cwd(), localPath) : "";
  const projectRoot = path.resolve(process.cwd(), "data", "media", projectSlug);
  if (!resolved || !resolved.startsWith(`${projectRoot}${path.sep}`)) return false;
  try { return statSync(resolved).isFile(); } catch { return false; }
}

function summarize(queue: VideoQueueState) {
  return queue.jobs.reduce((summary, job) => {
    summary[job.status] += 1;
    return summary;
  }, { queued: 0, running: 0, completed: 0, failed: 0, paused: 0 } as Record<string, number>);
}

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const queue = project.videoQueue || emptyQueue();
  return NextResponse.json({ queue, summary: summarize(queue) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const snapshot = await readData();
  const project = snapshot.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as {
    sceneIds?: unknown;
    onlyMissing?: boolean;
    retryFailed?: boolean;
    regenerate?: boolean;
    concurrency?: number;
  };
  const scenes = await readProjectScenes(project);
  const requestedIds = Array.isArray(body.sceneIds) ? new Set(body.sceneIds.map((value) => String(value))) : null;
  const onlyMissing = body.onlyMissing !== false;
  const retryFailed = body.retryFailed === true;
  const regenerate = body.regenerate === true;
  const candidates = scenes.filter((scene) => {
    if (requestedIds && !requestedIds.has(scene.id)) return false;
    return !onlyMissing || !isAlreadyAiVideo(scene, project.slug);
  });
  const activeSceneMediaJobs = candidates.filter((scene) => project.sceneMediaJobs?.some((job) => job.sceneId === scene.id && (job.status === "queued" || job.status === "running")));
  if (activeSceneMediaJobs.length) {
    return NextResponse.json({
      ok: false,
      code: "SCENE_MEDIA_JOB_ACTIVE",
      message: `Đang có job media nền cho ${activeSceneMediaJobs.slice(0, 8).map((scene) => scene.id).join(", ")}. Hãy đợi hoặc bỏ các cảnh đó khỏi queue video.`,
      sceneIds: activeSceneMediaJobs.map((scene) => scene.id),
    }, { status: 409 });
  }
  if (project.presetId === "ai-drama") {
    const missingVideoPrompts = candidates.filter((scene) => !String(scene.video_prompt || scene.videoPrompt || "").trim()).map((scene) => scene.id);
    if (missingVideoPrompts.length) {
      return NextResponse.json({ ok: false, code: "VIDEO_PROMPT_REQUIRED", message: `Thiếu prompt video ở ${missingVideoPrompts.join(", ")}. Hãy bổ sung prompt trước khi xếp queue.`, sceneIds: missingVideoPrompts }, { status: 409 });
    }
  }
  const candidateSettings = candidates.map((scene) => resolveMediaGenerationSettings({
    ...project.mediaGeneration,
    ...mediaRecord(scene.mediaGeneration || scene.media_generation),
    ...(isFlowStoryOnlyPreset(project.presetId) ? { flowReferenceMode: "ingredients" as const } : {}),
  }));
  const higgsfieldJobsRequested = candidateSettings.some((settings) => settings.videoProvider === "higgsfield");
  const gatewayJobsRequested = candidateSettings.some((settings) => settings.videoProvider === "muse" || settings.videoProvider === "flow");
  const higgsfieldAuthToken = higgsfieldJobsRequested ? readMaiVideoAuthCookie(request.headers.get("cookie")) : "";
  const higgsfieldOwnerId = request.headers.get("x-storyai-user-id")?.trim() || "";
  if (higgsfieldJobsRequested && (!higgsfieldAuthToken || !higgsfieldOwnerId)) {
    return NextResponse.json({ ok: false, code: "HIGGSFIELD_SESSION_REQUIRED", message: "Hãy đăng nhập MaiVideo để dùng Seedance 2.0 · Higgsfield." }, { status: 401 });
  }
  if (higgsfieldJobsRequested && !higgsfieldSessionEncryptionReady()) {
    return NextResponse.json({ ok: false, code: "HIGGSFIELD_SESSION_ENCRYPTION_KEY_REQUIRED", message: "Máy chủ chưa cấu hình khóa mã hóa để chạy và tiếp tục job Higgsfield." }, { status: 503 });
  }
  const providerAuthToken = gatewayJobsRequested ? readMaiVideoAuthCookie(request.headers.get("cookie")) : "";
  const providerOwnerId = request.headers.get("x-storyai-user-id")?.trim() || "";
  if (gatewayJobsRequested && (!providerAuthToken || !providerOwnerId)) {
    return NextResponse.json({ ok: false, code: "PROVIDER_SESSION_REQUIRED", message: "Hãy đăng nhập MaiVideo để dùng API video Muse.ai hoặc Flow." }, { status: 401 });
  }
  if (gatewayJobsRequested && !providerSessionEncryptionReady()) {
    return NextResponse.json({ ok: false, code: "PROVIDER_SESSION_ENCRYPTION_KEY_REQUIRED", message: "Máy chủ chưa cấu hình khóa mã hóa để chạy và tiếp tục job Muse.ai/Flow." }, { status: 503 });
  }
  const missingSceneImages = candidates.filter((scene) => {
    const settings = resolveMediaGenerationSettings({
      ...project.mediaGeneration,
      ...mediaRecord(scene.mediaGeneration || scene.media_generation),
      ...(isFlowStoryOnlyPreset(project.presetId) ? { flowReferenceMode: "ingredients" as const } : {}),
    });
    if (!settings.videoUseSceneImageReference) return false;
    const image = sceneReferenceImage(scene);
    return !image || image.status !== "ready";
  });
  if (missingSceneImages.length) {
    return NextResponse.json({
      ok: false,
      code: "SCENE_IMAGE_REQUIRED",
      message: `Tạo và kiểm tra ảnh cảnh trước khi xếp video: ${missingSceneImages.slice(0, 8).map((scene) => scene.id).join(", ")}${missingSceneImages.length > 8 ? ` và ${missingSceneImages.length - 8} cảnh khác` : ""}.`,
      sceneIds: missingSceneImages.map((scene) => scene.id),
    }, { status: 409 });
  }
  const missingFlowFrames = candidates.filter((scene, index) => {
    const settings = candidateSettings[index];
    if (settings.videoProvider !== "flow" || settings.flowReferenceMode !== "frames") return false;
    const startImage = sceneReferenceImage(scene);
    const endSceneId = String(scene.flowFrameEndSceneId || scene.flow_frame_end_scene_id || "").trim();
    const endScene = scenes.find((item) => item.id === endSceneId);
    const endImage = endScene ? sceneReferenceImage(endScene) : undefined;
    return !(endSceneId !== scene.id && startImage?.kind === "image" && startImage.status === "ready" && startImage.stale !== true
      && endImage?.kind === "image" && endImage.status === "ready" && endImage.stale !== true);
  });
  if (missingFlowFrames.length) return NextResponse.json({
    ok: false,
    code: "FLOW_FRAMES_REQUIRED",
    message: `Flow Frames cần ảnh khung đầu và ảnh khung cuối sẵn sàng cho: ${missingFlowFrames.slice(0, 8).map((scene) => scene.id).join(", ")}${missingFlowFrames.length > 8 ? ` và ${missingFlowFrames.length - 8} cảnh khác` : ""}.`,
    sceneIds: missingFlowFrames.map((scene) => scene.id),
  }, { status: 409 });
  const seedanceAccountIds = new Set(candidateSettings
    .filter((item) => item.videoProvider === "seedance" || item.videoProvider === "muse" || item.videoProvider === "flow")
    .map((settings) => settings.videoProvider === "seedance" ? settings.seedanceAccountId || "" : ""));
  for (const accountId of seedanceAccountIds) {
    try {
      await getSeedanceApiKey(accountId);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "SEEDANCE_ACCOUNT_REQUIRED";
      const message = code === "SEEDANCE_ACCOUNT_NOT_FOUND"
        ? "Tài khoản API đã chọn không còn tồn tại. Hãy chọn lại tài khoản."
        : code === "SEEDANCE_ENCRYPTION_KEY_REQUIRED"
          ? "Máy chủ chưa cấu hình khóa mã hóa tài khoản API."
          : "Chưa kết nối API key Seedance / MaiVideo. Hãy thêm tài khoản trong Cài đặt.";
      return NextResponse.json({ ok: false, code, message }, { status: 503 });
    }
  }
  const needsSeedanceReferences = candidates.some((scene) => {
    const settings = resolveMediaGenerationSettings({
      ...project.mediaGeneration,
      ...mediaRecord(scene.mediaGeneration || scene.media_generation),
      ...(isFlowStoryOnlyPreset(project.presetId) ? { flowReferenceMode: "ingredients" as const } : {}),
    });
    const videoReferenceIds = sceneReferenceCharacterIds(scene, "video");
    const hasCharacterReferenceImage = videoReferenceIds
      .some((id) => (project.characters || []).some((character) => character.id === id && Boolean(character.referenceImagePath)));
    const locationId = sceneReferenceLocationId(scene, "video");
    const hasLocationReferenceImage = Boolean((project.locations || []).find((location) => location.id === locationId)?.referenceImagePath);
    const flowFramesMode = settings.videoProvider === "flow" && settings.flowReferenceMode === "frames";
    return (settings.videoProvider === "seedance" || settings.videoProvider === "muse" || settings.videoProvider === "flow") && (
      flowFramesMode
      || Boolean(settings.videoUseSceneImageReference && sceneReferenceImage(scene))
      || Boolean(settings.videoUseCharacterReferences && hasCharacterReferenceImage)
      || Boolean(shouldUseVideoLocationReference(settings, project.presetId === "ai-drama") && hasLocationReferenceImage)
      || Boolean(previousSceneContinuityReference(scenes, scene))
    );
  });
  const publicBaseUrlIssue = needsSeedanceReferences ? seedancePublicBaseUrlIssue() : undefined;
  if (publicBaseUrlIssue) {
    return NextResponse.json({ ok: false, code: publicBaseUrlIssue, message: seedancePublicBaseUrlErrorMessage(publicBaseUrlIssue) }, { status: 503 });
  }
  if (candidateSettings.some((settings) => settings.videoProvider === "maivideo")) {
    try {
      if (!await getMaiVideoApiKey()) {
        return NextResponse.json({ ok: false, code: "MAIVIDEO_VIDEO_API_KEY_REQUIRED", message: "Hãy thêm API key tạo video MaiVideo trong Cài đặt." }, { status: 503 });
      }
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "MAIVIDEO_API_KEY_STORE_UNAVAILABLE";
      const message = code === "MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED"
        ? "Máy chủ chưa cấu hình khóa mã hóa API key MaiVideo."
        : "Không thể đọc API key tạo video MaiVideo trong Cài đặt.";
      return NextResponse.json({ ok: false, code, message }, { status: 503 });
    }
  }
  const updated = await updateData((data) => {
    const current = getProjectOrThrow(data, slug);
    const queue = current.videoQueue || emptyQueue();
    queue.concurrency = Math.max(1, Math.min(20, Number(body.concurrency) || queue.concurrency || 20));
    let added = 0;
    let retried = 0;
    for (const scene of candidates) {
      const active = queue.jobs.find((job) => job.sceneId === scene.id && ["queued", "running", "paused"].includes(job.status));
      if (active) continue;
      const completed = queue.jobs.find((job) => job.sceneId === scene.id && job.status === "completed");
      if (completed && !onlyMissing && !regenerate) continue;
      const failed = queue.jobs.find((job) => job.sceneId === scene.id && job.status === "failed");
      if (failed && retryFailed && !regenerate) {
        failed.status = "queued";
        failed.attempt = 0;
        if (failed.retryStrategy === "new_task") {
          failed.seedanceTaskId = undefined;
          failed.higgsfieldJobId = undefined;
          failed.maiVideoJobId = undefined;
        }
        failed.stage = failed.maiVideoJobId ? "flow_poll" : failed.seedanceTaskId ? "seedance_poll" : failed.higgsfieldJobId ? "higgsfield_poll" : undefined;
        failed.error = undefined;
        failed.failureStage = undefined;
        failed.retryStrategy = undefined;
        failed.requestId = undefined;
        failed.finishedAt = undefined;
        failed.updatedAt = now();
        retried += 1;
        continue;
      }
      const settings = resolveMediaGenerationSettings({
        ...project.mediaGeneration,
        ...mediaRecord(scene.mediaGeneration || scene.media_generation),
        ...(isFlowStoryOnlyPreset(project.presetId) ? { flowReferenceMode: "ingredients" as const } : {}),
      });
      const job: VideoGenerationJob = {
        id: `vjob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sceneId: scene.id,
        chunkId: scene.chunkId,
        sceneIndex: scene.sceneIndex,
        status: "queued",
        attempt: 0,
        maxAttempts: 3,
        createdAt: now(),
        updatedAt: now(),
        provider: settings.videoProvider === "maivideo" ? "maivideo-video" : settings.videoProvider,
      };
      queue.jobs.push(job);
      added += 1;
    }
    queue.status = queue.status === "paused" ? "paused" : "idle";
    queue.updatedAt = now();
    current.videoQueue = queue;
    current.updatedAt = now();
    data.activities.unshift(makeActivity({
      projectSlug: slug,
      kind: "chunk",
      title: "Đã xếp hàng video AI",
      detail: `${added} job mới${retried ? ` · retry ${retried}` : ""} · concurrency ${queue.concurrency} · không gọi API khi xếp hàng`,
      status: "info",
    }));
    return { project: current, queue, added, retried };
  });
  if (higgsfieldJobsRequested) {
    try {
      for (const job of updated.queue.jobs) {
        if (job.provider === "higgsfield" && ["queued", "running", "paused"].includes(job.status)) {
          await saveHiggsfieldSessionToken(higgsfieldOwnerId, job.id, higgsfieldAuthToken);
        }
      }
    } catch {
      return NextResponse.json({ ok: false, code: "HIGGSFIELD_SESSION_STORE_UNAVAILABLE", message: "Không lưu được phiên Higgsfield an toàn; hãy thử xếp job lại." }, { status: 503 });
    }
  }
  if (gatewayJobsRequested) {
    try {
      for (const job of updated.queue.jobs) {
        if ((job.provider === "muse" || job.provider === "flow") && ["queued", "running", "paused"].includes(job.status)) {
          await saveProviderSessionToken(providerOwnerId, job.id, providerAuthToken);
        }
      }
    } catch {
      return NextResponse.json({ ok: false, code: "PROVIDER_SESSION_STORE_UNAVAILABLE", message: "Không lưu được phiên MaiVideo an toàn; hãy thử xếp job lại." }, { status: 503 });
    }
  }
  return NextResponse.json({ ok: true, ...updated, summary: summarize(updated.queue) });
}

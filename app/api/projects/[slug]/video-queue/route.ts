import { statSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { previousSceneContinuityReference, readProjectScenes, sceneReferenceImage } from "../../../../lib/scene-store";
import type { VideoGenerationJob, VideoQueueState } from "../../../../lib/project-types";
import { resolveMediaGenerationSettings, shouldUseVideoLocationReference, usesDolaRenderGateway } from "../../../../lib/media-generation-settings";
import { getSeedanceApiKey } from "../../../../lib/seedance-accounts";
import { getMaiVideoApiKey } from "../../../../lib/maivideo-api-keys";
import { seedancePublicBaseUrlErrorMessage, seedancePublicBaseUrlIssue } from "../../../../lib/seedance-reference-links";
import { getProjectOrThrow, makeActivity, now, readData, updateData } from "../../../../lib/server-store";
import { sceneReferenceCharacterIds, sceneReferenceLocationId } from "../../../../lib/scene-reference-assignments";
import { DEFAULT_RUN_CONCURRENCY } from "../../../../lib/run-concurrency-config";
import { getRunConcurrencyLimit } from "../../../../lib/user-settings";

export const runtime = "nodejs";

function emptyQueue(): VideoQueueState {
  return { status: "idle", concurrency: DEFAULT_RUN_CONCURRENCY, jobs: [], updatedAt: now() };
}

function mediaRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isAlreadyAiVideo(scene: Record<string, unknown>, projectSlug: string) {
  const media = mediaRecord(scene.media);
  if (media.kind !== "video" || media.status !== "ready" || media.stale === true || !String(media.provider || "").startsWith("maivideo-video")) return false;
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
  }));
  const missingSceneImages = candidates.filter((scene) => {
    const settings = resolveMediaGenerationSettings({
      ...project.mediaGeneration,
      ...mediaRecord(scene.mediaGeneration || scene.media_generation),
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
  const seedanceAccountIds = new Set(candidateSettings
    .filter((item) => item.videoProvider === "seedance")
    .map((settings) => settings.seedanceAccountId || ""));
  for (const accountId of usesDolaRenderGateway() ? [] : seedanceAccountIds) {
    try {
      await getSeedanceApiKey(accountId);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "SEEDANCE_ACCOUNT_REQUIRED";
      const message = code === "SEEDANCE_ACCOUNT_NOT_FOUND"
        ? "Tài khoản Seedance đã chọn không còn tồn tại. Hãy chọn lại tài khoản."
        : code === "SEEDANCE_ENCRYPTION_KEY_REQUIRED"
          ? "Máy chủ chưa cấu hình khóa mã hóa tài khoản Seedance."
          : "Chưa kết nối API key Seedance. Hãy thêm tài khoản trong Cài đặt.";
      return NextResponse.json({ ok: false, code, message }, { status: 503 });
    }
  }
  const needsSeedanceReferences = candidates.some((scene) => {
    const settings = resolveMediaGenerationSettings({
      ...project.mediaGeneration,
      ...mediaRecord(scene.mediaGeneration || scene.media_generation),
    });
    const videoReferenceIds = sceneReferenceCharacterIds(scene, "video");
    const hasCharacterReferenceImage = videoReferenceIds
      .some((id) => (project.characters || []).some((character) => character.id === id && Boolean(character.referenceImagePath)));
    const locationId = sceneReferenceLocationId(scene, "video");
    const hasLocationReferenceImage = Boolean((project.locations || []).find((location) => location.id === locationId)?.referenceImagePath);
    return settings.videoProvider === "seedance" && (
      Boolean(settings.videoUseSceneImageReference && sceneReferenceImage(scene))
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
  const concurrency = await getRunConcurrencyLimit();
  const updated = await updateData((data) => {
    const current = getProjectOrThrow(data, slug);
    const queue = current.videoQueue || emptyQueue();
    queue.concurrency = concurrency;
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
        if (failed.retryStrategy === "new_task") failed.seedanceTaskId = undefined;
        failed.stage = failed.seedanceTaskId ? "seedance_poll" : undefined;
        failed.error = undefined;
        failed.failureStage = undefined;
        failed.retryStrategy = undefined;
        failed.requestId = undefined;
        failed.finishedAt = undefined;
        failed.updatedAt = now();
        retried += 1;
        continue;
      }
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
        provider: resolveMediaGenerationSettings({
          ...project.mediaGeneration,
          ...mediaRecord(scene.mediaGeneration || scene.media_generation),
        }).videoProvider === "seedance" ? "seedance" : "maivideo-video",
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
  return NextResponse.json({ ok: true, ...updated, summary: summarize(updated.queue) });
}

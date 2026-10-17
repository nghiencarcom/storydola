import type { MediaGenerationSettings, SceneMediaAsset } from "./project-types";
import { readProjectScenes, sceneMediaPreviewUrl } from "./scene-store";
import { getProjectOrThrow, makeActivity, markRenderStale, now, readChunkOutput, saveChunkOutput, updateData, updateDataForUser } from "./server-store";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isReadySceneMedia(value: unknown, expectedKind?: "image" | "video") {
  const media = asRecord(value);
  return (media?.kind === "image" || media?.kind === "video") && (!expectedKind || media.kind === expectedKind) && media.status === "ready" && media.stale !== true;
}

export async function saveGeneratedSceneMedia({
  projectSlug,
  sceneId,
  media,
  mediaGeneration,
  userId,
  jobId,
  jobCreatedAt,
}: {
  projectSlug: string;
  sceneId: string;
  media: SceneMediaAsset;
  mediaGeneration: MediaGenerationSettings;
  userId?: string;
  jobId?: string;
  jobCreatedAt?: string;
}) {
  const mutate = async (data: import("./project-types").StoryAIData) => {
    const project = getProjectOrThrow(data, projectSlug);
    const scene = (await readProjectScenes(project)).find((item) => item.id === sceneId);
    if (!scene) throw new Error("SCENE_NOT_FOUND");
    const chunk = project.chunks.find((item) => item.id === scene.chunkId);
    if (!chunk?.outputPath) throw new Error("CHUNK_OUTPUT_NOT_FOUND");

    const currentMedia = asRecord(scene.media);
    const jobCreatedAtMs = Date.parse(jobCreatedAt || "");
    const currentMediaGeneratedAtMs = Date.parse(String(currentMedia?.generatedAt || ""));
    const newerCompletedVideoJob = media.kind === "video" && jobId && Number.isFinite(jobCreatedAtMs)
      && project.sceneMediaJobs?.some((job) => job.id !== jobId
        && job.sceneId === sceneId
        && job.kind === "video"
        && job.status === "completed"
        && Date.parse(job.createdAt) > jobCreatedAtMs);
    const newerSavedVideo = media.kind === "video" && currentMedia?.kind === "video"
      && currentMedia.status === "ready"
      && currentMedia.stale !== true
      && Number.isFinite(jobCreatedAtMs)
      && Number.isFinite(currentMediaGeneratedAtMs)
      && currentMediaGeneratedAtMs > jobCreatedAtMs
      && currentMedia.generatedFromJobId !== jobId;
    if (newerCompletedVideoJob || newerSavedVideo) {
      return { outputPath: chunk.outputPath, scene, superseded: true };
    }

    const savedMedia: SceneMediaAsset = {
      ...media,
      generatedAt: now(),
      ...(jobId ? { generatedFromJobId: jobId } : {}),
    };

    const payload = asRecord(await readChunkOutput(chunk));
    const rawScenes = payload && Array.isArray(payload.scenes) ? payload.scenes : [];
    const targetIndex = rawScenes.findIndex((value) => {
      const record = asRecord(value);
      return record && String(record.id || record.scene_id || "").trim() === sceneId;
    });
    if (targetIndex < 0) throw new Error("SCENE_OUTPUT_NOT_FOUND");

    const aiReview = {
      status: "pending",
      score: 0,
      summary: "Media đã thay đổi; cần chạy lại AI pre-check trước khi người dùng duyệt.",
      issues: ["Media mới chưa được AI đánh giá lại."],
      checks: {},
      createdAt: now(),
    };
    const updatedScenes = rawScenes.map((value, index) => index === targetIndex
      ? {
        ...(asRecord(value) || {}),
        media: savedMedia,
        mediaFallback: false,
        ...(media.kind === "image" ? { videoReferenceImage: savedMedia } : {}),
        mediaGeneration,
        review_status: "unreviewed",
        review_note: "",
        ai_review: aiReview,
      }
      : value);
    const expectedKind = project.presetId === "ai-drama" ? "video" : undefined;
    const ready = updatedScenes.filter((value) => isReadySceneMedia(asRecord(value)?.media, expectedKind)).length;
    const fallback = updatedScenes.filter((value) => asRecord(value)?.mediaFallback === true).length;
    const outputPath = await saveChunkOutput(projectSlug, chunk.id, {
      ...(payload || {}),
      scenes: updatedScenes,
      media_summary: {
        ...asRecord(payload?.media_summary),
        source: savedMedia.provider,
        requested: updatedScenes.length,
        ready,
        failed: updatedScenes.length - ready,
        fallback,
      },
    });

    const scenes = await readProjectScenes(project);
    project.reviewCount = scenes.filter((item) => String(item.review_status || item.reviewStatus || "unreviewed") === "needs_changes").length;
    project.aiReviewCount = scenes.filter((item) => {
      const review = asRecord(item.ai_review) || {};
      return String(review.status || "pending") === "needs_changes";
    }).length;
    chunk.render = markRenderStale(chunk.render);
    project.render = markRenderStale(project.render);

    if (savedMedia.kind === "video" && project.videoQueue) {
      const queuedJob = project.videoQueue.jobs.find((job) => job.sceneId === sceneId && ["queued", "running", "paused"].includes(job.status));
      if (queuedJob) {
        queuedJob.status = "completed";
        queuedJob.finishedAt = now();
        queuedJob.updatedAt = now();
        queuedJob.error = undefined;
      }
      project.videoQueue.updatedAt = now();
    }
    project.updatedAt = now();
    const providerName = media.provider?.includes("seedance") ? "Seedance" : "MaiVideo";
    data.activities.unshift(makeActivity({
      projectSlug,
      kind: "chunk",
      title: `${sceneId} đã tạo ${savedMedia.kind === "image" ? "ảnh" : "video"} AI ${providerName}`,
      detail: `${chunk.id} · ${savedMedia.model || providerName}${savedMedia.quality ? ` · ${savedMedia.quality}` : ""} · output ${outputPath}`,
      status: "success",
    }));

    const updatedSceneRecord = asRecord(updatedScenes[targetIndex]) || {};
    const referenceImagePath = asRecord(updatedSceneRecord.videoReferenceImage)?.localPath || (savedMedia.kind === "image" ? savedMedia.localPath : "");
    return {
      outputPath,
      scene: {
        ...scene,
        ...updatedSceneRecord,
        id: scene.id,
        chunkId: chunk.id,
        sceneIndex: scene.sceneIndex,
        media: savedMedia,
        mediaGeneration,
        reviewStatus: "unreviewed",
        reviewNote: "",
        aiReview,
        previewUrl: savedMedia.localPath ? sceneMediaPreviewUrl(projectSlug, sceneId, savedMedia.localPath) : "",
        referenceImagePreviewUrl: referenceImagePath
          ? sceneMediaPreviewUrl(projectSlug, sceneId, String(referenceImagePath), "reference")
          : "",
      },
    };
  };
  return userId ? updateDataForUser(userId, mutate) : updateData(mutate);
}

export async function saveGeneratedSceneReferenceImage({
  projectSlug,
  sceneId,
  media,
  mediaGeneration,
}: {
  projectSlug: string;
  sceneId: string;
  media: SceneMediaAsset;
  mediaGeneration: MediaGenerationSettings;
}) {
  return updateData(async (data) => {
    const project = getProjectOrThrow(data, projectSlug);
    const scene = (await readProjectScenes(project)).find((item) => item.id === sceneId);
    if (!scene) throw new Error("SCENE_NOT_FOUND");
    const chunk = project.chunks.find((item) => item.id === scene.chunkId);
    if (!chunk?.outputPath) throw new Error("CHUNK_OUTPUT_NOT_FOUND");
    const payload = asRecord(await readChunkOutput(chunk));
    const rawScenes = payload && Array.isArray(payload.scenes) ? payload.scenes : [];
    const targetIndex = rawScenes.findIndex((value) => {
      const record = asRecord(value);
      return record && String(record.id || record.scene_id || "").trim() === sceneId;
    });
    if (targetIndex < 0) throw new Error("SCENE_OUTPUT_NOT_FOUND");
    const aiReview = {
      status: "pending",
      score: 0,
      summary: "Ảnh tham chiếu đã thay đổi; cần chạy lại AI pre-check trước khi duyệt cảnh.",
      issues: ["Ảnh tham chiếu mới chưa được AI đánh giá lại."],
      checks: {},
      createdAt: now(),
    };
    const updatedScenes = rawScenes.map((value, index) => {
      if (index !== targetIndex) return value;
      const record = asRecord(value) || {};
      const currentMedia = asRecord(record.media);
      return {
        ...record,
        videoReferenceImage: media,
        ...(currentMedia?.kind === "video" ? { media: { ...currentMedia, stale: true } } : { media, mediaFallback: false }),
        mediaGeneration,
        review_status: "unreviewed",
        review_note: "",
        ai_review: aiReview,
      };
    });
    const expectedKind = project.presetId === "ai-drama" ? "video" : undefined;
    const ready = updatedScenes.filter((value) => isReadySceneMedia(asRecord(value)?.media, expectedKind)).length;
    const fallback = updatedScenes.filter((value) => asRecord(value)?.mediaFallback === true).length;
    const outputPath = await saveChunkOutput(projectSlug, chunk.id, {
      ...(payload || {}),
      scenes: updatedScenes,
      media_summary: { ...asRecord(payload?.media_summary), requested: updatedScenes.length, ready, failed: updatedScenes.length - ready, fallback },
    });
    const scenes = await readProjectScenes(project);
    project.reviewCount = scenes.filter((item) => String(item.review_status || item.reviewStatus || "unreviewed") === "needs_changes").length;
    project.aiReviewCount = scenes.filter((item) => String(asRecord(item.ai_review)?.status || "pending") === "needs_changes").length;
    chunk.render = markRenderStale(chunk.render);
    project.render = markRenderStale(project.render);
    project.updatedAt = now();
    data.activities.unshift(makeActivity({
      projectSlug,
      kind: "chunk",
      title: `${sceneId} đã tạo ảnh cảnh`,
      detail: `${chunk.id} · ${media.model || "MaiVideo"}${media.quality ? ` · ${media.quality}` : ""}`,
      status: "success",
    }));
    const updatedScene = asRecord(updatedScenes[targetIndex]) || {};
    return {
      outputPath,
      scene: {
        ...scene,
        ...updatedScene,
        referenceImagePreviewUrl: media.localPath
          ? sceneMediaPreviewUrl(projectSlug, sceneId, media.localPath, "reference")
          : "",
      },
    };
  });
}

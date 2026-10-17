import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { readData, readDataForUser } from "../../../../lib/server-store";
import { isRecoverableSeedancePendingJob, isSceneMediaJobSupersededBySavedVideo, reconcileSceneMediaJobsWithSavedVideos, startSceneMediaQueue } from "../../../../lib/scene-media-queue";
import { readProjectScenes, sceneMediaLocalPath, sceneMediaPreviewUrl, sceneReferenceImageLocalPath } from "../../../../lib/scene-store";
import type { SceneAiReview } from "../../../../lib/project-types";

export const runtime = "nodejs";

function normalizeAiReview(value: unknown): SceneAiReview {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const status = String(record.status || "pending");
  return {
    status: ["passed", "needs_changes", "error"].includes(status) ? status as SceneAiReview["status"] : "pending",
    score: Math.max(0, Math.min(100, Number(record.score) || 0)),
    summary: String(record.summary || "AI chưa đánh giá cảnh này."),
    issues: Array.isArray(record.issues) ? record.issues.map((issue) => String(issue)).filter(Boolean).slice(0, 8) : [],
    checks: record.checks && typeof record.checks === "object" && !Array.isArray(record.checks) ? record.checks as SceneAiReview["checks"] : {},
    model: record.model ? String(record.model) : undefined,
    createdAt: record.createdAt ? String(record.createdAt) : undefined,
    error: record.error ? String(record.error) : undefined,
  };
}

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const userId = (await headers()).get("x-storyai-user-id")?.trim();
  let data = await readData();
  let project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });

  const scenes = await readProjectScenes(project);
  if (userId && await reconcileSceneMediaJobsWithSavedVideos(userId, slug, scenes)) {
    data = await readDataForUser(userId);
    project = data.projects.find((item) => item.slug === slug);
    if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  }
  if (userId && project.sceneMediaJobs?.some((job) => job.status === "queued" || job.status === "running" || isRecoverableSeedancePendingJob(job))) {
    startSceneMediaQueue(userId, slug);
  }

  return NextResponse.json({
    scenes: scenes.map((scene) => {
      const reviewStatus = String(scene.review_status || scene.reviewStatus || "unreviewed");
      const reviewNote = typeof (scene.review_note || scene.reviewNote) === "string" ? String(scene.review_note || scene.reviewNote) : "";
      const aiReview = normalizeAiReview(scene.ai_review || scene.aiReview);
      const rawCharacterIds = scene.character_ids ?? scene.characterIds;
      const characterIds = Array.isArray(rawCharacterIds) ? rawCharacterIds.map((id) => String(id)) : [];
      const rawLocationId = scene.location_id ?? scene.locationId ?? scene.environment_id ?? scene.environmentId;
      const locationId = typeof rawLocationId === "string" ? rawLocationId : "";
      const sceneMediaJobs = (project.sceneMediaJobs || []).filter((job) => job.sceneId === scene.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const activeMediaJob = sceneMediaJobs.find((job) => job.status === "queued" || job.status === "running");
      const storedMediaJob = activeMediaJob && !isSceneMediaJobSupersededBySavedVideo(activeMediaJob, scene.media, project.sceneMediaJobs || [])
        ? activeMediaJob
        : sceneMediaJobs.find((job) => job.status === "completed" || job.status === "failed");
      const mediaJob = storedMediaJob ? {
        id: storedMediaJob.id,
        sceneId: storedMediaJob.sceneId,
        chunkId: storedMediaJob.chunkId,
        sceneIndex: storedMediaJob.sceneIndex,
        kind: storedMediaJob.kind,
        status: storedMediaJob.status,
        attempt: storedMediaJob.attempt,
        createdAt: storedMediaJob.createdAt,
        updatedAt: storedMediaJob.updatedAt,
        startedAt: storedMediaJob.startedAt,
        finishedAt: storedMediaJob.finishedAt,
        error: storedMediaJob.error,
        provider: storedMediaJob.provider,
        stage: storedMediaJob.stage,
        submittedPrompt: storedMediaJob.submittedPrompt,
      } : undefined;
      const mediaPath = sceneMediaLocalPath(scene);
      const referenceImagePath = sceneReferenceImageLocalPath(scene);
      const sceneForClient = { ...scene };
      delete sceneForClient.videoStoryboardImage;
      delete sceneForClient.video_storyboard_image;
      return {
        ...sceneForClient,
        ...(mediaJob ? { mediaJob } : {}),
        characterIds,
        locationId,
        reviewStatus: ["approved", "needs_changes"].includes(reviewStatus) ? reviewStatus : "unreviewed",
        reviewNote,
        aiReview,
        previewUrl: mediaPath ? sceneMediaPreviewUrl(slug, scene.id, mediaPath) : "",
        referenceImagePreviewUrl: referenceImagePath ? sceneMediaPreviewUrl(slug, scene.id, referenceImagePath, "reference") : "",
      };
    }),
  }, { headers: { "Cache-Control": "no-store" } });
}

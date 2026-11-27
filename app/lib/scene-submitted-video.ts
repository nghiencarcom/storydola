import {
  DEFAULT_FLOW_VIDEO_MODEL_ID,
  DEFAULT_MUSE_VIDEO_MODEL_ID,
  FLOW_VIDEO_MODEL_OPTION,
  isHiggsfieldSeedanceModel,
  isKlingVideoModel,
  MINIMAX_H3_VIDEO_MODEL_ID,
  PIXVERSE_SEEDANCE_2_FAST_MODEL_ID,
  WAN_3_VIDEO_MODEL_ID,
} from "./media-generation-settings";
import type { VideoGenerationModelOption } from "./project-types";

export type LastSubmittedSceneVideo = {
  prompt: string;
  model?: string;
  provider?: string;
  quality?: string;
  jobId?: string;
  submittedAt?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseTimestampMs(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return NaN;
  return Date.parse(value);
}

function jobTimestampMs(job: Record<string, unknown>): number {
  const createdMs = parseTimestampMs(job.createdAt);
  if (Number.isFinite(createdMs)) return createdMs;
  const updatedMs = parseTimestampMs(job.updatedAt);
  return Number.isFinite(updatedMs) ? updatedMs : 0;
}

function normalizeSubmittedVideoProvider(provider?: string): string {
  const raw = provider?.trim().toLowerCase() || "";
  if (!raw || raw === "upload" || raw.startsWith("stock")) return "";
  if (raw === "flow" || raw === "flow-video") return "flow";
  if (raw === "muse" || raw === "maivideo-video-muse") return "muse";
  if (raw === "higgsfield" || raw === "maivideo-video-higgsfield") return "higgsfield";
  if (raw === "seedance" || raw === "maivideo-video-seedance") return "seedance";
  if (raw === "maivideo" || raw === "maivideo-video") return "maivideo";
  return raw;
}

function buildSubmittedVideoFromJob(job: Record<string, unknown>): LastSubmittedSceneVideo {
  const jobMg = asRecord(job.mediaGeneration);
  return {
    prompt: String(job.submittedPrompt).trim(),
    model: trimmedString(jobMg?.videoModel),
    provider: trimmedString(jobMg?.videoProvider) || trimmedString(job.provider),
    quality: trimmedString(jobMg?.videoQuality),
    jobId: trimmedString(job.id),
    submittedAt: trimmedString(job.updatedAt) || trimmedString(job.createdAt),
  };
}

export function resolveLastSubmittedSceneVideo(input: {
  media?: Record<string, unknown> | null;
  jobs?: Array<Record<string, unknown>> | null;
  fallbackMediaGeneration?: Record<string, unknown> | null;
}): LastSubmittedSceneVideo | undefined {
  const media = asRecord(input.media);
  const fallbackMg = asRecord(input.fallbackMediaGeneration);
  const matchingJobs = (input.jobs || [])
    .map(asRecord)
    .filter((job): job is Record<string, unknown> => {
      if (!job || job.kind !== "video") return false;
      return typeof job.submittedPrompt === "string" && job.submittedPrompt.trim().length > 0;
    })
    .sort((left, right) => {
      const createdDiff = (parseTimestampMs(right.createdAt) || 0) - (parseTimestampMs(left.createdAt) || 0);
      if (createdDiff !== 0) return createdDiff;
      return (parseTimestampMs(right.updatedAt) || 0) - (parseTimestampMs(left.updatedAt) || 0);
    });

  const latestJob = matchingJobs[0];
  const jobMg = asRecord(latestJob?.mediaGeneration);

  const isVideoMedia = media?.kind === "video";
  const rawMediaProvider = trimmedString(media?.provider) || "";
  const isUploadedVideo = isVideoMedia && rawMediaProvider === "upload";
  const isStockVideo = isVideoMedia && rawMediaProvider.startsWith("stock");
  const mediaGeneratedAtMs = parseTimestampMs(media?.generatedAt);
  const latestJobCreatedAtMs = latestJob ? parseTimestampMs(latestJob.createdAt) : NaN;
  const latestJobFinishedAtMs = latestJob ? parseTimestampMs(latestJob.finishedAt ?? latestJob.updatedAt) : NaN;

  if (isUploadedVideo) {
    if (
      latestJob &&
      Number.isFinite(latestJobCreatedAtMs) &&
      Number.isFinite(mediaGeneratedAtMs) &&
      latestJobCreatedAtMs > mediaGeneratedAtMs
    ) {
      return buildSubmittedVideoFromJob(latestJob);
    }
    return undefined;
  }

  const mediaPrompt =
    isVideoMedia && !isUploadedVideo && !isStockVideo && typeof media?.query === "string"
      ? media.query.trim()
      : "";

  if (latestJob && mediaPrompt) {
    const mediaJobId = trimmedString(media?.generatedFromJobId);
    const latestJobId = trimmedString(latestJob.id);
    if (mediaJobId && latestJobId && mediaJobId === latestJobId) {
      return {
        prompt: String(latestJob.submittedPrompt).trim(),
        model: trimmedString(media?.model) || trimmedString(jobMg?.videoModel),
        provider: trimmedString(jobMg?.videoProvider) || (rawMediaProvider || undefined) || trimmedString(latestJob.provider),
        quality: trimmedString(media?.quality) || trimmedString(jobMg?.videoQuality),
        jobId: latestJobId,
        submittedAt: trimmedString(latestJob.updatedAt) || trimmedString(latestJob.createdAt),
      };
    }

    const latestJobBoundaryMs = Math.max(
      Number.isFinite(latestJobCreatedAtMs) ? latestJobCreatedAtMs : 0,
      Number.isFinite(latestJobFinishedAtMs) ? latestJobFinishedAtMs : 0,
      jobTimestampMs(latestJob),
    );
    if (
      latestJob.status !== "running" &&
      Number.isFinite(mediaGeneratedAtMs) &&
      mediaGeneratedAtMs > latestJobBoundaryMs + 1000
    ) {
      return {
        prompt: mediaPrompt,
        model: trimmedString(media?.model) || trimmedString(fallbackMg?.videoModel),
        provider: (rawMediaProvider || undefined) || trimmedString(fallbackMg?.videoProvider),
        quality: trimmedString(media?.quality) || trimmedString(fallbackMg?.videoQuality),
        submittedAt: trimmedString(media?.generatedAt),
      };
    }

    return buildSubmittedVideoFromJob(latestJob);
  }

  if (latestJob) {
    return buildSubmittedVideoFromJob(latestJob);
  }

  if (mediaPrompt) {
    return {
      prompt: mediaPrompt,
      model: trimmedString(media?.model) || trimmedString(fallbackMg?.videoModel),
      provider: (rawMediaProvider || undefined) || trimmedString(fallbackMg?.videoProvider),
      quality: trimmedString(media?.quality) || trimmedString(fallbackMg?.videoQuality),
      submittedAt: trimmedString(media?.generatedAt),
    };
  }

  return undefined;
}

export function submittedVideoModelDisplayName(input: {
  model?: string;
  provider?: string;
  catalogModels?: VideoGenerationModelOption[];
}): string {
  const rawProvider = input.provider?.trim().toLowerCase() || "";
  if (rawProvider === "upload" || rawProvider.startsWith("stock")) return "";

  const normalizedProvider = normalizeSubmittedVideoProvider(input.provider);
  const rawModel = input.model?.trim() || "";
  const lower = rawModel.toLowerCase();

  if (rawModel && input.catalogModels?.length) {
    const exactMatch = normalizedProvider
      ? input.catalogModels.find(
          (item) => item.id === rawModel && (item.provider || "maivideo") === normalizedProvider,
        )
      : undefined;
    const fallbackMatch = exactMatch || input.catalogModels.find((item) => item.id === rawModel);
    if (fallbackMatch?.label?.trim()) {
      return fallbackMatch.label.trim();
    }
  }

  if (normalizedProvider === "higgsfield" || isHiggsfieldSeedanceModel(rawModel, normalizedProvider || undefined)) {
    return "Seedance 2.0 · Higgsfield";
  }
  if (normalizedProvider === "muse" || lower === DEFAULT_MUSE_VIDEO_MODEL_ID || lower === "muse.ai") {
    return "Muse.ai";
  }
  if (lower === DEFAULT_FLOW_VIDEO_MODEL_ID || (normalizedProvider === "flow" && !rawModel)) {
    return FLOW_VIDEO_MODEL_OPTION.label;
  }
  if (lower === "flow-omni-1.1-flash") {
    return "Flow Omni 1.1 Flash";
  }
  if (lower === PIXVERSE_SEEDANCE_2_FAST_MODEL_ID) {
    return "Seedance 2.0 · PixVerse";
  }
  if (lower === "seedance-2.5") {
    return normalizedProvider === "maivideo" ? "Seedance 2.5 · MaiVideo" : "Seedance 2.5";
  }
  if (lower === "seedance-2.0") {
    return normalizedProvider === "maivideo" ? "Seedance 2.0 · MaiVideo" : "Seedance 2.0";
  }
  if (isKlingVideoModel(rawModel)) {
    return "Kling 4.0";
  }
  if (lower === MINIMAX_H3_VIDEO_MODEL_ID) {
    return "MiniMax H3";
  }
  if (lower === WAN_3_VIDEO_MODEL_ID) {
    return "Wan 3.0";
  }
  if (lower === "v6") {
    return "PixVerse v6";
  }
  if (lower === "c1" || lower === "pixverse-c1") {
    return "PixVerse C1";
  }
  if (rawModel) {
    return rawModel;
  }

  if (normalizedProvider === "flow") return FLOW_VIDEO_MODEL_OPTION.label;
  if (normalizedProvider === "muse") return "Muse.ai";
  if (normalizedProvider === "higgsfield") return "Seedance 2.0 · Higgsfield";
  if (normalizedProvider === "seedance") return "Seedance";
  if (normalizedProvider === "maivideo") return "MaiVideo";
  return "";
}

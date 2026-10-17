import { DEFAULT_MEDIA_GENERATION_SETTINGS, IMAGE_DETAIL_LEVELS, type ImageDetailLevel, type ImageGenerationModelOption, type MediaGenerationSettings, type VideoGenerationModelOption } from "./project-types";

export const DEFAULT_IMAGE_MODEL_ID = "gpt-image-2.5-flare";
export const DEFAULT_MAIVIDEO_VIDEO_MODEL_ID = "v6";
export const DEFAULT_SEEDANCE_VIDEO_MODEL_ID = "seedance-2.5";
export const SEEDANCE_DIRECT_MAX_REFERENCE_IMAGES = 30;

const GPT_IMAGE_RESOLUTIONS = ["1080p", "1440p", "2160p"];
const GPT_IMAGE_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "21:9"];
const gptImageAspectRatiosByResolution = Object.fromEntries(
  GPT_IMAGE_RESOLUTIONS.map((resolution) => [resolution, GPT_IMAGE_ASPECT_RATIOS]),
);

/** Documented image models are retained as fallbacks if the live catalog is partial. */
const DOCUMENTED_IMAGE_MODELS: ImageGenerationModelOption[] = [
  {
    id: "gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare (Fast)",
    qualities: GPT_IMAGE_RESOLUTIONS,
    detailLevels: ["low", "medium", "high", "xhigh", "max"],
    aspectRatiosByQuality: gptImageAspectRatiosByResolution,
    maxReferenceImages: 9,
  },
  {
    id: "gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst (Quality)",
    qualities: GPT_IMAGE_RESOLUTIONS,
    detailLevels: ["low", "medium", "high", "xhigh", "max"],
    aspectRatiosByQuality: gptImageAspectRatiosByResolution,
    maxReferenceImages: 9,
  },
  {
    id: "gpt-image-2.0",
    label: "GPT Image 2.0",
    qualities: GPT_IMAGE_RESOLUTIONS,
    detailLevels: ["low", "medium", "high"],
    aspectRatiosByQuality: gptImageAspectRatiosByResolution,
    maxReferenceImages: 9,
  },
  {
    id: "gemini-3.1-flash",
    label: "Gemini 3.1 Flash",
    qualities: ["1440p"],
    detailLevels: [],
    aspectRatiosByQuality: { "1440p": ["1:1"] },
    maxReferenceImages: 9,
  },
  {
    id: "gemini-3.0",
    label: "Gemini 3.0",
    qualities: ["1440p"],
    detailLevels: [],
    aspectRatiosByQuality: { "1440p": ["1:1"] },
    maxReferenceImages: 9,
  },
];

/** The portable build uses the local Dola browser-profile pool by default. */
export function usesDolaRenderGateway() {
  return (process.env.STORYAI_SEEDANCE_BACKEND || "dola-gateway").trim().toLowerCase() === "dola-gateway";
}

const DIRECT_SEEDANCE_VIDEO_MODEL_IDS = new Set(["seedance-2.0", "seedance-2.5"]);

export function isDirectSeedanceVideoModel(modelId?: string) {
  return DIRECT_SEEDANCE_VIDEO_MODEL_IDS.has(modelId?.trim().toLowerCase() || "");
}

export function availableImageModels(models: ImageGenerationModelOption[] = []) {
  const liveModels = new Map(models.map((model) => [model.id, model]));
  const documentedIds = new Set(DOCUMENTED_IMAGE_MODELS.map((model) => model.id));
  const documentedModels = DOCUMENTED_IMAGE_MODELS.map((documented) => {
    const live = liveModels.get(documented.id);
    if (!live) return documented;
    return {
      ...documented,
      ...live,
      label: live.label && live.label !== live.id ? live.label : documented.label,
      qualities: live.qualities.length ? live.qualities : documented.qualities,
      detailLevels: live.detailLevels?.length ? live.detailLevels : documented.detailLevels,
      aspectRatiosByQuality: Object.keys(live.aspectRatiosByQuality || {}).length
        ? live.aspectRatiosByQuality
        : documented.aspectRatiosByQuality,
      maxReferenceImages: live.maxReferenceImages || documented.maxReferenceImages,
    };
  });
  return [...documentedModels, ...models.filter((model) => !documentedIds.has(model.id))];
}

export function normalizeImageModelId(modelId?: string) {
  return modelId?.trim() || DEFAULT_IMAGE_MODEL_ID;
}

export function imageDetailLevelsForModel(model?: ImageGenerationModelOption): ImageDetailLevel[] {
  return (model?.detailLevels || []).filter((level): level is ImageDetailLevel => IMAGE_DETAIL_LEVELS.includes(level));
}

export function isPixverseVideoModel(modelId?: string) {
  const id = modelId?.trim().toLowerCase() || "";
  // MaiVideo's model catalog exposes PixVerse v6 under the short ID "v6".
  return id.includes("pixverse") || id === "v6";
}

export function isMaiVideoSeedanceModel(modelId?: string) {
  return modelId?.trim().toLowerCase().startsWith("seedance-") || false;
}

export function isVideoOffPeakRequired(modelId?: string, modelLabel?: string) {
  const id = modelId?.trim().toLowerCase() || "";
  const label = modelLabel?.trim().toLowerCase() || "";
  // MaiVideo's model catalog exposes PixVerse v6 under the short ID "v6".
  return id.includes("pixverse") || label.includes("pixverse") || id === "v6";
}

export function videoQualitiesForModel(model?: VideoGenerationModelOption, fallbackQuality?: string) {
  return model?.qualities.length ? [...model.qualities] : fallbackQuality ? [fallbackQuality] : [];
}

export function preferredVideoQuality(modelId: string | undefined, currentQuality: string, supportedQualities: string[] = []) {
  if (supportedQualities.includes(currentQuality)) return currentQuality;
  if (supportedQualities.includes("720p")) return "720p";
  return supportedQualities[0] || (isPixverseVideoModel(modelId) ? "720p" : currentQuality);
}

export function videoDurationOptions(model?: VideoGenerationModelOption, quality = "") {
  const supported = model?.supportedDurationsSec?.filter((duration) => Number.isInteger(duration) && duration > 0 && duration <= 15);
  if (supported?.length) return [...new Set(supported)].sort((left, right) => left - right);
  const minimum = Math.max(1, Math.round(model?.minDurationSec || 1));
  const maximum = Math.min(15, Math.max(minimum, Math.round(model?.maxDurationByQuality?.[quality] || model?.maxDurationSec || 15)));
  return Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index);
}

export function normalizeVideoDuration(requested: number, model?: VideoGenerationModelOption, quality = "") {
  const options = videoDurationOptions(model, quality);
  const duration = Math.max(1, Math.ceil(Number(requested) || options[0] || 1));
  return options.find((option) => option >= duration) ?? options[options.length - 1] ?? duration;
}

export function defaultMediaGenerationSettings(): MediaGenerationSettings {
  const configuredDuration = Number(process.env.MAIVIDEO_VIDEO_DURATION);
  const videoModel = process.env.MAIVIDEO_VIDEO_MODEL?.trim() || DEFAULT_MEDIA_GENERATION_SETTINGS.videoModel;
  const configuredVideoQuality = process.env.MAIVIDEO_VIDEO_QUALITY?.trim();
  return {
    videoProvider: isDirectSeedanceVideoModel(videoModel) ? "seedance" : "maivideo",
    imageModel: normalizeImageModelId(process.env.MAIVIDEO_IMAGE_MODEL || DEFAULT_MEDIA_GENERATION_SETTINGS.imageModel),
    imageQuality: process.env.MAIVIDEO_IMAGE_QUALITY?.trim() || DEFAULT_MEDIA_GENERATION_SETTINGS.imageQuality,
    imageDetailLevel: DEFAULT_MEDIA_GENERATION_SETTINGS.imageDetailLevel,
    videoModel,
    videoQuality: configuredVideoQuality || (isPixverseVideoModel(videoModel) ? "720p" : DEFAULT_MEDIA_GENERATION_SETTINGS.videoQuality),
    videoDurationMode: DEFAULT_MEDIA_GENERATION_SETTINGS.videoDurationMode,
    videoDurationSec: Math.min(15, Math.max(1, Number.isFinite(configuredDuration) && configuredDuration > 0 ? Math.round(configuredDuration) : DEFAULT_MEDIA_GENERATION_SETTINGS.videoDurationSec)),
    videoMultiShot: DEFAULT_MEDIA_GENERATION_SETTINGS.videoMultiShot,
    videoAudio: DEFAULT_MEDIA_GENERATION_SETTINGS.videoAudio,
    videoOffPeak: DEFAULT_MEDIA_GENERATION_SETTINGS.videoOffPeak,
    imageUseCharacterReferences: DEFAULT_MEDIA_GENERATION_SETTINGS.imageUseCharacterReferences,
    videoUseCharacterReferences: DEFAULT_MEDIA_GENERATION_SETTINGS.videoUseCharacterReferences,
    videoUseLocationReferences: DEFAULT_MEDIA_GENERATION_SETTINGS.videoUseLocationReferences,
    videoUseSceneImageReference: DEFAULT_MEDIA_GENERATION_SETTINGS.videoUseSceneImageReference,
  };
}

export function resolveMediaGenerationSettings(settings?: Partial<MediaGenerationSettings>): MediaGenerationSettings {
  const defaults = defaultMediaGenerationSettings();
  const duration = Number(settings?.videoDurationSec);
  const imageDetailLevel = IMAGE_DETAIL_LEVELS.find((level) => level === settings?.imageDetailLevel) || defaults.imageDetailLevel;
  const storedVideoModel = settings?.videoModel?.trim() || defaults.videoModel;
  const videoProvider = settings?.videoProvider === "seedance" || settings?.videoProvider === "maivideo"
    ? settings.videoProvider
    : isDirectSeedanceVideoModel(storedVideoModel) ? "seedance" : "maivideo";
  const videoModel = videoProvider === "seedance"
    ? isDirectSeedanceVideoModel(storedVideoModel) ? storedVideoModel : DEFAULT_SEEDANCE_VIDEO_MODEL_ID
    : storedVideoModel;
  const pixverse = videoProvider === "maivideo" && isPixverseVideoModel(videoModel);
  const maiVideoSeedance = videoProvider === "maivideo" && isMaiVideoSeedanceModel(videoModel);
  const requiresOffPeak = videoProvider === "maivideo" && isVideoOffPeakRequired(videoModel);
  return {
    videoProvider,
    seedanceAccountId: settings?.seedanceAccountId?.trim() || "",
    imageModel: normalizeImageModelId(settings?.imageModel || defaults.imageModel),
    imageQuality: settings?.imageQuality?.trim() || defaults.imageQuality,
    imageDetailLevel,
    videoModel,
    videoQuality: settings?.videoQuality?.trim() || (pixverse ? "720p" : defaults.videoQuality),
    videoDurationMode: settings?.videoDurationMode === "fixed" ? "fixed" : "scene",
    videoDurationSec: Math.min(15, Math.max(1, Number.isFinite(duration) && duration > 0 ? Math.round(duration) : defaults.videoDurationSec)),
    videoMultiShot: settings?.videoMultiShot ?? defaults.videoMultiShot,
    videoAudio: settings?.videoAudio ?? defaults.videoAudio,
    videoOffPeak: requiresOffPeak ? true : maiVideoSeedance ? false : settings?.videoOffPeak ?? defaults.videoOffPeak,
    imageUseCharacterReferences: settings?.imageUseCharacterReferences ?? defaults.imageUseCharacterReferences,
    videoUseCharacterReferences: settings?.videoUseCharacterReferences ?? defaults.videoUseCharacterReferences,
    videoUseLocationReferences: settings?.videoUseLocationReferences ?? defaults.videoUseLocationReferences,
    videoUseSceneImageReference: settings?.videoUseSceneImageReference ?? defaults.videoUseSceneImageReference,
  };
}

export function shouldUseVideoLocationReference(settings: Pick<MediaGenerationSettings, "videoUseLocationReferences" | "videoUseSceneImageReference">, aiDrama = false) {
  return settings.videoUseLocationReferences && (aiDrama || !settings.videoUseSceneImageReference);
}

import { DEFAULT_MEDIA_GENERATION_SETTINGS, IMAGE_DETAIL_LEVELS, type ImageDetailLevel, type ImageGenerationModelOption, type MediaGenerationSettings, type VideoGenerationModelOption } from "./project-types";

export const DEFAULT_IMAGE_MODEL_ID = "gemini-nano-banana-2.1";
export const MUSE_IMAGE_MODEL_ID = "muse-image";
export const MUSE_IMAGE_MODEL_OPTION: ImageGenerationModelOption = {
  id: MUSE_IMAGE_MODEL_ID,
  label: "Muse.ai",
  qualities: [],
  maxReferenceImages: 30,
};
export const FLOW_IMAGE_MODEL_OPTIONS: ImageGenerationModelOption[] = [
  { id: "flow-nano-banana-pro", label: "Nano Banana Pro · Flow", qualities: [], maxReferenceImages: 30 },
  { id: "flow-nano-banana-2-lite", label: "Nano Banana 2 Lite · Flow", qualities: [], maxReferenceImages: 30 },
  { id: "flow-nano-banana-2-1", label: "Nano Banana 2.1 · Flow", qualities: [], maxReferenceImages: 30 },
];
export const DEFAULT_SEEDANCE_VIDEO_MODEL_ID = "seedance-2.5";
export const DEFAULT_MUSE_VIDEO_MODEL_ID = "muse-video";
export const DEFAULT_FLOW_VIDEO_MODEL_ID = "flow-omni-1.1-flash";
export const FLOW_VIDEO_MODEL_OPTION: VideoGenerationModelOption = {
  id: DEFAULT_FLOW_VIDEO_MODEL_ID,
  label: "Flow Omni 1.1 Flash",
  provider: "flow",
  qualities: ["1080p"],
  aspectRatios: ["9:16", "16:9", "1:1", "4:3", "3:4"],
  minDurationSec: 6,
  maxDurationSec: 10,
  supportedDurationsSec: [6, 8, 10],
  supportsMultiShot: false,
  supportsAudio: false,
  supportsOffPeak: false,
  maxReferenceImages: 10,
  promptMaxLength: 12_000,
};
export const KLING_VIDEO_MODEL_ID = "kling-4.0";
export const PIXVERSE_SEEDANCE_2_FAST_MODEL_ID = "seedance-2.0-fast";
export const HIGGSFIELD_SEEDANCE_MODEL_ID = "higgsfield-seedance-2.0";
export const SEEDANCE_DIRECT_MAX_REFERENCE_IMAGES = 30;

const DIRECT_SEEDANCE_VIDEO_MODEL_IDS = new Set(["seedance-2.0", "seedance-2.5"]);

export function isDirectSeedanceVideoModel(modelId?: string) {
  return DIRECT_SEEDANCE_VIDEO_MODEL_IDS.has(modelId?.trim().toLowerCase() || "");
}

export function availableImageModels(models: ImageGenerationModelOption[] = []) {
  return models;
}

export function normalizeImageModelId(modelId?: string) {
  return modelId?.trim() || DEFAULT_IMAGE_MODEL_ID;
}

export function isMuseImageModel(modelId?: string) {
  return modelId?.trim().toLowerCase() === MUSE_IMAGE_MODEL_ID;
}

export function isFlowImageModel(modelId?: string) {
  return FLOW_IMAGE_MODEL_OPTIONS.some((model) => model.id === modelId?.trim().toLowerCase());
}

export function isFlowVideoProvider(provider?: string) {
  return provider === "flow";
}

export function imageModelDisplayName(modelId?: string) {
  if (isMuseImageModel(modelId)) return MUSE_IMAGE_MODEL_OPTION.label;
  return FLOW_IMAGE_MODEL_OPTIONS.find((model) => model.id === modelId)?.label || modelId || DEFAULT_IMAGE_MODEL_ID;
}

export function imageDetailLevelsForModel(model?: ImageGenerationModelOption): ImageDetailLevel[] {
  return (model?.detailLevels || []).filter((level): level is ImageDetailLevel => IMAGE_DETAIL_LEVELS.includes(level));
}

export function isPixverseVideoModel(modelId?: string) {
  const id = modelId?.trim().toLowerCase() || "";
  // MaiVideo's model catalog exposes PixVerse v6/C1 under short model IDs.
  return id.includes("pixverse") || id === "v6" || id === "c1";
}

export function isKlingVideoModel(modelId?: string) {
  return modelId?.trim().toLowerCase() === KLING_VIDEO_MODEL_ID;
}

export function isPixverseVideoSettings(settings: Pick<MediaGenerationSettings, "videoProvider" | "videoModel">) {
  return settings.videoProvider === "maivideo" && isPixverseVideoModel(settings.videoModel);
}

export function isMuseVideoSettings(settings: Pick<MediaGenerationSettings, "videoProvider">) {
  return settings.videoProvider === "muse";
}

export function isMaiVideoPixverseV56Model(model: { id: string; label?: string; provider?: string }) {
  if ((model.provider || "maivideo") !== "maivideo") return false;
  return [model.id, model.label || ""].some((value) => /(?:pixverse[\s_-]*)?(?:v)?5[._-]6\b/i.test(value.trim()));
}

export function isPixverseV6C1VideoModel(modelId?: string, modelLabel?: string) {
  const descriptor = `${modelId || ""} ${modelLabel || ""}`.trim().toLowerCase();
  const pixverse = isPixverseVideoModel(modelId) || /\bpixverse\b/i.test(descriptor);
  return pixverse && (/(?:^|[\s_-])c1(?:$|[\s_-])/.test(descriptor) || /(?:^|[\s_-])v6(?:$|[\s_-])/.test(descriptor));
}

export function filterPixverseVideoQualities(modelId: string, modelLabel: string, qualities: string[]) {
  const pixverse = isPixverseVideoModel(modelId) || /\bpixverse\b/i.test(`${modelId} ${modelLabel}`);
  return pixverse ? qualities.filter((quality) => !/^(?:360|540)p$/i.test(quality.trim())) : qualities;
}

function isRemovedPixverseVideoQuality(quality?: string) {
  return /^(?:360|540)p$/i.test(quality?.trim() || "");
}

export function isMaiVideoSeedanceModel(modelId?: string) {
  return modelId?.trim().toLowerCase().startsWith("seedance-") || false;
}

export function isHiggsfieldSeedanceModel(modelId?: string, provider?: string) {
  return provider === "higgsfield" || modelId?.trim().toLowerCase() === HIGGSFIELD_SEEDANCE_MODEL_ID;
}

export function isTemporarilyHiddenMaiVideoSeedance25(model: { id: string; label?: string; provider?: string }) {
  if ((model.provider || "maivideo") !== "maivideo") return false;
  return [model.id, model.label || ""].some((value) => /seedance(?:[\s_-]*)(?:v)?2(?:[._-]5)\b/i.test(value.trim()));
}

export function isTemporarilyHiddenSeedanceProvider(provider?: string) {
  return provider === "seedance";
}

export function visibleVideoModels(models: VideoGenerationModelOption[] = [], provider?: MediaGenerationSettings["videoProvider"]) {
  return models.filter((model) => !isTemporarilyHiddenMaiVideoSeedance25(model)
    && !isKlingVideoModel(model.id)
    && !isTemporarilyHiddenSeedanceProvider(model.provider)
    && !isMaiVideoPixverseV56Model(model)
    && (!provider || (model.provider || "maivideo") === provider));
}

export function videoModelDisplayName(modelId: string, provider?: string) {
  if (isTemporarilyHiddenMaiVideoSeedance25({ id: modelId, provider })) return "Model tạm ẩn";
  if (isHiggsfieldSeedanceModel(modelId, provider)) return "Seedance 2.0 · Higgsfield";
  if ((provider || "maivideo") === "maivideo" && modelId === PIXVERSE_SEEDANCE_2_FAST_MODEL_ID) return "Seedance 2.0 · PixVerse";
  if ((provider || "maivideo") === "maivideo" && isKlingVideoModel(modelId)) return "Kling 4.0";
  if (provider === "muse" && modelId === DEFAULT_MUSE_VIDEO_MODEL_ID) return "Muse.ai";
  return isMaiVideoPixverseV56Model({ id: modelId, provider }) ? "Model đã gỡ" : modelId;
}

export function isVideoOffPeakRequired(modelId?: string, modelLabel?: string) {
  const id = modelId?.trim().toLowerCase() || "";
  const label = modelLabel?.trim().toLowerCase() || "";
  if (isMaiVideoSeedanceModel(id)) return false;
  // MaiVideo's model catalog exposes PixVerse v6/C1 under short model IDs.
  return id.includes("pixverse") || label.includes("pixverse") || id === "v6" || id === "c1";
}

export function videoQualitiesForModel(model?: VideoGenerationModelOption, fallbackQuality?: string) {
  if (model?.provider === "flow") return ["1080p"];
  const qualities = model ? filterPixverseVideoQualities(model.id, model.label, model.qualities) : [];
  if (qualities.length) return qualities;
  return fallbackQuality && !isRemovedPixverseVideoQuality(fallbackQuality)
    ? [fallbackQuality]
    : model && isPixverseV6C1VideoModel(model.id, model.label) ? ["1080p"] : [];
}

export function preferredVideoQuality(modelId: string | undefined, currentQuality: string, supportedQualities: string[] = [], modelLabel?: string) {
  if (isPixverseV6C1VideoModel(modelId, modelLabel)) {
    const fullHd = supportedQualities.find((quality) => quality.trim().toLowerCase() === "1080p");
    return fullHd || "1080p";
  }
  return supportedQualities.length && !supportedQualities.includes(currentQuality) ? supportedQualities[0] : currentQuality;
}

export function videoDurationOptions(model?: VideoGenerationModelOption, quality = "") {
  if (model?.provider === "muse") return [5, 10];
  if (model?.provider === "flow") return [6, 8, 10];
  const maximumDuration = 15;
  const supported = model?.supportedDurationsSec?.filter((duration) => Number.isInteger(duration) && duration > 0 && duration <= maximumDuration);
  if (supported?.length) return [...new Set(supported)].sort((left, right) => left - right);
  const minimum = Math.max(1, Math.round(model?.minDurationSec || 1));
  const maximum = Math.min(maximumDuration, Math.max(minimum, Math.round(model?.maxDurationByQuality?.[quality] || model?.maxDurationSec || 15)));
  return Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index);
}

export function normalizeVideoDuration(requested: number, model?: VideoGenerationModelOption, quality = "") {
  const options = videoDurationOptions(model, quality);
  const duration = Math.max(1, Math.ceil(Number(requested) || options[0] || 1));
  return options.find((option) => option >= duration) ?? options[options.length - 1] ?? duration;
}

function normalizeMuseDuration(requested: number, fallback = 10) {
  const duration = Math.max(1, Math.ceil(Number(requested) || fallback || 10));
  return duration <= 5 ? 5 : 10;
}

function normalizeFlowDuration(requested: number, fallback = 8) {
  const duration = Math.max(1, Math.ceil(Number(requested) || fallback || 8));
  return [6, 8, 10].find((option) => option >= duration) ?? 10;
}

export function defaultMediaGenerationSettings(): MediaGenerationSettings {
  const configuredDuration = Number(process.env.MAIVIDEO_VIDEO_DURATION);
  const configuredVideoModel = process.env.MAIVIDEO_VIDEO_MODEL?.trim() || DEFAULT_MEDIA_GENERATION_SETTINGS.videoModel;
  const videoModel = isKlingVideoModel(configuredVideoModel)
    ? DEFAULT_MEDIA_GENERATION_SETTINGS.videoModel
    : isMaiVideoPixverseV56Model({ id: configuredVideoModel }) ? "pixverse-c1" : configuredVideoModel;
  const videoProvider = isHiggsfieldSeedanceModel(videoModel) ? "higgsfield" : isDirectSeedanceVideoModel(videoModel) ? "seedance" : videoModel === DEFAULT_FLOW_VIDEO_MODEL_ID ? "flow" : "maivideo";
  const pixverse = isPixverseVideoSettings({ videoProvider, videoModel });
  const maxVideoDuration = videoProvider === "flow" ? 10 : 15;
  const minVideoDuration = 1;
  const configuredVideoQuality = process.env.MAIVIDEO_VIDEO_QUALITY?.trim();
  return {
    videoProvider,
    seedanceChatMode: DEFAULT_MEDIA_GENERATION_SETTINGS.seedanceChatMode,
    imageModel: normalizeImageModelId(process.env.MAIVIDEO_IMAGE_MODEL || DEFAULT_MEDIA_GENERATION_SETTINGS.imageModel),
    imageQuality: process.env.MAIVIDEO_IMAGE_QUALITY?.trim() || DEFAULT_MEDIA_GENERATION_SETTINGS.imageQuality,
    imageDetailLevel: DEFAULT_MEDIA_GENERATION_SETTINGS.imageDetailLevel,
    videoModel,
    videoQuality: videoProvider === "flow"
      ? "1080p"
      : isPixverseVideoModel(videoModel)
      ? (isRemovedPixverseVideoQuality(configuredVideoQuality) ? "1080p" : configuredVideoQuality || "1080p")
      : configuredVideoQuality || DEFAULT_MEDIA_GENERATION_SETTINGS.videoQuality,
    videoDurationMode: DEFAULT_MEDIA_GENERATION_SETTINGS.videoDurationMode,
    videoDurationSec: videoProvider === "flow"
      ? normalizeFlowDuration(configuredDuration, DEFAULT_MEDIA_GENERATION_SETTINGS.videoDurationSec)
      : Math.min(maxVideoDuration, Math.max(minVideoDuration, Number.isFinite(configuredDuration) && configuredDuration > 0 ? Math.round(configuredDuration) : DEFAULT_MEDIA_GENERATION_SETTINGS.videoDurationSec)),
    videoMultiShot: pixverse ? true : DEFAULT_MEDIA_GENERATION_SETTINGS.videoMultiShot,
    videoAudio: pixverse ? true : DEFAULT_MEDIA_GENERATION_SETTINGS.videoAudio,
    videoOffPeak: DEFAULT_MEDIA_GENERATION_SETTINGS.videoOffPeak,
    imageUseCharacterReferences: DEFAULT_MEDIA_GENERATION_SETTINGS.imageUseCharacterReferences,
    videoUseCharacterReferences: DEFAULT_MEDIA_GENERATION_SETTINGS.videoUseCharacterReferences,
    videoUseLocationReferences: DEFAULT_MEDIA_GENERATION_SETTINGS.videoUseLocationReferences,
    videoUseSceneImageReference: DEFAULT_MEDIA_GENERATION_SETTINGS.videoUseSceneImageReference,
    flowReferenceMode: DEFAULT_MEDIA_GENERATION_SETTINGS.flowReferenceMode,
  };
}

export function resolveMediaGenerationSettings(settings?: Partial<MediaGenerationSettings>): MediaGenerationSettings {
  const defaults = defaultMediaGenerationSettings();
  const duration = Number(settings?.videoDurationSec);
  const imageDetailLevel = IMAGE_DETAIL_LEVELS.find((level) => level === settings?.imageDetailLevel) || defaults.imageDetailLevel;
  const configuredVideoModel = settings?.videoModel?.trim() || defaults.videoModel;
  const videoProvider = settings?.videoProvider === "seedance" || settings?.videoProvider === "higgsfield" || settings?.videoProvider === "maivideo" || settings?.videoProvider === "muse" || settings?.videoProvider === "flow"
    ? settings.videoProvider
    : isHiggsfieldSeedanceModel(configuredVideoModel) ? "higgsfield" : isDirectSeedanceVideoModel(configuredVideoModel) ? "seedance" : configuredVideoModel === DEFAULT_FLOW_VIDEO_MODEL_ID ? "flow" : "maivideo";
  const storedVideoModel = videoProvider === "maivideo" && isKlingVideoModel(configuredVideoModel)
    ? DEFAULT_MEDIA_GENERATION_SETTINGS.videoModel
    : videoProvider === "maivideo" && isMaiVideoPixverseV56Model({ id: configuredVideoModel, provider: videoProvider })
      ? "pixverse-c1"
      : configuredVideoModel;
  const videoModel = videoProvider === "seedance"
    ? isDirectSeedanceVideoModel(storedVideoModel) ? storedVideoModel : DEFAULT_SEEDANCE_VIDEO_MODEL_ID
    : videoProvider === "higgsfield" ? HIGGSFIELD_SEEDANCE_MODEL_ID
      : videoProvider === "muse" ? DEFAULT_MUSE_VIDEO_MODEL_ID
        : videoProvider === "flow" ? DEFAULT_FLOW_VIDEO_MODEL_ID : storedVideoModel;
  const flowReferenceMode = settings?.flowReferenceMode === "frames" ? "frames" : "ingredients";
  const seedanceChatMode = settings?.seedanceChatMode === "Pro" ? "Pro" : "Fast";
  const pixverse = isPixverseVideoSettings({ videoProvider, videoModel });
  const maxVideoDuration = videoProvider === "muse" ? 10 : videoProvider === "flow" ? 10 : 15;
  const minVideoDuration = 1;
  const maiVideoSeedance = videoProvider === "maivideo" && isMaiVideoSeedanceModel(videoModel);
  const requiresOffPeak = videoProvider === "maivideo" && isVideoOffPeakRequired(videoModel);
  return {
    videoProvider,
    seedanceAccountId: settings?.seedanceAccountId?.trim() || "",
    seedanceChatMode,
    imageModel: normalizeImageModelId(settings?.imageModel || defaults.imageModel),
    imageQuality: settings?.imageQuality?.trim() || defaults.imageQuality,
    imageDetailLevel,
    videoModel,
    videoQuality: videoProvider === "flow"
      ? "1080p"
      : pixverse && isRemovedPixverseVideoQuality(settings?.videoQuality)
        ? "1080p"
        : settings?.videoQuality?.trim() || (pixverse ? "1080p" : defaults.videoQuality),
    videoDurationMode: settings?.videoDurationMode === "fixed" ? "fixed" : "scene",
    videoDurationSec: videoProvider === "muse"
      ? normalizeMuseDuration(duration, defaults.videoDurationSec)
      : videoProvider === "flow"
        ? normalizeFlowDuration(duration, defaults.videoDurationSec)
      : Math.min(maxVideoDuration, Math.max(minVideoDuration, Number.isFinite(duration) && duration > 0 ? Math.round(duration) : defaults.videoDurationSec)),
    videoMultiShot: pixverse ? true : settings?.videoMultiShot ?? defaults.videoMultiShot,
    videoAudio: pixverse ? true : settings?.videoAudio ?? defaults.videoAudio,
    videoOffPeak: requiresOffPeak ? true : maiVideoSeedance ? false : settings?.videoOffPeak ?? defaults.videoOffPeak,
    imageUseCharacterReferences: settings?.imageUseCharacterReferences ?? defaults.imageUseCharacterReferences,
    videoUseCharacterReferences: settings?.videoUseCharacterReferences ?? defaults.videoUseCharacterReferences,
    videoUseLocationReferences: settings?.videoUseLocationReferences ?? defaults.videoUseLocationReferences,
    videoUseSceneImageReference: videoProvider === "flow" && flowReferenceMode === "frames"
      ? true
      : settings?.videoUseSceneImageReference ?? defaults.videoUseSceneImageReference,
    flowReferenceMode,
  };
}

export function shouldUseVideoLocationReference(settings: Pick<MediaGenerationSettings, "videoUseLocationReferences" | "videoUseSceneImageReference">, aiDrama = false) {
  return settings.videoUseLocationReferences && (aiDrama || !settings.videoUseSceneImageReference);
}

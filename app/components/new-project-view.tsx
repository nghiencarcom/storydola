"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_PRESET_ID, STORY_PRESETS, type StoryPresetId } from "../lib/story-presets";
import { useProjects } from "../lib/project-store";
import { FALLBACK_VIDEO_LANGUAGES, voiceLanguageLabel, type OmniVoiceCatalog, type OmniVoiceOption } from "../lib/omnivoice";
import { formatDurationLabel, getManualScriptMetrics } from "../lib/script-utils";
import { DEFAULT_MEDIA_GENERATION_SETTINGS, IMAGE_DETAIL_LEVEL_LABELS, MAX_PROJECT_CHUNK_SIZE, MAX_SCENE_DURATION_SEC, MIN_PROJECT_CHUNK_SIZE, PROJECT_CHUNK_SIZE_PRESETS, slugify, type DramaProjectPlan, type DurationMode, type ImageGenerationModelOption, type MediaGenerationSettings, type MediaModelCatalog, type MediaSource, type ScriptFormat, type ScriptMode, type VideoGenerationModelOption } from "../lib/project-types";
import { availableImageModels, DEFAULT_MAIVIDEO_VIDEO_MODEL_ID, DEFAULT_SEEDANCE_VIDEO_MODEL_ID, imageDetailLevelsForModel, isVideoOffPeakRequired, normalizeVideoDuration, preferredVideoQuality, resolveMediaGenerationSettings, videoDurationOptions, videoQualitiesForModel } from "../lib/media-generation-settings";
import { DEFAULT_IMAGE_STYLE, DEFAULT_VISUAL_STYLE, IMAGE_STYLE_OPTIONS, IMAGE_STYLE_PRESETS } from "../lib/visual-styles";
import { CONTENT_GENRES, DEFAULT_CONTENT_GENRE, DEFAULT_STORY_SETTING, normalizeContentGenre, normalizeSecondaryGenres, normalizeStorySetting, STORY_SETTING_OPTIONS } from "../lib/content-genres";
import { AI_DRAMA_JSON_TEMPLATE, AI_DRAMA_SOURCE_SCRIPT_TEMPLATE } from "../lib/project-script-templates";
import { Icon } from "./ui-icon";

type FormState = {
  title: string;
  sourceUrl: string;
  sourceText: string;
  scriptMode: ScriptMode;
  scriptFormat: ScriptFormat;
  durationMode: DurationMode;
  presetId: StoryPresetId;
  durationMinutes: number;
  chunkSize: number;
  language: string;
  voiceProvider: "omnivoice";
  voiceId: string;
  voiceName: string;
  voiceLanguage: string;
  contentGenre: string;
  secondaryGenres: string[];
  storySetting: string;
  settingNotes: string;
  visualStyle: string;
  imageStyle: string;
  aspectRatio: string;
  mediaSource: MediaSource;
  mediaGeneration: MediaGenerationSettings;
};

type ScriptEntryMode = "ai" | "manual" | "json";
type ScriptJsonSummary = { schema: "scene-script.v1" | "scene-series.v1"; episodeCount: number; sceneCount: number };
type PendingScriptImport = { slug: string; title: string };

const NEW_PROJECT_MEDIA_GENERATION_DEFAULTS: MediaGenerationSettings = {
  ...DEFAULT_MEDIA_GENERATION_SETTINGS,
  videoProvider: "maivideo",
  videoModel: DEFAULT_MAIVIDEO_VIDEO_MODEL_ID,
  videoQuality: "720p",
  imageModel: "gpt-image-2.5-flare",
  imageQuality: "1440p",
  imageDetailLevel: "medium",
};

const ASPECT_RATIO_ORDER = ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "21:9"];
const DEFAULT_PROJECT_ASPECT_RATIOS = ["16:9", "9:16", "1:1"];
const ASPECT_RATIO_LABELS: Record<string, string> = {
  "16:9": "16:9 · YouTube",
  "9:16": "9:16 · Shorts",
  "1:1": "1:1 · Social",
};

function projectAspectRatioOptions(
  imageModel: ImageGenerationModelOption | undefined,
  imageQuality: string,
  videoModel: VideoGenerationModelOption | undefined,
) {
  const imageRatios = imageModel?.aspectRatiosByQuality?.[imageQuality]
    || Object.values(imageModel?.aspectRatiosByQuality || {}).flat();
  const videoRatios = videoModel?.aspectRatios || [];
  const candidates = [...new Set([...ASPECT_RATIO_ORDER, ...imageRatios, ...videoRatios])];
  const supported = candidates.filter((ratio) =>
    (!imageRatios.length || imageRatios.includes(ratio))
    && (!videoRatios.length || videoRatios.includes(ratio)),
  );
  return supported.length ? supported : DEFAULT_PROJECT_ASPECT_RATIOS;
}

const CONTENT_GENRE_EN_LABELS: Record<(typeof CONTENT_GENRES)[number]["value"], string> = {
  action: "Action",
  adventure: "Adventure / Exploration",
  "science-fiction": "Science Fiction",
  horror: "Horror",
  fantasy: "Fantasy",
  "mystery-thriller": "Mystery / Thriller",
  drama: "Drama",
  comedy: "Comedy",
  romance: "Romance",
  "animal-adventure": "Animal Adventure",
};

const STORY_SETTING_EN_LABELS: Record<(typeof STORY_SETTING_OPTIONS)[number]["value"], string> = {
  unspecified: "As established in the script",
  modern: "Contemporary",
  historical: "Historical / Period Setting",
  future: "Future",
  "fantasy-world": "Fantasy World",
};

const IMAGE_STYLE_EN_LABELS: Record<(typeof IMAGE_STYLE_PRESETS)[number]["value"], string> = {
  Photorealistic: "Photorealistic · Live Action / CGI",
  "2D anime": "2D Anime",
  "2D action anime": "2D Action Anime",
  "Hand-drawn fantasy animation": "Hand-drawn Fantasy Animation",
  "2D animation": "2D Animation",
  "2D storybook": "2D Storybook Illustration",
  "Stylized 3D": "Stylized 3D Animation",
  "Illustrated 3D animation": "Illustrated 3D Animation",
  "Family 3D animation": "Family 3D Animation",
  "Painterly illustration": "Painterly Illustration",
  "Graphic novel": "Graphic Novel Animation",
  "Stop-motion clay": "Stop-motion Clay Animation",
};

function inspectScriptJson(value: unknown): ScriptJsonSummary {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  if (!record) throw new Error("JSON phải có object ở cấp cao nhất.");
  if (record.schema === "scene-script.v1") {
    const scenes = Array.isArray(record.scenes) ? record.scenes.length : 0;
    if (!scenes) throw new Error("scene-script.v1 cần có mảng scenes.");
    return { schema: "scene-script.v1", episodeCount: 1, sceneCount: scenes };
  }
  if (record.schema === "scene-series.v1" && Array.isArray(record.episodes) && record.episodes.length) {
    if (record.episodes.length > 100) throw new Error("Một file nhập tối đa 100 tập.");
    const sceneCount = record.episodes.reduce((count, episode, index) => {
      const item = episode && typeof episode === "object" && !Array.isArray(episode) ? episode as Record<string, unknown> : undefined;
      if (!item || item.schema !== "scene-script.v1" || !Array.isArray(item.scenes) || !item.scenes.length) {
        throw new Error(`Tập thứ ${index + 1} cần có schema scene-script.v1 và mảng scenes.`);
      }
      return count + item.scenes.length;
    }, 0);
    return { schema: "scene-series.v1", episodeCount: record.episodes.length, sceneCount };
  }
  throw new Error("File cần theo schema scene-script.v1 hoặc scene-series.v1.");
}

const emptyForm: FormState = {
  title: "",
  sourceUrl: "",
  sourceText: "",
  scriptMode: "ai",
  scriptFormat: "plain_text",
  durationMode: "manual",
  presetId: DEFAULT_PRESET_ID,
  durationMinutes: 60,
  chunkSize: 20,
  language: "en-US",
  voiceProvider: "omnivoice",
  voiceId: "",
  voiceName: "",
  voiceLanguage: "en-US",
  contentGenre: DEFAULT_CONTENT_GENRE,
  secondaryGenres: [],
  storySetting: DEFAULT_STORY_SETTING,
  settingNotes: "",
  visualStyle: DEFAULT_VISUAL_STYLE,
  imageStyle: DEFAULT_IMAGE_STYLE,
  aspectRatio: "16:9",
  mediaSource: "stock-mixed",
  mediaGeneration: NEW_PROJECT_MEDIA_GENERATION_DEFAULTS,
};

export function NewProjectView({ projectSlug, fixedPresetId }: { projectSlug?: string; fixedPresetId?: StoryPresetId }) {
  const { getProject, createProject, updateProject, provider, refresh } = useProjects();
  const existing = projectSlug ? getProject(projectSlug) : undefined;
  const isFixedAiDramaCreation = !projectSlug && fixedPresetId === "ai-drama";
  const [form, setForm] = useState<FormState>(() => ({ ...emptyForm, presetId: fixedPresetId || emptyForm.presetId }));
  const [customChunkSize, setCustomChunkSize] = useState(false);
  const [voiceCatalog, setVoiceCatalog] = useState<OmniVoiceCatalog | null>(null);
  const [voiceCatalogLoading, setVoiceCatalogLoading] = useState(true);
  const [voiceCatalogRetry, setVoiceCatalogRetry] = useState(0);
  const [mediaCatalog, setMediaCatalog] = useState<MediaModelCatalog | null>(null);
  const [mediaCatalogError, setMediaCatalogError] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [error, setError] = useState("");
  const [sourceTemplateCopyStatus, setSourceTemplateCopyStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [characterSetupPrompt, setCharacterSetupPrompt] = useState<{ slug: string; title: string } | null>(null);
  const [scriptEntryMode, setScriptEntryMode] = useState<ScriptEntryMode>("ai");
  const [scriptJsonText, setScriptJsonText] = useState("");
  const [scriptJsonSourceName, setScriptJsonSourceName] = useState("");
  const [scriptJsonSummary, setScriptJsonSummary] = useState<ScriptJsonSummary | null>(null);
  const [pendingScriptImport, setPendingScriptImport] = useState<PendingScriptImport | null>(null);
  const [projectCreatedFromJson, setProjectCreatedFromJson] = useState(false);
  const [dramaIdea, setDramaIdea] = useState("");
  const [dramaBriefSnapshot, setDramaBriefSnapshot] = useState("");
  const [generatingDramaSource, setGeneratingDramaSource] = useState(false);
  const [dramaSourceProgress, setDramaSourceProgress] = useState("");
  const [dramaSourceModel, setDramaSourceModel] = useState("");
  const [dramaPlan, setDramaPlan] = useState<DramaProjectPlan | null>(null);
  const scriptJsonInputRef = useRef<HTMLInputElement>(null);
  const mediaGenerationTouched = useRef(false);
  const mediaSourceTouched = useRef(false);
  const presetFromUrlApplied = useRef(false);
  const hydratedExistingSlug = useRef<string | null>(null);

  useEffect(() => {
    if (projectSlug || !fixedPresetId) return;
    setForm((current) => ({
      ...current,
      presetId: fixedPresetId,
      mediaSource: fixedPresetId === "ai-drama" ? "maivideo-video" : "stock-mixed",
      ...(fixedPresetId === "ai-drama" ? { mediaGeneration: { ...current.mediaGeneration, videoDurationMode: "scene" as const } } : {}),
    }));
  }, [fixedPresetId, projectSlug]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/media-models", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "Không lấy được danh sách model media.");
        return payload as MediaModelCatalog;
      })
      .then((catalog) => {
        if (cancelled) return;
        setMediaCatalog(catalog);
        setMediaCatalogError("");
        if (!projectSlug && !mediaGenerationTouched.current) {
          const imageModels = availableImageModels(catalog.imageModels);
          const videoModels = catalog.videoModels.filter((model) => (model.provider || "maivideo") === "maivideo");
          const initialSettings = { ...catalog.defaults, ...NEW_PROJECT_MEDIA_GENERATION_DEFAULTS };
          const selectedImage = imageModels.find((model) => model.id === initialSettings.imageModel)
            || imageModels.find((model) => model.id === "gpt-image-2.5-flare")
            || imageModels[0];
          const selectedVideo = videoModels.find((model) => model.id === initialSettings.videoModel)
            || videoModels.find((model) => model.id === DEFAULT_MAIVIDEO_VIDEO_MODEL_ID)
            || videoModels[0];
          const imageQuality = selectedImage?.qualities.length && !selectedImage.qualities.includes(initialSettings.imageQuality)
            ? selectedImage.qualities[0]
            : initialSettings.imageQuality;
          const imageDetailLevels = imageDetailLevelsForModel(selectedImage);
          const imageDetailLevel = imageDetailLevels.includes(initialSettings.imageDetailLevel)
            ? initialSettings.imageDetailLevel
            : imageDetailLevels[0] || initialSettings.imageDetailLevel;
          const videoQuality = preferredVideoQuality(
            selectedVideo?.id || initialSettings.videoModel,
            initialSettings.videoQuality,
            videoQualitiesForModel(selectedVideo, initialSettings.videoQuality),
          );
          const videoSettings = resolveMediaGenerationSettings({
            ...initialSettings,
            videoProvider: "maivideo",
            ...(selectedImage ? { imageModel: selectedImage.id } : {}),
            imageQuality,
            imageDetailLevel,
            ...(selectedVideo ? { videoModel: selectedVideo.id } : {}),
            videoQuality,
            videoDurationSec: normalizeVideoDuration(initialSettings.videoDurationSec, selectedVideo, videoQuality),
            ...(selectedVideo?.supportsMultiShot === false ? { videoMultiShot: false } : {}),
            ...(selectedVideo?.supportsAudio === false ? { videoAudio: false } : {}),
            ...(isVideoOffPeakRequired(selectedVideo?.id, selectedVideo?.label) ? { videoOffPeak: true } : selectedVideo?.supportsOffPeak === false ? { videoOffPeak: false } : {}),
          });
          setForm((current) => ({ ...current, mediaGeneration: videoSettings }));
        }
      })
      .catch((cause) => {
        if (!cancelled) setMediaCatalogError(cause instanceof Error ? cause.message : "Không lấy được danh sách model media.");
      });
    return () => { cancelled = true; };
  }, [projectSlug]);

  useEffect(() => {
    let cancelled = false;
    setVoiceCatalogLoading(true);
    setVoiceError("");
    fetch("/api/omnivoice/voices", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as (Partial<OmniVoiceCatalog> & { message?: string; code?: string }) | null;
        if (!response.ok) {
          throw Object.assign(new Error(payload?.message || `Không lấy được danh sách giọng OmniVoice (HTTP ${response.status}).`), { code: payload?.code });
        }
        if (!payload || !Array.isArray(payload.voices)) throw new Error("MaiVideo không trả về danh sách voice hợp lệ.");
        return {
          provider: "omnivoice" as const,
          voices: payload.voices,
          languages: Array.isArray(payload.languages) ? payload.languages : [],
        } satisfies OmniVoiceCatalog;
      })
      .then((catalog) => {
        if (cancelled) return;
        setVoiceCatalog(catalog);
        if (!catalog.voices.length) {
          setVoiceError("MaiVideo phản hồi thành công nhưng catalog OmniVoice hiện không có giọng nào.");
          return;
        }
        setForm((current) => {
          const currentVoice = catalog.voices.find((voice) => voice.id === current.voiceId);
          const matchingVoice = currentVoice || catalog.voices.find((voice) => voice.language === current.language) || catalog.voices[0];
          if (!matchingVoice) return current;
          return {
            ...current,
            voiceId: matchingVoice.id,
            voiceName: matchingVoice.name,
            voiceLanguage: matchingVoice.language,
          };
        });
      })
      .catch((cause) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : "Không lấy được danh sách giọng OmniVoice.";
        const code = cause instanceof Error && "code" in cause ? String(cause.code || "") : "";
        if (message === "MAIVIDEO_API_KEY_REQUIRED" || code === "MAIVIDEO_API_KEY_REQUIRED") {
          setVoiceError("Chưa có API key MaiVideo cho tài khoản này. Hãy cấu hình key trong Cài đặt rồi thử tải lại.");
        } else if (message === "STORYAI_AUTH_REQUIRED" || code === "MAIVIDEO_AUTH_REQUIRED" || message.includes("MAIVIDEO_AUTH_REQUIRED")) {
          setVoiceError("Phiên đăng nhập MaiVideo đã hết hạn. Hãy đăng nhập lại rồi thử tải lại danh sách giọng.");
        } else if (code === "MAIVIDEO_API_KEY_INVALID" || message.includes("401")) {
          setVoiceError("API key MaiVideo bị thiếu hiệu lực hoặc đã bị thu hồi. Cập nhật key trong Cài đặt rồi thử tải lại.");
        } else if (message === "MAIVIDEO_VOICE_CATALOG_INVALID_RESPONSE") {
          setVoiceError("MaiVideo trả về dữ liệu catalog không đúng định dạng. Hãy tải lại; nếu tiếp tục lỗi, kiểm tra endpoint /api/v1/voices.");
        } else if (message === "MAIVIDEO_VOICE_CATALOG_UNRECOGNIZED_VOICES") {
          setVoiceError("MaiVideo có trả về voice nhưng ứng dụng không nhận diện được trường ID, tên hoặc ngôn ngữ.");
        } else {
          setVoiceError(`Không tải được danh sách giọng từ MaiVideo: ${message}`);
        }
      })
      .finally(() => { if (!cancelled) setVoiceCatalogLoading(false); });
    return () => { cancelled = true; };
  }, [voiceCatalogRetry]);

  useEffect(() => {
    if (!projectSlug) hydratedExistingSlug.current = null;
    if (existing && hydratedExistingSlug.current !== existing.slug) {
      hydratedExistingSlug.current = existing.slug;
      setCustomChunkSize(!PROJECT_CHUNK_SIZE_PRESETS.includes(existing.chunkSize as (typeof PROJECT_CHUNK_SIZE_PRESETS)[number]));
      const catalogVoice = existing.voiceId
        ? voiceCatalog?.voices.find((voice) => voice.id === existing.voiceId)
        : voiceCatalog?.voices.find((voice) => voice.language === (existing.voiceLanguage || existing.language));
      setForm({
        title: existing.title,
        sourceUrl: existing.sourceUrl,
        sourceText: existing.sourceText,
        scriptMode: existing.scriptMode || "ai",
        scriptFormat: existing.scriptFormat || "plain_text",
        durationMode: existing.durationMode || (existing.scriptMode === "manual" ? "auto" : "manual"),
        presetId: existing.presetId,
        durationMinutes: existing.durationMinutes,
        chunkSize: existing.chunkSize,
        language: existing.language,
        voiceProvider: existing.voiceProvider || "omnivoice",
        voiceId: existing.voiceId || catalogVoice?.id || "",
        voiceName: existing.voiceName || catalogVoice?.name || "",
        voiceLanguage: existing.voiceLanguage || catalogVoice?.language || existing.language,
        contentGenre: normalizeContentGenre(existing.contentGenre),
        secondaryGenres: normalizeSecondaryGenres(existing.secondaryGenres, existing.contentGenre),
        storySetting: normalizeStorySetting(existing.storySetting),
        settingNotes: existing.settingNotes || "",
        visualStyle: existing.visualStyle,
        imageStyle: existing.imageStyle || DEFAULT_IMAGE_STYLE,
        aspectRatio: existing.aspectRatio,
        mediaSource: existing.mediaSource || "stock-mixed",
        mediaGeneration: {
          ...resolveMediaGenerationSettings(existing.mediaGeneration),
          ...(existing.presetId === "ai-drama" ? { videoDurationMode: "scene" as const } : {}),
        },
      });
    }
    if (!projectSlug && !fixedPresetId && !presetFromUrlApplied.current) {
      presetFromUrlApplied.current = true;
      const presetFromUrl = new URLSearchParams(window.location.search).get("preset") as StoryPresetId | null;
      if (presetFromUrl && STORY_PRESETS[presetFromUrl]) setForm((current) => ({
        ...current,
        presetId: presetFromUrl,
        ...(presetFromUrl === "ai-drama" ? { mediaSource: "maivideo-video" } : !mediaSourceTouched.current ? { mediaSource: "stock-mixed" } : {}),
      }));
    }
  }, [existing, voiceCatalog?.voices, fixedPresetId, projectSlug]);

  useEffect(() => {
    const existingSlug = existing?.slug;
    const existingMediaGeneration = existing?.mediaGeneration;
    if (!existingSlug || existingMediaGeneration || !mediaCatalog || mediaGenerationTouched.current) return;
    setForm((current) => ({ ...current, mediaGeneration: mediaCatalog.defaults }));
  }, [existing?.slug, existing?.mediaGeneration, mediaCatalog]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectPrimaryGenre(value: string) {
    setForm((current) => ({
      ...current,
      contentGenre: value,
      secondaryGenres: normalizeSecondaryGenres(current.secondaryGenres, value),
    }));
  }

  function toggleSecondaryGenre(value: string) {
    setForm((current) => {
      const selected = normalizeSecondaryGenres(current.secondaryGenres, current.contentGenre);
      const next = selected.includes(value as (typeof CONTENT_GENRES)[number]["value"])
        ? selected.filter((genre) => genre !== value)
        : [...selected, value as (typeof CONTENT_GENRES)[number]["value"]];
      return { ...current, secondaryGenres: normalizeSecondaryGenres(next, current.contentGenre) };
    });
  }

  function setMediaSettings(patch: Partial<MediaGenerationSettings>) {
    mediaGenerationTouched.current = true;
    setForm((current) => ({ ...current, mediaGeneration: { ...current.mediaGeneration, ...patch, ...(current.presetId === "ai-drama" ? { videoDurationMode: "scene" as const } : {}) } }));
  }

  function selectImageModel(imageModel: string, currentQuality: string) {
    const selected = availableImageModels(mediaCatalog?.imageModels || []).find((item) => item.id === imageModel);
    const imageQuality = selected?.qualities.length && !selected.qualities.includes(currentQuality)
      ? selected.qualities[0]
      : currentQuality;
    const detailLevels = imageDetailLevelsForModel(selected);
    const imageDetailLevel = detailLevels.includes(form.mediaGeneration.imageDetailLevel)
      ? form.mediaGeneration.imageDetailLevel
      : detailLevels[0];
    setMediaSettings({ imageModel, imageQuality, ...(imageDetailLevel ? { imageDetailLevel } : {}) });
  }

  function videoDurationLimit(model: VideoGenerationModelOption | undefined, quality: string) {
    return Math.min(15, model?.maxDurationByQuality?.[quality] || model?.maxDurationSec || 15);
  }

  function selectVideoModel(videoModel: string) {
    const selected = mediaCatalog?.videoModels.find((item) => item.id === videoModel && (item.provider || "maivideo") === form.mediaGeneration.videoProvider);
    const currentQuality = form.mediaGeneration.videoQuality;
    const videoQuality = preferredVideoQuality(videoModel, currentQuality, videoQualitiesForModel(selected, currentQuality));
    const maxDuration = videoDurationLimit(selected, videoQuality);
    const videoDurationSec = selected?.supportedDurationsSec?.length
      ? normalizeVideoDuration(form.mediaGeneration.videoDurationSec, selected, videoQuality)
      : Math.min(maxDuration, Math.max(selected?.minDurationSec || 1, form.mediaGeneration.videoDurationSec));
    setMediaSettings({
      videoProvider: selected?.provider || form.mediaGeneration.videoProvider,
      videoModel,
      videoQuality,
      videoDurationSec,
      ...(selected?.supportsMultiShot === false ? { videoMultiShot: false } : {}),
      ...(isVideoOffPeakRequired(videoModel, selected?.label) ? { videoOffPeak: true } : selected?.supportsOffPeak === false ? { videoOffPeak: false } : {}),
    });
  }

  function selectVideoProvider(videoProvider: MediaGenerationSettings["videoProvider"]) {
    const models = (mediaCatalog?.videoModels || []).filter((item) => (item.provider || "maivideo") === videoProvider);
    const currentModel = models.find((item) => item.id === form.mediaGeneration.videoModel);
    const defaultModelId = videoProvider === "seedance" ? DEFAULT_SEEDANCE_VIDEO_MODEL_ID : DEFAULT_MAIVIDEO_VIDEO_MODEL_ID;
    const selected = currentModel || models.find((item) => item.id === defaultModelId) || models[0];
    const videoModel = selected?.id || defaultModelId;
    const videoQuality = preferredVideoQuality(videoModel, form.mediaGeneration.videoQuality, videoQualitiesForModel(selected, form.mediaGeneration.videoQuality));
    setMediaSettings({
      videoProvider,
      videoModel,
      videoQuality,
      videoDurationSec: normalizeVideoDuration(form.mediaGeneration.videoDurationSec, selected, videoQuality),
      ...(selected?.supportsMultiShot === false ? { videoMultiShot: false } : {}),
      ...(selected?.supportsAudio === false ? { videoAudio: false } : {}),
      ...(isVideoOffPeakRequired(videoModel, selected?.label) ? { videoOffPeak: true } : selected?.supportsOffPeak === false ? { videoOffPeak: false } : {}),
    });
  }

  function selectVideoQuality(videoQuality: string) {
    const selected = mediaCatalog?.videoModels.find((item) => item.id === form.mediaGeneration.videoModel && (item.provider || "maivideo") === form.mediaGeneration.videoProvider);
    const maxDuration = videoDurationLimit(selected, videoQuality);
    setMediaSettings({ videoQuality, videoDurationSec: Math.min(maxDuration, form.mediaGeneration.videoDurationSec) });
  }

  function selectScriptMode(scriptMode: ScriptMode) {
    setForm((current) => ({
      ...current,
      scriptMode,
      durationMode: scriptMode === "manual" ? "auto" : "manual",
    }));
  }

  function selectDurationMode(durationMode: DurationMode) {
    setForm((current) => ({ ...current, durationMode }));
  }

  function selectVideoLanguage(language: string) {
    setForm((current) => ({ ...current, language }));
  }

  function selectVoice(voiceId: string) {
    const voice = voiceCatalog?.voices.find((item) => item.id === voiceId);
    if (!voice) return;
    setForm((current) => ({
      ...current,
      voiceId: voice.id,
      voiceName: voice.name,
      voiceLanguage: voice.language,
    }));
  }

  function selectScriptEntryMode(mode: ScriptEntryMode) {
    setError("");
    setScriptEntryMode(mode);
    if (mode === "ai" || mode === "manual") selectScriptMode(mode);
  }

  async function selectScriptJsonFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setScriptJsonText("");
    setScriptJsonSourceName(file.name);
    setScriptJsonSummary(null);
    setError("");
    try {
      const text = await file.text();
      setScriptJsonText(text);
      const summary = inspectScriptJson(JSON.parse(text));
      setScriptJsonSummary(summary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không đọc được file JSON.");
    }
  }

  function validateScriptJsonInput() {
    setError("");
    setScriptJsonSummary(null);
    if (!scriptJsonText.trim()) {
      setError("Dán nội dung JSON hoặc chọn file JSON trước khi tiếp tục.");
      return false;
    }
    try {
      const summary = inspectScriptJson(JSON.parse(scriptJsonText));
      setScriptJsonSummary(summary);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không đọc được nội dung JSON.");
      return false;
    }
  }

  function loadDramaSourceTemplate() {
    if (form.sourceText.trim() && !window.confirm("Thay toàn bộ kịch bản nguồn hiện tại bằng mẫu AI Drama?")) return;
    setField("sourceText", AI_DRAMA_SOURCE_SCRIPT_TEMPLATE);
    setDramaPlan(null);
    setDramaBriefSnapshot("");
    setDramaSourceModel("");
    setError("");
    setSourceTemplateCopyStatus("");
  }

  async function copyDramaSourceTemplate() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Trình duyệt không hỗ trợ clipboard.");
      await navigator.clipboard.writeText(AI_DRAMA_SOURCE_SCRIPT_TEMPLATE);
      setSourceTemplateCopyStatus("Đã sao chép mẫu kịch bản nguồn.");
    } catch {
      setSourceTemplateCopyStatus("Không thể sao chép. Hãy kiểm tra quyền clipboard của trình duyệt.");
    }
  }

  function loadDramaJsonTemplate() {
    if (scriptJsonText.trim() && !window.confirm("Thay toàn bộ JSON hiện tại bằng mẫu AI Drama?")) return;
    setScriptJsonText(AI_DRAMA_JSON_TEMPLATE);
    setScriptJsonSourceName("");
    setScriptJsonSummary(inspectScriptJson(JSON.parse(AI_DRAMA_JSON_TEMPLATE)));
    setError("");
  }

  async function importJsonIntoProject(project: Pick<PendingScriptImport, "slug">, text: string) {
    const bundle = JSON.parse(text) as unknown;
    inspectScriptJson(bundle);
    const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/import-scripts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundle, replace: false, preserveProjectSettings: true }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể nhập kịch bản JSON.");
  }

  async function generateDramaSource() {
    if (!Number.isInteger(form.chunkSize) || form.chunkSize < MIN_PROJECT_CHUNK_SIZE || form.chunkSize > MAX_PROJECT_CHUNK_SIZE) {
      setError(`Số cảnh mỗi chunk phải là số nguyên từ ${MIN_PROJECT_CHUNK_SIZE} đến ${MAX_PROJECT_CHUNK_SIZE}.`);
      return;
    }
    if (!form.title.trim()) {
      setError("Vui lòng nhập tên dự án trước khi viết kịch bản AI Drama.");
      return;
    }
    if (!form.imageStyle.trim()) {
      setError("Hãy nhập phong cách hình ảnh tùy chỉnh trước khi viết kịch bản AI Drama.");
      return;
    }
    if (form.storySetting === "historical" && !form.settingNotes.trim()) {
      setError("Hãy ghi rõ thời đại hoặc địa điểm lịch sử để AI giữ đúng bối cảnh.");
      return;
    }
    if (dramaIdea.trim().length < 20) {
      setError("Hãy mô tả ý tưởng ít nhất 20 ký tự để AI có đủ chất liệu viết kịch bản.");
      return;
    }
    setError("");
    setGeneratingDramaSource(true);
    setDramaSourceProgress("Đang gửi yêu cầu tạo kịch bản");
    const requestedSourceSnapshot = JSON.stringify({
      title: form.title.trim(),
      brief: dramaIdea.trim(),
      durationMinutes: form.durationMinutes,
      chunkSize: form.chunkSize,
      language: form.language,
      contentGenre: form.contentGenre,
      secondaryGenres: form.secondaryGenres,
      storySetting: form.storySetting,
      settingNotes: form.settingNotes.trim(),
      visualStyle: form.visualStyle,
      imageStyle: form.imageStyle,
      aspectRatio: form.aspectRatio,
    });
    try {
      const response = await fetch("/api/story-script/drama-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectTitle: form.title.trim(),
          brief: dramaIdea.trim(),
          durationMinutes: form.durationMinutes,
          chunkSize: form.chunkSize,
          language: form.language,
          contentGenre: form.contentGenre,
          secondaryGenres: form.secondaryGenres,
          storySetting: form.storySetting,
          settingNotes: form.settingNotes.trim(),
          visualStyle: form.visualStyle,
          imageStyle: form.imageStyle,
          aspectRatio: form.aspectRatio,
        }),
      });
      const responseText = await response.text();
      let payload: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(responseText);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
      } catch {
        const contentType = response.headers.get("content-type") || "không rõ định dạng";
        throw new Error(response.ok
          ? `Máy chủ tạo kịch bản trả phản hồi không hợp lệ (HTTP ${response.status}, ${contentType}).`
          : `Máy chủ tạo kịch bản trả HTTP ${response.status} nhưng không gửi chi tiết lỗi (${contentType}). Kiểm tra kết nối hoặc log máy chủ.`);
      }
      const apiMessage = typeof payload.message === "string" && payload.message.trim() ? payload.message : "";
      if (!response.ok) throw new Error(apiMessage || `Máy chủ AI Drama trả lỗi HTTP ${response.status}. Kiểm tra log máy chủ để biết nguyên nhân.`);
      if (typeof payload.jobId !== "string" || payload.status !== "running") {
        const code = typeof payload.code === "string" ? ` · ${payload.code}` : "";
        throw new Error(apiMessage || `Máy chủ chưa nhận được job kịch bản (HTTP ${response.status}${code}).`);
      }
      const jobId = payload.jobId;
      let result: Record<string, unknown> | null = null;
      let consecutivePollFailures = 0;
      while (!result) {
        await new Promise((resolve) => window.setTimeout(resolve, consecutivePollFailures ? 5000 : 2500));
        try {
          const pollResponse = await fetch(`/api/story-script/drama-source?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
          const pollText = await pollResponse.text();
          let pollPayload: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(pollText);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) pollPayload = parsed as Record<string, unknown>;
          } catch {
            if (pollResponse.status >= 500) throw new TypeError("Temporary polling response was not JSON");
            throw new Error(`Không đọc được trạng thái job kịch bản (HTTP ${pollResponse.status}).`);
          }
          if (!pollResponse.ok) {
            if (pollResponse.status >= 500) throw new TypeError(`Temporary polling HTTP ${pollResponse.status}`);
            throw new Error(typeof pollPayload.message === "string" ? pollPayload.message : `Không lấy được trạng thái job (HTTP ${pollResponse.status}).`);
          }
          consecutivePollFailures = 0;
          if (typeof pollPayload.stage === "string") setDramaSourceProgress(pollPayload.stage);
          if (pollPayload.status === "failed") {
            throw new Error(typeof pollPayload.message === "string" ? pollPayload.message : "Không thể tạo kịch bản AI Drama.");
          }
          if (pollPayload.status === "completed") result = pollPayload;
          else if (pollPayload.status !== "running") throw new Error("Máy chủ trả trạng thái job kịch bản không hợp lệ.");
        } catch (cause) {
          if (cause instanceof TypeError && /fetch|network|polling response|temporary/i.test(cause.message)) {
            consecutivePollFailures += 1;
            setDramaSourceProgress("Đang kết nối lại để nhận trạng thái kịch bản…");
            continue;
          }
          throw cause;
        }
      }
      if (typeof result.sourceText !== "string" || !result.plan) {
        throw new Error("Job đã kết thúc nhưng máy chủ không trả đủ nội dung kịch bản.");
      }
      setForm((current) => ({ ...current, sourceText: result!.sourceText as string, scriptMode: "ai", scriptFormat: "plain_text" }));
      setDramaPlan(result.plan as DramaProjectPlan);
      setDramaBriefSnapshot(requestedSourceSnapshot);
      setDramaSourceModel(typeof result.model === "string" ? result.model : "");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const transportFailure = cause instanceof TypeError && /failed to fetch|fetch failed|network|terminated/i.test(message);
      setError(transportFailure
        ? "Kết nối tới máy chủ StoryAI bị ngắt khi đang chờ kịch bản. Kiểm tra timeout hoặc proxy của máy chủ rồi thử lại."
        : message || "Không thể tạo kịch bản AI Drama.");
    } finally {
      setGeneratingDramaSource(false);
      setDramaSourceProgress("");
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedPresetId = fixedPresetId || form.presetId;
    if (!Number.isInteger(form.chunkSize) || form.chunkSize < MIN_PROJECT_CHUNK_SIZE || form.chunkSize > MAX_PROJECT_CHUNK_SIZE) {
      setError(`Số cảnh mỗi chunk phải là số nguyên từ ${MIN_PROJECT_CHUNK_SIZE} đến ${MAX_PROJECT_CHUNK_SIZE}.`);
      return;
    }
    if (!pendingScriptImport && !form.title.trim()) { setError("Vui lòng nhập tên dự án."); return; }
    if (form.storySetting === "historical" && !form.settingNotes.trim()) {
      setError("Hãy ghi rõ thời đại hoặc địa điểm lịch sử để AI giữ đúng bối cảnh.");
      return;
    }
    const creatingAiDrama = !projectSlug && scriptEntryMode === "ai" && selectedPresetId === "ai-drama";
    if (creatingAiDrama && !form.sourceText.trim() && !form.sourceUrl.trim()) {
      setError("Hãy tạo kịch bản nguồn AI Drama hoặc nhập nội dung nguồn trước khi tạo project.");
      return;
    }
    if (creatingAiDrama && dramaPlan && dramaSourceInputs !== dramaBriefSnapshot) {
      setError("Thông tin project đã đổi sau khi AI viết kịch bản. Hãy viết lại để tên tập và thời lượng khớp project.");
      return;
    }
    const importsJson = Boolean(pendingScriptImport || (!projectSlug && scriptEntryMode === "json"));
    if (importsJson && !validateScriptJsonInput()) return;
    setError("");
    setSaving(true);
    try {
      if (pendingScriptImport) {
        await importJsonIntoProject(pendingScriptImport, scriptJsonText);
        await refresh();
        setProjectCreatedFromJson(true);
        setPendingScriptImport(null);
        setSaving(false);
        if (selectedPresetId === "ai-drama") window.location.href = `/projects/${encodeURIComponent(pendingScriptImport.slug)}`;
        else setCharacterSetupPrompt(pendingScriptImport);
        return;
      }
      const selectedVideo = mediaCatalog?.videoModels.find((item) => item.id === form.mediaGeneration.videoModel && (item.provider || "maivideo") === form.mediaGeneration.videoProvider);
      const mediaGeneration = {
        ...form.mediaGeneration,
        ...(selectedVideo?.supportsMultiShot === false ? { videoMultiShot: false } : {}),
        ...(isVideoOffPeakRequired(selectedVideo?.id, selectedVideo?.label) ? { videoOffPeak: true } : selectedVideo?.supportsOffPeak === false ? { videoOffPeak: false } : {}),
        videoDurationSec: normalizeVideoDuration(form.mediaGeneration.videoDurationSec, selectedVideo, form.mediaGeneration.videoQuality),
      };
      const payload = {
        ...form,
        mediaGeneration: { ...mediaGeneration, ...(selectedPresetId === "ai-drama" ? { videoDurationMode: "scene" as const } : {}) },
        ...(creatingAiDrama && dramaPlan ? { dramaPlan } : {}),
        ...(scriptEntryMode === "json" && !projectSlug ? { deferSourceIngest: true } : {}),
      };
      if (projectSlug && existing) {
        if (existing.presetId === "ai-drama" && selectedPresetId === "ai-drama") {
          const { mediaSource: _mediaSource, ...updatePayload } = payload;
          await updateProject(projectSlug, updatePayload);
        } else {
          await updateProject(projectSlug, { ...payload, mediaSource: selectedPresetId === "ai-drama" ? "maivideo-video" : form.mediaSource });
        }
        window.location.href = `/projects/${projectSlug}`;
      } else {
        const project = await createProject({ ...payload, presetId: selectedPresetId, mediaSource: selectedPresetId === "ai-drama" ? "maivideo-video" : form.mediaSource }, selectedPresetId);
        if (scriptEntryMode === "json") {
          try {
            await importJsonIntoProject(project, scriptJsonText);
            await refresh();
            setProjectCreatedFromJson(true);
          } catch (cause) {
            setPendingScriptImport({ slug: project.slug, title: project.title });
            const detail = cause instanceof Error ? cause.message : "Không thể nhập kịch bản JSON.";
            setError(`Project đã được tạo nhưng chưa nhập được JSON: ${detail} Chọn lại file nếu cần rồi thử nhập lại.`);
            setSaving(false);
            return;
          }
        }
        setSaving(false);
        if (project.presetId === "ai-drama") window.location.href = `/projects/${encodeURIComponent(project.slug)}`;
        else setCharacterSetupPrompt({ slug: project.slug, title: project.title });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể lưu project.");
      setSaving(false);
    }
  }

  const currentScriptEntryMode: ScriptEntryMode = projectSlug ? form.scriptMode : scriptEntryMode;
  const manualMetrics = currentScriptEntryMode !== "json" && form.scriptMode === "manual" && form.sourceText.trim()
    ? getManualScriptMetrics({
      text: form.sourceText,
      format: form.scriptFormat,
      durationMode: form.durationMode,
      targetDurationSeconds: form.durationMinutes * 60,
    })
    : undefined;
  const effectiveDurationSeconds = manualMetrics?.durationSeconds || form.durationMinutes * 60;
  const usesAutoDuration = currentScriptEntryMode !== "json" && form.scriptMode === "manual" && form.durationMode === "auto";
  const totalScenes = manualMetrics?.sceneCount || Math.max(1, Math.ceil(effectiveDurationSeconds / MAX_SCENE_DURATION_SEC));
  const totalChunks = Math.ceil(totalScenes / Math.max(MIN_PROJECT_CHUNK_SIZE, form.chunkSize));
  const hasCustomImageStyle = !IMAGE_STYLE_OPTIONS.includes(form.imageStyle as (typeof IMAGE_STYLE_OPTIONS)[number]);
  const isNewAiDrama = !projectSlug && scriptEntryMode === "ai" && form.presetId === "ai-drama";
  const dramaSourceInputs = JSON.stringify({
    title: form.title.trim(),
    brief: dramaIdea.trim(),
    durationMinutes: form.durationMinutes,
    chunkSize: form.chunkSize,
    language: form.language,
    contentGenre: form.contentGenre,
    secondaryGenres: form.secondaryGenres,
    storySetting: form.storySetting,
    settingNotes: form.settingNotes.trim(),
    visualStyle: form.visualStyle,
    imageStyle: form.imageStyle,
    aspectRatio: form.aspectRatio,
  });
  const providerConfig = provider || { primaryModel: "—", fallbackModels: [], reasoningEffort: "—", serviceTier: "—", keyConfigured: false };
  const languageOptions = [...new Set([
    ...FALLBACK_VIDEO_LANGUAGES,
    ...(voiceCatalog?.languages || []).map((language) => language.code),
  ])].map((code) => ({ code, label: voiceLanguageLabel(code) }));
  const visibleVoiceChoices = voiceCatalog?.voices || [];
  const imageModelCatalog = availableImageModels(mediaCatalog?.imageModels || []);
  const imageModelOptions = imageModelCatalog.some((item) => item.id === form.mediaGeneration.imageModel)
    ? imageModelCatalog
    : [{ id: form.mediaGeneration.imageModel, label: `${form.mediaGeneration.imageModel} · cấu hình đã lưu`, qualities: [form.mediaGeneration.imageQuality] }, ...imageModelCatalog];
  const selectedImageModel = imageModelOptions.find((item) => item.id === form.mediaGeneration.imageModel);
  const supportedImageQualities = selectedImageModel?.qualities.length ? selectedImageModel.qualities : [form.mediaGeneration.imageQuality || "1440p"];
  const imageQualities = supportedImageQualities.includes(form.mediaGeneration.imageQuality) ? supportedImageQualities : [form.mediaGeneration.imageQuality, ...supportedImageQualities];
  const supportedImageDetailLevels = imageDetailLevelsForModel(selectedImageModel);
  const availableVideoModels = (mediaCatalog?.videoModels || []).filter((item) => (item.provider || "maivideo") === form.mediaGeneration.videoProvider);
  const videoModelOptions = availableVideoModels.some((item) => item.id === form.mediaGeneration.videoModel)
    ? availableVideoModels
    : [{ id: form.mediaGeneration.videoModel, label: `${form.mediaGeneration.videoModel} · cấu hình đã lưu`, provider: form.mediaGeneration.videoProvider, qualities: [form.mediaGeneration.videoQuality], minDurationSec: 1, maxDurationSec: 15 }, ...availableVideoModels];
  const selectedVideoModel = videoModelOptions.find((item) => item.id === form.mediaGeneration.videoModel);
  const supportedVideoQualities = videoQualitiesForModel(selectedVideoModel, form.mediaGeneration.videoQuality || "720p");
  const videoQualities = supportedVideoQualities.includes(form.mediaGeneration.videoQuality) ? supportedVideoQualities : [form.mediaGeneration.videoQuality, ...supportedVideoQualities];
  const videoMinDuration = selectedVideoModel?.minDurationSec || 1;
  const videoMaxDuration = videoDurationLimit(selectedVideoModel, form.mediaGeneration.videoQuality);
  const videoDurationChoices = videoDurationOptions(selectedVideoModel, form.mediaGeneration.videoQuality);
  const seedanceSelected = form.mediaGeneration.videoProvider === "seedance" || Boolean(selectedVideoModel?.supportedDurationsSec?.length);
  const videoOffPeakRequired = form.mediaGeneration.videoProvider === "maivideo" && isVideoOffPeakRequired(selectedVideoModel?.id, selectedVideoModel?.label);
  const aspectRatioOptions = projectAspectRatioOptions(selectedImageModel, form.mediaGeneration.imageQuality, selectedVideoModel);
  const aspectRatioOptionsKey = aspectRatioOptions.join("|");

  useEffect(() => {
    const availableAspectRatios = aspectRatioOptionsKey.split("|").filter(Boolean);
    if (availableAspectRatios.includes(form.aspectRatio)) return;
    setForm((current) => current.aspectRatio === form.aspectRatio
      ? { ...current, aspectRatio: availableAspectRatios[0] || "16:9" }
      : current);
  }, [aspectRatioOptionsKey, form.aspectRatio]);

  function continueToProject(setupCharacters: boolean) {
    if (!characterSetupPrompt) return;
    const destination = setupCharacters
      ? `/projects/${encodeURIComponent(characterSetupPrompt.slug)}?setupCharacters=1`
      : `/projects/${encodeURIComponent(characterSetupPrompt.slug)}`;
    window.location.href = destination;
  }

  return (
    <div className="new-project-view">
      <section className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" />PROJECT SETUP</div>
          <h1>{projectSlug ? "Tùy chỉnh dự án" : fixedPresetId ? `Tạo dự án ${STORY_PRESETS[fixedPresetId].label}` : "Tạo dự án mới"}</h1>
          <p className="heading-subtitle">{fixedPresetId ? `Luồng tạo riêng cho ${STORY_PRESETS[fixedPresetId].label}; loại dự án được cố định từ lúc tạo.` : "Chọn cấu hình trước khi bước vào màn hình sử dụng."}</p>
        </div>
        <Link className="secondary-button" href={projectSlug ? `/projects/${projectSlug}` : "/projects"}>Hủy</Link>
      </section>

      <form className="project-form" onSubmit={submit}>
        <div className="form-main">
          <section className="form-section panel-card">
            <div className="form-section-heading">
              <div>
                <div className="section-kicker">01 / SOURCE</div>
                <h2>Nguồn và thông tin dự án</h2>
                <p>{currentScriptEntryMode === "json" ? "Chọn file JSON làm nguồn kịch bản cho project." : isNewAiDrama ? "Mô tả ý tưởng để AI viết kịch bản nguồn cho project Drama." : "Nhập link YouTube hoặc transcript/brief có quyền sử dụng."}</p>
              </div>
              <span className="form-step">Bắt buộc</span>
            </div>
            <div className="form-grid">
              <label htmlFor="project-title" className="form-field full">
                <span>Tên dự án</span>
                <input id="project-title" value={form.title} onChange={(event) => setField("title", event.target.value)} placeholder="Ví dụ: Chuyện người đưa thư" />
              </label>
              {!projectSlug && !fixedPresetId ? <div className="form-field full project-genre-picker">
                <span>Loại dự án</span>
                <Link className="secondary-button compact" href="/projects/new">Chọn luồng tạo riêng</Link>
              </div> : <div className="form-field full project-genre-picker">
                <span>Loại dự án cố định</span>
                <div className={`form-preset-card ${STORY_PRESETS[fixedPresetId || existing?.presetId || form.presetId].accent} active`} aria-label={`Loại dự án ${STORY_PRESETS[fixedPresetId || existing?.presetId || form.presetId].label}`}>
                  <span className={`preset-glyph ${STORY_PRESETS[fixedPresetId || existing?.presetId || form.presetId].accent}`}><Icon name={(fixedPresetId || existing?.presetId || form.presetId) === "audio-story" ? "play" : (fixedPresetId || existing?.presetId || form.presetId) === "ai-drama" ? "scene" : "spark"} size={17} /></span>
                  <span><strong>{STORY_PRESETS[fixedPresetId || existing?.presetId || form.presetId].label}</strong><small>{STORY_PRESETS[fixedPresetId || existing?.presetId || form.presetId].description}</small></span>
                  <span className="form-preset-selected"><Icon name="check" size={13} /></span>
                </div>
                <small className="field-help">Loại dự án được khóa sau khi tạo để tránh thay đổi nhầm cấu trúc kịch bản và media.</small>
              </div>}
              <label htmlFor="project-source-url" className="form-field full">
                <span>Link nguồn YouTube</span>
                <div className="field-with-icon">
                  <Icon name="link" size={16} />
                  <input id="project-source-url" value={form.sourceUrl} onChange={(event) => setField("sourceUrl", event.target.value)} placeholder="https://youtube.com/watch?v=..." />
                </div>
                {currentScriptEntryMode === "json" && <small className="field-help">Link YouTube được lưu làm tham chiếu; kịch bản sẽ lấy từ file JSON.</small>}
              </label>
              <label htmlFor="project-script-mode" className="form-field full">
                <span>Cách nhập kịch bản</span>
                <select id="project-script-mode" value={projectSlug ? form.scriptMode : scriptEntryMode} onChange={(event) => selectScriptEntryMode(event.target.value as ScriptEntryMode)} disabled={Boolean(pendingScriptImport)}>
                  <option value="ai">{form.presetId === "ai-drama" ? "AI viết kịch bản nguồn từ ý tưởng" : "AI tạo kịch bản từ nguồn"}</option>
                  {!isFixedAiDramaCreation && <option value="manual">Tôi tự nhập kịch bản</option>}
                  {!projectSlug && !isFixedAiDramaCreation && <option value="json">Nhập JSON từ GPT</option>}
                </select>
                {currentScriptEntryMode === "json"
                  ? <small className="field-help">Dán JSON hoặc nạp file; nội dung này là nguồn kịch bản chính của project.</small>
                  : <small className="field-help">Chế độ thủ công giữ nguyên từng chữ khi chạy chunk. Sau khi lưu project, Short Drama Studio có thể phân tích và đưa gợi ý riêng; không tự ghi đè bản gốc.</small>}
              </label>
              {currentScriptEntryMode === "json" ? <div className="form-field full">
                <span>JSON kịch bản</span>
                {(fixedPresetId || form.presetId) === "ai-drama" && <div className="script-template-actions">
                  <button className="secondary-button compact" type="button" onClick={loadDramaJsonTemplate} disabled={saving}><Icon name="file" size={14} />Chèn mẫu JSON AI Drama</button>
                  <small>Mẫu minh họa A01/S001 · 5 giây. Hãy sửa nội dung và bổ sung đủ tập/cảnh trước khi nhập.</small>
                </div>}
                <input ref={scriptJsonInputRef} type="file" accept="application/json,.json" hidden onChange={selectScriptJsonFile} />
                <textarea
                  className="script-json-textarea"
                  id="project-script-json"
                  value={scriptJsonText}
                  onChange={(event) => {
                    setScriptJsonText(event.target.value);
                    setScriptJsonSourceName("");
                    setScriptJsonSummary(null);
                    setError("");
                  }}
                  placeholder={'Dán JSON từ GPT vào đây…\n\nVí dụ:\n{\n  "schema": "scene-script.v1",\n  "chunk_id": "A01",\n  "chunk_summary": "…",\n  "scenes": [],\n  "continuity_state": {}\n}'}
                  rows={10}
                  spellCheck={false}
                  aria-label="JSON kịch bản"
                />
                <div className="script-json-upload-row">
                  <button className="secondary-button compact" type="button" onClick={() => scriptJsonInputRef.current?.click()} disabled={saving}><Icon name="file" size={14} />{scriptJsonSourceName ? "Nạp file khác" : "Nạp từ file JSON"}</button>
                  <button className="secondary-button compact" type="button" onClick={validateScriptJsonInput} disabled={saving || !scriptJsonText.trim()}><Icon name="check" size={14} />Kiểm tra JSON</button>
                  <span>{scriptJsonSourceName ? `Đã nạp: ${scriptJsonSourceName}` : "Dán JSON hoặc nạp file .json"}</span>
                </div>
                {scriptJsonSummary
                  ? <small className="field-help">{scriptJsonSummary.schema} · {scriptJsonSummary.episodeCount} tập · {scriptJsonSummary.sceneCount} cảnh</small>
                  : <small className="field-help">Hỗ trợ scene-script.v1 (một tập) và scene-series.v1 (nhiều tập). Kiểm tra JSON trước khi tạo project.</small>}
              </div> : isNewAiDrama ? <div className="form-field full drama-source-composer">
                <label htmlFor="project-drama-idea" className="form-field">
                  <span>Ý tưởng / đề bài sáng tác</span>
                  <textarea
                    id="project-drama-idea"
                    value={dramaIdea}
                    onChange={(event) => setDramaIdea(event.target.value)}
                    placeholder="Ví dụ: Một nữ bác sĩ trở về quê sau 10 năm và phát hiện gia đình đang che giấu sự thật về người anh trai mất tích. Bối cảnh miền Trung hiện đại, melodrama gia đình, kết thúc có hy vọng…"
                    maxLength={10000}
                  />
                  <small className="field-help">AI sẽ đề xuất title video, hồ sơ nhân vật và bối cảnh có prompt ảnh, tên từng tập/chương và diễn tiến toàn bộ thời lượng. Voice do hệ thống gán sau khi tạo project; bạn đổi trong tab Nhân vật.</small>
                </label>
                <div className={`drama-source-actions ${generatingDramaSource ? "is-loading" : ""}`}>
                  <button className="primary-button compact" type="button" onClick={generateDramaSource} disabled={generatingDramaSource || saving}>
                    <Icon name="spark" size={15} />
                    {generatingDramaSource ? dramaSourceProgress || "Đang viết kịch bản…" : dramaBriefSnapshot ? "Viết lại kịch bản nguồn" : "AI viết kịch bản nguồn"}
                  </button>
                  <span>{dramaIdea.length.toLocaleString("vi-VN")}/10.000 ký tự{dramaSourceModel ? ` · ${dramaSourceModel}` : ""}</span>
                </div>
                <div className="form-field drama-source-text-field">
                  <label htmlFor="project-source-text"><span>Kịch bản nguồn AI Drama · có thể chỉnh sửa</span></label>
                  <div className="script-template-actions">
                    <button className="secondary-button compact" type="button" onClick={loadDramaSourceTemplate} disabled={saving || generatingDramaSource}><Icon name="file" size={14} />Chèn mẫu kịch bản nguồn</button>
                    <button className="secondary-button compact" type="button" onClick={() => void copyDramaSourceTemplate()} disabled={saving || generatingDramaSource}><Icon name="copy" size={14} />Copy mẫu</button>
                    <small>Mẫu có story bible, nhân vật, bối cảnh và outline tập; sửa trực tiếp trong ô bên dưới.</small>
                    {sourceTemplateCopyStatus && <small role="status">{sourceTemplateCopyStatus}</small>}
                  </div>
                  <textarea
                    id="project-source-text"
                    value={form.sourceText}
                    onChange={(event) => {
                      setField("sourceText", event.target.value);
                      if (dramaPlan) {
                        setDramaPlan(null);
                        setDramaBriefSnapshot("");
                        setDramaSourceModel("");
                      }
                    }}
                    placeholder="Kịch bản nguồn do AI tạo sẽ xuất hiện ở đây. Bạn cũng có thể dán story bible, treatment hoặc outline đã có."
                  />
                  {dramaBriefSnapshot && dramaSourceInputs !== dramaBriefSnapshot
                    ? <small className="field-help drama-source-stale">Thông tin project hoặc ý tưởng đã thay đổi sau lần viết gần nhất. Hãy viết lại kịch bản nguồn nếu muốn áp dụng nội dung mới.</small>
                    : <small className="field-help">Kết quả gồm story bible, hồ sơ nhân vật và outline theo nhịp khoảng 5 phút. Khi chạy tạo chunk, AI Drama chia cảnh 5/10/15 giây theo nhịp hành động, tách từng lượt thoại và gán timecode cho từng nhân vật.</small>}
                </div>
                {dramaPlan && <div className="drama-plan-preview">
                  <strong>Title video: {dramaPlan.videoTitle}</strong>
                  <span>{dramaPlan.characters.length} nhân vật · {dramaPlan.locations.length} bối cảnh · {dramaPlan.episodes.length} tập/chương</span>
                  <details><summary>Xem nhân vật, bối cảnh và tên tập</summary>
                    <div><strong>Nhân vật</strong>{dramaPlan.characters.map((item) => <span key={item.name}>{item.name} · {item.description}</span>)}</div>
                    <div><strong>Bối cảnh</strong>{dramaPlan.locations.map((item) => <span key={item.name}>{item.name} · {item.description}</span>)}</div>
                    <div><strong>Tập/chương</strong>{dramaPlan.episodes.map((item, index) => <span key={index}>A{String(index + 1).padStart(2, "0")} · {item.title}</span>)}</div>
                  </details>
                </div>}
              </div> : <label htmlFor="project-source-text" className="form-field full">
                <span>{form.scriptMode === "manual" ? "Kịch bản thủ công" : "Transcript / brief"}</span>
                <textarea id="project-source-text" value={form.sourceText} onChange={(event) => setField("sourceText", event.target.value)} placeholder={form.scriptMode === "manual" ? "Dán kịch bản tại đây. StoryAI sẽ giữ nguyên lời thoại và tự chia cảnh…" : "Để trống nếu muốn StoryAI tự lấy transcript YouTube qua MaiVideo…"} />
                {form.scriptMode === "manual" && <small className="field-help">Kịch bản định dạng: <select aria-label="Định dạng kịch bản" value={form.scriptFormat} onChange={(event) => setField("scriptFormat", event.target.value as ScriptFormat)}><option value="plain_text">Văn bản thường</option><option value="srt">SRT có timecode</option></select></small>}
              </label>}
            </div>
          </section>

          <section className="form-section panel-card">
            <div className="form-section-heading">
              <div>
                <div className="section-kicker">02 / MEDIA GENERATION</div>
                <h2>Cấu hình model ảnh và video</h2>
              </div>
            </div>
            <div className="media-generation-grid">
              <section className="media-generation-group" aria-labelledby="image-generation-settings-title">
                <div className="media-generation-group-heading"><span className="media-generation-icon image"><Icon name="sliders" size={15} /></span><div><strong id="image-generation-settings-title">Tạo ảnh</strong></div></div>
                <div className="form-grid">
                  <label htmlFor="project-image-model" className="form-field">
                    <span>Model ảnh</span>
                    <select id="project-image-model" value={form.mediaGeneration.imageModel} onChange={(event) => selectImageModel(event.target.value, form.mediaGeneration.imageQuality)}>
                      {imageModelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                    </select>
                  </label>
                  <label htmlFor="project-image-quality" className="form-field">
                    <span>Độ phân giải ảnh</span>
                    <select id="project-image-quality" value={form.mediaGeneration.imageQuality} onChange={(event) => setMediaSettings({ imageQuality: event.target.value })}>
                      {imageQualities.map((quality) => <option key={quality} value={quality}>{quality}{!supportedImageQualities.includes(quality) ? " · cấu hình đã lưu" : ""}</option>)}
                    </select>
                  </label>
                  {supportedImageDetailLevels.length > 0 && <label htmlFor="project-image-detail-level" className="form-field">
                    <span>Detail level</span>
                    <select id="project-image-detail-level" value={form.mediaGeneration.imageDetailLevel} onChange={(event) => setMediaSettings({ imageDetailLevel: event.target.value as MediaGenerationSettings["imageDetailLevel"] })}>
                      {supportedImageDetailLevels.map((level) => <option key={level} value={level}>{IMAGE_DETAIL_LEVEL_LABELS[level]}</option>)}
                    </select>
                  </label>}
                  <div className="media-generation-toggles image-generation-reference">
                    <label className="media-generation-toggle">
                      <input type="checkbox" checked={form.mediaGeneration.imageUseCharacterReferences} onChange={(event) => setMediaSettings({ imageUseCharacterReferences: event.target.checked })} />
                      <span><strong>Hồ sơ nhân vật cho ảnh cảnh</strong></span>
                    </label>
                  </div>
                </div>
                {(mediaCatalog?.imageError || mediaCatalogError) && <small className="field-help media-generation-help">Catalog ảnh không tải được. Kiểm tra API key MaiVideo.</small>}
              </section>

              <section className="media-generation-group" aria-labelledby="video-generation-settings-title">
                <div className="media-generation-group-heading"><span className="media-generation-icon video"><Icon name="play" size={15} /></span><div><strong id="video-generation-settings-title">Tạo video</strong></div>{projectSlug && <Link className="seedance-connect-link" href="/settings#dola-gateway">Quản lý Dola Gateway</Link>}</div>
                <div className="form-grid">
                  <label htmlFor="project-video-provider" className="form-field">
                    <span>Hệ thống tạo video</span>
                    <select id="project-video-provider" value={form.mediaGeneration.videoProvider} onChange={(event) => selectVideoProvider(event.target.value as MediaGenerationSettings["videoProvider"])}>
                      <option value="maivideo">MaiVideo API</option>
                      <option value="seedance">Seedance · Dola.com local</option>
                    </select>
                  </label>
                  <label htmlFor="project-video-model" className="form-field">
                    <span>Model video</span>
                    <select id="project-video-model" value={form.mediaGeneration.videoModel} onChange={(event) => selectVideoModel(event.target.value)}>
                      {videoModelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                    </select>
                  </label>
                  <label htmlFor="project-video-quality" className="form-field">
                    <span>Chất lượng video</span>
                    {seedanceSelected
                      ? <select id="project-video-quality" value="profile" disabled><option value="profile">Theo profile Dola</option></select>
                      : <select id="project-video-quality" value={form.mediaGeneration.videoQuality} onChange={(event) => selectVideoQuality(event.target.value)}>
                        {videoQualities.map((quality) => <option key={quality} value={quality}>{quality}{!supportedVideoQualities.includes(quality) ? " · cấu hình đã lưu" : ""}</option>)}
                      </select>}
                  </label>
                  <label htmlFor="project-video-duration" className="form-field">
                    <span>Thời lượng clip</span>
                    <select id="project-video-duration" value={form.mediaGeneration.videoDurationMode} disabled={form.presetId === "ai-drama"} onChange={(event) => setMediaSettings({ videoDurationMode: event.target.value === "fixed" ? "fixed" : "scene" })}>
                      <option value="scene">Theo độ dài từng cảnh</option>
                      {form.presetId !== "ai-drama" && <option value="fixed">Cố định cho mọi cảnh</option>}
                    </select>
                    {form.presetId === "ai-drama" && <small className="field-help">AI Drama luôn tạo clip theo từng cảnh 5/10/15 giây.</small>}
                    {form.mediaGeneration.videoDurationMode === "fixed"
                      ? seedanceSelected
                        ? <select id="project-video-duration-seconds" value={form.mediaGeneration.videoDurationSec} onChange={(event) => setMediaSettings({ videoDurationSec: Number(event.target.value) })}>{videoDurationChoices.map((seconds) => <option key={seconds} value={seconds}>{seconds} giây</option>)}</select>
                        : <input id="project-video-duration-seconds" type="number" min={videoMinDuration} max={videoMaxDuration} step={1} value={form.mediaGeneration.videoDurationSec} onChange={(event) => setMediaSettings({ videoDurationSec: Number(event.target.value) })} />
                      : <small className="field-help">{seedanceSelected ? "Tự chọn 5/10/15s theo cảnh." : `Theo cảnh · tối đa ${videoMaxDuration}s.`}</small>}
                  </label>
                  <div className="media-generation-toggles video-generation-reference">
                    <label className="media-generation-toggle">
                      <input type="checkbox" checked={form.mediaGeneration.videoUseCharacterReferences} onChange={(event) => setMediaSettings({ videoUseCharacterReferences: event.target.checked })} />
                      <span><strong>Ảnh nhân vật cho video</strong></span>
                    </label>
                  </div>
                </div>
                {(mediaCatalog?.videoError || mediaCatalogError) && !seedanceSelected && <small className="field-help media-generation-help">Catalog video không tải được. Kiểm tra API key MaiVideo.</small>}
              </section>
              {!seedanceSelected && <section className="media-generation-group media-generation-options" aria-labelledby="video-options-title">
                <div className="media-generation-group-heading"><div><strong id="video-options-title">Tùy chọn model video</strong></div></div>
                <div className="media-generation-toggles">
                  <label className="media-generation-toggle">
                    <input type="checkbox" checked={selectedVideoModel?.supportsMultiShot === false ? false : form.mediaGeneration.videoMultiShot} disabled={selectedVideoModel?.supportsMultiShot === false} onChange={(event) => setMediaSettings({ videoMultiShot: event.target.checked })} />
                    <span><strong>Multi-shot</strong>{selectedVideoModel?.supportsMultiShot === false && <small>Model không hỗ trợ</small>}</span>
                  </label>
                  <label className="media-generation-toggle">
                    <input type="checkbox" checked={selectedVideoModel?.supportsAudio === false ? false : form.mediaGeneration.videoAudio} disabled={selectedVideoModel?.supportsAudio === false} onChange={(event) => setMediaSettings({ videoAudio: event.target.checked })} />
                    <span><strong>Âm thanh từ model</strong>{selectedVideoModel?.supportsAudio === false && <small>Model không hỗ trợ</small>}</span>
                  </label>
                  <label className="media-generation-toggle">
                    <input type="checkbox" checked={videoOffPeakRequired || (selectedVideoModel?.supportsOffPeak === false ? false : form.mediaGeneration.videoOffPeak)} disabled={videoOffPeakRequired || selectedVideoModel?.supportsOffPeak === false} onChange={(event) => setMediaSettings({ videoOffPeak: event.target.checked })} />
                    <span><strong>Off-peak</strong>{videoOffPeakRequired && <small>Bắt buộc với PixVerse</small>}{!videoOffPeakRequired && selectedVideoModel?.supportsOffPeak === false && <small>Model chỉ chạy Peak</small>}</span>
                  </label>
                </div>
              </section>}
            </div>
          </section>
        </div>

        <aside className="form-side">
          <section className="form-section panel-card">
            <div className="section-kicker">03 / CONTENT & OUTPUT</div>
            <h2>Nội dung & đầu ra</h2>
            <div className="form-grid content-output-grid">
              {currentScriptEntryMode === "json" ? <div className="form-field full">
                <span>Thời lượng từ JSON</span>
              </div> : <>
                <label htmlFor="project-duration-mode" className="form-field">
                  <span>Cách xác định thời lượng</span>
                  <select id="project-duration-mode" value={form.scriptMode === "manual" ? form.durationMode : "manual"} onChange={(event) => selectDurationMode(event.target.value as DurationMode)}>
                    <option value="manual">Tự nhập thời lượng mục tiêu</option>
                    {form.scriptMode === "manual" && <option value="auto">Tự tính từ kịch bản</option>}
                  </select>
                </label>
                <label htmlFor="project-duration" className="form-field">
                  <span>{usesAutoDuration ? "Thời lượng tự tính" : "Thời lượng mục tiêu (phút)"}</span>
                  <input id="project-duration" type="number" min={1} step={0.1} value={usesAutoDuration ? Number((effectiveDurationSeconds / 60).toFixed(2)) : form.durationMinutes} disabled={usesAutoDuration} onChange={(event) => setField("durationMinutes", Number(event.target.value))} />
                  {manualMetrics && <small className="field-help">{manualMetrics.wordCount.toLocaleString("vi-VN")} từ · {manualMetrics.sceneCount} cảnh · {formatDurationLabel(effectiveDurationSeconds)}{manualMetrics.issues.length ? ` · ${manualMetrics.issues.length} cảnh cần tách/kiểm tra` : ""}</small>}
                </label>
              </>}
              <label htmlFor="project-video-language" className="form-field">
                <span>Ngôn ngữ video</span>
                <select id="project-video-language" value={form.language} onChange={(event) => selectVideoLanguage(event.target.value)}>
                  {languageOptions.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
                </select>
              </label>
              <label htmlFor="project-voice" className="form-field">
                <span>Giọng đọc OmniVoice</span>
                <select id="project-voice" value={form.voiceId} onChange={(event) => selectVoice(event.target.value)} disabled={!visibleVoiceChoices.length}>
                  <option value="">{voiceCatalogLoading ? "Đang tải giọng từ MaiVideo…" : visibleVoiceChoices.length ? "Chọn giọng từ MaiVideo" : "Chưa có giọng OmniVoice khả dụng"}</option>
                  {visibleVoiceChoices.map((voice: OmniVoiceOption) => <option key={voice.id} value={voice.id}>{voice.name} · {voiceLanguageLabel(voice.language)}{voice.gender ? ` · ${voice.gender}` : ""}</option>)}
                </select>
                {voiceCatalogLoading && <small className="field-help">Đang tải thư viện voice từ MaiVideo…</small>}
              </label>
              {voiceError && <div className="voice-catalog-error" role="status"><small className="field-help">{voiceError}</small><button className="secondary-button compact" type="button" onClick={() => setVoiceCatalogRetry((attempt) => attempt + 1)} disabled={voiceCatalogLoading}><Icon name="refresh" size={13} />Thử tải lại</button></div>}
              <label htmlFor="project-aspect" className="form-field">
                <span>Khung hình</span>
                <select id="project-aspect" value={form.aspectRatio} onChange={(event) => setField("aspectRatio", event.target.value)}>
                  {aspectRatioOptions.map((ratio) => <option key={ratio} value={ratio}>{ASPECT_RATIO_LABELS[ratio] || ratio}</option>)}
                </select>
              </label>
              <label htmlFor="project-content-genre" className="form-field">
                <span>Primary Genre</span>
                <select id="project-content-genre" value={form.contentGenre} onChange={(event) => selectPrimaryGenre(event.target.value)}>
                  {CONTENT_GENRES.map((genre) => <option key={genre.value} value={genre.value}>{CONTENT_GENRE_EN_LABELS[genre.value]}</option>)}
                </select>
              </label>
              <div className="form-field full project-secondary-genres">
                <span>Supporting Genres · up to 2</span>
                <div className="project-genre-tags" role="group" aria-label="Supporting genres">
                  {CONTENT_GENRES.filter((genre) => genre.value !== form.contentGenre).map((genre) => {
                    const active = form.secondaryGenres.includes(genre.value);
                    const atLimit = form.secondaryGenres.length >= 2 && !active;
                    return <button type="button" key={genre.value} className={`project-genre-tag ${active ? "active" : ""}`} aria-pressed={active} disabled={atLimit} onClick={() => toggleSecondaryGenre(genre.value)}>{CONTENT_GENRE_EN_LABELS[genre.value]}</button>;
                  })}
                </div>
              </div>
              <label htmlFor="project-story-setting" className="form-field">
                <span>Story Setting</span>
                <select id="project-story-setting" value={form.storySetting} onChange={(event) => setField("storySetting", event.target.value)}>
                  {STORY_SETTING_OPTIONS.map((setting) => <option key={setting.value} value={setting.value}>{STORY_SETTING_EN_LABELS[setting.value]}</option>)}
                </select>
              </label>
              <label htmlFor="project-setting-notes" className="form-field">
                <span>{form.storySetting === "historical" ? "Historical Period / Location" : "Setting Details"}</span>
                <input id="project-setting-notes" value={form.settingNotes} onChange={(event) => setField("settingNotes", event.target.value)} maxLength={2000} required={form.storySetting === "historical"} placeholder={form.storySetting === "historical" ? "e.g. Vietnam during the Early Le dynasty" : "e.g. Present-day Tokyo, the year 2140, a fantasy kingdom"} />
              </label>
              <label htmlFor="project-image-style" className="form-field">
                <span>Image Style</span>
                <select id="project-image-style" value={hasCustomImageStyle ? "custom" : form.imageStyle} onChange={(event) => setField("imageStyle", event.target.value === "custom" ? "" : event.target.value)}>
                  {IMAGE_STYLE_PRESETS.map(({ value }) => <option key={value} value={value}>{IMAGE_STYLE_EN_LABELS[value]}</option>)}
                  <option value="custom">Custom Image Style…</option>
                </select>
              </label>
              {hasCustomImageStyle && <label htmlFor="project-image-style-custom" className="form-field">
                <span>Custom Image Style</span>
                <input id="project-image-style-custom" value={form.imageStyle} onChange={(event) => setField("imageStyle", event.target.value)} maxLength={160} required placeholder="e.g. 2D anime, cel shading, clean line art" />
              </label>}
              <label htmlFor="project-media-source" className="form-field">
                <span>Media mặc định</span>
                <select id="project-media-source" value={form.presetId === "ai-drama" ? "maivideo-video" : form.mediaSource} disabled={form.presetId === "ai-drama"} onChange={(event) => {
                  mediaSourceTouched.current = true;
                  setField("mediaSource", event.target.value as MediaSource);
                }}>
                  <option value="stock-mixed">Stock mix · MaiVideo fallback</option>
                  <option value="stock-image">Chỉ stock ảnh</option>
                  <option value="stock-video">Chỉ stock video</option>
                  <option value="maivideo-image">MaiVideo AI ảnh</option>
                  <option value="maivideo-video">AI video · hệ thống đã chọn</option>
                </select>
              </label>
              <label htmlFor="project-chunk-size" className="form-field">
                <span>Số cảnh mỗi chunk / tập</span>
                <select id="project-chunk-size" value={customChunkSize ? "custom" : String(form.chunkSize)} onChange={(event) => {
                  if (event.target.value === "custom") {
                    setCustomChunkSize(true);
                    return;
                  }
                  setCustomChunkSize(false);
                  setField("chunkSize", Number(event.target.value));
                }}>
                  {PROJECT_CHUNK_SIZE_PRESETS.map((size) => <option key={size} value={size}>{size} cảnh / chunk</option>)}
                  <option value="custom">Tùy chỉnh số cảnh…</option>
                </select>
                {customChunkSize && <input
                  aria-label="Số cảnh tùy chỉnh mỗi chunk"
                  type="number"
                  min={MIN_PROJECT_CHUNK_SIZE}
                  max={MAX_PROJECT_CHUNK_SIZE}
                  step={1}
                  required
                  value={form.chunkSize > 0 ? form.chunkSize : ""}
                  onChange={(event) => setField("chunkSize", event.target.value === "" ? 0 : Number(event.target.value))}
                  placeholder={`Nhập ${MIN_PROJECT_CHUNK_SIZE}–${MAX_PROJECT_CHUNK_SIZE} cảnh`}
                />}
                <small className="field-help">Mỗi chunk/tập gồm số cảnh đã chọn; có thể nhập từ {MIN_PROJECT_CHUNK_SIZE} đến {MAX_PROJECT_CHUNK_SIZE}.</small>
              </label>
            </div>
            <div className="fixed-rule">
              <Icon name="check" size={15} />
              <span><strong>Giới hạn cảnh:</strong> {MAX_SCENE_DURATION_SEC} giây · 3 từ/giây{currentScriptEntryMode === "json" ? " · JSON cần timecode hợp lệ" : ""}</span>
            </div>
          </section>

          <section className="form-section panel-card provider-card">
            <div className="section-kicker">04 / PROVIDER</div>
            <h2>Script LLM</h2>
            <div className="provider-config-row">
              <span className="provider-mark">O</span>
              <div><strong>OpenAI API</strong><small>Responses API</small></div>
              <StatusDot text={providerConfig.keyConfigured ? "API key đã cấu hình" : "Cần cấu hình key"} />
            </div>
            <div className="provider-config-detail"><span>Model</span><strong>{providerConfig.primaryModel}</strong></div>
            <div className="provider-config-detail"><span>Reasoning effort</span><strong>{providerConfig.reasoningEffort}</strong></div>
            <div className="provider-config-detail"><span>Speed tier</span><strong>{providerConfig.serviceTier === "fast" ? "Fast mode" : providerConfig.serviceTier}</strong></div>
            <small className="field-help">Fast mode được gửi ở mọi yêu cầu; GPT-6 Luna tính phí Fast gấp 2 lần Standard theo tài liệu OpenAI.</small>
            <div className="provider-config-detail"><span>Fallback</span><strong>{providerConfig.fallbackModels.length ? `${providerConfig.fallbackModels.length} models` : "Tắt"}</strong></div>
          </section>

          <div className="form-submit">
            <div>
              {error && <span className="form-error">{error}</span>}
              {pendingScriptImport && <span className="pending-script-import">Đã tạo project <strong>{pendingScriptImport.title}</strong>. Có thể mở <Link href={`/projects/${encodeURIComponent(pendingScriptImport.slug)}`}>project</Link> hoặc chọn lại file JSON rồi thử nhập lại.</span>}
              <span className="slug-preview">Slug: <strong>/{slugify(form.title || "ten-du-an")}</strong></span>
            </div>
            <button className="primary-button" type="submit" disabled={saving}><Icon name="save" size={16} />{saving ? pendingScriptImport || currentScriptEntryMode === "json" ? "Đang nhập JSON…" : "Đang lưu…" : pendingScriptImport ? "Thử nhập JSON" : currentScriptEntryMode === "json" ? "Tạo project & nhập JSON" : projectSlug ? "Lưu thay đổi" : "Tạo project"}</button>
          </div>
        </aside>
      </form>

      <div className="setup-summary">
        <Icon name="spark" size={16} />
        <span>{currentScriptEntryMode === "json"
          ? scriptJsonSummary
            ? <>Project sẽ nhập <strong>{scriptJsonSummary.episodeCount} tập</strong> · <strong>{scriptJsonSummary.sceneCount} cảnh</strong> từ {scriptJsonSummary.schema}.</>
            : "Chọn file scene-script.v1 hoặc scene-series.v1 để xem số tập và cảnh trước khi tạo project."
          : <>Project sẽ tạo <strong>{totalScenes} cảnh</strong> trong <strong>{totalChunks} chunk</strong>, sau đó bạn có thể chạy từng chunk từ màn hình sử dụng.</>}</span>
      </div>

      {characterSetupPrompt && <div className="character-setup-backdrop">
        <section className="character-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="character-setup-title" aria-describedby="character-setup-description">
          <span className="character-setup-icon"><Icon name="users" size={22} /></span>
          <div className="section-kicker">PROJECT READY</div>
          <h2 id="character-setup-title">{projectCreatedFromJson ? "Kịch bản đã nhập. Tạo hồ sơ nhân vật?" : "Tạo nhân vật trước khi chạy kịch bản?"}</h2>
          <p id="character-setup-description">{projectCreatedFromJson ? "Hồ sơ nhân vật giúp giữ diện mạo nhất quán khi tạo ảnh và video cho các cảnh. Bạn có thể thêm ảnh tham chiếu ngay bây giờ hoặc bổ sung sau trong project." : "Hồ sơ nhân vật giúp giữ diện mạo nhất quán giữa các cảnh. Bạn có thể thêm ảnh tham chiếu và mô tả nhận diện ngay bây giờ, hoặc bổ sung sau trong project."}</p>
          <div className="character-setup-project"><Icon name="folder" size={15} />{characterSetupPrompt.title}</div>
          <div className="character-setup-actions">
            <button className="secondary-button" type="button" onClick={() => continueToProject(false)}>Bỏ qua</button>
            <button className="primary-button" type="button" autoFocus onClick={() => continueToProject(true)}><Icon name="users" size={15} />{projectCreatedFromJson ? "Thêm nhân vật" : "Thêm nhân vật trước"}</button>
          </div>
        </section>
      </div>}
    </div>
  );
}

function StatusDot({ text }: { text: string }) {
  return <span className="server-status"><span className="live-dot" />{text}</span>;
}

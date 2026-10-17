import type { StoryPresetId } from "./story-presets";

/** Hard visual/narration scene cap used by StoryAI and the MaiVideo renderer. */
export const MAX_SCENE_DURATION_SEC = 15;
export const PROJECT_CHUNK_SIZE_PRESETS = [10, 15, 20, 40] as const;
export const MIN_PROJECT_CHUNK_SIZE = 1;
export const MAX_PROJECT_CHUNK_SIZE = 100;

export function isValidProjectChunkSize(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= MIN_PROJECT_CHUNK_SIZE
    && value <= MAX_PROJECT_CHUNK_SIZE;
}

export function normalizeProjectChunkSize(value: unknown, fallback = 20) {
  const parsed = typeof value === "number" ? value : Number(value);
  return isValidProjectChunkSize(parsed) ? parsed : fallback;
}

export function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "story-project";
}

export type ProjectStatus = "draft" | "processing" | "ready" | "needs_review" | "failed";
export type ChunkStatus = "queued" | "processing" | "completed" | "needs_review" | "failed";
export type MediaSource = "stock-mixed" | "stock-image" | "stock-video" | "maivideo-image" | "maivideo-video";
export const IMAGE_DETAIL_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ImageDetailLevel = (typeof IMAGE_DETAIL_LEVELS)[number];
export const IMAGE_DETAIL_LEVEL_LABELS: Record<ImageDetailLevel, string> = {
  low: "Thấp · Low",
  medium: "Trung bình · Medium",
  high: "Cao · High",
  xhigh: "Rất cao · Extra High",
  max: "Tối đa · Max",
};
export type MediaGenerationSettings = {
  videoProvider: "maivideo" | "seedance";
  /** Optional account profile; empty means use the workspace default. */
  seedanceAccountId?: string;
  imageModel: string;
  imageQuality: string;
  imageDetailLevel: ImageDetailLevel;
  videoModel: string;
  videoQuality: string;
  videoDurationMode: "scene" | "fixed";
  videoDurationSec: number;
  videoMultiShot: boolean;
  videoAudio: boolean;
  videoOffPeak: boolean;
  imageUseCharacterReferences: boolean;
  videoUseCharacterReferences: boolean;
  videoUseLocationReferences: boolean;
  videoUseSceneImageReference: boolean;
};

export const DEFAULT_MEDIA_GENERATION_SETTINGS: MediaGenerationSettings = {
  videoProvider: "seedance",
  imageModel: "gpt-image-2.5-flare",
  imageQuality: "1440p",
  imageDetailLevel: "medium",
  videoModel: "seedance-2.5",
  videoQuality: "profile",
  videoDurationMode: "scene",
  videoDurationSec: 5,
  videoMultiShot: false,
  videoAudio: false,
  videoOffPeak: true,
  imageUseCharacterReferences: true,
  videoUseCharacterReferences: true,
  videoUseLocationReferences: true,
  videoUseSceneImageReference: true,
};

export type ImageGenerationModelOption = {
  id: string;
  label: string;
  qualities: string[];
  detailLevels?: ImageDetailLevel[];
  aspectRatiosByQuality?: Record<string, string[]>;
  maxReferenceImages?: number;
};

export type VideoGenerationModelOption = {
  id: string;
  label: string;
  provider?: "maivideo" | "seedance";
  qualities: string[];
  aspectRatios?: string[];
  minDurationSec: number;
  maxDurationSec: number;
  supportedDurationsSec?: number[];
  maxDurationByQuality?: Record<string, number>;
  supportsMultiShot?: boolean;
  supportsAudio?: boolean;
  supportsOffPeak?: boolean;
  maxReferenceImages?: number;
  maxCount?: number;
  promptMaxLength?: number;
  timeoutSeconds?: number;
  offPeakTimeoutSeconds?: number;
};

export type MediaModelCatalog = {
  defaults: MediaGenerationSettings;
  imageModels: ImageGenerationModelOption[];
  videoModels: VideoGenerationModelOption[];
  imageError?: string;
  videoError?: string;
};
export type VoiceProvider = "omnivoice";
export type ScriptMode = "ai" | "manual";
export type ScriptFormat = "plain_text" | "srt";
export type DurationMode = "manual" | "auto";

export type DialogueSegmentAudio = {
  provider: string;
  voiceId: string;
  voiceName?: string;
  language?: string;
  localPath: string;
  textHash: string;
  durationMs?: number;
  createdAt: string;
};

/** One independently voiced, scene-local line of dialogue. */
export type DialogueSegment = {
  id: string;
  speakerCharacterId?: string;
  speakerName?: string;
  text: string;
  startMs: number;
  /** Optional subtitle target end; the audio itself keeps its natural duration. */
  endMs?: number;
  audio?: DialogueSegmentAudio;
  /** Translated line text keyed by target voice language, e.g. en or ja. */
  translations?: Record<string, string>;
  /** Alternate localized audio; the default-language audio remains in `audio`. */
  translatedAudio?: Record<string, DialogueSegmentAudio>;
};

export type SceneReviewStatus = "unreviewed" | "approved" | "needs_changes";
export type SceneAiReviewStatus = "pending" | "passed" | "needs_changes" | "error";
export type SceneAiCheckStatus = "pass" | "warning" | "fail";

export type ContinuityQaIssue = {
  code: string;
  severity: "warning" | "fail";
  sceneId?: string;
  nextSceneId?: string;
  message: string;
};

export type ContinuityQaReport = {
  status: "passed" | "needs_changes";
  score: number;
  sceneCount: number;
  expectedSceneCount: number;
  issueCount: number;
  checks: Record<string, SceneAiCheckStatus>;
  issues: ContinuityQaIssue[];
  createdAt: string;
};

export type VideoGenerationJobStatus = "queued" | "running" | "completed" | "failed" | "paused";

export type VideoGenerationFailureStage = "seedance_create" | "seedance_poll" | "seedance_download" | "seedance_checkpoint";
export type VideoGenerationRetryStrategy = "same_task" | "new_task";

export type SceneMediaJobStatus = "queued" | "running" | "completed" | "failed";

/** Persisted background task for one scene image or video generation. */
export type SceneMediaJob = {
  id: string;
  sceneId: string;
  chunkId: string;
  sceneIndex: number;
  kind: "image" | "video";
  status: SceneMediaJobStatus;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  provider?: string;
  workerId?: string;
  mediaGeneration?: Partial<MediaGenerationSettings>;
  /** Exact composed video prompt sent to the provider for the active/recent job. */
  submittedPrompt?: string;
  /** Seedance checkpoint so a poll can resume the existing provider task. */
  seedanceTaskId?: string;
  /** Provider creation time anchors the Seedance 30-minute polling deadline. */
  seedanceTaskCreatedAt?: string;
  /** MaiVideo checkpoint so polling can resume instead of creating a duplicate job. */
  maiVideoJobId?: string;
  stage?: VideoGenerationFailureStage;
};

export type VideoGenerationJob = {
  id: string;
  sceneId: string;
  chunkId: string;
  sceneIndex: number;
  status: VideoGenerationJobStatus;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  provider?: string;
  /** Persisted Seedance task checkpoint. Never contains credentials. */
  seedanceTaskId?: string;
  /** Provider creation time anchors the Seedance 30-minute polling deadline. */
  seedanceTaskCreatedAt?: string;
  /** The current Seedance step, used to recover interrupted jobs safely. */
  stage?: VideoGenerationFailureStage;
  failureStage?: VideoGenerationFailureStage;
  retryStrategy?: VideoGenerationRetryStrategy;
  requestId?: string;
};

export type VideoQueueState = {
  status: "idle" | "running" | "paused" | "completed" | "failed";
  concurrency: number;
  jobs: VideoGenerationJob[];
  updatedAt: string;
  lastError?: string;
};

export type RenderState = {
  status: "idle" | "running" | "completed" | "manifest_only" | "failed";
  /** The saved full-project file predates newly appended episodes or script changes. */
  stale?: boolean;
  manifestPath?: string;
  outputPath?: string;
  subtitlePath?: string;
  sceneCount?: number;
  durationSec?: number;
  /** Render includes usable sound from TTS and/or the source video. */
  audioReady?: boolean;
  /** Legacy field name: scenes rendered with fallback/hold/color media. */
  missingMedia?: number;
  settings?: RenderSettings;
  /** Alternate renders that reuse the scene media but use translated dialogue/audio. */
  localizedRenders?: Record<string, RenderState>;
  language?: string;
  updatedAt: string;
  error?: string;
};

export type TtsState = {
  status: "idle" | "running" | "completed" | "partial" | "failed" | "not_needed";
  completed: number;
  total: number;
  failed: number;
  updatedAt: string;
  error?: string;
};

export type RenderVisualEffect = "none" | "fog" | "rain" | "fire" | "fireflies" | "snow";
export type RenderColorFilter = "None" | "Warm" | "Cool" | "Vintage" | "B&W";
export type RenderOverlayPosition = "top-left" | "top-right" | "center" | "bottom-left" | "bottom-right";
export type RenderTitlePosition = "top" | "center" | "bottom";

/** FastEdit-compatible post-processing settings applied to the final MP4. */
export type RenderSettings = {
  speed: number;
  enableRandomPanZoom: boolean;
  useRandomInterval: boolean;
  minInterval: number;
  maxInterval: number;
  interval: number;
  maxPanX: number;
  maxPanY: number;
  minScale: number;
  maxScale: number;
  mirror: boolean;
  colorFilter: RenderColorFilter;
  trimStart: number;
  trimEnd: number | null;
  reverse: boolean;
  titleText: string;
  titlePosition: RenderTitlePosition;
  titleFontSize: number;
  titleColor: string;
  watermarkText: string;
  watermarkSpeed: number;
  watermarkFontSize: number;
  watermarkColor: string;
  watermarkOpacity: number;
  logo: "none" | "maivideo" | "custom";
  /** Relative path returned by the project logo upload endpoint. */
  logoPath: string | null;
  logoPosition: RenderOverlayPosition;
  logoOpacity: number;
  logoScale: number;
  visualEffect: RenderVisualEffect;
};

export type SceneAiReview = {
  status: SceneAiReviewStatus;
  score: number;
  summary: string;
  issues: string[];
  checks: Record<string, SceneAiCheckStatus>;
  model?: string;
  createdAt?: string;
  error?: string;
};

export type SceneMediaAsset = {
  kind: "image" | "video";
  provider: string;
  status: "ready" | "failed";
  /** Timestamp of the latest saved generation for this asset. */
  generatedAt?: string;
  /** Background media job that produced this asset, when applicable. */
  generatedFromJobId?: string;
  model?: string;
  quality?: string;
  durationSec?: number;
  localPath?: string;
  sourceUrl?: string;
  query?: string;
  /** Character profile IDs used to render this scene image. */
  referenceCharacterIds?: string[];
  /** Location profile ID used to render this scene image. */
  referenceLocationId?: string;
  /** Media generated before the current character references were assigned. */
  stale?: boolean;
  attribution?: string;
  error?: string;
};

export type SceneContinuityReference = {
  sceneId: string;
  image: SceneMediaAsset;
  /** True when the reference is already available from the saved project output. */
  persisted?: boolean;
};

export type ProjectChunk = {
  id: string;
  title?: string;
  sceneStart: number;
  sceneEnd: number;
  generatedScenes: number;
  status: ChunkStatus;
  error?: string;
  outputPath?: string;
  render?: RenderState;
  tts?: TtsState;
  updatedAt: string;
};

export type VideoTitleOption = {
  title: string;
  hook: string;
  angle?: string;
};

export type ThumbnailPromptOption = {
  concept: string;
  prompt: string;
  overlayText: string;
  layoutNote?: string;
};

export type VideoPublishingSet = {
  titles: VideoTitleOption[];
  thumbnails: ThumbnailPromptOption[];
  updatedAt?: string;
  source?: "gpt-import" | "ai";
  stale?: boolean;
};

export type ProjectVideoPublishingPackage = {
  series?: VideoPublishingSet;
  episodes?: Record<string, VideoPublishingSet>;
};

/**
 * Compact hand-off state between scene chunks. Keeping this on the project
 * makes the next provider call independent from the browser session and lets
 * older projects resume from their last completed chunk.
 */
export type ContinuityContext = {
  schema: "story-continuity.v1";
  chunkId: string;
  sceneEnd: number;
  chunkSummary: string;
  state: Record<string, unknown>;
};

/** A stable visual identity and its canonical image reference for video generation. */
export type ProjectCharacter = {
  id: string;
  name: string;
  description: string;
  imagePrompt?: string;
  referenceImagePath: string;
  referenceImageName: string;
  referenceImageMimeType: string;
  /** AI Drama only: selected OmniVoice profile for this character's dialogue. */
  voiceId?: string;
  voiceName?: string;
  /** Catalog/native language of the selected voice profile; speech uses StoryProject.language. */
  voiceLanguage?: string;
  createdAt: string;
  updatedAt: string;
};

/** A canonical location sheet, commonly a four-view environment reference. */
export type ProjectLocation = {
  id: string;
  name: string;
  aliases?: string[];
  description: string;
  imagePrompt?: string;
  referenceImagePath: string;
  referenceImageName: string;
  referenceImageMimeType: string;
  createdAt: string;
  updatedAt: string;
};

export type ShortDramaSuggestionCategory = "hook" | "stakes" | "character" | "conflict" | "escalation" | "turn" | "payoff" | "dialogue";

export type ShortDramaSuggestion = {
  id: string;
  category: ShortDramaSuggestionCategory;
  title: string;
  anchor: string;
  replacement: string;
  reason: string;
  expectedImpact: string;
};

export type ShortDramaScriptAnalysis = {
  schema: "short-drama-analysis.v1";
  sourceHash: string;
  analyzedAt: string;
  model: string;
  overallScore: number;
  logline: string;
  summary: string;
  scores: {
    hook: number;
    protagonist: number;
    conflict: number;
    escalation: number;
    turns: number;
    payoff: number;
    dialogue: number;
    visual: number;
  };
  beats: Array<{
    key: "hook" | "inciting_incident" | "escalation" | "turning_point" | "crisis" | "payoff";
    status: "present" | "weak" | "missing";
    note: string;
  }>;
  strengths: string[];
  mainRisks: string[];
  suggestions: ShortDramaSuggestion[];
};

export type ScriptDraftVersion = {
  id: string;
  label: string;
  sourceText: string;
  scriptFormat: ScriptFormat;
  durationMode: DurationMode;
  durationMinutes: number;
  createdAt: string;
};

export type ScriptStudioState = {
  analysis?: ShortDramaScriptAnalysis;
  draftText?: string;
  draftBaseHash?: string;
  draftUpdatedAt?: string;
  versions?: ScriptDraftVersion[];
};

export type Activity = {
  id: string;
  projectSlug?: string;
  kind: "project" | "chunk" | "qa" | "source" | "system";
  title: string;
  detail: string;
  status: "info" | "success" | "warning" | "error";
  createdAt: string;
};

export type StoryProject = {
  id: string;
  slug: string;
  title: string;
  videoTitle?: string;
  sourceUrl: string;
  sourceText: string;
  sourceStatus: "missing" | "ready";
  scriptMode?: ScriptMode;
  scriptFormat?: ScriptFormat;
  durationMode?: DurationMode;
  durationSeconds?: number;
  presetId: StoryPresetId;
  durationMinutes: number;
  sceneDurationSec: number;
  chunkSize: number;
  /** Video/script spoken language; this controls dialogue output and TTS synthesis language. */
  language: string;
  voiceProvider?: VoiceProvider;
  voiceId?: string;
  voiceName?: string;
  /** Catalog/native language of the selected voice profile; it does not set the video language. */
  voiceLanguage?: string;
  contentGenre: string;
  secondaryGenres: string[];
  storySetting: string;
  settingNotes: string;
  visualStyle: string;
  imageStyle: string;
  aspectRatio: string;
  mediaSource?: MediaSource;
  mediaGeneration?: Partial<MediaGenerationSettings>;
  scriptProvider: string;
  scriptModel: string;
  status: ProjectStatus;
  totalScenes: number;
  completedScenes: number;
  totalChunks: number;
  completedChunks: number;
  reviewCount: number;
  aiReviewCount?: number;
  continuityQa?: ContinuityQaReport;
  videoQueue?: VideoQueueState;
  sceneMediaJobs?: SceneMediaJob[];
  render?: RenderState;
  publishingPackage?: ProjectVideoPublishingPackage;
  chunks: ProjectChunk[];
  continuityContext?: ContinuityContext;
  seriesBible?: Record<string, unknown>;
  dramaPlan?: DramaProjectPlan;
  characters?: ProjectCharacter[];
  locations?: ProjectLocation[];
  scriptStudio?: ScriptStudioState;
  createdAt: string;
  updatedAt: string;
};

export type DramaProjectPlan = {
  videoTitle: string;
  logline: string;
  synopsis: string;
  characters: Array<{ name: string; description: string; imagePrompt: string }>;
  locations: Array<{ name: string; description: string; imagePrompt: string }>;
  episodes: Array<{ title: string; summary: string; openingHook: string; turningPoint: string; endHook: string }>;
  continuityRules: string;
};

export type CreateProjectInput = Pick<StoryProject, "title" | "sourceUrl" | "sourceText" | "presetId" | "durationMinutes" | "chunkSize" | "language" | "contentGenre" | "secondaryGenres" | "storySetting" | "settingNotes" | "visualStyle" | "imageStyle" | "aspectRatio" | "mediaSource" | "voiceProvider" | "voiceId" | "voiceName" | "voiceLanguage"> & Partial<Pick<StoryProject, "scriptMode" | "scriptFormat" | "durationMode" | "durationSeconds" | "mediaGeneration">> & { deferSourceIngest?: boolean; dramaPlan?: DramaProjectPlan };

export type UpdateProjectInput = Partial<Pick<StoryProject, "title" | "sourceUrl" | "sourceText" | "presetId" | "durationMinutes" | "chunkSize" | "language" | "contentGenre" | "secondaryGenres" | "storySetting" | "settingNotes" | "visualStyle" | "imageStyle" | "aspectRatio" | "mediaSource" | "mediaGeneration" | "voiceProvider" | "voiceId" | "voiceName" | "voiceLanguage" | "status" | "scriptMode" | "scriptFormat" | "durationMode" | "durationSeconds">>;

export type StoryAIData = {
  projects: StoryProject[];
  activities: Activity[];
};

export type ProviderSummary = {
  baseUrl: string;
  primaryModel: string;
  fallbackModels: string[];
  reasoningEffort: string;
  serviceTier: string;
  standard: string;
  keyConfigured: boolean;
};

export type WorkspacePayload = {
  projects: StoryProject[];
  activities: Activity[];
  provider: ProviderSummary;
};

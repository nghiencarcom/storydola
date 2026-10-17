"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORY_PRESETS } from "../lib/story-presets";
import { useProjects } from "../lib/project-store";
import { FALLBACK_VIDEO_LANGUAGES, voiceLanguageLabel, type OmniVoiceCatalog, type OmniVoiceOption } from "../lib/omnivoice";
import { DEFAULT_RENDER_SETTINGS, normalizeRenderSettings } from "../lib/render-effects";
import { DEFAULT_MEDIA_GENERATION_SETTINGS, IMAGE_DETAIL_LEVEL_LABELS, type DialogueSegment, type ImageGenerationModelOption, type MediaGenerationSettings, type MediaModelCatalog, type ProjectCharacter, type ProjectLocation, type RenderSettings, type SceneAiReview, type SceneMediaJob, type StoryProject, type VideoGenerationModelOption, type VideoPublishingSet } from "../lib/project-types";
import { availableImageModels as filterAvailableImageModels, DEFAULT_SEEDANCE_VIDEO_MODEL_ID, imageDetailLevelsForModel, isPixverseVideoModel, isVideoOffPeakRequired, normalizeVideoDuration, resolveMediaGenerationSettings, videoDurationOptions, videoQualitiesForModel } from "../lib/media-generation-settings";
import { estimateDialogueDurationMs, hasExplicitDialogueSegments, readDialogueSegments } from "../lib/dialogue-segments";
import { normalizeEntityName } from "../lib/entity-name";
import { contentGenresLabel, storySettingLabel } from "../lib/content-genres";
import { characterReferencePrompt, locationReferencePrompt, PROFILE_REFERENCE_ASPECT_RATIO } from "../lib/ai-drama-reference-prompts";
import { sceneReferenceCharacterIds, sceneReferenceLocationId, type SceneReferenceKind } from "../lib/scene-reference-assignments";
import { sanitizeDramaVisualPrompt } from "../lib/visual-prompt-safety";
import { MAX_SCENE_MEDIA_UPLOAD_BYTES } from "../lib/scene-media-upload-config";
import { shouldChunkSceneMediaFile, uploadSceneMediaInChunks } from "../lib/scene-media-upload-client";
import { createEpisodeScriptTemplate } from "../lib/project-script-templates";
import { ShortDramaStudio } from "./short-drama-studio";
import { Icon } from "./ui-icon";

type SceneMediaPreview = {
  kind?: "image" | "video";
  provider?: string;
  status?: "ready" | "failed";
  stale?: boolean;
  model?: string;
  quality?: string;
  durationSec?: number;
  query?: string;
  sourceUrl?: string;
  localPath?: string;
  referenceCharacterIds?: string[];
  referenceLocationId?: string;
  error?: string;
};

type SceneMediaJobPreview = Pick<SceneMediaJob, "id" | "sceneId" | "chunkId" | "sceneIndex" | "kind" | "status" | "attempt" | "createdAt" | "updatedAt" | "startedAt" | "finishedAt" | "error" | "provider" | "stage" | "submittedPrompt">;

type SceneReviewStatus = "unreviewed" | "approved" | "needs_changes";
type SceneReviewFilter = "all" | SceneReviewStatus;
type SceneMediaFilter = "all" | "ready" | "missing" | "ai" | "stock";
type SceneAiReviewStatus = "pending" | "passed" | "needs_changes" | "error";
type SceneAiReviewFilter = "all" | SceneAiReviewStatus;

type ScenePreview = Record<string, unknown> & {
  id: string;
  chunkId: string;
  sceneIndex: number;
  characterIds?: string[];
  locationId?: string;
  previewUrl?: string;
  referenceImagePreviewUrl?: string;
  videoReferenceImage?: SceneMediaPreview;
  media?: SceneMediaPreview;
  mediaJob?: SceneMediaJobPreview;
  reviewStatus?: SceneReviewStatus;
  reviewNote?: string;
  aiReview?: SceneAiReview;
};

type SceneVideoPromptPreview = {
  prompt: string;
  promptLength: number;
  provider: string;
  model: string;
  dialogueCueCount: number;
  dialogueIncluded: boolean;
};

type SceneVideoPromptPreviewState = {
  loading?: boolean;
  error?: string;
  result?: SceneVideoPromptPreview;
};

const sceneMediaPollFields = [
  "media",
  "mediaJob",
  "videoReferenceImage",
  "video_reference_image",
  "previewUrl",
  "referenceImagePreviewUrl",
  "reviewStatus",
  "reviewNote",
  "aiReview",
] as const;

function mergePolledSceneMedia(current: ScenePreview[], incoming: ScenePreview[]) {
  let changed = current.length !== incoming.length
    || current.some((scene, index) => scene.id !== incoming[index]?.id);
  const currentById = new Map(current.map((scene) => [scene.id, scene]));
  const merged = incoming.map((next) => {
    const previous = currentById.get(next.id);
    if (!previous) {
      changed = true;
      return next;
    }
    let sceneChanged = false;
    for (const field of sceneMediaPollFields) {
      if (JSON.stringify(previous[field]) !== JSON.stringify(next[field])) {
        sceneChanged = true;
        break;
      }
    }
    if (!sceneChanged) return previous;
    changed = true;
    const refreshedMediaState = Object.fromEntries(sceneMediaPollFields.map((field) => [field, next[field]]));
    return { ...previous, ...refreshedMediaState };
  });
  return changed ? merged : current;
}

type MaiVideoImagePreview = {
  id: string;
  name: string;
  fileName: string;
  previewUrl: string;
  source: string;
};

const BATCH_PROFILE_IMAGE_CONCURRENCY = 5;
const BATCH_TTS_EPISODE_CONCURRENCY = 5;
const VIDEO_QUEUE_CONCURRENCY = 20;

async function forEachConcurrent<T>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<void>) {
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await task(items[index], index);
    }
  }));
}

function sceneText(scene: ScenePreview, ...keys: string[]) {
  for (const key of keys) {
    const value = scene[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function sceneLocationName(scene: ScenePreview) {
  const explicit = sceneText(scene, "location_name", "locationName", "location", "environment_name", "environmentName");
  if (explicit) return explicit;
  const prompt = sceneText(scene, "image_prompt", "imagePrompt");
  const match = prompt.match(/^\s*(?:one|a|an)\s+(?:[\w-]+\s+){0,3}(?:frame|shot|image)\s+(?:in|at|on|inside|aboard)\s+([^:;!?]+)/i);
  if (!match) return "";
  return match[1]
    .replace(/\s+(?:as|while|where|when|during|before|after|at the moment)\b[\s\S]*$/i, "")
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/[’']s(?=\s|$)/g, "")
    .trim()
    .replace(/[.,;:!?]+$/, "") || "";
}

function sceneCharacterIds(scene: ScenePreview) {
  const raw = scene.characterIds || scene.character_ids;
  return Array.isArray(raw) ? [...new Set(raw.map((id) => String(id)))] : [];
}

function sceneSpeakerCharacterId(scene: ScenePreview | undefined, characters: ProjectCharacter[]) {
  if (!scene) return "";
  const hasExplicitId = Object.prototype.hasOwnProperty.call(scene, "speakerCharacterId") || Object.prototype.hasOwnProperty.call(scene, "speaker_character_id");
  if (hasExplicitId) {
    const explicitId = String(scene.speakerCharacterId || scene.speaker_character_id || "").trim();
    return characters.some((character) => character.id === explicitId) ? explicitId : "";
  }
  const speaker = sceneText(scene, "speaker_character", "speakerCharacter", "speaker_name", "speakerName", "speaker");
  const normalizedSpeaker = normalizeEntityName(speaker);
  if (speaker && !["narrator", "voiceover", "none", "n a"].includes(normalizedSpeaker)) {
    const matched = normalizedSpeaker ? characters.find((character) => normalizeEntityName(character.name) === normalizedSpeaker) : undefined;
    if (matched) return matched.id;
  }
  const assigned = sceneCharacterIds(scene);
  return assigned.length === 1 && characters.some((character) => character.id === assigned[0]) ? assigned[0] : "";
}

function sceneLocationId(scene?: ScenePreview) {
  const value = scene?.locationId || scene?.location_id || scene?.environment_id || scene?.environmentId;
  return typeof value === "string" ? value : "";
}

function sceneReferenceMedia(scene?: ScenePreview) {
  const saved = scene?.videoReferenceImage || scene?.video_reference_image;
  const savedRecord = saved && typeof saved === "object" && !Array.isArray(saved) ? saved as SceneMediaPreview : undefined;
  const media = scene?.media?.kind === "image" ? scene.media : undefined;
  const candidates = [savedRecord, media].filter((candidate): candidate is SceneMediaPreview => Boolean(candidate && candidate.kind === "image" && candidate.status === "ready"));
  return candidates.find((candidate) => !candidate.stale) || candidates[0] || savedRecord || media;
}

async function clipboardPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type.toLowerCase() === "image/png") return blob;
  if (typeof createImageBitmap !== "function") throw new Error("Trình duyệt không chuyển được ảnh tham chiếu sang PNG để copy.");
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Không thể chuẩn bị ảnh tham chiếu để copy.");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => png ? resolve(png) : reject(new Error("Không thể mã hóa ảnh tham chiếu thành PNG.")), "image/png");
    });
  } finally {
    bitmap.close();
  }
}

function sceneAudioRecord(scene?: ScenePreview) {
  return scene?.audio && typeof scene.audio === "object" && !Array.isArray(scene.audio)
    ? scene.audio as Record<string, unknown>
    : {};
}

function sceneDialogueSegments(scene: ScenePreview, characters: ProjectCharacter[]) {
  return readDialogueSegments(scene, characters);
}

type SceneTimelineRow = {
  kind: "dialogue" | "gap";
  startSec: number;
  endSec: number;
  segment?: DialogueSegment;
};

function sceneTimelineRows(scene: ScenePreview, segments: DialogueSegment[]): SceneTimelineRow[] {
  const durationSec = sceneDurationSeconds(scene);
  const rows: SceneTimelineRow[] = [];
  let cursor = 0;
  for (const segment of segments) {
    const startSec = Math.max(0, Math.min(durationSec, segment.startMs / 1000));
    const inferredEnd = (segment.endMs ?? segment.startMs + estimateDialogueDurationMs(segment.text)) / 1000;
    const endSec = Math.max(startSec, Math.min(durationSec, inferredEnd));
    if (startSec > cursor + 0.01) rows.push({ kind: "gap", startSec: cursor, endSec: startSec });
    if (endSec > startSec) rows.push({ kind: "dialogue", startSec, endSec, segment });
    cursor = Math.max(cursor, endSec);
  }
  if (cursor < durationSec - 0.01) rows.push({ kind: "gap", startSec: cursor, endSec: durationSec });
  if (!rows.length) rows.push({ kind: "gap", startSec: 0, endSec: durationSec });
  return rows;
}

function profileImagePrompt(profile: { name: string; imagePrompt?: string; description?: string }, kind: "characters" | "locations") {
  const prompt = profile.imagePrompt?.trim() || profile.description?.trim() || "";
  return kind === "characters"
    ? characterReferencePrompt(profile.name, prompt, PROFILE_REFERENCE_ASPECT_RATIO)
    : locationReferencePrompt(profile.name, prompt, PROFILE_REFERENCE_ASPECT_RATIO);
}

function sceneNeedsDialogueExtraction(scene: ScenePreview) {
  return !hasExplicitDialogueSegments(scene) && Boolean(sceneText(scene, "dialogue_or_voiceover", "dialogueOrVoiceover", "voiceText", "voiceover", "ttsVoice", "tts_voice"));
}

function sceneScriptCharacterNames(scene: ScenePreview) {
  const raw = scene.characters || scene.character_names || scene.characterNames;
  const names = Array.isArray(raw) ? raw.map((value) => {
    if (typeof value === "string") return value.trim();
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    const record = value as Record<string, unknown>;
    return String(record.name || record.character_name || record.characterName || "").trim();
  }) : [];
  const speaker = sceneText(scene, "speaker_character", "speakerCharacter", "speaker_name", "speakerName", "speaker");
  return [...new Set([...names, speaker].filter((name) => name && !["narrator", "voiceover", "none", "n a"].includes(normalizeEntityName(name))))];
}

function sceneFieldValue(scene: ScenePreview, ...keys: string[]) {
  for (const key of keys) {
    const value = scene[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
    if (Array.isArray(value) && value.length) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(" · ");
  }
  return "";
}

function normalizePromptForComparison(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function dialogueTimecodeMs(value: string) {
  const match = value.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return undefined;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4].padEnd(3, "0"));
  return (((hours * 60 + minutes) * 60 + seconds) * 1000) + milliseconds;
}

function parseDialogueSrt(value: string, characters: ProjectCharacter[]): DialogueSegment[] {
  const blocks = value.replace(/\r/g, "").trim().split(/\n\s*\n/).filter(Boolean);
  const output: DialogueSegment[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) continue;
    const timing = lines[timeIndex].split("-->").map((part) => part.trim());
    const startMs = dialogueTimecodeMs(timing[0] || "");
    const endMs = dialogueTimecodeMs(timing[1] || "");
    if (startMs === undefined || endMs === undefined || endMs <= startMs || endMs > 15_000) continue;
    let text = lines.slice(timeIndex + 1).join(" ").trim();
    if (!text) continue;
    const prefix = text.match(/^\[([^\]]+)\]\s*(.*)$/) || text.match(/^([^:]{1,60}):\s*(.+)$/);
    const speakerName = prefix?.[1]?.trim();
    const normalized = normalizeEntityName(speakerName || "");
    const speaker = characters.find((character) => normalizeEntityName(character.name) === normalized);
    if ((speaker || normalized === "narrator") && prefix?.[2]?.trim()) text = prefix[2].trim();
    output.push({
      id: `line-${Date.now()}-${output.length + 1}`,
      speakerCharacterId: speaker?.id || undefined,
      speakerName: speaker?.name || (normalized === "narrator" ? "NARRATOR" : undefined),
      text,
      startMs,
      endMs,
    });
  }
  return output;
}

function secondsInput(milliseconds: number | undefined) {
  return milliseconds === undefined ? "" : (milliseconds / 1000).toFixed(1);
}

function mediaSettingsForScene(scene: ScenePreview | undefined, project: StoryProject): MediaGenerationSettings {
  const sceneSettings = scene?.mediaGeneration || scene?.media_generation;
  const overrides = sceneSettings && typeof sceneSettings === "object" && !Array.isArray(sceneSettings)
    ? sceneSettings as Partial<MediaGenerationSettings>
    : {};
  return resolveMediaGenerationSettings({ ...project.mediaGeneration, ...overrides, ...(project.presetId === "ai-drama" ? { videoDurationMode: "scene" } : {}) });
}

function sceneVideoDurationLimit(model: VideoGenerationModelOption | undefined, quality: string) {
  return Math.min(15, model?.maxDurationByQuality?.[quality] || model?.maxDurationSec || 15);
}

function sceneDurationSeconds(scene: ScenePreview, fallback = 15) {
  const start = Number(scene.start_sec ?? scene.startSec);
  const end = Number(scene.end_sec ?? scene.endSec);
  const exact = Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : Number(scene.duration_sec ?? scene.durationSec ?? scene.voiceover_target_sec ?? scene.voiceoverTargetSec);
  return Number.isFinite(exact) && exact > 0 ? Math.min(15, Math.max(1, exact)) : Math.min(15, Math.max(1, fallback || 15));
}

function sceneTimeRange(scene: ScenePreview) {
  const start = Number(scene.start_sec ?? scene.startSec);
  const end = Number(scene.end_sec ?? scene.endSec);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "0–15s";
  return `${start.toFixed(0)}–${end.toFixed(0)}s`;
}

function videoFailureStageLabel(stage?: string) {
  if (stage === "seedance_create") return "Tạo task Seedance";
  if (stage === "seedance_poll") return "Theo dõi task Seedance";
  if (stage === "seedance_download") return "Tải video Seedance";
  if (stage === "seedance_checkpoint") return "Lưu task Seedance";
  return "Lỗi xử lý video";
}

function sceneNeedsImage(scene: ScenePreview, project: StoryProject) {
  const reference = sceneReferenceMedia(scene);
  if (reference?.status === "ready" && !reference.stale && reference.provider === "upload") return false;
  if (!(reference?.status === "ready" && !reference.stale && String(reference.provider || "").startsWith("maivideo-image"))) return true;
  const settings = mediaSettingsForScene(scene, project);
  const expectedCharacters = settings.imageUseCharacterReferences ? sceneReferenceCharacterIds(scene, "image") : [];
  const savedCharacters = Array.isArray(reference.referenceCharacterIds) ? reference.referenceCharacterIds.map(String) : [];
  return JSON.stringify([...expectedCharacters].sort()) !== JSON.stringify([...savedCharacters].sort()) || String(reference.referenceLocationId || "") !== sceneReferenceLocationId(scene, "image");
}

function sceneNeedsAiVideo(scene: ScenePreview) {
  return !(scene.media?.status === "ready" && scene.media.kind === "video" && !scene.media.stale && ["maivideo-video", "seedance", "upload"].some((provider) => String(scene.media?.provider || "").startsWith(provider)));
}

function sceneHasActiveMediaJob(scene: ScenePreview) {
  return scene.mediaJob?.status === "queued" || scene.mediaJob?.status === "running";
}

function sceneNumberLabel(scene: ScenePreview) {
  const number = Number(scene.sceneNumber || String(scene.id).replace(/\D/g, ""));
  return Number.isFinite(number) && number > 0 ? `S${String(number).padStart(3, "0")}` : scene.id;
}

function compactSceneText(value: string, max = 130) {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function sceneReviewStatus(scene: ScenePreview): SceneReviewStatus {
  const value = String(scene.reviewStatus || scene.review_status || "unreviewed");
  return value === "approved" || value === "needs_changes" ? value : "unreviewed";
}

function sceneReviewLabel(status: SceneReviewStatus) {
  return status === "approved" ? "Đã duyệt" : status === "needs_changes" ? "Cần sửa" : "Chờ người dùng";
}

function sceneReviewTone(status: SceneReviewStatus) {
  return status === "approved" ? "approved" : status === "needs_changes" ? "needs-changes" : "unreviewed";
}

function sceneAiReview(scene: ScenePreview): SceneAiReview {
  const raw = scene.aiReview || (scene.ai_review as Partial<SceneAiReview> | undefined) || {};
  const status = String(raw.status || "pending");
  return {
    status: ["passed", "needs_changes", "error"].includes(status) ? status as SceneAiReviewStatus : "pending",
    score: Number.isFinite(Number(raw.score)) ? Math.max(0, Math.min(100, Number(raw.score))) : 0,
    summary: String(raw.summary || "AI chưa đánh giá cảnh này."),
    issues: Array.isArray(raw.issues) ? raw.issues.map((issue) => String(issue)).filter(Boolean) : [],
    checks: raw.checks && typeof raw.checks === "object" ? raw.checks : {},
    model: raw.model,
    createdAt: raw.createdAt,
    error: raw.error,
  };
}

function sceneAiReviewLabel(status: SceneAiReviewStatus) {
  return status === "passed" ? "AI đạt" : status === "needs_changes" ? "AI cần sửa" : status === "error" ? "AI lỗi" : "Chờ AI";
}

function sceneAiReviewTone(status: SceneAiReviewStatus) {
  return status === "passed" ? "ai-passed" : status === "needs_changes" ? "ai-needs-changes" : status === "error" ? "ai-error" : "ai-pending";
}

function sceneMatchesAiReviewFilter(scene: ScenePreview, filter: SceneAiReviewFilter) {
  return filter === "all" || sceneAiReview(scene).status === filter;
}

function sceneMediaReady(media?: SceneMediaPreview, aiDrama = false) {
  return Boolean(media && media.status === "ready" && !media.stale && (!aiDrama || media.kind === "video"));
}

function sceneMediaKindLabel(media?: SceneMediaPreview, aiDrama = false) {
  if (media?.stale) return "Cần tạo lại";
  if (!media || media.status !== "ready") return "Thiếu media";
  if (aiDrama && media.kind !== "video") return "Sai loại media";
  if (media.provider?.includes("seedance")) return "Seedance AI";
  return media.provider?.startsWith("maivideo") ? "MaiVideo AI" : media.provider?.startsWith("pexels") ? "Stock" : "Có media";
}

function sceneMatchesMediaFilter(scene: ScenePreview, filter: SceneMediaFilter, aiDrama = false) {
  const media = scene.media;
  if (filter === "all") return true;
  const ready = sceneMediaReady(media, aiDrama);
  if (filter === "missing") return !ready;
  if (filter === "ready") return ready;
  if (filter === "ai") return ready && media?.kind === "video" && Boolean(media.provider?.startsWith("maivideo"));
  return ready && Boolean(media?.provider?.startsWith("pexels"));
}

function StatusPill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`status-pill ${tone}`}><span className="status-dot" />{children}</span>;
}

function projectProgress(project: StoryProject) {
  return Math.min(100, Math.round((project.completedScenes / Math.max(1, project.totalScenes)) * 100));
}

function mediaSourceLabel(source: StoryProject["mediaSource"]) {
  return source === "stock-image" ? "Stock ảnh" : source === "stock-video" ? "Stock video" : source === "maivideo-image" ? "MaiVideo AI ảnh" : source === "maivideo-video" ? "AI video · hệ thống đã chọn" : "Stock mix · MaiVideo fallback";
}

function projectRenderSettings(project: StoryProject, savedSettings?: Partial<RenderSettings> | null): RenderSettings {
  const defaults = project.presetId === "ai-drama"
    ? { ...DEFAULT_RENDER_SETTINGS, enableRandomPanZoom: false }
    : DEFAULT_RENDER_SETTINGS;
  return normalizeRenderSettings({ ...defaults, ...savedSettings });
}

export function DashboardView({ projectSlug }: { projectSlug?: string }) {
  const { projects, ready } = useProjects();
  const project = projectSlug ? projects.find((item) => item.slug === projectSlug) : projects[0];

  if (!ready) return <div className="loading-state">Đang tải workspace…</div>;
  if (!project) return <div className="empty-page"><div className="empty-icon"><Icon name="folder" size={22} /></div><h1>Chưa có dự án</h1><p>Tạo dự án đầu tiên để bắt đầu pipeline kịch bản.</p><Link className="primary-button" href="/projects/new"><Icon name="plus" size={16} />Tạo dự án</Link></div>;

  return <DashboardProjectContent key={project.slug} project={project} />;
}

function DashboardProjectContent({ project }: { project: StoryProject }) {
  const { activities, updateProject, refresh } = useProjects();
  const [activeFilter, setActiveFilter] = useState("Tất cả");
  const [isRunning, setIsRunning] = useState(false);
  const [showExtendEpisodes, setShowExtendEpisodes] = useState(false);
  const [extendEpisodeCount, setExtendEpisodeCount] = useState(1);
  const [extendingEpisodes, setExtendingEpisodes] = useState(false);
  const [runningScriptChunkId, setRunningScriptChunkId] = useState("");
  const [viewingScriptChunkId, setViewingScriptChunkId] = useState("");
  const [sourceUrl, setSourceUrl] = useState(project?.sourceUrl || "");
  const [sourceText, setSourceText] = useState(project?.sourceText || "");
  const [runMessage, setRunMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [publishingScope, setPublishingScope] = useState("series");
  const [publishingBusy, setPublishingBusy] = useState(false);
  const [publishingError, setPublishingError] = useState("");
  const [publishingNotice, setPublishingNotice] = useState("");
  const [scenes, setScenes] = useState<ScenePreview[]>([]);
  const [scenesLoading, setScenesLoading] = useState(false);
  const [sceneVideoPromptPreviews, setSceneVideoPromptPreviews] = useState<Record<string, SceneVideoPromptPreviewState>>({});
  const sceneVideoPromptPreviewRequestIds = useRef<Record<string, number>>({});
  const [copyingSceneVideoPromptId, setCopyingSceneVideoPromptId] = useState("");
  const [copiedSceneVideoPromptId, setCopiedSceneVideoPromptId] = useState("");
  const [copyingSceneVideoReferencesId, setCopyingSceneVideoReferencesId] = useState("");
  const [copiedSceneVideoReferencesId, setCopiedSceneVideoReferencesId] = useState("");
  const [preparedSceneVideoReferencesId, setPreparedSceneVideoReferencesId] = useState("");
  const [sceneVideoReferenceCopyProgress, setSceneVideoReferenceCopyProgress] = useState<Record<string, { cacheKey: string; nextIndex: number; lastCopiedIndex: number; total: number; complete: boolean }>>({});
  const [sceneVideoReferenceCopyNotice, setSceneVideoReferenceCopyNotice] = useState<{ sceneId: string; text: string } | null>(null);
  const sceneVideoReferenceClipboardCache = useRef<Record<string, Blob[]>>({});
  const sceneVideoReferenceClipboardPending = useRef<Record<string, Promise<Blob[]> | undefined>>({});
  const [sceneUploadProgress, setSceneUploadProgress] = useState<{ sceneId: string; text: string } | null>(null);
  const [sceneError, setSceneError] = useState("");
  const [scenePromptDrafts, setScenePromptDrafts] = useState<Record<string, { imagePrompt: string; videoPrompt: string }>>({});
  const [scenePromptSavingId, setScenePromptSavingId] = useState("");
  const dialogueDirtySceneIdsRef = useRef(new Set<string>());
  const [voiceCatalog, setVoiceCatalog] = useState<OmniVoiceCatalog | null>(null);
  const [mediaCatalog, setMediaCatalog] = useState<MediaModelCatalog | null>(null);
  const [mediaCatalogError, setMediaCatalogError] = useState("");
  const [voiceCatalogLoading, setVoiceCatalogLoading] = useState(false);
  const [sceneTtsSaving, setSceneTtsSaving] = useState(false);
  const [sceneMediaSettingsSaving, setSceneMediaSettingsSaving] = useState(false);
  const [batchMediaSettings, setBatchMediaSettings] = useState<MediaGenerationSettings>(DEFAULT_MEDIA_GENERATION_SETTINGS);
  const [batchMediaBusy, setBatchMediaBusy] = useState(false);
  const [batchMediaProgress, setBatchMediaProgress] = useState("");
  const [batchRegenerateImages, setBatchRegenerateImages] = useState(false);
  const [batchRegenerateVideos, setBatchRegenerateVideos] = useState(false);
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [sceneDetailOpen, setSceneDetailOpen] = useState(false);
  const [dramaTab, setDramaTab] = useState<"scenes" | "characters" | "locations">("scenes");
  const [profileBusyId, setProfileBusyId] = useState("");
  const [profileImageBusyIds, setProfileImageBusyIds] = useState<Set<string>>(() => new Set());
  const [profileBatchKinds, setProfileBatchKinds] = useState<Set<"characters" | "locations">>(() => new Set());
  const [profileBatchProgress, setProfileBatchProgress] = useState<Record<"characters" | "locations", string>>({ characters: "", locations: "" });
  const [newDramaProfile, setNewDramaProfile] = useState({ name: "", description: "", imagePrompt: "" });
  const dramaReferenceSyncAttempted = useRef("");
  const dramaSceneAssignmentAttempted = useRef("");
  const [characterVoiceSavingId, setCharacterVoiceSavingId] = useState("");
  const [generatingSceneId, setGeneratingSceneId] = useState("");
  const [generatingSceneMediaKind, setGeneratingSceneMediaKind] = useState<"image" | "video" | "">("");
  const [sceneSearch, setSceneSearch] = useState("");
  const [sceneChunkFilter, setSceneChunkFilter] = useState("all");
  const [sceneReviewFilter, setSceneReviewFilter] = useState<SceneReviewFilter>("all");
  const [sceneAiReviewFilter, setSceneAiReviewFilter] = useState<SceneAiReviewFilter>("all");
  const [sceneMediaFilter, setSceneMediaFilter] = useState<SceneMediaFilter>("all");
  const [expandedDramaSceneId, setExpandedDramaSceneId] = useState("");
  const [sceneImagePreview, setSceneImagePreview] = useState<ScenePreview | null>(null);
  const [sceneReviewNote, setSceneReviewNote] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [characterDescription, setCharacterDescription] = useState("");
  const [characterImageSource, setCharacterImageSource] = useState<"upload" | "project" | "maivideo">("upload");
  const [selectedCharacterMediaSceneId, setSelectedCharacterMediaSceneId] = useState("");
  const [selectedMaiVideoImageId, setSelectedMaiVideoImageId] = useState("");
  const [maiVideoLibraryImages, setMaiVideoLibraryImages] = useState<MaiVideoImagePreview[]>([]);
  const [maiVideoLibraryLoading, setMaiVideoLibraryLoading] = useState(false);
  const [maiVideoLibraryLoaded, setMaiVideoLibraryLoaded] = useState(false);
  const [maiVideoLibraryError, setMaiVideoLibraryError] = useState("");
  const [characterSaving, setCharacterSaving] = useState(false);
  const [characterError, setCharacterError] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationAliases, setLocationAliases] = useState("");
  const [locationDescription, setLocationDescription] = useState("");
  const [locationImageSource, setLocationImageSource] = useState<"upload" | "project" | "maivideo">("upload");
  const [selectedLocationMediaSceneId, setSelectedLocationMediaSceneId] = useState("");
  const [selectedLocationMaiVideoImageId, setSelectedLocationMaiVideoImageId] = useState("");
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [sceneCharacterSaving, setSceneCharacterSaving] = useState(false);
  const [dialogueSavingSceneId, setDialogueSavingSceneId] = useState("");
  const [dialogueTranslationLanguage, setDialogueTranslationLanguage] = useState(() => (project.language || "vi").toLowerCase().startsWith("vi") ? "en" : "vi");
  const [dialogueTranslationSceneId, setDialogueTranslationSceneId] = useState("");
  const [dialogueTranslationBatchProgress, setDialogueTranslationBatchProgress] = useState("");
  const [dialogueTtsBatchProgress, setDialogueTtsBatchProgress] = useState("");
  const [dialogueExtractingSceneId, setDialogueExtractingSceneId] = useState("");
  const [dialogueExtractBatchProgress, setDialogueExtractBatchProgress] = useState("");
  const [characterSyncing, setCharacterSyncing] = useState(false);
  const [dialogueSrtDrafts, setDialogueSrtDrafts] = useState<Record<string, string>>({});
  const [autoAssignCharactersBusy, setAutoAssignCharactersBusy] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [aiReviewRunning, setAiReviewRunning] = useState(false);
  const [aiReviewProgress, setAiReviewProgress] = useState("");
  const [continuityRunning, setContinuityRunning] = useState(false);
  const [renderRunning, setRenderRunning] = useState(false);
  const [renderingChunkId, setRenderingChunkId] = useState("");
  const [renderingLanguage, setRenderingLanguage] = useState("");
  const [batchRenderProgress, setBatchRenderProgress] = useState("");
  const [ttsRunning, setTtsRunning] = useState(false);
  const [ttsChunkId, setTtsChunkId] = useState("");
  const [deletingTtsChunkId, setDeletingTtsChunkId] = useState("");
  const [ttsSceneId, setTtsSceneId] = useState("");
  const [batchTtsProgress, setBatchTtsProgress] = useState("");
  const [importingScripts, setImportingScripts] = useState(false);
  const [episodeScriptEditorOpen, setEpisodeScriptEditorOpen] = useState(false);
  const [episodeScriptChunkId, setEpisodeScriptChunkId] = useState("");
  const [episodeScriptDraft, setEpisodeScriptDraft] = useState("");
  const [episodeScriptDrafts, setEpisodeScriptDrafts] = useState<Record<string, string>>({});
  const [logoUploading, setLogoUploading] = useState(false);
  const [renderSettings, setRenderSettings] = useState<RenderSettings>(() => projectRenderSettings(project, project.render?.settings));
  const [videoQueueRunning, setVideoQueueRunning] = useState(false);
  const characterImageInputRef = useRef<HTMLInputElement>(null);
  const locationImageInputRef = useRef<HTMLInputElement>(null);
  const videoQueueStopRef = useRef(false);
  const autoResumeVideoQueueAtRef = useRef<Record<string, number>>({});
  const scenesLoadInFlightRef = useRef(false);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    if (search.get("setupCharacters") !== "1") return;
    if (project.presetId === "ai-drama") setDramaTab("characters");
    const timer = window.setTimeout(() => {
      if (project.presetId === "ai-drama") {
        const characterForm = document.getElementById("ai-drama-character-create");
        characterForm?.scrollIntoView({ behavior: "smooth", block: "center" });
        characterForm?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
      } else {
        const characterPanel = document.getElementById("character-reference-panel");
        if (characterPanel instanceof HTMLDetailsElement) characterPanel.open = true;
        const locationPanel = document.getElementById("location-reference-panel");
        if (locationPanel instanceof HTMLDetailsElement) locationPanel.open = true;
        characterPanel?.scrollIntoView({ behavior: "smooth", block: "center" });
        document.getElementById("character-name")?.focus({ preventScroll: true });
      }
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [project?.slug, project?.presetId]);

  useEffect(() => {
    if (project) {
      setSourceUrl(project.sourceUrl);
      setSourceText(project.sourceText);
      setRenderSettings(projectRenderSettings(project, project.render?.settings));
    }
  }, [project?.slug, project?.presetId, project?.render?.updatedAt]);

  useEffect(() => {
    if (project) setBatchMediaSettings(resolveMediaGenerationSettings({ ...DEFAULT_MEDIA_GENERATION_SETTINGS, ...project.mediaGeneration, ...(project.presetId === "ai-drama" ? { videoDurationMode: "scene" } : {}) }));
  }, [project?.slug, project?.mediaGeneration?.imageModel, project?.mediaGeneration?.imageQuality, project?.mediaGeneration?.imageDetailLevel, project?.mediaGeneration?.videoModel, project?.mediaGeneration?.videoQuality, project?.mediaGeneration?.videoDurationMode, project?.mediaGeneration?.videoDurationSec, project?.mediaGeneration?.videoMultiShot, project?.mediaGeneration?.videoAudio, project?.mediaGeneration?.videoOffPeak, project?.mediaGeneration?.imageUseCharacterReferences, project?.mediaGeneration?.videoUseCharacterReferences, project?.mediaGeneration?.videoUseLocationReferences, project?.mediaGeneration?.videoUseSceneImageReference]);

  useEffect(() => {
    if (!project || publishingScope !== "series" || project.publishingPackage?.series) return;
    const firstPackagedEpisode = project.chunks.find((chunk) => chunk.outputPath && project.publishingPackage?.episodes?.[chunk.id]);
    if (firstPackagedEpisode) setPublishingScope(firstPackagedEpisode.id);
  }, [project?.slug, project?.completedChunks, project?.publishingPackage, publishingScope]);

  function updateRenderSetting<K extends keyof RenderSettings>(key: K, value: RenderSettings[K]) {
    setRenderSettings((current) => ({ ...current, [key]: value }));
  }

  async function uploadRenderLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !project?.slug) return;
    setLogoUploading(true);
    setSceneError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/render/logo`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể tải logo lên.");
      updateRenderSetting("logo", "custom");
      updateRenderSetting("logoPath", String(payload.path));
      setRunMessage({ tone: "success", text: `Đã tải logo ${payload.name || file.name}. Logo sẽ được dùng ở lần render kế tiếp.` });
    } catch (cause) {
      setRunMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Không thể tải logo lên." });
    } finally {
      setLogoUploading(false);
    }
  }

  async function loadMaiVideoLibraryImages(force = false) {
    if (maiVideoLibraryLoading || (maiVideoLibraryLoaded && !force)) return;
    setMaiVideoLibraryLoading(true);
    setMaiVideoLibraryError("");
    try {
      const response = await fetch("/api/maivideo/media-library", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không tải được thư viện ảnh MaiVideo.");
      setMaiVideoLibraryImages(Array.isArray(payload.images) ? payload.images as MaiVideoImagePreview[] : []);
      setMaiVideoLibraryLoaded(true);
    } catch (cause) {
      setMaiVideoLibraryError(cause instanceof Error ? cause.message : "Không tải được thư viện ảnh MaiVideo.");
    } finally {
      setMaiVideoLibraryLoading(false);
    }
  }

  async function createCharacter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = characterImageInputRef.current?.files?.[0];
    const hasSelectedImage = characterImageSource === "upload" ? Boolean(file) : characterImageSource === "project" ? Boolean(selectedCharacterMediaSceneId) : Boolean(selectedMaiVideoImageId);
    if (!project?.slug || !characterName.trim() || !hasSelectedImage) {
      setCharacterError("Nhập tên nhân vật và chọn ảnh tham chiếu.");
      return;
    }
    setCharacterSaving(true);
    setCharacterError("");
    try {
      const formData = new FormData();
      formData.append("name", characterName.trim());
      formData.append("description", characterDescription.trim());
      if (characterImageSource === "upload" && file) formData.append("file", file);
      if (characterImageSource === "project") formData.append("sourceSceneId", selectedCharacterMediaSceneId);
      if (characterImageSource === "maivideo") formData.append("maivideoMediaId", selectedMaiVideoImageId);
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/characters`, { method: "POST", body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể lưu hồ sơ nhân vật.");
      setCharacterName("");
      setCharacterDescription("");
      setSelectedCharacterMediaSceneId("");
      setSelectedMaiVideoImageId("");
      setCharacterImageSource("upload");
      if (characterImageInputRef.current) characterImageInputRef.current.value = "";
      await refresh();
      setRunMessage({ tone: "success", text: `Đã lưu ảnh nhận diện cho ${String((payload.character as ProjectCharacter)?.name || "nhân vật")}.` });
    } catch (cause) {
      setCharacterError(cause instanceof Error ? cause.message : "Không thể lưu hồ sơ nhân vật.");
    } finally {
      setCharacterSaving(false);
    }
  }

  async function syncScriptCharacters() {
    if (!project?.slug || characterSyncing || characterSaving) return;
    setCharacterSyncing(true);
    setCharacterError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/characters/sync`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể đồng bộ Character Bible từ kịch bản.");
      await refresh();
      await loadScenes();
      const created = Number(payload.created) || 0;
      const createdLocations = Number(payload.createdLocations) || 0;
      setRunMessage({ tone: "success", text: created || createdLocations ? `Đã đồng bộ ${created} nhân vật và ${createdLocations} bối cảnh từ kịch bản. Gán voice, prompt và ảnh tham chiếu trong các tab hồ sơ.` : "Hồ sơ nhân vật và bối cảnh đã khớp với kịch bản." });
    } catch (cause) {
      setCharacterError(cause instanceof Error ? cause.message : "Không thể đồng bộ Character Bible từ kịch bản.");
    } finally {
      setCharacterSyncing(false);
    }
  }

  async function saveCharacterVoice(character: ProjectCharacter, voiceId: string) {
    if (!project?.slug || characterVoiceSavingId) return;
    const voice = voiceCatalog?.voices.find((item) => item.id === voiceId);
    if (voiceId && !voice) return;
    setCharacterVoiceSavingId(character.id);
    setCharacterError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/characters`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId: character.id,
          voiceId,
          voiceName: voice?.name || "",
          voiceLanguage: voice?.language || "",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể lưu voice cho nhân vật.");
      await refresh();
      await loadScenes();
      setRunMessage({ tone: "success", text: voice ? `Đã gán ${voice.name} cho ${character.name}.` : `Đã gỡ voice riêng của ${character.name}.` });
    } catch (cause) {
      setCharacterError(cause instanceof Error ? cause.message : "Không thể lưu voice cho nhân vật.");
    } finally {
      setCharacterVoiceSavingId("");
    }
  }

  async function saveSceneReferences(characterIds: string[], locationId = sceneLocationId(selectedScene)) {
    if (!project?.slug || !selectedScene || sceneCharacterSaving) return;
    setSceneCharacterSaving(true);
    setSceneError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(selectedScene.id)}/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterIds, locationId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể lưu ảnh tham chiếu cho cảnh.");
      const updatedScene = payload.scene as ScenePreview;
      setScenes((current) => current.map((item) => item.id === updatedScene.id ? { ...item, ...updatedScene } : item));
      invalidateSceneVideoPromptPreview(updatedScene.id);
      setRunMessage({ tone: "success", text: `Đã lưu ảnh tham chiếu cho ${sceneNumberLabel(selectedScene)}.` });
      await refresh();
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Không thể lưu ảnh tham chiếu cho cảnh.");
    } finally {
      setSceneCharacterSaving(false);
    }
  }

  async function saveSceneSpeaker(scene: ScenePreview, speakerCharacterId: string) {
    if (!project?.slug || sceneCharacterSaving) return;
    setSceneCharacterSaving(true);
    setSceneError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(scene.id)}/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterIds: sceneCharacterIds(scene),
          locationId: sceneLocationId(scene),
          speakerCharacterId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể lưu nhân vật thoại cho cảnh.");
      const updatedScene = payload.scene as ScenePreview;
      setScenes((current) => current.map((item) => item.id === updatedScene.id ? { ...item, ...updatedScene } : item));
      invalidateSceneVideoPromptPreview(updatedScene.id);
      await refresh();
      const speaker = project.characters?.find((character) => character.id === speakerCharacterId);
      setRunMessage({ tone: "success", text: speaker ? `${sceneNumberLabel(scene)} dùng voice của ${speaker.name}.` : `Đã gỡ nhân vật thoại khỏi ${sceneNumberLabel(scene)}.` });
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Không thể lưu nhân vật thoại cho cảnh.");
    } finally {
      setSceneCharacterSaving(false);
    }
  }

  async function saveDramaSceneReferences(scene: ScenePreview, characterIds: string[], locationId: string, referenceKind: SceneReferenceKind) {
    if (!project || sceneCharacterSaving) return;
    setSceneCharacterSaving(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(scene.id)}/characters`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterIds, locationId, referenceKind }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không lưu được ảnh tham chiếu.");
      const updatedScene = payload.scene as ScenePreview;
      setScenes((current) => current.map((item) => item.id === updatedScene.id ? { ...item, ...updatedScene } : item));
      invalidateSceneVideoPromptPreview(updatedScene.id);
      await refresh();
    } catch (cause) { setSceneError(cause instanceof Error ? cause.message : "Không lưu được ảnh tham chiếu."); }
    finally { setSceneCharacterSaving(false); }
  }

  function updateDialogueDraft(sceneId: string, update: (segments: DialogueSegment[]) => DialogueSegment[]) {
    const target = scenes.find((scene) => scene.id === sceneId);
    if (!target) return;
    const current = sceneDialogueSegments(target, project?.characters || []);
    const next = update(current);
    setScenes((items) => items.map((scene) => scene.id === sceneId ? { ...scene, dialogueSegments: next } : scene));
    dialogueDirtySceneIdsRef.current.add(sceneId);
    invalidateSceneVideoPromptPreview(sceneId);
  }

  function addDialogueSegment(scene: ScenePreview) {
    const current = sceneDialogueSegments(scene, characterProfiles);
    const last = current[current.length - 1];
    const suggestedStart = last
      ? last.endMs ?? (last.startMs + Number(last.audio?.durationMs || estimateDialogueDurationMs(last.text)))
      : 0;
    const startMs = Math.min(14_000, Math.max(0, suggestedStart));
    const next: DialogueSegment = {
      id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: "",
      startMs,
      endMs: Math.min(15_000, startMs + 2_000),
    };
    updateDialogueDraft(scene.id, (segments) => [...segments, next]);
  }

  async function saveDialogueSegments(scene: ScenePreview, refreshProject = true) {
    if (!project?.slug || dialogueSavingSceneId) return undefined;
    const segments = sceneDialogueSegments(scene, characterProfiles);
    setDialogueSavingSceneId(scene.id);
    setSceneError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(scene.id)}/dialogue`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dialogueSegments: segments }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể lưu timeline lời thoại.");
      const updatedScene = payload.scene as ScenePreview;
      setScenes((items) => items.map((item) => item.id === updatedScene.id ? { ...item, ...updatedScene } : item));
      dialogueDirtySceneIdsRef.current.delete(scene.id);
      if (refreshProject) await refresh();
      return { scene: updatedScene, segments: sceneDialogueSegments(updatedScene, characterProfiles) };
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Không thể lưu timeline lời thoại.");
      return undefined;
    } finally {
      setDialogueSavingSceneId("");
    }
  }

  async function requestSceneDialogueTranslation(scene: ScenePreview, targetLanguage: string, missingOnly = false) {
    const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(scene.id)}/translate-dialogue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetLanguage, missingOnly }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || `Không dịch được ${sceneNumberLabel(scene)}.`);
    const updatedScene = payload.scene as ScenePreview;
    setScenes((current) => current.map((item) => item.id === updatedScene.id ? { ...item, ...updatedScene } : item));
    return updatedScene;
  }

  async function translateSceneDialogue(scene: ScenePreview) {
    if (!project?.slug || dialogueTranslationSceneId || dialogueTranslationBatchProgress || dialogueTtsBatchProgress || ttsRunning || renderRunning || dialogueSavingSceneId || isRunning || runningScriptChunkId || generatingSceneId || batchMediaBusy || videoQueueRunning) return;
    setDialogueTranslationSceneId(scene.id);
    setSceneError("");
    setRunMessage(null);
    try {
      const saved = await saveDialogueSegments(scene, false);
      if (!saved) throw new Error("Không thể lưu timeline lời thoại trước khi dịch.");
      await requestSceneDialogueTranslation(scene, dialogueTranslationLanguage);
      setRunMessage({ tone: "success", text: `${sceneNumberLabel(scene)} đã dịch thoại sang ${voiceLanguageLabel(dialogueTranslationLanguage)}.` });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Không dịch được lời thoại cảnh này.";
      setSceneError(message);
      setRunMessage({ tone: "error", text: message });
    } finally {
      setDialogueTranslationSceneId("");
    }
  }

  async function translateAllMissingDialogue() {
    if (!project?.slug || dialogueTranslationSceneId || dialogueTranslationBatchProgress || dialogueTtsBatchProgress || ttsRunning || renderRunning || dialogueSavingSceneId || isRunning || runningScriptChunkId || generatingSceneId || batchMediaBusy || videoQueueRunning) return;
    const targets = filteredScenes.filter((scene) => {
      const segments = sceneDialogueSegments(scene, project.characters || []);
      return segments.length > 0 && segments.some((segment) => !segment.translations?.[dialogueTranslationLanguage]?.trim());
    });
    if (!targets.length) return;
    setDialogueTranslationBatchProgress(`0/${targets.length}`);
    setSceneError("");
    setRunMessage(null);
    let completed = 0;
    const failures: string[] = [];
    try {
      for (const scene of targets) {
        try {
          const saved = await saveDialogueSegments(scene, false);
          if (!saved) throw new Error("Không thể lưu timeline thoại.");
          await requestSceneDialogueTranslation(scene, dialogueTranslationLanguage, true);
          completed += 1;
        } catch (cause) {
          failures.push(`${sceneNumberLabel(scene)}: ${cause instanceof Error ? cause.message : "lỗi dịch"}`);
        }
        setDialogueTranslationBatchProgress(`${completed}/${targets.length}`);
      }
      const message = failures.length
        ? `Đã dịch ${completed}/${targets.length} cảnh; ${failures.length} cảnh lỗi. ${failures.slice(0, 2).join(" · ")}`
        : `Đã dịch lời thoại ${completed} cảnh sang ${voiceLanguageLabel(dialogueTranslationLanguage)}.`;
      setRunMessage({ tone: failures.length ? "error" : "success", text: message });
      if (failures.length) setSceneError(failures.slice(0, 3).join("\n"));
    } finally {
      setDialogueTranslationBatchProgress("");
    }
  }

  function updateScenePromptDraft(scene: ScenePreview, field: "imagePrompt" | "videoPrompt", value: string) {
    if (field === "videoPrompt") invalidateSceneVideoPromptPreview(scene.id);
    setScenePromptDrafts((current) => {
      const existing = current[scene.id] || {
        imagePrompt: sceneFieldValue(scene, "image_prompt", "imagePrompt"),
        videoPrompt: sceneFieldValue(scene, "video_prompt", "videoPrompt"),
      };
      return { ...current, [scene.id]: { ...existing, [field]: value } };
    });
  }

  async function saveScenePrompts(scene: ScenePreview) {
    if (!project?.slug || scenePromptSavingId || renderRunning || videoQueueRunning || generatingSceneId) return;
    const prompts = scenePromptDrafts[scene.id] || {
      imagePrompt: sceneFieldValue(scene, "image_prompt", "imagePrompt"),
      videoPrompt: sceneFieldValue(scene, "video_prompt", "videoPrompt"),
    };
    if (!prompts.imagePrompt.trim() || !prompts.videoPrompt.trim()) {
      setSceneError("Hãy giữ cả prompt tạo ảnh và prompt tạo video cho cảnh.");
      return;
    }
    setScenePromptSavingId(scene.id);
    setSceneError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(scene.id)}/prompts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prompts),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể lưu prompt cho cảnh.");
      const updatedScene = payload.scene as ScenePreview;
      setScenes((items) => items.map((item) => item.id === updatedScene.id ? { ...item, ...updatedScene } : item));
      invalidateSceneVideoPromptPreview(updatedScene.id);
      setScenePromptDrafts((current) => ({ ...current, [scene.id]: { imagePrompt: prompts.imagePrompt.trim(), videoPrompt: prompts.videoPrompt.trim() } }));
      await refresh();
      setRunMessage({ tone: "success", text: `Đã lưu prompt ảnh và video cho ${sceneNumberLabel(scene)}. Media cũ được đánh dấu cần tạo lại.` });
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Không thể lưu prompt cho cảnh.");
    } finally {
      setScenePromptSavingId("");
    }
  }

  async function requestDialogueExtraction(scene: ScenePreview) {
    if (!project?.slug) throw new Error("Không tìm thấy project hiện tại.");
    const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(scene.id)}/dialogue`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || `Không thể hoàn thiện thoại cho ${sceneNumberLabel(scene)}.`);
    const updatedScene = payload.scene as ScenePreview;
    setScenes((current) => current.map((item) => item.id === updatedScene.id ? { ...item, ...updatedScene } : item));
    return { scene: updatedScene, model: String(payload.model || "Script LLM") };
  }

  async function extractSceneDialogue(scene: ScenePreview) {
    if (dialogueExtractingSceneId || dialogueExtractBatchProgress || ttsRunning || renderRunning || isRunning || runningScriptChunkId) return;
    setDialogueExtractingSceneId(scene.id);
    setSceneError("");
    try {
      const result = await requestDialogueExtraction(scene);
      await refresh();
      setRunMessage({ tone: "success", text: `Đã tạo timeline và bổ sung chi tiết cho ${sceneNumberLabel(scene)} · ${sceneDialogueSegments(result.scene, characterProfiles).length} lượt thoại · ${result.model}.` });
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Không thể hoàn thiện thoại cho cảnh.");
    } finally {
      setDialogueExtractingSceneId("");
    }
  }

  async function extractFilteredSceneDialogues() {
    const targets = filteredScenes.filter(sceneNeedsDialogueExtraction);
    if (!targets.length || dialogueExtractingSceneId || dialogueExtractBatchProgress || ttsRunning || renderRunning || isRunning || runningScriptChunkId) return;
    setSceneError("");
    let completed = 0;
    const failures: string[] = [];
    for (const [index, scene] of targets.entries()) {
      setDialogueExtractingSceneId(scene.id);
      setDialogueExtractBatchProgress(`${index + 1}/${targets.length} · ${sceneNumberLabel(scene)}`);
      try {
        await requestDialogueExtraction(scene);
        completed += 1;
      } catch (cause) {
        failures.push(`${sceneNumberLabel(scene)}: ${cause instanceof Error ? cause.message : "lỗi không xác định"}`);
      }
    }
    setDialogueExtractingSceneId("");
    setDialogueExtractBatchProgress("");
    await refresh();
    setRunMessage({
      tone: failures.length ? "error" : "success",
      text: failures.length
        ? `Đã hoàn thiện ${completed}/${targets.length} cảnh. ${failures.slice(0, 2).join(" · ")}${failures.length > 2 ? ` · và ${failures.length - 2} lỗi khác` : ""}`
        : `Đã tạo timeline thoại và bổ sung chi tiết cho ${completed} cảnh. Kiểm tra lại người nói và timecode trước khi tạo TTS.`,
    });
    if (failures.length) setSceneError(failures[0]);
  }

  function importDialogueSrt(scene: ScenePreview) {
    const draft = dialogueSrtDrafts[scene.id] || "";
    const segments = parseDialogueSrt(draft, characterProfiles);
    if (!segments.length) {
      setSceneError("Không tìm thấy cue SRT hợp lệ trong khoảng 0–15 giây. Mỗi cue cần timecode và lời thoại; có thể ghi [Tên nhân vật] trước câu.");
      return;
    }
    updateDialogueDraft(scene.id, () => segments);
    setDialogueSrtDrafts((current) => ({ ...current, [scene.id]: "" }));
    setSceneError("");
  }

  async function createLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = locationImageInputRef.current?.files?.[0];
    const sourceId = locationImageSource === "upload" ? Boolean(file) : locationImageSource === "project" ? Boolean(selectedLocationMediaSceneId) : Boolean(selectedLocationMaiVideoImageId);
    if (!project?.slug || !locationName.trim() || !sourceId) {
      setLocationError("Nhập tên bối cảnh và chọn ảnh tham chiếu 4 góc.");
      return;
    }
    setLocationSaving(true);
    setLocationError("");
    try {
      const formData = new FormData();
      formData.append("name", locationName.trim());
      formData.append("aliases", locationAliases);
      formData.append("description", locationDescription.trim());
      if (locationImageSource === "upload" && file) formData.append("file", file);
      if (locationImageSource === "project") formData.append("sourceSceneId", selectedLocationMediaSceneId);
      if (locationImageSource === "maivideo") formData.append("maivideoMediaId", selectedLocationMaiVideoImageId);
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/locations`, { method: "POST", body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể lưu hồ sơ bối cảnh.");
      setLocationName("");
      setLocationAliases("");
      setLocationDescription("");
      setSelectedLocationMediaSceneId("");
      setSelectedLocationMaiVideoImageId("");
      setLocationImageSource("upload");
      if (locationImageInputRef.current) locationImageInputRef.current.value = "";
      await refresh();
      setRunMessage({ tone: "success", text: `Đã lưu ảnh tham chiếu bối cảnh ${String((payload.location as ProjectLocation)?.name || "")}.` });
    } catch (cause) {
      setLocationError(cause instanceof Error ? cause.message : "Không thể lưu hồ sơ bối cảnh.");
    } finally {
      setLocationSaving(false);
    }
  }

  async function autoAssignSceneReferences() {
    if (!project?.slug || !filteredScenes.length || autoAssignCharactersBusy || batchMediaBusy || videoQueueRunning || sceneCharacterSaving) return;
    setAutoAssignCharactersBusy(true);
    setSceneError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/auto-assign-characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneIds: filteredScenes.map((scene) => scene.id), forceImageReferences: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể tự gán hồ sơ cho cảnh.");
      await loadScenes();
      const changedScenes = Number(payload.changedScenes) || 0;
      const changedReferenceScenes = Number(payload.changedReferenceScenes) || changedScenes;
      const addedAssignments = Number(payload.addedAssignments) || 0;
      const addedLocationAssignments = Number(payload.addedLocationAssignments) || 0;
      const unmatchedScenes = Number(payload.unmatchedScenes) || 0;
      const unmatchedLocationScenes = Number(payload.unmatchedLocationScenes) || 0;
      const unmatchedLocationNote = unmatchedLocationScenes ? ` · ${unmatchedLocationScenes} cảnh chưa khớp hồ sơ bối cảnh` : "";
      setRunMessage({
        tone: "success",
        text: changedReferenceScenes
          ? `Đã tự gán ${addedAssignments} nhân vật và ${addedLocationAssignments} bối cảnh vào ${changedReferenceScenes} cảnh${unmatchedScenes ? ` · ${unmatchedScenes} cảnh chưa khớp hồ sơ` : ""}${unmatchedLocationNote}.`
          : `Không có hồ sơ mới để gán${unmatchedScenes ? ` · ${unmatchedScenes} cảnh chưa khớp hồ sơ` : ""}${unmatchedLocationNote}.`,
      });
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Không thể tự gán hồ sơ cho cảnh.");
    } finally {
      setAutoAssignCharactersBusy(false);
    }
  }

  async function autoAssignGeneratedSceneReferences(output: unknown, forceImageReferences = false) {
    if (!project?.slug || !output || typeof output !== "object" || Array.isArray(output)) return undefined;
    const outputRecord = output as Record<string, unknown>;
    const sceneIds = [...new Set((Array.isArray(outputRecord.scenes) ? outputRecord.scenes : [])
      .flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const record = value as Record<string, unknown>;
        const id = String(record.id || record.scene_id || "").trim();
        return id ? [id] : [];
      }))];
    if (!sceneIds.length) return undefined;
    const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/auto-assign-characters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sceneIds, forceImageReferences }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể tự gán hồ sơ cho cảnh vừa tạo.");
    return payload as { changedReferenceScenes?: number; addedAssignments?: number; addedLocationAssignments?: number; unmatchedScenes?: number; unmatchedLocationScenes?: number };
  }

  const loadScenes = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!project?.slug) return;
    if (scenesLoadInFlightRef.current) return;
    scenesLoadInFlightRef.current = true;
    if (!silent) {
      setScenesLoading(true);
      setSceneError("");
    }
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Không thể tải danh sách cảnh.");
      const nextScenes = Array.isArray(payload.scenes) ? payload.scenes as ScenePreview[] : [];
      setScenes((current) => silent ? mergePolledSceneMedia(current, nextScenes) : nextScenes);
      setSelectedSceneId((current) => current && nextScenes.some((scene) => scene.id === current) ? current : nextScenes[0]?.id || "");
    } catch (cause) {
      if (!silent) setSceneError(cause instanceof Error ? cause.message : "Không thể tải danh sách cảnh.");
    } finally {
      scenesLoadInFlightRef.current = false;
      if (!silent) setScenesLoading(false);
    }
  }, [project?.slug]);

  useEffect(() => {
    void loadScenes();
  }, [loadScenes, project?.completedChunks]);

  useEffect(() => {
    // Keep refreshing persisted job status while this page is in a background tab.
    // The server-side queue runs independently; this poll keeps the UI in sync.
    const poll = () => { void loadScenes({ silent: true }); };
    const timer = window.setInterval(poll, 15_000);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("focus", poll);
    window.addEventListener("pageshow", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("focus", poll);
      window.removeEventListener("pageshow", poll);
    };
  }, [loadScenes]);

  useEffect(() => {
    let active = true;
    fetch("/api/media-models", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "Không tải được danh sách model media.");
        return payload as MediaModelCatalog;
      })
      .then((catalog) => {
        if (!active) return;
        setMediaCatalog(catalog);
        setMediaCatalogError("");
      })
      .catch((cause) => {
        if (!active) return;
        setMediaCatalogError(cause instanceof Error ? cause.message : "Không tải được danh sách model media.");
      });
    return () => { active = false; };
  }, [project?.slug]);

  useEffect(() => {
    let active = true;
    setVoiceCatalogLoading(true);
    fetch("/api/omnivoice/voices", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "Không tải được danh sách voice.");
        if (active) setVoiceCatalog(payload as OmniVoiceCatalog);
      })
      .catch(() => { if (active) setVoiceCatalog(null); })
      .finally(() => { if (active) setVoiceCatalogLoading(false); });
    return () => { active = false; };
  }, [project?.slug]);

  const sceneChunks = useMemo(() => Array.from(new Set(scenes.map((scene) => scene.chunkId))).sort(), [scenes]);
  const sceneStats = useMemo(() => scenes.reduce((summary, scene) => {
    const review = sceneReviewStatus(scene);
    const aiReview = sceneAiReview(scene);
    summary[review] += 1;
    summary[`ai_${aiReview.status}`] += 1;
    if (sceneMediaReady(scene.media, project?.presetId === "ai-drama")) summary.ready += 1;
    else summary.missing += 1;
    if (sceneMediaReady(scene.media) && scene.media?.kind === "video" && scene.media.provider?.startsWith("maivideo")) summary.ai += 1;
    return summary;
  }, { unreviewed: 0, approved: 0, needs_changes: 0, ai_pending: 0, ai_passed: 0, ai_needs_changes: 0, ai_error: 0, ready: 0, missing: 0, ai: 0 }), [project?.presetId, scenes]);

  const filteredScenes = useMemo(() => {
    const search = sceneSearch.trim().toLowerCase();
    return scenes.filter((scene) => {
      if (sceneChunkFilter !== "all" && scene.chunkId !== sceneChunkFilter) return false;
      if (sceneReviewFilter !== "all" && sceneReviewStatus(scene) !== sceneReviewFilter) return false;
      if (!sceneMatchesAiReviewFilter(scene, sceneAiReviewFilter)) return false;
      if (!sceneMatchesMediaFilter(scene, sceneMediaFilter, project?.presetId === "ai-drama")) return false;
      if (!search) return true;
      const searchable = [
        scene.id,
        scene.chunkId,
        sceneText(scene, "purpose", "beat_summary"),
        sceneText(scene, "dialogue_or_voiceover", "voiceText", "voiceover"),
        sceneText(scene, "video_prompt", "videoPrompt", "image_prompt", "imagePrompt"),
        scene.media?.provider || "",
      ].join(" ").toLowerCase();
      return searchable.includes(search);
    });
  }, [project?.presetId, sceneAiReviewFilter, sceneChunkFilter, sceneMediaFilter, sceneReviewFilter, sceneSearch, scenes]);

  useEffect(() => {
    setSelectedSceneId((current) => current && filteredScenes.some((scene) => scene.id === current) ? current : filteredScenes[0]?.id || "");
  }, [filteredScenes]);

  useEffect(() => {
    const currentScene = scenes.find((scene) => scene.id === selectedSceneId);
    setSceneReviewNote(currentScene ? sceneText(currentScene, "reviewNote", "review_note") : "");
  }, [scenes, selectedSceneId]);

  const preset = project ? STORY_PRESETS[project.presetId] : STORY_PRESETS["ai-story"];
  const progress = project ? projectProgress(project) : 0;

  const chunks = useMemo(() => {
    if (!project) return [];
    return project.chunks.map((storedChunk, index) => {
      const isDone = storedChunk.status === "completed";
      const isRunningChunk = storedChunk.status === "processing";
      const isFailed = storedChunk.status === "failed" || storedChunk.status === "needs_review";
      const completedInChunk = storedChunk.generatedScenes;
      return {
        id: storedChunk.id,
        episodeNumber: index + 1,
        range: `S${String(storedChunk.sceneStart).padStart(3, "0")}–S${String(storedChunk.sceneEnd).padStart(3, "0")}`,
        scenes: `${completedInChunk}/${storedChunk.sceneEnd - storedChunk.sceneStart + 1}`,
        status: isDone ? "done" : isRunningChunk ? "running" : isFailed ? "review" : "queued",
        label: isDone ? "Hoàn tất" : isRunningChunk ? "Đang tạo" : isFailed ? "Cần xử lý" : "Đang chờ",
        tone: isDone ? "green" : isRunningChunk ? "orange" : isFailed ? "red" : "gray",
        time: isDone ? "Đã lưu" : isRunningChunk ? "Đang chạy" : isFailed ? (storedChunk.error || "Có lỗi") : "Xếp hàng",
        render: storedChunk.render,
        tts: storedChunk.tts,
        hasScript: Boolean(storedChunk.outputPath),
        canRunScript: storedChunk.status === "queued" || storedChunk.status === "failed",
      };
    });
  }, [project]);

  const visibleChunks = chunks.filter((chunk) => activeFilter === "Tất cả" || (activeFilter === "Đang xử lý" && chunk.status === "running") || (activeFilter === "Cần review" && chunk.status === "review"));
  const pendingEpisodeRenders = project?.chunks.filter((chunk) => Boolean(chunk.outputPath) && chunk.render?.status !== "running" && (chunk.render?.stale === true || chunk.render?.status !== "completed")) || [];
  const pendingEpisodeTts = project?.chunks.filter((chunk) => Boolean(chunk.outputPath) && chunk.tts?.status !== "completed" && chunk.tts?.status !== "not_needed") || [];
  const scriptGenerationBusy = isRunning || Boolean(runningScriptChunkId);
  const scriptBlocksIndependentTasks = project?.presetId !== "ai-drama" && scriptGenerationBusy;
  const episodeExtensionBusy = isRunning || Boolean(runningScriptChunkId) || renderRunning || ttsRunning || videoQueueRunning || Boolean(generatingSceneId) || project?.render?.status === "running" || project?.videoQueue?.status === "running" || Boolean(project?.chunks.some((chunk) => chunk.status === "processing" || chunk.render?.status === "running" || chunk.tts?.status === "running"));
  const scriptActionBusy = () => {
    const sharedTaskBusy = isRunning || Boolean(runningScriptChunkId) || renderRunning || ttsRunning;
    if (project?.presetId === "ai-drama") return sharedTaskBusy;
    return sharedTaskBusy || batchMediaBusy || videoQueueRunning || Boolean(generatingSceneId) || Boolean(profileBusyId) || profileBatchKinds.size > 0;
  };

  async function saveSource() {
    if (!project) return;
    setRunMessage(null);
    try {
      const saved = await updateProject(project.slug, { sourceUrl, sourceText });
      if (sourceUrl.trim() && !saved?.sourceText?.trim()) {
        const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/ingest-source`, { method: "POST" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "Không lấy được transcript từ URL.");
        await refresh();
        setRunMessage({ tone: "success", text: "Đã lưu link và tự lấy transcript từ MaiVideo." });
      } else {
        setRunMessage({ tone: "success", text: "Đã lưu URL và transcript/brief vào dự án." });
      }
    } catch (error) {
      setRunMessage({ tone: "error", text: error instanceof Error ? error.message : "Không thể lưu nguồn." });
    }
  }

  async function generateAudioStoryChunkTts(chunkId: string): Promise<{ note: string; failed: boolean }> {
    if (!project?.slug || project.presetId === "ai-drama") return { note: "", failed: false };
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/chunks/${encodeURIComponent(chunkId)}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: false }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không tạo được audio TTS.");
      if (payload.status === "not_needed") return { note: " · không có lời đọc cần TTS", failed: false };
      const failureCount = Number(payload.failed) || 0;
      return {
        note: ` · TTS ${Number(payload.completed) || 0}/${Number(payload.total) || 0}${failureCount ? ` · ${failureCount} lỗi` : ""}`,
        failed: payload.status !== "completed",
      };
    } catch (cause) {
      return {
        note: ` · TTS chưa hoàn tất: ${cause instanceof Error ? cause.message : "lỗi không xác định"}`,
        failed: true,
      };
    }
  }

  async function runNextChunk() {
    if (!project || scriptActionBusy()) return;
    setIsRunning(true);
    setRunMessage(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/run-chunk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "Không thể chạy chunk.");
      const audioTts = result.chunk?.id ? await generateAudioStoryChunkTts(result.chunk.id) : { note: "", failed: false };
      let referenceAssignment: Awaited<ReturnType<typeof autoAssignGeneratedSceneReferences>> = undefined;
      let referenceAssignmentFailed = false;
      if (project.presetId === "ai-drama") {
        try {
          referenceAssignment = await autoAssignGeneratedSceneReferences(result.output, true);
        } catch {
          referenceAssignmentFailed = true;
        }
      }
      await refresh();
      await loadScenes();
      const mediaSummary = result.output?.media_summary && typeof result.output.media_summary === "object" ? result.output.media_summary : {};
      const mediaStatus = project.presetId === "ai-drama"
        ? "Kịch bản và prompt đã sẵn sàng để duyệt; ảnh cảnh, video và TTS dùng nút riêng."
        : `Media ${Number(mediaSummary.ready) || 0}/${Number(mediaSummary.requested) || 0} cảnh${audioTts.note}.`;
      const referenceStatus = referenceAssignment?.changedReferenceScenes
        ? ` Đã tự gán ${Number(referenceAssignment.addedAssignments) || 0} nhân vật và ${Number(referenceAssignment.addedLocationAssignments) || 0} bối cảnh vào ${referenceAssignment.changedReferenceScenes} cảnh.`
        : referenceAssignmentFailed ? " Chưa tự gán được hồ sơ cho các cảnh vừa tạo." : "";
      const createCharacterImages = project.presetId === "ai-drama" && characterProfilesMissingImage.length > 0;
      setRunMessage({ tone: audioTts.failed || Number(mediaSummary.failed) > 0 || referenceAssignmentFailed ? "error" : "success", text: `Đã lưu ${result.chunk?.generatedScenes || 0} cảnh vào ${result.chunk?.outputPath || "data/outputs"}. ${mediaStatus}${referenceStatus}${createCharacterImages ? " Đang tự tạo ảnh tham chiếu cho hồ sơ nhân vật còn thiếu." : ""}` });
      if (createCharacterImages) void generateDramaProfileImages("characters");
    } catch (error) {
      setRunMessage({ tone: "error", text: error instanceof Error ? error.message : "Tác vụ thất bại." });
    } finally {
      setIsRunning(false);
    }
  }

  async function appendEpisodes() {
    if (!project?.slug || extendingEpisodes || project.scriptMode === "manual") return;
    setExtendingEpisodes(true);
    setRunMessage(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/episodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeCount: extendEpisodeCount }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể thêm tập mới.");
      const firstEpisode = project.chunks.length + 1;
      const lastEpisode = firstEpisode + extendEpisodeCount - 1;
      await refresh();
      await loadScenes();
      setShowExtendEpisodes(false);
      setRunMessage({ tone: "success", text: `Đã thêm Tập ${String(firstEpisode).padStart(2, "0")}–${String(lastEpisode).padStart(2, "0")}. Bấm “Tạo kịch bản tập tiếp” để tiếp tục.` });
    } catch (error) {
      setRunMessage({ tone: "error", text: error instanceof Error ? error.message : "Không thể thêm tập mới." });
    } finally {
      setExtendingEpisodes(false);
    }
  }

  function episodeScriptTemplate(chunkId: string) {
    const target = project.chunks.find((chunk) => chunk.id === chunkId);
    if (!target) return "";
    const savedScenes = new Map(scenes.map((scene) => [scene.id, scene]));
    let timelineStartSec = 0;
    for (let sceneNumber = 1; sceneNumber < target.sceneStart; sceneNumber += 1) {
      const saved = savedScenes.get(`S${String(sceneNumber).padStart(3, "0")}`);
      const declaredDuration = Number(saved?.duration_sec ?? saved?.durationSec);
      const start = Number(saved?.start_sec ?? saved?.startSec);
      const end = Number(saved?.end_sec ?? saved?.endSec);
      const duration = Number.isFinite(declaredDuration) && declaredDuration > 0
        ? declaredDuration
        : Number.isFinite(end - start) && end > start ? end - start : Number(project.sceneDurationSec || 15);
      timelineStartSec += duration;
    }
    return createEpisodeScriptTemplate(target.id, target.sceneStart, target.sceneEnd, timelineStartSec);
  }

  async function importEpisodeBundle(bundle: unknown, preserveProjectStructure = false) {
    if (!project?.slug || importingScripts) return false;
    setImportingScripts(true);
    setRunMessage(null);
    try {
      const submitImport = async (replace: boolean) => {
        const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/import-scripts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bundle, replace, preserveProjectStructure }),
        });
        const payload = await response.json().catch(() => ({}));
        return { response, payload };
      };

      let { response, payload } = await submitImport(false);
      if (response.status === 409 && payload.code === "CHUNK_OUTPUT_EXISTS") {
        const conflictingChunks = Array.isArray(payload.conflictingChunks) ? payload.conflictingChunks.join(", ") : "các tập đã có kịch bản";
        const confirmed = window.confirm(`Các tập ${conflictingChunks} đã có kịch bản. Bạn muốn ghi đè nội dung các tập đó?`);
        if (!confirmed) {
          setRunMessage({ tone: "error", text: "Đã hủy nhập JSON; các tập hiện tại được giữ nguyên." });
          return false;
        }
        ({ response, payload } = await submitImport(true));
      }
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể nhập kịch bản JSON.");

      await refresh();
      await loadScenes();
      const imported = Array.isArray(payload.imported) ? payload.imported : [];
      if (imported[0]?.chunkId) setViewingScriptChunkId(String(imported[0].chunkId));
      const sceneCount = imported.reduce((total: number, episode: { sceneCount?: number }) => total + (Number(episode.sceneCount) || 0), 0);
      const replaced = Array.isArray(payload.replaced) && payload.replaced.length ? ` · ghi đè ${payload.replaced.join(", ")}` : "";
      const publishingImported = payload.publishingImported && typeof payload.publishingImported === "object" ? payload.publishingImported as { series?: boolean; episodes?: unknown[] } : undefined;
      const publishingEpisodeCount = Array.isArray(publishingImported?.episodes) ? publishingImported.episodes.length : 0;
      const publishingSummary = publishingImported
        ? publishingImported.series || publishingEpisodeCount
          ? ` · title/thumbnail: ${[
            publishingImported.series ? "toàn series" : "",
            publishingEpisodeCount ? `${publishingEpisodeCount} tập` : "",
          ].filter(Boolean).join(" + ")}`
          : " · JSON không có gói title/thumbnail"
        : "";
      setRunMessage({ tone: "success", text: `Đã nhập ${imported.length} tập · ${sceneCount} cảnh từ JSON${publishingSummary}${replaced}.` });
      return true;
    } catch (cause) {
      setRunMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Không thể nhập kịch bản JSON." });
      return false;
    } finally {
      setImportingScripts(false);
    }
  }

  function openEpisodeScriptEditor() {
    if (!project?.chunks.length) return;
    const target = project.chunks.find((chunk) => !chunk.outputPath) || project.chunks[0];
    const draft = episodeScriptDrafts[target.id] || episodeScriptTemplate(target.id);
    setRunMessage(null);
    setEpisodeScriptChunkId(target.id);
    setEpisodeScriptDraft(draft);
    setEpisodeScriptDrafts((current) => ({ ...current, [target.id]: draft }));
    setEpisodeScriptEditorOpen(true);
  }

  function selectEpisodeScriptChunk(chunkId: string) {
    const target = project?.chunks.find((chunk) => chunk.id === chunkId);
    if (!target) return;
    const draft = episodeScriptDrafts[chunkId] || episodeScriptTemplate(target.id);
    setEpisodeScriptChunkId(chunkId);
    setEpisodeScriptDraft(draft);
    setEpisodeScriptDrafts((current) => ({ ...current, [chunkId]: draft }));
  }

  function updateEpisodeScriptDraft(value: string) {
    setEpisodeScriptDraft(value);
    if (episodeScriptChunkId) setEpisodeScriptDrafts((current) => ({ ...current, [episodeScriptChunkId]: value }));
  }

  async function importEpisodeScriptDraft() {
    try {
      const bundle = JSON.parse(episodeScriptDraft) as Record<string, unknown>;
      if (bundle.schema !== "scene-script.v1") throw new Error("Mẫu nhập từng tập cần schema scene-script.v1; hãy nhập đúng một tập mỗi lần.");
      const chunkId = String(bundle.chunk_id || "").trim().toUpperCase();
      if (chunkId !== episodeScriptChunkId) throw new Error(`Bạn đang chọn ${episodeScriptChunkId}, nhưng JSON có chunk_id ${chunkId || "trống"}. Hãy chọn đúng tập hoặc sửa chunk_id trong JSON.`);
      if (/\[[^\]]+\]/.test(episodeScriptDraft) && !window.confirm("JSON vẫn còn nội dung mẫu trong dấu [ ]. Bạn muốn nhập tiếp không?")) return;
      await importEpisodeBundle(bundle, true);
    } catch (cause) {
      setRunMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Không thể đọc JSON kịch bản." });
    }
  }

  async function copyEpisodeScriptDraft() {
    if (!episodeScriptDraft.trim()) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Trình duyệt không hỗ trợ clipboard.");
      await navigator.clipboard.writeText(episodeScriptDraft);
      setRunMessage({ tone: "success", text: `Đã sao chép JSON kịch bản ${episodeScriptChunkId}.` });
    } catch {
      setRunMessage({ tone: "error", text: "Không thể sao chép. Hãy kiểm tra quyền clipboard của trình duyệt." });
    }
  }

  async function runScriptChunk(chunkId: string, episodeNumber: number) {
    if (!project?.slug || scriptActionBusy()) return;
    setRunningScriptChunkId(chunkId);
    setRunMessage(null);
    setSceneError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/run-chunk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunkId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || `Không chạy được kịch bản Tập ${episodeNumber}.`);
      const audioTts = payload.chunk?.id ? await generateAudioStoryChunkTts(payload.chunk.id) : { note: "", failed: false };
      let referenceAssignment: Awaited<ReturnType<typeof autoAssignGeneratedSceneReferences>> = undefined;
      let referenceAssignmentFailed = false;
      if (project.presetId === "ai-drama") {
        try {
          referenceAssignment = await autoAssignGeneratedSceneReferences(payload.output, true);
        } catch {
          referenceAssignmentFailed = true;
        }
      }
      await refresh();
      await loadScenes();
      setViewingScriptChunkId(chunkId);
      const mediaSummary = payload.output?.media_summary && typeof payload.output.media_summary === "object" ? payload.output.media_summary : {};
      const mediaStatus = project.presetId === "ai-drama"
        ? "Duyệt prompt rồi dùng nút riêng để tạo ảnh cảnh, video và TTS."
        : `Media ${Number(mediaSummary.ready) || 0}/${Number(mediaSummary.requested) || 0} cảnh${audioTts.note}.`;
      const referenceStatus = referenceAssignment?.changedReferenceScenes
        ? ` Đã tự gán ${Number(referenceAssignment.addedAssignments) || 0} nhân vật và ${Number(referenceAssignment.addedLocationAssignments) || 0} bối cảnh vào ${referenceAssignment.changedReferenceScenes} cảnh.`
        : referenceAssignmentFailed ? " Chưa tự gán được hồ sơ cho các cảnh vừa tạo." : "";
      const createCharacterImages = project.presetId === "ai-drama" && characterProfilesMissingImage.length > 0;
      setRunMessage({ tone: audioTts.failed || Number(mediaSummary.failed) > 0 || referenceAssignmentFailed ? "error" : "success", text: `Đã chạy và lưu kịch bản Tập ${String(episodeNumber).padStart(2, "0")} · ${payload.chunk?.generatedScenes || 0} cảnh. ${mediaStatus}${referenceStatus}${createCharacterImages ? " Đang tự tạo ảnh tham chiếu cho hồ sơ nhân vật còn thiếu." : ""}` });
      if (createCharacterImages) void generateDramaProfileImages("characters");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Không chạy được kịch bản tập.";
      await refresh().catch(() => undefined);
      setSceneError(message);
      setRunMessage({ tone: "error", text: message });
    } finally {
      setRunningScriptChunkId("");
    }
  }

  async function runAiPrecheck() {
    if (!project?.slug || aiReviewRunning) return;
    const chunksNeedingAi = new Set(scenes.filter((scene) => {
      const status = sceneAiReview(scene).status;
      return status === "pending" || status === "error";
    }).map((scene) => scene.chunkId));
    const targets = project.chunks.filter((chunk) => chunk.outputPath && chunksNeedingAi.has(chunk.id));
    if (!targets.length) {
      setRunMessage({ tone: "success", text: "Tất cả cảnh đã có kết quả AI pre-check. Có thể chuyển sang người dùng xác nhận." });
      return;
    }
    setAiReviewRunning(true);
    setSceneError("");
    setRunMessage(null);
    let latestScenes = scenes;
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const chunk = targets[index];
        setAiReviewProgress(`Đang chấm ${chunk.id} · ${index + 1}/${targets.length}`);
        const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/ai-review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chunkId: chunk.id }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.message || `AI pre-check ${chunk.id} thất bại.`);
        const evaluated = Array.isArray(payload.scenes) ? payload.scenes as ScenePreview[] : [];
        const evaluatedById = new Map(evaluated.map((scene) => [scene.id, scene]));
        latestScenes = latestScenes.map((scene) => {
          const evaluatedScene = evaluatedById.get(scene.id);
          return evaluatedScene ? { ...scene, ...evaluatedScene } : scene;
        });
        setScenes(latestScenes);
      }
      await refresh();
      await loadScenes();
      setRunMessage({ tone: "success", text: `AI đã pre-check ${targets.length} chunk. Người dùng có thể bắt đầu duyệt các cảnh.` });
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "AI pre-check thất bại.");
    } finally {
      setAiReviewProgress("");
      setAiReviewRunning(false);
    }
  }

  async function runContinuityQa() {
    if (!project?.slug || continuityRunning) return;
    setContinuityRunning(true);
    setSceneError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/continuity-qa`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Continuity QA thất bại.");
      await refresh();
      setRunMessage({ tone: payload.report?.status === "passed" ? "success" : "error", text: `Continuity QA ${payload.report?.score || 0}/100 · ${payload.report?.issueCount || 0} điểm cần kiểm tra.` });
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Continuity QA thất bại.");
    } finally {
      setContinuityRunning(false);
    }
  }

  async function queueVideoJobs(
    onlyMissing: boolean,
    targetScenes: ScenePreview[] = scenes,
    settings?: MediaGenerationSettings,
    runAfterQueue = false,
    regenerate = false,
  ) {
    if (!project?.slug || !targetScenes.length || scriptBlocksIndependentTasks || ttsRunning || generatingSceneId || videoQueueRunning) return;
    setSceneError("");
    try {
      if (settings) await applyBatchSceneMediaSettings(targetScenes, settings);
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/video-queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onlyMissing: regenerate ? false : onlyMissing, regenerate, sceneIds: targetScenes.map((scene) => scene.id), concurrency: VIDEO_QUEUE_CONCURRENCY }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể xếp hàng video AI.");
      await refresh();
      setRunMessage({ tone: "success", text: `Đã xếp ${payload.added || 0} job video AI${payload.retried ? ` · retry ${payload.retried}` : ""}.${runAfterQueue ? " Bắt đầu chạy queue…" : " Chưa gọi API trong bước này."}` });
      if (runAfterQueue) await runVideoQueue();
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Không thể xếp hàng video AI.");
    }
  }

  async function controlVideoQueue(action: "pause" | "resume" | "retry_failed") {
    if (!project?.slug) return;
    if (action !== "pause" && (scriptBlocksIndependentTasks || ttsRunning || batchMediaBusy || generatingSceneId)) return;
    if (action === "pause") videoQueueStopRef.current = true;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/video-queue/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể cập nhật queue.");
      await refresh();
      setRunMessage({ tone: "success", text: action === "pause" ? "Đã yêu cầu dừng queue sau khi các job đang chạy hoàn tất." : action === "resume" ? "Đã tiếp tục queue video AI." : "Đã đưa các job lỗi về queue để retry." });
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Không thể cập nhật queue.");
    }
  }

  async function runVideoQueue() {
    if (!project?.slug || videoQueueRunning || scriptBlocksIndependentTasks || ttsRunning || generatingSceneId) return;
    videoQueueStopRef.current = false;
    setVideoQueueRunning(true);
    setSceneError("");
    let processed = 0;
    const failures: string[] = [];
    try {
      const worker = async () => {
        try {
          while (!videoQueueStopRef.current) {
            const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/video-queue/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: VIDEO_QUEUE_CONCURRENCY }) });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || "Video queue thất bại.");
            if (!payload.processed) break;
            if (!payload.ok && !payload.retryQueued) failures.push(payload.message || "Một job video AI thất bại.");
            processed += 1;
            setBatchMediaProgress(`Video queue · ${processed} job đã xử lý · tối đa ${VIDEO_QUEUE_CONCURRENCY} luồng`);
            if (payload.retryQueued) {
              const retriedJob = payload.queue?.jobs?.find((job: { id: string }) => job.id === payload.jobId);
              const attempt = Math.max(1, Number(retriedJob?.attempt) || 1);
              await new Promise((resolve) => window.setTimeout(resolve, Math.min(1_000 * (2 ** (attempt - 1)), 8_000)));
            }
            if (!payload.summary?.queued) break;
          }
        } catch (cause) {
          failures.push(cause instanceof Error ? cause.message : "Video queue thất bại.");
          videoQueueStopRef.current = true;
        }
      };
      await Promise.all(Array.from({ length: VIDEO_QUEUE_CONCURRENCY }, () => worker()));
      if (processed) {
        await refresh();
        await loadScenes();
      }
      if (failures.length) setRunMessage({ tone: "error", text: `Queue đã xử lý ${processed} job; lỗi: ${failures.slice(0, 3).join("; ")}${failures.length > 3 ? `; và ${failures.length - 3} lỗi khác` : ""}` });
      else if (processed) setRunMessage({ tone: "success", text: `Queue đã xử lý ${processed} job video AI. Có thể tiếp tục bất cứ lúc nào nếu còn job.` });
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Video queue thất bại.");
    } finally {
      setBatchMediaProgress("");
      setVideoQueueRunning(false);
    }
  }

  async function renderProjectVideo() {
    if (!project?.slug || renderRunning || ttsRunning || isRunning || runningScriptChunkId) return;
    setRenderRunning(true);
    setSceneError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/render`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "video", settings: renderSettings }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Render MP4 thất bại.");
      await refresh();
      const fallbackCount = Number(payload.render?.missingMedia) || 0;
      const audioReady = Boolean(payload.render?.audioReady);
      const stale = Boolean(payload.render?.stale);
      setRunMessage({
        tone: audioReady && fallbackCount === 0 && !stale ? "success" : "error",
        text: `Đã render MP4${audioReady ? " · đã có tiếng TTS hoặc tiếng gốc" : " · không có tiếng TTS hoặc tiếng gốc, đã tạo kèm SRT"}${fallbackCount ? ` · ${fallbackCount} cảnh dùng media dự phòng` : ""}${stale ? " · dữ liệu đổi trong lúc render, cần render lại" : ""}.`,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Render MP4 thất bại.";
      setSceneError(message);
      setRunMessage({ tone: "error", text: message });
    } finally {
      setRenderRunning(false);
    }
  }

  async function renderChunkVideo(chunkId: string, episodeNumber: number, language = "") {
    if (!project?.slug || renderRunning || ttsRunning || isRunning || runningScriptChunkId) return;
    setRenderRunning(true);
    setRenderingChunkId(chunkId);
    setRenderingLanguage(language);
    setSceneError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/chunks/${encodeURIComponent(chunkId)}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: renderSettings, ...(language ? { language } : {}) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || `Không ghép được Tập ${episodeNumber}.`);
      await refresh();
      const render = payload.render as { audioReady?: boolean; missingMedia?: number; sceneCount?: number; stale?: boolean } | undefined;
      const warnings = [
        render?.audioReady ? "đã có tiếng TTS hoặc tiếng gốc" : "chưa có tiếng, đã tạo SRT riêng",
        render?.missingMedia ? `${render.missingMedia} cảnh dùng media dự phòng` : "",
        render?.stale ? "dữ liệu đổi trong lúc ghép, cần ghép lại" : "",
      ].filter(Boolean).join(" · ");
      setRunMessage({ tone: render?.audioReady && !render.missingMedia && !render.stale ? "success" : "error", text: `Đã ghép Tập ${String(episodeNumber).padStart(2, "0")}${language ? ` · voice ${voiceLanguageLabel(language)}` : ""} · ${render?.sceneCount || 0} cảnh · ${warnings}.` });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Ghép video tập thất bại.";
      await refresh().catch(() => undefined);
      setSceneError(message);
      setRunMessage({ tone: "error", text: message });
    } finally {
      setRenderingChunkId("");
      setRenderingLanguage("");
      setRenderRunning(false);
    }
  }

  async function generatePublishingPackage() {
    if (!project?.slug || publishingBusy) return;
    setPublishingBusy(true);
    setPublishingError("");
    setPublishingNotice("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/publishing-package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: publishingScope }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không tạo được gợi ý title và thumbnail.");
      await refresh();
      setPublishingNotice(`Đã lưu gợi ý bằng ${payload.model || "AI"}.`);
    } catch (cause) {
      setPublishingError(cause instanceof Error ? cause.message : "Không tạo được gợi ý title và thumbnail.");
    } finally {
      setPublishingBusy(false);
    }
  }

  async function copyPublishingText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setPublishingNotice(`Đã sao chép ${label}.`);
      setPublishingError("");
    } catch {
      setPublishingError("Trình duyệt không cấp quyền sao chép. Hãy chọn và sao chép nội dung trực tiếp.");
    }
  }

  async function renderAllEpisodes() {
    if (!project?.slug || renderRunning || ttsRunning || isRunning || runningScriptChunkId) return;
    const targets = project.chunks.filter((chunk) => Boolean(chunk.outputPath) && chunk.render?.status !== "running" && (chunk.render?.stale === true || chunk.render?.status !== "completed"));
    if (!targets.length) {
      setRunMessage({ tone: "success", text: "Tất cả tập đã có video. Dùng nút MP4 ở từng tập để tải lại." });
      return;
    }

    setRenderRunning(true);
    setBatchRenderProgress(`0/${targets.length}`);
    setSceneError("");
    const rendered: string[] = [];
    const failed: string[] = [];
    for (let index = 0; index < targets.length; index += 1) {
      const chunk = targets[index];
      const episodeNumber = project.chunks.findIndex((item) => item.id === chunk.id) + 1;
      const episodeLabel = `Tập ${String(episodeNumber).padStart(2, "0")}`;
      setRenderingChunkId(chunk.id);
      setBatchRenderProgress(`${index + 1}/${targets.length}`);
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/chunks/${encodeURIComponent(chunk.id)}/render`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: renderSettings }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.message || `${episodeLabel} ghép thất bại.`);
        if (payload.render?.stale) throw new Error("Dữ liệu đổi trong lúc ghép; tập này cần được ghép lại.");
        rendered.push(episodeLabel);
        await refresh();
      } catch (cause) {
        failed.push(`${episodeLabel}: ${cause instanceof Error ? cause.message : "lỗi không xác định"}`);
        await refresh().catch(() => undefined);
      }
    }
    setRenderingChunkId("");
    setBatchRenderProgress("");
    setRenderRunning(false);
    setRunMessage({
      tone: failed.length ? "error" : "success",
      text: failed.length
        ? `Đã ghép ${rendered.length}/${targets.length} tập. Lỗi: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? `; và ${failed.length - 3} lỗi khác` : ""}`
        : `Đã ghép xong ${rendered.length} tập. MP4 và SRT đã sẵn sàng ở từng dòng tập.`,
    });
  }

  async function generateChunkTts(chunkId: string, episodeNumber: number, force = false) {
    if (!project?.slug || ttsRunning || renderRunning || scriptBlocksIndependentTasks || batchMediaBusy || videoQueueRunning || generatingSceneId) return;
    setTtsRunning(true);
    setTtsChunkId(chunkId);
    setRunMessage(null);
    setSceneError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/chunks/${encodeURIComponent(chunkId)}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || `Không tạo được TTS cho Tập ${episodeNumber}.`);
      await refresh();
      await loadScenes();
      const episodeLabel = `Tập ${String(episodeNumber).padStart(2, "0")}`;
      const status = String(payload.status || "completed");
      setRunMessage({
        tone: status === "completed" || status === "not_needed" ? "success" : "error",
        text: status === "not_needed"
          ? `${episodeLabel} không có lời thoại/lời đọc để tạo TTS.`
          : status === "completed"
            ? `Đã tạo TTS cho ${episodeLabel} · ${payload.completed}/${payload.total} ${project.presetId === "ai-drama" ? "câu thoại" : "cảnh có lời đọc"}. Có thể ghép tập để xuất MP4 có tiếng.`
            : `TTS ${episodeLabel}: ${payload.completed}/${payload.total} ${project.presetId === "ai-drama" ? "câu thoại" : "cảnh"} thành công, ${payload.failed} lỗi.${payload.message ? ` ${payload.message}` : ""}`,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Không tạo được TTS cho tập.";
      await refresh().catch(() => undefined);
      setSceneError(message);
      setRunMessage({ tone: "error", text: message });
    } finally {
      setTtsChunkId("");
      setTtsRunning(false);
    }
  }

  async function deleteChunkTts(chunkId: string, episodeNumber: number, sceneId?: string) {
    if (!project?.slug || deletingTtsChunkId || ttsRunning || renderRunning || isRunning || runningScriptChunkId || scriptBlocksIndependentTasks || batchMediaBusy || videoQueueRunning || generatingSceneId || dialogueTranslationSceneId || dialogueTranslationBatchProgress || dialogueTtsBatchProgress || dialogueSavingSceneId) return;
    const episodeLabel = `Tập ${String(episodeNumber).padStart(2, "0")}`;
    const scopeLabel = sceneId ? `cảnh ${sceneId}` : `toàn bộ ${episodeLabel}`;
    if (!window.confirm(`Xoá TTS đã tạo cho ${scopeLabel}, gồm voice gốc và voice bản dịch? Có thể tạo lại sau. Tiếng gốc trong video sẽ được dùng khi ghép nếu cảnh không còn TTS.`)) return;
    setDeletingTtsChunkId(chunkId);
    setSceneError("");
    setRunMessage(null);
    try {
      const query = sceneId ? `?sceneId=${encodeURIComponent(sceneId)}` : "";
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/chunks/${encodeURIComponent(chunkId)}/tts${query}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || `Không xoá được TTS của ${scopeLabel}.`);
      await refresh();
      await loadScenes();
      setRunMessage({ tone: "success", text: `Đã xoá TTS của ${scopeLabel}. Ghép lại để dùng tiếng gốc ở các cảnh có audio.` });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : `Không xoá được TTS của ${scopeLabel}.`;
      setSceneError(message);
      setRunMessage({ tone: "error", text: message });
      await refresh().catch(() => undefined);
    } finally {
      setDeletingTtsChunkId("");
    }
  }

  async function generateAllEpisodeTts() {
    if (!project?.slug || ttsRunning || renderRunning || scriptBlocksIndependentTasks || batchMediaBusy || videoQueueRunning || generatingSceneId) return;
    const targets = project.chunks.filter((chunk) => Boolean(chunk.outputPath) && chunk.tts?.status !== "completed" && chunk.tts?.status !== "not_needed");
    if (!targets.length) {
      setRunMessage({ tone: "success", text: "Các tập đã có TTS hoặc không có lời đọc cần tổng hợp." });
      return;
    }

    setTtsRunning(true);
    setTtsChunkId("");
    setBatchTtsProgress(`0/${targets.length} · tối đa ${Math.min(targets.length, BATCH_TTS_EPISODE_CONCURRENCY)} luồng`);
    setSceneError("");
    const generated: string[] = [];
    const failed: string[] = [];
    let finishedCount = 0;
    await forEachConcurrent(targets, BATCH_TTS_EPISODE_CONCURRENCY, async (chunk) => {
      const episodeNumber = project.chunks.findIndex((item) => item.id === chunk.id) + 1;
      const episodeLabel = `Tập ${String(episodeNumber).padStart(2, "0")}`;
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/chunks/${encodeURIComponent(chunk.id)}/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: false }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.message || `${episodeLabel} tạo TTS thất bại.`);
        if (payload.status === "failed" || payload.status === "partial") failed.push(`${episodeLabel}: ${payload.message || `${payload.failed} cảnh lỗi`}`);
        else generated.push(episodeLabel);
      } catch (cause) {
        failed.push(`${episodeLabel}: ${cause instanceof Error ? cause.message : "lỗi không xác định"}`);
      } finally {
        finishedCount += 1;
        setBatchTtsProgress(`${finishedCount}/${targets.length} · tối đa ${Math.min(targets.length, BATCH_TTS_EPISODE_CONCURRENCY)} luồng`);
      }
    });
    await refresh().catch(() => undefined);
    await loadScenes().catch(() => undefined);
    setTtsChunkId("");
    setBatchTtsProgress("");
    setTtsRunning(false);
    setRunMessage({
      tone: failed.length ? "error" : "success",
      text: failed.length
        ? `Đã xử lý TTS ${generated.length}/${targets.length} tập. Lỗi: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? `; và ${failed.length - 3} lỗi khác` : ""}`
        : `Đã tạo TTS xong ${generated.length} tập. Có thể ghép hàng loạt để xuất MP4 có tiếng.`,
    });
  }

  async function saveSceneMediaSettings(scene: ScenePreview, settings: MediaGenerationSettings): Promise<boolean> {
    if (!project?.slug || sceneMediaSettingsSaving || sceneHasActiveMediaJob(scene)) return false;
    setSceneMediaSettingsSaving(true);
    setSceneError("");
    setScenes((current) => current.map((item) => item.id === scene.id ? { ...item, mediaGeneration: settings } : item));
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(scene.id)}/media-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaGeneration: settings }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể lưu cấu hình media cho cảnh.");
      const updatedScene = payload.scene as ScenePreview;
      setScenes((current) => current.map((item) => item.id === updatedScene.id ? { ...item, ...updatedScene } : item));
      invalidateSceneVideoPromptPreview(updatedScene.id);
      return true;
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Không thể lưu cấu hình media cho cảnh.");
      await loadScenes().catch(() => undefined);
      return false;
    } finally {
      setSceneMediaSettingsSaving(false);
    }
  }

  function updateDramaSceneImageReference(scene: ScenePreview, enabled: boolean) {
    if (!project || sceneMediaSettingsSaving || generatingSceneId || batchMediaBusy || videoQueueRunning || sceneHasActiveMediaJob(scene)) return;
    void saveSceneMediaSettings(scene, {
      ...mediaSettingsForScene(scene, project),
      videoUseSceneImageReference: enabled,
    });
  }

  async function applyBatchSceneMediaSettings(targetScenes: ScenePreview[], settings: MediaGenerationSettings) {
    if (!project?.slug || !targetScenes.length) return;
    const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/media-settings-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sceneIds: targetScenes.map((scene) => scene.id), mediaGeneration: settings }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể áp dụng cấu hình media cho các cảnh.");
    const targetIds = new Set(targetScenes.map((scene) => scene.id));
    setScenes((current) => current.map((scene) => targetIds.has(scene.id) ? { ...scene, mediaGeneration: settings } : scene));
  }

  function updateBatchMediaSettings(patch: Partial<MediaGenerationSettings>) {
    const next = { ...batchMediaSettings, ...patch };
    if (project?.presetId === "ai-drama") next.videoDurationMode = "scene";
    if (patch.videoProvider && patch.videoProvider !== batchMediaSettings.videoProvider) {
      const providerModels = (mediaCatalog?.videoModels || []).filter((item) => (item.provider || "maivideo") === patch.videoProvider);
      const defaultModelId = patch.videoProvider === "seedance" ? DEFAULT_SEEDANCE_VIDEO_MODEL_ID : DEFAULT_MEDIA_GENERATION_SETTINGS.videoModel;
      const selected = providerModels.find((item) => item.id === patch.videoModel)
        || providerModels.find((item) => item.id === batchMediaSettings.videoModel)
        || providerModels.find((item) => item.id === defaultModelId)
        || providerModels[0];
      next.videoModel = selected?.id || defaultModelId;
      if (selected?.qualities.length && !selected.qualities.includes(next.videoQuality)) next.videoQuality = selected.qualities[0];
    }
    const videoModelChanged = next.videoModel !== batchMediaSettings.videoModel;
    if (videoModelChanged && isPixverseVideoModel(next.videoModel)) next.videoQuality = "1080p";
    const imageModel = mediaCatalog?.imageModels.find((item) => item.id === next.imageModel);
    if (imageModel?.qualities.length && !imageModel.qualities.includes(next.imageQuality)) next.imageQuality = imageModel.qualities[0];
    const imageDetailLevels = imageDetailLevelsForModel(imageModel);
    if (next.imageModel !== batchMediaSettings.imageModel && imageDetailLevels.length && !imageDetailLevels.includes(next.imageDetailLevel)) {
      next.imageDetailLevel = imageDetailLevels[0];
    }
    const videoModel = mediaCatalog?.videoModels.find((item) => item.id === next.videoModel && (item.provider || "maivideo") === next.videoProvider);
    if (!isPixverseVideoModel(next.videoModel) && videoModel?.qualities.length && !videoModel.qualities.includes(next.videoQuality)) next.videoQuality = videoModel.qualities[0];
    next.videoDurationSec = normalizeVideoDuration(next.videoDurationSec, videoModel, next.videoQuality);
    if (videoModel?.supportsMultiShot === false) next.videoMultiShot = false;
    if (videoModel?.supportsAudio === false) next.videoAudio = false;
    if (isVideoOffPeakRequired(next.videoModel, videoModel?.label)) next.videoOffPeak = true;
    else if (videoModel?.supportsOffPeak === false) next.videoOffPeak = false;
    setBatchMediaSettings(next);
  }

  function updateQuickImageModel(imageModel: string) {
    const selected = mediaCatalog?.imageModels.find((item) => item.id === imageModel);
    updateBatchMediaSettings({
      imageModel,
      ...(selected?.qualities.length && !selected.qualities.includes(batchMediaSettings.imageQuality)
        ? { imageQuality: selected.qualities[0] }
        : {}),
    });
  }

  function updateQuickVideoModel(videoModel: string) {
    const selected = mediaCatalog?.videoModels.find((item) => item.id === videoModel && (item.provider || "maivideo") === batchMediaSettings.videoProvider);
    const videoQuality = selected?.qualities.length && !selected.qualities.includes(batchMediaSettings.videoQuality)
      ? selected.qualities[0]
      : batchMediaSettings.videoQuality;
    updateBatchMediaSettings({
      videoProvider: selected?.provider || batchMediaSettings.videoProvider,
      videoModel,
      videoQuality,
      videoDurationSec: normalizeVideoDuration(batchMediaSettings.videoDurationSec, selected, videoQuality),
      ...(selected?.supportsMultiShot === false ? { videoMultiShot: false } : {}),
      ...(selected?.supportsAudio === false ? { videoAudio: false } : {}),
      ...(selected?.supportsOffPeak === false ? { videoOffPeak: false } : {}),
    });
  }

  async function generateFilteredSceneImages() {
    if (!project?.slug || batchMediaBusy || videoQueueRunning || generatingSceneId || ttsRunning || dialogueTtsBatchProgress || scriptBlocksIndependentTasks || !filteredScenes.length) return;
    const targets = filteredImageTargets;
    if (!targets.length) {
      setRunMessage({ tone: "success", text: "Không có cảnh trong phạm vi hiện tại để tạo ảnh." });
      return;
    }
    setBatchMediaBusy(true);
    setGeneratingSceneMediaKind("image");
    setSceneError("");
    setRunMessage(null);
    try {
      setBatchMediaProgress(`Đang áp dụng cấu hình cho ${targets.length} cảnh…`);
      await applyBatchSceneMediaSettings(targets, batchMediaSettings);
      setBatchMediaProgress(`Đang xếp ${targets.length} job ảnh vào hàng đợi nền…`);
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scene-media-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneIds: targets.map((scene) => scene.id), kind: "image", mediaGeneration: batchMediaSettings }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể xếp ảnh vào hàng đợi nền.");
      const jobs = Array.isArray(payload.jobs) ? payload.jobs as SceneMediaJobPreview[] : [];
      const jobsByScene = new Map(jobs.map((job) => [job.sceneId, job]));
      setScenes((current) => current.map((scene) => jobsByScene.has(scene.id) ? { ...scene, mediaJob: jobsByScene.get(scene.id) } : scene));
      setRunMessage({
        tone: "success",
        text: `Đã xếp ${jobs.length} job tạo ảnh vào hàng đợi chạy nền${batchRegenerateImages ? " (ghi đè ảnh cũ khi hoàn tất)" : ""}. Có thể tiếp tục dùng màn hình; trạng thái sẽ tự cập nhật.`,
      });
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Không thể tạo ảnh hàng loạt.");
    } finally {
      setBatchMediaProgress("");
      setBatchMediaBusy(false);
      setGeneratingSceneMediaKind("");
    }
  }

  async function generateFilteredSceneVideos() {
    if (!filteredVideoTargets.length || batchMediaBusy || videoQueueRunning || generatingSceneId || ttsRunning || dialogueTtsBatchProgress || scriptBlocksIndependentTasks) return;
    setBatchMediaBusy(true);
    setGeneratingSceneMediaKind("video");
    setBatchMediaProgress(`Đang xếp ${filteredVideoTargets.length} job video vào hàng đợi nền…`);
    setSceneError("");
    try {
      await applyBatchSceneMediaSettings(filteredVideoTargets, batchMediaSettings);
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scene-media-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneIds: filteredVideoTargets.map((scene) => scene.id), kind: "video", mediaGeneration: batchMediaSettings }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể xếp video vào hàng đợi nền.");
      const jobs = Array.isArray(payload.jobs) ? payload.jobs as SceneMediaJobPreview[] : [];
      const jobsByScene = new Map(jobs.map((job) => [job.sceneId, job]));
      setScenes((current) => current.map((scene) => jobsByScene.has(scene.id) ? { ...scene, mediaJob: jobsByScene.get(scene.id) } : scene));
      const replacedLegacyJobs = Number(payload.replacedLegacyVideoJobs) || 0;
      setRunMessage({ tone: "success", text: `Đã xếp ${jobs.length} job video vào hàng đợi chạy nền.${replacedLegacyJobs ? ` Đã thay ${replacedLegacyJobs} job chờ ở queue cũ.` : ""} Có thể tiếp tục thao tác; trạng thái từng cảnh tự cập nhật.` });
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Không thể xếp video vào hàng đợi nền.");
    } finally {
      setBatchMediaProgress("");
      setBatchMediaBusy(false);
      setGeneratingSceneMediaKind("");
    }
  }

  function updateSelectedSceneMediaSettings(patch: Partial<MediaGenerationSettings>) {
    if (!selectedScene || !project || sceneMediaSettingsSaving || sceneHasActiveMediaJob(selectedScene)) return;
    const currentSettings = mediaSettingsForScene(selectedScene, project);
    const next = { ...currentSettings, ...patch };
    if (project.presetId === "ai-drama") next.videoDurationMode = "scene";
    if (patch.videoModel) {
      const selectedModel = mediaCatalog?.videoModels.find((item) => item.id === patch.videoModel && (item.provider || "maivideo") === (patch.videoProvider || currentSettings.videoProvider));
      if (selectedModel) next.videoProvider = selectedModel.provider || "maivideo";
    }
    if (patch.videoProvider && patch.videoProvider !== currentSettings.videoProvider) {
      const providerModels = (mediaCatalog?.videoModels || []).filter((item) => (item.provider || "maivideo") === patch.videoProvider);
      const defaultModelId = patch.videoProvider === "seedance" ? DEFAULT_SEEDANCE_VIDEO_MODEL_ID : DEFAULT_MEDIA_GENERATION_SETTINGS.videoModel;
      const selected = providerModels.find((item) => item.id === currentSettings.videoModel)
        || providerModels.find((item) => item.id === defaultModelId)
        || providerModels[0];
      next.videoModel = selected?.id || defaultModelId;
      if (selected?.qualities.length && !selected.qualities.includes(next.videoQuality)) next.videoQuality = selected.qualities[0];
    }
    const videoModelChanged = next.videoModel !== currentSettings.videoModel;
    if (videoModelChanged && isPixverseVideoModel(next.videoModel)) next.videoQuality = "1080p";
    const imageModel = mediaCatalog?.imageModels.find((item) => item.id === next.imageModel);
    if (imageModel?.qualities.length && !imageModel.qualities.includes(next.imageQuality)) {
      next.imageQuality = imageModel.qualities[0];
    }
    const imageDetailLevels = imageDetailLevelsForModel(imageModel);
    if (next.imageModel !== currentSettings.imageModel && imageDetailLevels.length && !imageDetailLevels.includes(next.imageDetailLevel)) {
      next.imageDetailLevel = imageDetailLevels[0];
    }
    const videoModel = mediaCatalog?.videoModels.find((item) => item.id === next.videoModel && (item.provider || "maivideo") === next.videoProvider);
    if (!isPixverseVideoModel(next.videoModel) && videoModel?.qualities.length && !videoModel.qualities.includes(next.videoQuality)) {
      next.videoQuality = videoModel.qualities[0];
    }
    next.videoDurationSec = normalizeVideoDuration(next.videoDurationSec, videoModel, next.videoQuality);
    if (videoModel?.supportsMultiShot === false) next.videoMultiShot = false;
    if (videoModel?.supportsAudio === false) next.videoAudio = false;
    if (isVideoOffPeakRequired(next.videoModel, videoModel?.label)) next.videoOffPeak = true;
    else if (videoModel?.supportsOffPeak === false) next.videoOffPeak = false;
    void saveSceneMediaSettings(selectedScene, next);
  }

  async function generateSceneMedia(scene: ScenePreview, kind: "image" | "video") {
    if (!project?.slug || sceneMediaSettingsSaving || generatingSceneId || batchMediaBusy || videoQueueRunning || ttsRunning || scriptBlocksIndependentTasks || scene.mediaJob?.status === "queued" || scene.mediaJob?.status === "running") return;
    setGeneratingSceneId(scene.id);
    setGeneratingSceneMediaKind(kind);
    setSceneError("");
    try {
      const currentSettings = mediaSettingsForScene(scene, project);
      const selectedImageModel = availableImageModels.find((item) => item.id === batchMediaSettings.imageModel);
      const nextSettings: MediaGenerationSettings = kind === "image"
        ? {
            ...currentSettings,
            imageModel: batchMediaSettings.imageModel,
            imageQuality: selectedImageModel?.qualities.length && !selectedImageModel.qualities.includes(batchMediaSettings.imageQuality)
              ? selectedImageModel.qualities[0]
              : batchMediaSettings.imageQuality,
            imageDetailLevel: batchMediaSettings.imageDetailLevel,
            imageUseCharacterReferences: batchMediaSettings.imageUseCharacterReferences,
          }
        : videoGenerationSettingsForScene(scene);
      const settingsChanged = kind === "image"
        ? currentSettings.imageModel !== nextSettings.imageModel
          || currentSettings.imageQuality !== nextSettings.imageQuality
          || currentSettings.imageDetailLevel !== nextSettings.imageDetailLevel
          || currentSettings.imageUseCharacterReferences !== nextSettings.imageUseCharacterReferences
        : currentSettings.videoProvider !== nextSettings.videoProvider
          || currentSettings.videoModel !== nextSettings.videoModel
          || currentSettings.videoQuality !== nextSettings.videoQuality
          || currentSettings.seedanceAccountId !== nextSettings.seedanceAccountId
          || currentSettings.videoDurationMode !== nextSettings.videoDurationMode
          || currentSettings.videoDurationSec !== nextSettings.videoDurationSec
          || currentSettings.videoMultiShot !== nextSettings.videoMultiShot
          || currentSettings.videoAudio !== nextSettings.videoAudio
          || currentSettings.videoOffPeak !== nextSettings.videoOffPeak
          || currentSettings.videoUseCharacterReferences !== nextSettings.videoUseCharacterReferences
          || currentSettings.videoUseLocationReferences !== nextSettings.videoUseLocationReferences
          || currentSettings.videoUseSceneImageReference !== nextSettings.videoUseSceneImageReference;
      if (settingsChanged && !(await saveSceneMediaSettings(scene, nextSettings))) return;
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scene-media-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneIds: [scene.id], kind, mediaGeneration: nextSettings }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || `Không thể xếp ${kind === "image" ? "ảnh" : "video"} vào hàng đợi.`);
      const job = (Array.isArray(payload.jobs) ? payload.jobs[0] : undefined) as SceneMediaJob | undefined;
      if (job) setScenes((current) => current.map((item) => item.id === scene.id ? { ...item, mediaJob: job } : item));
      const replacedLegacyJobs = Number(payload.replacedLegacyVideoJobs) || 0;
      setRunMessage({ tone: "success", text: `${sceneNumberLabel(scene)} đã được xếp vào hàng đợi chạy nền để tạo ${kind === "image" ? "ảnh" : "video"}.${replacedLegacyJobs ? ` Đã thay ${replacedLegacyJobs} job video chờ ở queue cũ.` : ""} Trạng thái sẽ tự cập nhật.` });
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : `Không tạo được ${kind === "image" ? "ảnh" : "video"} AI cho cảnh.`);
    } finally {
      setGeneratingSceneId("");
      setGeneratingSceneMediaKind("");
    }
  }

  async function generateSceneVideo(scene: ScenePreview) {
    await generateSceneMedia(scene, "video");
  }

  function invalidateSceneVideoPromptPreview(sceneId: string) {
    sceneVideoPromptPreviewRequestIds.current[sceneId] = (sceneVideoPromptPreviewRequestIds.current[sceneId] || 0) + 1;
    setSceneVideoPromptPreviews((current) => {
      if (!(sceneId in current)) return current;
      const next = { ...current };
      delete next[sceneId];
      return next;
    });
  }

  async function loadSceneVideoPromptPreview(scene: ScenePreview, mediaGeneration: MediaGenerationSettings): Promise<SceneVideoPromptPreview | null> {
    const currentPreview = sceneVideoPromptPreviews[scene.id];
    if (!project?.slug || currentPreview?.loading) return currentPreview?.result || null;
    if (currentPreview?.result) return currentPreview.result;
    const requestId = (sceneVideoPromptPreviewRequestIds.current[scene.id] || 0) + 1;
    sceneVideoPromptPreviewRequestIds.current[scene.id] = requestId;
    setSceneVideoPromptPreviews((current) => ({ ...current, [scene.id]: { loading: true } }));
    try {
      if (dialogueDirtySceneIdsRef.current.has(scene.id)) {
        const savedDialogue = await saveDialogueSegments(scene, false);
        if (!savedDialogue) throw new Error("Timeline thoại đang lưu hoặc chưa lưu được. Hãy chờ lưu xong rồi mở lại phần xem trước.");
      }
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(scene.id)}/video-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ mediaGeneration }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không tạo được bản xem trước prompt video.");
      const prompt = String(payload.prompt || "");
      if (!prompt) throw new Error("Prompt API hiện đang trống.");
      const result: SceneVideoPromptPreview = {
        prompt,
        promptLength: Number(payload.promptLength) || prompt.length,
        provider: String(payload.provider || ""),
        model: String(payload.model || ""),
        dialogueCueCount: Number(payload.dialogueCueCount) || 0,
        dialogueIncluded: Boolean(payload.dialogueIncluded),
      };
      if (sceneVideoPromptPreviewRequestIds.current[scene.id] !== requestId) return null;
      setSceneVideoPromptPreviews((current) => ({ ...current, [scene.id]: { result } }));
      return result;
    } catch (cause) {
      if (sceneVideoPromptPreviewRequestIds.current[scene.id] !== requestId) return null;
      setSceneVideoPromptPreviews((current) => ({ ...current, [scene.id]: { error: cause instanceof Error ? cause.message : "Không tạo được bản xem trước prompt video." } }));
      return null;
    }
  }

  async function copySceneVideoPrompt(scene: ScenePreview, mediaGeneration: MediaGenerationSettings) {
    if (copyingSceneVideoPromptId === scene.id) return;
    setCopyingSceneVideoPromptId(scene.id);
    setCopiedSceneVideoPromptId("");
    try {
      const preview = sceneVideoPromptPreviews[scene.id]?.result
        ? sceneVideoPromptPreviews[scene.id].result
        : await loadSceneVideoPromptPreview(scene, mediaGeneration);
      if (!preview?.prompt) throw new Error(sceneVideoPromptPreviews[scene.id]?.error || "Không tạo được prompt để sao chép.");
      await navigator.clipboard.writeText(preview.prompt);
      setCopiedSceneVideoPromptId(scene.id);
      setSceneError("");
      window.setTimeout(() => setCopiedSceneVideoPromptId((current) => current === scene.id ? "" : current), 1800);
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Không thể sao chép prompt. Hãy chọn và sao chép nội dung trực tiếp.");
    } finally {
      setCopyingSceneVideoPromptId("");
    }
  }

  async function prepareSceneVideoReferenceImages(scene: ScenePreview, mediaGeneration: MediaGenerationSettings) {
    const cacheKey = `${scene.id}:${JSON.stringify(mediaGeneration)}`;
    const cachedImages = sceneVideoReferenceClipboardCache.current[cacheKey];
    if (cachedImages) return cachedImages;
    const pendingImages = sceneVideoReferenceClipboardPending.current[cacheKey];
    if (pendingImages) return pendingImages;

    const preparation = (async () => {
      const referenceResponse = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(scene.id)}/video-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ mediaGeneration, referenceImagesOnly: true }),
      });
      const payload = await referenceResponse.json().catch(() => ({}));
      if (!referenceResponse.ok || !payload.ok) throw new Error(payload.message || "Không lấy được danh sách ảnh tham chiếu.");
      const references: Array<{ name: string; url: string }> = Array.isArray(payload.referenceImages)
        ? payload.referenceImages.flatMap((value: unknown): Array<{ name: string; url: string }> => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return [];
          const reference = value as Record<string, unknown>;
          const name = String(reference.name || "").trim();
          const url = String(reference.url || "").trim();
          return name && url ? [{ name, url }] : [];
        })
        : [];
      if (!references.length) throw new Error("Cảnh này chưa có ảnh tham chiếu video đã tạo để copy.");
      const images = await Promise.all(references.map(async (reference) => {
        const response = await fetch(reference.url, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error(`${reference.name}: không tải được ảnh tham chiếu.`);
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) throw new Error(`${reference.name}: dữ liệu tải về không phải ảnh.`);
        return clipboardPngBlob(blob);
      }));
      sceneVideoReferenceClipboardCache.current[cacheKey] = images;
      return images;
    })();
    sceneVideoReferenceClipboardPending.current[cacheKey] = preparation;
    try {
      return await preparation;
    } finally {
      if (sceneVideoReferenceClipboardPending.current[cacheKey] === preparation) delete sceneVideoReferenceClipboardPending.current[cacheKey];
    }
  }

  function warmSceneVideoReferenceImages(scene: ScenePreview, mediaGeneration: MediaGenerationSettings) {
    const cacheKey = `${scene.id}:${JSON.stringify(mediaGeneration)}`;
    if (sceneVideoReferenceClipboardCache.current[cacheKey]) return;
    void prepareSceneVideoReferenceImages(scene, mediaGeneration).catch(() => undefined);
  }

  async function copySceneVideoReferenceImages(scene: ScenePreview, mediaGeneration: MediaGenerationSettings) {
    if (copyingSceneVideoReferencesId === scene.id) return;
    setCopyingSceneVideoReferencesId(scene.id);
    setCopiedSceneVideoReferencesId("");
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("Trình duyệt không hỗ trợ copy ảnh vào clipboard.");
      }
      if (typeof ClipboardItem.supports === "function" && !ClipboardItem.supports("image/png")) {
        throw new Error("Trình duyệt không hỗ trợ ghi ảnh PNG vào clipboard. Hãy dùng Chrome, Edge hoặc Safari mới nhất.");
      }

      const cacheKey = `${scene.id}:${JSON.stringify(mediaGeneration)}`;
      const imagesBeforeClick = sceneVideoReferenceClipboardCache.current[cacheKey];
      const preparedBeforeClick = Boolean(imagesBeforeClick);
      const images = imagesBeforeClick || await prepareSceneVideoReferenceImages(scene, mediaGeneration);
      if (!preparedBeforeClick) {
        // Fetching references takes time and loses the browser's transient user gesture.
        // Prepare on the first click, then write to the clipboard directly on the next click.
        setPreparedSceneVideoReferencesId(scene.id);
        setSceneVideoReferenceCopyProgress((current) => ({
          ...current,
          [scene.id]: { cacheKey, nextIndex: 0, lastCopiedIndex: 0, total: images.length, complete: false },
        }));
        setSceneVideoReferenceCopyNotice({ sceneId: scene.id, text: `Đã chuẩn bị ${images.length} ảnh. Bấm “Copy ảnh 1/${images.length}”, dán ở Seedance bằng ⌘V/Ctrl+V, rồi quay lại copy ảnh tiếp theo.` });
        return;
      }
      const priorProgress = sceneVideoReferenceCopyProgress[scene.id];
      const matchingProgress = priorProgress?.cacheKey === cacheKey && priorProgress.total === images.length ? priorProgress : null;
      const imageIndex = matchingProgress && !matchingProgress.complete ? matchingProgress.nextIndex : 0;
      try {
        // Chromium in this app does not implement multiple ClipboardItems in one write.
        // Copy one image per click so the target site's normal Cmd/Ctrl+V paste still works.
        let clipboardWriteTimer: number | undefined;
        try {
          await Promise.race([
            navigator.clipboard.write([new ClipboardItem({ "image/png": images[imageIndex] })]),
            new Promise<never>((_, reject) => {
              clipboardWriteTimer = window.setTimeout(() => reject(new Error("CLIPBOARD_WRITE_TIMEOUT")), 7000);
            }),
          ]);
        } finally {
          if (clipboardWriteTimer !== undefined) window.clearTimeout(clipboardWriteTimer);
        }
      } catch (cause) {
        const errorName = cause instanceof DOMException ? cause.name : "";
        if (errorName === "NotAllowedError" || errorName === "SecurityError") {
          setPreparedSceneVideoReferencesId(scene.id);
          if (!matchingProgress) {
            setSceneVideoReferenceCopyProgress((current) => ({
              ...current,
              [scene.id]: { cacheKey, nextIndex: imageIndex, lastCopiedIndex: 0, total: images.length, complete: false },
            }));
          }
          setSceneVideoReferenceCopyNotice({ sceneId: scene.id, text: `Trình duyệt chưa cho ghi clipboard. Bấm “Copy ảnh ${imageIndex + 1}/${images.length}” lần nữa rồi dán ở Seedance bằng ⌘V/Ctrl+V.` });
          return;
        }
        if (cause instanceof Error && cause.message === "CLIPBOARD_WRITE_TIMEOUT") {
          setSceneVideoReferenceCopyNotice({ sceneId: scene.id, text: "Clipboard của trình duyệt không phản hồi; ảnh chưa được copy nên ⌘V sẽ không dán được. Hãy mở StoryAI bằng Chrome/Edge chính và cho phép Clipboard, hoặc dùng Upload nhiều file trên Seedance." });
          return;
        }
        throw cause;
      }
      const nextIndex = imageIndex + 1;
      const complete = nextIndex >= images.length;
      setSceneVideoReferenceCopyProgress((current) => ({
        ...current,
        [scene.id]: { cacheKey, nextIndex: complete ? images.length : nextIndex, lastCopiedIndex: imageIndex + 1, total: images.length, complete },
      }));
      setPreparedSceneVideoReferencesId("");
      setCopiedSceneVideoReferencesId(scene.id);
      setSceneVideoReferenceCopyNotice({
        sceneId: scene.id,
        text: complete
          ? `Đã copy đủ ${images.length} ảnh, lần lượt. Dán ảnh ${imageIndex + 1}/${images.length} vào Seedance; nếu Seedance chưa nhận ảnh nào, hãy dán ngay rồi mới copy ảnh tiếp.`
          : `Đã copy ảnh ${imageIndex + 1}/${images.length}. Chuyển sang Seedance nhấn ⌘V/Ctrl+V, rồi quay lại bấm Copy ảnh tiếp theo (${nextIndex + 1}/${images.length}).`,
      });
      setSceneError("");
      window.setTimeout(() => setCopiedSceneVideoReferencesId((current) => current === scene.id ? "" : current), 2200);
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Không thể copy ảnh tham chiếu.");
    } finally {
      setCopyingSceneVideoReferencesId("");
    }
  }

  async function generateSceneImage(scene: ScenePreview) {
    await generateSceneMedia(scene, "image");
  }

  async function updateDramaProfile(kind: "characters" | "locations", id: string, method: "PATCH" | "DELETE", values: Record<string, string> = {}) {
    if (!project || profileBusyId || profileBatchKinds.size > 0) return;
    setProfileBusyId(id);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/${kind}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [kind === "characters" ? "characterId" : "locationId"]: id, ...values }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không lưu được hồ sơ.");
      await refresh();
      if (method === "DELETE") await loadScenes();
      setRunMessage({ tone: "success", text: method === "DELETE" ? "Đã xóa hồ sơ." : "Đã lưu prompt ảnh." });
    } catch (cause) { setRunMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Không lưu được hồ sơ." }); }
    finally { setProfileBusyId(""); }
  }

  async function createDramaProfile(kind: "characters" | "locations") {
    if (!project || !newDramaProfile.name.trim() || profileBusyId || profileBatchKinds.size > 0) return;
    setProfileBusyId("new");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newDramaProfile) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không tạo được hồ sơ.");
      setNewDramaProfile({ name: "", description: "", imagePrompt: "" });
      await refresh(); setRunMessage({ tone: "success", text: "Đã tạo hồ sơ mới." });
    } catch (cause) { setRunMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Không tạo được hồ sơ." }); }
    finally { setProfileBusyId(""); }
  }

  async function generateDramaProfileImage(kind: "characters" | "locations", id: string) {
    const busyKey = `${kind}:${id}`;
    if (!project || profileBusyId || profileBatchKinds.has(kind) || profileImageBusyIds.has(busyKey)) return;
    const profileName = kind === "characters"
      ? project.characters?.find((profile) => profile.id === id)?.name
      : project.locations?.find((profile) => profile.id === id)?.name;
    setProfileImageBusyIds((current) => new Set(current).add(busyKey));
    setRunMessage({ tone: "info", text: `Đang gửi yêu cầu tạo ảnh tham chiếu${profileName ? ` cho ${profileName}` : ""}…` });
    try {
      const entity = kind === "characters" ? "characters" : "locations";
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/${entity}/${encodeURIComponent(id)}/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaGeneration: batchMediaSettings }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không tạo được ảnh.");
      await refresh();
      setRunMessage({ tone: "success", text: `Đã tạo ảnh tham chiếu${profileName ? ` cho ${profileName}` : ""} và lưu trong project.` });
    } catch (cause) { setRunMessage({ tone: "error", text: `${profileName ? `${profileName}: ` : ""}${cause instanceof Error ? cause.message : "Không tạo được ảnh."}` }); }
    finally { setProfileImageBusyIds((current) => { const next = new Set(current); next.delete(busyKey); return next; }); }
  }

  async function generateDramaProfileImages(kind: "characters" | "locations", onlyProfileIds?: string[]) {
    if (!project || profileBusyId || profileBatchKinds.has(kind)) return;
    const profiles = kind === "characters" ? project.characters || [] : project.locations || [];
    if (profiles.some((profile) => profileImageBusyIds.has(`${kind}:${profile.id}`))) return;
    const allowedIds = onlyProfileIds ? new Set(onlyProfileIds) : undefined;
    const targets = profiles.filter((profile) => !profile.referenceImagePath && (!allowedIds || allowedIds.has(profile.id)));
    if (!targets.length) return;

    setProfileBatchKinds((current) => new Set(current).add(kind));
    let createdCount = 0;
    const failures: string[] = [];
    try {
      let finishedCount = 0;
      setProfileBatchProgress((current) => ({ ...current, [kind]: `0/${targets.length} · tối đa ${Math.min(targets.length, BATCH_PROFILE_IMAGE_CONCURRENCY)} luồng` }));
      await forEachConcurrent(targets, BATCH_PROFILE_IMAGE_CONCURRENCY, async (profile) => {
        try {
          const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/${kind}/${encodeURIComponent(profile.id)}/image`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mediaGeneration: batchMediaSettings }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload.ok) throw new Error(payload.message || "Không tạo được ảnh.");
          createdCount += 1;
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : "Không tạo được ảnh.";
          failures.push(`${profile.name}: ${reason}`);
        } finally {
          finishedCount += 1;
          setProfileBatchProgress((current) => ({ ...current, [kind]: `${finishedCount}/${targets.length} · tối đa ${Math.min(targets.length, BATCH_PROFILE_IMAGE_CONCURRENCY)} luồng` }));
        }
      });
      await refresh();
      const label = kind === "characters" ? "nhân vật" : "bối cảnh";
      setRunMessage(failures.length
        ? { tone: "error", text: `Đã tạo ${createdCount}/${targets.length} ảnh ${label}. ${failures.join(" · ")}` }
        : { tone: "success", text: `Đã tạo ${createdCount} ảnh ${label} còn thiếu.` });
    } catch (cause) {
      setRunMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Không hoàn tất được lượt tạo ảnh hàng loạt." });
    } finally {
      setProfileBatchKinds((current) => {
        const next = new Set(current);
        next.delete(kind);
        return next;
      });
      setProfileBatchProgress((current) => ({ ...current, [kind]: "" }));
    }
  }

  function chooseDramaUpload(kind: "characters" | "locations", name: string, imagePrompt: string, description: string) {
    if (!project || profileBusyId || profileBatchKinds.size > 0) return;
    const input = document.createElement("input"); input.type = "file"; input.accept = "image/png,image/jpeg,image/webp";
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      setProfileBusyId(name);
      try {
        const form = new FormData(); form.set("name", name); form.set("description", description); form.set("imagePrompt", imagePrompt); form.set("file", file);
        const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/${kind}`, { method: "POST", body: form });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.message || "Không tải được ảnh lên.");
        await refresh(); setRunMessage({ tone: "success", text: "Đã lưu ảnh tham chiếu vào project." });
      } catch (cause) { setRunMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Không tải được ảnh lên." }); }
      finally { setProfileBusyId(""); }
    };
    input.click();
  }

  function chooseDramaSceneUpload(scene: ScenePreview, videoOnly = false) {
    if (!project) return;
    const input = document.createElement("input"); input.type = "file"; input.accept = videoOnly ? "video/mp4,.mp4" : "image/png,image/jpeg,image/webp,video/mp4";
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      if (videoOnly && !/\.mp4$/i.test(file.name) && file.type !== "video/mp4") {
        setRunMessage({ tone: "error", text: "Chọn tệp video MP4 để tải lên cảnh." });
        return;
      }
      if (file.size > MAX_SCENE_MEDIA_UPLOAD_BYTES) {
        setRunMessage({ tone: "error", text: videoOnly ? "Video tải lên không được vượt quá 250 MB." : "Ảnh hoặc video tải lên không được vượt quá 250 MB." });
        return;
      }
      setGeneratingSceneId(scene.id);
      try {
        const endpoint = `/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(scene.id)}/media`;
        if (shouldChunkSceneMediaFile(file)) {
          setSceneUploadProgress({ sceneId: scene.id, text: "Đang chuẩn bị upload…" });
          await uploadSceneMediaInChunks({
            endpoint: `${endpoint}/upload`,
            file,
            onProgress: ({ stage, uploadedBytes, totalBytes, chunkIndex, chunkCount }) => {
              setSceneUploadProgress({
                sceneId: scene.id,
                text: stage === "assembling"
                  ? "Đang ghép file…"
                  : `Upload ${chunkIndex}/${chunkCount} · ${Math.round((uploadedBytes / Math.max(1, totalBytes)) * 100)}%`,
              });
            },
          });
        } else {
          const form = new FormData(); form.set("file", file);
          const response = await fetch(endpoint, { method: "POST", body: form });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload.ok) throw new Error(payload.message || (videoOnly ? "Không tải được video lên." : "Không tải được media lên."));
        }
        await loadScenes(); setRunMessage({ tone: "success", text: videoOnly ? `Đã tải video cho ${sceneNumberLabel(scene)}.` : `Đã tải media cho ${sceneNumberLabel(scene)}.` });
      } catch (cause) { setRunMessage({ tone: "error", text: cause instanceof Error ? cause.message : videoOnly ? "Không tải được video lên." : "Không tải được media lên." }); }
      finally { setGeneratingSceneId(""); setSceneUploadProgress(null); }
    };
    input.click();
  }

  async function saveSceneReview(status: SceneReviewStatus = selectedScene ? sceneReviewStatus(selectedScene) : "unreviewed") {
    if (!project?.slug || !selectedScene) return;
    if (selectedAiReview.status === "pending") {
      setRunMessage({ tone: "error", text: "Cảnh này chưa được AI pre-check. Hãy chạy AI pre-check trước khi duyệt." });
      return;
    }
    setReviewSaving(true);
    setSceneError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(selectedScene.id)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: sceneReviewNote }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể lưu đánh giá cảnh.");
      const updatedScene = payload.scene as ScenePreview;
      setScenes((current) => current.map((item) => item.id === updatedScene.id ? { ...item, ...updatedScene } : item));
      await refresh();
      setRunMessage({ tone: "success", text: `${sceneNumberLabel(selectedScene)} · ${sceneReviewLabel(status)} đã được lưu.` });
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Không thể lưu đánh giá cảnh.");
    } finally {
      setReviewSaving(false);
    }
  }

  async function saveSceneTtsVoice(voiceId: string) {
    if (!project?.slug || !selectedScene || ttsRunning) return;
    const voice = voiceCatalog?.voices.find((item) => item.id === voiceId);
    if (!voice) return;
    setSceneTtsSaving(true);
    setSceneError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(selectedScene.id)}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId: voice.id, voiceName: voice.name, voiceLanguage: voice.language }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể lưu voice cho cảnh.");
      const updatedScene = payload.scene as ScenePreview;
      setScenes((current) => current.map((item) => item.id === updatedScene.id ? { ...item, ...updatedScene } : item));
      await refresh();
      setRunMessage({ tone: "success", text: `${sceneNumberLabel(selectedScene)} · đã chọn voice ${voice.name}.` });
    } catch (cause) {
      setSceneError(cause instanceof Error ? cause.message : "Không thể lưu voice cho cảnh.");
    } finally {
      setSceneTtsSaving(false);
    }
  }

  async function generateSceneTts(scene: ScenePreview, force = false, targetLanguage = "", batchMode = false): Promise<{ ok: boolean; failed: number; message: string }> {
    if (!project?.slug || ttsRunning || renderRunning || scriptBlocksIndependentTasks || batchMediaBusy || videoQueueRunning || generatingSceneId || dialogueTranslationSceneId || dialogueTranslationBatchProgress || (dialogueTtsBatchProgress && !batchMode)) return { ok: false, failed: 0, message: "Đang có tác vụ voice khác chạy." };
    const usesDialogueTimeline = project.presetId === "ai-drama";
    const dialogueSegments = usesDialogueTimeline ? sceneDialogueSegments(scene, project.characters || []) : [];
    const speaker = !usesDialogueTimeline
      ? undefined
      : project.characters?.find((character) => character.id === sceneSpeakerCharacterId(scene, project.characters || []));
    const voiceId = String(speaker?.voiceId || scene.ttsVoiceId || scene.tts_voice_id || project.voiceId || "");
    const voice = voiceCatalog?.voices.find((item) => item.id === voiceId) || (voiceId ? {
      id: voiceId,
      name: String(speaker?.voiceName || scene.ttsVoiceName || scene.tts_voice_name || project.voiceName || voiceId),
      language: String(speaker?.voiceLanguage || scene.ttsVoiceLanguage || scene.tts_voice_language || project.voiceLanguage || project.language),
    } : undefined);
    if (!usesDialogueTimeline && !voice) {
      setSceneError("Chọn một voice khả dụng cho cảnh này trước khi tạo TTS.");
      return { ok: false, failed: 0, message: "Chọn một voice khả dụng cho cảnh này trước khi tạo TTS." };
    }
    if (usesDialogueTimeline) {
      if (!dialogueSegments.length) {
        setSceneError("Cảnh này chưa có câu thoại. Thêm câu hoặc nạp SRT vào timeline trước.");
        return { ok: false, failed: 0, message: "Cảnh này chưa có câu thoại." };
      }
      if (targetLanguage && dialogueSegments.some((segment) => !segment.translations?.[targetLanguage]?.trim())) {
        const message = `Dịch lời thoại của ${sceneNumberLabel(scene)} sang ${voiceLanguageLabel(targetLanguage)} trước khi tạo voice.`;
        setSceneError(message);
        return { ok: false, failed: 0, message };
      }
      const missingVoice = dialogueSegments.find((segment) => {
        const lineSpeaker = project.characters?.find((character) => character.id === segment.speakerCharacterId);
        return !(lineSpeaker?.voiceId || scene.ttsVoiceId || scene.tts_voice_id || project.voiceId);
      });
      if (missingVoice) {
        const message = "Chọn voice cho từng nhân vật hoặc đặt voice mặc định của project trước khi tạo TTS.";
        setSceneError(message);
        return { ok: false, failed: 0, message };
      }
    } else if (!sceneText(scene, "dialogue_or_voiceover", "voiceText", "voiceover")) {
      setSceneError("Cảnh này chưa có lời thoại/lời đọc để tạo TTS.");
      return { ok: false, failed: 0, message: "Cảnh này chưa có lời thoại/lời đọc để tạo TTS." };
    }
    setTtsRunning(true);
    setTtsChunkId(scene.chunkId);
    setTtsSceneId(scene.id);
    setSceneError("");
    setRunMessage(null);
    try {
      if (usesDialogueTimeline) {
        const saved = await saveDialogueSegments(scene, !batchMode);
        if (!saved) throw new Error("Không thể lưu timeline lời thoại.");
      }
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(scene.id)}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(usesDialogueTimeline
          ? { generate: true, force, ...(targetLanguage ? { targetLanguage } : {}) }
          : { voiceId: voice?.id, voiceName: voice?.name, voiceLanguage: voice?.language, generate: true, force }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || `Không tạo được TTS cho ${sceneNumberLabel(scene)}.`);
      if (batchMode) {
        const updatedScene = payload.scene as ScenePreview;
        setScenes((current) => current.map((item) => item.id === updatedScene.id ? { ...item, ...updatedScene } : item));
      } else {
        await refresh();
        await loadScenes();
      }
      const failedSegments = Number(payload.failed) || 0;
      const message = failedSegments
        ? `TTS ${sceneNumberLabel(scene)}: ${payload.completed || 0}/${payload.total || dialogueSegments.length} câu sẵn sàng, ${failedSegments} câu lỗi.${payload.message ? ` ${payload.message}` : ""}`
        : payload.unchanged
          ? `${sceneNumberLabel(scene)} đã có đủ voice${targetLanguage ? ` ${voiceLanguageLabel(targetLanguage)}` : ""} cho các câu thoại.`
          : usesDialogueTimeline
            ? `Đã tạo ${payload.completed || 0}/${payload.total || dialogueSegments.length} voice${targetLanguage ? ` ${voiceLanguageLabel(targetLanguage)}` : ""} cho ${sceneNumberLabel(scene)}.`
            : `Đã tạo voice cho ${sceneNumberLabel(scene)} bằng ${voice?.name || "OmniVoice"}.`;
      setRunMessage({ tone: failedSegments ? "error" : "success", text: message });
      return { ok: failedSegments === 0, failed: failedSegments, message };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Không tạo được TTS cho cảnh.";
      setSceneError(message);
      setRunMessage({ tone: "error", text: message });
      if (!batchMode) await refresh().catch(() => undefined);
      return { ok: false, failed: 1, message };
    } finally {
      setTtsChunkId("");
      setTtsSceneId("");
      setTtsRunning(false);
    }
  }

  function dialogueTtsVoiceTargetsForScenes(candidateScenes: ScenePreview[], targetLanguage: string) {
    if (!project || project.presetId !== "ai-drama") return [] as ScenePreview[];
    return candidateScenes.filter((scene) => {
      const segments = sceneDialogueSegments(scene, characterProfiles);
      if (!segments.length || segments.some((segment) => !segment.translations?.[targetLanguage]?.trim())) return false;
      let hasMissingVoice = false;
      let hasMissingAudio = false;
      for (const segment of segments) {
        const speaker = characterProfiles.find((character) => character.id === segment.speakerCharacterId);
        const voiceId = String(speaker?.voiceId || scene.ttsVoiceId || scene.tts_voice_id || project.voiceId || "");
        if (!voiceId) {
          hasMissingVoice = true;
          continue;
        }
        const audio = segment.translatedAudio?.[targetLanguage];
        if (!audio?.localPath || audio.voiceId !== voiceId || audio.language !== targetLanguage) hasMissingAudio = true;
      }
      return !hasMissingVoice && hasMissingAudio;
    });
  }

  async function generateFilteredDialogueTts(chunkId?: string, episodeNumber?: number) {
    if (!project?.slug || project.presetId !== "ai-drama" || dialogueTtsBatchProgress || ttsRunning || renderRunning || dialogueTranslationSceneId || dialogueTranslationBatchProgress || dialogueSavingSceneId || isRunning || runningScriptChunkId || generatingSceneId || batchMediaBusy || videoQueueRunning) return;
    const candidateScenes = chunkId ? scenes.filter((scene) => scene.chunkId === chunkId) : filteredScenes;
    const targets = chunkId ? dialogueTtsVoiceTargetsForScenes(candidateScenes, dialogueTranslationLanguage) : filteredDialogueTtsVoiceTargets;
    if (!targets.length) {
      const needsTranslation = candidateScenes.some((scene) => {
        const segments = sceneDialogueSegments(scene, characterProfiles);
        return segments.length > 0 && segments.some((segment) => !segment.translations?.[dialogueTranslationLanguage]?.trim());
      });
      const missingVoice = candidateScenes.some((scene) => {
        const segments = sceneDialogueSegments(scene, characterProfiles);
        if (!segments.length || segments.some((segment) => !segment.translations?.[dialogueTranslationLanguage]?.trim())) return false;
        return segments.some((segment) => {
          const speaker = characterProfiles.find((character) => character.id === segment.speakerCharacterId);
          return !(speaker?.voiceId || scene.ttsVoiceId || scene.tts_voice_id || project.voiceId);
        });
      });
      const message = needsTranslation
        ? `Dịch thoại sang ${voiceLanguageLabel(dialogueTranslationLanguage)} trước khi tạo voice.`
        : missingVoice
          ? "Gán voice cho nhân vật đang thoại trước khi tạo voice hàng loạt."
          : `Các cảnh${episodeNumber ? ` trong Tập ${String(episodeNumber).padStart(2, "0")}` : " trong phạm vi hiện tại"} đã có voice ${voiceLanguageLabel(dialogueTranslationLanguage)} hoặc chưa có lời thoại.`;
      setRunMessage({ tone: "error", text: message });
      return;
    }

    setDialogueTtsBatchProgress(`0/${targets.length}`);
    setSceneError("");
    setRunMessage(null);
    const completed: string[] = [];
    const failed: string[] = [];
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const scene = targets[index];
        setDialogueTtsBatchProgress(`${index + 1}/${targets.length}${episodeNumber ? ` · Tập ${String(episodeNumber).padStart(2, "0")}` : ""} · ${sceneNumberLabel(scene)}`);
        const result = await generateSceneTts(scene, false, dialogueTranslationLanguage, true);
        if (result.ok) completed.push(sceneNumberLabel(scene));
        else failed.push(`${sceneNumberLabel(scene)}: ${result.message || "không tạo được voice"}`);
      }
      await refresh().catch(() => undefined);
      await loadScenes().catch(() => undefined);
      setRunMessage({
        tone: failed.length ? "error" : "success",
        text: failed.length
          ? `Đã tạo voice ${voiceLanguageLabel(dialogueTranslationLanguage)} cho ${completed.length}/${targets.length} cảnh${episodeNumber ? ` của Tập ${String(episodeNumber).padStart(2, "0")}` : ""}. Lỗi: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? `; và ${failed.length - 3} lỗi khác` : ""}`
          : `Đã tạo voice ${voiceLanguageLabel(dialogueTranslationLanguage)} cho ${completed.length} cảnh${episodeNumber ? ` của Tập ${String(episodeNumber).padStart(2, "0")}` : ""}.`,
      });
    } catch (cause) {
      setRunMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Không thể tạo voice hàng loạt." });
    } finally {
      setDialogueTtsBatchProgress("");
      setTtsChunkId("");
      setTtsSceneId("");
      setTtsRunning(false);
    }
  }

  async function generateSelectedSceneTts(force = false) {
    if (!selectedScene) return;
    await generateSceneTts(selectedScene, force);
  }

  const projectActivities = activities.filter((activity) => activity.projectSlug === project.slug).slice(0, 4);
  const selectedScene = filteredScenes.find((scene) => scene.id === selectedSceneId) || filteredScenes[0];
  const sceneImagePreviewUrl = sceneImagePreview?.referenceImagePreviewUrl
    || (sceneImagePreview?.media?.kind === "image" ? sceneImagePreview.previewUrl : "");
  const selectedMedia = selectedScene?.media;
  const selectedReferenceImage = sceneReferenceMedia(selectedScene);
  const selectedSceneLocationId = sceneLocationId(selectedScene);
  const selectedSceneLocation = project.locations?.find((location) => location.id === selectedSceneLocationId);
  const selectedReferenceImageUrl = selectedScene?.referenceImagePreviewUrl
    || (selectedScene?.media?.kind === "image" ? selectedScene.previewUrl : "");
  const selectedSceneMediaSettings = mediaSettingsForScene(selectedScene, project);
  const hasSceneMediaOverride = Boolean(selectedScene?.mediaGeneration || selectedScene?.media_generation);
  const availableImageModels = filterAvailableImageModels(mediaCatalog?.imageModels || []);
  const imageModelOptions: ImageGenerationModelOption[] = availableImageModels.some((item) => item.id === selectedSceneMediaSettings.imageModel)
    ? availableImageModels
    : [{ id: selectedSceneMediaSettings.imageModel, label: `${selectedSceneMediaSettings.imageModel} · đang dùng`, qualities: [selectedSceneMediaSettings.imageQuality] }, ...availableImageModels];
  const selectedImageModel = imageModelOptions.find((item) => item.id === selectedSceneMediaSettings.imageModel);
  const imageQualities = selectedImageModel?.qualities.length ? selectedImageModel.qualities : [selectedSceneMediaSettings.imageQuality];
  const selectedImageDetailLevels = imageDetailLevelsForModel(selectedImageModel);
  const allVideoModels = mediaCatalog?.videoModels || [];
  function videoGenerationSettingsForScene(scene: ScenePreview): MediaGenerationSettings {
    const currentSettings = mediaSettingsForScene(scene, project);
    const selectedVideoModel = allVideoModels.find((item) => item.id === batchMediaSettings.videoModel && (item.provider || "maivideo") === batchMediaSettings.videoProvider);
    return {
      ...currentSettings,
      videoProvider: batchMediaSettings.videoProvider,
      seedanceAccountId: batchMediaSettings.seedanceAccountId || "",
      videoModel: batchMediaSettings.videoModel,
      videoQuality: isPixverseVideoModel(batchMediaSettings.videoModel)
        ? "1080p"
        : selectedVideoModel?.qualities.length && !selectedVideoModel.qualities.includes(batchMediaSettings.videoQuality)
          ? selectedVideoModel.qualities[0]
          : batchMediaSettings.videoQuality,
      videoDurationMode: batchMediaSettings.videoDurationMode,
      videoDurationSec: normalizeVideoDuration(
        batchMediaSettings.videoDurationMode === "scene" ? Math.ceil(sceneDurationSeconds(scene, project.sceneDurationSec)) : batchMediaSettings.videoDurationSec,
        selectedVideoModel,
        isPixverseVideoModel(batchMediaSettings.videoModel) ? "1080p" : batchMediaSettings.videoQuality,
      ),
      videoMultiShot: selectedVideoModel?.supportsMultiShot === false ? false : batchMediaSettings.videoMultiShot,
      videoAudio: selectedVideoModel?.supportsAudio === false ? false : batchMediaSettings.videoAudio,
      videoOffPeak: isVideoOffPeakRequired(batchMediaSettings.videoModel, selectedVideoModel?.label) ? true : selectedVideoModel?.supportsOffPeak === false ? false : batchMediaSettings.videoOffPeak,
      videoUseCharacterReferences: batchMediaSettings.videoUseCharacterReferences,
      videoUseLocationReferences: batchMediaSettings.videoUseLocationReferences,
      videoUseSceneImageReference: batchMediaSettings.videoUseSceneImageReference,
    };
  }
  const availableVideoModels = allVideoModels.filter((item) => (item.provider || "maivideo") === selectedSceneMediaSettings.videoProvider);
  const videoModelOptions: VideoGenerationModelOption[] = availableVideoModels.some((item) => item.id === selectedSceneMediaSettings.videoModel)
    ? availableVideoModels
    : [{ id: selectedSceneMediaSettings.videoModel, label: `${selectedSceneMediaSettings.videoModel} · đang dùng`, provider: selectedSceneMediaSettings.videoProvider, qualities: [selectedSceneMediaSettings.videoQuality], minDurationSec: 1, maxDurationSec: 15 }, ...availableVideoModels];
  const selectedVideoModel = videoModelOptions.find((item) => item.id === selectedSceneMediaSettings.videoModel);
  const videoQualities = videoQualitiesForModel(selectedVideoModel, selectedSceneMediaSettings.videoQuality);
  const sceneVideoMaxDuration = sceneVideoDurationLimit(selectedVideoModel, selectedSceneMediaSettings.videoQuality);
  const batchImageModelOptions: ImageGenerationModelOption[] = availableImageModels.some((item) => item.id === batchMediaSettings.imageModel)
    ? availableImageModels
    : [{ id: batchMediaSettings.imageModel, label: `${batchMediaSettings.imageModel} · đang dùng`, qualities: [batchMediaSettings.imageQuality] }, ...availableImageModels];
  const selectedBatchImageModel = batchImageModelOptions.find((item) => item.id === batchMediaSettings.imageModel);
  const batchImageQualities = selectedBatchImageModel?.qualities.length ? selectedBatchImageModel.qualities : [batchMediaSettings.imageQuality];
  const batchImageDetailLevels = imageDetailLevelsForModel(selectedBatchImageModel);
  const batchAvailableVideoModels = allVideoModels.filter((item) => (item.provider || "maivideo") === batchMediaSettings.videoProvider);
  const batchVideoModelOptions: VideoGenerationModelOption[] = batchAvailableVideoModels.some((item) => item.id === batchMediaSettings.videoModel)
    ? batchAvailableVideoModels
    : [{ id: batchMediaSettings.videoModel, label: `${batchMediaSettings.videoModel} · đang dùng`, provider: batchMediaSettings.videoProvider, qualities: [batchMediaSettings.videoQuality], minDurationSec: 1, maxDurationSec: 15 }, ...batchAvailableVideoModels];
  const selectedBatchVideoModel = batchVideoModelOptions.find((item) => item.id === batchMediaSettings.videoModel);
  const batchVideoQualities = videoQualitiesForModel(selectedBatchVideoModel, batchMediaSettings.videoQuality);
  const batchVideoMaxDuration = sceneVideoDurationLimit(selectedBatchVideoModel, batchMediaSettings.videoQuality);
  const sceneVideoDurationChoices = videoDurationOptions(selectedVideoModel, selectedSceneMediaSettings.videoQuality);
  const batchVideoDurationChoices = videoDurationOptions(selectedBatchVideoModel, batchMediaSettings.videoQuality);
  const sceneSeedanceSelected = selectedSceneMediaSettings.videoProvider === "seedance" || Boolean(selectedVideoModel?.supportedDurationsSec?.length);
  const batchSeedanceSelected = batchMediaSettings.videoProvider === "seedance" || Boolean(selectedBatchVideoModel?.supportedDurationsSec?.length);
  const sceneVideoOffPeakRequired = selectedSceneMediaSettings.videoProvider === "maivideo" && isVideoOffPeakRequired(selectedVideoModel?.id, selectedVideoModel?.label);
  const batchVideoOffPeakRequired = batchMediaSettings.videoProvider === "maivideo" && isVideoOffPeakRequired(selectedBatchVideoModel?.id, selectedBatchVideoModel?.label);
  const filteredImageTargets = (batchRegenerateImages ? filteredScenes : filteredScenes.filter((scene) => sceneNeedsImage(scene, project))).filter((scene) => !sceneHasActiveMediaJob(scene));
  const filteredVideoTargets = (batchRegenerateVideos ? filteredScenes : filteredScenes.filter(sceneNeedsAiVideo)).filter((scene) => !sceneHasActiveMediaJob(scene));
  const activeSceneMediaJobCount = scenes.filter(sceneHasActiveMediaJob).length;
  const batchOverLimitCount = batchMediaSettings.videoDurationMode === "scene"
    ? filteredScenes.filter((scene) => Math.ceil(sceneDurationSeconds(scene, project.sceneDurationSec)) > batchVideoMaxDuration).length
    : 0;
  const selectedSceneDuration = selectedScene ? sceneDurationSeconds(selectedScene, project.sceneDurationSec) : 0;
  const selectedSceneMediaJobActive = Boolean(selectedScene && sceneHasActiveMediaJob(selectedScene));
  const selectedSceneRequestedVideoDuration = selectedSceneMediaSettings.videoDurationMode === "scene"
    ? normalizeVideoDuration(Math.ceil(selectedSceneDuration), selectedVideoModel, selectedSceneMediaSettings.videoQuality)
    : normalizeVideoDuration(selectedSceneMediaSettings.videoDurationSec, selectedVideoModel, selectedSceneMediaSettings.videoQuality);
  const selectedVoice = selectedScene ? sceneText(selectedScene, "dialogue_or_voiceover", "voiceText", "voiceover") : "";
  const selectedPrompt = selectedScene ? sceneText(selectedScene, "video_prompt", "videoPrompt", "image_prompt", "imagePrompt") : "";
  const selectedReviewStatus = selectedScene ? sceneReviewStatus(selectedScene) : "unreviewed";
  const selectedAiReview = selectedScene ? sceneAiReview(selectedScene) : {
    status: "pending" as SceneAiReviewStatus,
    score: 0,
    summary: "AI chưa đánh giá cảnh này.",
    issues: [],
    checks: {},
  };
  const selectedFilteredIndex = selectedScene ? filteredScenes.findIndex((scene) => scene.id === selectedScene.id) : -1;
  const selectedCharacterIds = selectedScene ? sceneCharacterIds(selectedScene) : [];
  const characterProfiles = project.characters || [];
  const characterProfilesMissingImage = characterProfiles.filter((character) => !character.referenceImagePath);
  const characterProfileImageBusy = characterProfiles.some((character) => profileImageBusyIds.has(`characters:${character.id}`));
  const locationNamesInScript = [...new Set(scenes.map(sceneLocationName).filter(Boolean))];
  const registeredLocationNames = new Set((project.locations || []).flatMap((location) => [location.name, ...(location.aliases || [])]).map(normalizeEntityName));
  const missingScriptLocationCount = locationNamesInScript.filter((name) => !registeredLocationNames.has(normalizeEntityName(name))).length;
  const scriptCharacterNames = [...new Set(scenes.flatMap(sceneScriptCharacterNames))];
  const registeredCharacterNames = new Set(characterProfiles.map((character) => normalizeEntityName(character.name)));
  const missingScriptCharacterCount = scriptCharacterNames.filter((name) => !registeredCharacterNames.has(normalizeEntityName(name))).length;
  const filteredScenesNeedingDialogueTimeline = project.presetId === "ai-drama" ? filteredScenes.filter(sceneNeedsDialogueExtraction) : [];
  const dialogueScenesWithoutTimeline = project.presetId === "ai-drama" ? filteredScenes.filter(sceneNeedsDialogueExtraction) : [];
  const dialogueScenesNeedingTranslation = project.presetId === "ai-drama" ? filteredScenes.filter((scene) => {
    const segments = sceneDialogueSegments(scene, characterProfiles);
    return segments.length > 0 && segments.some((segment) => !segment.translations?.[dialogueTranslationLanguage]?.trim());
  }) : [];
  const filteredDialogueScenesNeedingTranslation = project.presetId === "ai-drama" ? filteredScenes.filter((scene) => {
    const segments = sceneDialogueSegments(scene, characterProfiles);
    return segments.length > 0 && segments.some((segment) => !segment.translations?.[dialogueTranslationLanguage]?.trim());
  }) : [];
  const filteredDialogueScenesMissingVoice = project.presetId === "ai-drama" ? filteredScenes.filter((scene) => {
    const segments = sceneDialogueSegments(scene, characterProfiles);
    if (!segments.length || segments.some((segment) => !segment.translations?.[dialogueTranslationLanguage]?.trim())) return false;
    return segments.some((segment) => {
      const speaker = characterProfiles.find((character) => character.id === segment.speakerCharacterId);
      return !(speaker?.voiceId || scene.ttsVoiceId || scene.tts_voice_id || project.voiceId);
    });
  }) : [];
  const filteredDialogueTtsVoiceTargets = dialogueTtsVoiceTargetsForScenes(filteredScenes, dialogueTranslationLanguage);
  const selectedSceneDialogueSegments = selectedScene && project.presetId === "ai-drama" ? sceneDialogueSegments(selectedScene, characterProfiles) : [];
  const selectedSceneDialogueReadyCount = selectedSceneDialogueSegments.filter((segment) => Boolean(segment.audio?.localPath)).length;
  const selectedSceneDialogueMissingVoice = selectedSceneDialogueSegments.some((segment) => {
    const speaker = characterProfiles.find((character) => character.id === segment.speakerCharacterId);
    return !(speaker?.voiceId || selectedScene?.ttsVoiceId || selectedScene?.tts_voice_id || project.voiceId);
  });
  const selectedSceneSpeakerId = sceneSpeakerCharacterId(selectedScene, characterProfiles);
  const selectedSceneSpeaker = characterProfiles.find((character) => character.id === selectedSceneSpeakerId);
  const selectedSceneAudio = sceneAudioRecord(selectedScene);
  const selectedSceneVoiceId = String((project.presetId === "ai-drama" ? selectedSceneSpeaker?.voiceId : "") || selectedScene?.ttsVoiceId || selectedScene?.tts_voice_id || project.voiceId || "");
  const allProjectVoices = voiceCatalog?.voices || [];
  const selectedSceneVoice: OmniVoiceOption | undefined = voiceCatalog?.voices.find((voice) => voice.id === selectedSceneVoiceId) || (selectedSceneVoiceId ? {
    id: selectedSceneVoiceId,
    name: String((project.presetId === "ai-drama" ? selectedSceneSpeaker?.voiceName : "") || selectedScene?.ttsVoiceName || selectedScene?.tts_voice_name || project.voiceName || selectedSceneVoiceId),
    language: String((project.presetId === "ai-drama" ? selectedSceneSpeaker?.voiceLanguage : "") || selectedScene?.ttsVoiceLanguage || selectedScene?.tts_voice_language || project.voiceLanguage || project.language),
  } : undefined);
  const visibleSceneVoices = selectedSceneVoice && !allProjectVoices.some((voice) => voice.id === selectedSceneVoice.id)
    ? [selectedSceneVoice, ...allProjectVoices]
    : allProjectVoices;
  const selectedSceneAudioUrl = selectedSceneAudio.localPath && selectedScene
    ? `/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(selectedScene.id)}/tts`
    : "";
  const locationProfiles = project.locations || [];
  const locationProfilesMissingImage = locationProfiles.filter((location) => !location.referenceImagePath);
  const locationProfileImageBusy = locationProfiles.some((location) => profileImageBusyIds.has(`locations:${location.id}`));
  useEffect(() => {
    if (!project?.slug || project.presetId !== "ai-drama" || !scenes.length) return;
    if (dramaSceneAssignmentAttempted.current === project.slug) return;
    dramaSceneAssignmentAttempted.current = project.slug;
    void autoAssignGeneratedSceneReferences({ scenes })
      .then(async (result) => {
        if (result?.changedReferenceScenes) await loadScenes();
      })
      .catch(() => undefined);
  }, [project?.slug, project?.presetId, scenes.length, loadScenes]);
  useEffect(() => {
    if (!project?.slug || project.presetId !== "ai-drama" || !project.chunks.some((chunk) => chunk.outputPath)) return;
    const outputSignature = project.chunks
      .filter((chunk) => chunk.outputPath)
      .map((chunk) => `${chunk.id}:${chunk.updatedAt}:${chunk.outputPath}`)
      .join("|");
    const attemptKey = `${project.slug}:${outputSignature}`;
    if (dramaReferenceSyncAttempted.current === attemptKey) return;
    if (locationProfiles.length > 0 && missingScriptCharacterCount === 0 && missingScriptLocationCount === 0 && characterProfiles.every((character) => character.imagePrompt)) return;
    dramaReferenceSyncAttempted.current = attemptKey;
    void fetch(`/api/projects/${encodeURIComponent(project.slug)}/characters/sync`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok) return;
        await refresh();
        await loadScenes();
      })
      .catch(() => undefined);
  }, [project?.slug, project?.presetId, project?.chunks, locationProfiles.length, missingScriptCharacterCount, missingScriptLocationCount, characterProfiles, refresh, loadScenes]);
  const characterMediaImages = scenes.filter((scene) => scene.media?.kind === "image" && scene.media.status === "ready" && scene.previewUrl);
  const selectedCharacterMediaScene = characterMediaImages.find((scene) => scene.id === selectedCharacterMediaSceneId);
  const selectedMaiVideoImage = maiVideoLibraryImages.find((image) => image.id === selectedMaiVideoImageId);
  const selectedLocationMaiVideoImage = maiVideoLibraryImages.find((image) => image.id === selectedLocationMaiVideoImageId);
  const videoQueue = project.videoQueue;
  const videoQueueSummary = videoQueue?.jobs.reduce((summary, job) => {
    summary[job.status] += 1;
    return summary;
  }, { queued: 0, running: 0, completed: 0, failed: 0, paused: 0 }) || { queued: 0, running: 0, completed: 0, failed: 0, paused: 0 };
  const failedVideoJobs = videoQueue?.jobs.filter((job) => job.status === "failed") || [];
  const videoQueueCanRun = videoQueueSummary.queued > 0 || (videoQueue?.status === "running" && !videoQueueRunning);

  useEffect(() => {
    const resumeInterruptedQueue = () => {
      if (!project?.slug || videoQueue?.status !== "running" || !videoQueueSummary.queued || videoQueueRunning
        || scriptBlocksIndependentTasks || ttsRunning || batchMediaBusy || generatingSceneId) return;
      const lastAttempt = autoResumeVideoQueueAtRef.current[project.slug] || 0;
      if (Date.now() - lastAttempt < 15_000) return;
      autoResumeVideoQueueAtRef.current[project.slug] = Date.now();
      void runVideoQueue();
    };
    resumeInterruptedQueue();
    const timer = window.setInterval(resumeInterruptedQueue, 15_000);
    return () => window.clearInterval(timer);
  }, [project?.slug, videoQueue?.status, videoQueueSummary.queued, videoQueueRunning, scriptBlocksIndependentTasks, ttsRunning, batchMediaBusy, generatingSceneId]);

  const continuityQa = project.continuityQa;
  const mediaGeneration = { ...DEFAULT_MEDIA_GENERATION_SETTINGS, ...project.mediaGeneration };
  const projectImageDetailLevels = imageDetailLevelsForModel(mediaCatalog?.imageModels.find((item) => item.id === mediaGeneration.imageModel));
  const hasEpisodeScripts = project.chunks.some((chunk) => Boolean(chunk.outputPath));
  const allEpisodeScriptsReady = project.chunks.length > 0 && project.chunks.every((chunk) => Boolean(chunk.outputPath));
  const selectedPublishingPackage: VideoPublishingSet | undefined = publishingScope === "series"
    ? project.publishingPackage?.series
    : project.publishingPackage?.episodes?.[publishingScope];
  const publishingTargetReady = publishingScope === "series"
    ? allEpisodeScriptsReady
    : Boolean(project.chunks.find((chunk) => chunk.id === publishingScope)?.outputPath);

  function moveSelectedScene(direction: -1 | 1) {
    const nextScene = filteredScenes[selectedFilteredIndex + direction];
    if (nextScene) setSelectedSceneId(nextScene.id);
  }

  function usesAiDramaWorkflow() {
    return project.presetId === "ai-drama";
  }

  function openProjectSection(sectionId: string) {
    window.setTimeout(() => {
      const target = document.getElementById(sectionId);
      if (target instanceof HTMLDetailsElement) target.open = true;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  function renderDramaSceneReferencePicker(scene: ScenePreview, mediaLabel: "ảnh" | "video") {
    const referenceKind: SceneReferenceKind = mediaLabel === "ảnh" ? "image" : "video";
    const selectedIds = sceneReferenceCharacterIds(scene, referenceKind);
    const selectedLocationId = sceneReferenceLocationId(scene, referenceKind);
    const sceneMediaSettings = mediaSettingsForScene(scene, project);
    const sceneImage = sceneReferenceMedia(scene);
    const sceneImageSelected = mediaLabel === "video" && sceneMediaSettings.videoUseSceneImageReference;
    const expectedImageCharacterIds = sceneMediaSettings.imageUseCharacterReferences ? sceneReferenceCharacterIds(scene, "image") : [];
    const savedImageCharacterIds = sceneImage?.referenceCharacterIds || [];
    const sceneImageIsCurrent = sceneImage?.status === "ready"
      && !sceneImage.stale
      && (sceneImage.provider === "upload" || (
        String(sceneImage.provider || "").startsWith("maivideo-image")
        && [...savedImageCharacterIds].sort().join("|") === [...expectedImageCharacterIds].sort().join("|")
        && String(sceneImage.referenceLocationId || "") === sceneReferenceLocationId(scene, "image")
      ));
    const selectedNames = [
      ...(sceneImageSelected
        ? [sceneImageIsCurrent ? "Ảnh cảnh chính" : sceneImage?.status === "ready" ? "Ảnh cảnh chính · ảnh cũ" : "Ảnh cảnh chính · chưa có ảnh"]
        : mediaLabel === "video" && sceneImage?.status === "ready" ? ["Ảnh cảnh · không gửi video"] : []),
      ...selectedIds.map((id) => characterProfiles.find((character) => character.id === id)?.name).filter(Boolean),
      locationProfiles.find((location) => location.id === selectedLocationId)?.name,
    ].filter(Boolean);
    return <details className="ai-drama-row-reference-picker" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <summary aria-label={`Chọn ảnh tham chiếu cho tạo ${mediaLabel} ${sceneNumberLabel(scene)}`}>
        <span>Ảnh tham chiếu · {mediaLabel}</span>
        <strong title={selectedNames.join(", ")}>{selectedNames.join(", ") || "Chọn tên nhân vật / bối cảnh"}</strong>
      </summary>
      <div className="ai-drama-row-reference-options">
        {mediaLabel === "video" && <fieldset className="ai-drama-scene-reference-option">
          <legend>Ảnh chính cho video</legend>
          <label>
            <input type="checkbox" aria-label={`Dùng ảnh cảnh làm tham chiếu video ${sceneNumberLabel(scene)}`} checked={sceneMediaSettings.videoUseSceneImageReference} disabled={sceneMediaSettingsSaving || Boolean(generatingSceneId) || sceneHasActiveMediaJob(scene) || batchMediaBusy || videoQueueRunning} onChange={(event) => updateDramaSceneImageReference(scene, event.target.checked)} />
            <span>Dùng ảnh cảnh làm tham chiếu video</span>
            <small>{sceneMediaSettings.videoUseSceneImageReference
              ? sceneImageIsCurrent
                ? "Ảnh AI sẵn sàng · sẽ gửi kèm video"
                : sceneImage?.status === "ready"
                  ? sceneImage.stale ? "Ảnh đã cũ · video vẫn dùng ảnh này" : "Ảnh khác hồ sơ hiện tại · video vẫn dùng ảnh này"
                  : "Chưa có ảnh cảnh · tạo ảnh để bật tham chiếu video"
              : sceneImage?.status === "ready" ? "Ảnh vẫn được lưu · hiện không gửi video" : "Chưa gửi ảnh cảnh cho video"}</small>
          </label>
          <small className="ai-drama-row-reference-note">Tắt mục này chỉ bỏ ảnh cảnh khỏi đầu vào video; ảnh đã lưu và lựa chọn tham chiếu dùng để tạo ảnh cảnh vẫn giữ nguyên.</small>
        </fieldset>}
        <fieldset>
          <legend>Nhân vật</legend>
          {characterProfiles.map((character) => <label key={character.id}>
            <input type="checkbox" checked={selectedIds.includes(character.id)} disabled={sceneCharacterSaving} onChange={(event) => void saveDramaSceneReferences(scene, event.target.checked ? [...selectedIds, character.id] : selectedIds.filter((id) => id !== character.id), selectedLocationId, referenceKind)} />
            <span>{character.name}</span><small>{character.referenceImagePath ? "Có ảnh" : "Chưa có ảnh"}</small>
          </label>)}
          {!characterProfiles.length && <small>Chưa có hồ sơ nhân vật.</small>}
        </fieldset>
        <label className="ai-drama-row-location-select">Bối cảnh
          <select value={selectedLocationId} disabled={sceneCharacterSaving || !locationProfiles.length} onChange={(event) => void saveDramaSceneReferences(scene, selectedIds, event.target.value, referenceKind)}>
            <option value="">Không chọn</option>
            {locationProfiles.map((location) => <option key={location.id} value={location.id}>{location.name}{location.referenceImagePath ? " · có ảnh" : " · chưa có ảnh"}</option>)}
          </select>
        </label>
        <small className="ai-drama-row-reference-note">{mediaLabel === "video"
          ? "Bối cảnh đã chọn sẽ thêm mô tả vào prompt video và gửi ảnh hồ sơ nếu có. Khi bật ảnh cảnh chính, video nhận cả ảnh cảnh và hồ sơ bối cảnh."
          : "Ban đầu lấy hồ sơ đã gán cho cảnh. Mô tả bối cảnh sẽ được thêm vào prompt; nếu hồ sơ có ảnh tải lên sẵn, ảnh đó cũng được gửi làm tham chiếu."}</small>
      </div>
    </details>;
  }
  const aiDramaWorkspace = project.presetId === "ai-drama" ? (
<section id="scenes" className="ai-drama-workspace" aria-label="AI Drama">
        <header className="ai-drama-workspace-heading">
          <div><div className="section-kicker">AI DRAMA</div><h2>Prompt ảnh, video theo cảnh và timeline thoại</h2><p>Kịch bản và prompt tạo trước; duyệt/chỉnh xong mới bấm tạo ảnh, video hàng loạt. TTS chạy bằng nút riêng.</p></div>
        </header>

        <nav className="ai-drama-subtabs" aria-label="Mục AI Drama">
          <button type="button" aria-pressed={dramaTab === "scenes"} className={dramaTab === "scenes" ? "active" : ""} onClick={() => setDramaTab("scenes")}>Cảnh · prompt & thoại</button>
          <button type="button" aria-pressed={dramaTab === "characters"} className={dramaTab === "characters" ? "active" : ""} onClick={() => setDramaTab("characters")}>Prompt nhân vật · {characterProfiles.length}</button>
          <button type="button" aria-pressed={dramaTab === "locations"} className={dramaTab === "locations" ? "active" : ""} onClick={() => setDramaTab("locations")}>Prompt bối cảnh · {locationProfiles.length}</button>
        </nav>
        {runMessage && <div className={`run-message ${runMessage.tone}`}><span><Icon name={runMessage.tone === "success" ? "check" : "alert"} size={13} /></span>{runMessage.text}</div>}
        {characterError && <div className="run-message error" role="alert">{characterError}</div>}
        {sceneError && <div className="run-message error" role="alert">{sceneError}</div>}

        {dramaTab === "characters" && <section className="ai-drama-panel" aria-labelledby="ai-drama-cast-title">
          <div className="ai-drama-panel-heading"><div><div className="section-kicker">CHARACTER REFERENCES</div><h3 id="ai-drama-cast-title">Prompt ảnh nhân vật</h3><span>{characterProfiles.length} nhân vật{missingScriptCharacterCount ? ` · ${missingScriptCharacterCount} tên thiếu hồ sơ` : ""}</span></div><div className="ai-drama-batch-actions">
            <button className="secondary-button compact" type="button" onClick={() => void generateDramaProfileImages("characters")} disabled={!characterProfilesMissingImage.length || Boolean(profileBusyId) || characterProfileImageBusy || profileBatchKinds.has("characters")} title="Chỉ tạo ảnh cho nhân vật chưa có ảnh tham chiếu; ảnh hiện có được giữ nguyên">{profileBatchKinds.has("characters") ? `Đang tạo ${profileBatchProgress.characters}…` : `Tạo ảnh hàng loạt · ${characterProfilesMissingImage.length}`}</button>
            {missingScriptCharacterCount > 0 && <button className="secondary-button compact" type="button" onClick={() => void syncScriptCharacters()} disabled={characterSyncing || characterSaving || Boolean(profileBusyId) || profileBatchKinds.size > 0}>{characterSyncing ? "Đang đồng bộ…" : "Tạo hồ sơ từ kịch bản"}</button>}
          </div></div>
          <form id="ai-drama-character-create" className="ai-drama-profile-create" onSubmit={(event) => { event.preventDefault(); void createDramaProfile("characters"); }}>
            <input aria-label="Tên nhân vật" placeholder="Tên nhân vật" value={newDramaProfile.name} onChange={(event) => setNewDramaProfile((current) => ({ ...current, name: event.target.value }))} disabled={Boolean(profileBusyId) || profileBatchKinds.size > 0} />
            <input aria-label="Mô tả hồ sơ" placeholder="Mô tả nhận diện" value={newDramaProfile.description} onChange={(event) => setNewDramaProfile((current) => ({ ...current, description: event.target.value }))} disabled={Boolean(profileBusyId) || profileBatchKinds.size > 0} />
            <textarea aria-label="Prompt ảnh nhân vật" rows={2} placeholder="Ngoại hình, tóc, trang phục, màu sắc…" value={newDramaProfile.imagePrompt} onChange={(event) => setNewDramaProfile((current) => ({ ...current, imagePrompt: event.target.value }))} disabled={Boolean(profileBusyId) || profileBatchKinds.size > 0} />
            <button type="submit" className="secondary-button compact" disabled={Boolean(profileBusyId) || profileBatchKinds.size > 0 || !newDramaProfile.name.trim()}><Icon name="plus" size={14} /> Thêm nhân vật</button>
          </form>
          {characterProfiles.length ? <div className="ai-drama-character-grid">
            {characterProfiles.map((character) => {
              const assignedCount = scenes.reduce((count, scene) => count + sceneDialogueSegments(scene, characterProfiles).filter((segment) => segment.speakerCharacterId === character.id).length, 0);
              const selectedVoice = voiceCatalog?.voices.find((voice) => voice.id === character.voiceId);
              return <article className="ai-drama-character-card" key={character.id}>
                {character.referenceImagePath ? <img src={`/api/projects/${encodeURIComponent(project.slug)}/characters/${encodeURIComponent(character.id)}/image`} alt={`Ảnh tham chiếu ${character.name}`} loading="lazy" /> : <div className="ai-drama-character-image-empty"><Icon name="users" size={20} /><span>Chưa có ảnh</span></div>}
                <div className="ai-drama-character-content">
                  <strong>{character.name}</strong>
                  <label>Prompt tạo ảnh<textarea key={`${character.id}-${character.imagePrompt || character.description}-${PROFILE_REFERENCE_ASPECT_RATIO}`} defaultValue={profileImagePrompt(character, "characters")} rows={7} onBlur={(event) => { if (event.target.value !== profileImagePrompt(character, "characters")) void updateDramaProfile("characters", character.id, "PATCH", { imagePrompt: event.target.value }); }} disabled={Boolean(profileBusyId) || profileBatchKinds.has("characters") || profileImageBusyIds.has(`characters:${character.id}`)} /><small className="ai-drama-prompt-guidance">Bắt buộc: toàn thân chính diện · toàn thân sau lưng · chân dung cận mặt · khung hình 1:1.</small></label>
                  <div className="ai-drama-icon-actions">
                    <button type="button" title={profileImageBusyIds.has(`characters:${character.id}`) ? "Đang tạo ảnh tham chiếu" : profileBusyId ? "Đang lưu hồ sơ" : "Tạo ảnh nhân vật"} onClick={() => void generateDramaProfileImage("characters", character.id)} disabled={Boolean(profileBusyId) || profileBatchKinds.has("characters") || profileImageBusyIds.has(`characters:${character.id}`)}><Icon name={profileImageBusyIds.has(`characters:${character.id}`) ? "clock" : "spark"} size={15} /> {profileImageBusyIds.has(`characters:${character.id}`) ? "Đang tạo…" : profileBusyId ? "Đang lưu…" : "Tạo ảnh"}</button>
                    <button type="button" title="Upload ảnh tham chiếu" onClick={() => chooseDramaUpload("characters", character.name, character.imagePrompt || "", character.description || "")} disabled={Boolean(profileBusyId) || profileBatchKinds.has("characters") || profileImageBusyIds.has(`characters:${character.id}`)}><Icon name="upload" size={15} /> Upload</button>
                    <button type="button" title="Xóa nhân vật" onClick={() => void updateDramaProfile("characters", character.id, "DELETE")} disabled={Boolean(profileBusyId) || profileBatchKinds.has("characters") || profileImageBusyIds.has(`characters:${character.id}`)}><Icon name="trash" size={15} /></button>
                  </div>
                  <details className="ai-drama-character-voice" open>
                    <summary>Voice & TTS tùy chọn<span>{characterVoiceSavingId === character.id ? "Đang lưu…" : character.voiceId ? `${selectedVoice?.name || character.voiceName || character.voiceId} · ${assignedCount} lượt` : `${assignedCount} lượt · mặc định`}</span></summary>
                    <label>Voice nhân vật
                      <select value={character.voiceId || ""} onChange={(event) => void saveCharacterVoice(character, event.target.value)} disabled={voiceCatalogLoading || Boolean(characterVoiceSavingId) || ttsRunning || !voiceCatalog?.voices.length}>
                        <option value="">Dùng voice mặc định của project</option>
                        {character.voiceId && !voiceCatalog?.voices.some((voice) => voice.id === character.voiceId) && <option value={character.voiceId}>{character.voiceName || character.voiceId} · voice đã lưu</option>}
                        {(voiceCatalog?.voices || []).map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voiceLanguageLabel(voice.language)}{voice.gender ? ` · ${voice.gender}` : ""}</option>)}
                      </select>
                      <small>Ngôn ngữ trong hồ sơ voice chỉ mô tả giọng; lời thoại sẽ được đọc theo ngôn ngữ video của project.</small>
                      {voiceCatalogLoading && <small>Đang tải thư viện voice…</small>}
                      {!voiceCatalogLoading && !voiceCatalog?.voices.length && <small>Không tải được thư viện voice OmniVoice.</small>}
                    </label>
                  </details>
                </div>
              </article>;
            })}
          </div> : <div className="ai-drama-empty"><strong>Chưa có hồ sơ nhân vật</strong><span>{missingScriptCharacterCount ? `Kịch bản có ${missingScriptCharacterCount} nhân vật; đồng bộ hồ sơ để gán voice riêng.` : "Tạo hồ sơ để gán ảnh và voice cho dàn diễn viên."}</span>{missingScriptCharacterCount ? <button type="button" className="secondary-button compact" onClick={() => void syncScriptCharacters()} disabled={characterSyncing}>{characterSyncing ? "Đang đồng bộ…" : "Tạo hồ sơ từ kịch bản"}</button> : <button type="button" className="secondary-button compact" onClick={() => openProjectSection("ai-drama-character-create")}>Mở form hồ sơ</button>}</div>}
        </section>}

        {dramaTab === "locations" && <section className="ai-drama-panel" aria-labelledby="ai-drama-locations-title">
          <div className="ai-drama-panel-heading"><div><div className="section-kicker">LOCATION REFERENCES</div><h3 id="ai-drama-locations-title">Prompt ảnh bối cảnh</h3><span>{locationProfiles.length} bối cảnh{missingScriptLocationCount ? ` · ${missingScriptLocationCount} tên thiếu hồ sơ` : ""}</span></div><div className="ai-drama-batch-actions">
            <button className="secondary-button compact" type="button" onClick={() => void generateDramaProfileImages("locations")} disabled={!locationProfilesMissingImage.length || Boolean(profileBusyId) || locationProfileImageBusy || profileBatchKinds.has("locations")} title="Chỉ tạo ảnh cho bối cảnh chưa có ảnh tham chiếu; ảnh hiện có được giữ nguyên">{profileBatchKinds.has("locations") ? `Đang tạo ${profileBatchProgress.locations}…` : `Tạo ảnh hàng loạt · ${locationProfilesMissingImage.length}`}</button>
            {missingScriptLocationCount > 0 && <button className="secondary-button compact" type="button" onClick={() => void syncScriptCharacters()} disabled={characterSyncing || characterSaving || Boolean(profileBusyId) || profileBatchKinds.size > 0}>{characterSyncing ? "Đang đồng bộ…" : "Tạo hồ sơ từ kịch bản"}</button>}
          </div></div>
          <form className="ai-drama-profile-create" onSubmit={(event) => { event.preventDefault(); void createDramaProfile("locations"); }}>
            <input aria-label="Tên bối cảnh" placeholder="Tên bối cảnh" value={newDramaProfile.name} onChange={(event) => setNewDramaProfile((current) => ({ ...current, name: event.target.value }))} disabled={Boolean(profileBusyId) || profileBatchKinds.size > 0} />
            <input aria-label="Mô tả hồ sơ" placeholder="Mô tả nhận diện" value={newDramaProfile.description} onChange={(event) => setNewDramaProfile((current) => ({ ...current, description: event.target.value }))} disabled={Boolean(profileBusyId) || profileBatchKinds.size > 0} />
            <textarea aria-label="Prompt ảnh bối cảnh" rows={2} placeholder="Kiến trúc, mặt bằng, vật liệu, điểm nhận diện…" value={newDramaProfile.imagePrompt} onChange={(event) => setNewDramaProfile((current) => ({ ...current, imagePrompt: event.target.value }))} disabled={Boolean(profileBusyId) || profileBatchKinds.size > 0} />
            <button type="submit" className="secondary-button compact" disabled={Boolean(profileBusyId) || profileBatchKinds.size > 0 || !newDramaProfile.name.trim()}><Icon name="plus" size={14} /> Thêm bối cảnh</button>
          </form>
          <div className="ai-drama-character-grid">{locationProfiles.map((location) => <article className="ai-drama-character-card" key={location.id}>
            {location.referenceImagePath ? <img src={`/api/projects/${encodeURIComponent(project.slug)}/locations/${encodeURIComponent(location.id)}/image`} alt={`Ảnh ${location.name}`} loading="lazy" /> : <div className="ai-drama-character-image-empty"><Icon name="scene" size={20} /><span>Chưa có ảnh</span></div>}
            <div className="ai-drama-character-content"><strong>{location.name}</strong>
              <label>Prompt tạo ảnh<textarea key={`${location.id}-${location.imagePrompt || location.description}-${PROFILE_REFERENCE_ASPECT_RATIO}`} defaultValue={profileImagePrompt(location, "locations")} rows={7} onBlur={(event) => { if (event.target.value !== profileImagePrompt(location, "locations")) void updateDramaProfile("locations", location.id, "PATCH", { imagePrompt: event.target.value }); }} disabled={Boolean(profileBusyId) || profileBatchKinds.has("locations") || profileImageBusyIds.has(`locations:${location.id}`)} /><small className="ai-drama-prompt-guidance">Bắt buộc: bốn góc camera Bắc · Đông · Nam · Tây của cùng một nơi · khung hình 1:1.</small></label>
              <div className="ai-drama-icon-actions">
                <button type="button" title={profileImageBusyIds.has(`locations:${location.id}`) ? "Đang tạo ảnh tham chiếu" : profileBusyId ? "Đang lưu hồ sơ" : "Tạo ảnh bối cảnh"} onClick={() => void generateDramaProfileImage("locations", location.id)} disabled={Boolean(profileBusyId) || profileBatchKinds.has("locations") || profileImageBusyIds.has(`locations:${location.id}`)}><Icon name={profileImageBusyIds.has(`locations:${location.id}`) ? "clock" : "spark"} size={15} /> {profileImageBusyIds.has(`locations:${location.id}`) ? "Đang tạo…" : profileBusyId ? "Đang lưu…" : "Tạo ảnh"}</button>
                <button type="button" onClick={() => chooseDramaUpload("locations", location.name, location.imagePrompt || "", location.description || "")} disabled={Boolean(profileBusyId) || profileBatchKinds.has("locations") || profileImageBusyIds.has(`locations:${location.id}`)}><Icon name="upload" size={15} /> Upload</button>
                <button type="button" title="Xóa bối cảnh" onClick={() => void updateDramaProfile("locations", location.id, "DELETE")} disabled={Boolean(profileBusyId) || profileBatchKinds.has("locations") || profileImageBusyIds.has(`locations:${location.id}`)}><Icon name="trash" size={15} /></button>
              </div>
            </div>
          </article>)}</div>
        </section>}

        {dramaTab === "scenes" && <section className="ai-drama-panel" aria-labelledby="ai-drama-scenes-title">
          <div className="ai-drama-model-quick-settings" aria-label="Cấu hình hệ thống và model tạo media">
            <div className="ai-drama-model-quick-system" aria-label="Hệ thống tạo ảnh"><span>Hệ thống ảnh</span><strong>MaiVideo</strong></div>
            <label><span>Model ảnh</span><select aria-label="Model ảnh AI Drama" value={batchMediaSettings.imageModel} disabled={batchMediaBusy || videoQueueRunning || sceneMediaSettingsSaving || Boolean(generatingSceneId)} onChange={(event) => updateQuickImageModel(event.target.value)}>{batchImageModelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
            <label><span>Độ phân giải ảnh</span><select aria-label="Độ phân giải ảnh AI Drama" value={batchMediaSettings.imageQuality} disabled={batchMediaBusy || videoQueueRunning || sceneMediaSettingsSaving || Boolean(generatingSceneId)} onChange={(event) => updateBatchMediaSettings({ imageQuality: event.target.value })}>{batchImageQualities.map((quality) => <option key={quality} value={quality}>{quality}</option>)}</select></label>
            {batchImageDetailLevels.length > 0 && <label><span>Detail level</span><select aria-label="Detail level ảnh AI Drama" value={batchMediaSettings.imageDetailLevel} disabled={batchMediaBusy || videoQueueRunning || sceneMediaSettingsSaving || Boolean(generatingSceneId)} onChange={(event) => updateBatchMediaSettings({ imageDetailLevel: event.target.value as MediaGenerationSettings["imageDetailLevel"] })}>{batchImageDetailLevels.map((level) => <option key={level} value={level}>{IMAGE_DETAIL_LEVEL_LABELS[level]}</option>)}</select></label>}
            <label><span>Hệ thống video</span><select aria-label="Hệ thống video AI Drama" value={batchMediaSettings.videoProvider} disabled={batchMediaBusy || videoQueueRunning || sceneMediaSettingsSaving || Boolean(generatingSceneId)} onChange={(event) => updateBatchMediaSettings({ videoProvider: event.target.value as MediaGenerationSettings["videoProvider"] })}><option value="maivideo">MaiVideo</option><option value="seedance">Seedance · Dola.com local</option></select></label>
            <label><span>Model video</span><select aria-label="Model video AI Drama" value={batchMediaSettings.videoModel} disabled={batchMediaBusy || videoQueueRunning || sceneMediaSettingsSaving || Boolean(generatingSceneId)} onChange={(event) => updateQuickVideoModel(event.target.value)}>{batchVideoModelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
            <label><span>Chất lượng video</span>{batchSeedanceSelected ? <select aria-label="Chất lượng video AI Drama" value="profile" disabled><option value="profile">Theo profile Dola</option></select> : <select aria-label="Chất lượng video AI Drama" value={batchMediaSettings.videoQuality} disabled={batchMediaBusy || videoQueueRunning || sceneMediaSettingsSaving || Boolean(generatingSceneId)} onChange={(event) => updateBatchMediaSettings({ videoQuality: event.target.value })}>{batchVideoQualities.map((quality) => <option key={quality} value={quality}>{quality}</option>)}</select>}</label>
            <label><span>Thời lượng clip</span><select aria-label="Chế độ thời lượng video AI Drama" value="scene" disabled><option value="scene">Theo độ dài từng cảnh</option></select></label>
            <small className="field-help">Mỗi clip AI Drama dùng đúng độ dài cảnh: 5, 10 hoặc 15 giây.</small>
          </div>
          <div className="ai-drama-model-quick-toggles" aria-label="Tuỳ chọn media AI Drama">
            <label><input type="checkbox" checked={batchMediaSettings.imageUseCharacterReferences} disabled={batchMediaBusy || videoQueueRunning || sceneMediaSettingsSaving} onChange={(event) => updateBatchMediaSettings({ imageUseCharacterReferences: event.target.checked })} /><span>Hồ sơ nhân vật cho ảnh cảnh</span></label>
            {!batchSeedanceSelected && <>
              <label><input type="checkbox" checked={selectedBatchVideoModel?.supportsMultiShot === false ? false : batchMediaSettings.videoMultiShot} disabled={batchMediaBusy || videoQueueRunning || selectedBatchVideoModel?.supportsMultiShot === false} onChange={(event) => updateBatchMediaSettings({ videoMultiShot: event.target.checked })} /><span>Multi-shot{selectedBatchVideoModel?.supportsMultiShot === false ? " · không hỗ trợ" : ""}</span></label>
              <label><input type="checkbox" checked={selectedBatchVideoModel?.supportsAudio === false ? false : batchMediaSettings.videoAudio} disabled={batchMediaBusy || videoQueueRunning || selectedBatchVideoModel?.supportsAudio === false} onChange={(event) => updateBatchMediaSettings({ videoAudio: event.target.checked })} /><span>Âm thanh từ model{selectedBatchVideoModel?.supportsAudio === false ? " · không hỗ trợ" : ""}</span></label>
              <label><input type="checkbox" checked={batchVideoOffPeakRequired || (selectedBatchVideoModel?.supportsOffPeak === false ? false : batchMediaSettings.videoOffPeak)} disabled={batchMediaBusy || videoQueueRunning || batchVideoOffPeakRequired || selectedBatchVideoModel?.supportsOffPeak === false} onChange={(event) => updateBatchMediaSettings({ videoOffPeak: event.target.checked })} /><span>{batchVideoOffPeakRequired ? "Off-peak · bắt buộc với PixVerse" : selectedBatchVideoModel?.supportsOffPeak === false ? "Off-peak · không hỗ trợ" : "Off-peak"}</span></label>
            </>}
            <label><input type="checkbox" checked={batchMediaSettings.videoUseCharacterReferences} disabled={batchMediaBusy || videoQueueRunning} onChange={(event) => updateBatchMediaSettings({ videoUseCharacterReferences: event.target.checked })} /><span>Ảnh nhân vật cho video</span></label>
            <label><input type="checkbox" checked={batchMediaSettings.videoUseLocationReferences} disabled={batchMediaBusy || videoQueueRunning} onChange={(event) => updateBatchMediaSettings({ videoUseLocationReferences: event.target.checked })} /><span>{project.presetId === "ai-drama" ? "Ảnh & mô tả bối cảnh cho video" : "Ảnh bối cảnh (chỉ dùng khi tắt ảnh cảnh)"}</span></label>
            <label><input type="checkbox" checked={batchMediaSettings.videoUseSceneImageReference} disabled={batchMediaBusy || videoQueueRunning} onChange={(event) => updateBatchMediaSettings({ videoUseSceneImageReference: event.target.checked })} /><span>Ảnh cảnh làm tham chiếu</span></label>
          </div>
          <div className="ai-drama-panel-heading ai-drama-scenes-heading"><div><div className="section-kicker">SCENE WORKFLOW</div><h3 id="ai-drama-scenes-title">Cảnh thoại & tạo media</h3><span>{filteredScenes.length} cảnh · {filteredScenes.reduce((sum, scene) => sum + sceneDialogueSegments(scene, characterProfiles).length, 0)} lượt thoại{filteredScenesNeedingDialogueTimeline.length ? ` · ${filteredScenesNeedingDialogueTimeline.length} cảnh chưa có timeline tách` : ""}</span></div>
            <div className="ai-drama-batch-actions">
              {filteredScenesNeedingDialogueTimeline.length > 0 && <button className="secondary-button compact" type="button" onClick={() => void extractFilteredSceneDialogues()} disabled={Boolean(dialogueExtractingSceneId) || Boolean(dialogueExtractBatchProgress) || ttsRunning || renderRunning || isRunning || Boolean(runningScriptChunkId)}>{dialogueExtractBatchProgress ? `Đang hoàn thiện ${dialogueExtractBatchProgress}` : `AI hoàn thiện thoại & chi tiết · ${filteredScenesNeedingDialogueTimeline.length}`}</button>}
              <button className="secondary-button compact" type="button" title="Tự gán hồ sơ nhân vật và bối cảnh theo nội dung cảnh. Hồ sơ bối cảnh được thêm vào prompt ảnh và video theo cài đặt tham chiếu." onClick={() => void autoAssignSceneReferences()} disabled={(!characterProfiles.length && !locationProfiles.length) || autoAssignCharactersBusy || batchMediaBusy || videoQueueRunning || sceneCharacterSaving}>{autoAssignCharactersBusy ? "Đang gán…" : "Tự gán hồ sơ"}</button>
              <button className="secondary-button compact" type="button" onClick={() => void generateFilteredSceneImages()} disabled={!filteredImageTargets.length || batchMediaBusy || sceneMediaSettingsSaving || videoQueueRunning || scriptBlocksIndependentTasks || ttsRunning || Boolean(dialogueTtsBatchProgress) || Boolean(generatingSceneId)}>{batchMediaBusy && generatingSceneMediaKind === "image" ? batchMediaProgress || "Đang tạo ảnh…" : `Tạo ảnh · ${filteredImageTargets.length}`}</button>
              <button className="primary-button compact" type="button" onClick={() => void generateFilteredSceneVideos()} disabled={!filteredVideoTargets.length || batchMediaBusy || videoQueueRunning || sceneMediaSettingsSaving || scriptBlocksIndependentTasks || ttsRunning || Boolean(dialogueTtsBatchProgress) || Boolean(generatingSceneId)}>{batchMediaBusy && generatingSceneMediaKind === "video" ? batchMediaProgress || "Đang tạo video…" : `Tạo video · ${filteredVideoTargets.length}`}</button>
              {project.presetId === "ai-drama" && <button className="secondary-button compact" type="button" onClick={() => void generateFilteredDialogueTts()} disabled={!filteredDialogueTtsVoiceTargets.length || Boolean(dialogueTtsBatchProgress) || Boolean(dialogueTranslationSceneId) || Boolean(dialogueTranslationBatchProgress) || ttsRunning || renderRunning || dialogueSavingSceneId !== "" || isRunning || Boolean(runningScriptChunkId) || Boolean(generatingSceneId) || batchMediaBusy || videoQueueRunning} title={filteredDialogueTtsVoiceTargets.length ? `Tạo voice ${voiceLanguageLabel(dialogueTranslationLanguage)} cho ${filteredDialogueTtsVoiceTargets.length} cảnh đã dịch` : filteredDialogueScenesNeedingTranslation.length ? `Dịch thoại sang ${voiceLanguageLabel(dialogueTranslationLanguage)} trước` : filteredDialogueScenesMissingVoice.length ? "Gán voice cho nhân vật trước" : "Các cảnh trong phạm vi hiện tại đã có voice hoặc chưa có lời thoại"}>{dialogueTtsBatchProgress ? `Đang tạo voice ${voiceLanguageLabel(dialogueTranslationLanguage)} ${dialogueTtsBatchProgress}…` : `Tạo voice ${voiceLanguageLabel(dialogueTranslationLanguage)} · ${filteredDialogueTtsVoiceTargets.length}`}</button>}
              <button className="text-button" type="button" onClick={() => { setSceneSearch(""); setSceneChunkFilter("all"); setSceneReviewFilter("all"); setSceneAiReviewFilter("all"); setSceneMediaFilter("all"); }}>Xóa lọc</button>
            </div>
          </div>
          <div className="ai-drama-scene-filters">
            <label><span>Tập</span><select value={sceneChunkFilter} onChange={(event) => setSceneChunkFilter(event.target.value)}><option value="all">Tất cả tập</option>{sceneChunks.map((chunkId) => <option key={chunkId} value={chunkId}>{chunkId}</option>)}</select></label>
            <label className="ai-drama-scene-search"><span>Tìm cảnh</span><input value={sceneSearch} onChange={(event) => setSceneSearch(event.target.value)} placeholder="Mã cảnh, thoại, nội dung…" /></label>
            <div className="ai-drama-translation-tools">
              <label><span>Ngôn ngữ dịch & voice</span><select value={dialogueTranslationLanguage} onChange={(event) => setDialogueTranslationLanguage(event.target.value)} disabled={Boolean(dialogueTranslationSceneId) || Boolean(dialogueTranslationBatchProgress) || Boolean(dialogueTtsBatchProgress) || ttsRunning || isRunning || Boolean(runningScriptChunkId)}>
                {FALLBACK_VIDEO_LANGUAGES.map((language) => <option key={language} value={language}>{voiceLanguageLabel(language)}{language === project.language ? " · ngôn ngữ gốc" : ""}</option>)}
              </select></label>
              <button type="button" className="secondary-button compact" onClick={() => void translateAllMissingDialogue()} disabled={!dialogueScenesNeedingTranslation.length || Boolean(dialogueTranslationSceneId) || Boolean(dialogueTranslationBatchProgress) || Boolean(dialogueTtsBatchProgress) || ttsRunning || renderRunning || dialogueSavingSceneId !== "" || isRunning || Boolean(runningScriptChunkId) || Boolean(generatingSceneId) || batchMediaBusy || videoQueueRunning}>
                {dialogueTranslationBatchProgress ? `Đang dịch ${dialogueTranslationBatchProgress}…` : `Dịch thoại còn thiếu · ${dialogueScenesNeedingTranslation.length} cảnh`}
              </button>
              <small title={dialogueScenesNeedingTranslation.length ? `Áp dụng cho ${dialogueScenesNeedingTranslation.length} cảnh có lời thoại trong phạm vi đang chọn.` : dialogueScenesWithoutTimeline.length ? `Hoàn thiện timeline thoại cho ${dialogueScenesWithoutTimeline.length} cảnh trước.` : `Đã có bản dịch ${voiceLanguageLabel(dialogueTranslationLanguage)} cho mọi cảnh trong phạm vi đang chọn.`}>{dialogueScenesNeedingTranslation.length ? `Còn ${dialogueScenesNeedingTranslation.length} cảnh cần dịch` : dialogueScenesWithoutTimeline.length ? `Thiếu timeline · ${dialogueScenesWithoutTimeline.length}` : `Đã dịch ${voiceLanguageLabel(dialogueTranslationLanguage)}`}</small>
            </div>
          </div>
          {scenesLoading ? <div className="ai-drama-empty">Đang tải cảnh…</div> : !filteredScenes.length ? <div className="ai-drama-empty"><strong>Chưa có cảnh trong phạm vi này</strong><span>Tạo hoặc nhập kịch bản ở Tổng quan project, sau đó quay lại gán nhân vật thoại.</span><button type="button" className="secondary-button compact" onClick={() => openProjectSection("episodes")}>Mở kịch bản</button></div> : <div className="ai-drama-scene-table" role="table" aria-label="Danh sách cảnh AI Drama">
            <div className="ai-drama-scene-table-head" role="rowgroup"><div className="ai-drama-scene-table-row" role="row"><span role="columnheader">STT cảnh</span><span role="columnheader">Timeline · lời thoại từng nhân vật</span><span role="columnheader">Prompt tạo ảnh · ảnh tham chiếu</span><span role="columnheader">Prompt tạo video · ảnh tham chiếu</span></div></div>
            <div className="ai-drama-scene-table-body" role="rowgroup">
            {filteredScenes.map((scene) => {
              const dialogueSegments = sceneDialogueSegments(scene, characterProfiles);
              const missingLineVoice = dialogueSegments.some((segment) => {
                const lineSpeaker = characterProfiles.find((character) => character.id === segment.speakerCharacterId);
                return !(lineSpeaker?.voiceId || scene.ttsVoiceId || scene.tts_voice_id || project.voiceId);
              });
              const readyLineCount = dialogueSegments.filter((segment) => Boolean(segment.audio?.localPath)).length;
              const readyTranslatedLineCount = dialogueSegments.filter((segment) => Boolean(segment.translatedAudio?.[dialogueTranslationLanguage]?.localPath)).length;
              const sceneHasTts = readyLineCount > 0 || readyTranslatedLineCount > 0
                || dialogueSegments.some((segment) => Object.values(segment.translatedAudio || {}).some((audio) => audio?.localPath))
                || Boolean(sceneAudioRecord(scene).localPath);
              const missingTranslation = dialogueSegments.some((segment) => !segment.translations?.[dialogueTranslationLanguage]?.trim());
              const mediaKind = scene.media?.kind === "video" ? "Có video" : scene.media?.kind === "image" ? "Có ảnh" : "Thiếu media";
              const hasReadyVideo = scene.media?.kind === "video" && scene.media.status === "ready";
              const mediaJobActive = scene.mediaJob?.status === "queued" || scene.mediaJob?.status === "running";
              const mediaBusy = generatingSceneId === scene.id || mediaJobActive;
              const mediaJobLabel = scene.mediaJob?.status === "queued"
                ? `Đang chờ tạo ${scene.mediaJob.kind === "image" ? "ảnh" : "video"}…`
                : scene.mediaJob?.status === "running"
                  ? `Đang tạo ${scene.mediaJob.kind === "image" ? "ảnh" : "video"}…`
                  : scene.mediaJob?.status === "failed"
                    ? `${scene.mediaJob.kind === "image" ? "Ảnh" : "Video"} lỗi: ${scene.mediaJob.error || "bấm nút để thử lại"}`
                    : "";
              const expanded = expandedDramaSceneId === scene.id;
              const needsDialogueExtraction = sceneNeedsDialogueExtraction(scene);
              const sceneImagePrompt = sceneFieldValue(scene, "image_prompt", "imagePrompt");
              const sceneVideoPrompt = sceneFieldValue(scene, "video_prompt", "videoPrompt");
              const sceneDuration = sceneDurationSeconds(scene);
              const sceneReferenceImage = sceneReferenceMedia(scene);
              const sceneReferenceImageUrl = sceneReferenceImage?.kind === "image" && sceneReferenceImage.status === "ready"
                ? scene.referenceImagePreviewUrl || (scene.media?.kind === "image" ? scene.previewUrl : "")
                : "";
              const scenePromptDraft = scenePromptDrafts[scene.id] || { imagePrompt: sceneImagePrompt, videoPrompt: sceneVideoPrompt };
              const scenePromptsChanged = scenePromptDraft.imagePrompt !== sceneImagePrompt || scenePromptDraft.videoPrompt !== sceneVideoPrompt;
              const hasUploadedVideo = scene.media?.kind === "video" && scene.media.provider === "upload";
              const submittedVideoPrompt = hasUploadedVideo ? "" : String(
                (scene.mediaJob?.kind === "video" ? scene.mediaJob.submittedPrompt : "")
                  || (scene.media?.kind === "video" ? scene.media.query : "")
                  || "",
              ).trim();
              const normalizedSceneVideoPrompt = normalizePromptForComparison(sanitizeDramaVisualPrompt(sceneVideoPrompt));
              const apiPromptHasCurrentScenePrompt = Boolean(normalizedSceneVideoPrompt && normalizePromptForComparison(submittedVideoPrompt).includes(normalizedSceneVideoPrompt));
              const videoPromptPreview = sceneVideoPromptPreviews[scene.id];
              return <Fragment key={`${scene.chunkId}-${scene.id}`}>
                  <div role="row" className={`ai-drama-scene-table-row ai-drama-scene-table-item ${expanded ? "active" : ""}`}>
                  <span className="ai-drama-scene-table-cell ai-drama-scene-table-ident" role="cell"><strong>{sceneNumberLabel(scene)}</strong><small>{scene.chunkId} · {project.chunks.find((chunk) => chunk.id === scene.chunkId)?.title || ""}</small></span>
                  <span className="ai-drama-scene-table-cell ai-drama-timeline-cell" role="cell">
                    <strong>{sceneTimeRange(scene)} · {Math.round((Number(scene.end_sec ?? scene.endSec) - Number(scene.start_sec ?? scene.startSec)) || 15)}s</strong>
                    {sceneTimelineRows(scene, dialogueSegments).map((row, index) => row.kind === "dialogue" && row.segment
                      ? <span className="ai-drama-timeline-cue" key={row.segment.id}>
                        <b>{row.startSec.toFixed(1)}–{row.endSec.toFixed(1)}s · {row.segment.speakerName || characterProfiles.find((item) => item.id === row.segment?.speakerCharacterId)?.name || "Narrator"}</b>
                        <label className="ai-drama-timeline-edit"><span>Lời thoại · tự lưu khi rời ô</span><textarea rows={1} maxLength={2000} aria-label={`Sửa lời thoại ${sceneNumberLabel(scene)} câu ${index + 1}`} value={row.segment.text} disabled={ttsRunning || dialogueSavingSceneId !== ""} onChange={(event) => updateDialogueDraft(scene.id, (items) => items.map((item) => item.id === row.segment?.id ? { ...item, text: event.target.value, audio: undefined, translations: undefined, translatedAudio: undefined } : item))} onBlur={(event) => { if (event.relatedTarget && event.currentTarget.closest(".ai-drama-timeline-cue")?.contains(event.relatedTarget as Node)) return; void saveDialogueSegments(scene, false); }} /></label>
                        <label className="ai-drama-timeline-edit"><span>{voiceLanguageLabel(dialogueTranslationLanguage)} · tự lưu khi rời ô</span><textarea rows={1} maxLength={2000} aria-label={`Sửa bản dịch ${voiceLanguageLabel(dialogueTranslationLanguage)} ${sceneNumberLabel(scene)} câu ${index + 1}`} placeholder="Nhập hoặc dịch lời thoại…" value={row.segment.translations?.[dialogueTranslationLanguage] || ""} disabled={ttsRunning || dialogueSavingSceneId !== ""} onChange={(event) => updateDialogueDraft(scene.id, (items) => items.map((item) => {
                          if (item.id !== row.segment?.id) return item;
                          const translations = { ...(item.translations || {}), [dialogueTranslationLanguage]: event.target.value };
                          const translatedAudio = { ...(item.translatedAudio || {}) };
                          delete translatedAudio[dialogueTranslationLanguage];
                          return { ...item, translations, translatedAudio };
                        }))} onBlur={(event) => { if (event.relatedTarget && event.currentTarget.closest(".ai-drama-timeline-cue")?.contains(event.relatedTarget as Node)) return; void saveDialogueSegments(scene, false); }} /></label>
                      </span>
                      : <span className="ai-drama-timeline-gap" key={`gap-${scene.id}-${index}`}><b>{row.startSec.toFixed(1)}–{row.endSec.toFixed(1)}s · Không thoại</b></span>)}
                  </span>
                  <div className="ai-drama-scene-table-cell ai-drama-image-cell" role="cell">
                    {sceneReferenceImageUrl ? <button className="ai-drama-scene-image-preview" type="button" onClick={() => setSceneImagePreview(scene)} aria-label={`Xem ảnh ${sceneNumberLabel(scene)}`} title={`Xem ảnh ${sceneNumberLabel(scene)}`}><img src={sceneReferenceImageUrl} alt={`Ảnh ${sceneNumberLabel(scene)}`} loading="lazy" /></button> : <span className="ai-drama-scene-thumb ai-drama-scene-thumb-empty"><Icon name="scene" size={16} /></span>}
                    {sceneReferenceImage?.status === "ready" && sceneReferenceImage.stale === true && <small className="scene-stale-reference-note" role="status">Ảnh đã cũ · video vẫn dùng ảnh này</small>}
                    <small className="ai-drama-scene-image-prompt">{sceneImagePrompt || "Chưa có prompt tạo ảnh"}</small>
                    {mediaJobActive && scene.mediaJob?.kind === "image" && <small className="scene-media-job-status" role="status">{mediaJobLabel}</small>}
                    {scene.mediaJob?.status === "failed" && <small className="scene-media-job-status error" role="status">{mediaJobLabel}</small>}
                    {renderDramaSceneReferencePicker(scene, "ảnh")}
                    <div className="ai-drama-icon-actions" onClick={(event) => event.stopPropagation()}>
                      <button type="button" title="Tạo ảnh cảnh" onClick={() => void generateSceneImage(scene)} disabled={mediaBusy || batchMediaBusy || sceneMediaSettingsSaving || videoQueueRunning || scriptBlocksIndependentTasks || ttsRunning || Boolean(generatingSceneId)}><Icon name="spark" size={14} /></button>
                      <button type="button" title="Upload ảnh hoặc video" onClick={() => chooseDramaSceneUpload(scene)} disabled={mediaBusy}><Icon name="upload" size={14} /></button>
                      <button type="button" title={expanded ? "Thu gọn thông tin cảnh" : "Chỉnh ảnh tham chiếu"} onClick={() => { setSelectedSceneId(scene.id); setExpandedDramaSceneId((current) => current === scene.id ? "" : scene.id); }}><Icon name="image" size={14} /></button>
                      {scene.media?.status === "ready" && <button type="button" title="Xóa media cảnh" onClick={async () => { await fetch(`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(scene.id)}/media`, { method: "DELETE" }); await loadScenes(); }}><Icon name="trash" size={14} /></button>}
                    </div>
                  </div>
                  <div className="ai-drama-scene-table-cell ai-drama-video-prompt-cell" role="cell">
                    <strong>{sceneVideoPrompt || "Chưa có prompt video"}</strong>
                    <div className="ai-drama-video-dialogue-summary">
                      <b>Lời thoại gửi kèm API · {dialogueSegments.length} lượt</b>
                      {dialogueSegments.length ? dialogueSegments.map((segment) => {
                        const speaker = segment.speakerName || characterProfiles.find((character) => character.id === segment.speakerCharacterId)?.name || "Narrator";
                        const startSec = Math.max(0, segment.startMs / 1000);
                        const endSec = Math.min(sceneDuration, Math.max(startSec + 0.1, (segment.endMs ?? (segment.startMs + estimateDialogueDurationMs(segment.text))) / 1000));
                        return <span key={segment.id}><strong>{startSec.toFixed(1)}–{endSec.toFixed(1)}s · {speaker}:</strong> {segment.text}</span>;
                      }) : <span>Không có lượt thoại trong timeline; prompt API sẽ chỉ hướng dẫn không phát sinh lời thoại.</span>}
                    </div>
                    <div className="ai-drama-api-video-prompt">
                      <div className="ai-drama-api-video-prompt-head">
                        <details className="ai-drama-api-video-prompt-details" onToggle={(event) => {
                          if (!event.currentTarget.open) return;
                          if (scenePromptsChanged) {
                            sceneVideoPromptPreviewRequestIds.current[scene.id] = (sceneVideoPromptPreviewRequestIds.current[scene.id] || 0) + 1;
                            setSceneVideoPromptPreviews((current) => ({ ...current, [scene.id]: { error: "Prompt cảnh đang có thay đổi chưa lưu. Hãy bấm ‘Lưu prompt cảnh’ rồi mở lại phần xem trước." } }));
                            return;
                          }
                          void loadSceneVideoPromptPreview(scene, videoGenerationSettingsForScene(scene));
                        }}>
                          <summary>Xem prompt gửi API{videoPromptPreview?.result ? ` · ${videoPromptPreview.result.promptLength.toLocaleString("vi-VN")} ký tự` : ""}</summary>
                          {videoPromptPreview?.loading && <small role="status">Đang dựng prompt theo cấu hình và nội dung đã lưu… không gửi job tạo video.</small>}
                          {videoPromptPreview?.error && <small className="scene-media-job-status error" role="alert">{videoPromptPreview.error}</small>}
                          {videoPromptPreview?.result && <>
                            <small className="ai-drama-video-preview-meta">Bản xem trước · {videoPromptPreview.result.provider} · {videoPromptPreview.result.model} · {videoPromptPreview.result.promptLength.toLocaleString("vi-VN")} ký tự · {videoPromptPreview.result.dialogueCueCount} lượt thoại{videoPromptPreview.result.dialogueCueCount > 0 && !videoPromptPreview.result.dialogueIncluded ? " · cảnh báo: cue thoại chưa nằm trong payload do giới hạn prompt" : ""}</small>
                            <pre>{videoPromptPreview.result.prompt}</pre>
                          </>}
                        </details>
                        <div className="ai-drama-api-video-copy-actions">
                          <button type="button" className="secondary-button compact ai-drama-api-video-copy" title={scenePromptsChanged ? "Lưu prompt cảnh trước khi sao chép" : "Sao chép prompt gửi API"} aria-label={`Copy prompt gửi API ${sceneNumberLabel(scene)}`} disabled={scenePromptsChanged || videoPromptPreview?.loading || copyingSceneVideoPromptId === scene.id || copyingSceneVideoReferencesId === scene.id} onClick={() => void copySceneVideoPrompt(scene, videoGenerationSettingsForScene(scene))}>
                            <Icon name="copy" size={12} />{copyingSceneVideoPromptId === scene.id ? "Đang copy…" : copiedSceneVideoPromptId === scene.id ? "Đã copy" : "Copy prompt"}
                          </button>
                          <button type="button" className="secondary-button compact ai-drama-api-video-copy" title="Copy từng ảnh: chuyển sang Seedance nhấn ⌘V/Ctrl+V, rồi quay lại bấm nút để copy ảnh tiếp theo." aria-label={`Copy ảnh tham chiếu video ${sceneNumberLabel(scene)}`} disabled={videoPromptPreview?.loading || copyingSceneVideoPromptId === scene.id || copyingSceneVideoReferencesId === scene.id} onPointerEnter={() => warmSceneVideoReferenceImages(scene, videoGenerationSettingsForScene(scene))} onFocus={() => warmSceneVideoReferenceImages(scene, videoGenerationSettingsForScene(scene))} onClick={() => void copySceneVideoReferenceImages(scene, videoGenerationSettingsForScene(scene))}>
                            <Icon name="image" size={12} />{copyingSceneVideoReferencesId === scene.id ? "Đang copy…" : copiedSceneVideoReferencesId === scene.id ? `Đã copy ${sceneVideoReferenceCopyProgress[scene.id]?.lastCopiedIndex || 1}/${sceneVideoReferenceCopyProgress[scene.id]?.total || "ảnh"}` : preparedSceneVideoReferencesId === scene.id ? `Copy ảnh 1/${sceneVideoReferenceCopyProgress[scene.id]?.total || "…"}` : sceneVideoReferenceCopyProgress[scene.id]?.complete ? `Copy lại ${sceneVideoReferenceCopyProgress[scene.id].total} ảnh` : sceneVideoReferenceCopyProgress[scene.id] ? `Copy ảnh ${sceneVideoReferenceCopyProgress[scene.id].nextIndex + 1}/${sceneVideoReferenceCopyProgress[scene.id].total}` : "Copy ảnh"}
                          </button>
                        </div>
                      </div>
                      {sceneVideoReferenceCopyNotice?.sceneId === scene.id && <small className="scene-media-job-status" role="status">{sceneVideoReferenceCopyNotice.text}</small>}
                    </div>
                    {submittedVideoPrompt && <details className="ai-drama-api-video-prompt">
                      <summary>Prompt của lần gửi gần nhất · {submittedVideoPrompt.length.toLocaleString("vi-VN")} ký tự</summary>
                      {!apiPromptHasCurrentScenePrompt && <small className="scene-stale-reference-note" role="status">Prompt lần trước khác prompt cảnh đang hiển thị; hãy mở phần xem trước để kiểm tra payload hiện tại.</small>}
                      <pre>{submittedVideoPrompt}</pre>
                    </details>}
                    {scene.media?.kind === "video" && scene.media.status === "ready" && scene.previewUrl && <div className="ai-drama-scene-video-preview">
                      <div className="ai-drama-scene-video-links">
                        <a href={scene.previewUrl} target="_blank" rel="noreferrer">Mở video ↗</a>
                        <a href={scene.previewUrl} download={`${sceneNumberLabel(scene)}.mp4`}>Tải video</a>
                        <details>
                          <summary>Xem trước tại đây · {sceneDuration}s</summary>
                          <video src={scene.previewUrl} controls preload="metadata" aria-label={`Video ${sceneNumberLabel(scene)}`}>Trình duyệt không hỗ trợ phát video.</video>
                        </details>
                      </div>
                    </div>}
                    <div className="ai-drama-video-reference-row" onClick={(event) => event.stopPropagation()}>
                      {renderDramaSceneReferencePicker(scene, "video")}
                      <div className="ai-drama-scene-media-actions">
                        <button type="button" className="primary-button compact" title={mediaJobActive && scene.mediaJob?.kind === "video" ? mediaJobLabel : hasReadyVideo ? "Tạo lại video đã hoàn thành" : "Tạo video"} onClick={() => void generateSceneVideo(scene)} disabled={mediaBusy || batchMediaBusy || videoQueueRunning || scriptBlocksIndependentTasks || ttsRunning || Boolean(dialogueTtsBatchProgress) || Boolean(dialogueTranslationSceneId) || Boolean(dialogueTranslationBatchProgress)}><Icon name="play" size={13} />{mediaJobActive && scene.mediaJob?.kind === "video" ? scene.mediaJob.status === "queued" ? " Đang chờ…" : " Đang tạo…" : hasReadyVideo ? " Tạo lại" : " Tạo video"}</button>
                        <button type="button" className="secondary-button compact" title={missingTranslation ? `Dịch thoại sang ${voiceLanguageLabel(dialogueTranslationLanguage)} trước` : `Tạo voice ${voiceLanguageLabel(dialogueTranslationLanguage)} cho cảnh`} onClick={() => void generateSceneTts(scene, Boolean(dialogueSegments.length && readyTranslatedLineCount === dialogueSegments.length), dialogueTranslationLanguage)} disabled={!dialogueSegments.length || missingTranslation || missingLineVoice || ttsRunning || renderRunning || scriptBlocksIndependentTasks || batchMediaBusy || videoQueueRunning || Boolean(generatingSceneId) || Boolean(dialogueTtsBatchProgress) || dialogueSavingSceneId === scene.id || Boolean(dialogueTranslationSceneId) || Boolean(dialogueTranslationBatchProgress)}>
                          {ttsRunning && ttsSceneId === scene.id ? "Đang tạo voice…" : readyTranslatedLineCount === dialogueSegments.length && dialogueSegments.length ? "Tạo lại voice" : "Tạo voice"}
                        </button>
                        <button type="button" className="secondary-button compact" title="Upload video MP4 cho cảnh; file từ 50 MiB sẽ tự chia thành các phần 50 MiB" onClick={() => chooseDramaSceneUpload(scene, true)} disabled={mediaBusy || batchMediaBusy || videoQueueRunning || renderRunning || Boolean(generatingSceneId)}><Icon name="upload" size={13} /> {sceneUploadProgress?.sceneId === scene.id ? sceneUploadProgress.text : "Upload video"}</button>
                      </div>
                    </div>
                  </div>
                </div>
                {expanded && <div className="ai-drama-scene-expanded-row" role="row"><div className="ai-drama-scene-expanded" role="cell" aria-colspan={4}>
                  <div className="ai-drama-scene-expanded-heading"><div><span>{sceneNumberLabel(scene)} · {scene.chunkId} · {sceneDuration}s</span><h4>Prompt và timeline cảnh</h4></div><span className="ai-drama-media-state">{mediaBusy ? mediaJobLabel || `Đang xếp ${generatingSceneMediaKind === "image" ? "ảnh" : "video"}…` : mediaKind}</span></div>
                  <div className="ai-drama-scene-actions ai-drama-scene-expanded-actions">
                    {needsDialogueExtraction && <button className="secondary-button compact" type="button" onClick={() => void extractSceneDialogue(scene)} disabled={Boolean(dialogueExtractingSceneId) || Boolean(dialogueExtractBatchProgress) || ttsRunning || renderRunning || isRunning || Boolean(runningScriptChunkId)}>{dialogueExtractingSceneId === scene.id ? "AI đang hoàn thiện…" : "AI tách thoại & bổ sung chi tiết"}</button>}
                    <button className="secondary-button compact" type="button" onClick={() => void generateSceneImage(scene)} disabled={mediaBusy || batchMediaBusy || sceneMediaSettingsSaving || videoQueueRunning || scriptBlocksIndependentTasks || ttsRunning}>{mediaBusy && scene.mediaJob?.kind === "image" ? scene.mediaJob.status === "queued" ? "Đang chờ ảnh…" : "Đang tạo ảnh…" : generatingSceneId === scene.id && generatingSceneMediaKind === "image" ? "Đang xếp ảnh…" : "Tạo ảnh"}</button>
                    <button className="primary-button compact" type="button" onClick={() => void generateSceneVideo(scene)} disabled={mediaBusy || batchMediaBusy || sceneMediaSettingsSaving || videoQueueRunning || scriptBlocksIndependentTasks || ttsRunning}>{mediaBusy && scene.mediaJob?.kind === "video" ? scene.mediaJob.status === "queued" ? "Đang chờ video…" : "Đang tạo video…" : generatingSceneId === scene.id && generatingSceneMediaKind === "video" ? "Đang xếp video…" : hasReadyVideo ? "Tạo lại video" : "Tạo video"}</button>
                  </div>
                  <section className="ai-drama-prompt-editor" aria-label={`Prompt tạo media cho ${sceneNumberLabel(scene)}`}>
                    <div className="ai-drama-prompt-editor-heading"><strong>Prompt chi tiết cho cảnh</strong><span>Ảnh · video · {sceneDuration} giây</span></div>
                    <label><span>Prompt tạo ảnh</span><textarea value={scenePromptDraft.imagePrompt} maxLength={9000} rows={6} onChange={(event) => updateScenePromptDraft(scene, "imagePrompt", event.target.value)} aria-label={`Prompt tạo ảnh ${sceneNumberLabel(scene)}`} placeholder="Chủ thể, hành động, cảm xúc, bố cục, góc máy, ánh sáng, mood và style…" /></label>
                    <label><span>Prompt tạo video theo timeline</span><textarea value={scenePromptDraft.videoPrompt} maxLength={4500} rows={9} onChange={(event) => updateScenePromptDraft(scene, "videoPrompt", event.target.value)} aria-label={`Prompt tạo video ${sceneNumberLabel(scene)}`} placeholder="Chia timecode từ 0 đến hết cảnh; mô tả camera, blocking, acting và gắn nguyên văn thoại đúng nhân vật…" /></label>
                    <div className="ai-drama-prompt-editor-footer"><small>{scenePromptDraft.videoPrompt.length.toLocaleString("vi-VN")} / 4.500 ký tự</small><button className="secondary-button compact" type="button" onClick={() => void saveScenePrompts(scene)} disabled={!scenePromptsChanged || Boolean(scenePromptSavingId) || renderRunning || videoQueueRunning || batchMediaBusy || Boolean(generatingSceneId) || !scenePromptDraft.imagePrompt.trim() || !scenePromptDraft.videoPrompt.trim()}>{scenePromptSavingId === scene.id ? "Đang lưu…" : "Lưu prompt cảnh"}</button></div>
                  </section>
                  <details className="ai-drama-dialogue-editor" open>
                    <summary><strong>Timeline thoại · {dialogueSegments.length} lượt</strong><span>{needsDialogueExtraction ? "Chưa tách từ kịch bản cũ" : "Theo timeline cảnh"} · 0–{sceneDurationSeconds(scene)} giây</span></summary>
                    <div className="ai-drama-dialogue-content">
                      <div className="ai-drama-timeline-overview" aria-label="Phân bổ thời gian cảnh">
                        {sceneTimelineRows(scene, dialogueSegments).map((row, index) => row.kind === "dialogue" && row.segment
                          ? <span className="dialogue" key={`overview-${row.segment.id}`} style={{ flexGrow: Math.max(1, row.endSec - row.startSec) }}><b>{row.startSec.toFixed(1)}–{row.endSec.toFixed(1)}s</b><small>{row.segment.speakerName || characterProfiles.find((item) => item.id === row.segment?.speakerCharacterId)?.name || "Narrator"}</small></span>
                          : <span className="gap" key={`overview-gap-${scene.id}-${index}`} style={{ flexGrow: Math.max(1, row.endSec - row.startSec) }}><b>{row.startSec.toFixed(1)}–{row.endSec.toFixed(1)}s</b><small>Không thoại</small></span>)}
                      </div>
                      {dialogueSegments.length ? <div className="ai-drama-dialogue-list">
                        {dialogueSegments.map((segment, index) => {
                          const durationMs = Number(segment.audio?.durationMs) || 0;
                          const targetDurationMs = segment.endMs === undefined ? undefined : segment.endMs - segment.startMs;
                          const overrunMs = targetDurationMs === undefined || !durationMs ? 0 : Math.max(0, durationMs - targetDurationMs - 150);
                          return <article className="ai-drama-dialogue-line" key={segment.id}>
                            <div className="ai-drama-dialogue-line-heading"><strong>Câu {index + 1}</strong><span>{secondsInput(segment.startMs)}–{secondsInput(segment.endMs ?? segment.startMs + estimateDialogueDurationMs(segment.text))} giây</span><button type="button" className="text-button" onClick={() => updateDialogueDraft(scene.id, (items) => items.filter((item) => item.id !== segment.id))} disabled={ttsRunning || dialogueSavingSceneId === scene.id}>Xóa</button></div>
                            <div className="ai-drama-dialogue-line-fields">
                              <label>Nhân vật<select value={segment.speakerCharacterId || ""} onChange={(event) => {
                                const selected = characterProfiles.find((character) => character.id === event.target.value);
                                updateDialogueDraft(scene.id, (items) => items.map((item) => item.id === segment.id ? { ...item, speakerCharacterId: selected?.id || undefined, speakerName: selected?.name || "NARRATOR", audio: undefined, translatedAudio: undefined } : item));
                              }} disabled={ttsRunning || dialogueSavingSceneId === scene.id}>
                                <option value="">Narrator / voice mặc định</option>
                                {characterProfiles.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                              </select></label>
                              <label>Bắt đầu (giây)<input type="number" min="0" max={Math.max(0, sceneDurationSeconds(scene) - 0.1)} step="0.1" value={secondsInput(segment.startMs)} onChange={(event) => updateDialogueDraft(scene.id, (items) => items.map((item) => item.id === segment.id ? { ...item, startMs: Math.round(Math.max(0, Math.min(sceneDurationSeconds(scene) * 1000 - 100, (Number(event.target.value) || 0) * 1000))) } : item))} disabled={ttsRunning || dialogueSavingSceneId === scene.id} /></label>
                              <label>Kết thúc (giây)<input type="number" min={secondsInput(segment.startMs + 100)} max={sceneDurationSeconds(scene)} step="0.1" placeholder="Theo audio" value={secondsInput(segment.endMs)} onChange={(event) => updateDialogueDraft(scene.id, (items) => items.map((item) => {
                                if (item.id !== segment.id) return item;
                                const endMs = event.target.value === "" ? undefined : Math.round(Math.max(item.startMs + 100, Math.min(sceneDurationSeconds(scene) * 1000, Number(event.target.value) * 1000)));
                                if (endMs === undefined) {
                                  const rest = { ...item };
                                  delete rest.endMs;
                                  return rest;
                                }
                                return { ...item, endMs };
                              }))} disabled={ttsRunning || dialogueSavingSceneId === scene.id} /></label>
                            </div>
                            <textarea value={segment.text} rows={2} maxLength={2000} aria-label={`Lời thoại câu ${index + 1}`} onChange={(event) => updateDialogueDraft(scene.id, (items) => items.map((item) => {
                              if (item.id !== segment.id) return item;
                              return { ...item, text: event.target.value, audio: undefined, translations: undefined, translatedAudio: undefined };
                            }))} disabled={ttsRunning || dialogueSavingSceneId === scene.id} />
                            <div className="ai-drama-dialogue-translation">
                              <label><span>{voiceLanguageLabel(dialogueTranslationLanguage)}</span><textarea value={segment.translations?.[dialogueTranslationLanguage] || ""} rows={2} maxLength={2000} aria-label={`Bản dịch ${voiceLanguageLabel(dialogueTranslationLanguage)} câu ${index + 1}`} placeholder="Bản dịch lời thoại sẽ hiện ở đây" onChange={(event) => updateDialogueDraft(scene.id, (items) => items.map((item) => {
                                if (item.id !== segment.id) return item;
                                const translations = { ...(item.translations || {}), [dialogueTranslationLanguage]: event.target.value };
                                const translatedAudio = { ...(item.translatedAudio || {}) };
                                delete translatedAudio[dialogueTranslationLanguage];
                                return { ...item, translations, translatedAudio };
                              }))} disabled={ttsRunning || dialogueSavingSceneId === scene.id} /></label>
                              {segment.translatedAudio?.[dialogueTranslationLanguage]?.localPath && <audio controls preload="none" src={`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(scene.id)}/tts?segmentId=${encodeURIComponent(segment.id)}&language=${encodeURIComponent(dialogueTranslationLanguage)}`}>Trình duyệt không hỗ trợ phát audio.</audio>}
                            </div>
                            {overrunMs > 0 && <small className="ai-drama-dialogue-overrun">Audio dài hơn khoảng timecode {(overrunMs / 1000).toFixed(1)} giây; hãy nới cue hoặc dời câu sau.</small>}
                          </article>;
                        })}
                      </div> : <div className="ai-drama-empty compact"><strong>Cảnh chưa có câu thoại</strong><span>Thêm câu thủ công hoặc dán SRT theo timecode của riêng cảnh này.</span></div>}
                      <div className="ai-drama-dialogue-actions">
                        <button type="button" className="secondary-button compact" onClick={() => void translateSceneDialogue(scene)} disabled={!dialogueSegments.length || Boolean(dialogueTranslationSceneId) || Boolean(dialogueTranslationBatchProgress) || Boolean(dialogueTtsBatchProgress) || ttsRunning || renderRunning || dialogueSavingSceneId === scene.id}>{dialogueTranslationSceneId === scene.id ? "Đang dịch cảnh…" : `Dịch cảnh sang ${voiceLanguageLabel(dialogueTranslationLanguage)}`}</button>
                        <button type="button" className="secondary-button compact" onClick={() => addDialogueSegment(scene)} disabled={ttsRunning || dialogueSavingSceneId === scene.id}>Thêm câu</button>
                        <button type="button" className="secondary-button compact" onClick={() => void saveDialogueSegments(scene)} disabled={ttsRunning || dialogueSavingSceneId === scene.id}>{dialogueSavingSceneId === scene.id ? "Đang lưu…" : "Lưu timeline"}</button>
                      </div>
                      <details className="ai-drama-timeline-optional">
                        <summary>Voice & TTS tùy chọn<span>{readyLineCount}/{dialogueSegments.length} câu có audio</span></summary>
                        <div>
                          <button type="button" className="primary-button compact" onClick={() => void generateSceneTts(scene, dialogueSegments.length > 0 && readyLineCount === dialogueSegments.length)} disabled={!dialogueSegments.length || missingLineVoice || ttsRunning || renderRunning || scriptBlocksIndependentTasks || batchMediaBusy || videoQueueRunning || Boolean(dialogueTtsBatchProgress) || Boolean(generatingSceneId) || dialogueSavingSceneId === scene.id}>{ttsRunning && ttsSceneId === scene.id ? "Đang tạo audio…" : readyLineCount === dialogueSegments.length && dialogueSegments.length ? "Tạo lại audio" : `Tạo TTS · ${dialogueSegments.length - readyLineCount} câu`}</button>
                          {sceneHasTts && <button type="button" className="secondary-button compact episode-delete-tts-button" onClick={() => void deleteChunkTts(scene.chunkId, project.chunks.findIndex((chunk) => chunk.id === scene.chunkId) + 1, scene.id)} disabled={Boolean(deletingTtsChunkId) || ttsRunning || renderRunning || isRunning || Boolean(runningScriptChunkId) || scriptBlocksIndependentTasks || batchMediaBusy || videoQueueRunning || Boolean(generatingSceneId) || Boolean(dialogueTranslationSceneId) || Boolean(dialogueTranslationBatchProgress) || Boolean(dialogueTtsBatchProgress) || Boolean(dialogueSavingSceneId)}>{deletingTtsChunkId === scene.chunkId ? "Đang xoá…" : "Xoá TTS cảnh"}</button>}
                          {missingLineVoice && <small>Gán voice trong hồ sơ nhân vật hoặc dùng voice mặc định của project.</small>}
                          {dialogueSegments.filter((segment) => segment.audio?.localPath).map((segment) => <label key={`audio-${segment.id}`}><span>{segment.speakerName || characterProfiles.find((character) => character.id === segment.speakerCharacterId)?.name || "Narrator"} · {segment.text}</span><audio controls preload="none" src={`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(scene.id)}/tts?segmentId=${encodeURIComponent(segment.id)}`}>Trình duyệt không hỗ trợ phát audio.</audio></label>)}
                        </div>
                      </details>
                      <details className="ai-drama-srt-import">
                        <summary>Dán SRT cho cảnh này</summary>
                        <textarea value={dialogueSrtDrafts[scene.id] || ""} onChange={(event) => setDialogueSrtDrafts((current) => ({ ...current, [scene.id]: event.target.value }))} rows={5} placeholder={"1\n00:00:02,400 --> 00:00:04,100\n[An] Đừng đi!\n\n2\n00:00:05,100 --> 00:00:07,300\n[Bình] Anh phải nói thật."} aria-label={`Dán SRT cho ${scene.id}`} />
                        <small>Timecode tính từ đầu cảnh, trong 0–{sceneDurationSeconds(scene)} giây. Có thể ghi [Tên nhân vật] trước lời thoại.</small>
                        <button type="button" className="secondary-button compact" onClick={() => importDialogueSrt(scene)} disabled={ttsRunning || dialogueSavingSceneId === scene.id}>Nạp cue SRT vào timeline</button>
                      </details>
                    </div>
                  </details>
                </div></div>
                }
              </Fragment>;
            })}
            </div>
          </div>}
        </section>}
      </section>
  ) : null;

  return (
    <div className="project-dashboard">
      <section className="page-heading">
        <div><div className="eyebrow"><span className="eyebrow-dot" />PROJECT / {preset.shortLabel.toUpperCase()}</div><h1>{project.title}</h1></div>
        <div className="heading-actions">
          <StatusPill tone={project.status === "draft" ? "gray" : project.status === "needs_review" ? "red" : "orange"}>{project.status === "draft" ? "Bản nháp" : project.status === "needs_review" ? "Cần review" : "Đang xử lý"}</StatusPill>
          <Link className="secondary-button" href={`/projects/${project.slug}/settings`}><Icon name="sliders" size={15} />Tùy chỉnh</Link>
          <button className="secondary-button" type="button" onClick={() => setShowExtendEpisodes(true)} disabled={episodeExtensionBusy || project.scriptMode === "manual"} title={project.scriptMode === "manual" ? "Chưa hỗ trợ nối tập tự động cho project kịch bản thủ công." : episodeExtensionBusy ? "Đợi tác vụ hiện tại hoàn tất rồi thêm tập." : "Nối thêm tập vào project đang có"}><Icon name="plus" size={15} />Thêm tập</button>
          <button className="primary-button" onClick={runNextChunk} disabled={scriptActionBusy() || project.completedScenes >= project.totalScenes}><Icon name="play" size={15} />{isRunning || runningScriptChunkId ? project.presetId === "ai-drama" ? "Đang tạo kịch bản…" : "Đang xử lý kịch bản + media + audio…" : "Tạo kịch bản tập tiếp"}</button>
        </div>
      </section>

      <>

      <nav className="project-step-nav" aria-label="Các bước trong dự án">
        <a href="#source"><span>01</span>Nguồn</a>
        <a href="#episodes"><span>02</span>Tập & kịch bản</a>
        <a href="#scenes"><span>03</span>{project.presetId === "ai-drama" ? "AI Drama" : "Cảnh & media"}</a>
        {hasEpisodeScripts && <a href="#publishing-package"><span>04</span>Title & thumbnail</a>}
        <a href="#export"><span>{hasEpisodeScripts ? "05" : "04"}</span>QA & xuất</a>
      </nav>
      <section className="project-meta-row">
        <div className="meta-chip"><Icon name="clock" size={16} /><span>{project.durationMinutes} phút</span></div>
        <div className="meta-chip"><Icon name="stack" size={16} /><span>{project.totalChunks} tập</span></div>
        <div className="meta-chip"><Icon name="play" size={16} /><span>Ngôn ngữ video · {voiceLanguageLabel(project.language)}</span></div>
        <div className="meta-chip"><Icon name="users" size={16} /><span>{project.voiceName || "OmniVoice mặc định"} · hồ sơ {voiceLanguageLabel(project.voiceLanguage || project.language)}</span></div>
      </section>

      <section className="hero-grid" id="source"><div className="progress-card panel-card"><div className="card-heading"><div><div className="section-kicker">TIẾN ĐỘ</div><h2>Tiến độ sản xuất</h2></div><StatusPill tone={project.completedScenes >= project.totalScenes ? "green" : "orange"}>{progress}%</StatusPill></div><div className="progress-main"><div className="progress-ring" style={{ background: `conic-gradient(#766ce8 0 ${progress}%, #efeff8 ${progress}% 100%)` }}><div className="ring-inner"><strong>{progress}<span>%</span></strong><small>hoàn tất</small></div></div><div className="progress-copy"><div className="progress-title">{project.completedScenes} <span>/ {project.totalScenes} cảnh</span></div><div className="progress-bar large"><span style={{ width: `${progress}%` }} /></div><div className="progress-foot"><span><span className="green-check"><Icon name="check" size={13} /></span>{project.completedChunks} / {project.totalChunks} gói đã xong</span><span>AI cần sửa: {project.aiReviewCount || sceneStats.ai_needs_changes} · Người dùng cần xử lý: {project.reviewCount}</span></div></div></div></div><div className="source-card panel-card"><div className="card-heading"><div><div className="section-kicker">NGUỒN</div><h2>{project.scriptMode === "manual" ? "Kịch bản đầu vào" : "Nguồn đầu vào"}</h2></div><span className="source-badge">{project.language.toUpperCase()}</span></div><label className="input-label">Video URL</label><div className="url-input-wrap"><Icon name="link" size={16} /><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} aria-label="Video URL" /><button onClick={saveSource}><Icon name="save" size={15} /></button></div><label className="input-label compact-label">{project.scriptMode === "manual" ? "Kịch bản thủ công" : "Transcript / brief"}</label><textarea className="source-textarea" value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder={project.scriptMode === "manual" ? "Nhập kịch bản…" : "Nhập transcript hoặc brief…"} /><div className="source-foot"><span><span className="source-status-dot" />{project.sourceStatus === "ready" ? project.scriptMode === "manual" ? "Kịch bản đã lưu" : "Transcript đã sẵn sàng" : project.continuityContext ? `Continuity đã khóa đến ${project.continuityContext.chunkId}` : "Continuity sẽ được tạo sau chunk đầu tiên"}</span><button onClick={saveSource}>{sourceUrl.trim() && !sourceText.trim() && project.scriptMode !== "manual" ? "Lưu & lấy transcript" : project.scriptMode === "manual" ? "Lưu kịch bản" : "Lưu nguồn"} <Icon name="arrow" size={13} /></button></div><div className="provider-note"><span className="provider-mark">O</span><span>{project.scriptMode === "manual" ? "Script Studio · phân tích tùy chọn" : "Script LLM ·"} <strong>{project.scriptMode === "manual" ? project.scriptModel : "OpenAI Responses API"}</strong></span></div></div></section>

      {project.presetId !== "ai-drama" && runMessage && <div className={`run-message ${runMessage.tone}`}><span><Icon name={runMessage.tone === "success" ? "check" : "alert"} size={13} /></span>{runMessage.text}</div>}

      <details className="config-overview panel-card">
        <summary>
          <span><strong>Cấu hình dự án</strong><small>Ảnh {mediaGeneration.imageModel} · Video {mediaGeneration.videoModel} · {mediaGeneration.videoDurationMode === "scene" ? "thời lượng theo cảnh" : `${mediaGeneration.videoDurationSec}s cố định`}</small></span>
          <span className="config-overview-action">Xem / sửa</span>
        </summary>
        <div className="config-items">
          <div><small>Model ảnh</small><strong>{mediaGeneration.imageModel} · {mediaGeneration.imageQuality}{projectImageDetailLevels.length ? ` · ${IMAGE_DETAIL_LEVEL_LABELS[mediaGeneration.imageDetailLevel]}` : ""}</strong></div>
          <div><small>Model video</small><strong>{mediaGeneration.videoModel} · {mediaGeneration.videoQuality}</strong></div>
          <div><small>Thời lượng video</small><strong>{mediaGeneration.videoDurationMode === "scene" ? "Theo cảnh" : `${mediaGeneration.videoDurationSec}s cố định`}</strong></div>
          <div><small>Khung hình</small><strong>{project.aspectRatio}</strong></div>
          <div><small>Thể loại câu chuyện</small><strong>{contentGenresLabel(project.contentGenre, project.secondaryGenres)}</strong></div>
          <div><small>Bối cảnh thời đại</small><strong>{storySettingLabel(project.storySetting)}{project.settingNotes ? ` · ${project.settingNotes}` : ""}</strong></div>
          <div><small>Phong cách hình ảnh</small><strong>{project.imageStyle}</strong></div>
          <div><small>Nguồn media</small><strong>{mediaSourceLabel(project.mediaSource)}</strong></div>
          <div><small>Kịch bản</small><strong>{project.scriptMode === "manual" ? "Thủ công" : `AI · ${project.scriptModel}`}</strong></div>
        </div>
        <Link href={`/projects/${project.slug}/settings`} className="config-edit"><Icon name="sliders" size={14} />Mở cài đặt</Link>
      </details>

      <ShortDramaStudio project={project} sourceDirty={sourceText.trim() !== project.sourceText.trim()} />

      <section className="chunks-card panel-card" id="episodes">
        <div className="chunks-heading">
          <div><div className="section-kicker">TẬP</div><h2>Tập & kịch bản</h2></div>
          <div className="episode-heading-actions">
            <button className="primary-button compact" type="button" onClick={openEpisodeScriptEditor} disabled={importingScripts || episodeExtensionBusy || !project.chunks.length} title="Soạn tay hoặc dùng mẫu JSON cho một tập rồi nhập trực tiếp vào project">
              <Icon name="file" size={14} />Soạn / nhập từng tập
            </button>
            <button className="secondary-button compact" type="button" onClick={() => void generateAllEpisodeTts()} disabled={ttsRunning || renderRunning || scriptBlocksIndependentTasks || batchMediaBusy || videoQueueRunning || Boolean(generatingSceneId) || pendingEpisodeTts.length === 0}>
              <Icon name="spark" size={14} />{batchTtsProgress ? `Đang tạo TTS ${batchTtsProgress}` : pendingEpisodeTts.length ? `Tạo TTS hàng loạt · ${pendingEpisodeTts.length}` : project.chunks.some((chunk) => chunk.outputPath) ? "Đã xử lý TTS" : "Chưa có kịch bản"}
            </button>
            <button className="primary-button compact" type="button" onClick={() => void renderAllEpisodes()} disabled={renderRunning || ttsRunning || isRunning || Boolean(runningScriptChunkId) || pendingEpisodeRenders.length === 0}>
              <Icon name="play" size={14} />{batchRenderProgress ? `Đang ghép ${batchRenderProgress}` : pendingEpisodeRenders.length ? `Ghép hàng loạt · ${pendingEpisodeRenders.length}` : project.chunks.some((chunk) => chunk.outputPath) ? "Đã ghép hết" : "Chưa có kịch bản"}
            </button>
            <Link className="secondary-button compact" href={`/projects/${project.slug}/settings`}><Icon name="sliders" size={15} />Cấu hình chunk</Link>
          </div>
        </div>
        <div className="tabs-row"><div className="tabs" role="group" aria-label="Lọc tập">{["Tất cả", "Đang xử lý", "Cần review"].map((filter) => <button type="button" key={filter} aria-pressed={activeFilter === filter} className={`tab ${activeFilter === filter ? "active" : ""}`} onClick={() => setActiveFilter(filter)}>{filter}{filter === "Cần review" && <span className="tab-count">{project.reviewCount}</span>}</button>)}</div><span className="sort-button">{project.totalChunks} tập</span></div>
        <div className="chunk-table">
          <div className="chunk-table-head"><span>TẬP</span><span>PHẠM VI</span><span>TIẾN ĐỘ CẢNH</span><span>KỊCH BẢN</span><span>XUẤT VIDEO / SRT</span><span>CẬP NHẬT</span></div>
          {visibleChunks.map((chunk) => {
            const renderFileBase = `/api/projects/${encodeURIComponent(project.slug)}/chunks/${encodeURIComponent(chunk.id)}/render/file`;
            const episodeScenes = scenes.filter((scene) => scene.chunkId === chunk.id);
            const episodeHasTts = Number(chunk.tts?.completed) > 0 || episodeScenes.some((scene) => {
              const sceneAudio = [scene.audio, scene.voice, scene.tts].some((value) => {
                if (!value || typeof value !== "object" || Array.isArray(value)) return false;
                const record = value as Record<string, unknown>;
                return Boolean(record.localPath || record.path || record.filePath || record.file_path);
              });
              return sceneAudio || sceneDialogueSegments(scene, characterProfiles).some((segment) => Boolean(
                segment.audio?.localPath || Object.values(segment.translatedAudio || {}).some((audio) => audio?.localPath),
              ));
            });
            const translatedRender = chunk.render?.localizedRenders?.[dialogueTranslationLanguage];
            const localizedDialogue = episodeScenes.flatMap((scene) => sceneDialogueSegments(scene, characterProfiles));
            const episodeVoiceTargets = dialogueTtsVoiceTargetsForScenes(episodeScenes, dialogueTranslationLanguage);
            const episodeNeedsTranslation = localizedDialogue.some((segment) => !segment.translations?.[dialogueTranslationLanguage]?.trim());
            const episodeMissingVoice = episodeScenes.some((scene) => {
              const segments = sceneDialogueSegments(scene, characterProfiles);
              if (!segments.length || segments.some((segment) => !segment.translations?.[dialogueTranslationLanguage]?.trim())) return false;
              return segments.some((segment) => {
                const speaker = characterProfiles.find((character) => character.id === segment.speakerCharacterId);
                return !(speaker?.voiceId || scene.ttsVoiceId || scene.tts_voice_id || project.voiceId);
              });
            });
            const hasNarrationWithoutTimeline = episodeScenes.some((scene) => {
              const hasNarration = Boolean(sceneText(scene, "dialogue_or_voiceover", "voiceText", "voiceover"));
              return hasNarration && !sceneDialogueSegments(scene, characterProfiles).length;
            });
            const translatedVoiceReady = project.presetId === "ai-drama"
              && dialogueTranslationLanguage.toLowerCase() !== String(project.language || "vi").toLowerCase()
              && localizedDialogue.length > 0
              && !hasNarrationWithoutTimeline
              && localizedDialogue.every((segment) => {
                const translatedAudio = segment.translatedAudio?.[dialogueTranslationLanguage];
                return Boolean(segment.translations?.[dialogueTranslationLanguage]?.trim()
                  && translatedAudio?.localPath
                  && (translatedAudio.language || "").toLowerCase() === dialogueTranslationLanguage.toLowerCase());
              });
            const localizedRenderTitle = !translatedVoiceReady
              ? dialogueTranslationLanguage.toLowerCase() === String(project.language || "vi").toLowerCase()
                ? "Chọn ngôn ngữ khác ngôn ngữ gốc của project."
                : hasNarrationWithoutTimeline
                  ? "Hoàn thiện timeline thoại của các cảnh trước."
                  : "Dịch lời thoại và tạo voice cho mọi câu trong tập trước."
              : `Ghép hình/video hiện có với voice ${voiceLanguageLabel(dialogueTranslationLanguage)}.`;
            const isRenderingThisChunk = renderRunning && renderingChunkId === chunk.id && !renderingLanguage;
            const isRenderingLocalizedThisChunk = renderRunning && renderingChunkId === chunk.id && renderingLanguage === dialogueTranslationLanguage;
            const isViewingScript = viewingScriptChunkId === chunk.id;
            const isRunningThisScript = runningScriptChunkId === chunk.id;
            const isGeneratingThisTts = ttsRunning && ttsChunkId === chunk.id;
            const isDeletingThisTts = deletingTtsChunkId === chunk.id;
            return <Fragment key={chunk.id}>
              <div className="chunk-row">
                <div className="chunk-id chunk-episode"><span className={`chunk-icon ${chunk.tone}`}><Icon name="scene" size={15} /></span><span><strong>Tập {String(chunk.episodeNumber).padStart(2, "0")}</strong><small>{chunk.id}</small></span></div>
                <span className="chunk-range">{chunk.range}</span>
                <div className="chunk-progress"><div className="mini-progress"><span style={{ width: `${(Number(chunk.scenes.split("/")[0]) / Number(chunk.scenes.split("/")[1])) * 100}%` }} /></div><span>{chunk.scenes}</span></div>
                <div className="episode-script-actions">
                  <StatusPill tone={chunk.tone}>{chunk.label}</StatusPill>
                  <div className="episode-script-controls">
                    {chunk.hasScript && <button className="text-button episode-script-view" type="button" aria-expanded={isViewingScript} onClick={() => setViewingScriptChunkId(isViewingScript ? "" : chunk.id)}><Icon name="file" size={13} />{isViewingScript ? "Ẩn" : "Xem kịch bản"}</button>}
                    <button className="text-button episode-script-run" type="button" onClick={() => void runScriptChunk(chunk.id, chunk.episodeNumber)} disabled={!chunk.canRunScript || scriptActionBusy()} title={chunk.canRunScript ? "Chạy riêng kịch bản cho tập này" : chunk.status === "done" ? "Tập đã có kịch bản" : chunk.status === "running" ? "Tập đang chạy" : "Không thể chạy tập này"}>
                      <Icon name="play" size={12} />{isRunningThisScript ? project.presetId === "ai-drama" ? "Đang viết script…" : "Script + media + audio…" : chunk.canRunScript ? chunk.status === "review" ? "Chạy lại" : "Chạy kịch bản" : chunk.status === "running" ? "Đang chạy…" : "Đã tạo"}
                    </button>
                  </div>
                </div>
                <div className="chunk-export-actions">
                  {isGeneratingThisTts
                    ? <StatusPill tone="orange">TTS {chunk.tts?.completed || 0}/{chunk.tts?.total || 0}</StatusPill>
                    : chunk.tts?.status !== "not_needed" && <button className="secondary-button compact episode-render-button" type="button" onClick={() => void generateChunkTts(chunk.id, chunk.episodeNumber, chunk.tts?.status === "completed")} disabled={!chunk.hasScript || ttsRunning || renderRunning || scriptBlocksIndependentTasks || batchMediaBusy || videoQueueRunning || Boolean(generatingSceneId)} title={chunk.tts?.status === "completed" ? "Tạo lại TTS cho tập này" : "Tạo TTS cho tập này"}>
                      <Icon name="spark" size={13} />{chunk.tts?.status === "completed" ? "Tạo lại TTS" : chunk.tts?.status === "partial" || chunk.tts?.status === "failed" || chunk.tts?.status === "running" ? "Thử lại TTS" : "Tạo TTS"}
                    </button>}
                  {chunk.tts && chunk.tts.status !== "not_needed" && (chunk.tts.completed > 0 || chunk.tts.failed > 0) && <small className={chunk.tts.failed ? "episode-render-error" : "episode-render-note"} title={chunk.tts.error}>{chunk.tts.status === "completed" ? `TTS sẵn sàng · ${chunk.tts.completed}/${chunk.tts.total} ${project.presetId === "ai-drama" ? "câu" : "cảnh"}` : `TTS ${chunk.tts.completed}/${chunk.tts.total}${chunk.tts.failed ? ` · ${chunk.tts.failed} lỗi` : ""}`}</small>}
                  {episodeHasTts && <button className="secondary-button compact episode-render-button episode-delete-tts-button" type="button" onClick={() => void deleteChunkTts(chunk.id, chunk.episodeNumber)} disabled={Boolean(deletingTtsChunkId) || ttsRunning || renderRunning || isRunning || Boolean(runningScriptChunkId) || scriptBlocksIndependentTasks || batchMediaBusy || videoQueueRunning || Boolean(generatingSceneId) || Boolean(dialogueTranslationSceneId) || Boolean(dialogueTranslationBatchProgress) || Boolean(dialogueTtsBatchProgress) || Boolean(dialogueSavingSceneId)} title={`Xoá tất cả TTS gốc và voice bản dịch của Tập ${String(chunk.episodeNumber).padStart(2, "0")} để ghép bằng tiếng gốc video`}>{isDeletingThisTts ? "Đang xoá TTS…" : "Xoá TTS"}</button>}
                  {project.presetId === "ai-drama" && <button className="secondary-button compact episode-render-button" type="button" onClick={() => void generateFilteredDialogueTts(chunk.id, chunk.episodeNumber)} disabled={!episodeVoiceTargets.length || Boolean(dialogueTtsBatchProgress) || Boolean(dialogueTranslationSceneId) || Boolean(dialogueTranslationBatchProgress) || ttsRunning || renderRunning || dialogueSavingSceneId !== "" || isRunning || Boolean(runningScriptChunkId) || Boolean(generatingSceneId) || batchMediaBusy || videoQueueRunning} title={episodeVoiceTargets.length ? `Tạo voice ${voiceLanguageLabel(dialogueTranslationLanguage)} cho ${episodeVoiceTargets.length} cảnh trong Tập ${String(chunk.episodeNumber).padStart(2, "0")}` : episodeNeedsTranslation ? `Dịch thoại sang ${voiceLanguageLabel(dialogueTranslationLanguage)} trước khi tạo voice.` : episodeMissingVoice ? "Gán voice cho nhân vật đang thoại trước." : `Tập này đã có voice ${voiceLanguageLabel(dialogueTranslationLanguage)} hoặc chưa có thoại.`}>{dialogueTtsBatchProgress ? `Đang tạo voice ${voiceLanguageLabel(dialogueTranslationLanguage)}…` : episodeVoiceTargets.length ? `Tạo voice ${voiceLanguageLabel(dialogueTranslationLanguage)} · ${episodeVoiceTargets.length}` : episodeNeedsTranslation ? `Dịch ${voiceLanguageLabel(dialogueTranslationLanguage)} trước` : episodeMissingVoice ? "Gán voice nhân vật trước" : localizedDialogue.length ? `Đủ voice ${voiceLanguageLabel(dialogueTranslationLanguage)}` : "Không có thoại"}</button>}
                  {chunk.render?.status === "running" || isRenderingThisChunk
                    ? <StatusPill tone="orange">{batchRenderProgress ? `Ghép ${batchRenderProgress}` : "Đang ghép"}</StatusPill>
                    : <button className="secondary-button compact episode-render-button" type="button" onClick={() => void renderChunkVideo(chunk.id, chunk.episodeNumber)} disabled={renderRunning || ttsRunning || isRunning || Boolean(runningScriptChunkId) || !project.chunks.find((item) => item.id === chunk.id)?.outputPath}><Icon name="play" size={13} />{chunk.render?.outputPath ? "Xuất lại" : chunk.render?.status === "failed" ? "Thử lại" : "Ghép tập"}</button>}
                  {project.presetId === "ai-drama" && <button className="secondary-button compact episode-render-button" type="button" title={localizedRenderTitle} onClick={() => void renderChunkVideo(chunk.id, chunk.episodeNumber, dialogueTranslationLanguage)} disabled={!translatedVoiceReady || renderRunning || ttsRunning || isRunning || Boolean(runningScriptChunkId) || !chunk.hasScript}>{isRenderingLocalizedThisChunk || translatedRender?.status === "running" ? `Đang ghép ${voiceLanguageLabel(dialogueTranslationLanguage)}…` : translatedRender?.outputPath ? `Xuất lại · ${voiceLanguageLabel(dialogueTranslationLanguage)}` : `Ghép tập · ${voiceLanguageLabel(dialogueTranslationLanguage)}`}</button>}
                  {chunk.render?.outputPath && (chunk.render.status === "completed" || chunk.render.stale) && <div className="episode-download-links"><a href={`${renderFileBase}?kind=video&download=1`} download={`tap-${String(chunk.episodeNumber).padStart(2, "0")}.mp4`}><Icon name="download" size={12} />{chunk.render.stale ? "MP4 bản cũ" : "MP4"}</a><a href={`${renderFileBase}?kind=subtitle&download=1`} download={`tap-${String(chunk.episodeNumber).padStart(2, "0")}.srt`}>{chunk.render.stale ? "SRT bản cũ" : "SRT"}</a></div>}
                  {translatedRender?.outputPath && (translatedRender.status === "completed" || translatedRender.stale) && <div className="episode-download-links"><a href={`${renderFileBase}?kind=video&language=${encodeURIComponent(dialogueTranslationLanguage)}&download=1`} download={`tap-${String(chunk.episodeNumber).padStart(2, "0")}-${dialogueTranslationLanguage.toLowerCase()}.mp4`}><Icon name="download" size={12} />MP4 {voiceLanguageLabel(dialogueTranslationLanguage)}</a><a href={`${renderFileBase}?kind=subtitle&language=${encodeURIComponent(dialogueTranslationLanguage)}&download=1`} download={`tap-${String(chunk.episodeNumber).padStart(2, "0")}-${dialogueTranslationLanguage.toLowerCase()}.srt`}>SRT {voiceLanguageLabel(dialogueTranslationLanguage)}</a></div>}
                  {chunk.render?.outputPath && (chunk.render.status === "idle" || chunk.render.stale) && <small className="episode-render-note">Media/kịch bản đã đổi · cần ghép lại</small>}
                  {chunk.render?.status === "completed" && (!chunk.render.audioReady || Boolean(chunk.render.missingMedia)) && <small className="episode-render-note">{[!chunk.render.audioReady ? "Không có tiếng TTS hoặc tiếng gốc" : "", chunk.render.missingMedia ? `${chunk.render.missingMedia} cảnh dùng media dự phòng` : ""].filter(Boolean).join(" · ")}</small>}
                  {chunk.render?.status === "failed" && chunk.render.error && <small className="episode-render-error" title={chunk.render.error}>Lần xuất gần nhất lỗi</small>}
                </div>
                <span className="chunk-time">{chunk.time}</span>
              </div>
              {isViewingScript && <div className="episode-script-preview">
                <div className="episode-script-preview-heading"><div><strong>Kịch bản Tập {String(chunk.episodeNumber).padStart(2, "0")}</strong><span>{episodeScenes.length} cảnh đã lưu</span></div><button className="text-button" type="button" onClick={() => setViewingScriptChunkId("")}>Đóng</button></div>
                {scenesLoading ? <p className="episode-script-empty">Đang tải kịch bản…</p> : episodeScenes.length ? <div className="episode-script-scene-list">{episodeScenes.map((scene) => {
                  const purpose = sceneText(scene, "purpose", "beat_summary", "description");
                  const voiceover = sceneText(scene, "dialogue_or_voiceover", "voiceText", "voiceover");
                  const prompt = sceneText(scene, "video_prompt", "videoPrompt", "image_prompt", "imagePrompt");
                  return <article className="episode-script-scene" key={`${scene.chunkId}-${scene.id}`}><span className="episode-script-scene-number">{sceneNumberLabel(scene)}</span><div><strong>{purpose || "Mô tả cảnh"}</strong>{voiceover && <p><b>Lời thoại:</b> {voiceover}</p>}{prompt && <p><b>Prompt:</b> {prompt}</p>}</div></article>;
                })}</div> : <p className="episode-script-empty">Chưa có cảnh để hiển thị. Chạy kịch bản tập này trước.</p>}
              </div>}
            </Fragment>;
          })}
        </div>
        <div className="table-footer"><span>Hiển thị {visibleChunks.length} / {project.totalChunks} tập</span><Link className="text-button" href={`/projects/${project.slug}/settings`}>Quản lý project <Icon name="arrow" size={13} /></Link></div>
      </section>
      {usesAiDramaWorkflow() ? aiDramaWorkspace : <section className="scene-review-card panel-card" id="scenes">
        <div className="chunks-heading scene-review-heading">
          <div>
            <div className="section-kicker">CẢNH & MEDIA</div>
            <h2>Kiểm tra từng cảnh & tạo video AI</h2>
          </div>
          <div className="scene-review-heading-actions">
            <button className="secondary-button compact" type="button" onClick={() => void runAiPrecheck()} disabled={aiReviewRunning || scenesLoading || !scenes.length}>
              <Icon name="spark" size={14} />{aiReviewRunning ? aiReviewProgress || "AI đang chấm…" : "Chạy AI pre-check"}
            </button>
            <span className="scene-output-badge"><span className="scene-output-icon"><Icon name="scene" size={14} /></span>{scenes.length}/{project.totalScenes} cảnh có output</span>
          </div>
        </div>
        <details id="character-reference-panel" className="character-reference-panel">
          <summary className="character-reference-heading">
                <div><div className="section-kicker">CHARACTER REFERENCES</div><h3>Hồ sơ nhân vật</h3></div>
            <span className="character-reference-count">{characterProfiles.length} nhân vật · Quản lý</span>
          </summary>
          {characterProfiles.length > 0 && <div className="character-reference-list">
            {characterProfiles.map((character) => {
              const assignedCount = scenes.filter((scene) => sceneCharacterIds(scene).includes(character.id)).length;
              return <article className="character-reference-item" key={character.id}>
                {character.referenceImagePath ? <img src={`/api/projects/${encodeURIComponent(project.slug)}/characters/${encodeURIComponent(character.id)}/image`} alt={`Ảnh tham chiếu ${character.name}`} /> : <div className="character-reference-image-empty"><Icon name="users" size={18} /><span>Chưa có ảnh</span></div>}
                <div><strong>{character.name}</strong><p>{character.description || "Chưa có mô tả nhận diện"}</p><small>Đã gán {assignedCount} cảnh</small></div>
              </article>;
            })}
          </div>}
          <form className="character-reference-form" onSubmit={(event) => void createCharacter(event)}>
            <label htmlFor="character-name"><span>Tên nhân vật</span><input id="character-name" value={characterName} onChange={(event) => setCharacterName(event.target.value)} maxLength={80} placeholder="Ví dụ: Maya Chen" required /></label>
            <label className="character-reference-description"><span>Mô tả nhận diện</span><input value={characterDescription} onChange={(event) => setCharacterDescription(event.target.value)} maxLength={300} placeholder="Tóc đen ngang vai, nốt ruồi dưới mắt trái, áo khoác xanh…" /></label>
            <div className="character-reference-image-picker">
              <div className="character-reference-image-tabs" role="group" aria-label="Nguồn ảnh nhân vật">
                <button className={characterImageSource === "upload" ? "active" : ""} type="button" aria-pressed={characterImageSource === "upload"} onClick={() => { setCharacterImageSource("upload"); setSelectedCharacterMediaSceneId(""); setSelectedMaiVideoImageId(""); }}>Tải ảnh lên</button>
                <button className={characterImageSource === "project" ? "active" : ""} type="button" aria-pressed={characterImageSource === "project"} onClick={() => { setCharacterImageSource("project"); setSelectedMaiVideoImageId(""); if (characterImageInputRef.current) characterImageInputRef.current.value = ""; }}>{`Ảnh project · ${characterMediaImages.length}`}</button>
                <button className={characterImageSource === "maivideo" ? "active" : ""} type="button" aria-pressed={characterImageSource === "maivideo"} onClick={() => { setCharacterImageSource("maivideo"); setSelectedCharacterMediaSceneId(""); if (characterImageInputRef.current) characterImageInputRef.current.value = ""; void loadMaiVideoLibraryImages(); }}>{`Thư viện MaiVideo${maiVideoLibraryLoaded ? ` · ${maiVideoLibraryImages.length}` : ""}`}</button>
              </div>
              {characterImageSource === "upload" ? <label className="character-reference-file"><span>Ảnh hồ sơ nhân vật</span><input ref={characterImageInputRef} type="file" accept="image/png,image/jpeg,image/webp" /><small>Nên dùng bảng trước/sau và chân dung trên nền trắng · tối đa 8 MB</small></label> : characterImageSource === "project" ? characterMediaImages.length ? <>
                <div className="character-media-image-grid" aria-label="Chọn ảnh từ media của project">
                  {characterMediaImages.map((scene) => <button className={`character-media-image-option ${selectedCharacterMediaSceneId === scene.id ? "selected" : ""}`} type="button" key={`${scene.chunkId}-${scene.id}`} aria-pressed={selectedCharacterMediaSceneId === scene.id} onClick={() => setSelectedCharacterMediaSceneId(scene.id)}>
                    <img src={scene.previewUrl} alt={`Ảnh ${sceneNumberLabel(scene)}`} />
                    <span>{sceneNumberLabel(scene)}</span>
                  </button>)}
                </div>
                {selectedCharacterMediaScene && <p className="character-media-image-selected">Đã chọn ảnh {sceneNumberLabel(selectedCharacterMediaScene)}</p>}
              </> : <p className="character-media-image-empty">Project chưa có ảnh cảnh để chọn.</p> : maiVideoLibraryLoading ? <p className="character-media-image-empty">Đang tải thư viện MaiVideo…</p> : maiVideoLibraryError ? <div className="character-media-image-error" role="alert"><span>{maiVideoLibraryError}</span><button type="button" className="text-button" onClick={() => void loadMaiVideoLibraryImages(true)}>Thử lại</button></div> : maiVideoLibraryImages.length ? <>
                <div className="character-media-image-grid" aria-label="Chọn ảnh từ thư viện MaiVideo">
                  {maiVideoLibraryImages.map((image) => <button className={`character-media-image-option ${selectedMaiVideoImageId === image.id ? "selected" : ""}`} type="button" key={image.id} aria-pressed={selectedMaiVideoImageId === image.id} onClick={() => setSelectedMaiVideoImageId(image.id)}>
                    <img src={image.previewUrl} alt={image.name} />
                    <span title={image.fileName}>{image.name}</span>
                  </button>)}
                </div>
                {selectedMaiVideoImage && <p className="character-media-image-selected">Đã chọn {selectedMaiVideoImage.name}</p>}
              </> : <p className="character-media-image-empty">Thư viện MaiVideo chưa có ảnh phù hợp.</p>}
            </div>
            <button className="secondary-button compact character-reference-submit" type="submit" disabled={characterSaving}>{characterSaving ? "Đang lưu…" : "＋ Thêm nhân vật"}</button>
          </form>
          {characterError && <p className="character-reference-error" role="alert">{characterError}</p>}
        </details>
        <details id="location-reference-panel" className="character-reference-panel">
          <summary className="character-reference-heading">
            <div><div className="section-kicker">LOCATIONS</div><h3>Hồ sơ bối cảnh</h3></div>
            <span className="character-reference-count">{locationProfiles.length} bối cảnh · Quản lý</span>
          </summary>
          {locationProfiles.length > 0 && <div className="character-reference-list">
            {locationProfiles.map((location) => {
              const assignedCount = scenes.filter((scene) => sceneLocationId(scene) === location.id).length;
              return <article className="character-reference-item" key={location.id}>
                <img src={`/api/projects/${encodeURIComponent(project.slug)}/locations/${encodeURIComponent(location.id)}/image`} alt={`Ảnh tham chiếu ${location.name}`} />
                <div><strong>{location.name}</strong><p>{location.aliases?.length ? `Tên khác: ${location.aliases.join(", ")}` : location.description || "Ảnh bối cảnh 4 góc"}</p><small>Đã gán {assignedCount} cảnh</small></div>
              </article>;
            })}
          </div>}
          <form className="character-reference-form" onSubmit={(event) => void createLocation(event)}>
            <label><span>Tên bối cảnh</span><input value={locationName} onChange={(event) => setLocationName(event.target.value)} maxLength={100} placeholder="Ví dụ: Thư viện ven sông" required /></label>
            <label><span>Tên khác để tự gán</span><input value={locationAliases} onChange={(event) => setLocationAliases(event.target.value)} maxLength={500} placeholder="Thư viện cũ, phòng lưu trữ" /></label>
            <label><span>Mô tả nhận diện</span><input value={locationDescription} onChange={(event) => setLocationDescription(event.target.value)} maxLength={500} placeholder="Kiến trúc, vật liệu, màu sắc cố định…" /></label>
            <div className="character-reference-image-picker">
              <div className="character-reference-image-tabs" role="group" aria-label="Nguồn ảnh bối cảnh">
                <button className={locationImageSource === "upload" ? "active" : ""} type="button" aria-pressed={locationImageSource === "upload"} onClick={() => { setLocationImageSource("upload"); setSelectedLocationMediaSceneId(""); setSelectedLocationMaiVideoImageId(""); }}>Tải ảnh 4 góc lên</button>
                <button className={locationImageSource === "project" ? "active" : ""} type="button" aria-pressed={locationImageSource === "project"} onClick={() => { setLocationImageSource("project"); setSelectedLocationMaiVideoImageId(""); if (locationImageInputRef.current) locationImageInputRef.current.value = ""; }}>{`Ảnh project · ${characterMediaImages.length}`}</button>
                <button className={locationImageSource === "maivideo" ? "active" : ""} type="button" aria-pressed={locationImageSource === "maivideo"} onClick={() => { setLocationImageSource("maivideo"); setSelectedLocationMediaSceneId(""); if (locationImageInputRef.current) locationImageInputRef.current.value = ""; void loadMaiVideoLibraryImages(); }}>{`Thư viện MaiVideo${maiVideoLibraryLoaded ? ` · ${maiVideoLibraryImages.length}` : ""}`}</button>
              </div>
              {locationImageSource === "upload" ? <label className="character-reference-file"><span>Ảnh tham chiếu 4 góc/hướng</span><input ref={locationImageInputRef} type="file" accept="image/png,image/jpeg,image/webp" /><small>Ảnh sẽ dùng để tái hiện cùng một bối cảnh trong cảnh đơn.</small></label> : locationImageSource === "project" ? characterMediaImages.length ? <div className="character-media-image-grid" aria-label="Chọn ảnh bối cảnh từ media project">
                {characterMediaImages.map((scene) => <button className={`character-media-image-option ${selectedLocationMediaSceneId === scene.id ? "selected" : ""}`} type="button" key={`${scene.chunkId}-${scene.id}`} aria-pressed={selectedLocationMediaSceneId === scene.id} onClick={() => setSelectedLocationMediaSceneId(scene.id)}><img src={scene.previewUrl} alt={`Ảnh ${sceneNumberLabel(scene)}`} /><span>{sceneNumberLabel(scene)}</span></button>)}
              </div> : <p className="character-media-image-empty">Project chưa có ảnh để chọn.</p> : maiVideoLibraryLoading ? <p className="character-media-image-empty">Đang tải thư viện MaiVideo…</p> : maiVideoLibraryError ? <div className="character-media-image-error" role="alert"><span>{maiVideoLibraryError}</span><button type="button" className="text-button" onClick={() => void loadMaiVideoLibraryImages(true)}>Thử lại</button></div> : maiVideoLibraryImages.length ? <div className="character-media-image-grid" aria-label="Chọn ảnh bối cảnh từ thư viện MaiVideo">
                {maiVideoLibraryImages.map((image) => <button className={`character-media-image-option ${selectedLocationMaiVideoImageId === image.id ? "selected" : ""}`} type="button" key={image.id} aria-pressed={selectedLocationMaiVideoImageId === image.id} onClick={() => setSelectedLocationMaiVideoImageId(image.id)}><img src={image.previewUrl} alt={image.name} /><span title={image.fileName}>{image.name}</span></button>)}
              </div> : <p className="character-media-image-empty">Thư viện MaiVideo chưa có ảnh phù hợp.</p>}
            </div>
            <button className="secondary-button compact character-reference-submit" type="submit" disabled={locationSaving}>{locationSaving ? "Đang lưu…" : "＋ Thêm bối cảnh"}</button>
          </form>
          {locationError && <p className="character-reference-error" role="alert">{locationError}</p>}
        </details>
        {scenesLoading && <div className="scene-review-empty">Đang tải danh sách cảnh…</div>}
        {!scenesLoading && sceneError && <div className="run-message error scene-review-message"><span><Icon name="alert" size={13} /></span>{sceneError}<button className="text-button" onClick={() => void loadScenes()}>Thử lại</button></div>}
        {!scenesLoading && !sceneError && !scenes.length && <div className="scene-review-empty">Chưa có output scene. Hãy chạy chunk trước để tạo và kiểm tra từng cảnh.</div>}
        {!scenesLoading && !sceneError && scenes.length > 0 && (
          <>
            <div className="scene-review-toolbar">
              <label className="scene-review-search"><Icon name="search" size={16} /><input value={sceneSearch} onChange={(event) => setSceneSearch(event.target.value)} placeholder="Tìm S001, nội dung, voiceover…" aria-label="Tìm cảnh" /></label>
              <label className="scene-filter-control"><span>Chunk</span><select value={sceneChunkFilter} onChange={(event) => setSceneChunkFilter(event.target.value)} aria-label="Lọc theo chunk"><option value="all">Tất cả chunk</option>{sceneChunks.map((chunkId) => <option key={chunkId} value={chunkId}>{chunkId}</option>)}</select></label>
              <label className="scene-filter-control"><span>Review</span><select value={sceneReviewFilter} onChange={(event) => setSceneReviewFilter(event.target.value as SceneReviewFilter)} aria-label="Lọc theo trạng thái review"><option value="all">Tất cả</option><option value="unreviewed">Chưa review</option><option value="approved">Đã đạt</option><option value="needs_changes">Cần sửa</option></select></label>
              <label className="scene-filter-control"><span>AI</span><select value={sceneAiReviewFilter} onChange={(event) => setSceneAiReviewFilter(event.target.value as SceneAiReviewFilter)} aria-label="Lọc theo trạng thái AI pre-check"><option value="all">Tất cả AI</option><option value="pending">Chờ AI</option><option value="passed">AI đạt</option><option value="needs_changes">AI cần sửa</option><option value="error">AI lỗi</option></select></label>
              <label className="scene-filter-control"><span>Media</span><select value={sceneMediaFilter} onChange={(event) => setSceneMediaFilter(event.target.value as SceneMediaFilter)} aria-label="Lọc theo media"><option value="all">Tất cả media</option><option value="ready">Có media</option><option value="missing">Thiếu media</option><option value="ai">AI video</option><option value="stock">Stock</option></select></label>
            </div>
            <div className="scene-review-summary">
              <span className="scene-summary-total">Hiển thị <strong>{filteredScenes.length}</strong> / {scenes.length} cảnh</span>
              <span className="scene-summary-item ai-pending"><strong>{sceneStats.ai_pending}</strong> chờ AI</span>
              <span className="scene-summary-item ai"><strong>{sceneStats.ai_passed}</strong> AI đạt</span>
              <span className="scene-summary-item needs-changes"><strong>{sceneStats.ai_needs_changes}</strong> AI cần sửa</span>
              <span className="scene-summary-item unreviewed"><strong>{sceneStats.unreviewed}</strong> chờ người dùng</span>
              <span className="scene-summary-item approved"><strong>{sceneStats.approved}</strong> đạt</span>
              <span className="scene-summary-item ai"><strong>{sceneStats.ai}</strong> AI video</span>
              <button className="text-button scene-reset-button" type="button" onClick={() => { setSceneSearch(""); setSceneChunkFilter("all"); setSceneReviewFilter("all"); setSceneAiReviewFilter("all"); setSceneMediaFilter("all"); }} disabled={!sceneSearch && sceneChunkFilter === "all" && sceneReviewFilter === "all" && sceneAiReviewFilter === "all" && sceneMediaFilter === "all"}>Xóa lọc</button>
            </div>
            <div className="batch-media-action-panel">
              <div><strong>Tạo ảnh / video hàng loạt</strong><small>{filteredScenes.length} cảnh · {filteredImageTargets.length} ảnh · {filteredVideoTargets.length} video · {activeSceneMediaJobCount ? `${activeSceneMediaJobCount} job đang chạy nền · ` : ""}khung hình {project.aspectRatio} · {filteredScenes.filter((scene) => sceneCharacterIds(scene).length > 0).length} có nhân vật · {filteredScenes.filter((scene) => Boolean(sceneLocationId(scene))).length} có bối cảnh</small></div>
              <div className="batch-media-actions">
                <button className="secondary-button compact" type="button" title={`Tự gán hồ sơ nhân vật và bối cảnh theo nội dung ${filteredScenes.length} cảnh. Hồ sơ bối cảnh được thêm vào prompt ảnh và video theo cài đặt tham chiếu.`} onClick={() => void autoAssignSceneReferences()} disabled={(!characterProfiles.length && !locationProfiles.length) || autoAssignCharactersBusy || batchMediaBusy || videoQueueRunning || sceneCharacterSaving}>
                  <Icon name="users" size={13} />{autoAssignCharactersBusy ? "Đang gán…" : "Tự gán hồ sơ"}
                </button>
                <button className="secondary-button compact" type="button" onClick={() => void generateFilteredSceneImages()} disabled={!filteredImageTargets.length || batchMediaBusy || sceneMediaSettingsSaving || videoQueueRunning || scriptBlocksIndependentTasks || ttsRunning || Boolean(generatingSceneId)}>
                  <Icon name="spark" size={13} />{batchMediaBusy && generatingSceneMediaKind === "image" ? batchMediaProgress || "Đang xếp ảnh…" : `Tạo ảnh cảnh · ${filteredImageTargets.length}`}
                </button>
                <button className="primary-button compact" type="button" onClick={() => void generateFilteredSceneVideos()} disabled={!filteredVideoTargets.length || batchMediaBusy || videoQueueRunning || sceneMediaSettingsSaving || scriptBlocksIndependentTasks || ttsRunning || Boolean(generatingSceneId)}>
                  <Icon name="play" size={13} />{batchMediaBusy && generatingSceneMediaKind === "video" ? batchMediaProgress || "Đang xếp video…" : `Tạo video hàng loạt · ${filteredVideoTargets.length}`}
                </button>
                {batchMediaBusy && batchMediaProgress && <span className="batch-media-progress" role="status">{batchMediaProgress}</span>}
              </div>
            </div>
            <details className="batch-media-panel panel-card">
              <summary><span><strong>Model & tuỳ chỉnh</strong><small>{batchMediaSettings.imageModel} · {batchMediaSettings.imageQuality}{batchImageDetailLevels.length ? ` · ${IMAGE_DETAIL_LEVEL_LABELS[batchMediaSettings.imageDetailLevel]}` : ""} / {batchMediaSettings.videoProvider === "seedance" ? "Seedance" : "MaiVideo"} · {batchMediaSettings.videoModel} · {batchSeedanceSelected ? "pool profile Dola" : batchMediaSettings.videoQuality} · {batchMediaSettings.videoDurationMode === "scene" ? "theo cảnh" : `${batchMediaSettings.videoDurationSec}s`} · khung hình {project.aspectRatio}</small></span><span className="batch-media-summary-count">Mở cài đặt</span></summary>
              
              <div className="batch-media-frame-note" role="note"><span>Khung hình dự án</span><strong>{project.aspectRatio}</strong><small>Tự áp dụng cho ảnh và video; đổi tại Cài đặt dự án.</small></div>
              <div className="batch-media-settings-grid">
                <label className="scene-media-field"><span>Model ảnh</span><select aria-label="Model ảnh áp dụng hàng loạt" value={batchMediaSettings.imageModel} disabled={batchMediaBusy || sceneMediaSettingsSaving} onChange={(event) => {
                  const selected = mediaCatalog?.imageModels.find((item) => item.id === event.target.value);
                  updateBatchMediaSettings({ imageModel: event.target.value, ...(selected?.qualities.length && !selected.qualities.includes(batchMediaSettings.imageQuality) ? { imageQuality: selected.qualities[0] } : {}) });
                }}>{batchImageModelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
                <label className="scene-media-field"><span>Độ phân giải ảnh</span><select aria-label="Độ phân giải ảnh áp dụng hàng loạt" value={batchMediaSettings.imageQuality} disabled={batchMediaBusy || sceneMediaSettingsSaving} onChange={(event) => updateBatchMediaSettings({ imageQuality: event.target.value })}>{batchImageQualities.map((quality) => <option key={quality} value={quality}>{quality}</option>)}</select></label>
                {batchImageDetailLevels.length > 0 && <label className="scene-media-field"><span>Detail level</span><select aria-label="Detail level ảnh áp dụng hàng loạt" value={batchMediaSettings.imageDetailLevel} disabled={batchMediaBusy || sceneMediaSettingsSaving} onChange={(event) => updateBatchMediaSettings({ imageDetailLevel: event.target.value as MediaGenerationSettings["imageDetailLevel"] })}>{batchImageDetailLevels.map((level) => <option key={level} value={level}>{IMAGE_DETAIL_LEVEL_LABELS[level]}</option>)}</select></label>}
                <label className="scene-media-field"><span>Hệ thống tạo video</span><select aria-label="Hệ thống tạo video áp dụng hàng loạt" value={batchMediaSettings.videoProvider} disabled={batchMediaBusy || sceneMediaSettingsSaving} onChange={(event) => updateBatchMediaSettings({ videoProvider: event.target.value as MediaGenerationSettings["videoProvider"] })}>
                  <option value="maivideo">MaiVideo</option><option value="seedance">Seedance · Dola.com local</option>
                </select></label>
                {batchSeedanceSelected && <div className="scene-media-field"><span>Profile Dola</span><small className="scene-media-settings-help">Tự chọn trong pool · <Link href="/settings#dola-gateway">quản lý tài khoản và proxy</Link></small></div>}
                <label className="scene-media-field"><span>Model video</span><select aria-label="Model video áp dụng hàng loạt" value={batchMediaSettings.videoModel} disabled={batchMediaBusy || sceneMediaSettingsSaving} onChange={(event) => {
                  const selected = mediaCatalog?.videoModels.find((item) => item.id === event.target.value && (item.provider || "maivideo") === batchMediaSettings.videoProvider);
                  const videoQuality = selected?.qualities.length && !selected.qualities.includes(batchMediaSettings.videoQuality) ? selected.qualities[0] : batchMediaSettings.videoQuality;
                  updateBatchMediaSettings({ videoProvider: selected?.provider || batchMediaSettings.videoProvider, videoModel: event.target.value, videoQuality, videoDurationSec: normalizeVideoDuration(batchMediaSettings.videoDurationSec, selected, videoQuality), ...(selected?.supportsMultiShot === false ? { videoMultiShot: false } : {}), ...(selected?.supportsAudio === false ? { videoAudio: false } : {}), ...(selected?.supportsOffPeak === false ? { videoOffPeak: false } : {}) });
                }}>{batchVideoModelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
                <label className="scene-media-field"><span>Chất lượng video</span>{batchSeedanceSelected ? <select aria-label="Chất lượng video áp dụng hàng loạt" value="profile" disabled><option value="profile">Theo profile Dola</option></select> : <select aria-label="Chất lượng video áp dụng hàng loạt" value={batchMediaSettings.videoQuality} disabled={batchMediaBusy || sceneMediaSettingsSaving} onChange={(event) => updateBatchMediaSettings({ videoQuality: event.target.value })}>{batchVideoQualities.map((quality) => <option key={quality} value={quality}>{quality}</option>)}</select>}</label>
                <label className="scene-media-field"><span>Thời lượng clip</span><select aria-label="Thời lượng clip áp dụng hàng loạt" value={batchMediaSettings.videoDurationMode} disabled={project.presetId === "ai-drama" || batchMediaBusy || sceneMediaSettingsSaving} onChange={(event) => updateBatchMediaSettings({ videoDurationMode: event.target.value === "fixed" ? "fixed" : "scene" })}>
                  <option value="scene">Theo thời lượng từng cảnh</option>{project.presetId !== "ai-drama" && <option value="fixed">Cố định theo giây</option>}
                </select>{project.presetId !== "ai-drama" && batchMediaSettings.videoDurationMode === "fixed" && <select aria-label="Số giây clip cố định áp dụng hàng loạt" value={batchMediaSettings.videoDurationSec} disabled={batchMediaBusy || sceneMediaSettingsSaving} onChange={(event) => updateBatchMediaSettings({ videoDurationSec: Number(event.target.value) })}>{batchVideoDurationChoices.map((seconds) => <option key={seconds} value={seconds}>{seconds} giây</option>)}</select>}{project.presetId === "ai-drama" && <small className="scene-media-settings-help">Clip AI Drama luôn khớp cảnh 5/10/15 giây.</small>}</label>
              </div>
              <div className="scene-media-toggles batch-media-toggles">
                <label><input type="checkbox" checked={batchMediaSettings.imageUseCharacterReferences} disabled={batchMediaBusy} onChange={(event) => updateBatchMediaSettings({ imageUseCharacterReferences: event.target.checked })} /><span>Hồ sơ nhân vật cho ảnh cảnh</span></label>
                {!batchSeedanceSelected && <>
                  <label><input type="checkbox" checked={batchMediaSettings.videoMultiShot} disabled={batchMediaBusy || selectedBatchVideoModel?.supportsMultiShot === false} onChange={(event) => updateBatchMediaSettings({ videoMultiShot: event.target.checked })} /><span>Multi-shot</span></label>
                  <label><input type="checkbox" checked={batchMediaSettings.videoAudio} disabled={batchMediaBusy || selectedBatchVideoModel?.supportsAudio === false} onChange={(event) => updateBatchMediaSettings({ videoAudio: event.target.checked })} /><span>Âm thanh model</span></label>
                  <label><input type="checkbox" checked={batchVideoOffPeakRequired || (selectedBatchVideoModel?.supportsOffPeak === false ? false : batchMediaSettings.videoOffPeak)} disabled={batchMediaBusy || batchVideoOffPeakRequired || selectedBatchVideoModel?.supportsOffPeak === false} onChange={(event) => updateBatchMediaSettings({ videoOffPeak: event.target.checked })} /><span>{batchVideoOffPeakRequired ? "Off-peak · bắt buộc với PixVerse" : selectedBatchVideoModel?.supportsOffPeak === false ? "Off-peak · không hỗ trợ" : "Off-peak"}</span></label>
                </>}
                <label><input type="checkbox" checked={batchMediaSettings.videoUseCharacterReferences} disabled={batchMediaBusy} onChange={(event) => updateBatchMediaSettings({ videoUseCharacterReferences: event.target.checked })} /><span>Ảnh nhân vật cho video</span></label>
                <label><input type="checkbox" checked={batchMediaSettings.videoUseLocationReferences} disabled={batchMediaBusy} onChange={(event) => updateBatchMediaSettings({ videoUseLocationReferences: event.target.checked })} /><span>{project.presetId === "ai-drama" ? "Ảnh & mô tả bối cảnh cho video" : "Ảnh bối cảnh (chỉ dùng khi tắt ảnh cảnh)"}</span></label>
                <label><input type="checkbox" checked={batchMediaSettings.videoUseSceneImageReference} disabled={batchMediaBusy} onChange={(event) => updateBatchMediaSettings({ videoUseSceneImageReference: event.target.checked })} /><span>Ảnh cảnh làm tham chiếu</span></label>
              </div>
              <div className="batch-media-regenerate">
                <span>Tuỳ chọn ghi đè media đã có</span>
                <div className="scene-media-toggles">
                  <label><input type="checkbox" checked={batchRegenerateImages} disabled={batchMediaBusy} onChange={(event) => setBatchRegenerateImages(event.target.checked)} /><span>Tạo lại ảnh đã có</span></label>
                  <label><input type="checkbox" checked={batchRegenerateVideos} disabled={batchMediaBusy || videoQueueRunning} onChange={(event) => setBatchRegenerateVideos(event.target.checked)} /><span>Tạo lại video AI đã có</span></label>
                </div>
              </div>
              {batchMediaSettings.videoDurationMode === "scene" && <small className={`batch-media-duration-note ${batchOverLimitCount ? "warning" : ""}`}>
                {batchOverLimitCount
                  ? `${batchOverLimitCount} cảnh dài hơn giới hạn ${batchVideoMaxDuration}s của model/chất lượng đã chọn; clip sẽ được tạo tối đa ${batchVideoMaxDuration}s và lặp phần còn lại khi ghép. Hãy chọn model hỗ trợ clip dài hơn nếu cần chuyển động xuyên suốt.`
                  : batchSeedanceSelected ? `Seedance chỉ nhận clip 5, 10 hoặc 15 giây; mỗi cảnh được làm tròn lên mốc kế tiếp.` : `Theo timecode cảnh · tối đa ${batchVideoMaxDuration}s/model · nhóm này tối đa ${Math.max(0, ...filteredScenes.map((scene) => Math.ceil(sceneDurationSeconds(scene, project.sceneDurationSec))))}s.`}
              </small>}
              {(mediaCatalogError || mediaCatalog?.videoError) && batchMediaSettings.videoProvider === "maivideo" && <small className="batch-media-duration-note warning">Không tải được model catalog MaiVideo; đang giữ lựa chọn đã lưu. Kiểm tra API key MaiVideo để chọn model khác.</small>}
            </details>
          </>
        )}
        {!scenesLoading && !sceneError && scenes.length > 0 && filteredScenes.length > 0 && (
          <div className="scene-table-scroll">
            <div className="scene-table" role="table" aria-label="Danh sách cảnh">
              <div className="scene-table-head" role="rowgroup"><div className="scene-table-row" role="row"><span role="columnheader">Cảnh</span><span role="columnheader">Mô tả / thoại</span><span role="columnheader">Hồ sơ</span><span role="columnheader">AI pre-check</span><span role="columnheader">Duyệt</span><span role="columnheader">Media</span><span role="columnheader">TTS</span></div></div>
              <div className="scene-table-body" role="rowgroup">
                {filteredScenes.map((scene) => {
                  const media = scene.media;
                  const voice = sceneText(scene, "dialogue_or_voiceover", "voiceText", "voiceover");
                  const audio = sceneAudioRecord(scene);
                  const dialogueSegments = project.presetId === "ai-drama" ? sceneDialogueSegments(scene, characterProfiles) : [];
                  const readyDialogueSegments = dialogueSegments.filter((segment) => Boolean(segment.audio?.localPath)).length;
                  const ttsReady = project.presetId === "ai-drama" ? dialogueSegments.length > 0 && readyDialogueSegments === dialogueSegments.length : Boolean(audio.localPath);
                  const ttsPending = project.presetId === "ai-drama" ? dialogueSegments.length > 0 : Boolean(voice);
                  const review = sceneReviewStatus(scene);
                  const aiReview = sceneAiReview(scene);
                  const characterIds = sceneCharacterIds(scene);
                  const location = project.locations?.find((item) => item.id === sceneLocationId(scene));
                  const description = sceneText(scene, "purpose", "beat_summary") || "Cảnh chưa có mô tả";
                  const summary = project.presetId === "ai-drama" && dialogueSegments.length
                    ? dialogueSegments.map((segment) => segment.text).join(" · ")
                    : voice || sceneText(scene, "video_prompt", "videoPrompt");
                  return <div role="row" tabIndex={0} aria-label={`${sceneNumberLabel(scene)}: ${sceneAiReviewLabel(aiReview.status)} · ${sceneReviewLabel(review)} · ${sceneMediaKindLabel(media, project.presetId === "ai-drama")} · ${compactSceneText(description, 90)}`} className={`scene-table-row scene-table-item ${selectedScene?.id === scene.id ? "active" : ""}`} key={`${scene.chunkId}-${scene.id}`} onClick={() => setSelectedSceneId(scene.id)} onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setSelectedSceneId(scene.id);
                  }}>
                    <span className="scene-table-cell scene-table-ident" role="cell"><span className="scene-list-id">{sceneNumberLabel(scene)}</span>{scene.referenceImagePreviewUrl && <img className="scene-list-reference" src={scene.referenceImagePreviewUrl} alt="" loading="lazy" />}<small>{scene.chunkId}</small></span>
                    <span className="scene-table-cell scene-table-copy" role="cell"><strong>{description}</strong><small>{compactSceneText(summary || "Chưa có thoại hoặc prompt", 160)}</small></span>
                    <span className="scene-table-cell scene-table-profiles" role="cell"><strong>{characterIds.length} nhân vật</strong><small>{location?.name || "Chưa gán bối cảnh"}</small></span>
                    <span className="scene-table-cell scene-table-status" role="cell"><span className={`scene-ai-badge ${sceneAiReviewTone(aiReview.status)}`}>{sceneAiReviewLabel(aiReview.status)}</span><small>{aiReview.score ? `${aiReview.score}/100` : "Chưa có điểm"}</small></span>
                    <span className="scene-table-cell scene-table-status" role="cell"><span className={`scene-review-badge ${sceneReviewTone(review)}`}>{sceneReviewLabel(review)}</span></span>
                    <span className="scene-table-cell scene-table-status" role="cell"><strong>{sceneMediaKindLabel(media, project.presetId === "ai-drama")}</strong><small>{sceneMediaReady(media, project.presetId === "ai-drama") ? "Sẵn sàng" : media?.status === "failed" ? "Lỗi" : media?.status === "ready" ? "Cần tạo video" : "Chưa tạo"}</small></span>
                    <span className="scene-table-cell scene-table-status" role="cell"><span className={`scene-tts-badge ${ttsReady ? "ready" : ttsPending ? "pending" : "not-needed"}`}>{project.presetId === "ai-drama" ? `${readyDialogueSegments}/${dialogueSegments.length}` : audio.localPath ? "Có TTS" : voice ? "Chưa TTS" : "Không lời"}</span></span>
                  </div>;
                })}
              </div>
            </div>
          </div>
        )}
        {!scenesLoading && !sceneError && !filteredScenes.length && scenes.length > 0 && <div className="scene-review-empty">Không có cảnh khớp bộ lọc. Hãy đổi điều kiện tìm kiếm.</div>}
        {!scenesLoading && !sceneError && sceneDetailOpen && selectedScene && (
          <div className="scene-detail-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSceneDetailOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setSceneDetailOpen(false); }}>
            <article className="scene-detail scene-detail-modal" role="dialog" aria-modal="true" aria-labelledby="selected-scene-detail-title">
              <button className="scene-detail-close" type="button" autoFocus onClick={() => setSceneDetailOpen(false)} aria-label="Đóng chi tiết cảnh">×</button>
              <div className="scene-detail-heading">
                <div><div className="section-kicker">{selectedScene.chunkId}</div><h3 id="selected-scene-detail-title">{sceneNumberLabel(selectedScene)} · {sceneText(selectedScene, "purpose", "beat_summary") || "Scene detail"}</h3></div>
                <div className="scene-detail-badges"><span className={`scene-media-status ${sceneMediaReady(selectedMedia, project.presetId === "ai-drama") ? "ready" : "missing"}`}><span className="status-dot" />{sceneMediaKindLabel(selectedMedia, project.presetId === "ai-drama")}</span>{selectedMedia?.kind === "video" && selectedMedia.durationSec && <span className="scene-media-status ready">Clip gốc · {selectedMedia.durationSec}s</span>}<span className={`scene-ai-badge ${sceneAiReviewTone(selectedAiReview.status)}`}>{sceneAiReviewLabel(selectedAiReview.status)} · {selectedAiReview.score}</span><span className={`scene-review-badge ${sceneReviewTone(selectedReviewStatus)}`}>{sceneReviewLabel(selectedReviewStatus)}</span></div>
              </div>
              <div className="scene-preview-frame">
                {selectedMedia?.status === "ready" && selectedScene.previewUrl
                  ? selectedMedia.kind === "image"
                    ? <img src={selectedScene.previewUrl} alt={sceneNumberLabel(selectedScene)} />
                    : <video src={selectedScene.previewUrl} controls preload="metadata" />
                  : <div className="scene-preview-placeholder"><Icon name="play" size={26} /><span>Chưa có media preview cho cảnh này.</span></div>}
              </div>
              <div className="scene-reference-frame-card">
                <div className="scene-reference-frame-copy"><strong>Ảnh cảnh AI</strong><small>{selectedReferenceImage?.stale ? "Ảnh đã cũ · video vẫn có thể dùng ảnh này" : selectedReferenceImage ? "Ảnh cảnh này được dùng để tạo video" : selectedCharacterIds.length && selectedSceneLocation ? "Tạo từ hồ sơ nhân vật và bối cảnh đã gán" : selectedSceneLocation ? "Tạo từ hồ sơ bối cảnh đã gán" : selectedCharacterIds.length ? "Tạo từ hồ sơ nhân vật đã gán" : "Chưa gán hồ sơ tham chiếu"}</small></div>
                {selectedReferenceImageUrl
                  ? <img src={selectedReferenceImageUrl} alt={`Ảnh cảnh ${sceneNumberLabel(selectedScene)}`} />
                  : <div className="scene-reference-frame-empty">Chưa có ảnh cảnh</div>}
                {Array.isArray(selectedReferenceImage?.referenceCharacterIds) && selectedReferenceImage.referenceCharacterIds.length > 0 && <span className="scene-reference-frame-meta">Có {selectedReferenceImage.referenceCharacterIds.length} ảnh nhân vật</span>}
                {selectedReferenceImage?.referenceLocationId && <span className="scene-reference-frame-meta">Có ảnh bối cảnh: {project.locations?.find((location) => location.id === selectedReferenceImage.referenceLocationId)?.name || "đã tham chiếu"}</span>}
              </div>
              <div className="scene-detail-actions">
                <button className="secondary-button compact" type="button" onClick={() => void generateSceneImage(selectedScene)} disabled={Boolean(generatingSceneId) || selectedScene.mediaJob?.status === "queued" || selectedScene.mediaJob?.status === "running" || sceneMediaSettingsSaving || batchMediaBusy || videoQueueRunning || ttsRunning || scriptBlocksIndependentTasks}>
                  <Icon name="spark" size={14} />{selectedScene.mediaJob?.kind === "image" && selectedScene.mediaJob.status === "queued" ? "Ảnh đang chờ…" : selectedScene.mediaJob?.kind === "image" && selectedScene.mediaJob.status === "running" ? "Đang tạo ảnh cảnh…" : generatingSceneId === selectedScene.id && generatingSceneMediaKind === "image" ? "Đang xếp ảnh cảnh…" : selectedReferenceImage ? "Tạo lại ảnh cảnh" : "Tạo ảnh cảnh"}
                </button>
                <button className="primary-button" type="button" onClick={() => void generateSceneVideo(selectedScene)} disabled={Boolean(generatingSceneId) || selectedScene.mediaJob?.status === "queued" || selectedScene.mediaJob?.status === "running" || sceneMediaSettingsSaving || batchMediaBusy || videoQueueRunning || ttsRunning || scriptBlocksIndependentTasks}>
                  <Icon name="play" size={15} />{selectedScene.mediaJob?.kind === "video" && selectedScene.mediaJob.status === "queued" ? "Video đang chờ…" : selectedScene.mediaJob?.kind === "video" && selectedScene.mediaJob.status === "running" ? "Đang tạo video…" : generatingSceneId === selectedScene.id && generatingSceneMediaKind === "video" ? "Đang xếp video…" : selectedMedia?.kind === "video" ? "Tạo lại video AI" : "Tạo video AI"}
                </button>
                {selectedMedia?.sourceUrl && <a className="secondary-button compact" href={selectedMedia.sourceUrl} target="_blank" rel="noreferrer">Mở nguồn</a>}
                <div className="scene-nav-actions"><button className="secondary-button compact" type="button" onClick={() => moveSelectedScene(-1)} disabled={selectedFilteredIndex <= 0} aria-label="Cảnh trước">← Trước</button><span>{selectedFilteredIndex + 1} / {filteredScenes.length}</span><button className="secondary-button compact" type="button" onClick={() => moveSelectedScene(1)} disabled={selectedFilteredIndex < 0 || selectedFilteredIndex >= filteredScenes.length - 1} aria-label="Cảnh sau">Sau →</button></div>
              </div>
              <details className="scene-detail-disclosure">
                <summary><span><strong>Ảnh & video</strong><small>Ảnh {selectedSceneMediaSettings.imageModel} · {selectedSceneMediaSettings.imageQuality}{selectedImageDetailLevels.length ? ` · ${IMAGE_DETAIL_LEVEL_LABELS[selectedSceneMediaSettings.imageDetailLevel]}` : ""} / {selectedSceneMediaSettings.videoProvider === "seedance" ? "Seedance" : "MaiVideo"} · {selectedSceneMediaSettings.videoModel}{sceneSeedanceSelected ? " · pool profile Dola" : ` · ${selectedSceneMediaSettings.videoQuality}`} · {selectedSceneRequestedVideoDuration}s · khung hình {project.aspectRatio}</small></span><span className="scene-detail-disclosure-status">{hasSceneMediaOverride ? "Riêng cảnh" : "Theo project"}</span></summary>
                <section className="scene-media-settings-card" aria-label="Cấu hình tạo ảnh và video cho cảnh">
                  <div className="scene-media-settings-heading"><div><strong>Cấu hình tạo ảnh & video cho cảnh này</strong><small>Khung hình {project.aspectRatio} được lấy từ dự án và áp dụng cho cả ảnh lẫn video. Mỗi cảnh có thể dùng model riêng; mặc định kế thừa cấu hình project.</small></div><span>{sceneMediaSettingsSaving ? "Đang lưu…" : selectedSceneMediaJobActive ? "Đang chạy job · cấu hình cảnh tạm khóa" : hasSceneMediaOverride ? "Lưu riêng cho cảnh" : "Theo project"}</span></div>
                  <div className="scene-media-settings-grid">
                  <label className="scene-media-field"><span>Model ảnh</span><select aria-label="Model ảnh cho cảnh" value={selectedSceneMediaSettings.imageModel} disabled={sceneMediaSettingsSaving || Boolean(generatingSceneId) || selectedSceneMediaJobActive || batchMediaBusy} onChange={(event) => updateSelectedSceneMediaSettings({ imageModel: event.target.value })}>
                    {imageModelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                  </select></label>
                  <label className="scene-media-field"><span>Độ phân giải ảnh</span><select aria-label="Độ phân giải ảnh cho cảnh" value={selectedSceneMediaSettings.imageQuality} disabled={sceneMediaSettingsSaving || Boolean(generatingSceneId) || selectedSceneMediaJobActive || batchMediaBusy} onChange={(event) => updateSelectedSceneMediaSettings({ imageQuality: event.target.value })}>
                    {imageQualities.map((quality) => <option key={quality} value={quality}>{quality}</option>)}
                  </select></label>
                  {selectedImageDetailLevels.length > 0 && <label className="scene-media-field"><span>Detail level</span><select aria-label="Detail level ảnh cho cảnh" value={selectedSceneMediaSettings.imageDetailLevel} disabled={sceneMediaSettingsSaving || Boolean(generatingSceneId) || selectedSceneMediaJobActive || batchMediaBusy} onChange={(event) => updateSelectedSceneMediaSettings({ imageDetailLevel: event.target.value as MediaGenerationSettings["imageDetailLevel"] })}>{selectedImageDetailLevels.map((level) => <option key={level} value={level}>{IMAGE_DETAIL_LEVEL_LABELS[level]}</option>)}</select></label>}
                  <label className="scene-media-field"><span>Hệ thống tạo video</span><select aria-label="Hệ thống tạo video cho cảnh" value={selectedSceneMediaSettings.videoProvider} disabled={sceneMediaSettingsSaving || Boolean(generatingSceneId) || selectedSceneMediaJobActive || batchMediaBusy} onChange={(event) => updateSelectedSceneMediaSettings({ videoProvider: event.target.value as MediaGenerationSettings["videoProvider"] })}>
                    <option value="maivideo">MaiVideo</option><option value="seedance">Seedance · Dola.com local</option>
                  </select></label>
                  {sceneSeedanceSelected && <div className="scene-media-field"><span>Profile Dola</span><small className="scene-media-settings-help">Tự chọn trong pool · <Link href="/settings#dola-gateway">quản lý tài khoản và proxy</Link></small></div>}
                  <label className="scene-media-field"><span>Model video</span><select aria-label="Model video cho cảnh" value={selectedSceneMediaSettings.videoModel} disabled={sceneMediaSettingsSaving || Boolean(generatingSceneId) || selectedSceneMediaJobActive || batchMediaBusy} onChange={(event) => updateSelectedSceneMediaSettings({ videoModel: event.target.value })}>
                    {videoModelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                  </select></label>
                  <label className="scene-media-field"><span>Chất lượng video</span>{sceneSeedanceSelected ? <select aria-label="Chất lượng video cho cảnh" value="profile" disabled><option value="profile">Theo profile Dola</option></select> : <select aria-label="Chất lượng video cho cảnh" value={selectedSceneMediaSettings.videoQuality} disabled={sceneMediaSettingsSaving || Boolean(generatingSceneId) || selectedSceneMediaJobActive || batchMediaBusy} onChange={(event) => updateSelectedSceneMediaSettings({ videoQuality: event.target.value })}>
                    {videoQualities.map((quality) => <option key={quality} value={quality}>{quality}</option>)}
                  </select>}</label>
                  <label className="scene-media-field"><span>Thời lượng clip</span><select aria-label="Thời lượng video cho cảnh" value={selectedSceneMediaSettings.videoDurationMode === "scene" ? "scene" : String(selectedSceneMediaSettings.videoDurationSec)} disabled={project.presetId === "ai-drama" || sceneMediaSettingsSaving || Boolean(generatingSceneId) || selectedSceneMediaJobActive || batchMediaBusy} onChange={(event) => event.target.value === "scene" ? updateSelectedSceneMediaSettings({ videoDurationMode: "scene" }) : updateSelectedSceneMediaSettings({ videoDurationMode: "fixed", videoDurationSec: Number(event.target.value) })}>
                    <option value="scene">Theo cảnh · yêu cầu {selectedSceneRequestedVideoDuration}s</option>
                    {project.presetId !== "ai-drama" && sceneVideoDurationChoices.map((seconds) => <option key={seconds} value={seconds}>{seconds} giây cố định</option>)}
                  </select></label>
                  </div>
                  <div className="scene-media-toggles">
                  <label><input type="checkbox" checked={selectedSceneMediaSettings.imageUseCharacterReferences} disabled={sceneMediaSettingsSaving || Boolean(generatingSceneId) || selectedSceneMediaJobActive} onChange={(event) => updateSelectedSceneMediaSettings({ imageUseCharacterReferences: event.target.checked })} /><span>Hồ sơ nhân vật cho ảnh cảnh</span></label>
                  {!sceneSeedanceSelected && <>
                    <label><input type="checkbox" checked={selectedSceneMediaSettings.videoMultiShot} disabled={sceneMediaSettingsSaving || Boolean(generatingSceneId) || selectedSceneMediaJobActive || selectedVideoModel?.supportsMultiShot === false} onChange={(event) => updateSelectedSceneMediaSettings({ videoMultiShot: event.target.checked })} /><span>Multi-shot</span></label>
                    <label><input type="checkbox" checked={selectedSceneMediaSettings.videoAudio} disabled={sceneMediaSettingsSaving || Boolean(generatingSceneId) || selectedSceneMediaJobActive || selectedVideoModel?.supportsAudio === false} onChange={(event) => updateSelectedSceneMediaSettings({ videoAudio: event.target.checked })} /><span>Âm thanh model</span></label>
                    <label><input type="checkbox" checked={sceneVideoOffPeakRequired || (selectedVideoModel?.supportsOffPeak === false ? false : selectedSceneMediaSettings.videoOffPeak)} disabled={sceneMediaSettingsSaving || Boolean(generatingSceneId) || selectedSceneMediaJobActive || sceneVideoOffPeakRequired || selectedVideoModel?.supportsOffPeak === false} onChange={(event) => updateSelectedSceneMediaSettings({ videoOffPeak: event.target.checked })} /><span>{sceneVideoOffPeakRequired ? "Off-peak · bắt buộc với PixVerse" : selectedVideoModel?.supportsOffPeak === false ? "Off-peak · không hỗ trợ" : "Off-peak"}</span></label>
                  </>}
                  <label><input type="checkbox" checked={selectedSceneMediaSettings.videoUseCharacterReferences} disabled={sceneMediaSettingsSaving || Boolean(generatingSceneId) || selectedSceneMediaJobActive} onChange={(event) => updateSelectedSceneMediaSettings({ videoUseCharacterReferences: event.target.checked })} /><span>Ảnh nhân vật cho video</span></label>
                  <label><input type="checkbox" checked={selectedSceneMediaSettings.videoUseLocationReferences} disabled={sceneMediaSettingsSaving || Boolean(generatingSceneId) || selectedSceneMediaJobActive} onChange={(event) => updateSelectedSceneMediaSettings({ videoUseLocationReferences: event.target.checked })} /><span>{project.presetId === "ai-drama" ? "Ảnh & mô tả bối cảnh cho video" : "Ảnh bối cảnh (chỉ dùng khi tắt ảnh cảnh)"}</span></label>
                  <label><input type="checkbox" checked={selectedSceneMediaSettings.videoUseSceneImageReference} disabled={sceneMediaSettingsSaving || Boolean(generatingSceneId) || selectedSceneMediaJobActive} onChange={(event) => updateSelectedSceneMediaSettings({ videoUseSceneImageReference: event.target.checked })} /><span>Ảnh cảnh làm tham chiếu</span></label>
                  </div>
                  <small className="scene-media-settings-help">{project.presetId === "ai-drama"
                    ? "Khi bật tham chiếu bối cảnh, mô tả hồ sơ được thêm vào prompt video và ảnh hồ sơ được gửi kèm, kể cả khi video cũng dùng ảnh cảnh làm frame đầu."
                    : "Khi bật ảnh cảnh làm tham chiếu, ảnh đó đã mang thông tin bối cảnh nên hệ thống không gửi thêm ảnh hồ sơ bối cảnh. Tắt ảnh cảnh nếu muốn dùng ảnh bối cảnh thay thế."}</small>
                  <small className="scene-media-settings-help">{sceneSeedanceSelected ? `Seedance · clip ${selectedSceneRequestedVideoDuration}s · dùng các ảnh tham chiếu đã bật.` : mediaCatalogError || (selectedSceneMediaSettings.videoProvider === "maivideo" && mediaCatalog?.videoError) ? "Không tải được danh sách model; đang dùng lựa chọn đã lưu." : `Cảnh ${Math.ceil(selectedSceneDuration)}s · clip ${selectedSceneRequestedVideoDuration}s${selectedSceneMediaSettings.videoDurationMode === "scene" && selectedSceneDuration > sceneVideoMaxDuration ? ` · giới hạn ${sceneVideoMaxDuration}s, phần dư lặp khi ghép` : ""}.`}</small>
                </section>
              </details>
              <details className="scene-detail-disclosure">
                <summary><span><strong>Nhân vật trong cảnh</strong><small>Ảnh hồ sơ giúp giữ đúng nhận diện khi tạo ảnh cảnh.</small></span><span className="scene-detail-disclosure-status">{sceneCharacterSaving ? "Đang lưu…" : `${selectedCharacterIds.length} đã chọn`}</span></summary>
                <section className="scene-character-assignment" aria-label="Chọn nhân vật cho cảnh">
                  <div className="scene-character-assignment-heading"><div><strong>Nhân vật xuất hiện trong cảnh</strong><small>Ảnh đã chọn sẽ được gửi làm reference image cho MaiVideo.</small></div><span>{sceneCharacterSaving ? "Đang lưu…" : `${selectedCharacterIds.length} đã chọn`}</span></div>
                  {characterProfiles.length ? <div className="scene-character-options">{characterProfiles.map((character) => <label className={`scene-character-option ${selectedCharacterIds.includes(character.id) ? "selected" : ""}`} key={character.id}>
                  <input type="checkbox" checked={selectedCharacterIds.includes(character.id)} disabled={sceneCharacterSaving} onChange={(event) => {
                    const nextIds = event.target.checked ? [...selectedCharacterIds, character.id] : selectedCharacterIds.filter((id) => id !== character.id);
                    void saveSceneReferences(nextIds);
                  }} />
                  <img src={`/api/projects/${encodeURIComponent(project.slug)}/characters/${encodeURIComponent(character.id)}/image`} alt="" />
                  <span><strong>{character.name}</strong><small>{character.description || "Ảnh nhận diện đã lưu"}</small></span>
                  </label>)}</div> : <p className="scene-character-empty">Thêm hồ sơ và ảnh nhân vật ở phần trên để gán cho cảnh này.</p>}
                </section>
              </details>
              <details className="scene-detail-disclosure">
                <summary><span><strong>Bối cảnh trong cảnh</strong><small>{selectedSceneLocation?.name || "Chưa gán hồ sơ bối cảnh"}</small></span><span className="scene-detail-disclosure-status">{sceneCharacterSaving ? "Đang lưu…" : selectedSceneLocation ? "Đã gán" : "Chọn bối cảnh"}</span></summary>
                <section className="scene-character-assignment" aria-label="Chọn bối cảnh cho cảnh">
                  <label className="scene-media-field"><span>Hồ sơ bối cảnh chính</span><select value={selectedSceneLocationId} disabled={sceneCharacterSaving || !locationProfiles.length} onChange={(event) => void saveSceneReferences(selectedCharacterIds, event.target.value)}>
                    <option value="">Không gán bối cảnh</option>{locationProfiles.map((location) => <option key={location.id} value={location.id}>{location.name}{location.aliases?.length ? ` · ${location.aliases.slice(0, 2).join(", ")}` : ""}</option>)}
                  </select></label>
                  {selectedSceneLocation && <div className="scene-location-selected"><img src={`/api/projects/${encodeURIComponent(project.slug)}/locations/${encodeURIComponent(selectedSceneLocation.id)}/image`} alt={`Ảnh bối cảnh ${selectedSceneLocation.name}`} /><span><strong>{selectedSceneLocation.name}</strong><small>{selectedSceneLocation.description || selectedSceneLocation.aliases?.join(", ") || "Ảnh tham chiếu bối cảnh"}</small></span></div>}
                  {!locationProfiles.length && <p className="scene-character-empty">Thêm hồ sơ bối cảnh 4 góc ở phần trên để tự động đồng bộ với cảnh.</p>}
                </section>
              </details>
              <details className="scene-detail-disclosure">
                <summary><span><strong>Voice & TTS</strong><small>{project.presetId === "ai-drama" ? `${selectedSceneDialogueReadyCount}/${selectedSceneDialogueSegments.length} câu có audio` : selectedSceneAudio.localPath ? `Đã có audio · ${String(selectedSceneAudio.voiceName || "OmniVoice")}` : selectedSceneVoice ? `Voice: ${selectedSceneVoice.name}` : "Chưa tạo audio"}</small></span><span className="scene-detail-disclosure-status">{sceneTtsSaving ? "Đang lưu…" : "Tùy chọn"}</span></summary>
                <section className="scene-tts-card" aria-label="Tạo và chọn voice cho cảnh">
                  <div className="scene-tts-heading"><div><small>VOICE CỦA CẢNH</small><strong>{project.presetId === "ai-drama" ? "TTS theo từng lượt thoại" : "Tạo và nghe TTS riêng"}</strong></div><span>{sceneTtsSaving ? "Đang lưu voice…" : project.presetId === "ai-drama" ? `${selectedSceneDialogueReadyCount}/${selectedSceneDialogueSegments.length} câu có audio` : selectedSceneAudio.localPath ? `Đã có audio · ${String(selectedSceneAudio.voiceName || "OmniVoice")}` : "Chưa tạo audio"}</span></div>
                  {project.presetId === "ai-drama" ? <>
                    <label className="scene-tts-field"><span>Nhân vật thoại chính</span><select value={selectedSceneSpeakerId} onChange={(event) => void saveSceneSpeaker(selectedScene, event.target.value)} disabled={sceneCharacterSaving || ttsRunning} aria-label="Chọn nhân vật thoại cho cảnh">
                      <option value="">Narrator / giọng mặc định</option>
                      {characterProfiles.map((character) => <option key={character.id} value={character.id}>{character.name}{character.voiceName ? ` · ${character.voiceName}` : " · chưa chọn voice"}</option>)}
                    </select><small>{selectedSceneSpeaker?.voiceName ? `TTS sẽ dùng ${selectedSceneSpeaker.voiceName} theo hồ sơ nhân vật.` : selectedSceneSpeaker ? "Hãy chọn voice cho nhân vật trong tab AI Drama." : "Chọn người thoại để TTS tự lấy voice theo nhân vật."}</small></label>
                    {voiceCatalogLoading && <small>Đang tải thư viện voice…</small>}
                  </> : <label className="scene-tts-field"><span>Giọng đọc cho {sceneNumberLabel(selectedScene)}</span><select value={selectedSceneVoiceId} onChange={(event) => void saveSceneTtsVoice(event.target.value)} disabled={voiceCatalogLoading || sceneTtsSaving || ttsRunning || !voiceCatalog?.voices.length} aria-label="Chọn voice cho cảnh hiện tại">
                    {!visibleSceneVoices.some((voice) => voice.id === selectedSceneVoiceId) && <option value="">Chọn voice…</option>}
                    {visibleSceneVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voiceLanguageLabel(voice.language)}{voice.gender ? ` · ${voice.gender}` : ""}</option>)}
                  </select><small>{voiceCatalogLoading ? "Đang tải danh sách voice từ MaiVideo…" : voiceCatalog?.voices.length ? "Voice được lưu riêng cho cảnh; lời đọc dùng ngôn ngữ video của project, bất kể ngôn ngữ hồ sơ voice." : "Không tải được danh sách voice OmniVoice."}</small></label>}
                  <div className="scene-tts-actions"><button className="primary-button compact" type="button" onClick={() => void generateSelectedSceneTts(project.presetId === "ai-drama" ? selectedSceneDialogueSegments.length > 0 && selectedSceneDialogueReadyCount === selectedSceneDialogueSegments.length : Boolean(selectedSceneAudio.localPath))} disabled={(project.presetId === "ai-drama" ? !selectedSceneDialogueSegments.length || selectedSceneDialogueMissingVoice : !selectedSceneVoice || !sceneText(selectedScene, "dialogue_or_voiceover", "voiceText", "voiceover")) || ttsRunning || renderRunning || scriptBlocksIndependentTasks || batchMediaBusy || videoQueueRunning || Boolean(dialogueTtsBatchProgress) || Boolean(generatingSceneId) || sceneTtsSaving}><Icon name={ttsRunning && ttsChunkId === selectedScene.chunkId ? "clock" : "spark"} size={14} />{ttsRunning && ttsChunkId === selectedScene.chunkId ? "Đang tạo voice…" : project.presetId === "ai-drama" ? selectedSceneDialogueReadyCount === selectedSceneDialogueSegments.length && selectedSceneDialogueSegments.length ? "Tạo lại TTS các câu" : `Tạo TTS · ${selectedSceneDialogueSegments.length - selectedSceneDialogueReadyCount} câu` : selectedSceneAudio.localPath ? "Tạo lại TTS cảnh này" : "Tạo TTS cảnh này"}</button>{Boolean(selectedSceneAudio.voiceId) && project.presetId !== "ai-drama" && <span>Audio hiện có: {String(selectedSceneAudio.voiceName || selectedSceneAudio.voiceId)}</span>}</div>
                  {project.presetId === "ai-drama" && <div className="scene-tts-segment-players">{selectedSceneDialogueSegments.filter((segment) => segment.audio?.localPath).map((segment) => <label key={segment.id}><span>{characterProfiles.find((character) => character.id === segment.speakerCharacterId)?.name || "Narrator"} · {segment.text}</span><audio controls preload="none" src={`/api/projects/${encodeURIComponent(project.slug)}/scenes/${encodeURIComponent(selectedScene.id)}/tts?segmentId=${encodeURIComponent(segment.id)}`}>Trình duyệt không hỗ trợ phát audio.</audio></label>)}</div>}
                  {selectedSceneAudioUrl && <audio className="scene-tts-player" controls preload="none" src={selectedSceneAudioUrl}>Trình duyệt không hỗ trợ phát audio.</audio>}
                </section>
              </details>
              <details className="scene-detail-disclosure">
                <summary><span><strong>AI pre-check & duyệt</strong><small>{sceneAiReviewLabel(selectedAiReview.status)} · {selectedAiReview.score}/100 · {sceneReviewLabel(selectedReviewStatus)}</small></span><span className="scene-detail-disclosure-status">Mở kiểm tra</span></summary>
                <div className="scene-detail-review-content">
                  <div className={`scene-ai-card ${sceneAiReviewTone(selectedAiReview.status)}`}>
                    <div className="scene-ai-heading"><div><small>AI PRE-CHECK</small><strong>{sceneAiReviewLabel(selectedAiReview.status)}</strong></div><span>{selectedAiReview.score}/100</span></div>
                    <p className="scene-ai-summary">{selectedAiReview.summary}</p>
                    {Object.keys(selectedAiReview.checks).length > 0 && <div className="scene-ai-checks">{Object.entries(selectedAiReview.checks).map(([key, value]) => <span key={key} className={`scene-ai-check ${value}`}><i />{key}: {value === "pass" ? "đạt" : value === "warning" ? "cảnh báo" : "lỗi"}</span>)}</div>}
                    {selectedAiReview.issues.length > 0 && <ul className="scene-ai-issues">{selectedAiReview.issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul>}
                  </div>
                  <div className="scene-qa-card">
                    <div className="scene-qa-heading"><div><small>HUMAN CHECK</small><strong>Người dùng xác nhận</strong></div><span>{reviewSaving ? "Đang lưu…" : selectedAiReview.status === "pending" ? "Chờ AI pre-check" : "Lưu theo project"}</span></div>
                    <div className="scene-review-buttons">
                  {(["unreviewed", "approved", "needs_changes"] as SceneReviewStatus[]).map((status) => <button key={status} type="button" className={`scene-review-button ${sceneReviewTone(status)} ${selectedReviewStatus === status ? "active" : ""}`} onClick={() => void saveSceneReview(status)} disabled={reviewSaving || selectedAiReview.status === "pending"}>{sceneReviewLabel(status)}</button>)}
                    </div>
                    <textarea className="scene-review-note" value={sceneReviewNote} onChange={(event) => setSceneReviewNote(event.target.value)} placeholder="Ghi chú: visual chưa khớp, voice bị ngắt, cần tạo lại bằng MaiVideo…" aria-label="Ghi chú review cảnh" />
                    <div className="scene-qa-footer"><span>{selectedAiReview.status === "pending" ? "Chờ AI pre-check" : ""}</span><button className="secondary-button compact" type="button" onClick={() => void saveSceneReview()} disabled={reviewSaving || selectedAiReview.status === "pending"}>Lưu ghi chú</button></div>
                  </div>
                </div>
              </details>
              <details className="scene-detail-disclosure">
                <summary><span><strong>Lời thoại & prompt</strong><small>{selectedVoice ? "Có voiceover" : "Chưa có voiceover"} · video prompt cảnh này</small></span><span className="scene-detail-disclosure-status">Nội dung</span></summary>
                <div className="scene-detail-copy"><div><small>VOICEOVER</small><p>{selectedVoice || "Chưa có voiceover"}</p></div><div><small>VIDEO PROMPT</small><p>{selectedPrompt || "Chưa có video prompt"}</p></div></div>
              </details>
            </article>
          </div>
        )}
      </section>}

      {hasEpisodeScripts && <section className="publishing-package-card panel-card" id="publishing-package">
        <div className="publishing-package-heading">
          <div className="publishing-package-title">
            <span className="publishing-package-icon"><Icon name="spark" size={17} /></span>
            <div><div className="section-kicker">VIDEO PACKAGING</div><h2>Title & prompt thumbnail</h2></div>
          </div>
          <span className={`tool-status ${selectedPublishingPackage?.stale ? "warning" : selectedPublishingPackage ? "good" : "neutral"}`}>{selectedPublishingPackage?.stale ? "Cần cập nhật" : selectedPublishingPackage?.source === "gpt-import" ? "Đã nhập từ GPT" : selectedPublishingPackage ? "Đã có gợi ý" : "Chưa tạo"}</span>
        </div>
        <p className="publishing-package-description">Title ngắn có KEY, tò mò và chạm pain point; thumbnail ưu tiên cảm xúc, chữ lớn tương phản và điểm nhấn dễ thấy. Tranh luận phải bám nội dung thật. Prompt ảnh bằng tiếng Anh, overlay được tạo riêng để tránh lỗi chữ trong ảnh.</p>
        <div className="publishing-package-controls">
          <label htmlFor="publishing-package-scope"><span>Video cần đóng gói</span><select id="publishing-package-scope" value={publishingScope} onChange={(event) => { setPublishingScope(event.target.value); setPublishingError(""); setPublishingNotice(""); }}>
            <option value="series">Video toàn dự án{allEpisodeScriptsReady ? "" : " · cần hoàn tất các tập"}</option>
            {project.chunks.filter((chunk) => Boolean(chunk.outputPath)).map((chunk) => <option key={chunk.id} value={chunk.id}>Tập {String(project.chunks.findIndex((item) => item.id === chunk.id) + 1).padStart(2, "0")} · {chunk.id}</option>)}
          </select></label>
          <button className="primary-button compact" type="button" onClick={() => void generatePublishingPackage()} disabled={publishingBusy || !publishingTargetReady} title={!publishingTargetReady && publishingScope === "series" ? "Tạo xong kịch bản tất cả tập để đóng gói video toàn dự án" : undefined}>
            <Icon name="spark" size={14} />{publishingBusy ? "Đang tạo gợi ý…" : selectedPublishingPackage?.stale ? "Cập nhật gợi ý" : selectedPublishingPackage ? "Tạo lại title & thumbnail" : "Tạo title & thumbnail"}
          </button>
        </div>
        {!allEpisodeScriptsReady && publishingScope === "series" && <p className="publishing-package-hint">Tạo xong kịch bản tất cả tập để tạo gợi ý cho video toàn dự án. Có thể chọn một tập đã xong để tạo riêng.</p>}
        {publishingError && <p className="publishing-feedback error" role="alert">{publishingError}</p>}
        {publishingNotice && <p className="publishing-feedback" role="status">{publishingNotice}</p>}
        {selectedPublishingPackage ? <div className="publishing-results">
          <div className="publishing-result-heading"><h3>{publishingScope === "series" ? "Video toàn dự án" : `Gợi ý cho ${publishingScope}`}</h3><small>{selectedPublishingPackage.updatedAt ? `Cập nhật ${new Date(selectedPublishingPackage.updatedAt).toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}` : ""}</small></div>
          <div className="publishing-results-grid">
            <section className="publishing-result-group">
              <h4>Tiêu đề đề xuất</h4>
              <div className="publishing-title-list">{selectedPublishingPackage.titles.map((option, index) => <article className="publishing-title-option" key={`${index}-${option.title}`}>
                <div><span className="publishing-option-number">{String(index + 1).padStart(2, "0")}</span><div><strong>{option.title}</strong><p>{option.hook}</p>{option.angle && <small>{option.angle}</small>}</div></div>
                <button className="secondary-button compact" type="button" onClick={() => void copyPublishingText(option.title, "title")}><Icon name="copy" size={13} />Sao chép</button>
              </article>)}</div>
            </section>
            <section className="publishing-result-group">
              <h4>Prompt thumbnail</h4>
              <div className="publishing-thumbnail-list">{selectedPublishingPackage.thumbnails.map((thumbnail, index) => <details className="publishing-thumbnail-option" key={`${index}-${thumbnail.concept}`}>
                <summary><span><strong>{thumbnail.concept}</strong><small>Chữ overlay: {thumbnail.overlayText}</small></span><span className="publishing-prompt-toggle">Mở prompt</span></summary>
                <div className="publishing-prompt-copy"><p>{thumbnail.prompt}</p>{thumbnail.layoutNote && <small>{thumbnail.layoutNote}</small>}<button className="secondary-button compact" type="button" onClick={() => void copyPublishingText(`${thumbnail.prompt}\n\nOverlay text: ${thumbnail.overlayText}${thumbnail.layoutNote ? `\nLayout: ${thumbnail.layoutNote}` : ""}`, "prompt thumbnail")}><Icon name="copy" size={13} />Sao chép prompt</button></div>
              </details>)}</div>
            </section>
          </div>
        </div> : <div className="publishing-package-empty"><Icon name="file" size={17} /><span>Chưa có gợi ý cho phạm vi này. Tạo từ GPT khi xuất JSON hoặc bấm nút để sinh bằng Script LLM.</span></div>}
      </section>}

      <section className="production-tools" id="export">
        <article className="production-tool-card panel-card">
          <div className="production-tool-heading"><div><div className="section-kicker">CONTINUITY QA</div><h2>Kiểm tra mạch cảnh</h2></div><span className={`tool-status ${continuityQa?.status === "passed" ? "good" : continuityQa ? "warning" : "neutral"}`}>{continuityQa ? `${continuityQa.score}/100` : "Chưa chạy"}</span></div>
          <p>{continuityQa ? `${continuityQa.issueCount} điểm cần xem · ${continuityQa.sceneCount}/${continuityQa.expectedSceneCount} cảnh` : "Kiểm tra thứ tự cảnh và continuity giữa các tập."}</p>
          <div className="production-tool-actions"><button className="secondary-button compact" type="button" onClick={() => void runContinuityQa()} disabled={continuityRunning || scenesLoading || !scenes.length}><Icon name="spark" size={14} />{continuityRunning ? "Đang kiểm tra…" : "Chạy continuity QA"}</button>{continuityQa?.issueCount ? <span className="tool-hint">AI/người dùng vẫn là bước duyệt cuối</span> : null}</div>
        </article>
        <article className="production-tool-card panel-card">
          <div className="production-tool-heading"><div><div className="section-kicker">MAIVIDEO QUEUE</div><h2>Batch video AI</h2></div><span className={`tool-status ${videoQueue?.status === "completed" ? "good" : videoQueue?.status === "failed" ? "warning" : videoQueue?.status === "paused" ? "warning" : "neutral"}`}>{videoQueue ? `${videoQueueSummary.queued} chờ` : "Chưa xếp hàng"}</span></div>
          <p>{videoQueue ? `${videoQueueSummary.completed} xong · ${videoQueueSummary.failed} lỗi · ${videoQueueSummary.running} đang chạy` : "Tạo video AI cho các cảnh còn thiếu."}</p>
          <div className="production-tool-actions"><button className="secondary-button compact" type="button" onClick={() => void queueVideoJobs(true)} disabled={!scenes.length || videoQueueRunning || scriptBlocksIndependentTasks || ttsRunning || batchMediaBusy || Boolean(generatingSceneId)}><Icon name="layers" size={14} />Xếp hàng AI còn thiếu</button><button className="primary-button compact" type="button" onClick={() => void runVideoQueue()} disabled={videoQueueRunning || !videoQueueCanRun || scriptBlocksIndependentTasks || ttsRunning || batchMediaBusy || Boolean(generatingSceneId)}><Icon name="play" size={14} />{videoQueueRunning ? "Đang chạy queue…" : videoQueue?.status === "running" && !videoQueueSummary.queued ? "Khôi phục queue" : "Chạy queue"}</button>{videoQueueRunning && <button className="text-button" type="button" onClick={() => void controlVideoQueue("pause")}>Dừng sau job hiện tại</button>}{videoQueue?.status === "paused" && <button className="text-button" type="button" onClick={() => void controlVideoQueue("resume")} disabled={scriptBlocksIndependentTasks || ttsRunning || batchMediaBusy || Boolean(generatingSceneId)}>Tiếp tục</button>}{videoQueueSummary.failed > 0 && <button className="text-button" type="button" onClick={() => void controlVideoQueue("retry_failed")} disabled={scriptBlocksIndependentTasks || ttsRunning || batchMediaBusy || Boolean(generatingSceneId)}>Retry lỗi</button>}</div>
          {failedVideoJobs.length > 0 && <div className="video-queue-errors" aria-label="Chi tiết job video lỗi">
            {failedVideoJobs.slice(0, 3).map((job) => <div className="video-queue-error" key={job.id}>
              <strong>{job.sceneId} · {videoFailureStageLabel(job.failureStage)}</strong>
              <span>{job.error || "Tạo video thất bại."}</span>
              <small>{job.requestId ? `Request ${job.requestId}` : ""}{job.requestId && job.seedanceTaskId ? " · " : ""}{job.seedanceTaskId ? `Task ${job.seedanceTaskId}` : ""}{(job.requestId || job.seedanceTaskId) ? " · " : ""}{job.retryStrategy === "same_task" ? "Retry tiếp tục task này" : "Retry tạo task mới"}</small>
            </div>)}
            {failedVideoJobs.length > 3 && <small className="video-queue-more-errors">Còn {failedVideoJobs.length - 3} job lỗi khác.</small>}
          </div>}
        </article>
        <article className="production-tool-card panel-card">
          <div className="production-tool-heading"><div><div className="section-kicker">FULL PROJECT RENDER</div><h2>Xuất video toàn dự án</h2></div><span className={`tool-status ${project.render?.stale || project.render?.status === "failed" ? "warning" : project.render?.status === "completed" ? "good" : "neutral"}`}>{project.render?.stale ? "Bản cũ" : project.render?.status === "completed" ? "Đã render" : project.render?.status === "running" ? "Đang render" : "MP4 + SRT"}</span></div>
          <p>{project.render?.status === "failed" && project.render.error ? `Lần render trước thất bại: ${project.render.error}` : project.render?.stale ? `Kịch bản, thoại hoặc media đã đổi sau lần xuất · bản cũ có ${project.render.sceneCount || 0} cảnh. Hãy render lại để đồng bộ MP4/SRT.` : project.render?.outputPath ? `${project.render.sceneCount || scenes.length} cảnh toàn dự án · ${Math.round((project.render.durationSec || 0) / 60)} phút · ${project.render.audioReady ? "đã có tiếng TTS hoặc tiếng gốc" : "chưa có tiếng"}` : "Ghép toàn bộ tập thành MP4 + SRT."}</p>
          <div className="production-tool-actions"><button className="primary-button compact" type="button" onClick={() => void renderProjectVideo()} disabled={renderRunning || isRunning || Boolean(runningScriptChunkId)}><Icon name="play" size={14} />{renderRunning ? renderingChunkId ? `Đang ghép Tập ${String(chunks.find((chunk) => chunk.id === renderingChunkId)?.episodeNumber || "").padStart(2, "0")}…` : "Đang render toàn dự án…" : project.render?.status === "failed" ? "Thử render lại toàn dự án" : project.render?.stale ? "Render lại đủ các tập" : "Render toàn dự án"}</button>{project.render?.outputPath && <><a className="text-button" href={`/api/projects/${encodeURIComponent(project.slug)}/render/file?kind=video`} target="_blank" rel="noreferrer">{project.render.stale ? "Mở MP4 bản cũ" : "Mở MP4"} <Icon name="arrow" size={13} /></a><a className="text-button" href={`/api/projects/${encodeURIComponent(project.slug)}/render/file?kind=video&download=1`} download={`${project.slug}.mp4`}>{project.render.stale ? "Tải MP4 bản cũ" : "Tải MP4"} <Icon name="download" size={13} /></a><a className="text-button" href={`/api/projects/${encodeURIComponent(project.slug)}/render/file?kind=subtitle`} target="_blank" rel="noreferrer">{project.render.stale ? "SRT bản cũ" : "SRT"}</a></>}</div>
        </article>
      </section>

      <section className="render-settings-panel panel-card">
        <div className="render-settings-heading">
          <div><div className="section-kicker">TÙY CHỈNH HẬU KỲ</div><h2>Chuyển động, watermark & hiệu ứng cho MP4</h2><p>Áp dụng trên toàn video khi xuất.</p></div>
          <span className="render-settings-save-status"><span className="render-settings-save-dot" />Lưu cùng lần render</span>
        </div>
        <details className="render-settings-details">
          <summary>
            <span className="render-settings-summary-main"><span className="render-settings-summary-icon"><Icon name="spark" size={14} /></span><span><strong>Tùy chỉnh hậu kỳ</strong><small>Chuyển động · chữ · watermark · logo</small></span></span>
            <span className="render-settings-summary-action">Mở / thu gọn</span>
          </summary>
          <div className="render-settings-groups">
            <section className="render-setting-group">
              <div className="render-setting-group-heading"><span className="render-setting-group-number">01</span><div><strong>Nhịp & chuyển động</strong><small>Kiểm soát cách camera di chuyển trên toàn timeline</small></div></div>
              <div className="render-setting-group-grid render-setting-group-grid-motion">
                <label className="render-setting-field render-setting-field-wide"><span><span>Tốc độ video</span><strong>{renderSettings.speed.toFixed(2)}×</strong></span><input type="range" min="0.5" max="3" step="0.05" value={renderSettings.speed} onChange={(event) => updateRenderSetting("speed", Number(event.target.value))} /><small className="render-setting-help">Mặc định 1.00× · 0.5× chậm · 3× nhanh</small></label>
                <label className={`render-setting-check render-setting-check-card ${renderSettings.enableRandomPanZoom ? "is-active" : ""}`}><input type="checkbox" checked={renderSettings.enableRandomPanZoom} onChange={(event) => updateRenderSetting("enableRandomPanZoom", event.target.checked)} /><span className="render-setting-check-copy"><strong>Bật X / Y / zoom ngẫu nhiên</strong><small>{project.presetId === "ai-drama" ? "Mặc định tắt cho AI Drama; giữ nguyên timeline, không cắt cảnh" : "Mặc định bật như FastEdit; giữ nguyên timeline, không cắt cảnh"}</small></span></label>
                <label className={`render-setting-check render-setting-check-card ${renderSettings.useRandomInterval ? "is-active" : ""}`}><input type="checkbox" checked={renderSettings.useRandomInterval} disabled={!renderSettings.enableRandomPanZoom} onChange={(event) => updateRenderSetting("useRandomInterval", event.target.checked)} /><span className="render-setting-check-copy"><strong>Đổi nhịp chuyển động</strong><small>FastEdit chọn một nhịp trong khoảng min–max cho toàn timeline</small></span></label>
                <div className="render-setting-subgrid render-setting-subgrid-three render-setting-field-wide">
                  <label className="render-setting-field"><span>Nhịp min (s)</span><input type="number" min="0.5" max="30" step="0.1" value={renderSettings.minInterval} disabled={!renderSettings.enableRandomPanZoom || !renderSettings.useRandomInterval} onChange={(event) => updateRenderSetting("minInterval", Number(event.target.value))} /></label>
                  <label className="render-setting-field"><span>Nhịp max (s)</span><input type="number" min="0.7" max="30" step="0.1" value={renderSettings.maxInterval} disabled={!renderSettings.enableRandomPanZoom || !renderSettings.useRandomInterval} onChange={(event) => updateRenderSetting("maxInterval", Number(event.target.value))} /></label>
                  <label className="render-setting-field"><span>Nhịp cố định (s)</span><input type="number" min="0.5" max="30" step="0.1" value={renderSettings.interval} disabled={!renderSettings.enableRandomPanZoom || renderSettings.useRandomInterval} onChange={(event) => updateRenderSetting("interval", Number(event.target.value))} /></label>
                </div>
                <label className="render-setting-field"><span><span>Pan X tối đa</span><strong>±{renderSettings.maxPanX}%</strong></span><input type="range" min="1" max="30" step="1" value={renderSettings.maxPanX} disabled={!renderSettings.enableRandomPanZoom} onChange={(event) => updateRenderSetting("maxPanX", Number(event.target.value))} /></label>
                <label className="render-setting-field"><span><span>Pan Y tối đa</span><strong>±{renderSettings.maxPanY}%</strong></span><input type="range" min="1" max="30" step="1" value={renderSettings.maxPanY} disabled={!renderSettings.enableRandomPanZoom} onChange={(event) => updateRenderSetting("maxPanY", Number(event.target.value))} /></label>
                <label className="render-setting-field"><span><span>Zoom min</span><strong>{renderSettings.minScale.toFixed(2)}×</strong></span><input type="range" min="1.15" max="1.25" step="0.01" value={Math.min(1.25, renderSettings.minScale)} disabled={!renderSettings.enableRandomPanZoom} onChange={(event) => updateRenderSetting("minScale", Number(event.target.value))} /></label>
                <label className="render-setting-field"><span><span>Zoom max</span><strong>{renderSettings.maxScale.toFixed(2)}×</strong></span><input type="range" min="1.15" max="1.25" step="0.01" value={Math.min(1.25, renderSettings.maxScale)} disabled={!renderSettings.enableRandomPanZoom} onChange={(event) => updateRenderSetting("maxScale", Number(event.target.value))} /></label>
              </div>
            </section>

            <section className="render-setting-group">
              <div className="render-setting-group-heading"><span className="render-setting-group-number">02</span><div><strong>Hình ảnh & phát lại</strong><small>Thêm hiệu ứng nền và thay đổi hướng phát</small></div></div>
              <div className="render-setting-group-grid render-setting-group-grid-media">
                <label className="render-setting-field"><span>Hiệu ứng phủ</span><select value={renderSettings.visualEffect} onChange={(event) => updateRenderSetting("visualEffect", event.target.value as RenderSettings["visualEffect"])}><option value="none">Không hiệu ứng</option><option value="fog">Sương mù</option><option value="fireflies">Đom đóm</option><option value="fire">Lửa</option><option value="rain">Mưa</option><option value="snow">Tuyết rơi</option></select></label>
                <label className="render-setting-field"><span>Bộ lọc màu</span><select value={renderSettings.colorFilter} onChange={(event) => updateRenderSetting("colorFilter", event.target.value as RenderSettings["colorFilter"])}><option value="None">Gốc</option><option value="Warm">Ấm</option><option value="Cool">Lạnh</option><option value="Vintage">Vintage</option><option value="B&W">Đen trắng</option></select></label>
                <label className={`render-setting-check render-setting-check-card ${renderSettings.mirror ? "is-active" : ""}`}><input type="checkbox" checked={renderSettings.mirror} onChange={(event) => updateRenderSetting("mirror", event.target.checked)} /><span className="render-setting-check-copy"><strong>Lật ngang video</strong><small>Đảo hình trái ↔ phải</small></span></label>
                <label className={`render-setting-check render-setting-check-card ${renderSettings.reverse ? "is-active" : ""}`}><input type="checkbox" checked={renderSettings.reverse} onChange={(event) => updateRenderSetting("reverse", event.target.checked)} /><span className="render-setting-check-copy"><strong>Đảo chiều phát</strong><small>Phát cảnh và audio theo chiều ngược</small></span></label>
                <div className="render-setting-subgrid render-setting-subgrid-three render-setting-field-wide"><label className="render-setting-field"><span>Cắt đầu (s)</span><input type="number" min="0" max="86400" step="0.1" value={renderSettings.trimStart} onChange={(event) => updateRenderSetting("trimStart", Number(event.target.value))} /></label><label className="render-setting-field"><span>Cắt cuối (s)</span><input type="number" min="0" max="86400" step="0.1" value={renderSettings.trimEnd ?? ""} placeholder="Cuối video" onChange={(event) => updateRenderSetting("trimEnd", event.target.value === "" ? null : Number(event.target.value))} /></label><div className="render-setting-help render-setting-field"><span>FastEdit thứ tự</span><small>Hiệu ứng màu/cắt được áp dụng sau pan/zoom và trước khi xuất MP4.</small></div></div>
              </div>
            </section>

            <section className="render-setting-group">
              <div className="render-setting-group-heading"><span className="render-setting-group-number">03</span><div><strong>Chữ & nhận diện</strong><small>Thiết lập title, watermark và logo trên video</small></div></div>
              <div className="render-setting-group-grid render-setting-group-grid-identity">
                <label className="render-setting-field render-setting-field-title"><span>Tiêu đề đầu video</span><input value={renderSettings.titleText} placeholder="Ví dụ: 14 Chilling True Stories" onChange={(event) => updateRenderSetting("titleText", event.target.value)} /></label>
                <label className="render-setting-field"><span>Vị trí tiêu đề</span><select value={renderSettings.titlePosition} onChange={(event) => updateRenderSetting("titlePosition", event.target.value as RenderSettings["titlePosition"])}><option value="top">Trên</option><option value="center">Giữa</option><option value="bottom">Dưới</option></select></label>
                <label className="render-setting-field"><span><span>Cỡ chữ title</span><strong>{renderSettings.titleFontSize}px</strong></span><input type="range" min="18" max="140" step="2" value={renderSettings.titleFontSize} onChange={(event) => updateRenderSetting("titleFontSize", Number(event.target.value))} /></label>
                <label className="render-setting-field"><span>Màu title</span><select value={renderSettings.titleColor} onChange={(event) => updateRenderSetting("titleColor", event.target.value as RenderSettings["titleColor"])}><option value="white">Trắng</option><option value="yellow">Vàng</option><option value="cyan">Cyan</option><option value="black">Đen</option></select></label>
                <label className="render-setting-field render-setting-field-watermark"><span>Watermark chạy ngẫu nhiên</span><input value={renderSettings.watermarkText} placeholder="@tenkenh" onChange={(event) => updateRenderSetting("watermarkText", event.target.value)} /></label>
                <label className="render-setting-field"><span><span>Tốc độ watermark</span><strong>{renderSettings.watermarkSpeed}</strong></span><input type="range" min="20" max="400" step="5" value={renderSettings.watermarkSpeed} onChange={(event) => updateRenderSetting("watermarkSpeed", Number(event.target.value))} /></label>
                <div className="render-setting-field render-setting-logo-field"><span>Logo</span><div className="render-setting-logo-controls"><select value={renderSettings.logo} onChange={(event) => updateRenderSetting("logo", event.target.value as RenderSettings["logo"])}><option value="none">Không logo</option><option value="maivideo">Logo MaiVideo</option><option value="custom" disabled={!renderSettings.logoPath}>Logo tải lên</option></select><label className="render-setting-file-picker" htmlFor={`render-logo-upload-${project.slug}`}><span>{logoUploading ? "Đang tải…" : "Tải logo"}</span><input id={`render-logo-upload-${project.slug}`} type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadRenderLogo} disabled={logoUploading} /></label></div><small className="render-setting-help">{renderSettings.logoPath ? `Đã có: ${renderSettings.logoPath.split("/").pop()}` : "PNG / JPG / WebP · tối đa 10 MB"}</small></div>
                <label className="render-setting-field"><span>Vị trí logo</span><select value={renderSettings.logoPosition} onChange={(event) => updateRenderSetting("logoPosition", event.target.value as RenderSettings["logoPosition"])}><option value="top-left">Trên trái</option><option value="top-right">Trên phải</option><option value="center">Giữa</option><option value="bottom-left">Dưới trái</option><option value="bottom-right">Dưới phải</option></select></label>
              </div>
            </section>

          </div>
        </details>
      </section>

<details className="project-activity-panel panel-card">
        <summary><strong>Tiến trình & hoạt động</strong><span>{projectActivities.length} sự kiện · Mở</span></summary>
      <div className="content-grid"><div className="pipeline-card panel-card"><div className="card-heading"><div><div className="section-kicker">PIPELINE</div><h2>Quy trình sản xuất</h2></div><Link href="/tasks" className="text-button">Nhật ký <Icon name="arrow" size={13} /></Link></div><div className="pipeline-list"><div className="pipeline-item done"><div className="pipeline-marker"><Icon name="check" size={15} /></div><div className="pipeline-body"><div className="pipeline-title-row"><strong>Master Pass</strong><StatusPill tone="green">Đã xong</StatusPill></div><p>{project.sourceStatus === "ready" ? "Nguồn đã có transcript/brief" : "Chờ transcript/brief từ người dùng"}</p></div><div className="pipeline-line" /></div><div className={`pipeline-item ${project.status === "processing" ? "active" : "pending"}`}><div className="pipeline-marker">{project.status === "processing" ? <span className="marker-pulse" /> : <span>02</span>}</div><div className="pipeline-body"><div className="pipeline-title-row"><strong>Sinh kịch bản cảnh</strong>{project.status === "processing" && <StatusPill tone="orange">Live</StatusPill>}</div><p>{project.totalChunks} gói × {project.chunkSize} cảnh · provider server-side</p></div><div className="pipeline-line" /></div><div className={`pipeline-item ${project.completedScenes >= project.totalScenes ? "done" : "pending"}`}><div className="pipeline-marker">{project.completedScenes >= project.totalScenes ? <Icon name="check" size={15} /> : <span>03</span>}</div><div className="pipeline-body"><div className="pipeline-title-row"><strong>AI pre-check & human check</strong></div><p>AI đánh giá từng chunk trước, sau đó người dùng xác nhận</p></div><div className="pipeline-line" /></div><div className="pipeline-item pending"><div className="pipeline-marker"><span>04</span></div><div className="pipeline-body"><div className="pipeline-title-row"><strong>Xuất project</strong></div><p>JSON, prompts, audio timing và báo cáo lỗi</p></div></div></div></div><div className="activity-card panel-card"><div className="card-heading"><div><div className="section-kicker">ACTIVITY</div><h2>Hoạt động thật</h2></div><span className="live-label"><span className="live-dot" />Server</span></div><div className="activity-list">{projectActivities.length ? projectActivities.map((activity) => <div className="activity-item" key={activity.id}><div className={`activity-icon ${activity.status === "success" ? "green" : activity.status === "error" ? "orange" : "purple"}`}><Icon name={activity.status === "success" ? "check" : activity.status === "error" ? "alert" : "spark"} size={15} /></div><div><strong>{activity.title}</strong><p>{activity.detail}</p></div><span className="activity-time">{new Date(activity.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span></div>) : <div className="empty-state"><strong>Chưa có hoạt động</strong><span>Hoạt động sẽ xuất hiện sau khi lưu nguồn hoặc chạy chunk.</span></div>}</div><Link className="activity-footer" href="/tasks">Xem hàng đợi <Icon name="arrow" size={14} /></Link></div></div>


      </details>
      <footer className="page-footer"><span>StoryAI · {project.slug}</span><span>Autosaved · scene-script.v1</span></footer>
      </>
      {sceneImagePreview && sceneImagePreviewUrl && <div className="ai-drama-image-lightbox" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSceneImagePreview(null); }} onKeyDown={(event) => { if (event.key === "Escape") setSceneImagePreview(null); }}>
        <figure className="ai-drama-image-lightbox-content" role="dialog" aria-modal="true" aria-label={`Ảnh cảnh ${sceneNumberLabel(sceneImagePreview)}`}>
          <button className="ai-drama-image-lightbox-close" type="button" autoFocus onClick={() => setSceneImagePreview(null)} aria-label="Đóng ảnh">×</button>
          <img src={sceneImagePreviewUrl} alt={`Ảnh cảnh ${sceneNumberLabel(sceneImagePreview)}`} />
          <figcaption>{sceneNumberLabel(sceneImagePreview)} · {sceneImagePreview.chunkId}</figcaption>
        </figure>
      </div>}
      {episodeScriptEditorOpen && <div className="extend-episodes-backdrop episode-script-import-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !importingScripts) setEpisodeScriptEditorOpen(false); }}>
        <section className="episode-script-import-dialog" role="dialog" aria-modal="true" aria-labelledby="episode-script-import-title">
          <div className="episode-script-import-heading"><div><div className="section-kicker">KỊCH BẢN THỦ CÔNG</div><h2 id="episode-script-import-title">Soạn và nhập một tập</h2><p>Chỉnh JSON ngay tại đây hoặc dán JSON đã soạn; sau đó nhập thẳng vào project.</p></div><button className="text-button" type="button" onClick={() => setEpisodeScriptEditorOpen(false)} disabled={importingScripts}>Đóng</button></div>
          <div className="episode-script-import-controls">
            <label className="extend-episodes-field"><span>Tập cần soạn</span><select value={episodeScriptChunkId} onChange={(event) => selectEpisodeScriptChunk(event.target.value)} disabled={importingScripts}>{project.chunks.map((chunk, index) => <option key={chunk.id} value={chunk.id}>{"Tập " + String(index + 1).padStart(2, "0") + " · " + chunk.id + " · S" + String(chunk.sceneStart).padStart(3, "0") + "–S" + String(chunk.sceneEnd).padStart(3, "0") + (chunk.outputPath ? " · đã có kịch bản" : " · chưa có kịch bản")}</option>)}</select></label>
            <button className="secondary-button compact" type="button" disabled={importingScripts || !episodeScriptChunkId} onClick={() => {
              const target = project.chunks.find((chunk) => chunk.id === episodeScriptChunkId);
              if (!target) return;
              const currentTemplate = episodeScriptTemplate(target.id);
              if (episodeScriptDraft.trim() && episodeScriptDraft !== currentTemplate && !window.confirm("Thay phần JSON đang soạn bằng mẫu mới cho tập này?")) return;
              updateEpisodeScriptDraft(currentTemplate);
            }}><Icon name="file" size={14} />Chèn lại mẫu tập</button>
          </div>
          <div className="episode-script-import-note"><Icon name="help" size={15} /><span>Mẫu tạo đủ scene ID theo phạm vi tập, mỗi cảnh mặc định 15 giây. Hãy sửa nội dung trong dấu [ ], chỉnh timecode khi đổi cảnh sang 5 hoặc 10 giây, và giữ ID liên tục. Với AI Drama, cảnh dialogue_led bắt buộc tối thiểu 10 từ/5 giây, 20 từ/10 giây, 30 từ/15 giây; mục tiêu tương ứng 10–15, 20–30, 30–45 từ (không quá 3 từ/giây). Import sẽ báo lỗi nếu thiếu hoặc quá mức. Cảnh visual_led/im lặng có chủ đích được miễn. Hook mở tập phải vào thẳng điểm gây tò mò trong 0–5 giây; end hook phải tạo hệ quả nối sang tập kế.</span></div>
          <label className="episode-script-json-field"><span>JSON scene-script.v1 · một tập</span><textarea spellCheck={false} aria-label="JSON kịch bản của một tập" value={episodeScriptDraft} onChange={(event) => updateEpisodeScriptDraft(event.target.value)} disabled={importingScripts} /></label>
          {runMessage && <div className={"run-message " + runMessage.tone} role={runMessage.tone === "error" ? "alert" : "status"}><span><Icon name={runMessage.tone === "success" ? "check" : "alert"} size={13} /></span>{runMessage.text}</div>}
          <div className="character-setup-actions"><button className="secondary-button" type="button" onClick={() => setEpisodeScriptEditorOpen(false)} disabled={importingScripts}>Để sau</button><button className="primary-button" type="button" onClick={() => void importEpisodeScriptDraft()} disabled={importingScripts || !episodeScriptDraft.trim()}><Icon name={importingScripts ? "clock" : "file"} size={15} />{importingScripts ? "Đang nhập tập…" : "Nhập kịch bản tập này"}</button><button className="secondary-button" type="button" onClick={() => void copyEpisodeScriptDraft()} disabled={importingScripts || !episodeScriptDraft.trim()} title="Sao chép JSON hiện có trong trình soạn thảo"><Icon name="copy" size={15} />Copy JSON</button></div>
        </section>
      </div>}
      {showExtendEpisodes && <div className="extend-episodes-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !extendingEpisodes) setShowExtendEpisodes(false); }}>
        <section className="extend-episodes-dialog" role="dialog" aria-modal="true" aria-labelledby="extend-episodes-title">
          <div className="extend-episodes-icon"><Icon name="plus" size={20} /></div>
          <div className="section-kicker">NỐI DÀI SERIES</div>
          <h2 id="extend-episodes-title">Thêm tập vào “{project.title}”</h2>
          <p>Các tập hiện tại, video đã ghép và hồ sơ nhân vật sẽ được giữ nguyên. Kịch bản tập mới sẽ tiếp nối từ continuity của tập trước đã tạo xong.</p>
          <label className="extend-episodes-field"><span>Số tập muốn thêm</span><div><input type="number" min={1} max={10} step={1} value={extendEpisodeCount} disabled={extendingEpisodes} onChange={(event) => setExtendEpisodeCount(Math.min(10, Math.max(1, Math.floor(Number(event.target.value) || 1))))} /><small>1–10 tập mỗi lần</small></div></label>
          <div className="extend-episodes-summary"><span><Icon name="scene" size={15} />{extendEpisodeCount * project.chunkSize} cảnh mới</span><span><Icon name="clock" size={15} />khoảng {Math.round((extendEpisodeCount * project.chunkSize * (project.sceneDurationSec || 15)) / 60)} phút</span><span><Icon name="stack" size={15} />Tập {String(project.chunks.length + 1).padStart(2, "0")}–{String(project.chunks.length + extendEpisodeCount).padStart(2, "0")}</span></div>
          <div className="extend-episodes-note"><Icon name="users" size={15} /><span>Hồ sơ nhân vật cũ vẫn dùng được. Sau khi tạo kịch bản, hãy gán nhân vật trở lại các cảnh có họ xuất hiện.</span></div>
          <div className="character-setup-actions"><button className="secondary-button" type="button" onClick={() => setShowExtendEpisodes(false)} disabled={extendingEpisodes}>Để sau</button><button className="primary-button" type="button" onClick={() => void appendEpisodes()} disabled={extendingEpisodes}><Icon name={extendingEpisodes ? "clock" : "plus"} size={15} />{extendingEpisodes ? "Đang thêm tập…" : `Thêm ${extendEpisodeCount} tập`}</button></div>
        </section>
      </div>}
    </div>
  );
}

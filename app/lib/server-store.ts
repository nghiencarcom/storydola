import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { headers } from "next/headers";
import { MAX_SCENE_DURATION_SEC, normalizeProjectChunkSize, type Activity, type CreateProjectInput, type DurationMode, type ProjectChunk, type RenderState, type ScriptFormat, type ScriptMode, type StoryAIData, type StoryProject, type UpdateProjectInput } from "./project-types";
import { resolveMediaGenerationSettings } from "./media-generation-settings";
import { getManualScriptMetrics } from "./script-utils";
import { continuityContextFromOutput } from "./story-context";
import { DEFAULT_IMAGE_STYLE, DEFAULT_VISUAL_STYLE, normalizeProjectStyleSettings } from "./visual-styles";
import { DEFAULT_CONTENT_GENRE, DEFAULT_STORY_SETTING, normalizeContentGenre, normalizeSecondaryGenres, normalizeStorySetting } from "./content-genres";
import { DEFAULT_RUN_CONCURRENCY } from "./run-concurrency-config";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "storyai.json");
const OUTPUT_DIR = path.join(DATA_DIR, "outputs");
const EMPTY_DATA: StoryAIData = { projects: [], activities: [] };
let mutationQueue: Promise<unknown> = Promise.resolve();

function normalizeProjectAspectRatio(value: unknown) {
  const ratio = typeof value === "string" ? value.trim() : "";
  return /^\d{1,3}:\d{1,3}$/.test(ratio) && ratio.split(":").every((part) => Number(part) > 0) ? ratio : "16:9";
}

type StoredWorkspaceFile = {
  version: 2;
  legacyDataOwnerId?: string;
  userData: Record<string, StoryAIData>;
};

function normalizeWorkspaceData(value: unknown): StoryAIData {
  const parsed = value && typeof value === "object" ? value as Partial<StoryAIData> : {};
  const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
  return {
    projects: projects.map((project) => {
      const styles = normalizeProjectStyleSettings(project.visualStyle, project.imageStyle);
      const legacyAnime = project.contentGenre === "anime";
      const contentGenre = normalizeContentGenre(project.contentGenre);
      return {
        ...project,
        aspectRatio: normalizeProjectAspectRatio(project.aspectRatio),
        contentGenre,
        secondaryGenres: normalizeSecondaryGenres(project.secondaryGenres, contentGenre),
        storySetting: normalizeStorySetting(project.storySetting || DEFAULT_STORY_SETTING),
        settingNotes: typeof project.settingNotes === "string" ? project.settingNotes : "",
        ...styles,
        imageStyle: legacyAnime && (!project.imageStyle || project.imageStyle === DEFAULT_IMAGE_STYLE) ? "2D anime" : styles.imageStyle,
        mediaGeneration: resolveMediaGenerationSettings(project.mediaGeneration),
      };
    }),
    activities: Array.isArray(parsed.activities) ? parsed.activities : [],
  };
}

async function readWorkspaceFile(): Promise<StoredWorkspaceFile | (StoryAIData & { legacyDataOwnerId?: string })> {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    return JSON.parse(raw) as StoredWorkspaceFile | (StoryAIData & { legacyDataOwnerId?: string });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("STORYAI_DATA_FILE_CORRUPT: Workspace data could not be read safely.", { cause });
    }
    await mkdir(DATA_DIR, { recursive: true });
    return { version: 2, userData: {} };
  }
}

async function writeWorkspaceFile(value: StoredWorkspaceFile | (StoryAIData & { legacyDataOwnerId?: string })) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(DATA_DIR, `.storyai.json.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, DATA_FILE);
  await chmod(DATA_FILE, 0o600);
}

function isPartitionedFile(value: StoredWorkspaceFile | (StoryAIData & { legacyDataOwnerId?: string })): value is StoredWorkspaceFile {
  return (value as StoredWorkspaceFile).version === 2 && Boolean((value as StoredWorkspaceFile).userData);
}

async function readUserPartition(userId: string): Promise<StoryAIData> {
  const stored = await readWorkspaceFile();
  if (isPartitionedFile(stored)) return normalizeWorkspaceData(stored.userData[userId] || EMPTY_DATA);
  if (stored.legacyDataOwnerId === userId) return normalizeWorkspaceData(stored);
  return structuredClone(EMPTY_DATA);
}

export async function readDataForUser(userId: string): Promise<StoryAIData> {
  return readUserPartition(userId);
}

async function currentUserId() {
  const userId = (await headers()).get("x-storyai-user-id")?.trim();
  if (!userId) throw new Error("STORYAI_AUTH_REQUIRED");
  return userId;
}

export async function readData(): Promise<StoryAIData> {
  const userId = await currentUserId();
  await claimLegacyWorkspace(userId);
  return readUserPartition(userId);
}

/** Assigns the pre-account workspace to the first authenticated MaiVideo user. */
export async function claimLegacyWorkspace(userId: string) {
  mutationQueue = mutationQueue.catch(() => undefined).then(async () => {
    const stored = await readWorkspaceFile();
    if (isPartitionedFile(stored)) return;
    const legacyData = normalizeWorkspaceData(stored);
    const next: StoredWorkspaceFile = {
      version: 2,
      legacyDataOwnerId: userId,
      userData: { [userId]: legacyData },
    };
    await writeWorkspaceFile(next);
  });
  await mutationQueue;
}

export async function updateDataForUser<T>(userId: string, mutator: (data: StoryAIData) => Promise<T> | T): Promise<T> {
  await claimLegacyWorkspace(userId);
  let result!: T;
  mutationQueue = mutationQueue.catch(() => undefined).then(async () => {
    const stored = await readWorkspaceFile();
    const data = await readUserPartition(userId);
    result = await mutator(data);
    const current = isPartitionedFile(stored)
      ? stored
      : { version: 2 as const, legacyDataOwnerId: stored.legacyDataOwnerId, userData: {} as Record<string, StoryAIData> };
    current.userData[userId] = data;
    await writeWorkspaceFile(current);
  });
  await mutationQueue;
  return result;
}

export async function updateData<T>(mutator: (data: StoryAIData) => Promise<T> | T): Promise<T> {
  return updateDataForUser(await currentUserId(), mutator);
}

export function now() {
  return new Date().toISOString();
}

export function markRenderStale(render?: RenderState): RenderState | undefined {
  if (!render) return render;
  const hasArtifact = Boolean(render.outputPath || render.manifestPath || render.subtitlePath)
    || Object.values(render.localizedRenders || {}).some((localized) => Boolean(localized.outputPath || localized.manifestPath || localized.subtitlePath || localized.status === "running"));
  if (!hasArtifact && render.status !== "running") return render;
  const localizedRenders = render.localizedRenders
    ? Object.fromEntries(Object.entries(render.localizedRenders).map(([language, localized]) => [language, markRenderStale(localized)])) as Record<string, RenderState>
    : undefined;
  return { ...render, status: render.status === "running" ? "running" : "idle", stale: true, ...(localizedRenders ? { localizedRenders } : {}), updatedAt: now() };
}

export function markLocalizedRendersStale(render?: RenderState): RenderState | undefined {
  if (!render?.localizedRenders) return render;
  return {
    ...render,
    localizedRenders: Object.fromEntries(Object.entries(render.localizedRenders).map(([language, localized]) => [language, markRenderStale(localized)])) as Record<string, RenderState>,
  };
}

export function calculateScenes(durationMinutes: number, sceneDurationSec = 15) {
  const boundedSceneDuration = Math.min(MAX_SCENE_DURATION_SEC, Math.max(1, Number(sceneDurationSec) || MAX_SCENE_DURATION_SEC));
  return Math.max(1, Math.ceil((durationMinutes * 60) / boundedSceneDuration));
}

export function createChunks(totalScenes: number, chunkSize: number): ProjectChunk[] {
  const timestamp = now();
  return Array.from({ length: Math.ceil(totalScenes / chunkSize) }, (_, index) => {
    const sceneStart = index * chunkSize + 1;
    const sceneEnd = Math.min(totalScenes, sceneStart + chunkSize - 1);
    return { id: `A${String(index + 1).padStart(2, "0")}`, sceneStart, sceneEnd, generatedScenes: 0, status: "queued", updatedAt: timestamp };
  });
}

export function makeActivity(input: Omit<Activity, "id" | "createdAt">): Activity {
  return { ...input, id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: now() };
}

function resolveProjectTiming(input: {
  scriptMode?: ScriptMode;
  scriptFormat?: ScriptFormat;
  durationMode?: DurationMode;
  durationMinutes?: number;
  sourceText?: string;
}) {
  const scriptMode = input.scriptMode || "ai";
  const requestedMinutes = Math.max(1, Number(input.durationMinutes) || 60);
  const durationMode = scriptMode === "manual"
    ? input.durationMode || "auto"
    : "manual";
  const requestedSeconds = requestedMinutes * 60;

  if (scriptMode === "manual" && input.sourceText?.trim()) {
    const metrics = getManualScriptMetrics({
      text: input.sourceText,
      format: input.scriptFormat || "plain_text",
      durationMode,
      targetDurationSeconds: requestedSeconds,
    });
    if (metrics.durationSeconds > 0) {
      return {
        durationMode,
        durationMinutes: Number((metrics.durationSeconds / 60).toFixed(3)),
        durationSeconds: metrics.durationSeconds,
        totalScenes: metrics.sceneCount,
      };
    }
  }

  return {
    durationMode,
    durationMinutes: requestedMinutes,
    durationSeconds: requestedSeconds,
    totalScenes: calculateScenes(requestedMinutes, MAX_SCENE_DURATION_SEC),
  };
}

export function makeProject(input: CreateProjectInput, slug: string): StoryProject {
  const timing = resolveProjectTiming(input);
  const { deferSourceIngest: _deferSourceIngest, ...projectInput } = input;
  const chunkSize = normalizeProjectChunkSize(input.chunkSize);
  return {
    ...projectInput,
    id: `project-${randomUUID()}`,
    slug,
    title: input.title.trim(),
    sourceUrl: input.sourceUrl?.trim() || "",
    sourceText: input.sourceText?.trim() || "",
    sourceStatus: input.sourceText?.trim() ? "ready" : "missing",
    scriptMode: input.scriptMode || "ai",
    scriptFormat: input.scriptFormat || "plain_text",
    durationMode: timing.durationMode,
    durationSeconds: timing.durationSeconds,
    durationMinutes: timing.durationMinutes,
    sceneDurationSec: MAX_SCENE_DURATION_SEC,
    chunkSize,
    mediaSource: input.presetId === "ai-drama" ? "maivideo-video" : input.mediaSource || "stock-mixed",
    mediaGeneration: resolveMediaGenerationSettings(input.mediaGeneration),
    voiceProvider: input.voiceProvider || "omnivoice",
    voiceId: input.voiceId || "",
    voiceName: input.voiceName || "",
    voiceLanguage: input.voiceLanguage || input.language || "vi",
    contentGenre: normalizeContentGenre(input.contentGenre || DEFAULT_CONTENT_GENRE),
    secondaryGenres: normalizeSecondaryGenres(input.secondaryGenres, input.contentGenre),
    storySetting: normalizeStorySetting(input.storySetting || DEFAULT_STORY_SETTING),
    settingNotes: input.settingNotes?.trim() || "",
    visualStyle: input.visualStyle || DEFAULT_VISUAL_STYLE,
    imageStyle: input.imageStyle || DEFAULT_IMAGE_STYLE,
    scriptProvider: "OpenAI Responses API",
    scriptModel: process.env.HTMLVIDEO_SCRIPT_LLM_MODEL || "gpt-6-luna",
    status: "draft",
    totalScenes: timing.totalScenes,
    completedScenes: 0,
    totalChunks: Math.ceil(timing.totalScenes / chunkSize),
    completedChunks: 0,
    reviewCount: 0,
    aiReviewCount: 0,
    videoQueue: { status: "idle", concurrency: DEFAULT_RUN_CONCURRENCY, jobs: [], updatedAt: now() },
    render: { status: "idle", updatedAt: now() },
    chunks: createChunks(timing.totalScenes, chunkSize),
    characters: [],
    locations: [],
    createdAt: now(),
    updatedAt: now(),
  };
}

export function updateProjectRecord(project: StoryProject, patch: UpdateProjectInput): StoryProject {
  const shouldForceDramaVideoSource = project.presetId === "ai-drama" && patch.mediaSource !== undefined;
  const next = {
    ...project,
    ...patch,
    presetId: project.presetId,
    ...(shouldForceDramaVideoSource ? { mediaSource: "maivideo-video" as const } : {}),
    ...(patch.mediaGeneration ? {
      mediaGeneration: resolveMediaGenerationSettings({ ...project.mediaGeneration, ...patch.mediaGeneration }),
    } : {}),
  };
  const durationChanged = patch.durationMinutes !== undefined && patch.durationMinutes !== project.durationMinutes;
  const chunkSizeChanged = patch.chunkSize !== undefined && patch.chunkSize !== project.chunkSize;
  const sourceUrlChanged = patch.sourceUrl !== undefined && patch.sourceUrl.trim() !== project.sourceUrl.trim();
  if (sourceUrlChanged && (patch.sourceText === undefined || patch.sourceText.trim() === project.sourceText.trim())) next.sourceText = "";
  const sourceChanged = (patch.sourceText !== undefined && patch.sourceText.trim() !== project.sourceText.trim()) || sourceUrlChanged;
  if (sourceChanged) {
    const versions = [...(project.scriptStudio?.versions || [])];
    if ((project.scriptMode || "ai") === "manual" && project.sourceText.trim() && !versions.some((version) => version.sourceText === project.sourceText)) {
      versions.push({
        id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: `Bản trước chỉnh sửa · ${new Date().toLocaleString("vi-VN")}`,
        sourceText: project.sourceText,
        scriptFormat: project.scriptFormat || "plain_text",
        durationMode: project.durationMode || "auto",
        durationMinutes: project.durationMinutes,
        createdAt: now(),
      });
    }
    next.scriptStudio = {
      ...project.scriptStudio,
      analysis: undefined,
      draftText: undefined,
      draftBaseHash: undefined,
      draftUpdatedAt: undefined,
      versions,
    };
  }
  const presetChanged = next.presetId !== project.presetId;
  const nonPresetFormatChanged = ["language", "contentGenre", "storySetting", "settingNotes", "visualStyle", "imageStyle", "aspectRatio"].some((key) => {
    const field = key as keyof UpdateProjectInput;
    return next[field] !== project[field];
  });
  const secondaryGenresChanged = JSON.stringify(next.secondaryGenres || []) !== JSON.stringify(project.secondaryGenres || []);
  const mediaSourceChanged = next.mediaSource !== project.mediaSource;
  const formatChanged = presetChanged || nonPresetFormatChanged || mediaSourceChanged || secondaryGenresChanged;
  const scriptConfigChanged = ["scriptMode", "scriptFormat", "durationMode"].some((key) => {
    const field = key as keyof UpdateProjectInput;
    return patch[field] !== undefined && patch[field] !== project[field];
  });
  if (durationChanged || chunkSizeChanged || sourceChanged || scriptConfigChanged || formatChanged) {
    const timing = resolveProjectTiming({
      scriptMode: next.scriptMode,
      scriptFormat: next.scriptFormat,
      durationMode: next.durationMode,
      durationMinutes: next.durationMinutes,
      sourceText: next.sourceText,
    });
    next.durationMode = timing.durationMode;
    next.durationMinutes = timing.durationMinutes;
    next.durationSeconds = timing.durationSeconds;
    const totalScenes = timing.totalScenes;
    const chunkSize = normalizeProjectChunkSize(next.chunkSize);
    next.totalScenes = totalScenes;
    next.chunkSize = chunkSize;
    next.totalChunks = Math.ceil(totalScenes / chunkSize);
    next.completedScenes = 0;
    next.completedChunks = 0;
    next.reviewCount = 0;
    next.aiReviewCount = 0;
    next.continuityQa = undefined;
    next.videoQueue = { status: "idle", concurrency: DEFAULT_RUN_CONCURRENCY, jobs: [], updatedAt: now() };
    next.render = { status: "idle", updatedAt: now() };
    next.chunks = createChunks(totalScenes, chunkSize);
    next.status = "draft";
  }
  if (sourceChanged || formatChanged) next.continuityContext = undefined;
  next.sourceStatus = next.sourceText?.trim() ? "ready" : "missing";
  next.updatedAt = now();
  return next;
}

export async function saveChunkOutput(slug: string, chunkId: string, payload: unknown) {
  const outputDir = path.join(OUTPUT_DIR, slug);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${chunkId}.json`);
  await writeFile(outputPath, JSON.stringify(payload, null, 2));
  return path.relative(process.cwd(), outputPath);
}

export async function readChunkOutput(chunk: ProjectChunk): Promise<unknown | undefined> {
  if (!chunk.outputPath) return undefined;
  const outputRoot = path.resolve(OUTPUT_DIR);
  const outputPath = path.resolve(process.cwd(), chunk.outputPath);
  if (outputPath !== outputRoot && !outputPath.startsWith(`${outputRoot}${path.sep}`)) return undefined;
  try {
    return JSON.parse(await readFile(outputPath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Find the most recent completed chunk immediately before the target and
 * recover its hand-off. This also lets projects created before continuity was
 * added resume from the context embedded in their saved chunk output.
 */
export async function getPreviousContinuityContext(project: StoryProject, targetChunk: ProjectChunk) {
  const previousChunk = project.chunks
    .filter((item) => item.status === "completed" && item.sceneEnd < targetChunk.sceneStart)
    .sort((left, right) => right.sceneEnd - left.sceneEnd)[0];
  if (!previousChunk) return undefined;

  if (project.continuityContext?.chunkId === previousChunk.id) return project.continuityContext;

  const payload = await readChunkOutput(previousChunk);
  return payload === undefined ? undefined : continuityContextFromOutput({
    payload,
    chunkId: previousChunk.id,
    sceneEnd: previousChunk.sceneEnd,
  });
}

export function getProjectOrThrow(data: StoryAIData, slug: string) {
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  return project;
}

import { z } from "zod";
import { normalizeAiDramaSceneDuration, type AiDramaSceneDurationSec } from "./ai-drama-scene-timing";
import type { CodingAgentPreference } from "./coding-agent-preferences";
import { MAX_PROJECT_CHUNK_SIZE } from "./project-types";

export const remakeOptionsSchema = z.object({
  language: z.enum(["vi", "en"]),
  direction: z.string().trim().max(2000).default(""),
  transcript: z.string().trim().max(8000).default(""),
  remakeMode: z.enum(["faithful", "creative"]).default("faithful"),
  dialoguePolicy: z.enum(["auto", "silent_sfx", "spoken"]).default("auto"),
  visualStyle: z.string().trim().max(80).default(""),
  imageStyle: z.string().trim().max(80).default(""),
  contentGenre: z.string().trim().max(80).default(""),
  storySetting: z.string().trim().max(80).default(""),
});

export const remakeInputSchema = remakeOptionsSchema.extend({
  url: z.string().trim().max(2500).url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && !url.username && !url.password;
  }),
});

const required = (max: number) => z.string().trim().min(1).max(max);
export const remakeEntitySchema = z.object({ name: required(80), description: required(1000), imagePrompt: required(2400) });
const line = z.object({
  speaker: required(100), text: required(300), start: z.number().min(0), end: z.number().positive(),
});

export const remakePlanSchema = z.object({
  sourceSummary: required(5000),
  title: required(160),
  logline: required(600),
  synopsis: required(3000),
  openingHook: required(700),
  turningPoint: required(700),
  ending: required(700),
  continuity: required(1500),
  dialoguePolicy: z.enum(["silent_sfx", "spoken"]).optional(),
  visualStyle: z.string().trim().max(80).optional(),
  imageStyle: z.string().trim().max(80).optional(),
  contentGenre: z.string().trim().max(80).optional(),
  storySetting: z.string().trim().max(80).optional(),
  characters: z.array(remakeEntitySchema).min(1).max(20),
  locations: z.array(remakeEntitySchema).min(1).max(30),
});

export const remakePlanGenerationSchema = remakePlanSchema.extend({
  dialoguePolicy: z.enum(["silent_sfx", "spoken"]),
  visualStyle: required(80),
  imageStyle: required(80),
  contentGenre: required(80),
  storySetting: required(80),
});

export const remakeSceneSchema = z.object({
  sourceVisuals: required(1000),
  sourceStory: required(1000),
  sourceRole: required(500),
  purpose: required(500),
  action: required(1200),
  characters: z.array(required(100)).max(5),
  location: required(100),
  dialogueMode: z.enum(["dialogue_led", "visual_led"]).optional(),
  actingBeat: z.string().trim().max(500).optional(),
  blocking: z.string().trim().max(500).optional(),
  shotSize: z.string().trim().max(160).optional(),
  cameraMovement: z.string().trim().max(400).optional(),
  eyelineAction: z.string().trim().max(300).optional(),
  sfx: z.string().trim().max(500).optional(),
  vfx: z.string().trim().max(400).optional(),
  continuityIn: required(700),
  continuityOut: required(700),
  imagePrompt: required(2400),
  videoPrompt: required(3400),
  dialogue: z.array(line).max(8),
});

export const remakeSceneGenerationSchema = remakeSceneSchema.extend({
  dialogueMode: z.enum(["dialogue_led", "visual_led"]),
  actingBeat: required(500),
  blocking: required(500),
  shotSize: required(160),
  cameraMovement: required(400),
  eyelineAction: required(300),
  sfx: required(500),
  vfx: required(400),
});

export const remakeDraftSchema = remakePlanSchema.extend({
  scenes: z.array(remakeSceneSchema).min(1),
});

export const remakeTimedSceneSchema = remakeSceneGenerationSchema.extend({
  sourceWindows: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export type RemakeInput = z.infer<typeof remakeInputSchema>;
export type RemakeOptions = Omit<RemakeInput, "url">;
export type RemakeLocalSource = { uploadId: string; filename: string; extension: string };
export type RemakeDraft = z.infer<typeof remakeDraftSchema>;
export type RemakeWindow = ReturnType<typeof makeRemakeWindows>[number];
export type RemakeAudioCue = {
  scene: number;
  rmsDb: number | null;
  peaksAt: number[];
  pauses: Array<[number, number]>;
};
export type RemakeStage = "queued" | "reading" | "analyzing" | "ready" | "failed";
export type RemakeTranscript = "manual" | "captions" | "transcribed" | "unavailable" | "silent";
export type RemakeJob = {
  id: string;
  input: RemakeInput;
  /** Short-lived direct file URL used only when a platform downloader needs a fallback. */
  sourceDownloadUrl?: string;
  localSource?: RemakeLocalSource;
  agent: CodingAgentPreference;
  status: RemakeStage;
  createdAt: string;
  updatedAt: string;
  error?: string;
  progress?: { completed: number; total: number };
  result?: {
    draft: RemakeDraft;
    windows: RemakeWindow[];
    transcript: RemakeTranscript;
    aspectRatio: string;
  };
  projectSlug?: string;
};

export type RemakeJobSummary = Pick<RemakeJob, "id" | "status" | "createdAt" | "updatedAt" | "error" | "progress" | "projectSlug"> & {
  url: string;
  sourceName?: string;
  title?: string;
  sceneCount?: number;
};

export function makeRemakeWindows(seconds: number, step: AiDramaSceneDurationSec) {
  // Container timebases can leave a fraction of a second past a scene boundary.
  const boundaryTolerance = 0.1;
  const count = Math.max(1, Math.ceil((seconds - boundaryTolerance) / step));
  let outputStart = 0;
  return Array.from({ length: count }, (_, index) => {
    const sourceStart = index * step;
    const sourceEnd = index + 1 === count ? seconds : sourceStart + step;
    const duration = normalizeAiDramaSceneDuration(Math.max(0.001, sourceEnd - sourceStart - boundaryTolerance));
    const window = { sourceStart, sourceEnd, start: outputStart, end: outputStart + duration, duration };
    outputStart = window.end;
    return window;
  });
}

export function mergeRemakeWindows(windows: RemakeWindow[], groups: number[]) {
  let offset = 0;
  const merged = groups.map((size) => {
    const first = windows[offset];
    const last = windows[offset + size - 1];
    if (!first || !last) throw new Error("Nhịp cảnh do Code Agent đề xuất vượt quá phần video đã phân tích.");
    offset += size;
    return {
      sourceStart: first.sourceStart, sourceEnd: last.sourceEnd,
      start: first.start, end: last.end, duration: normalizeAiDramaSceneDuration(last.end - first.start),
    };
  });
  if (offset !== windows.length) throw new Error("Nhịp cảnh do Code Agent đề xuất chưa bao phủ đầy đủ video nguồn.");
  return merged;
}

export type RemakeEpisodePlan = {
  index: number;
  sceneStart: number;
  sceneEnd: number;
  sourceStart: number;
  sourceEnd: number;
  duration: number;
};

/** Split the remake into source-time episodes and keep every project chunk within its scene cap. */
export function planRemakeEpisodes(windows: RemakeWindow[]): RemakeEpisodePlan[] {
  if (!windows.length) return [];
  const sourceDuration = windows.at(-1)?.sourceEnd || 0;
  const segmentDuration = Math.max(300, Math.ceil(sourceDuration / (12 * 60)) * 60);
  const episodes: Array<RemakeEpisodePlan & { segment: number }> = [];

  windows.forEach((window, index) => {
    const segment = Math.floor(window.sourceStart / segmentDuration);
    let episode = episodes.at(-1);
    if (!episode || episode.segment !== segment || episode.sceneEnd - episode.sceneStart + 1 >= MAX_PROJECT_CHUNK_SIZE) {
      episode = {
        index: episodes.length, segment, sceneStart: index + 1, sceneEnd: index + 1,
        sourceStart: window.sourceStart, sourceEnd: window.sourceEnd, duration: window.end - window.start,
      };
      episodes.push(episode);
      return;
    }
    episode.sceneEnd = index + 1;
    episode.sourceEnd = window.sourceEnd;
    episode.duration = window.end - windows[episode.sceneStart - 1].start;
  });

  return episodes.map(({ index, sceneStart, sceneEnd, sourceStart, sourceEnd, duration }) => ({
    index, sceneStart, sceneEnd, sourceStart, sourceEnd, duration,
  }));
}

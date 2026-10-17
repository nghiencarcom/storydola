import type { ContinuityContext } from "./project-types";

type JsonRecord = Record<string, unknown>;

const MAX_PROMPT_CONTEXT_CHARS = 14000;
const MAX_SUMMARY_CHARS = 4000;

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asFiniteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 24)).trimEnd()}… [đã rút gọn]`;
}

function scenesFromResult(result: unknown): JsonRecord[] {
  const record = asRecord(result);
  if (!record || !Array.isArray(record.scenes)) return [];
  return record.scenes.map(asRecord).filter((scene): scene is JsonRecord => Boolean(scene));
}

function storedContextFromResult(result: unknown): ContinuityContext | undefined {
  const record = asRecord(result);
  const stored = asRecord(record?.continuity_context ?? record?.continuityContext);
  if (!stored) return undefined;

  const state = asRecord(stored.state);
  const chunkId = asString(stored.chunkId ?? stored.chunk_id);
  const sceneEnd = asFiniteNumber(stored.sceneEnd ?? stored.scene_end);
  const chunkSummary = asString(stored.chunkSummary ?? stored.chunk_summary);
  if (!state || !chunkId || sceneEnd === undefined) return undefined;

  return { schema: "story-continuity.v1", chunkId, sceneEnd, chunkSummary, state };
}

function modelStateFromResult(result: unknown): JsonRecord | undefined {
  const record = asRecord(result);
  if (!record) return undefined;
  return asRecord(record.continuity_state ?? record.continuityState ?? record.continuity);
}

function modelSummaryFromResult(result: unknown): string {
  const record = asRecord(result);
  if (!record) return "";
  return truncate(asString(record.chunk_summary ?? record.chunkSummary ?? record.summary), MAX_SUMMARY_CHARS);
}

function deriveStateFromScenes(scenes: JsonRecord[]): JsonRecord {
  const lastScene = scenes.at(-1);
  if (!lastScene) return {};

  const derived: JsonRecord = {};
  const lastSceneId = asString(lastScene.id ?? lastScene.scene_id ?? lastScene.sceneId);
  if (lastSceneId) derived.last_scene_id = lastSceneId;

  const continuityOut = lastScene.continuity_out ?? lastScene.continuityOut;
  if (continuityOut !== undefined) derived.last_scene_continuity_out = continuityOut;

  for (const [sourceKey, targetKey] of [
    ["location", "last_location"],
    ["setting", "last_setting"],
    ["time", "last_time"],
    ["characters", "last_characters"],
    ["props", "last_props"],
    ["emotional_state", "last_emotional_state"],
  ] as const) {
    if (lastScene[sourceKey] !== undefined) derived[targetKey] = lastScene[sourceKey];
  }

  return derived;
}

function deriveSummaryFromScenes(scenes: JsonRecord[]): string {
  const recentScenes = scenes.slice(-8);
  return truncate(recentScenes.map((scene) => {
    const id = asString(scene.id ?? scene.scene_id ?? scene.sceneId) || "scene";
    const beat = asString(scene.beat_summary ?? scene.beatSummary ?? scene.purpose);
    const voiceover = asString(scene.dialogue_or_voiceover ?? scene.dialogueOrVoiceover);
    const detail = beat || voiceover;
    return detail ? `${id}: ${detail}` : id;
  }).join("\n"), MAX_SUMMARY_CHARS);
}

/**
 * Build a compact, durable hand-off after a chunk has been generated.
 * The model is asked for a complete continuity_state, but the scene-derived
 * fallback keeps the chain useful when a provider omits that optional block.
 */
export function buildContinuityContext({
  chunkId,
  sceneEnd,
  result,
  previousContext,
}: {
  chunkId: string;
  sceneEnd: number;
  result: unknown;
  previousContext?: ContinuityContext;
}): ContinuityContext {
  const scenes = scenesFromResult(result);
  const modelState = modelStateFromResult(result) || {};
  const derivedState = deriveStateFromScenes(scenes);
  const state = { ...(previousContext?.state || {}), ...modelState, ...derivedState };
  const summary = modelSummaryFromResult(result) || deriveSummaryFromScenes(scenes) || previousContext?.chunkSummary || "";

  return {
    schema: "story-continuity.v1",
    chunkId,
    sceneEnd,
    chunkSummary: summary,
    state,
  };
}

/** Recover context from an existing output when resuming an older project. */
export function continuityContextFromOutput({
  payload,
  chunkId,
  sceneEnd,
  previousContext,
}: {
  payload: unknown;
  chunkId: string;
  sceneEnd: number;
  previousContext?: ContinuityContext;
}): ContinuityContext | undefined {
  const stored = storedContextFromResult(payload);
  if (stored) return { ...stored, chunkId, sceneEnd };

  const scenes = scenesFromResult(payload);
  const summary = modelSummaryFromResult(payload);
  if (!scenes.length && !summary && !previousContext) return undefined;
  return buildContinuityContext({ chunkId, sceneEnd, result: payload, previousContext });
}

/** Attach the durable hand-off to the saved chunk artifact for future resumes. */
export function withContinuityContext(result: unknown, context: ContinuityContext): unknown {
  const record = asRecord(result);
  if (!record) return { result, continuity_context: context };
  return { ...record, continuity_context: context };
}

export function serializeContinuityContext(context: ContinuityContext): string {
  const serialized = JSON.stringify(context, null, 2);
  return truncate(serialized, MAX_PROMPT_CONTEXT_CHARS);
}

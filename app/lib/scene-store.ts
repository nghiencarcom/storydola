import { createHash } from "node:crypto";
import type { ProjectChunk, SceneContinuityReference, StoryProject } from "./project-types";
import { readChunkOutput } from "./server-store";

export type StoredScene = Record<string, unknown> & {
  id: string;
  chunkId: string;
  sceneIndex: number;
  chunkOutputPath?: string;
};

export function sceneMediaPreviewUrl(slug: string, sceneId: string, localPath: string, kind?: "reference") {
  const query = new URLSearchParams({ v: createHash("sha256").update(localPath).digest("hex").slice(0, 16) });
  if (kind) query.set("kind", kind);
  return `/api/projects/${encodeURIComponent(slug)}/scenes/${encodeURIComponent(sceneId)}/media?${query.toString()}`;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sceneId(scene: Record<string, unknown>, fallback: string) {
  const explicit = String(scene.id || scene.scene_id || "").trim();
  return explicit || fallback;
}

export async function readProjectScenes(project: StoryProject): Promise<StoredScene[]> {
  const output: StoredScene[] = [];
  for (const chunk of project.chunks) {
    if (!chunk.outputPath) continue;
    const payload = recordValue(await readChunkOutput(chunk));
    const rawScenes = payload && Array.isArray(payload.scenes) ? payload.scenes : [];
    rawScenes.forEach((value, index) => {
      const scene = recordValue(value);
      if (!scene) return;
      const fallback = `S${String(chunk.sceneStart + index).padStart(3, "0")}`;
      output.push({
        ...scene,
        id: sceneId(scene, fallback),
        chunkId: chunk.id,
        sceneIndex: index,
        chunkOutputPath: chunk.outputPath,
      });
    });
  }
  return output.sort((left, right) => {
    const leftNumber = Number(String(left.id).replace(/\D/g, "")) || 0;
    const rightNumber = Number(String(right.id).replace(/\D/g, "")) || 0;
    return leftNumber - rightNumber || left.chunkId.localeCompare(right.chunkId);
  });
}

export async function findProjectScene(project: StoryProject, id: string) {
  const normalizedId = decodeURIComponent(String(id || "")).trim();
  const scenes = await readProjectScenes(project);
  return { scenes, scene: scenes.find((item) => item.id === normalizedId) };
}

export function sceneMediaLocalPath(scene: StoredScene) {
  const media = recordValue(scene.media);
  const localPath = media && typeof media.localPath === "string" ? media.localPath.trim() : "";
  return localPath;
}

export function sceneReferenceImage(scene: StoredScene) {
  const savedReference = recordValue(scene.videoReferenceImage || scene.video_reference_image);
  const media = recordValue(scene.media);
  const candidates = [savedReference, media].filter((candidate) => candidate?.kind === "image" && candidate.status === "ready");
  return candidates.find((candidate) => candidate?.stale !== true) || candidates[0];
}

export function previousSceneInSameLocation(scenes: StoredScene[], scene: StoredScene) {
  const index = scenes.findIndex((item) => item.id === scene.id);
  if (index <= 0) return undefined;
  const previous = scenes[index - 1];
  const locationId = (item: StoredScene) => String(item.location_id ?? item.locationId ?? item.environment_id ?? item.environmentId ?? "").trim();
  const currentLocationId = locationId(scene);
  if (!currentLocationId || locationId(previous) !== currentLocationId) return undefined;
  const sceneNumber = (item: StoredScene) => Number(item.sceneNumber) || Number(item.id.replace(/\D/g, "")) || 0;
  const previousNumber = sceneNumber(previous);
  const currentNumber = sceneNumber(scene);
  if (previousNumber && currentNumber && currentNumber - previousNumber !== 1) return undefined;
  return previous;
}

export function previousSceneContinuityReference(scenes: StoredScene[], scene: StoredScene): SceneContinuityReference | undefined {
  const previous = previousSceneInSameLocation(scenes, scene);
  if (!previous) return undefined;
  const image = sceneReferenceImage(previous);
  if (!image || image.kind !== "image" || image.status !== "ready" || image.stale === true || typeof image.localPath !== "string" || !image.localPath.trim()) return undefined;
  const provider = typeof image.provider === "string" ? image.provider.toLowerCase() : "";
  const referenceLocationId = typeof image.referenceLocationId === "string" ? image.referenceLocationId : "";
  if (provider.startsWith("pexels") || (referenceLocationId && referenceLocationId !== String(previous.location_id ?? previous.locationId ?? previous.environment_id ?? previous.environmentId ?? ""))) return undefined;
  return { sceneId: previous.id, image: image as unknown as SceneContinuityReference["image"], persisted: true };
}

export function sceneReferenceImageLocalPath(scene: StoredScene) {
  const reference = sceneReferenceImage(scene);
  if (typeof reference?.localPath === "string" && reference.localPath.trim()) return reference.localPath.trim();
  const media = recordValue(scene.media);
  return media?.kind === "image" && media.status === "ready" && typeof media.localPath === "string" ? media.localPath.trim() : "";
}

export function chunkForScene(project: StoryProject, scene: StoredScene): ProjectChunk | undefined {
  return project.chunks.find((chunk) => chunk.id === scene.chunkId);
}

import { access } from "node:fs/promises";
import path from "node:path";
import type { MediaGenerationSettings, SceneMediaAsset, StoryProject } from "./project-types";
import { resolveMediaGenerationSettings } from "./media-generation-settings";
import { generateMaiVideoImageForScene } from "./media-provider";
import { previousSceneContinuityReference, readProjectScenes, sceneReferenceImage, type StoredScene } from "./scene-store";
import { saveGeneratedSceneReferenceImage } from "./scene-media-output";

type SceneRecord = StoredScene;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function assignedCharacterIds(scene: SceneRecord) {
  const value = scene.character_ids ?? scene.characterIds;
  return Array.isArray(value) ? [...new Set(value.map((item) => String(item)))] : [];
}

function assignedLocationId(scene: SceneRecord) {
  const value = scene.location_id ?? scene.locationId ?? scene.environment_id ?? scene.environmentId;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function referenceIsCurrent(reference: Record<string, unknown> | undefined, characterIds: string[], locationId: string) {
  if (!reference?.localPath || reference.stale === true || !String(reference.provider || "").startsWith("maivideo-image")) return false;
  const savedCharacterIds = Array.isArray(reference.referenceCharacterIds) ? reference.referenceCharacterIds.map((id) => String(id)) : [];
  const savedLocationId = typeof reference.referenceLocationId === "string" ? reference.referenceLocationId : "";
  return savedCharacterIds.length === characterIds.length
    && savedCharacterIds.every((id, index) => id === characterIds[index])
    && savedLocationId === locationId;
}

async function referenceFileIsAvailable(projectSlug: string, reference: Record<string, unknown>) {
  const localPath = typeof reference.localPath === "string" ? reference.localPath.trim() : "";
  if (!localPath) return false;
  const safeSlug = projectSlug.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "project";
  const root = path.resolve(process.cwd(), "data", "media", safeSlug);
  const imagePath = path.resolve(process.cwd(), localPath);
  if (!imagePath.startsWith(`${root}${path.sep}`)) return false;
  try {
    await access(imagePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureSceneReferenceFrame({
  projectSlug,
  project,
  scene,
  mediaGeneration,
}: {
  projectSlug: string;
  project: StoryProject;
  scene: SceneRecord;
  mediaGeneration: MediaGenerationSettings;
}) {
  const settings = resolveMediaGenerationSettings(mediaGeneration);
  const continuityReference = previousSceneContinuityReference(await readProjectScenes(project), scene);
  const ids = settings.imageUseCharacterReferences ? assignedCharacterIds(scene) : [];
  const locationId = assignedLocationId(scene);
  const savedReference = asRecord(scene.videoReferenceImage || scene.video_reference_image);
  const currentImageMedia = asRecord(scene.media);
  const existing = sceneReferenceImage(scene);
  const reference = savedReference || existing || (currentImageMedia?.kind === "image" ? currentImageMedia : undefined);
  if (reference?.kind === "image" && reference.status === "ready" && referenceIsCurrent(reference, ids, locationId) && await referenceFileIsAvailable(projectSlug, reference)) {
    const media = reference as unknown as SceneMediaAsset;
    if (!savedReference) {
      const saved = await saveGeneratedSceneReferenceImage({ projectSlug, sceneId: scene.id, media, mediaGeneration: settings });
      return { scene: { ...scene, ...(saved.scene as Record<string, unknown>), videoReferenceImage: media }, media, continuityReference, created: false };
    }
    return { scene: { ...scene, videoReferenceImage: media }, media, continuityReference, created: false };
  }

  const media = await generateMaiVideoImageForScene({
    projectSlug,
    chunkId: scene.chunkId,
    scene,
    characters: project.characters || [],
    locations: project.locations || [],
    sceneIndex: scene.sceneIndex,
    aspectRatio: project.aspectRatio,
    mediaGeneration: settings,
    presetId: project.presetId,
    contentGenre: project.contentGenre,
    secondaryGenres: project.secondaryGenres,
    storySetting: project.storySetting,
    settingNotes: project.settingNotes,
    visualStyle: project.visualStyle,
    imageStyle: project.imageStyle,
    continuityReference,
  });
  const saved = await saveGeneratedSceneReferenceImage({ projectSlug, sceneId: scene.id, media, mediaGeneration: settings });
  return {
    scene: { ...scene, ...(saved.scene as Record<string, unknown>), videoReferenceImage: media },
    media,
    continuityReference,
    created: true,
  };
}

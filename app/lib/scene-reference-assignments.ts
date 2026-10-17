export type SceneReferenceKind = "image" | "video";

type SceneReferenceRecord = Record<string, unknown>;

// Older scene outputs have one shared cast/location assignment. Treat that as
// the initial selection until a user saves independent image/video references.

function uniqueIds(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))] : undefined;
}

function sceneCharacterIds(scene: SceneReferenceRecord) {
  return uniqueIds(scene.character_ids ?? scene.characterIds) || [];
}

function sceneLocationId(scene: SceneReferenceRecord) {
  const value = scene.location_id ?? scene.locationId ?? scene.environment_id ?? scene.environmentId;
  return typeof value === "string" ? value.trim() : "";
}

export function sceneReferenceCharacterIds(scene: SceneReferenceRecord, kind: SceneReferenceKind) {
  const prefix = kind === "image" ? "image" : "video";
  const explicit = uniqueIds(scene[`${prefix}_reference_character_ids`] ?? scene[`${prefix}ReferenceCharacterIds`]);
  return explicit ?? sceneCharacterIds(scene);
}

export function sceneReferenceLocationId(scene: SceneReferenceRecord, kind: SceneReferenceKind) {
  const prefix = kind === "image" ? "image" : "video";
  const snakeKey = `${prefix}_reference_location_id`;
  const camelKey = `${prefix}ReferenceLocationId`;
  if (Object.prototype.hasOwnProperty.call(scene, snakeKey) && typeof scene[snakeKey] === "string") {
    return (scene[snakeKey] as string).trim();
  }
  if (Object.prototype.hasOwnProperty.call(scene, camelKey) && typeof scene[camelKey] === "string") {
    return (scene[camelKey] as string).trim();
  }
  return sceneLocationId(scene);
}

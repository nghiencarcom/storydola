import { createHash } from "node:crypto";
import { isTemplateEntityName, normalizeEntityName } from "./entity-name";
import { locationReferencePrompt } from "./ai-drama-reference-prompts";
import type { ProjectLocation } from "./project-types";

type RecordValue = Record<string, unknown>;
const record = (v: unknown): RecordValue => v && typeof v === "object" && !Array.isArray(v) ? v as RecordValue : {};
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";

/** Append only locations actually used in this episode; never replace existing canon/images. */
export function reconcileEpisodeLocations(existing: ProjectLocation[], payload: RecordValue, timestamp: string) {
  const locations = [...existing];
  const scenes = Array.isArray(payload.scenes) ? payload.scenes.map(v => ({ ...record(v) })) : [];
  const definitions = Array.isArray(payload.location_bible) ? payload.location_bible.map(record) : [];
  const addedIds: string[] = [];
  const usedIds = new Set<string>();
  const warnings: string[] = [];
  const matches = (location: ProjectLocation, name: string) => [location.name, ...(location.aliases || [])].some(v => normalizeEntityName(v) === normalizeEntityName(name));
  for (const scene of scenes) {
    const name = text(scene.location_name ?? scene.locationName ?? scene.location);
    const priorId = text(scene.location_id ?? scene.locationId);
    let location = name && !isTemplateEntityName(name) ? locations.find(v => matches(v, name)) : locations.find(v => v.id === priorId);
    if (!location && name && !isTemplateEntityName(name)) {
      const definition = definitions.find(v => normalizeEntityName(v.name ?? v.canonical_name) === normalizeEntityName(name));
      const description = text(definition?.description) || text(scene.location_description ?? scene.locationDescription);
      const base = text(definition?.image_prompt ?? definition?.imagePrompt) || description;
      if (!base) throw new Error(`Bối cảnh mới ${name}: cần description/image_prompt trong location_bible hoặc location_description của cảnh; không tự bịa thiết kế.`);
      location = {
        id: `loc-${createHash("sha256").update(normalizeEntityName(name)).digest("hex").slice(0, 14)}`,
        name, description: description || base,
        imagePrompt: locationReferencePrompt(name, base),
        referenceImagePath: "", referenceImageName: "", referenceImageMimeType: "",
        createdAt: timestamp, updatedAt: timestamp,
      };
      locations.push(location);
      addedIds.push(location.id);
    }
    if (!location) {
      warnings.push(`${String(scene.id || "")}: chưa xác định bối cảnh; không gán mặc định bối cảnh đầu tiên.`);
      continue;
    }
    usedIds.add(location.id);
    scene.location_name = location.name;
    scene.location_id = location.id;
    scene.locationId = location.id;
    // Episode canon is authoritative at import; do not retain an old room's references.
    scene.image_reference_location_id = location.id;
    scene.video_reference_location_id = location.id;
    delete scene.imageReferenceLocationId;
    delete scene.videoReferenceLocationId;
  }
  return { locations, scenes, addedIds, usedIds: [...usedIds], warnings };
}

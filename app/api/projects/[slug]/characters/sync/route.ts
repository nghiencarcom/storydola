import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { characterReferencePrompt, locationReferencePrompt } from "../../../../../lib/ai-drama-reference-prompts";
import { normalizeEntityName } from "../../../../../lib/entity-name";
import type { ProjectCharacter, ProjectLocation } from "../../../../../lib/project-types";
import { sanitizeDramaVisualPrompt } from "../../../../../lib/visual-prompt-safety";
import { makeActivity, markRenderStale, now, readChunkOutput, readData, saveChunkOutput, updateData } from "../../../../../lib/server-store";

export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function valueText(record: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function listOfRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is JsonRecord => Boolean(item)) : [];
}

function cleanLocationName(value: string) {
  return value
    .replace(/\s+(?:as|while|where|when|during|before|after|at the moment)\b[\s\S]*$/i, "")
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/[’']s(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/, "");
}

function locationMention(scene: JsonRecord) {
  const explicit = valueText(scene, "location_name", "locationName", "location", "environment_name", "environmentName");
  if (explicit) return explicit;
  const prompt = valueText(scene, "image_prompt", "imagePrompt");
  const match = prompt.match(/^\s*(?:one|a|an)\s+(?:[\w-]+\s+){0,3}(?:frame|shot|image)\s+(?:in|at|on|inside|aboard)\s+([^:;!?]+)/i);
  return match ? cleanLocationName(match[1]) : "";
}

function sceneLocationImagePrompt(scene: JsonRecord) {
  const profilePrompt = valueText(scene, "location_image_prompt", "locationImagePrompt");
  if (profilePrompt) return profilePrompt;
  const scenePrompt = valueText(scene, "image_prompt", "imagePrompt");
  if (!scenePrompt) return "";
  return `Use this scene prompt only to identify the stable environment. Preserve its architecture, spatial layout, materials, landmarks and recurring props; omit people, moment-specific action, camera framing and temporary events. Scene visual context: ${scenePrompt.slice(0, 1500)}`;
}

function locationMatchTokens(value: string) {
  return normalizeEntityName(value)
    .replace(/\bs\b/g, "")
    .split(/\s+/)
    .filter((token) => token && !["the", "a", "an"].includes(token));
}

function locationClusterMatch(left: string, right: string) {
  const leftTokens = new Set(locationMatchTokens(left));
  const rightTokens = new Set(locationMatchTokens(right));
  if (!leftTokens.size || !rightTokens.size) return false;
  if (leftTokens.size === rightTokens.size && [...leftTokens].every((token) => rightTokens.has(token))) return true;
  if (leftTokens.size < 2 || rightTokens.size < 2) return false;
  const smaller = leftTokens.size <= rightTokens.size ? leftTokens : rightTokens;
  const larger = smaller === leftTokens ? rightTokens : leftTokens;
  return [...smaller].every((token) => larger.has(token));
}

function findLocationByName(locations: Map<string, ProjectLocation>, name: string) {
  const normalized = normalizeEntityName(name);
  if (!normalized) return undefined;
  return [...new Set(locations.values())].find((location) => [location.name, ...(location.aliases || [])]
    .some((candidate) => normalizeEntityName(candidate) === normalized || locationClusterMatch(candidate, name)));
}

function sceneNames(scene: JsonRecord) {
  const raw = scene.characters || scene.character_names || scene.characterNames;
  const names = Array.isArray(raw) ? raw.map((value) => typeof value === "string" ? value.trim() : valueText(asRecord(value), "name", "character_name", "characterName")) : [];
  const speaker = valueText(scene, "speaker_character", "speakerCharacter", "speaker_name", "speakerName", "speaker");
  const cues = Array.isArray(scene.dialogueSegments) ? scene.dialogueSegments : Array.isArray(scene.dialogue_segments) ? scene.dialogue_segments : [];
  const cueSpeakers = cues.map((value) => valueText(asRecord(value), "speakerName", "speaker_name", "speaker_character", "speakerCharacter", "speaker"));
  return [...new Set([...names, speaker, ...cueSpeakers].filter((name) => name && !["narrator", "voiceover", "none", "n a"].includes(normalizeEntityName(name))))];
}

function stableCharacterId(name: string) {
  return `char-${createHash("sha256").update(normalizeEntityName(name)).digest("hex").slice(0, 14)}`;
}

function stableLocationId(name: string) {
  return `loc-${createHash("sha256").update(`location:${normalizeEntityName(name)}`).digest("hex").slice(0, 14)}`;
}

export async function POST(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const snapshot = await readData();
  const project = snapshot.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  if (project.presetId !== "ai-drama") return NextResponse.json({ message: "Đồng bộ Character Bible chỉ áp dụng cho AI Drama." }, { status: 409 });

  const descriptions = new Map<string, string>();
  const names = new Map<string, string>();
  const characterPrompts = new Map<string, string>();
  const locationPrompts = new Map<string, string>();
  const locationDescriptions = new Map<string, string>();
  const locationNames = new Map<string, string>();
  const locationAliases = new Map<string, Set<string>>();
  const addName = (name: string, description = "") => {
    const clean = name.trim().slice(0, 80);
    const normalized = normalizeEntityName(clean);
    if (!clean || !normalized || ["narrator", "voiceover", "none", "n a"].includes(normalized)) return;
    if (!names.has(normalized)) names.set(normalized, clean);
    if (description.trim() && !descriptions.has(normalized)) descriptions.set(normalized, description.trim().slice(0, 1_200));
  };
  const addNameWithPrompt = (name: string, description = "", imagePrompt = "") => {
    addName(name, description);
    const normalized = normalizeEntityName(name);
    if (imagePrompt.trim() && normalized && !characterPrompts.has(normalized)) {
      characterPrompts.set(normalized, sanitizeDramaVisualPrompt(imagePrompt.trim().slice(0, 2400)));
    }
  };
  const addLocation = (name: string, imagePrompt = "", description = "", aliases: string[] = []) => {
    const clean = name.trim().slice(0, 100);
    const normalized = normalizeEntityName(clean);
    if (!clean || !normalized) return;
    const clusterKey = [...locationNames].find(([, knownName]) =>
      normalizeEntityName(knownName) === normalized || locationClusterMatch(knownName, clean),
    )?.[0] || normalized;
    const knownName = locationNames.get(clusterKey);
    if (!knownName || clean.length > knownName.length) locationNames.set(clusterKey, clean);
    const knownAliases = locationAliases.get(clusterKey) || new Set<string>();
    knownAliases.add(clean);
    for (const alias of aliases) {
      const trimmed = alias.trim().slice(0, 100);
      if (trimmed) knownAliases.add(trimmed);
    }
    locationAliases.set(clusterKey, knownAliases);
    if (description.trim() && !locationDescriptions.has(clusterKey)) locationDescriptions.set(clusterKey, description.trim().slice(0, 500));
    if (imagePrompt.trim() && !locationPrompts.has(clusterKey)) {
      locationPrompts.set(clusterKey, sanitizeDramaVisualPrompt(imagePrompt.trim().slice(0, 2400)));
    }
  };

  const seriesBible = asRecord(project.seriesBible);
  for (const profile of listOfRecords(seriesBible.characters)) {
    addNameWithPrompt(valueText(profile, "name"), valueText(profile, "description"), valueText(profile, "image_prompt", "imagePrompt"));
  }
  for (const profile of listOfRecords(seriesBible.locations)) {
    const aliases = Array.isArray(profile.aliases) ? profile.aliases.filter((item): item is string => typeof item === "string") : [];
    addLocation(valueText(profile, "name"), valueText(profile, "image_prompt", "imagePrompt"), valueText(profile, "description"), aliases);
  }
  for (const profile of project.dramaPlan?.characters || []) addNameWithPrompt(profile.name, profile.description, profile.imagePrompt);
  for (const profile of project.dramaPlan?.locations || []) addLocation(profile.name, profile.imagePrompt, profile.description);

  const chunkPayloads = new Map<string, { payload: JsonRecord; scenes: JsonRecord[] }>();
  for (const chunk of project.chunks) {
    if (!chunk.outputPath) continue;
    const payload = asRecord(await readChunkOutput(chunk));
    const scenes = Array.isArray(payload.scenes) ? payload.scenes.map(asRecord) : [];
    chunkPayloads.set(chunk.id, { payload, scenes });
    const payloadBible = asRecord(payload.series_bible || payload.seriesBible) || {};
    const characterBible = listOfRecords(payload.character_bible || payload.characterBible || payloadBible.characters);
    const locationBible = listOfRecords(payload.location_bible || payload.locationBible || payloadBible.locations);
    for (const profile of characterBible) {
      const age = valueText(profile, "age", "canonical_age", "canonicalAge");
      const description = [age ? `Age: ${age}.` : "", valueText(profile, "description", "appearance", "visual_identity", "visualIdentity")].filter(Boolean).join(" ");
      addNameWithPrompt(valueText(profile, "name", "character_name", "characterName"), description, valueText(profile, "image_prompt", "imagePrompt"));
    }
    for (const profile of locationBible) {
      const aliases = Array.isArray(profile.aliases) ? profile.aliases.filter((item): item is string => typeof item === "string") : [];
      addLocation(valueText(profile, "name", "location_name", "locationName"), valueText(profile, "image_prompt", "imagePrompt"), valueText(profile, "description", "layout", "visual_identity", "visualIdentity"), aliases);
    }
    const continuity = asRecord(payload.continuity_state || payload.continuityState);
    const activeCharacters = Array.isArray(continuity.active_characters) ? continuity.active_characters : Array.isArray(continuity.activeCharacters) ? continuity.activeCharacters : [];
    const activeLocations = Array.isArray(continuity.active_locations) ? continuity.active_locations : Array.isArray(continuity.activeLocations) ? continuity.activeLocations : [];
    for (const value of activeCharacters) {
      const character = asRecord(value);
      addNameWithPrompt(
        valueText(character, "name", "character_name", "characterName"),
        valueText(character, "appearance", "description", "visual_identity", "visualIdentity"),
        valueText(character, "image_prompt", "imagePrompt"),
      );
    }
    for (const value of activeLocations) {
      const location = asRecord(value);
      addLocation(
        typeof value === "string" ? value : valueText(location, "name", "location_name", "locationName"),
        valueText(location, "image_prompt", "imagePrompt"),
        valueText(location, "description", "layout", "visual_identity", "visualIdentity"),
      );
    }
    for (const scene of scenes) for (const name of sceneNames(scene)) addName(name);
    for (const scene of scenes) addLocation(
      locationMention(scene),
      sceneLocationImagePrompt(scene),
      valueText(scene, "location_description", "locationDescription", "environment_description", "environmentDescription", "setting_description", "settingDescription"),
    );
  }

  const existingByName = new Map((project.characters || []).map((character) => [normalizeEntityName(character.name), character]));
  const timestamp = now();
  const mergedCharacters: ProjectCharacter[] = [...(project.characters || [])];
  const created: ProjectCharacter[] = [];
  for (const [normalized, name] of names) {
    const existing = existingByName.get(normalized);
    if (existing) {
      if (!existing.imagePrompt && (characterPrompts.get(normalized) || descriptions.get(normalized))) {
        existing.imagePrompt = characterReferencePrompt(existing.name, characterPrompts.get(normalized) || sanitizeDramaVisualPrompt(`Preserve face, age, hair, body type and costume consistently. ${descriptions.get(normalized)}`));
      }
      continue;
    }
    const character: ProjectCharacter = {
      id: stableCharacterId(name),
      name,
      description: descriptions.get(normalized) || "Chưa có mô tả nhận diện. Thêm ảnh tham chiếu và voice để hoàn thiện hồ sơ.",
      imagePrompt: characterReferencePrompt(name, characterPrompts.get(normalized) || sanitizeDramaVisualPrompt(`Preserve face, age, hair, body type and costume consistently. ${descriptions.get(normalized) || "Cinematic naturalistic portrait, consistent facial identity and costume."}`)),
      referenceImagePath: "",
      referenceImageName: "",
      referenceImageMimeType: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    existingByName.set(normalized, character);
    mergedCharacters.push(character);
    created.push(character);
  }

  const profileByName = existingByName;
  const existingLocations = new Map<string, ProjectLocation>();
  for (const location of project.locations || []) {
    for (const name of [location.name, ...(location.aliases || [])]) {
      const normalized = normalizeEntityName(name);
      if (normalized) existingLocations.set(normalized, location);
    }
  }
  const mergedLocations: ProjectLocation[] = [...(project.locations || [])];
  const createdLocations: ProjectLocation[] = [];
  for (const [clusterKey, name] of locationNames) {
    const aliases = [...(locationAliases.get(clusterKey) || [])].filter((alias) => normalizeEntityName(alias) !== normalizeEntityName(name));
    const existing = [name, ...aliases].map((candidate) => findLocationByName(existingLocations, candidate)).find(Boolean);
    if (existing) {
      if (!existing.imagePrompt && (locationPrompts.get(clusterKey) || locationDescriptions.get(clusterKey))) {
        existing.imagePrompt = locationReferencePrompt(existing.name, locationPrompts.get(clusterKey) || locationDescriptions.get(clusterKey) || "");
      }
      if (!existing.description && locationDescriptions.get(clusterKey)) existing.description = locationDescriptions.get(clusterKey) || "";
      existing.aliases = [...new Set([...(existing.aliases || []), ...aliases].filter((alias) => normalizeEntityName(alias) !== normalizeEntityName(existing.name)))];
      for (const candidate of [existing.name, ...(existing.aliases || []), name, ...aliases]) existingLocations.set(normalizeEntityName(candidate), existing);
      continue;
    }
    const location: ProjectLocation = {
      id: stableLocationId(name), name, aliases, description: locationDescriptions.get(clusterKey) || `Bối cảnh chính: ${name}.`, imagePrompt: locationReferencePrompt(name, locationPrompts.get(clusterKey) || locationDescriptions.get(clusterKey) || `Environment reference for ${name}. Preserve a consistent layout, materials, lighting and recurring props.`),
      referenceImagePath: "", referenceImageName: "", referenceImageMimeType: "", createdAt: timestamp, updatedAt: timestamp,
    };
    for (const candidate of [name, ...aliases]) existingLocations.set(normalizeEntityName(candidate), location);
    mergedLocations.push(location); createdLocations.push(location);
  }
  const updatedOutputPaths = new Map<string, string>();
  for (const chunk of project.chunks) {
    const stored = chunkPayloads.get(chunk.id);
    if (!stored) continue;
    let changed = false;
    const updatedScenes = stored.scenes.map((scene) => {
      let sceneChanged = false;
      const characterIds = sceneNames(scene).map((name) => profileByName.get(normalizeEntityName(name))?.id).filter((id): id is string => Boolean(id));
      const speakerName = valueText(scene, "speaker_character", "speakerCharacter", "speaker_name", "speakerName", "speaker");
      const speakerCharacterId = profileByName.get(normalizeEntityName(speakerName))?.id;
      const next: JsonRecord = { ...scene };
      if (characterIds.length && JSON.stringify(scene.characterIds || []) !== JSON.stringify([...new Set(characterIds)])) {
        next.characterIds = [...new Set(characterIds)];
        changed = true; sceneChanged = true;
      }
      if (speakerCharacterId && scene.speakerCharacterId !== speakerCharacterId) {
        next.speakerCharacterId = speakerCharacterId;
        changed = true; sceneChanged = true;
      }
      const locationName = locationMention(scene);
      const matchedLocation = findLocationByName(existingLocations, locationName);
      const locationId = matchedLocation?.id;
      if (locationId && scene.locationId !== locationId && scene.location_id !== locationId) {
        next.locationId = locationId;
        changed = true; sceneChanged = true;
      }
      if (matchedLocation && !valueText(scene, "location_name", "locationName")) {
        next.location_name = matchedLocation.name;
        changed = true; sceneChanged = true;
      }
      if (sceneChanged) {
        const media = asRecord(next.media);
        if (Object.keys(media).length) next.media = { ...media, stale: true };
        const reference = asRecord(next.videoReferenceImage || next.video_reference_image);
        if (reference.kind === "image") next.videoReferenceImage = { ...reference, stale: true };
        next.review_status = "unreviewed";
        next.review_note = "";
        next.ai_review = {
          status: "pending", score: 0,
          summary: "Hồ sơ tham chiếu đã đồng bộ; cần kiểm tra lại media.",
          issues: ["Media hiện tại được tạo trước khi gán hồ sơ nhân vật hoặc bối cảnh."], checks: {}, createdAt: now(),
        };
      }
      return next;
    });
    if (changed) updatedOutputPaths.set(chunk.id, await saveChunkOutput(slug, chunk.id, { ...stored.payload, scenes: updatedScenes }));
  }

  await updateData((data) => {
    const current = data.projects.find((item) => item.slug === slug);
    if (!current) throw new Error("PROJECT_NOT_FOUND");
    current.characters = mergedCharacters;
    current.locations = mergedLocations;
    for (const [chunkId, outputPath] of updatedOutputPaths) {
      const chunk = current.chunks.find((item) => item.id === chunkId);
      if (chunk) {
        chunk.outputPath = outputPath;
        chunk.render = markRenderStale(chunk.render);
      }
    }
    if (updatedOutputPaths.size) current.render = markRenderStale(current.render);
    current.updatedAt = timestamp;
    data.activities.unshift(makeActivity({
      projectSlug: slug,
      kind: "project",
      title: created.length || createdLocations.length ? "Đã đồng bộ hồ sơ AI Drama từ kịch bản" : "Hồ sơ AI Drama đã khớp với kịch bản",
      detail: `${mergedCharacters.length} nhân vật · ${mergedLocations.length} bối cảnh · có thể gán voice và tạo ảnh tham chiếu.`,
      status: "success",
    }));
  });

  return NextResponse.json({ ok: true, created: created.length, createdLocations: createdLocations.length, characters: mergedCharacters, locations: mergedLocations });
}

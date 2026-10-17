import { NextResponse } from "next/server";
import { readProjectScenes } from "../../../../../lib/scene-store";
import { normalizeEntityName } from "../../../../../lib/entity-name";
import type { ProjectCharacter, ProjectLocation } from "../../../../../lib/project-types";
import { sceneReferenceCharacterIds, sceneReferenceLocationId } from "../../../../../lib/scene-reference-assignments";
import { getProjectOrThrow, makeActivity, markRenderStale, now, readChunkOutput, readData, saveChunkOutput, updateData } from "../../../../../lib/server-store";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function normalizedPhrase(value: unknown) {
  return normalizeEntityName(value);
}

function sceneText(scene: Record<string, unknown>) {
  const fields = ["title", "scene_title", "purpose", "story_purpose", "beat_summary", "action", "visual_intent", "image_prompt", "imagePrompt", "video_prompt", "videoPrompt", "voiceover", "dialogue_or_voiceover", "dialogue", "speaker", "speaker_name", "speakerName", "character_name", "characterName"];
  return fields.map((key) => typeof scene[key] === "string" ? scene[key] as string : "").join(" ");
}

function asNames(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    const record = asRecord(item);
    return record ? [record.name, record.character_name, record.characterName, record.speaker].filter((name): name is string => typeof name === "string") : [];
  });
}

function sceneCharacterIds(scene: Record<string, unknown>) {
  const value = scene.character_ids ?? scene.characterIds;
  return Array.isArray(value) ? value.map(String) : [];
}

function sceneLocationId(scene: Record<string, unknown>) {
  const value = scene.location_id ?? scene.locationId ?? scene.environment_id ?? scene.environmentId;
  return typeof value === "string" ? value : "";
}

function locationTokens(value: string) {
  return normalizedPhrase(value)
    .replace(/\blaboratories\b|\blaboratory\b|\blabs\b/g, "lab")
    .replace(/\bbioacoustics\b/g, "bioacoustic")
    .split(/\s+/)
    .filter((token) => token && !["the", "a", "an", "of", "in", "at", "on", "inside", "aboard", "near", "one", "cinematic", "frame", "shot", "image", "scene", "background", "location", "setting"].includes(token));
}

function hasPhrase(text: string, phrase: string) {
  return Boolean(phrase && ` ${text} `.includes(` ${phrase} `));
}

function inferSceneCharacterIds(scene: Record<string, unknown>, characters: ProjectCharacter[]) {
  const text = normalizedPhrase(sceneText(scene));
  const paddedText = ` ${text} `;
  const explicitNames = asNames(scene.characters).concat(asNames(scene.character_names), asNames(scene.characterNames), asNames(scene.present_characters), asNames(scene.presentCharacters));
  const explicit = new Set(explicitNames.map(normalizedPhrase).filter(Boolean));
  const knownIds = new Set(characters.map((character) => character.id));
  const existing = sceneCharacterIds(scene).filter((id) => knownIds.has(id));
  const matched = characters.filter((character) => {
    const aliases = Array.isArray((character as ProjectCharacter & { aliases?: unknown }).aliases) ? (character as ProjectCharacter & { aliases: unknown[] }).aliases : [];
    const names = [character.name, ...aliases].map(normalizedPhrase).filter(Boolean);
    return existing.includes(character.id) || names.some((name) => explicit.has(name) || (name.length >= 2 && paddedText.includes(` ${name} `)));
  }).map((character) => character.id);
  return [...new Set([...existing, ...matched])];
}

function inferSceneLocationId(scene: Record<string, unknown>, locations: ProjectLocation[]) {
  const knownIds = new Set(locations.map((location) => location.id));
  const existing = sceneLocationId(scene);
  const locationValues = [scene.location_name, scene.locationName, scene.location, scene.scene_location, scene.sceneLocation, scene.setting, scene.environment, scene.background]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const explicitText = normalizedPhrase(locationValues.join(" "));
  const allSceneText = normalizedPhrase(sceneText(scene));
  const sceneTokens = new Set(locationTokens(`${explicitText} ${allSceneText}`));
  const matches = locations.map((location) => {
    const phrases = [location.name, ...(location.aliases || [])].map(normalizedPhrase).filter(Boolean);
    let score = 0;
    for (const phrase of phrases) {
      const phraseTokens = locationTokens(phrase);
      if (!phraseTokens.length) continue;
      if (explicitText === phrase || hasPhrase(explicitText, phrase)) score = Math.max(score, 1200 + phraseTokens.length * 10 + phrase.length);
      else if (hasPhrase(allSceneText, phrase)) score = Math.max(score, 1000 + phraseTokens.length * 10 + phrase.length);

      const overlap = phraseTokens.filter((token) => sceneTokens.has(token)).length;
      const coverage = overlap / phraseTokens.length;
      if (overlap >= 2 && coverage >= 0.65) score = Math.max(score, 600 + coverage * 100 + overlap * 5 + phrase.length / 100);
      else if (phraseTokens.length === 1 && phraseTokens[0].length >= 8 && overlap === 1) score = Math.max(score, 550 + phrase.length / 100);
    }
    return { id: location.id, score };
  }).filter((match) => match.score > 0).sort((left, right) => right.score - left.score);
  return matches[0]?.id || (knownIds.has(existing) ? existing : "");
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = await request.json().catch(() => ({})) as { sceneIds?: unknown; forceImageReferences?: unknown };
  const forceImageReferences = body.forceImageReferences === true;
  const requestedIds = Array.isArray(body.sceneIds) ? [...new Set(body.sceneIds.map((id) => String(id).trim()).filter(Boolean))] : [];
  if (!requestedIds.length) return NextResponse.json({ ok: false, message: "Chọn ít nhất một cảnh để tự gán ảnh tham chiếu." }, { status: 400 });
  const snapshot = await readData();
  if (!snapshot.projects.some((project) => project.slug === slug)) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });

  const result = await updateData(async (data) => {
    const project = getProjectOrThrow(data, slug);
    const characters = project.characters || [];
    const locations = project.locations || [];
    if (!characters.length && !locations.length) return { matchedScenes: 0, changedScenes: 0, addedAssignments: 0, matchedLocations: 0, changedLocations: 0, addedLocationAssignments: 0, unmatchedScenes: requestedIds.length, unmatchedLocationScenes: requestedIds.length };
    const allScenes = await readProjectScenes(project);
    const targets = allScenes.filter((scene) => requestedIds.includes(scene.id));
    const inferredCharacters = new Map(targets.map((scene) => [scene.id, inferSceneCharacterIds(scene, characters)]));
    const inferredLocations = new Map(targets.map((scene) => [scene.id, inferSceneLocationId(scene, locations)]));
    const nextImageCharacterIds = new Map(targets.map((scene) => [scene.id, [...new Set([...sceneReferenceCharacterIds(scene, "image"), ...(inferredCharacters.get(scene.id) || [])])]]));
    const nextImageLocationIds = new Map(targets.map((scene) => [scene.id, inferredLocations.get(scene.id) || sceneReferenceLocationId(scene, "image")]));
    const nextVideoLocationIds = new Map(targets.map((scene) => [scene.id, inferredLocations.get(scene.id) || sceneReferenceLocationId(scene, "video")]));
    let matchedScenes = 0;
    let changedScenes = 0;
    let addedAssignments = 0;
    let matchedLocations = 0;
    let changedLocations = 0;
    let addedLocationAssignments = 0;
    let changedReferenceScenes = 0;
    let unmatchedLocationScenes = 0;
    for (const scene of targets) {
      const beforeCharacters = sceneCharacterIds(scene);
      const afterCharacters = inferredCharacters.get(scene.id) || beforeCharacters;
      const beforeLocation = sceneLocationId(scene);
      const afterLocation = inferredLocations.get(scene.id) || "";
      const beforeImageCharacters = sceneReferenceCharacterIds(scene, "image");
      const afterImageCharacters = nextImageCharacterIds.get(scene.id) || beforeImageCharacters;
      const beforeImageLocation = sceneReferenceLocationId(scene, "image");
      const afterImageLocation = nextImageLocationIds.get(scene.id) || beforeImageLocation;
      const beforeVideoLocation = sceneReferenceLocationId(scene, "video");
      const afterVideoLocation = nextVideoLocationIds.get(scene.id) || beforeVideoLocation;
      const hadExplicitVideoLocation = Object.prototype.hasOwnProperty.call(scene, "video_reference_location_id") || Object.prototype.hasOwnProperty.call(scene, "videoReferenceLocationId");
      const canSetImageCharacters = forceImageReferences && (afterCharacters.length > 0 || Object.prototype.hasOwnProperty.call(scene, "image_reference_character_ids") || Object.prototype.hasOwnProperty.call(scene, "imageReferenceCharacterIds"));
      const canSetImageLocation = forceImageReferences && (Boolean(afterLocation) || Object.prototype.hasOwnProperty.call(scene, "image_reference_location_id") || Object.prototype.hasOwnProperty.call(scene, "imageReferenceLocationId"));
      const canSetVideoLocation = forceImageReferences && project.presetId === "ai-drama" && Boolean(afterLocation);
      if (afterCharacters.length) matchedScenes += 1;
      if (afterLocation) matchedLocations += 1;
      else unmatchedLocationScenes += 1;
      addedAssignments += afterCharacters.filter((id) => !beforeCharacters.includes(id)).length;
      if (afterLocation && (afterLocation !== beforeLocation || afterImageLocation !== beforeImageLocation || (canSetVideoLocation && (afterVideoLocation !== beforeVideoLocation || !hadExplicitVideoLocation)))) addedLocationAssignments += 1;
      const characterChanged = JSON.stringify(afterCharacters) !== JSON.stringify(beforeCharacters);
      const imageReferenceChanged = (canSetImageCharacters && JSON.stringify(afterImageCharacters) !== JSON.stringify(beforeImageCharacters))
        || (canSetImageLocation && afterImageLocation !== beforeImageLocation);
      const videoReferenceChanged = canSetVideoLocation && (afterVideoLocation !== beforeVideoLocation || !hadExplicitVideoLocation);
      const locationChanged = afterLocation !== beforeLocation || (canSetImageLocation && afterImageLocation !== beforeImageLocation);
      if (characterChanged) changedScenes += 1;
      if (locationChanged) changedLocations += 1;
      if (characterChanged || locationChanged || imageReferenceChanged || videoReferenceChanged) changedReferenceScenes += 1;
    }

    const byChunk = new Map<string, typeof targets>();
    for (const scene of targets) {
      const group = byChunk.get(scene.chunkId) || [];
      group.push(scene);
      byChunk.set(scene.chunkId, group);
    }
    for (const [chunkId, chunkScenes] of byChunk) {
      const chunk = project.chunks.find((item) => item.id === chunkId);
      if (!chunk?.outputPath) continue;
      const payload = asRecord(await readChunkOutput(chunk));
      const rawScenes = payload && Array.isArray(payload.scenes) ? payload.scenes : [];
      const targetSet = new Set(chunkScenes.map((scene) => scene.id));
      const updatedScenes = rawScenes.map((value) => {
        const record = asRecord(value);
        const id = String(record?.id || record?.scene_id || "").trim();
        if (!record || !targetSet.has(id)) return value;
        const currentIds = sceneCharacterIds(record);
        const nextIds = inferredCharacters.get(id) || currentIds;
        const currentLocationId = sceneLocationId(record);
        const nextLocationId = inferredLocations.get(id) || "";
        const currentImageCharacterIds = sceneReferenceCharacterIds(record, "image");
        const nextImageCharacters = nextImageCharacterIds.get(id) || currentImageCharacterIds;
        const currentImageLocationId = sceneReferenceLocationId(record, "image");
        const nextImageLocationId = nextImageLocationIds.get(id) || currentImageLocationId;
        const currentVideoLocationId = sceneReferenceLocationId(record, "video");
        const nextVideoLocationId = nextVideoLocationIds.get(id) || currentVideoLocationId;
        const hadExplicitVideoLocation = Object.prototype.hasOwnProperty.call(record, "video_reference_location_id") || Object.prototype.hasOwnProperty.call(record, "videoReferenceLocationId");
        const canSetImageCharacters = forceImageReferences && (nextIds.length > 0 || Object.prototype.hasOwnProperty.call(record, "image_reference_character_ids") || Object.prototype.hasOwnProperty.call(record, "imageReferenceCharacterIds"));
        const canSetImageLocation = forceImageReferences && (Boolean(nextLocationId) || Object.prototype.hasOwnProperty.call(record, "image_reference_location_id") || Object.prototype.hasOwnProperty.call(record, "imageReferenceLocationId"));
        const canSetVideoLocation = forceImageReferences && project.presetId === "ai-drama" && Boolean(nextLocationId);
        const imageReferenceChanged = (canSetImageCharacters && JSON.stringify(nextImageCharacters) !== JSON.stringify(currentImageCharacterIds))
          || (canSetImageLocation && nextImageLocationId !== currentImageLocationId);
        const videoReferenceChanged = canSetVideoLocation && (nextVideoLocationId !== currentVideoLocationId || !hadExplicitVideoLocation);
        const changed = JSON.stringify(currentIds) !== JSON.stringify(nextIds) || currentLocationId !== nextLocationId || imageReferenceChanged || videoReferenceChanged;
        const currentMedia = asRecord(record.media);
        const currentReference = asRecord(record.videoReferenceImage || record.video_reference_image) || (currentMedia?.kind === "image" ? currentMedia : undefined);
        return {
          ...record,
          character_ids: nextIds,
          location_id: nextLocationId,
          ...(canSetImageCharacters ? { image_reference_character_ids: nextImageCharacters } : {}),
          ...(canSetImageLocation ? { image_reference_location_id: nextImageLocationId } : {}),
          ...(canSetVideoLocation ? { video_reference_location_id: nextVideoLocationId } : {}),
          ...(nextLocationId ? { location_name: locations.find((location) => location.id === nextLocationId)?.name || record.location_name } : {}),
          ...(changed && (currentMedia?.kind === "image" || (currentMedia?.provider && String(currentMedia.provider).startsWith("maivideo-"))) ? { media: { ...currentMedia, stale: true } } : {}),
          ...(changed && currentReference?.kind === "image" ? { videoReferenceImage: { ...currentReference, stale: true } } : {}),
          ...(changed ? { review_status: "unreviewed", review_note: "", ai_review: { status: "pending", score: 0, summary: "Ảnh tham chiếu cảnh đã đổi; cần kiểm tra lại media.", issues: ["Media hiện tại được tạo trước khi cập nhật hồ sơ nhân vật hoặc bối cảnh."], checks: {}, createdAt: now() } } : {}),
        };
      });
      const hasChanges = chunkScenes.some((scene) => {
        const nextIds = inferredCharacters.get(scene.id) || sceneCharacterIds(scene);
        const nextLocationId = inferredLocations.get(scene.id) || "";
        const nextImageCharacters = nextImageCharacterIds.get(scene.id) || sceneReferenceCharacterIds(scene, "image");
        const nextImageLocationId = nextImageLocationIds.get(scene.id) || sceneReferenceLocationId(scene, "image");
        const nextVideoLocationId = nextVideoLocationIds.get(scene.id) || sceneReferenceLocationId(scene, "video");
        const hadExplicitVideoLocation = Object.prototype.hasOwnProperty.call(scene, "video_reference_location_id") || Object.prototype.hasOwnProperty.call(scene, "videoReferenceLocationId");
        const canSetImageCharacters = forceImageReferences && (nextIds.length > 0 || Object.prototype.hasOwnProperty.call(scene, "image_reference_character_ids") || Object.prototype.hasOwnProperty.call(scene, "imageReferenceCharacterIds"));
        const canSetImageLocation = forceImageReferences && (Boolean(nextLocationId) || Object.prototype.hasOwnProperty.call(scene, "image_reference_location_id") || Object.prototype.hasOwnProperty.call(scene, "imageReferenceLocationId"));
        const canSetVideoLocation = forceImageReferences && project.presetId === "ai-drama" && Boolean(nextLocationId);
        return JSON.stringify(nextIds) !== JSON.stringify(sceneCharacterIds(scene))
          || nextLocationId !== sceneLocationId(scene)
          || (canSetImageCharacters && JSON.stringify(nextImageCharacters) !== JSON.stringify(sceneReferenceCharacterIds(scene, "image")))
          || (canSetImageLocation && nextImageLocationId !== sceneReferenceLocationId(scene, "image"))
          || (canSetVideoLocation && (nextVideoLocationId !== sceneReferenceLocationId(scene, "video") || !hadExplicitVideoLocation));
      });
      if (hasChanges) {
        chunk.outputPath = await saveChunkOutput(slug, chunkId, { ...(payload || {}), scenes: updatedScenes });
        chunk.render = markRenderStale(chunk.render);
        project.render = markRenderStale(project.render);
      }
    }
    if (changedReferenceScenes) {
      project.updatedAt = now();
      data.activities.unshift(makeActivity({ projectSlug: slug, kind: "chunk", title: "Đã tự gán hồ sơ tham chiếu cho cảnh", detail: `${changedReferenceScenes} cảnh · ${addedAssignments} lượt nhân vật · ${addedLocationAssignments} lượt bối cảnh`, status: "success" }));
    }
    return { matchedScenes, changedScenes, changedReferenceScenes, addedAssignments, matchedLocations, changedLocations, addedLocationAssignments, unmatchedScenes: Math.max(0, requestedIds.length - Math.max(matchedScenes, matchedLocations)), unmatchedLocationScenes };
  });
  return NextResponse.json({ ok: true, ...result });
}

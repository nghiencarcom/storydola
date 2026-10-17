import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { ProjectCharacter, StoryProject } from "../../../../lib/project-types";
import { characterReferencePrompt } from "../../../../lib/ai-drama-reference-prompts";
import { normalizeEntityName } from "../../../../lib/entity-name";
import { downloadMaiVideoLibraryImage, MaiVideoLibraryError } from "../../../../lib/maivideo-media-library";
import { readProjectScenes, sceneMediaLocalPath } from "../../../../lib/scene-store";
import { makeActivity, markRenderStale, now, readChunkOutput, readData, saveChunkOutput, updateData } from "../../../../lib/server-store";
import { resolveProjectSceneVoice } from "../../../../lib/project-tts-voice";
import { hasExplicitDialogueSegments, readDialogueSegments } from "../../../../lib/dialogue-segments";
import { sceneReferenceCharacterIds } from "../../../../lib/scene-reference-assignments";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function sceneUsesCharacter(scene: Record<string, unknown>, characterId: string) {
  const cast = scene.character_ids ?? scene.characterIds;
  if (Array.isArray(cast) && cast.map(String).includes(characterId)) return true;
  if (sceneReferenceCharacterIds(scene, "image").includes(characterId) || sceneReferenceCharacterIds(scene, "video").includes(characterId)) return true;
  if (String(scene.speaker_character_id || scene.speakerCharacterId || "") === characterId) return true;
  return [scene.dialogueSegments, scene.dialogue_segments].some((segments) => Array.isArray(segments) && segments.some((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const line = value as Record<string, unknown>;
    return String(line.speakerCharacterId || line.speaker_character_id || "") === characterId;
  }));
}

async function invalidateCharacterScenes(project: StoryProject, slug: string, characterId: string) {
  for (const chunk of project.chunks) {
    if (!chunk.outputPath) continue;
    const output = await readChunkOutput(chunk) as Record<string, unknown> | null;
    if (!output || !Array.isArray(output.scenes)) continue;
    let changed = false;
    const scenes = output.scenes.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const scene = { ...value } as Record<string, unknown>;
      if (!sceneUsesCharacter(scene, characterId)) return scene;
      changed = true;
      if (scene.media && typeof scene.media === "object" && !Array.isArray(scene.media)) {
        scene.media = { ...(scene.media as Record<string, unknown>), stale: true };
      }
      const reference = scene.videoReferenceImage || scene.video_reference_image;
      if (reference && typeof reference === "object" && !Array.isArray(reference) && (reference as Record<string, unknown>).kind === "image") {
        scene.videoReferenceImage = { ...(reference as Record<string, unknown>), stale: true };
      }
      scene.review_status = "unreviewed";
      scene.review_note = "";
      scene.ai_review = {
        status: "pending", score: 0,
        summary: "Ảnh tham chiếu nhân vật đã đổi; cần kiểm tra lại media.",
        issues: ["Media hiện tại được tạo trước khi cập nhật hồ sơ nhân vật."], checks: {}, createdAt: now(),
      };
      return scene;
    });
    if (changed) {
      chunk.outputPath = await saveChunkOutput(slug, chunk.id, { ...output, scenes });
      chunk.render = markRenderStale(chunk.render);
      project.render = markRenderStale(project.render);
    }
  }
}

function imageType(bytes: Buffer) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: "image/png", extension: "png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", extension: "webp" };
  return undefined;
}

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const characters = (project.characters || []).map((character) => ({
    ...character,
    previewUrl: `/api/projects/${encodeURIComponent(slug)}/characters/${encodeURIComponent(character.id)}/image`,
  }));
  return NextResponse.json({ characters }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const characterId = String(body.characterId || "").trim();
  const hasVoice = Object.prototype.hasOwnProperty.call(body, "voiceId");
  const voiceId = String(body.voiceId || "").trim();
  const voiceName = String(body.voiceName || "").trim().slice(0, 120);
  const voiceLanguage = String(body.voiceLanguage || "").trim().slice(0, 24);
  if (!characterId) return NextResponse.json({ message: "Không tìm thấy nhân vật cần cập nhật." }, { status: 400 });
  if (hasVoice && voiceId && (!voiceName || !voiceLanguage)) return NextResponse.json({ message: "Thiếu tên hoặc ngôn ngữ của voice." }, { status: 400 });

  const snapshot = await readData();
  const project = snapshot.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  if (project.presetId !== "ai-drama") return NextResponse.json({ message: "Voice theo nhân vật chỉ áp dụng cho AI Drama." }, { status: 409 });
  if (!(project.characters || []).some((character) => character.id === characterId)) return NextResponse.json({ message: "Không tìm thấy hồ sơ nhân vật." }, { status: 404 });

  const saved = await updateData(async (data) => {
    const currentProject = data.projects.find((item) => item.slug === slug);
    if (!currentProject) throw new Error("PROJECT_NOT_FOUND");
    const character = (currentProject.characters || []).find((item) => item.id === characterId);
    if (!character) throw new Error("CHARACTER_NOT_FOUND");
    const changed = hasVoice && (String(character.voiceId || "") !== voiceId || character.voiceName !== (voiceId ? voiceName : undefined) || character.voiceLanguage !== (voiceId ? voiceLanguage : undefined));
    const previousVisualProfile = { name: character.name, description: character.description, imagePrompt: character.imagePrompt };
    if (hasVoice) {
      character.voiceId = voiceId || undefined;
      character.voiceName = voiceId ? voiceName : undefined;
      character.voiceLanguage = voiceId ? voiceLanguage : undefined;
    }
    if (typeof body.name === "string" && body.name.trim()) character.name = body.name.trim().slice(0, 80);
    if (typeof body.description === "string") character.description = body.description.trim().slice(0, 1200);
    if (typeof body.imagePrompt === "string") character.imagePrompt = characterReferencePrompt(character.name, body.imagePrompt || character.description);
    const visualProfileChanged = previousVisualProfile.name !== character.name || previousVisualProfile.description !== character.description || previousVisualProfile.imagePrompt !== character.imagePrompt;
    character.updatedAt = now();

    if (changed) {
      for (const chunk of currentProject.chunks) {
        if (!chunk.outputPath) continue;
        const rawPayload = await readChunkOutput(chunk);
        if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) continue;
        const payload = rawPayload as Record<string, unknown>;
        const scenes = Array.isArray(payload.scenes) ? payload.scenes as Array<Record<string, unknown>> : [];
        let invalidated = 0;
        for (const scene of scenes) {
          const resolved = resolveProjectSceneVoice(scene, currentProject);
          if (resolved.speakerCharacterId === characterId) {
            delete scene.audio;
            delete scene.ttsVoiceId;
            delete scene.ttsVoiceName;
            delete scene.ttsVoiceLanguage;
            delete scene.tts_voice_id;
            delete scene.tts_voice_name;
            delete scene.tts_voice_language;
            invalidated += 1;
          }
          if (hasExplicitDialogueSegments(scene)) {
            const segments = readDialogueSegments(scene, currentProject.characters || []);
            let invalidatedLines = 0;
            for (const segment of segments) {
              if (segment.speakerCharacterId !== characterId) continue;
              delete segment.audio;
              invalidatedLines += 1;
            }
            if (invalidatedLines) {
              scene.dialogueSegments = segments;
              invalidated += invalidatedLines;
            }
          }
        }
        if (!invalidated) continue;
        chunk.outputPath = await saveChunkOutput(slug, chunk.id, { ...payload, scenes });
        chunk.tts = { status: "idle", completed: 0, total: invalidated, failed: 0, updatedAt: now() };
        chunk.render = markRenderStale(chunk.render);
      }
      currentProject.render = markRenderStale(currentProject.render);
    }
    if (visualProfileChanged) await invalidateCharacterScenes(currentProject, slug, characterId);

    currentProject.updatedAt = now();
    data.activities.unshift(makeActivity({
      projectSlug: slug,
      kind: "project",
      title: hasVoice ? `Đã ${voiceId ? "đổi" : "xóa"} voice cho ${character.name}` : `Đã cập nhật hồ sơ ${character.name}`,
      detail: hasVoice ? voiceId ? `${voiceName} · hồ sơ ${voiceLanguage}` : "Dùng voice mặc định nếu chưa gán lại." : "Đã lưu tên, mô tả và prompt ảnh.",
      status: "success",
    }));
    return { character: { ...character, previewUrl: `/api/projects/${encodeURIComponent(slug)}/characters/${encodeURIComponent(character.id)}/image` } };
  });

  return NextResponse.json({ ok: true, ...saved });
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });

  if (request.headers.get("content-type")?.includes("application/json")) {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) return NextResponse.json({ message: "Hãy nhập tên nhân vật." }, { status: 400 });
    if ((project.characters || []).some((item) => normalizeEntityName(item.name) === normalizeEntityName(name))) return NextResponse.json({ message: "Nhân vật này đã có hồ sơ." }, { status: 409 });
    const timestamp = now();
    const character: ProjectCharacter = {
      id: `char-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description: String(body.description || "").trim().slice(0, 1200),
      imagePrompt: characterReferencePrompt(name, String(body.imagePrompt || body.description || "")),
      referenceImagePath: "", referenceImageName: "", referenceImageMimeType: "",
      voiceId: project.voiceId || "", voiceName: project.voiceName || "", voiceLanguage: project.voiceLanguage || project.language,
      createdAt: timestamp, updatedAt: timestamp,
    };
    await updateData((current) => {
      const target = current.projects.find((item) => item.slug === slug);
      if (!target) throw new Error("PROJECT_NOT_FOUND");
      target.characters = [...(target.characters || []), character];
      target.updatedAt = timestamp;
    });
    return NextResponse.json({ ok: true, character });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ message: "Không đọc được thông tin nhân vật." }, { status: 400 });
  const name = String(formData.get("name") || "").trim().slice(0, 80);
  const description = String(formData.get("description") || "").trim().slice(0, 1200);
  const imagePromptInput = String(formData.get("imagePrompt") || "").trim().slice(0, 3000);
  const file = formData.get("file");
  const sourceSceneId = String(formData.get("sourceSceneId") || "").trim();
  const maivideoMediaId = String(formData.get("maivideoMediaId") || "").trim();
  if (!name) return NextResponse.json({ message: "Hãy nhập tên nhân vật." }, { status: 400 });
  if (Number(Boolean(sourceSceneId)) + Number(Boolean(maivideoMediaId)) + Number(file instanceof File) > 1) {
    return NextResponse.json({ message: "Chỉ chọn một nguồn ảnh tham chiếu." }, { status: 400 });
  }
  if (!sourceSceneId && !maivideoMediaId && !(file instanceof File)) return NextResponse.json({ message: "Hãy chọn ảnh tham chiếu cho nhân vật." }, { status: 400 });

  let bytes: Buffer;
  let imageName: string;
  if (maivideoMediaId) {
    try {
      const downloaded = await downloadMaiVideoLibraryImage(maivideoMediaId);
      bytes = downloaded.bytes;
      imageName = downloaded.image.fileName || downloaded.image.name;
    } catch (cause) {
      const error = cause instanceof MaiVideoLibraryError ? cause : new MaiVideoLibraryError("Không tải được ảnh từ thư viện MaiVideo.");
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
  } else if (sourceSceneId) {
    const scene = (await readProjectScenes(project)).find((item) => item.id === sourceSceneId);
    const media = scene?.media && typeof scene.media === "object" ? scene.media as Record<string, unknown> : {};
    const localPath = scene ? sceneMediaLocalPath(scene) : "";
    if (!scene || media.kind !== "image" || media.status !== "ready" || !localPath) {
      return NextResponse.json({ message: "Ảnh cảnh đã chọn không còn khả dụng." }, { status: 400 });
    }
    const safeSlug = project.slug.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "project";
    const mediaRoot = path.resolve(process.cwd(), "data", "media", safeSlug);
    const sourcePath = path.resolve(process.cwd(), localPath);
    if (!sourcePath.startsWith(`${mediaRoot}${path.sep}`)) {
      return NextResponse.json({ message: "Ảnh cảnh không thuộc project này." }, { status: 403 });
    }
    try {
      bytes = await readFile(sourcePath);
    } catch {
      return NextResponse.json({ message: "Không đọc được ảnh cảnh đã chọn." }, { status: 404 });
    }
    imageName = `${sourceSceneId} · media`;
  } else {
    if (!(file instanceof File)) return NextResponse.json({ message: "Hãy chọn ảnh tham chiếu cho nhân vật." }, { status: 400 });
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ message: "Ảnh tham chiếu phải lớn hơn 0 và không vượt quá 8 MB." }, { status: 413 });
    }
    bytes = Buffer.from(await file.arrayBuffer());
    imageName = file.name.slice(0, 160) || "character-reference";
  }
  if (bytes.length <= 0 || bytes.length > MAX_IMAGE_BYTES) {
    return NextResponse.json({ message: "Ảnh tham chiếu phải lớn hơn 0 và không vượt quá 8 MB." }, { status: 413 });
  }
  const detected = imageType(bytes);
  if (!detected) return NextResponse.json({ message: "Ảnh nhân vật chỉ hỗ trợ PNG, JPG hoặc WebP." }, { status: 415 });

  const existingCharacter = (project.characters || []).find((character) => normalizeEntityName(character.name) === normalizeEntityName(name));
  const characterId = existingCharacter?.id || `char-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeSlug = project.slug.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "project";
  const relativePath = path.join("data", "media", safeSlug, "characters", `${characterId}.${detected.extension}`);
  const absolutePath = path.join(process.cwd(), relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);

  const timestamp = now();
  const character: ProjectCharacter = {
    ...existingCharacter,
    id: characterId,
    name,
    description: description || existingCharacter?.description || "",
    imagePrompt: characterReferencePrompt(name, imagePromptInput || existingCharacter?.imagePrompt || description),
    referenceImagePath: relativePath,
    referenceImageName: imageName || `${characterId}.${detected.extension}`,
    referenceImageMimeType: detected.mime,
    createdAt: existingCharacter?.createdAt || timestamp,
    updatedAt: timestamp,
  };
  await updateData(async (currentData) => {
    const currentProject = currentData.projects.find((item) => item.slug === slug);
    if (!currentProject) throw new Error("PROJECT_NOT_FOUND");
    const currentCharacters = currentProject.characters || [];
    const existingIndex = currentCharacters.findIndex((item) => item.id === characterId);
    currentProject.characters = existingIndex >= 0
      ? currentCharacters.map((item, index) => index === existingIndex ? character : item)
      : [...currentCharacters, character];
    if (existingCharacter) await invalidateCharacterScenes(currentProject, slug, characterId);
    currentProject.updatedAt = timestamp;
    currentData.activities.unshift(makeActivity({
      projectSlug: slug,
      kind: "project",
      title: `Đã ${existingCharacter ? "cập nhật" : "thêm"} hồ sơ nhân vật ${name}`,
      detail: "Ảnh tham chiếu đã lưu trong project và có thể gán cho từng cảnh.",
      status: "success",
    }));
  });

  return NextResponse.json({ ok: true, character: {
    ...character,
    previewUrl: `/api/projects/${encodeURIComponent(slug)}/characters/${encodeURIComponent(character.id)}/image`,
  } });
}

export async function DELETE(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const characterId = String(body.characterId || "").trim();
  if (!characterId) return NextResponse.json({ message: "Thiếu mã nhân vật." }, { status: 400 });
  const result = await updateData(async (data) => {
    const project = data.projects.find((item) => item.slug === slug);
    if (!project) return "project";
    const character = project.characters?.find((item) => item.id === characterId);
    if (!character) return "character";
    project.characters = project.characters?.filter((item) => item.id !== characterId);
    for (const chunk of project.chunks) {
      if (!chunk.outputPath) continue;
      const output = await readChunkOutput(chunk) as Record<string, unknown> | null;
      if (!output || !Array.isArray(output.scenes)) continue;
      let changed = false;
      const scenes = output.scenes.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return value;
        const scene = { ...value } as Record<string, unknown>;
        let sceneChanged = false;
        const ids = Array.isArray(scene.character_ids) ? scene.character_ids : Array.isArray(scene.characterIds) ? scene.characterIds : [];
        if (ids.includes(characterId)) { scene.character_ids = ids.filter((id) => id !== characterId); delete scene.characterIds; changed = true; sceneChanged = true; }
        for (const key of ["image_reference_character_ids", "imageReferenceCharacterIds", "video_reference_character_ids", "videoReferenceCharacterIds"]) {
          if (!Array.isArray(scene[key]) || !(scene[key] as unknown[]).map(String).includes(characterId)) continue;
          scene[key] = (scene[key] as unknown[]).filter((id) => String(id) !== characterId);
          changed = true;
          sceneChanged = true;
        }
        if (scene.speaker_character_id === characterId || scene.speakerCharacterId === characterId) { scene.speaker_character_id = ""; delete scene.speakerCharacterId; delete scene.audio; changed = true; sceneChanged = true; }
        for (const key of ["dialogueSegments", "dialogue_segments"]) {
          if (!Array.isArray(scene[key])) continue;
          scene[key] = (scene[key] as unknown[]).map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return item;
            const line = { ...item } as Record<string, unknown>;
            if (line.speakerCharacterId === characterId || line.speaker_character_id === characterId) { delete line.speakerCharacterId; delete line.speaker_character_id; delete line.audio; changed = true; sceneChanged = true; }
            return line;
          });
        }
        if (sceneChanged) {
          if (scene.media && typeof scene.media === "object") scene.media = { ...(scene.media as Record<string, unknown>), stale: true };
          const reference = scene.videoReferenceImage || scene.video_reference_image;
          if (reference && typeof reference === "object" && !Array.isArray(reference) && (reference as Record<string, unknown>).kind === "image") {
            scene.videoReferenceImage = { ...(reference as Record<string, unknown>), stale: true };
          }
        }
        return scene;
      });
      if (changed) {
        chunk.outputPath = await saveChunkOutput(slug, chunk.id, { ...output, scenes });
        chunk.render = markRenderStale(chunk.render);
        project.render = markRenderStale(project.render);
      }
    }
    project.updatedAt = now();
    data.activities.unshift(makeActivity({ projectSlug: slug, kind: "project", title: `Đã xóa hồ sơ ${character.name}`, detail: "Kịch bản được giữ lại; media và ảnh tham chiếu của các cảnh dùng hồ sơ này cần tạo lại.", status: "success" }));
    return "ok";
  });
  return result === "ok" ? NextResponse.json({ ok: true }) : NextResponse.json({ message: result === "project" ? "Không tìm thấy project." : "Không tìm thấy nhân vật." }, { status: 404 });
}

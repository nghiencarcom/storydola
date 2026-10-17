import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { ProjectLocation, StoryProject } from "../../../../lib/project-types";
import { locationReferencePrompt } from "../../../../lib/ai-drama-reference-prompts";
import { normalizeEntityName } from "../../../../lib/entity-name";
import { downloadMaiVideoLibraryImage, MaiVideoLibraryError } from "../../../../lib/maivideo-media-library";
import { readProjectScenes, sceneMediaLocalPath } from "../../../../lib/scene-store";
import { makeActivity, markRenderStale, now, readChunkOutput, readData, saveChunkOutput, updateData } from "../../../../lib/server-store";
import { sceneReferenceLocationId } from "../../../../lib/scene-reference-assignments";

export const runtime = "nodejs";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function imageType(bytes: Buffer) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: "image/png", extension: "png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", extension: "webp" };
  return undefined;
}

function safeSlug(slug: string) {
  return slug.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "project";
}

function previewUrl(slug: string, locationId: string) {
  return `/api/projects/${encodeURIComponent(slug)}/locations/${encodeURIComponent(locationId)}/image`;
}

async function invalidateLocationScenes(project: StoryProject, slug: string, locationId: string, removeAssignment = false) {
  for (const chunk of project.chunks) {
    if (!chunk.outputPath) continue;
    const output = await readChunkOutput(chunk) as Record<string, unknown> | null;
    if (!output || !Array.isArray(output.scenes)) continue;
    let changed = false;
    const scenes = output.scenes.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const scene = { ...value } as Record<string, unknown>;
      const assigned = [scene.location_id, scene.locationId, scene.environment_id, scene.environmentId].some((id) => id === locationId)
        || sceneReferenceLocationId(scene, "image") === locationId
        || sceneReferenceLocationId(scene, "video") === locationId;
      if (!assigned) return scene;
      changed = true;
      if (removeAssignment) {
        for (const key of ["location_id", "locationId", "environment_id", "environmentId"]) {
          if (scene[key] === locationId) delete scene[key];
        }
        for (const key of ["image_reference_location_id", "imageReferenceLocationId", "video_reference_location_id", "videoReferenceLocationId"]) {
          if (scene[key] === locationId) scene[key] = "";
        }
      }
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
        summary: "Ảnh tham chiếu bối cảnh đã đổi; cần kiểm tra lại media.",
        issues: ["Media hiện tại được tạo trước khi cập nhật hồ sơ bối cảnh."], checks: {}, createdAt: now(),
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

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  return NextResponse.json({ locations: (project.locations || []).map((location) => ({ ...location, previewUrl: previewUrl(slug, location.id) })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  if (request.headers.get("content-type")?.includes("application/json")) {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const name = String(body.name || "").trim().slice(0, 100);
    if (!name) return NextResponse.json({ message: "Hãy nhập tên bối cảnh." }, { status: 400 });
    if ((project.locations || []).some((item) => normalizeEntityName(item.name) === normalizeEntityName(name))) return NextResponse.json({ message: "Bối cảnh này đã có hồ sơ." }, { status: 409 });
    const timestamp = now();
    const location: ProjectLocation = {
      id: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name, description: String(body.description || "").trim().slice(0, 1200), imagePrompt: locationReferencePrompt(name, String(body.imagePrompt || body.description || "")),
      referenceImagePath: "", referenceImageName: "", referenceImageMimeType: "", createdAt: timestamp, updatedAt: timestamp,
    };
    await updateData((current) => {
      const target = current.projects.find((item) => item.slug === slug);
      if (!target) throw new Error("PROJECT_NOT_FOUND");
      target.locations = [...(target.locations || []), location];
      target.updatedAt = timestamp;
    });
    return NextResponse.json({ ok: true, location });
  }
  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ message: "Không đọc được thông tin bối cảnh." }, { status: 400 });
  const name = String(formData.get("name") || "").trim().slice(0, 100);
  const description = String(formData.get("description") || "").trim().slice(0, 1200);
  const imagePromptInput = String(formData.get("imagePrompt") || "").trim().slice(0, 3000);
  const aliases = [...new Set(String(formData.get("aliases") || "").split(/[,;\n]+/).map((alias) => alias.trim()).filter(Boolean).map((alias) => alias.slice(0, 100)))].slice(0, 20);
  const file = formData.get("file");
  const sourceSceneId = String(formData.get("sourceSceneId") || "").trim();
  const maivideoMediaId = String(formData.get("maivideoMediaId") || "").trim();
  if (!name) return NextResponse.json({ message: "Hãy nhập tên bối cảnh." }, { status: 400 });
  if (Number(Boolean(sourceSceneId)) + Number(Boolean(maivideoMediaId)) + Number(file instanceof File) !== 1) return NextResponse.json({ message: "Chọn một ảnh 4 góc từ máy, project hoặc thư viện MaiVideo." }, { status: 400 });

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
    if (!scene || media.kind !== "image" || media.status !== "ready" || !localPath) return NextResponse.json({ message: "Ảnh cảnh đã chọn không còn khả dụng." }, { status: 400 });
    const mediaRoot = path.resolve(process.cwd(), "data", "media", safeSlug(project.slug));
    const sourcePath = path.resolve(process.cwd(), localPath);
    if (!sourcePath.startsWith(`${mediaRoot}${path.sep}`)) return NextResponse.json({ message: "Ảnh cảnh không thuộc project này." }, { status: 403 });
    try { bytes = await readFile(sourcePath); } catch { return NextResponse.json({ message: "Không đọc được ảnh cảnh đã chọn." }, { status: 404 }); }
    imageName = `${sourceSceneId} · media`;
  } else {
    if (!(file instanceof File) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) return NextResponse.json({ message: "Ảnh bối cảnh phải lớn hơn 0 và không vượt quá 8 MB." }, { status: 413 });
    bytes = Buffer.from(await file.arrayBuffer());
    imageName = file.name.slice(0, 160) || "location-reference";
  }
  if (bytes.length <= 0 || bytes.length > MAX_IMAGE_BYTES) return NextResponse.json({ message: "Ảnh bối cảnh phải lớn hơn 0 và không vượt quá 8 MB." }, { status: 413 });
  const detected = imageType(bytes);
  if (!detected) return NextResponse.json({ message: "Ảnh bối cảnh chỉ hỗ trợ PNG, JPG hoặc WebP." }, { status: 415 });

  const existingLocation = (project.locations || []).find((item) => normalizeEntityName(item.name) === normalizeEntityName(name));
  const id = existingLocation?.id || `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const relativePath = path.join("data", "media", safeSlug(project.slug), "locations", `${id}.${detected.extension}`);
  const absolutePath = path.join(process.cwd(), relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  const timestamp = now();
  const location: ProjectLocation = { ...existingLocation, id, name, aliases, description: description || existingLocation?.description || "", imagePrompt: locationReferencePrompt(name, imagePromptInput || existingLocation?.imagePrompt || description), referenceImagePath: relativePath, referenceImageName: imageName, referenceImageMimeType: detected.mime, createdAt: existingLocation?.createdAt || timestamp, updatedAt: timestamp };
  await updateData(async (currentData) => {
    const currentProject = currentData.projects.find((item) => item.slug === slug);
    if (!currentProject) throw new Error("PROJECT_NOT_FOUND");
    currentProject.locations = existingLocation
      ? (currentProject.locations || []).map((item) => item.id === id ? location : item)
      : [...(currentProject.locations || []), location];
    if (existingLocation) await invalidateLocationScenes(currentProject, slug, id);
    currentProject.updatedAt = timestamp;
    currentData.activities.unshift(makeActivity({ projectSlug: slug, kind: "project", title: `Đã thêm hồ sơ bối cảnh ${name}`, detail: "Ảnh tham chiếu bối cảnh đã lưu trong project.", status: "success" }));
  });
  return NextResponse.json({ ok: true, location: { ...location, previewUrl: previewUrl(slug, id) } });
}

export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const locationId = String(body.locationId || "").trim();
  const result = await updateData(async (data) => {
    const project = data.projects.find((item) => item.slug === slug);
    if (!project) return null;
    const location = project.locations?.find((item) => item.id === locationId);
    if (!location) return null;
    const previous = { name: location.name, description: location.description, imagePrompt: location.imagePrompt };
    if (typeof body.name === "string" && body.name.trim()) location.name = body.name.trim().slice(0, 100);
    if (typeof body.description === "string") location.description = body.description.trim().slice(0, 1200);
    if (typeof body.imagePrompt === "string") location.imagePrompt = locationReferencePrompt(location.name, body.imagePrompt || location.description);
    const referenceChanged = previous.name !== location.name || previous.description !== location.description || previous.imagePrompt !== location.imagePrompt;
    if (referenceChanged) await invalidateLocationScenes(project, slug, locationId);
    location.updatedAt = now(); project.updatedAt = now();
    return location;
  });
  return result ? NextResponse.json({ ok: true, location: result }) : NextResponse.json({ message: "Không tìm thấy bối cảnh." }, { status: 404 });
}

export async function DELETE(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const locationId = String(body.locationId || "").trim();
  const result = await updateData(async (data) => {
    const project = data.projects.find((item) => item.slug === slug);
    if (!project) return false;
    const exists = project.locations?.some((item) => item.id === locationId);
    if (!exists) return false;
    project.locations = project.locations?.filter((item) => item.id !== locationId);
    await invalidateLocationScenes(project, slug, locationId, true);
    project.updatedAt = now();
    return true;
  });
  return result ? NextResponse.json({ ok: true }) : NextResponse.json({ message: "Không tìm thấy bối cảnh." }, { status: 404 });
}

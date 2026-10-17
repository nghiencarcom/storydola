import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { generateMaiVideoProfileImage } from "../../../../../../lib/media-provider";
import { resolveMediaGenerationSettings } from "../../../../../../lib/media-generation-settings";
import type { MediaGenerationSettings } from "../../../../../../lib/project-types";
import { markRenderStale, now, readChunkOutput, readData, saveChunkOutput, updateData } from "../../../../../../lib/server-store";
import { sceneReferenceLocationId } from "../../../../../../lib/scene-reference-assignments";

export const runtime = "nodejs";

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function usesLocationReference(scene: Record<string, unknown>, locationId: string) {
  const media = asRecord(scene.media);
  const reference = asRecord(scene.videoReferenceImage || scene.video_reference_image);
  return [scene.location_id, scene.locationId, scene.environment_id, scene.environmentId].some((id) => id === locationId)
    || sceneReferenceLocationId(scene, "image") === locationId
    || sceneReferenceLocationId(scene, "video") === locationId
    || media?.referenceLocationId === locationId
    || reference?.referenceLocationId === locationId;
}

export async function GET(_request: Request, context: { params: Promise<{ slug: string; locationId: string }> }) {
  const { slug, locationId } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const location = (project.locations || []).find((item) => item.id === locationId);
  if (!location?.referenceImagePath) return NextResponse.json({ message: "Không tìm thấy ảnh bối cảnh." }, { status: 404 });
  const safeSlug = project.slug.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "project";
  const locationRoot = path.resolve(process.cwd(), "data", "media", safeSlug, "locations");
  const resolvedPath = path.resolve(process.cwd(), location.referenceImagePath);
  if (!resolvedPath.startsWith(`${locationRoot}${path.sep}`)) return NextResponse.json({ message: "Ảnh bối cảnh không thuộc project này." }, { status: 403 });
  try {
    const image = await readFile(resolvedPath);
    return new NextResponse(image, { headers: { "Content-Type": location.referenceImageMimeType || "application/octet-stream", "Content-Length": String(image.byteLength), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ message: "Không đọc được ảnh bối cảnh." }, { status: 404 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string; locationId: string }> }) {
  const { slug, locationId } = await context.params;
  const body = await request.json().catch(() => ({})) as { mediaGeneration?: Partial<MediaGenerationSettings> };
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  const location = project?.locations?.find((item) => item.id === locationId);
  if (!project || !location) return NextResponse.json({ message: "Không tìm thấy hồ sơ bối cảnh." }, { status: 404 });
  const prompt = location.imagePrompt?.trim() || location.description.trim();
  if (!prompt) return NextResponse.json({ message: "Bối cảnh cần có prompt tạo ảnh." }, { status: 400 });
  try {
    const mediaGeneration = resolveMediaGenerationSettings({ ...project.mediaGeneration, ...body.mediaGeneration });
    const image = await generateMaiVideoProfileImage({ projectSlug: slug, profileKind: "locations", profileId: locationId, prompt, mediaGeneration, contentGenre: project.contentGenre, secondaryGenres: project.secondaryGenres, storySetting: project.storySetting, settingNotes: project.settingNotes, visualStyle: project.visualStyle, imageStyle: project.imageStyle });
    const updated = await updateData(async (current) => {
      const project = current.projects.find((item) => item.slug === slug);
      const profile = project?.locations?.find((item) => item.id === locationId);
      if (!profile) throw new Error("LOCATION_NOT_FOUND");
      profile.referenceImagePath = image.localPath || "";
      profile.referenceImageName = `${profile.name}-ai.png`;
      profile.referenceImageMimeType = "image/png";
      const timestamp = now();
      profile.updatedAt = timestamp;
      if (project) {
        for (const chunk of project.chunks) {
          if (!chunk.outputPath) continue;
          const output = asRecord(await readChunkOutput(chunk));
          if (!output || !Array.isArray(output.scenes)) continue;
          let changed = false;
          const scenes = output.scenes.map((value) => {
            const scene = asRecord(value);
            if (!scene || !usesLocationReference(scene, locationId)) return value;
            const media = asRecord(scene.media);
            const reference = asRecord(scene.videoReferenceImage || scene.video_reference_image);
            if (!media && !reference) return value;
            changed = true;
            return {
              ...scene,
              ...(media ? { media: { ...media, stale: true } } : {}),
              ...(reference ? { videoReferenceImage: { ...reference, stale: true } } : {}),
              review_status: "unreviewed",
              review_note: "",
              ai_review: {
                status: "pending", score: 0,
                summary: "Ảnh tham chiếu bối cảnh đã được tạo hoặc cập nhật; cần tạo lại media.",
                issues: ["Media hiện tại được tạo trước ảnh tham chiếu bối cảnh mới."], checks: {}, createdAt: timestamp,
              },
            };
          });
          if (changed) {
            chunk.outputPath = await saveChunkOutput(slug, chunk.id, { ...output, scenes });
            chunk.render = markRenderStale(chunk.render);
            project.render = markRenderStale(project.render);
          }
        }
        project.updatedAt = timestamp;
      }
      return profile;
    });
    return NextResponse.json({ ok: true, location: updated });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "Không thể tạo ảnh bối cảnh.";
    const needsApiKey = code === "MAIVIDEO_IMAGE_API_KEY_REQUIRED" || code === "MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED";
    const message = code === "MAIVIDEO_IMAGE_API_KEY_REQUIRED"
      ? "Hãy thêm API key tạo ảnh MaiVideo trong Cài đặt."
      : code === "MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED"
        ? "Máy chủ chưa cấu hình khóa mã hóa API key MaiVideo."
        : code;
    return NextResponse.json({ code, message }, { status: needsApiKey ? 503 : 502 });
  }
}

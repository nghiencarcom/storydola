import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { generateMaiVideoProfileImage } from "../../../../../../lib/media-provider";
import { resolveMediaGenerationSettings } from "../../../../../../lib/media-generation-settings";
import { now, readData, updateData } from "../../../../../../lib/server-store";
import type { MediaGenerationSettings } from "../../../../../../lib/project-types";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ slug: string; characterId: string }> }) {
  const { slug, characterId } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const character = (project.characters || []).find((item) => item.id === characterId);
  if (!character?.referenceImagePath) return NextResponse.json({ message: "Không tìm thấy ảnh tham chiếu." }, { status: 404 });

  const safeSlug = project.slug.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "project";
  const projectMediaRoot = path.resolve(process.cwd(), "data", "media", safeSlug, "characters");
  const resolvedPath = path.resolve(process.cwd(), character.referenceImagePath);
  if (!resolvedPath.startsWith(`${projectMediaRoot}${path.sep}`)) {
    return NextResponse.json({ message: "Ảnh tham chiếu không thuộc project này." }, { status: 403 });
  }
  try {
    const image = await readFile(resolvedPath);
    return new NextResponse(image, {
      headers: {
        "Content-Type": character.referenceImageMimeType || "application/octet-stream",
        "Content-Length": String(image.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ message: "Không đọc được ảnh tham chiếu." }, { status: 404 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string; characterId: string }> }) {
  const { slug, characterId } = await context.params;
  const body = await request.json().catch(() => ({})) as { mediaGeneration?: Partial<MediaGenerationSettings> };
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  const character = project?.characters?.find((item) => item.id === characterId);
  if (!project || !character) return NextResponse.json({ message: "Không tìm thấy hồ sơ nhân vật." }, { status: 404 });
  const prompt = character.imagePrompt?.trim() || character.description.trim();
  if (!prompt) return NextResponse.json({ message: "Nhân vật cần có prompt tạo ảnh." }, { status: 400 });
  try {
    const mediaGeneration = resolveMediaGenerationSettings({ ...project.mediaGeneration, ...body.mediaGeneration });
    const image = await generateMaiVideoProfileImage({ projectSlug: slug, profileKind: "characters", profileId: characterId, prompt, mediaGeneration, contentGenre: project.contentGenre, secondaryGenres: project.secondaryGenres, storySetting: project.storySetting, settingNotes: project.settingNotes, visualStyle: project.visualStyle, imageStyle: project.imageStyle });
    const updated = await updateData((current) => {
      const profile = current.projects.find((item) => item.slug === slug)?.characters?.find((item) => item.id === characterId);
      if (!profile) throw new Error("CHARACTER_NOT_FOUND");
      profile.referenceImagePath = image.localPath || "";
      profile.referenceImageName = `${profile.name}-ai.png`;
      profile.referenceImageMimeType = "image/png";
      profile.updatedAt = now();
      return profile;
    });
    return NextResponse.json({ ok: true, character: updated });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "Không thể tạo ảnh nhân vật.";
    const needsApiKey = code === "MAIVIDEO_IMAGE_API_KEY_REQUIRED" || code === "MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED";
    const message = code === "MAIVIDEO_IMAGE_API_KEY_REQUIRED"
      ? "Hãy thêm API key tạo ảnh MaiVideo trong Cài đặt."
      : code === "MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED"
        ? "Máy chủ chưa cấu hình khóa mã hóa API key MaiVideo."
        : code;
    return NextResponse.json({ code, message }, { status: needsApiKey ? 503 : 502 });
  }
}

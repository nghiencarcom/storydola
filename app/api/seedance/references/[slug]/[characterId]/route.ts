import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { verifySeedanceCharacterReferenceSignature, type SeedanceReferenceType } from "../../../../../lib/seedance-reference-links";
import { readProjectScenes, sceneReferenceImageLocalPath } from "../../../../../lib/scene-store";
import { readDataForUser } from "../../../../../lib/server-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ slug: string; characterId: string }> }) {
  const { slug, characterId: referenceId } = await context.params;
  const url = new URL(request.url);
  const ownerId = url.searchParams.get("owner") || "";
  const requestedType = url.searchParams.get("type") || "character";
  const type: SeedanceReferenceType = ["character", "scene", "location"].includes(requestedType) ? requestedType as SeedanceReferenceType : "character";
  let validSignature = false;
  try {
    validSignature = verifySeedanceCharacterReferenceSignature(slug, referenceId, ownerId, url.searchParams.get("expires") || "", url.searchParams.get("signature") || "", type);
  } catch {
    validSignature = false;
  }
  if (!validSignature) {
    return NextResponse.json({ message: "Liên kết ảnh tham chiếu đã hết hạn hoặc không hợp lệ." }, { status: 403 });
  }

  const data = await readDataForUser(ownerId);
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy ảnh tham chiếu." }, { status: 404 });

  const safeSlug = project.slug.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "project";
  let imagePath = "";
  let contentType = "";
  if (type === "character") {
    const character = project.characters?.find((item) => item.id === referenceId);
    if (!character?.referenceImagePath) return NextResponse.json({ message: "Không tìm thấy ảnh tham chiếu." }, { status: 404 });
    imagePath = path.resolve(process.cwd(), character.referenceImagePath);
    contentType = character.referenceImageMimeType;
    const mediaRoot = path.resolve(process.cwd(), "data", "media", safeSlug, "characters");
    if (!imagePath.startsWith(`${mediaRoot}${path.sep}`)) return NextResponse.json({ message: "Ảnh tham chiếu không thuộc project này." }, { status: 403 });
  } else if (type === "location") {
    const location = project.locations?.find((item) => item.id === referenceId);
    if (!location?.referenceImagePath) return NextResponse.json({ message: "Không tìm thấy ảnh bối cảnh." }, { status: 404 });
    imagePath = path.resolve(process.cwd(), location.referenceImagePath);
    contentType = location.referenceImageMimeType;
    const mediaRoot = path.resolve(process.cwd(), "data", "media", safeSlug, "locations");
    if (!imagePath.startsWith(`${mediaRoot}${path.sep}`)) return NextResponse.json({ message: "Ảnh bối cảnh không thuộc project này." }, { status: 403 });
  } else {
    const scene = (await readProjectScenes(project)).find((item) => item.id === referenceId);
    if (!scene) return NextResponse.json({ message: "Không tìm thấy cảnh tham chiếu." }, { status: 404 });
    const localPath = sceneReferenceImageLocalPath(scene);
    if (!localPath) return NextResponse.json({ message: "Cảnh chưa có ảnh cảnh." }, { status: 404 });
    imagePath = path.resolve(process.cwd(), localPath);
    const mediaRoot = path.resolve(process.cwd(), "data", "media", safeSlug);
    if (!imagePath.startsWith(`${mediaRoot}${path.sep}`)) return NextResponse.json({ message: "Ảnh cảnh không thuộc project này." }, { status: 403 });
    if (!contentType) {
      const extension = path.extname(imagePath).toLowerCase();
      contentType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : [".jpg", ".jpeg"].includes(extension) ? "image/jpeg" : "";
    }
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(imagePath);
  } catch {
    return NextResponse.json({ message: "Không đọc được ảnh tham chiếu." }, { status: 404 });
  }
  if (!contentType || !["image/png", "image/jpeg", "image/webp"].includes(contentType)) {
    return NextResponse.json({ message: "Ảnh tham chiếu không đúng định dạng." }, { status: 415 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

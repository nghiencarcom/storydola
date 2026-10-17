import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { readData } from "../../../../../lib/server-store";

export const runtime = "nodejs";

const MAX_LOGO_BYTES = 10 * 1024 * 1024;
const ALLOWED_LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const data = await readData();
  if (!data.projects.some((project) => project.slug === slug)) {
    return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ message: "Hãy chọn một file logo." }, { status: 400 });
  }

  const mimeType = file.type.toLowerCase();
  const extension = ALLOWED_LOGO_TYPES[mimeType];
  if (!extension) {
    return NextResponse.json({ message: "Logo chỉ hỗ trợ PNG, JPG hoặc WebP." }, { status: 415 });
  }
  if (file.size <= 0 || file.size > MAX_LOGO_BYTES) {
    return NextResponse.json({ message: "File logo phải lớn hơn 0 và tối đa 10 MB." }, { status: 413 });
  }

  const safeSlug = slug.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "project";
  const relativePath = path.join("data", "uploads", safeSlug, `logo-${Date.now()}.${extension}`);
  const absolutePath = path.join(process.cwd(), relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({
    ok: true,
    path: relativePath,
    name: file.name,
    size: file.size,
    mimeType,
  });
}

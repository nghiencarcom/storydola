import { NextResponse } from "next/server";
import { downloadMaiVideoLibraryImage, MaiVideoLibraryError } from "../../../lib/maivideo-media-library";
import { saveTimelapseImage, safeTimelapseId, validateTimelapseImage } from "../../../lib/timelapse-storage";
import { readMaiVideoAuthCookie, resolveMaiVideoAuthBaseUrl } from "../../../lib/maivideo-auth-shared";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const userId = request.headers.get("x-storyai-user-id")?.trim() || "";
  if (!userId) return NextResponse.json({ message: "Vui lòng đăng nhập để tải ảnh lên." }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const workflowId = safeTimelapseId(String(form?.get("workflowId") || ""));
  const imageId = safeTimelapseId(String(form?.get("imageId") || ""));
  if (!workflowId || !imageId) return NextResponse.json({ message: "Mã workflow hoặc ảnh không hợp lệ." }, { status: 400 });

  const file = form?.get("file");
  const libraryId = String(form?.get("libraryId") || "").trim();
  let bytes: Buffer;
  let name = "Ảnh Timelapse";
  try {
    if (file instanceof File) {
      if (file.size < 1 || file.size > 8 * 1024 * 1024) return NextResponse.json({ message: "Mỗi ảnh cần nhỏ hơn 8 MB." }, { status: 413 });
      bytes = Buffer.from(await file.arrayBuffer());
      name = file.name.trim().slice(0, 180) || name;
    } else if (libraryId) {
      const downloaded = await downloadMaiVideoLibraryImage(libraryId, { token: readMaiVideoAuthCookie(request.headers.get("cookie")), baseUrl: resolveMaiVideoAuthBaseUrl(request) });
      bytes = downloaded.bytes;
      name = downloaded.image.name;
    } else {
      return NextResponse.json({ message: "Chọn ảnh cần tải lên hoặc chọn ảnh từ Media Library." }, { status: 400 });
    }
    if (!validateTimelapseImage(bytes)) return NextResponse.json({ message: "Chỉ hỗ trợ ảnh PNG, JPG hoặc WebP." }, { status: 415 });
    await saveTimelapseImage(userId, workflowId, imageId, bytes);
    return NextResponse.json({ ok: true, image: { id: imageId, name, url: `/api/timelapse/images/${encodeURIComponent(workflowId)}/${encodeURIComponent(imageId)}` } });
  } catch (cause) {
    const error = cause instanceof MaiVideoLibraryError ? cause : undefined;
    return NextResponse.json({ message: error?.message || (cause instanceof Error ? cause.message : "Không thể lưu ảnh Timelapse.") }, { status: error?.status || 500 });
  }
}

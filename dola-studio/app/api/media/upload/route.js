import { NextResponse } from "next/server";
import { maivideoEndpoint, maivideoHeaders } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 30;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MEDIA_UPLOAD_TIMEOUT_MS = 120_000;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp", ".tif", ".tiff"]);

function isImageFile(file) {
  if (file?.type?.toLowerCase().startsWith("image/")) return true;
  const name = String(file?.name || "").toLowerCase();
  const extension = name.slice(name.lastIndexOf("."));
  return IMAGE_EXTENSIONS.has(extension);
}

function isUploadFile(value) {
  return Boolean(value && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.name === "string");
}

function payloadMessage(payload, status) {
  if (payload && typeof payload === "object") {
    if (typeof payload.detail === "string") return payload.detail;
    if (typeof payload.error === "string") return payload.error;
    if (typeof payload.message === "string") return payload.message;
  }
  return "MaiVideo trả về HTTP " + status;
}

function rememberAuthToken(response, request) {
  const token = request.headers.get("x-maivideo-auth-token")?.trim();
  if (!token) return response;
  response.cookies.set("dola-maivideo-auth", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });
  return response;
}

export async function POST(request) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Dữ liệu upload không hợp lệ" }, { status: 400 });
  }

  const uploads = [];
  const seen = new Set();
  for (const value of formData.getAll("files")) {
    if (!isUploadFile(value) || seen.has(value)) continue;
    seen.add(value);
    uploads.push(value);
  }
  const singleFile = formData.get("file");
  if (isUploadFile(singleFile) && !seen.has(singleFile)) uploads.push(singleFile);

  if (!uploads.length) {
    return NextResponse.json({ error: "Hãy chọn ít nhất một file ảnh" }, { status: 400 });
  }
  if (uploads.length > MAX_FILES) {
    return NextResponse.json({ error: "Mỗi lần chỉ được thêm tối đa 30 ảnh" }, { status: 422 });
  }

  const invalidFiles = uploads.filter((file) => !isImageFile(file));
  if (invalidFiles.length) {
    return NextResponse.json(
      { error: "Chỉ chấp nhận file ảnh: " + invalidFiles.slice(0, 3).map((file) => file.name || "(không tên)").join(", ") },
      { status: 422 }
    );
  }
  const oversizedFile = uploads.find((file) => Number(file.size || 0) > MAX_FILE_BYTES);
  if (oversizedFile) {
    return NextResponse.json({ error: "Mỗi ảnh tối đa 25 MB: " + (oversizedFile.name || "file ảnh") }, { status: 422 });
  }

  const upstreamFormData = new FormData();
  uploads.forEach((file) => upstreamFormData.append("files", file, file.name || "reference-image.png"));
  try {
    const response = await fetch(maivideoEndpoint("/api/video-library/upload"), {
      method: "POST",
      cache: "no-store",
      headers: maivideoHeaders(request),
      body: upstreamFormData,
      signal: AbortSignal.timeout(MEDIA_UPLOAD_TIMEOUT_MS)
    });
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { detail: raw.slice(0, 300) };
    }
    if (!response.ok) {
      return NextResponse.json({ error: payloadMessage(payload, response.status) }, { status: response.status });
    }

    const upstreamItems = Array.isArray(payload.items)
      ? payload.items
      : payload.item
        ? [payload.item]
        : [];
    const items = upstreamItems.map((item, index) => {
      if (!item || typeof item !== "object") return item;
      const { file_path: _filePath, ...safeItem } = item;
      const originalFileName = String(uploads[index]?.name || "").trim();
      return originalFileName
        ? { ...safeItem, original_file_name: originalFileName }
        : safeItem;
    });
    const result = NextResponse.json(
      {
        success: true,
        item: items[0] || null,
        items,
        uploaded_count: Number(payload.uploaded_count || items.length),
        errors: Array.isArray(payload.errors) ? payload.errors : []
      },
      { headers: { "Cache-Control": "no-store" } }
    );
    return rememberAuthToken(result, request);
  } catch (error) {
    return NextResponse.json(
      { error: error?.name === "TimeoutError"
        ? "MaiVideo tải ảnh quá lâu (đã chờ 120 giây)"
        : "Không kết nối được MaiVideo API tại MAIVIDEO_PUBLIC_URL" },
      { status: 503 }
    );
  }
}

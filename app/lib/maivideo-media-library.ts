import { Buffer } from "node:buffer";

export type MaiVideoLibraryImage = {
  id: string;
  name: string;
  fileName: string;
  previewUrl: string;
  fileUrl: string;
  source: string;
};

type CachedMaiVideoLibraryImage = MaiVideoLibraryImage & { previewSource: string };

type JsonRecord = Record<string, unknown>;

export class MaiVideoLibraryError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "MaiVideoLibraryError";
    this.status = status;
  }
}

let cachedImages: { expiresAt: number; items: CachedMaiVideoLibraryImage[] } | undefined;
let libraryRequest: Promise<CachedMaiVideoLibraryImage[]> | undefined;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function baseUrl() {
  return (process.env.MAIVIDEO_BASE_URL || process.env.MAIVIDEO_API_BASE_URL || "https://maivideo.top").trim().replace(/\/+$/, "");
}

function sessionHeaders() {
  const token = process.env.MAIVIDEO_SESSION_TOKEN?.trim();
  if (!token) throw new MaiVideoLibraryError("Chưa cấu hình phiên đăng nhập thư viện MaiVideo.", 503);
  const headers: Record<string, string> = { "X-Auth-Token": token, Authorization: `Bearer ${token}` };
  const sessionId = process.env.MAIVIDEO_SESSION_ID?.trim();
  if (sessionId) headers["X-Session-ID"] = sessionId;
  return headers;
}

function imageExtension(value: string) {
  const match = value.toLowerCase().match(/\.(png|jpe?g|webp)(?:[?#].*)?$/);
  return match?.[1] || "";
}

function isImage(item: JsonRecord) {
  const mime = String(item.mime_type || item.mimeType || item.content_type || item.contentType || "").toLowerCase();
  const fileName = String(item.file_name || item.filename || item.name || item.relative_path || item.file_url || "");
  return ["image/png", "image/jpeg", "image/webp"].includes(mime) || Boolean(imageExtension(fileName));
}

function supportedImageMime(bytes: Buffer) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return undefined;
}

function resolvedMaiVideoUrl(value: string) {
  const url = new URL(value, baseUrl());
  const base = new URL(baseUrl());
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new MaiVideoLibraryError("MaiVideo trả về đường dẫn ảnh không hợp lệ.");
  if (url.origin !== base.origin) throw new MaiVideoLibraryError("Ảnh thư viện không nằm trên máy chủ MaiVideo đã cấu hình.");
  if (url.pathname.includes("/static/") && process.env.MAIVIDEO_SESSION_ID?.trim() && !url.searchParams.has("session_id")) {
    url.searchParams.set("session_id", process.env.MAIVIDEO_SESSION_ID.trim());
  }
  return url;
}

function normalizeImage(item: JsonRecord): CachedMaiVideoLibraryImage | undefined {
  if (!isImage(item)) return undefined;
  const fileUrl = String(item.file_url || item.url || item.relative_path || item.file_name || "").trim();
  if (!fileUrl) return undefined;
  const id = String(item.id || item.file_path || item.relative_path || item.file_url || item.file_name || "").trim();
  if (!id) return undefined;
  const fileName = String(item.file_name || item.filename || item.name || id.split("/").pop() || "MaiVideo image").slice(0, 180);
  const previewSource = String(item.thumbnail || item.thumbnail_url || item.thumbnailUrl || fileUrl).trim();
  return {
    id,
    name: String(item.title || item.name || fileName).slice(0, 160),
    fileName,
    previewUrl: `/api/maivideo/media-library/preview?id=${encodeURIComponent(id)}`,
    fileUrl,
    source: String(item.source || "uploads").slice(0, 80),
    previewSource,
  };
}

async function fetchLibraryImages() {
  let headers: Record<string, string>;
  try {
    headers = sessionHeaders();
  } catch (error) {
    throw error;
  }
  const response = await fetch(`${baseUrl()}/api/video-library?sources=${encodeURIComponent("uploads,downloads")}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = asRecord(await response.json().catch(() => ({})));
  if (response.status === 401 || response.status === 403) {
    throw new MaiVideoLibraryError("Phiên MaiVideo đã hết hạn hoặc không có quyền đọc thư viện media.", 401);
  }
  if (!response.ok || payload.success !== true) {
    throw new MaiVideoLibraryError(String(payload.detail || payload.message || "Không tải được thư viện media MaiVideo."), response.status || 502);
  }
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  return rawItems.map((value) => normalizeImage(asRecord(value))).filter((value): value is CachedMaiVideoLibraryImage => Boolean(value));
}

export async function listMaiVideoLibraryImages({ force = false } = {}) {
  if (!force && cachedImages && cachedImages.expiresAt > Date.now()) return cachedImages.items.map(({ previewSource: _previewSource, ...item }) => item);
  if (libraryRequest) {
    const items = await libraryRequest;
    return items.map(({ previewSource: _previewSource, ...item }) => item);
  }
  libraryRequest = fetchLibraryImages();
  try {
    const items = await libraryRequest;
    cachedImages = { expiresAt: Date.now() + 30_000, items };
    return items.map(({ previewSource: _previewSource, ...item }) => item);
  } finally {
    libraryRequest = undefined;
  }
}

export async function findMaiVideoLibraryImage(id: string) {
  if (!cachedImages || cachedImages.expiresAt <= Date.now()) await listMaiVideoLibraryImages();
  const images = cachedImages?.items || [];
  const image = images.find((item) => item.id === id);
  if (!image) throw new MaiVideoLibraryError("Không tìm thấy ảnh trong thư viện MaiVideo.", 404);
  return image;
}

export async function downloadMaiVideoLibraryImage(id: string) {
  const image = await findMaiVideoLibraryImage(id);
  const url = resolvedMaiVideoUrl(image.fileUrl);
  const response = await fetch(url, { headers: sessionHeaders(), cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new MaiVideoLibraryError("Không tải được ảnh đã chọn từ MaiVideo.", response.status === 401 ? 401 : 502);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length <= 0 || bytes.length > 8 * 1024 * 1024) throw new MaiVideoLibraryError("Ảnh MaiVideo phải nhỏ hơn 8 MB.", 413);
  if (!supportedImageMime(bytes)) throw new MaiVideoLibraryError("Media đã chọn không phải ảnh PNG, JPG hoặc WebP.", 415);
  return { image, bytes };
}

export async function fetchMaiVideoLibraryPreview(id: string) {
  const image = await findMaiVideoLibraryImage(id);
  const url = resolvedMaiVideoUrl(image.previewSource || image.fileUrl);
  const response = await fetch(url, { headers: sessionHeaders(), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new MaiVideoLibraryError("Không tải được ảnh xem trước từ MaiVideo.", response.status === 401 ? 401 : 502);
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = supportedImageMime(bytes);
  if (!contentType || bytes.length > 8 * 1024 * 1024) {
    throw new MaiVideoLibraryError("Ảnh xem trước MaiVideo không hợp lệ.", 415);
  }
  return { bytes, contentType };
}

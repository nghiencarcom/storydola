import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

export type MaiVideoLibraryImage = {
  id: string;
  name: string;
  fileName: string;
  previewUrl: string;
  fileUrl: string;
  source: string;
};

type CachedMaiVideoLibraryImage = MaiVideoLibraryImage & { previewSource: string };
export type MaiVideoLibrarySession = { token: string; baseUrl?: string };
type LibraryContext = { key: string; baseUrl: string; headers: Record<string, string>; sessionId: string };

type JsonRecord = Record<string, unknown>;

export class MaiVideoLibraryError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "MaiVideoLibraryError";
    this.status = status;
  }
}

const cachedImages = new Map<string, { expiresAt: number; items: CachedMaiVideoLibraryImage[] }>();
const libraryRequests = new Map<string, Promise<CachedMaiVideoLibraryImage[]>>();

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function libraryContext(session?: MaiVideoLibrarySession): LibraryContext {
  const usesUserSession = session !== undefined;
  const token = usesUserSession ? session.token.trim() : process.env.MAIVIDEO_SESSION_TOKEN?.trim() || "";
  if (!token) throw new MaiVideoLibraryError("Phiên MaiVideo chưa đăng nhập hoặc đã hết hạn. Hãy đăng nhập lại rồi thử lại.", 401);
  const base = (session?.baseUrl || process.env.MAIVIDEO_BASE_URL || process.env.MAIVIDEO_API_BASE_URL || "https://maivideo.top").trim().replace(/\/+$/, "");
  const sessionId = usesUserSession ? "" : process.env.MAIVIDEO_SESSION_ID?.trim() || "";
  const headers: Record<string, string> = { "X-Auth-Token": token, Authorization: `Bearer ${token}` };
  if (sessionId) headers["X-Session-ID"] = sessionId;
  return { key: createHash("sha256").update(`${base}\n${token}`).digest("hex"), baseUrl: base, headers, sessionId };
}

function imageExtension(value: string) {
  const match = value.toLowerCase().match(/\.(png|jpe?g|webp|avif)(?:[?#].*)?$/);
  return match?.[1] || "";
}

function isImage(item: JsonRecord) {
  const mime = String(item.mime_type || item.mimeType || item.content_type || item.contentType || "").toLowerCase();
  const fileName = String(item.file_name || item.filename || item.name || item.relative_path || item.file_url || "");
  return ["image/png", "image/jpeg", "image/webp", "image/avif"].includes(mime) || Boolean(imageExtension(fileName));
}

function supportedImageMime(bytes: Buffer) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp" && ["avif", "avis"].includes(bytes.toString("ascii", 8, 12))) return "image/avif";
  return undefined;
}

function resolvedMaiVideoUrl(value: string, context: LibraryContext, { asStaticFile = false, thumbnail = false }: { asStaticFile?: boolean; thumbnail?: boolean } = {}) {
  const url = new URL(value, context.baseUrl);
  const base = new URL(context.baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new MaiVideoLibraryError("MaiVideo trả về đường dẫn ảnh không hợp lệ.");
  if (asStaticFile && !url.pathname.startsWith("/static/")) {
    if (url.origin !== base.origin) throw new MaiVideoLibraryError("Ảnh thư viện không nằm trên máy chủ MaiVideo đã cấu hình.");
    const relativePath = url.pathname.replace(/^\/+/, "").replace(/^static\//, "");
    url.pathname = `/static/${relativePath}`;
  }
  if (url.origin !== base.origin) throw new MaiVideoLibraryError("Ảnh thư viện không nằm trên máy chủ MaiVideo đã cấu hình.");
  if (thumbnail && url.pathname.startsWith("/static/") && !url.searchParams.has("thumb")) {
    url.searchParams.set("thumb", "1");
  }
  if (url.pathname.includes("/static/") && context.sessionId && !url.searchParams.has("session_id")) {
    url.searchParams.set("session_id", context.sessionId);
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

async function fetchLibraryImages(context: LibraryContext) {
  const response = await fetch(`${context.baseUrl}/api/video-library?sources=${encodeURIComponent("uploads,downloads")}`, {
    headers: context.headers,
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

export async function listMaiVideoLibraryImages({ force = false, session }: { force?: boolean; session?: MaiVideoLibrarySession } = {}) {
  const context = libraryContext(session);
  const cached = cachedImages.get(context.key);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.items.map(({ previewSource: _previewSource, ...item }) => item);
  const activeRequest = libraryRequests.get(context.key);
  if (activeRequest) {
    const items = await activeRequest;
    return items.map(({ previewSource: _previewSource, ...item }) => item);
  }
  const request = fetchLibraryImages(context);
  libraryRequests.set(context.key, request);
  try {
    const items = await request;
    cachedImages.set(context.key, { expiresAt: Date.now() + 30_000, items });
    return items.map(({ previewSource: _previewSource, ...item }) => item);
  } finally {
    libraryRequests.delete(context.key);
  }
}

export async function findMaiVideoLibraryImage(id: string, session?: MaiVideoLibrarySession) {
  const context = libraryContext(session);
  const cached = cachedImages.get(context.key);
  if (!cached || cached.expiresAt <= Date.now()) await listMaiVideoLibraryImages({ session });
  const images = cachedImages.get(context.key)?.items || [];
  const image = images.find((item) => item.id === id);
  if (!image) throw new MaiVideoLibraryError("Không tìm thấy ảnh trong thư viện MaiVideo.", 404);
  return image;
}

export async function downloadMaiVideoLibraryImage(id: string, session?: MaiVideoLibrarySession) {
  const context = libraryContext(session);
  const image = await findMaiVideoLibraryImage(id, session);
  const url = resolvedMaiVideoUrl(image.fileUrl, context, { asStaticFile: true });
  const response = await fetch(url, {
    headers: { ...context.headers, Accept: "image/png,image/jpeg,image/webp,image/avif,*/*;q=0.1" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new MaiVideoLibraryError("Không tải được ảnh đã chọn từ MaiVideo.", response.status === 401 ? 401 : 502);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length <= 0 || bytes.length > 8 * 1024 * 1024) throw new MaiVideoLibraryError("Ảnh MaiVideo phải nhỏ hơn 8 MB.", 413);
  if (!supportedImageMime(bytes)) throw new MaiVideoLibraryError("Media đã chọn không phải ảnh PNG, JPG, WebP hoặc AVIF.", 415);
  return { image, bytes };
}

export async function fetchMaiVideoLibraryPreview(id: string, session?: MaiVideoLibrarySession) {
  const context = libraryContext(session);
  const image = await findMaiVideoLibraryImage(id, session);
  const sources = [
    { value: image.previewSource, thumbnail: true },
    { value: image.fileUrl, thumbnail: false },
  ].filter((source, index, items) => source.value.trim() && items.findIndex((candidate) => candidate.value === source.value && candidate.thumbnail === source.thumbnail) === index);
  let lastError: MaiVideoLibraryError | undefined;
  for (const source of sources) {
    try {
      const asStaticFile = source.value === image.fileUrl
        || !/^https?:\/\//i.test(source.value)
        || new URL(source.value).pathname.startsWith("/static/");
      const url = resolvedMaiVideoUrl(source.value, context, { asStaticFile, thumbnail: source.thumbnail });
      const response = await fetch(url, {
        headers: { ...context.headers, Accept: "image/png,image/jpeg,image/webp,image/avif,*/*;q=0.1" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        lastError = new MaiVideoLibraryError("Không tải được ảnh xem trước từ MaiVideo.", response.status === 401 ? 401 : 502);
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentType = supportedImageMime(bytes);
      if (!contentType || bytes.length > 8 * 1024 * 1024) {
        lastError = new MaiVideoLibraryError("Ảnh xem trước MaiVideo không hợp lệ.", 415);
        continue;
      }
      return { bytes, contentType };
    } catch (cause) {
      lastError = cause instanceof MaiVideoLibraryError
        ? cause
        : new MaiVideoLibraryError("Không tải được ảnh xem trước từ MaiVideo.");
    }
  }
  throw lastError || new MaiVideoLibraryError("Không tìm thấy ảnh xem trước trong thư viện MaiVideo.", 404);
}

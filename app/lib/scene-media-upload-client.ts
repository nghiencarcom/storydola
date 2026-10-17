import { SCENE_MEDIA_UPLOAD_CHUNK_BYTES } from "./scene-media-upload-config";

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

type UploadPayload = Record<string, unknown>;
type UploadProgress = { stage: "uploading" | "assembling"; uploadedBytes: number; totalBytes: number; chunkIndex: number; chunkCount: number };

async function readResponse(response: Response): Promise<UploadPayload> {
  const body = await response.text();
  let payload: UploadPayload = {};
  try {
    payload = body ? JSON.parse(body) as UploadPayload : {};
  } catch {
    // Cloudflare and reverse proxies may send a plain text error body.
  }
  if (response.ok && payload.ok) return payload;
  const message = String(payload.message || payload.error || body || response.statusText || `HTTP ${response.status}`).slice(0, 400);
  const error = new Error(response.status === 413
    ? "File vượt giới hạn upload của máy chủ. Hãy thử video nhỏ hơn."
    : message) as Error & { status?: number; retryable?: boolean };
  error.status = response.status;
  error.retryable = RETRYABLE_STATUSES.has(response.status);
  throw error;
}

async function fetchWithRetry(url: string, init: RequestInit, retries = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await readResponse(await fetch(url, init));
    } catch (cause) {
      const error: Error & { retryable?: boolean } = cause instanceof Error
        ? cause as Error & { retryable?: boolean }
        : new Error("Upload thất bại.");
      const retryable = error.retryable !== false;
      if (!retryable || attempt === retries) throw error;
      lastError = error;
      await wait(700 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Không thể upload file.");
}

export function shouldChunkSceneMediaFile(file: Pick<File, "size">) {
  return file.size >= SCENE_MEDIA_UPLOAD_CHUNK_BYTES;
}

export async function uploadSceneMediaInChunks({
  endpoint,
  file,
  onProgress,
}: {
  endpoint: string;
  file: File;
  onProgress?: (progress: UploadProgress) => void;
}) {
  let uploadId = "";
  let completionRequested = false;

  try {
    const initialized = await fetchWithRetry(endpoint + "?action=init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, fileSize: file.size, contentType: file.type || "application/octet-stream" }),
    });
    uploadId = String(initialized.uploadId || "");
    const chunkSize = Number(initialized.chunkSize);
    const chunkCount = Number(initialized.chunkCount);
    if (!uploadId || !Number.isSafeInteger(chunkSize) || chunkSize <= 0 || !Number.isSafeInteger(chunkCount) || chunkCount <= 0) {
      throw new Error("Máy chủ không trả về thông tin chia phần upload hợp lệ.");
    }
    if (Number(initialized.fileSize) !== file.size || chunkCount !== Math.ceil(file.size / chunkSize) || chunkSize > SCENE_MEDIA_UPLOAD_CHUNK_BYTES) {
      throw new Error("Thông tin chia phần upload không khớp với file.");
    }

    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end, "application/octet-stream");
      const params = new URLSearchParams({ action: "chunk", uploadId, index: String(index) });
      await fetchWithRetry(`${endpoint}?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: chunk,
      });
      onProgress?.({ stage: "uploading", uploadedBytes: end, totalBytes: file.size, chunkIndex: index + 1, chunkCount });
    }

    completionRequested = true;
    onProgress?.({ stage: "assembling", uploadedBytes: file.size, totalBytes: file.size, chunkIndex: chunkCount, chunkCount });
    return await fetchWithRetry(endpoint + "?action=complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId }),
    });
  } catch (cause) {
    if (uploadId && !completionRequested) {
      try {
        await fetch(`${endpoint}?uploadId=${encodeURIComponent(uploadId)}`, { method: "DELETE" });
      } catch {
        // Abandoned sessions are removed after the server-side TTL.
      }
    }
    throw cause;
  }
}

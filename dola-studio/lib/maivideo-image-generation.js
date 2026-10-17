import {
  appConfig,
  maivideoApiHeaders,
  maivideoEndpoint,
  maivideoPublicEndpoint
} from "@/lib/config";

const MAX_REFERENCE_URL_LENGTH = 4096;
const MAX_REFERENCE_IMAGES = 30;
const IMAGE_POLL_INTERVAL_MS = 5000;
const IMAGE_REQUEST_TIMEOUT_MS = 30000;
// Shared deadline for the complete reference-image preparation stage.
// Individual HTTP requests stay bounded; queued/running jobs are polled.
const IMAGE_GENERATION_TIMEOUT_MS = 30 * 60 * 1000;
const ALLOWED_IMAGE_MODELS = new Set(["gemini-3.0", "gemini-3.1-flash"]);
const TERMINAL_STATUSES = new Set(["completed", "done", "partial", "error", "failed", "refunded"]);
const SUCCESS_STATUSES = new Set(["completed", "done"]);
const SESSION_ID_PATTERN = /^(?:user|public|sess)_[A-Za-z0-9_-]{1,96}$/;

export const PENCIL_SKETCH_PROMPT = [
  "Edit the supplied reference image in place with a selective regional edit, not a full-image grayscale conversion.",
  "Convert only the recognizable human character or characters into faithful black-and-white graphite pencil drawing: preserve their identity, facial features, skin, hair, body proportions, pose, clothing silhouette, and exact placement.",
  "Keep every non-character element exactly as it appears in the original image, including products, packaging, props, logos, readable text, furniture, architecture, landscape, lighting, materials, textures, and all of their original colors.",
  "Do not desaturate, redraw, recolor, crop, replace, blur, or move any product, prop, or background. Preserve the original composition, camera angle, framing, and product shape and placement.",
  "If no recognizable human character is present, return the reference image unchanged. No new objects, no invented text, no extra logo, and no watermark."
].join(" ");

export class MaiVideoImageGenerationError extends Error {
  constructor(message, status = 502, code = "MAIVIDEO_IMAGE_GENERATION_FAILED") {
    super(message);
    this.name = "MaiVideoImageGenerationError";
    this.status = status;
    this.code = code;
  }
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function normalizeSessionId(value) {
  const normalized = String(value || "").trim();
  return normalized === "global" || SESSION_ID_PATTERN.test(normalized) ? normalized : "";
}

function normalizeReferenceUrls(values) {
  const source = Array.isArray(values) ? values : [];
  const normalized = [];
  const seen = new Set();
  for (const value of source) {
    const url = String(value || "").trim();
    if (!url || !isHttpUrl(url) || url.length > MAX_REFERENCE_URL_LENGTH || seen.has(url)) continue;
    normalized.push(url);
    seen.add(url);
  }
  return normalized.slice(0, MAX_REFERENCE_IMAGES);
}

function publicMaiVideoReferenceUrl(value) {
  const raw = String(value || "").trim();
  if (!isHttpUrl(raw)) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.pathname !== "/api/media/files") return raw;
    const source = parsed.searchParams.get("source") || "";
    const relativePath = (parsed.searchParams.get("path") || parsed.searchParams.get("relative_path") || "")
      .replaceAll("\\", "/");
    const sessionId = parsed.searchParams.get("session_id") || "";
    const segments = relativePath.split("/").filter(Boolean);
    if (!new Set(["uploads", "downloads", "exports"]).has(source)
      || !segments.length
      || segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))) {
      return raw;
    }
    const direct = new URL(
      "/static/" + source + "/" + segments.map(encodeURIComponent).join("/"),
      maivideoPublicEndpoint("/")
    );
    if (sessionId) direct.searchParams.set("session_id", sessionId);
    return direct.toString();
  } catch {
    return raw;
  }
}

function parsePayload(raw) {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { detail: raw.slice(0, 300) };
  }
}

function payloadMessage(payload, fallback) {
  if (payload && typeof payload === "object") {
    for (const key of ["detail", "error", "message", "ErrMsg"]) {
      if (typeof payload[key] === "string" && payload[key].trim()) return payload[key].trim();
    }
  }
  return fallback;
}

function requestHeaders(request, includeJson = false) {
  return maivideoApiHeaders(request, includeJson);
}

function imageUrlFromResult(result, sessionId = "") {
  if (!result || typeof result !== "object") return "";
  const raw = String(result.file_url || result.image_url || result.url || result.src || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, maivideoPublicEndpoint("/"));
    const safeSessionId = normalizeSessionId(sessionId);
    if (!/^https?:\/\//i.test(raw)) {
      if (safeSessionId && parsed.pathname.startsWith("/static/")) {
        parsed.searchParams.set("session_id", safeSessionId);
      }
      return parsed.toString();
    }

    // Keep provider/storage URLs intact. Only replace a loopback origin if a
    // local MaiVideo response accidentally returns one instead of its normal
    // relative /static/... path.
    const isLoopback = parsed.hostname === "localhost"
      || parsed.hostname === "127.0.0.1"
      || parsed.hostname === "::1";
    const publicHostname = new URL(maivideoPublicEndpoint("/")).hostname;
    if (!isLoopback) {
      if (safeSessionId && parsed.hostname === publicHostname && parsed.pathname.startsWith("/static/")) {
        parsed.searchParams.set("session_id", safeSessionId);
      }
      return parsed.toString();
    }
    const publicUrl = new URL(maivideoPublicEndpoint(parsed.pathname));
    publicUrl.search = parsed.search;
    if (safeSessionId && publicUrl.pathname.startsWith("/static/")) {
      publicUrl.searchParams.set("session_id", safeSessionId);
    }
    return publicUrl.toString();
  } catch {
    return "";
  }
}

function completedImageResults(payload) {
  const directImages = Array.isArray(payload?.images) ? payload.images : [];
  const jobItems = Array.isArray(payload?.job?.items) ? payload.job.items : [];
  const itemResults = jobItems
    .filter((item) => item?.status === "done" || item?.status === "completed")
    .map((item) => item.result)
    .filter(Boolean);
  return [...directImages, ...itemResults];
}

function completedImageResult(payload, sessionId) {
  for (const result of completedImageResults(payload)) {
    const url = imageUrlFromResult(result, sessionId);
    if (url) return { result, url };
  }
  return null;
}

function assertExpectedImageModel(payload, result) {
  const jobItems = Array.isArray(payload?.job?.items) ? payload.job.items : [];
  const completedItem = jobItems.find((item) =>
    item?.status === "done" || item?.status === "completed"
  );
  const actualModel = String(
    result?.model
      || completedItem?.result?.model
      || completedItem?.model
      || ""
  ).trim();
  const requestedModel = appConfig.maivideoImageModel;

  if (!actualModel) {
    throw new MaiVideoImageGenerationError(
      "MaiVideo không trả về model thực tế trong kết quả ảnh; Dola không thể xác minh ảnh tham chiếu.",
      502,
      "MAIVIDEO_IMAGE_MODEL_MISSING"
    );
  }
  if (!ALLOWED_IMAGE_MODELS.has(actualModel) || actualModel !== requestedModel) {
    throw new MaiVideoImageGenerationError(
      "MaiVideo được yêu cầu dùng model " + requestedModel + " nhưng trả về model " + actualModel + ".",
      502,
      "MAIVIDEO_IMAGE_MODEL_MISMATCH"
    );
  }
}

async function readJson(url, request, options = {}, fallbackMessage) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        ...requestHeaders(request, Boolean(options.body)),
        ...(options.headers || {})
      },
      signal: options.signal || AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
      cache: "no-store"
    });
  } catch (error) {
    throw new MaiVideoImageGenerationError(
      error?.name === "TimeoutError"
        ? "MaiVideo không phản hồi khi tạo ảnh chì đen trắng."
        : "Không kết nối được MaiVideo để tạo ảnh chì đen trắng.",
      503,
      error?.name === "TimeoutError" ? "MAIVIDEO_IMAGE_TIMEOUT" : "MAIVIDEO_IMAGE_CONNECTION_FAILED"
    );
  }

  const payload = parsePayload(await response.text());
  if (!response.ok) {
    throw new MaiVideoImageGenerationError(
      payloadMessage(payload, fallbackMessage),
      response.status,
      response.status === 401 ? "MAIVIDEO_IMAGE_UNAUTHORIZED" : "MAIVIDEO_IMAGE_REQUEST_FAILED"
    );
  }
  if (payload?.success === false || payload?.ok === false) {
    throw new MaiVideoImageGenerationError(
      payloadMessage(payload, fallbackMessage),
      502,
      "MAIVIDEO_IMAGE_REQUEST_FAILED"
    );
  }
  return payload;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function jobStatus(payload) {
  return String(payload?.status || payload?.job?.status || "").trim().toLowerCase();
}

function jobIdFrom(payload) {
  return String(payload?.job_id || payload?.job?.id || payload?.id || "").trim();
}

function sessionIdFromPayload(payload, fallback = "") {
  return normalizeSessionId(
    payload?.job?.session_id
      || payload?.session_id
      || fallback
  );
}

async function pollImageJob(jobId, request, deadline, outputSessionId = "") {
  let lastStatus = "queued";
  let resolvedSessionId = normalizeSessionId(outputSessionId);
  while (Date.now() < deadline) {
    const payload = await readJson(
      maivideoEndpoint("/api/v1/image-generation/" + encodeURIComponent(jobId)),
      request,
      {},
      "Không đọc được trạng thái ảnh chì đen trắng."
    );
    resolvedSessionId = sessionIdFromPayload(payload, resolvedSessionId);
    lastStatus = jobStatus(payload) || lastStatus;
    const image = completedImageResult(payload, resolvedSessionId);
    if (image && (SUCCESS_STATUSES.has(lastStatus) || lastStatus === "partial")) {
      assertExpectedImageModel(payload, image.result);
      return image.url;
    }
    if (TERMINAL_STATUSES.has(lastStatus)) {
      throw new MaiVideoImageGenerationError(
        "MaiVideo không tạo được ảnh chì đen trắng (trạng thái: " + lastStatus + ").",
        502,
        "MAIVIDEO_IMAGE_JOB_FAILED"
      );
    }
    await sleep(Math.min(IMAGE_POLL_INTERVAL_MS, Math.max(250, deadline - Date.now())));
  }

  throw new MaiVideoImageGenerationError(
    "MaiVideo tạo ảnh chì đen trắng quá thời gian chờ 30 phút. Chưa gửi yêu cầu tạo video.",
    504,
    "MAIVIDEO_IMAGE_JOB_TIMEOUT"
  );
}

async function createOnePencilSketch(referenceUrl, request, deadline, fallbackSessionId = "") {
  // MaiVideo's canonical field accepts URL, data URL, and raw base64 and
  // detects the actual image format itself. Library references are already
  // URLs; pass the public MaiVideo URL through unchanged instead of turning
  // it into a second, very large JSON/base64 representation.
  const referenceImageUrl = publicMaiVideoReferenceUrl(referenceUrl);
  if (!isHttpUrl(referenceImageUrl) || referenceImageUrl.length > MAX_REFERENCE_URL_LENGTH) {
    throw new MaiVideoImageGenerationError(
      "Ảnh tham chiếu phải là một URL ảnh hợp lệ.",
      422,
      "MAIVIDEO_REFERENCE_IMAGE_INVALID"
    );
  }
  const payload = await readJson(
    maivideoEndpoint("/api/v1/image-generation"),
    request,
    {
      method: "POST",
      body: JSON.stringify({
        prompt: PENCIL_SKETCH_PROMPT,
        model: appConfig.maivideoImageModel,
        quality: appConfig.maivideoImageQuality,
        aspect_ratio: "1:1",
        n: 1,
        // MaiVideo's current API documents reference_image_urls as the
        // canonical mixed-input field and detects JPG/PNG/WEBP/etc. from the
        // downloaded image bytes.
        reference_image_urls: [referenceImageUrl]
      })
    },
    "MaiVideo không nhận được yêu cầu tạo ảnh chì đen trắng."
  );
  const outputSessionId = sessionIdFromPayload(payload, fallbackSessionId);
  const jobId = jobIdFrom(payload);
  if (!jobId) {
    const immediateImage = completedImageResult(payload, outputSessionId);
    if (immediateImage) {
      assertExpectedImageModel(payload, immediateImage.result);
      return immediateImage.url;
    }
    throw new MaiVideoImageGenerationError(
      "MaiVideo không trả về mã job tạo ảnh chì đen trắng.",
      502,
      "MAIVIDEO_IMAGE_JOB_ID_MISSING"
    );
  }
  return pollImageJob(jobId, request, deadline, outputSessionId);
}

export async function createPencilSketches({ referenceUrls, request, sessionId = "" }) {
  const normalized = normalizeReferenceUrls(referenceUrls);
  if (!normalized.length) return [];

  const deadline = Date.now() + IMAGE_GENERATION_TIMEOUT_MS;
  const generated = [];
  // Keep this sequential. Each input consumes one MaiVideo image quota unit;
  // serial requests avoid overfilling PixVerse slots and preserve input order.
  for (let index = 0; index < normalized.length; index += 1) {
    if (Date.now() >= deadline) {
      throw new MaiVideoImageGenerationError(
        "MaiVideo tạo ảnh chì đen trắng quá thời gian chờ 30 phút. Chưa gửi yêu cầu tạo video.",
        504,
        "MAIVIDEO_IMAGE_JOB_TIMEOUT"
      );
    }
    try {
      generated.push(await createOnePencilSketch(normalized[index], request, deadline, sessionId));
    } catch (error) {
      if (error instanceof MaiVideoImageGenerationError) {
        throw new MaiVideoImageGenerationError(
          "Ảnh tham chiếu thứ " + (index + 1) + " không thể chuyển thành ảnh chì: " + error.message,
          error.status,
          error.code
        );
      }
      throw error;
    }
  }
  return generated;
}

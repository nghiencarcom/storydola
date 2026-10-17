/**
 * Server-side source ingestion for YouTube and other supported video URLs.
 *
 * The existing maivideo/htmlvideo service owns yt-dlp + Whisper, so StoryAI
 * delegates transcript extraction to its small /api/crawl-url endpoint instead of
 * duplicating the downloader/transcription runtime here.
 */

export type SourceIngestResult = {
  text: string;
  sourceUrl?: string;
  sourceType?: string;
  platform?: string;
};

function getCrawlBaseUrl() {
  return (
    process.env.MAIVIDEO_HTMLVIDEO_BASE_URL
    || process.env.MAIVIDEO_CRAWL_BASE_URL
    || "http://127.0.0.1:3000"
  ).replace(/\/$/, "");
}

function getCrawlPath() {
  const configured = process.env.MAIVIDEO_CRAWL_PATH?.trim();
  if (!configured) return "/api/crawl-url";
  return configured.startsWith("/") ? configured : `/${configured}`;
}

function sourceError(message: string, cause?: unknown) {
  const error = new Error(message);
  error.name = "SOURCE_INGEST_FAILED";
  if (cause instanceof Error) error.cause = cause;
  return error;
}

/** Fetch a transcript/brief from the existing MaiVideo crawl service. */
export async function ingestSourceUrl(sourceUrl: string): Promise<SourceIngestResult> {
  const normalizedUrl = sourceUrl.trim();
  if (!normalizedUrl) throw sourceError("SOURCE_URL_REQUIRED");

  const response = await fetch(`${getCrawlBaseUrl()}${getCrawlPath()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: normalizedUrl }),
    signal: AbortSignal.timeout(Number(process.env.MAIVIDEO_CRAWL_TIMEOUT_MS) || 12 * 60 * 1000),
  }).catch((cause) => {
    throw sourceError("Không kết nối được MaiVideo để lấy transcript. Hãy kiểm tra htmlvideo đang chạy và MAIVIDEO_HTMLVIDEO_BASE_URL.", cause);
  });

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const detail = typeof payload.message === "string" ? payload.message : typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw sourceError(`MaiVideo không lấy được transcript: ${detail}`);
  }

  const text = String(payload.text || payload.transcript || payload.content || "").trim();
  if (!text) throw sourceError("MaiVideo trả về transcript rỗng.");
  return {
    text: text.slice(0, 60000),
    sourceUrl: typeof payload.sourceUrl === "string" ? payload.sourceUrl : normalizedUrl,
    sourceType: typeof payload.sourceType === "string" ? payload.sourceType : "video",
    platform: typeof payload.platform === "string" ? payload.platform : "youtube",
  };
}

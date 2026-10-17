import { NextResponse } from "next/server";
import { maivideoEndpoint, maivideoHeaders } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_SOURCES = new Set(["uploads", "downloads", "exports"]);
const MEDIA_FILE_TIMEOUT_MS = 120_000;
const SESSION_ID_PATTERN = /^(?:user|public|sess)_[A-Za-z0-9_-]{1,96}$/;
const NO_CACHE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0"
};

function normalizePath(value) {
  const normalized = String(value || "").trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return "";
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))) return "";
  return segments.join("/");
}

function forwardHeaders(request) {
  const headers = maivideoHeaders(request);
  // Preserve media ranges for video playback, but do not forward validators:
  // library paths can be replaced in place and a stale 304 would reuse old bytes.
  for (const name of ["range"]) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

async function handleFile(request) {
  const params = request.nextUrl.searchParams;
  const source = String(params.get("source") || "").trim();
  const relativePath = normalizePath(params.get("path") || params.get("relative_path"));
  const sessionId = String(params.get("session_id") || "").trim();
  if (!MEDIA_SOURCES.has(source)) {
    return NextResponse.json({ error: "Nguồn media không hợp lệ" }, { status: 400, headers: NO_CACHE_HEADERS });
  }
  if (!relativePath) {
    return NextResponse.json({ error: "Đường dẫn media không hợp lệ" }, { status: 400, headers: NO_CACHE_HEADERS });
  }
  if (sessionId && sessionId !== "global" && !SESSION_ID_PATTERN.test(sessionId)) {
    return NextResponse.json({ error: "Session MaiVideo không hợp lệ" }, { status: 400, headers: NO_CACHE_HEADERS });
  }

  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  const query = sessionId ? "?session_id=" + encodeURIComponent(sessionId) : "";
  try {
    const response = await fetch(
      maivideoEndpoint("/static/" + encodeURIComponent(source) + "/" + encodedPath) + query,
      {
        method: request.method,
        cache: "no-store",
        headers: forwardHeaders(request),
        signal: AbortSignal.timeout(MEDIA_FILE_TIMEOUT_MS)
      }
    );
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("set-cookie");
    headers.delete("etag");
    headers.delete("last-modified");
    headers.delete("expires");
    for (const [name, value] of Object.entries(NO_CACHE_HEADERS)) headers.set(name, value);
    return new NextResponse(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.name === "TimeoutError" ? "MaiVideo không phản hồi kịp thời" : "Không thể đọc ảnh từ thư viện MaiVideo" },
      { status: 502, headers: NO_CACHE_HEADERS }
    );
  }
}

export async function GET(request) {
  return handleFile(request);
}

export async function HEAD(request) {
  return handleFile(request);
}

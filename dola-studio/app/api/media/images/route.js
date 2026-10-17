import { NextResponse } from "next/server";
import { maivideoEndpoint, maivideoHeaders, maivideoPublicEndpoint } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_SOURCES = new Set(["uploads", "downloads", "exports"]);
const MEDIA_LIBRARY_LIST_TIMEOUT_MS = 30000;
const SESSION_ID_PATTERN = /^(?:user|public|sess)_[A-Za-z0-9_-]{1,96}$/;

function normalizePath(value) {
  const normalized = String(value || "").trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return "";
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))) return "";
  return segments.join("/");
}

function inferSessionId(item) {
  const relativePath = normalizePath(item?.relative_path);
  const match = relativePath.match(/^library\/(user|public|sess)_([A-Za-z0-9_-]{1,96})(?:\/|$)/);
  return match ? match[1] + "_" + match[2] : "global";
}

function requestedSessionId(request) {
  const value = request.headers.get("x-maivideo-session-id")?.trim()
    || request.headers.get("x-session-id")?.trim()
    || "";
  return value === "global" || SESSION_ID_PATTERN.test(value) ? value : "";
}

async function resolveAuthSessionId(request) {
  const requested = requestedSessionId(request);
  if (requested) return requested;
  try {
    const response = await fetch(maivideoEndpoint("/api/auth/me"), {
      cache: "no-store",
      headers: maivideoHeaders(request),
      signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) return "";
    const payload = await response.json();
    const sessionId = String(payload?.user?.session_id || "").trim();
    return sessionId === "global" || SESSION_ID_PATTERN.test(sessionId) ? sessionId : "";
  } catch {
    return "";
  }
}

function buildPreviewUrl(request, item, fallbackSessionId) {
  const source = String(item?.source || "").trim();
  const relativePath = normalizePath(item?.relative_path || item?.file_name);
  if (!MEDIA_SOURCES.has(source) || !relativePath) return "";

  const url = new URL("/api/media/files", request.url);
  url.searchParams.set("source", source);
  url.searchParams.set("path", relativePath);
  url.searchParams.set("session_id", fallbackSessionId || inferSessionId(item));
  return url.pathname + "?" + url.searchParams.toString();
}

function buildPublicUrl(item, fallbackSessionId) {
  const source = String(item?.source || "").trim();
  const relativePath = normalizePath(item?.relative_path || item?.file_name);
  if (!MEDIA_SOURCES.has(source) || !relativePath) return "";

  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  const url = new URL(
    "/static/" + encodeURIComponent(source) + "/" + encodedPath,
    maivideoPublicEndpoint("/")
  );
  const sessionId = fallbackSessionId || inferSessionId(item);
  if (sessionId) url.searchParams.set("session_id", sessionId);
  return url.toString();
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

export async function GET(request) {
  try {
    const response = await fetch(maivideoEndpoint("/api/media/images"), {
      cache: "no-store",
      headers: maivideoHeaders(request),
      signal: AbortSignal.timeout(MEDIA_LIBRARY_LIST_TIMEOUT_MS)
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

    const sessionId = await resolveAuthSessionId(request);
    const items = Array.isArray(payload.items) ? payload.items : [];
    const safeItems = items
      .filter((item) => item && item.kind === "image")
      .map((item) => {
        const { file_path: _filePath, ...safeItem } = item;
        const previewUrl = buildPreviewUrl(request, safeItem, sessionId);
        const publicUrl = buildPublicUrl(safeItem, sessionId);
        return {
          ...safeItem,
          previewUrl,
          thumbnail: previewUrl || safeItem.thumbnail || "",
          publicUrl
        };
      })
      .filter((item) => item.previewUrl);

    const result = NextResponse.json(
      { success: true, items: safeItems },
      { headers: { "Cache-Control": "no-store" } }
    );
    return rememberAuthToken(result, request);
  } catch (error) {
    return NextResponse.json(
      { error: error?.name === "TimeoutError" ? "MaiVideo không phản hồi kịp thời" : "Không kết nối được MaiVideo API tại MAIVIDEO_PUBLIC_URL" },
      { status: 503 }
    );
  }
}

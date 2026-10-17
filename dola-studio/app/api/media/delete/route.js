import { NextResponse } from "next/server";
import { maivideoEndpoint, maivideoHeaders } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_SOURCES = new Set(["uploads", "downloads", "exports"]);

function normalizePath(value) {
  const normalized = String(value || "").trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return "";
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))) return "";
  return segments.join("/");
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

export async function DELETE(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }

  const source = String(body?.source || "").trim();
  const relativePath = normalizePath(body?.relativePath || body?.relative_path || body?.path);
  if (!MEDIA_SOURCES.has(source)) {
    return NextResponse.json({ error: "Nguồn media không hợp lệ" }, { status: 400 });
  }
  if (!relativePath) {
    return NextResponse.json({ error: "Đường dẫn media không hợp lệ" }, { status: 400 });
  }

  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  try {
    const response = await fetch(
      maivideoEndpoint("/api/video-library/" + encodeURIComponent(source) + "/" + encodedPath),
      {
        method: "DELETE",
        cache: "no-store",
        headers: maivideoHeaders(request),
        signal: AbortSignal.timeout(10000)
      }
    );
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
    const result = NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
    return rememberAuthToken(result, request);
  } catch (error) {
    return NextResponse.json(
      { error: error?.name === "TimeoutError" ? "MaiVideo không phản hồi kịp thời" : "Không kết nối được MaiVideo API tại MAIVIDEO_PUBLIC_URL" },
      { status: 503 }
    );
  }
}

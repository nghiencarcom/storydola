import { NextResponse } from "next/server";
import { gatewayEndpoint } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function forwardHeaders(request) {
  const headers = {};
  // Keep byte-range playback support, but do not forward cache validators;
  // a prior watermarked response must never turn into a 304 for this URL.
  for (const name of ["range"]) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

async function handleVideo(request, { params }) {
  const resolvedParams = await params;
  const segments = Array.isArray(resolvedParams?.path) ? resolvedParams.path : [];
  if (!segments.length) return NextResponse.json({ error: "Thiếu tên video" }, { status: 400 });
  const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join("/");
  const requestUrl = new URL(request.url);
  const isDownload = requestUrl.searchParams.get("download") === "1";

  try {
    const response = await fetch(gatewayEndpoint("/videos/" + encodedPath), {
      method: request.method,
      headers: forwardHeaders(request),
      cache: "no-store",
      // Keep large video responses alive while Cloudflare and the browser
      // consume the streamed body. A short fetch timeout aborts downloads
      // after headers have arrived, which looks like a corrupt/failed file.
      signal: AbortSignal.timeout(5 * 60 * 1000)
    });
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    // A completed task may have replaced a previously cached watermarked
    // fallback with the cleaned file. Always fetch the current gateway bytes.
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    headers.set("Pragma", "no-cache");
    if (isDownload && response.ok) {
      const requestedFilename = String(requestUrl.searchParams.get("filename") || "video.mp4")
        .slice(0, 180);
      const filename = requestedFilename
        .replace(/[\\/\r\n\u0000-\u001f\u007f";]/g, "_")
        .trim() || "video.mp4";
      headers.set(
        "Content-Disposition",
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
    }
    return new NextResponse(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Không thể đọc video từ gateway" },
      { status: 502 }
    );
  }
}

export async function GET(request, context) {
  return handleVideo(request, context);
}

export async function HEAD(request, context) {
  return handleVideo(request, context);
}

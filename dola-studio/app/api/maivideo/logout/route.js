import { NextResponse } from "next/server";
import { maivideoEndpoint, maivideoHeaders } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMaiVideoHost(request) {
  const hostname = String(request.nextUrl?.hostname || "").toLowerCase();
  return hostname === "maivideo.top" || hostname.endsWith(".maivideo.top");
}

function clearAuthCookies(response, request) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  };
  response.cookies.set("dola-maivideo-auth", "", cookieOptions);
  if (isMaiVideoHost(request)) {
    response.cookies.set("maivideo_auth", "", {
      ...cookieOptions,
      domain: ".maivideo.top"
    });
  }
}

function payloadMessage(payload, status) {
  if (payload && typeof payload === "object") {
    if (typeof payload.detail === "string") return payload.detail;
    if (typeof payload.error === "string") return payload.error;
    if (typeof payload.message === "string") return payload.message;
  }
  return "MaiVideo trả về HTTP " + status;
}

export async function POST(request) {
  let upstreamError = "";
  try {
    const response = await fetch(maivideoEndpoint("/api/auth/logout"), {
      method: "POST",
      cache: "no-store",
      headers: maivideoHeaders(request),
      signal: AbortSignal.timeout(10000)
    });
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { error: raw.slice(0, 300) };
    }
    if (!response.ok) upstreamError = payloadMessage(payload, response.status);
  } catch (error) {
    upstreamError = error?.name === "TimeoutError"
      ? "MaiVideo không phản hồi kịp thời"
      : "Không kết nối được MaiVideo API tại MAIVIDEO_PUBLIC_URL";
  }

  const result = NextResponse.json(
    upstreamError
      ? { success: false, error: upstreamError }
      : { success: true },
    {
      status: upstreamError ? 502 : 200,
      headers: { "Cache-Control": "no-store" }
    }
  );
  clearAuthCookies(result, request);
  return result;
}

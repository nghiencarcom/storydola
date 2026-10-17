import { NextResponse } from "next/server";
import { maivideoEndpoint, maivideoHeaders } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function payloadMessage(payload, status) {
  if (payload && typeof payload === "object") {
    if (typeof payload.detail === "string") return payload.detail;
    if (typeof payload.error === "string") return payload.error;
    if (typeof payload.message === "string") return payload.message;
  }
  return "MaiVideo trả về HTTP " + status;
}

export async function GET(request) {
  try {
    const response = await fetch(maivideoEndpoint("/api/auth/me"), {
      cache: "no-store",
      headers: maivideoHeaders(request),
      signal: AbortSignal.timeout(5000)
    });
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { detail: raw.slice(0, 300) };
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          authenticated: false,
          user: null,
          ...(response.status === 401 ? {} : { error: payloadMessage(payload, response.status) })
        },
        { status: response.status === 401 ? 200 : response.status, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      { authenticated: true, user: payload.user || null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        authenticated: false,
        user: null,
        error: error?.name === "TimeoutError"
          ? "MaiVideo không phản hồi kịp thời"
          : "Không kết nối được MaiVideo API tại MAIVIDEO_PUBLIC_URL"
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

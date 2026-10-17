import { NextResponse } from "next/server";
import { maivideoEndpoint } from "@/lib/config";

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

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }

  const email = String(body?.email || "").trim();
  const password = String(body?.password || "");
  const remember = body?.remember !== false;
  if (!/^\S+@\S+\.\S+$/.test(email) || !password) {
    return NextResponse.json({ error: "Hãy nhập email và mật khẩu MaiVideo hợp lệ" }, { status: 422 });
  }

  try {
    const response = await fetch(maivideoEndpoint("/api/auth/login"), {
      method: "POST",
      cache: "no-store",
      // Login must be independent of any legacy token sent by the browser.
      // Forwarding the old profile credential makes account switching look
      // like a conflicting-session failure at the upstream service.
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10000)
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
    const token = String(payload?.token || "").trim();
    if (!token) {
      return NextResponse.json({ error: "MaiVideo không trả về token đăng nhập" }, { status: 502 });
    }
    const result = NextResponse.json(
      { success: true, user: payload.user || null },
      { headers: { "Cache-Control": "no-store" } }
    );
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/"
    };
    if (remember) cookieOptions.maxAge = 60 * 60 * 24 * 7;
    result.cookies.set("dola-maivideo-auth", token, cookieOptions);
    return result;
  } catch (error) {
    return NextResponse.json(
      { error: error?.name === "TimeoutError" ? "MaiVideo không phản hồi kịp thời" : "Không kết nối được MaiVideo API tại MAIVIDEO_PUBLIC_URL" },
      { status: 503 }
    );
  }
}

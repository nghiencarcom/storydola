import { NextResponse } from "next/server";
import { claimLegacySeedanceAccounts } from "./seedance-accounts";
import { claimLegacyWorkspace } from "./server-store";
import { clearLegacyMaiVideoAuthCookie, readMaiVideoAuthCookie, resolveMaiVideoAuthBaseUrl, serializeMaiVideoAuthCookie, type MaiVideoAuthUser } from "./maivideo-auth-shared";

const AUTH_TIMEOUT_MS = Math.max(2_000, Number(process.env.MAIVIDEO_AUTH_TIMEOUT_MS) || 10_000);

function upstreamMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    const message = typeof body.detail === "string" ? body.detail : typeof body.error === "string" ? body.error : "";
    if (message.trim()) return message.trim().slice(0, 300);
  }
  return status === 401 ? "Email hoặc mật khẩu MaiVideo không đúng." : `MaiVideo từ chối yêu cầu (${status}).`;
}

async function claimWorkspace(userId: string) {
  await claimLegacyWorkspace(userId);
  await claimLegacySeedanceAccounts(userId);
}

export async function proxyMaiVideoPasswordAuth(
  request: Request,
  route: "login" | "register",
  payload: Record<string, string>,
) {
  const baseUrl = resolveMaiVideoAuthBaseUrl(request);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/api/auth/${route}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    return NextResponse.json({ code: "MAIVIDEO_AUTH_UNAVAILABLE", message: "Không kết nối được máy chủ đăng nhập MaiVideo. Kiểm tra MaiVideo đang chạy rồi thử lại." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }

  const body = await upstream.json().catch(() => ({})) as Record<string, unknown>;
  if (!upstream.ok) {
    const status = upstream.status >= 500 ? 502 : upstream.status;
    return NextResponse.json({ code: "MAIVIDEO_AUTH_FAILED", message: upstreamMessage(body, upstream.status) }, { status });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const rawUser = body.user as Record<string, unknown> | undefined;
  const id = String(rawUser?.id || "").trim();
  const email = String(rawUser?.email || "").trim().toLowerCase();
  const name = String(rawUser?.name || rawUser?.display_name || rawUser?.displayName || "").trim().slice(0, 120) || email.split("@")[0];
  const role = typeof rawUser?.role === "string" ? rawUser.role.slice(0, 40) : undefined;
  if (!token || token.length > 4_096 || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ code: "MAIVIDEO_AUTH_INVALID_RESPONSE", message: "MaiVideo chưa trả về phiên đăng nhập hợp lệ. Vui lòng thử lại." }, { status: 502 });
  }

  const user: MaiVideoAuthUser = { id, email, name, ...(role ? { role } : {}) };
  try {
    await claimWorkspace(user.id);
  } catch {
    return NextResponse.json({ code: "STORYAI_WORKSPACE_UNAVAILABLE", message: "Không thể khởi tạo dữ liệu project cho tài khoản này. Vui lòng thử lại." }, { status: 503 });
  }

  const response = NextResponse.json({ success: true, user }, {
    status: route === "register" ? 201 : upstream.status,
    headers: { "Cache-Control": "no-store" },
  });
  response.headers.append("Set-Cookie", serializeMaiVideoAuthCookie(request, token, 30 * 24 * 60 * 60));
  response.headers.append("Set-Cookie", clearLegacyMaiVideoAuthCookie(request));
  response.headers.append("Set-Cookie", `storyai_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`);
  return response;
}

export async function logoutMaiVideoSession(request: Request) {
  const token = readMaiVideoAuthCookie(request.headers.get("cookie"));
  if (token) {
    const baseUrl = resolveMaiVideoAuthBaseUrl(request);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
    try {
      await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-Auth-Token": token },
        body: "{}",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      // Clear the local browser session even when MaiVideo is temporarily unavailable.
    } finally {
      clearTimeout(timeout);
    }
  }

  const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  response.headers.append("Set-Cookie", serializeMaiVideoAuthCookie(request, "", 0));
  response.headers.append("Set-Cookie", clearLegacyMaiVideoAuthCookie(request));
  response.headers.append("Set-Cookie", `storyai_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`);
  return response;
}

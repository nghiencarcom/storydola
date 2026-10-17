import { NextRequest, NextResponse } from "next/server";
import { readMaiVideoAuthCookie, resolveMaiVideoAuthBaseUrl, verifyMaiVideoAuthToken } from "./app/lib/maivideo-auth-shared";
import { isLoopbackHost, LOCAL_USER_EMAIL, LOCAL_USER_ID, LOCAL_USER_NAME } from "./app/lib/local-auth";

const PUBLIC_PAGES = new Set(["/login", "/register"]);
const PUBLIC_AUTH_APIS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/session",
]);

async function sessionUser(request: NextRequest) {
  const token = readMaiVideoAuthCookie(request.headers.get("cookie"));
  if (!token) return null;
  return verifyMaiVideoAuthToken(token, resolveMaiVideoAuthBaseUrl(request));
}

function withTrustedUser(request: NextRequest, userId: string, email: string, name: string, role?: string, localMode = false) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-storyai-user-id", userId);
  requestHeaders.set("x-storyai-user-email", email);
  requestHeaders.set("x-storyai-user-name", name);
  if (role) requestHeaders.set("x-storyai-user-role", role);
  else requestHeaders.delete("x-storyai-user-role");
  if (localMode) requestHeaders.set("x-storyai-local-mode", "1");
  else requestHeaders.delete("x-storyai-local-mode");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

function withoutUserHeaders(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-storyai-user-id");
  requestHeaders.delete("x-storyai-user-email");
  requestHeaders.delete("x-storyai-user-name");
  requestHeaders.delete("x-storyai-user-role");
  requestHeaders.delete("x-storyai-local-mode");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (process.env.STORYAI_LOCAL_AUTH_BYPASS === "1" && isLoopbackHost(request.nextUrl.hostname)) {
    if (PUBLIC_PAGES.has(pathname)) return NextResponse.redirect(new URL("/dashboard", request.url));
    if (pathname === "/api/auth/login" || pathname === "/api/auth/register") {
      return NextResponse.json({ code: "MAIVIDEO_AUTH_DISABLED_LOCAL", message: "Đăng nhập MaiVideo đã tắt khi ứng dụng chạy cục bộ." }, { status: 410 });
    }
    if (pathname === "/api/auth/logout") return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    return withTrustedUser(request, LOCAL_USER_ID, LOCAL_USER_EMAIL, LOCAL_USER_NAME, undefined, true);
  }

  const isPublicApi = PUBLIC_AUTH_APIS.has(pathname) || pathname.startsWith("/api/seedance/references/");
  let user = null;
  try {
    user = await sessionUser(request);
  } catch {
    user = null;
  }

  if (PUBLIC_PAGES.has(pathname)) {
    if (user) return NextResponse.redirect(new URL("/dashboard", request.url));
    return withoutUserHeaders(request);
  }
  if (isPublicApi && !user) return withoutUserHeaders(request);

  if (!user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ message: "Vui lòng đăng nhập MaiVideo để tiếp tục.", code: "MAIVIDEO_AUTH_REQUIRED" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return withTrustedUser(request, user.id, user.email, user.name, user.role);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|branding/).*)"],
};

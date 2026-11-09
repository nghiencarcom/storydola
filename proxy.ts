import { NextRequest, NextResponse } from "next/server";
import { readMaiVideoAuthCookie, resolveMaiVideoAuthBaseUrl, verifyMaiVideoAuthToken } from "./app/lib/maivideo-auth-shared";

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

function withTrustedUser(request: NextRequest, userId: string, email: string, name: string, role?: string) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-storyai-user-id", userId);
  requestHeaders.set("x-storyai-user-email", email);
  requestHeaders.set("x-storyai-user-name", name);
  if (role) requestHeaders.set("x-storyai-user-role", role);
  else requestHeaders.delete("x-storyai-user-role");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

function withoutUserHeaders(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-storyai-user-id");
  requestHeaders.delete("x-storyai-user-email");
  requestHeaders.delete("x-storyai-user-name");
  requestHeaders.delete("x-storyai-user-role");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isPublicApi = PUBLIC_AUTH_APIS.has(pathname) || pathname.startsWith("/api/seedance/references/") || pathname.startsWith("/api/timelapse/references/");
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

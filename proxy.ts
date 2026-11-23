import { NextRequest, NextResponse } from "next/server";
import { resolveAgentAccessToken } from "./app/lib/agent-access-store";
import { MAIVIDEO_AUTH_COOKIE, readMaiVideoAuthCookie, resolveMaiVideoAuthBaseUrl, verifyMaiVideoAuthToken } from "./app/lib/maivideo-auth-shared";

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

function withTrustedUser(request: NextRequest, userId: string, email: string, name: string, role?: string, agentMaiVideoToken?: string) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-storyai-user-id", userId);
  requestHeaders.set("x-storyai-user-email", email);
  requestHeaders.set("x-storyai-user-name", name);
  requestHeaders.delete("authorization");
  if (agentMaiVideoToken) requestHeaders.set("cookie", `${MAIVIDEO_AUTH_COOKIE}=${encodeURIComponent(agentMaiVideoToken)}`);
  if (role) requestHeaders.set("x-storyai-user-role", role);
  else requestHeaders.delete("x-storyai-user-role");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

function isAgentMcpRouteAllowed(method: string, pathname: string) {
  const verb = method.toUpperCase();
  if (pathname === "/api/agent/v1/sales-ugc") return verb === "GET" || verb === "PATCH";
  if (verb === "GET" && ["/api/agent/v1/projects", "/api/media-models", "/api/omnivoice/voices"].includes(pathname)) return true;
  if (verb === "GET" && /^\/api\/agent\/v1\/projects\/[^/]+\/scenes$/.test(pathname)) return true;
  if (verb === "POST" && /^\/api\/projects\/create\/(?:ai-story|audio-story|ai-drama)$/.test(pathname)) return true;

  const projectRoute = pathname.match(/^\/api\/projects\/([^/]+)(?:\/(.*))?$/);
  if (!projectRoute) return false;
  const rest = projectRoute[2] || "";
  if (!rest) return verb === "GET" || verb === "PATCH";
  if (rest === "scene-media-jobs" || rest === "render") {
    if (rest === "scene-media-jobs") return verb === "GET" || verb === "POST";
    if (rest === "render") return verb === "GET" || verb === "POST";
  }
  if (rest === "import-scripts") return verb === "POST";
  if (/^scenes\/[^/]+\/tts$/.test(rest)) return verb === "POST";
  return false;
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
  const authorization = request.headers.get("authorization") || "";
  const agentTokenMatch = authorization.match(/^Bearer\s+(storyai_mcp_[A-Za-z0-9_-]+)$/i);
  if (agentTokenMatch) {
    if (!isAgentMcpRouteAllowed(request.method, pathname)) {
      return NextResponse.json({ message: "MCP token không có quyền truy cập endpoint này." }, { status: 403 });
    }
    try {
      const access = await resolveAgentAccessToken(agentTokenMatch[1]);
      if (!access) return NextResponse.json({ message: "MCP token không hợp lệ hoặc đã bị thu hồi." }, { status: 401 });
      const user = await verifyMaiVideoAuthToken(access.maiVideoToken, resolveMaiVideoAuthBaseUrl(request));
      if (!user || user.id !== access.ownerId) {
        return NextResponse.json({ code: "AGENT_MAIVIDEO_SESSION_EXPIRED", message: "Phiên MaiVideo đã hết hạn. Hãy đăng nhập lại StoryAI rồi tạo token MCP mới." }, { status: 401 });
      }
      return withTrustedUser(request, user.id, user.email, user.name, user.role, access.maiVideoToken);
    } catch {
      return NextResponse.json({ code: "AGENT_ACCESS_UNAVAILABLE", message: "Không thể xác thực MCP token. Kiểm tra khóa mã hóa và thư mục data của StoryAI." }, { status: 503 });
    }
  }

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

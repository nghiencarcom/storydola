export type MaiVideoAuthUser = {
  id: string;
  email: string;
  name: string;
  role?: string;
};

export const MAIVIDEO_AUTH_COOKIE = process.env.MAIVIDEO_AUTH_COOKIE?.trim() || "maivideo_auth";

const LOCAL_AUTH_BASE_URL = (process.env.MAIVIDEO_AUTH_LOCAL_BASE_URL?.trim() || "http://127.0.0.1:3005").replace(/\/$/, "");
const REMOTE_AUTH_BASE_URL = (process.env.MAIVIDEO_AUTH_BASE_URL?.trim() || "https://maivideo.top").replace(/\/$/, "");
const AUTH_TIMEOUT_MS = Math.max(2_000, Number(process.env.MAIVIDEO_AUTH_TIMEOUT_MS) || 10_000);
const AUTH_CACHE_TTL_MS = Math.max(0, Number(process.env.MAIVIDEO_AUTH_CACHE_TTL_MS) || 30_000);
const authUserCache = new Map<string, { user: MaiVideoAuthUser | null; expiresAt: number }>();

function hostnameFromHeader(value: string) {
  const first = value.split(",", 1)[0]?.trim();
  if (!first) return "";
  try {
    return new URL(`http://${first}`).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return first.toLowerCase().split(":", 1)[0];
  }
}

export function resolveMaiVideoAuthBaseUrl(request: Pick<Request, "url" | "headers">) {
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const host = hostnameFromHeader(forwardedHost) || hostnameFromHeader(new URL(request.url).host);
  return ["localhost", "127.0.0.1", "::1"].includes(host) ? LOCAL_AUTH_BASE_URL : REMOTE_AUTH_BASE_URL;
}

export function readMaiVideoAuthCookie(cookieHeader: string | null | undefined) {
  for (const part of (cookieHeader || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== MAIVIDEO_AUTH_COOKIE) continue;
    const rawValue = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return "";
}

function normalizeAuthUser(value: unknown): MaiVideoAuthUser | null {
  if (!value || typeof value !== "object") return null;
  const user = value as Record<string, unknown>;
  const id = String(user.id || "").trim();
  const email = String(user.email || "").trim().toLowerCase();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const name = String(user.name || user.display_name || user.displayName || "").trim().slice(0, 120) || email.split("@")[0];
  const role = typeof user.role === "string" ? user.role.slice(0, 40) : undefined;
  return { id, email, name, ...(role ? { role } : {}) };
}

async function cacheKey(baseUrl: string, token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${baseUrl}:${token}`));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyMaiVideoAuthToken(token: string, baseUrl: string): Promise<MaiVideoAuthUser | null> {
  const rawToken = token.trim();
  if (!rawToken || rawToken.length > 4_096) return null;
  const key = await cacheKey(baseUrl, rawToken);
  const cached = authUserCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  if (cached) authUserCache.delete(key);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  let user: MaiVideoAuthUser | null = null;
  try {
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      method: "GET",
      headers: { Accept: "application/json", "X-Auth-Token": rawToken },
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.ok) {
      const payload = await response.json().catch(() => ({})) as { user?: unknown };
      user = normalizeAuthUser(payload.user);
    }
  } catch {
    user = null;
  } finally {
    clearTimeout(timeout);
  }

  if (authUserCache.size > 1_000) authUserCache.clear();
  authUserCache.set(key, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
  return user;
}

export function serializeMaiVideoAuthCookie(request: Pick<Request, "url" | "headers">, token: string, maxAge: number) {
  const url = new URL(request.url);
  const secure = url.protocol === "https:" || request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() === "https";
  return `${MAIVIDEO_AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}${secure ? "; Secure" : ""}`;
}

export function clearLegacyMaiVideoAuthCookie(request: Pick<Request, "url" | "headers">) {
  const url = new URL(request.url);
  const secure = url.protocol === "https:" || request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() === "https";
  return `${MAIVIDEO_AUTH_COOKIE}=; Domain=.maivideo.top; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

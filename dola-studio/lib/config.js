function cleanUrl(value, fallback) {
  const candidate = String(value || fallback).trim();
  return candidate.replace(/\/+$/, "");
}

const MAIVIDEO_IMAGE_MODELS = new Set(["gemini-3.0", "gemini-3.1-flash"]);
const DEFAULT_MAIVIDEO_IMAGE_MODEL = "gemini-3.1-flash";
const configuredMaiVideoImageModel = String(
  process.env.MAIVIDEO_IMAGE_MODEL || DEFAULT_MAIVIDEO_IMAGE_MODEL
).trim();
const maivideoImageModel = MAIVIDEO_IMAGE_MODELS.has(configuredMaiVideoImageModel)
  ? configuredMaiVideoImageModel
  : DEFAULT_MAIVIDEO_IMAGE_MODEL;
const maivideoPublicUrl = cleanUrl(process.env.MAIVIDEO_PUBLIC_URL, "https://maivideo.top");

export const appConfig = {
  gatewayUrl: cleanUrl(process.env.DOLA_GATEWAY_URL, "http://127.0.0.1:8200"),
  gatewayApiKey: String(process.env.DOLA_GATEWAY_API_KEY || "").trim(),
  gatewayAdminKey: String(process.env.DOLA_GATEWAY_ADMIN_KEY || "").trim(),
  maivideoAuthToken: String(process.env.MAIVIDEO_AUTH_TOKEN || "").trim(),
  maivideoApiKey: String(process.env.MAIVIDEO_API_KEY || "").trim(),
  maivideoBaseUrl: maivideoPublicUrl,
  maivideoImageModel,
  maivideoImageQuality: String(process.env.MAIVIDEO_IMAGE_QUALITY || "1440p").trim(),
  publicUrl: cleanUrl(process.env.DOLA_PUBLIC_URL, "https://seedance.maivideo.top"),
  gatewayPublicUrl: cleanUrl(
    process.env.DOLA_GATEWAY_PUBLIC_URL,
    process.env.DOLA_PUBLIC_URL || "https://seedance.maivideo.top"
  )
};

export const serviceDefinitions = [
  {
    id: "gateway",
    label: "Dola Gateway",
    description: "Điều phối Seedance và hàng đợi render",
    localUrl: appConfig.gatewayUrl,
    publicUrl: appConfig.gatewayPublicUrl,
    healthPath: "/health",
    accent: "blue"
  },
  {
    id: "maivideo",
    label: "MaiVideo",
    description: "MaiVideo API và thư viện media",
    apiUrl: appConfig.maivideoBaseUrl,
    publicUrl: appConfig.maivideoBaseUrl,
    healthPath: "/api/health",
    accent: "mint"
  },
  {
    id: "htmlvideo",
    label: "HTMLVideo",
    description: "Pipeline script → scene → render",
    localUrl: cleanUrl(process.env.HTMLVIDEO_LOCAL_URL, "http://127.0.0.1:3000"),
    publicUrl: cleanUrl(process.env.HTMLVIDEO_PUBLIC_URL, "https://html.maivideo.top"),
    healthPath: "/api/health",
    accent: "violet"
  },
  {
    id: "facebook",
    label: "FB Publisher",
    description: "Lịch đăng và quản lý Page",
    localUrl: cleanUrl(process.env.FB_LOCAL_URL, "http://127.0.0.1:4242"),
    publicUrl: cleanUrl(process.env.FB_PUBLIC_URL, "https://fb.maivideo.top"),
    healthPath: "/api/health",
    accent: "orange"
  }
];

export function gatewayHeaders() {
  const headers = { Accept: "application/json" };
  if (appConfig.gatewayApiKey) {
    headers.Authorization = "Bearer " + appConfig.gatewayApiKey;
  }
  return headers;
}

export function gatewayAdminHeaders(request) {
  const headers = { Accept: "application/json" };
  const requestKey = request?.headers?.get("x-gateway-admin-key")?.trim();
  const adminKey = requestKey || appConfig.gatewayAdminKey;
  if (adminKey) headers["X-Admin-Key"] = adminKey;
  return headers;
}

export function gatewayEndpoint(pathname) {
  return new URL(pathname, appConfig.gatewayUrl + "/").toString();
}

export function maivideoHeaders(request) {
  const headers = { Accept: "application/json" };
  const requestToken = request?.headers?.get("x-maivideo-auth-token")?.trim()
    || request?.headers?.get("x-auth-token")?.trim();
  const cookieToken = request?.cookies?.get?.("dola-maivideo-auth")?.value?.trim();
  // When Dola is served from a subdomain of maivideo.top, MaiVideo's
  // HttpOnly auth cookie may already be scoped to the parent domain.
  const maivideoCookieToken = request?.cookies?.get?.("maivideo_auth")?.value?.trim();
  const authToken = requestToken || cookieToken || maivideoCookieToken || appConfig.maivideoAuthToken;
  if (authToken) {
    headers["X-Auth-Token"] = authToken;
    headers.Authorization = "Bearer " + authToken;
  }

  const sessionId = request?.headers?.get("x-maivideo-session-id")?.trim()
    || request?.headers?.get("x-session-id")?.trim();
  if (sessionId) headers["X-Session-ID"] = sessionId;
  return headers;
}

export function maivideoSessionToken(request) {
  return request?.headers?.get("x-maivideo-auth-token")?.trim()
    || request?.headers?.get("x-auth-token")?.trim()
    || request?.cookies?.get?.("dola-maivideo-auth")?.value?.trim()
    || request?.cookies?.get?.("maivideo_auth")?.value?.trim()
    || appConfig.maivideoAuthToken;
}

export function maivideoApiHeaders(request, includeJson = false) {
  const headers = { Accept: "application/json" };
  if (includeJson) headers["Content-Type"] = "application/json";

  // MaiVideo API v1 documents one authentication method per request.
  // Prefer the server API key; otherwise use the logged-in session token.
  if (appConfig.maivideoApiKey) {
    headers["X-API-Key"] = appConfig.maivideoApiKey;
  } else {
    const sessionToken = maivideoSessionToken(request);
    if (sessionToken) headers.Authorization = "Bearer " + sessionToken;
  }

  const sessionId = request?.headers?.get("x-maivideo-session-id")?.trim()
    || request?.headers?.get("x-session-id")?.trim();
  if (sessionId) headers["X-Session-ID"] = sessionId;
  return headers;
}

export function maivideoEndpoint(pathname) {
  return new URL(pathname, appConfig.maivideoBaseUrl + "/").toString();
}

export function maivideoPublicEndpoint(pathname) {
  return new URL(pathname, appConfig.maivideoBaseUrl + "/").toString();
}

import crypto from "node:crypto";
import {
  appConfig,
  gatewayHeaders,
  maivideoEndpoint,
  maivideoHeaders
} from "@/lib/config";

const OWNER_HEADER = "X-Dola-Owner";

function accessError(status, message) {
  return { ok: false, status, error: message };
}

function stableUserIdentity(user) {
  const candidates = [
    user?.id,
    user?.user_id,
    user?.email,
    user?.session_id
  ];
  return candidates
    .map((value) => String(value || "").trim().toLowerCase())
    .find(Boolean) || "";
}

export function taskOwnerIdForUser(user) {
  const identity = stableUserIdentity(user);
  if (!identity) return "";
  return crypto
    .createHmac("sha256", ownerSecret())
    .update("maivideo:" + identity)
    .digest("hex");
}

function ownerSecret() {
  // The secret never leaves the Studio server. Reusing the internal Gateway
  // API key keeps existing local setups working; deployments can override it
  // with a dedicated DOLA_TASK_OWNER_SECRET.
  return String(
    process.env.DOLA_TASK_OWNER_SECRET
      || appConfig.gatewayApiKey
      || appConfig.gatewayAdminKey
      || "dola-task-owner-v1"
  );
}

function isLoopbackRequest(request) {
  try {
    const host = request?.headers?.get?.("host");
    const hostname = host
      ? new URL("http://" + host).hostname
      : new URL(request.url).hostname;
    const normalized = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    return normalized === "localhost"
      || normalized.endsWith(".localhost")
      || normalized === "::1"
      || /^127(?:\.\d{1,3}){3}$/.test(normalized);
  } catch {
    return false;
  }
}

export function taskOwnerHeaders(ownerId, request) {
  const headers = { ...gatewayHeaders(request) };
  if (ownerId) {
    headers[OWNER_HEADER] = ownerId;
    const internalSecret = String(
      appConfig.gatewayAdminKey
        || appConfig.gatewayApiKey
        || process.env.DOLA_TASK_OWNER_SECRET
        || ""
    ).trim();
    if (internalSecret) {
      headers["X-Dola-Internal-Signature"] = crypto
        .createHmac("sha256", internalSecret)
        .update("dola-studio-owner:" + ownerId)
        .digest("hex");
    }
  }
  return headers;
}

export async function resolveTaskAccess(request) {
  // Local Studio runs without a MaiVideo login. Keep this bypass restricted
  // to requests addressed to a loopback hostname; deployed hostnames still
  // use MaiVideo authentication and owner scoping below.
  if (isLoopbackRequest(request)) {
    const user = { id: "dola-local-operator", email: "local@localhost", role: "user" };
    return { ok: true, user, ownerId: taskOwnerIdForUser(user), isAdmin: false };
  }

  let response;
  try {
    response = await fetch(maivideoEndpoint("/api/auth/me"), {
      cache: "no-store",
      headers: maivideoHeaders(request),
      signal: AbortSignal.timeout(5000)
    });
  } catch (error) {
    return accessError(
      503,
      error?.name === "TimeoutError"
        ? "MaiVideo không phản hồi kịp thời"
        : "Không kết nối được MaiVideo để xác định người dùng"
    );
  }

  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (!response.ok || !payload?.user) {
    return accessError(
      response.status === 401 ? 401 : response.status || 503,
      response.status === 401
        ? "Vui lòng đăng nhập MaiVideo để xem hàng đợi"
        : "Không xác định được phiên MaiVideo"
    );
  }

  const user = payload.user;
  const identity = stableUserIdentity(user);
  if (!identity) return accessError(401, "Phiên MaiVideo không có định danh người dùng");

  const ownerId = taskOwnerIdForUser(user);

  return {
    ok: true,
    user,
    ownerId,
    isAdmin: String(user.role || "").trim().toLowerCase() === "admin"
  };
}

export function taskAccessErrorResponse(NextResponse, access) {
  return NextResponse.json(
    { error: access?.error || "Không xác định được quyền truy cập hàng đợi" },
    { status: access?.status || 401, headers: { "Cache-Control": "no-store" } }
  );
}

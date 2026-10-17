import { NextResponse } from "next/server";
import { gatewayAdminHeaders, gatewayEndpoint, maivideoEndpoint, maivideoHeaders } from "@/lib/config";
import { resolveTaskAccess, taskAccessErrorResponse, taskOwnerIdForUser, taskOwnerHeaders } from "@/lib/task-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OWNER_DIRECTORY_CACHE_MS = 60_000;
const GATEWAY_QUEUE_TIMEOUT_MS = 12_000;
let ownerDirectoryCache = { expiresAt: 0, labels: new Map() };
let ownerDirectoryRequest = null;

function getAdminOwnerLabels(request) {
  if (ownerDirectoryCache.expiresAt > Date.now()) {
    return Promise.resolve(ownerDirectoryCache.labels);
  }
  if (ownerDirectoryRequest) return ownerDirectoryRequest;

  ownerDirectoryRequest = (async () => {
    try {
      const response = await fetch(maivideoEndpoint("/api/admin/users"), {
        cache: "no-store",
        headers: maivideoHeaders(request),
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error("MaiVideo user directory unavailable");
      const payload = await response.json();
      const users = Array.isArray(payload?.items) ? payload.items : [];
      const labels = new Map();
      for (const user of users) {
        const ownerId = taskOwnerIdForUser(user).toLowerCase();
        const email = String(user?.email || "").trim();
        if (/^[a-f0-9]{64}$/.test(ownerId) && email) labels.set(ownerId, email);
      }
      ownerDirectoryCache = { expiresAt: Date.now() + OWNER_DIRECTORY_CACHE_MS, labels };
      return labels;
    } catch {
      // Keep the last successful mapping so a temporary MaiVideo outage does
      // not turn the admin's owner filter back into opaque hashes.
      ownerDirectoryCache = {
        expiresAt: Date.now() + 10_000,
        labels: ownerDirectoryCache.labels
      };
      return ownerDirectoryCache.labels;
    } finally {
      ownerDirectoryRequest = null;
    }
  })();
  return ownerDirectoryRequest;
}

function toIsoTimestamp(value) {
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function decodeMetadata(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function decodeReferences(value) {
  if (!value) return [];
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];
  return values
    .map((item) => String(item || "").trim())
    .filter((item) => /^https?:\/\//i.test(item))
    .slice(0, 30);
}

function decodeReferenceNames(value) {
  if (!value) return [];
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];
  return values.map((item) => String(item || "").trim()).slice(0, 30);
}

function normalizeTask(row, includeOwnerId = false) {
  const status = String(row?.status || "unknown");
  const ratio = String(row?.ratio || "").trim();
  // A completed task has a valid output; older Gateway rows may still carry
  // the transient "still processing" message from the last poll window.
  const error = status === "completed" && (row?.video_url || row?.videoUrl)
    ? null
    : row?.error || null;
  const explicitFailureCode = row?.failure_code || row?.failureCode || null;
  const retryCount = Math.max(0, Number(row?.retry_count || row?.retryCount || 0) || 0);
  const rawReferenceMode = String(row?.reference_image_mode || row?.referenceImageMode || "").trim().toLowerCase();
  const referenceImageMode = rawReferenceMode === "sketch"
    || String(row?.prompt || "").toLowerCase().includes("[color restoration]")
    ? "sketch"
    : "none";
  return {
    id: String(row?.id || ""),
    status,
    model: row?.model || null,
    duration: Number(row?.duration || 0) || null,
    account: row?.account || null,
    ratio: ratio && ratio !== "default" ? ratio : null,
    prompt: row?.prompt || "",
    submittedAt: toIsoTimestamp(row?.submittedAt || row?.last_retry_at || row?.created_at || row?.createdAt),
    createdAt: toIsoTimestamp(row?.created_at || row?.createdAt),
    startedAt: toIsoTimestamp(row?.started_at || row?.startedAt),
    finishedAt: toIsoTimestamp(row?.finished_at || row?.finishedAt),
    updatedAt: toIsoTimestamp(row?.updated_at || row?.updatedAt),
    videoUrl: row?.video_url || row?.videoUrl || null,
    error,
    // Older Gateway rows recorded a polling timeout without a failure code;
    // classify that known error so the queue explains why recreate is useful.
    failureCode: explicitFailureCode || (typeof error === "string" && /No video generated within/i.test(error)
      ? "RENDER_TIMEOUT"
      : null),
    timings: decodeMetadata(row?.timings_json || row?.timings),
    retryOf: row?.retry_of || row?.retryOf || null,
    retryCount,
    videoMetadata: decodeMetadata(row?.video_metadata || row?.videoMetadata),
    referenceImages: decodeReferences(row?.reference_images || row?.referenceImages),
    referenceImageNames: decodeReferenceNames(row?.reference_image_names || row?.referenceImageNames),
    referenceImageMode,
    ...(includeOwnerId ? { ownerId: String(row?.owner_id || row?.ownerId || "") || null } : {}),
    provider: "gateway"
  };
}

function gatewayError(error) {
  const message = error?.name === "TimeoutError"
    ? "Gateway không phản hồi kịp thời"
    : "Không kết nối được Dola Gateway theo cấu hình hiện tại";
  return NextResponse.json({ error: message }, { status: 503 });
}

export async function GET(request) {
  const searchParams = new URL(request.url).searchParams;
  const rawLimit = Number(searchParams.get("limit") || 100);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), 500);
  const rawOffset = Number(searchParams.get("offset") || 0);
  const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0);
  const access = await resolveTaskAccess(request);
  if (!access.ok) return taskAccessErrorResponse(NextResponse, access);
  const scope = access.isAdmin ? "admin" : "user";
  const requestedOwner = String(searchParams.get("owner") || "me").trim();
  if (access.isAdmin && requestedOwner !== "me" && requestedOwner !== "all"
    && !/^[a-f0-9]{64}$/i.test(requestedOwner)) {
    return NextResponse.json(
      { error: "Bộ lọc user không hợp lệ" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  const ownerSelection = access.isAdmin ? requestedOwner.toLowerCase() : "me";
  const gatewayParams = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (access.isAdmin) {
    if (ownerSelection !== "all") {
      gatewayParams.set("owner_id", ownerSelection === "me" ? access.ownerId : ownerSelection);
    }
    if (offset === 0) gatewayParams.set("include_owners", "true");
  }
  const endpoint = access.isAdmin
    ? "/api/admin/tasks?" + gatewayParams.toString()
    : "/api/tasks?limit=" + limit + "&offset=" + offset;
  const headers = access.isAdmin
    ? gatewayAdminHeaders(request)
    : taskOwnerHeaders(access.ownerId, request);

  try {
    const [response, ownerLabels] = await Promise.all([
      fetch(gatewayEndpoint(endpoint), {
        cache: "no-store",
        headers,
        signal: AbortSignal.timeout(GATEWAY_QUEUE_TIMEOUT_MS)
      }),
      access.isAdmin && offset === 0
        ? getAdminOwnerLabels(request)
        : Promise.resolve(new Map())
    ]);
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { detail: raw.slice(0, 300) };
    }
    if (!response.ok) {
      return NextResponse.json(
        { error: payload.detail || payload.error || "Không đọc được hàng đợi từ Gateway" },
        { status: response.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    const rows = Array.isArray(payload.tasks)
      ? payload.tasks
      : Array.isArray(payload.jobs)
        ? payload.jobs
        : null;
    if (!rows) {
      const receivedKeys = payload && typeof payload === "object"
        ? Object.keys(payload).slice(0, 8).join(", ")
        : typeof payload;
      return NextResponse.json(
        { error: `Gateway trả payload hàng đợi sai định dạng (nhận: ${receivedKeys || "rỗng"})` },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }
    const totalValue = Number(payload.total);
    const total = Number.isFinite(totalValue) && totalValue >= 0
      ? totalValue
      : offset + rows.length;
    const hasMore = typeof payload.has_more === "boolean"
      ? payload.has_more
      : typeof payload.hasMore === "boolean"
        ? payload.hasMore
        : offset + rows.length < total;
    const ownersById = new Map(
      (Array.isArray(payload.owners) ? payload.owners : [])
        .filter((owner) => /^[a-f0-9]{64}$/i.test(String(owner?.owner_id || "")))
        .map((owner) => [String(owner.owner_id).toLowerCase(), {
          ownerId: String(owner.owner_id).toLowerCase(),
          count: Math.max(0, Number(owner.count) || 0),
        }])
    );
    if (access.isAdmin && !ownersById.has(access.ownerId)) {
      ownersById.set(access.ownerId, { ownerId: access.ownerId, count: 0 });
    }
    const owners = access.isAdmin
      ? Array.from(ownersById.values())
          .sort((left, right) => right.count - left.count || left.ownerId.localeCompare(right.ownerId))
          .map((owner) => ({
            ...owner,
            label: ownerLabels.get(owner.ownerId)
              || (owner.ownerId === access.ownerId
                ? String(access.user?.email || "Tôi (admin)")
                : "User · " + owner.ownerId.slice(0, 8)),
          }))
      : [];
    return NextResponse.json(
      {
        scope,
        ownerSelection,
        currentOwnerId: access.isAdmin ? access.ownerId : null,
        owners,
        jobs: rows.map((row) => normalizeTask(row, access.isAdmin)).filter((job) => job.id),
        total,
        limit,
        offset,
        hasMore,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    return gatewayError(error);
  }
}

import { NextResponse } from "next/server";
import { gatewayAdminHeaders, gatewayEndpoint } from "@/lib/config";
import { resolveTaskAccess, taskAccessErrorResponse, taskOwnerHeaders } from "@/lib/task-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePayload(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { error: raw || "Gateway trả về dữ liệu không hợp lệ" };
  }
}

function jsonHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache"
  };
}

export async function GET(request, { params }) {
  const resolvedParams = await params;
  const taskId = String(resolvedParams?.id || "").trim();
  if (!taskId || taskId.startsWith("local_failed_")) {
    return NextResponse.json({ error: "Tác vụ cục bộ không có trên gateway" }, { status: 404 });
  }

  const access = await resolveTaskAccess(request);
  if (!access.ok) return taskAccessErrorResponse(NextResponse, access);
  const endpoint = access.isAdmin
    ? "/api/admin/tasks/status?ids=" + encodeURIComponent(taskId)
    : "/v1/videos/" + encodeURIComponent(taskId);
  const headers = access.isAdmin
    ? gatewayAdminHeaders(request)
    : taskOwnerHeaders(access.ownerId, request);

  try {
    const response = await fetch(gatewayEndpoint(endpoint), {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers
    });
    const raw = await response.text();
    const payload = parsePayload(raw);
    const normalizedPayload = access.isAdmin
      ? (Array.isArray(payload.tasks) ? payload.tasks[0] : null)
      : payload;
    if (response.ok && !normalizedPayload) {
      return NextResponse.json({ error: "task not found" }, { status: 404, headers: jsonHeaders() });
    }
    return NextResponse.json(normalizedPayload, {
      status: response.status,
      headers: jsonHeaders()
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Không thể đọc trạng thái tác vụ" },
      { status: 502 }
    );
  }
}

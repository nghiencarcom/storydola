import { NextResponse } from "next/server";
import { gatewayAdminHeaders, gatewayEndpoint } from "@/lib/config";
import { resolveTaskAccess, taskAccessErrorResponse, taskOwnerHeaders } from "@/lib/task-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorMessage(payload, status) {
  if (payload && typeof payload === "object") {
    if (typeof payload.detail === "string") return payload.detail;
    if (typeof payload.error === "string") return payload.error;
    if (typeof payload.message === "string") return payload.message;
  }
  return "Gateway trả về HTTP " + status;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }

  const ids = Array.isArray(body?.ids)
    ? Array.from(new Set(body.ids.map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 500)
    : [];
  if (!ids.length) {
    return NextResponse.json({ error: "Hãy chọn ít nhất một tác vụ" }, { status: 422 });
  }

  const access = await resolveTaskAccess(request);
  if (!access.ok) return taskAccessErrorResponse(NextResponse, access);
  const endpoint = access.isAdmin ? "/api/admin/tasks/cancel" : "/api/tasks/cancel";
  const headers = access.isAdmin
    ? gatewayAdminHeaders(request)
    : taskOwnerHeaders(access.ownerId, request);

  try {
    const response = await fetch(gatewayEndpoint(endpoint), {
      method: "POST",
      cache: "no-store",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(15000)
    });
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { detail: raw.slice(0, 300) };
    }
    if (!response.ok) {
      return NextResponse.json(
        { error: errorMessage(payload, response.status) },
        { status: response.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error?.name === "TimeoutError" ? "Gateway không phản hồi kịp thời" : "Không kết nối được Dola Gateway theo cấu hình hiện tại" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

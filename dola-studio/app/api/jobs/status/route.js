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

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }

  const ids = Array.isArray(body?.ids)
    ? Array.from(new Set(body.ids.map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 100)
    : [];
  if (!ids.length) {
    return NextResponse.json({ error: "Hãy gửi ít nhất một task id" }, { status: 422 });
  }

  const access = await resolveTaskAccess(request);
  if (!access.ok) return taskAccessErrorResponse(NextResponse, access);
  const endpoint = access.isAdmin
    ? "/api/admin/tasks/status?ids="
    : "/v1/videos/status?ids=";
  const headers = access.isAdmin
    ? gatewayAdminHeaders(request)
    : taskOwnerHeaders(access.ownerId, request);

  try {
    const response = await fetch(
      gatewayEndpoint(endpoint + encodeURIComponent(ids.join(","))),
      {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
        headers
      }
    );
    const payload = parsePayload(await response.text());
    return NextResponse.json(payload, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.name === "TimeoutError" ? "Gateway không phản hồi kịp thời" : error?.message || "Không thể đọc trạng thái tác vụ" },
      { status: 502 }
    );
  }
}

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

export async function POST(request, { params }) {
  const resolvedParams = await params;
  const taskId = String(resolvedParams?.id || "").trim();
  if (!taskId || taskId.startsWith("local_failed_")) {
    return NextResponse.json(
      { error: "Tác vụ cục bộ không thể recreate trực tiếp từ Gateway" },
      {
        status: 404,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" }
      }
    );
  }

  const access = await resolveTaskAccess(request);
  if (!access.ok) return taskAccessErrorResponse(NextResponse, access);
  const headers = access.isAdmin
    ? { ...gatewayAdminHeaders(request), "X-Dola-Admin-Request": "1" }
    : taskOwnerHeaders(access.ownerId, request);
  const rawRequestBody = await request.text();
  let requestBody = null;
  if (rawRequestBody.trim()) {
    try {
      requestBody = JSON.parse(rawRequestBody);
    } catch {
      return NextResponse.json(
        { error: "Body JSON không hợp lệ" },
        { status: 400, headers: { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" } }
      );
    }
  }

  try {
    const gatewayHeaders = requestBody
      ? { ...headers, "Content-Type": "application/json" }
      : headers;
    const response = await fetch(
      gatewayEndpoint("/v1/videos/" + encodeURIComponent(taskId) + "/retry"),
      {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
        headers: gatewayHeaders,
        ...(requestBody ? { body: JSON.stringify(requestBody) } : {})
      }
    );
    const raw = await response.text();
    return NextResponse.json(parsePayload(raw), {
      status: response.status,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.name === "TimeoutError"
        ? "Gateway không phản hồi kịp thời khi tạo lại tác vụ"
        : error?.message || "Không thể tạo lại tác vụ từ Gateway" },
      {
        status: 502,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" }
      }
    );
  }
}

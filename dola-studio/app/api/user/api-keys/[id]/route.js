import { NextResponse } from "next/server";
import { gatewayAdminHeaders, gatewayEndpoint } from "@/lib/config";
import {
  resolveTaskAccess,
  taskAccessErrorResponse
} from "@/lib/task-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const access = await resolveTaskAccess(request);
  if (!access.ok) return taskAccessErrorResponse(NextResponse, access);

  const resolvedParams = await params;
  const keyId = String(resolvedParams?.id || "").trim();
  if (!/^[0-9a-f]{64}$/.test(keyId)) {
    return NextResponse.json(
      { error: "API key không tồn tại" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const response = await fetch(
      gatewayEndpoint("/api/admin/user-keys/" + encodeURIComponent(keyId)),
      {
        cache: "no-store",
        headers: {
          ...gatewayAdminHeaders(),
          "X-Dola-Owner-ID": access.ownerId
        },
        signal: AbortSignal.timeout(10000)
      }
    );
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { error: raw || "Gateway trả về dữ liệu không hợp lệ" };
    }
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.name === "TimeoutError" ? "Gateway không phản hồi kịp thời" : error?.message || "Không thể lấy API key" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function DELETE(request, { params }) {
  const access = await resolveTaskAccess(request);
  if (!access.ok) return taskAccessErrorResponse(NextResponse, access);

  const resolvedParams = await params;
  const keyId = String(resolvedParams?.id || "").trim();
  if (!/^[0-9a-f]{64}$/.test(keyId)) {
    return NextResponse.json(
      { error: "API key không tồn tại" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const response = await fetch(
      gatewayEndpoint("/api/admin/user-keys/" + encodeURIComponent(keyId)),
      {
        method: "DELETE",
        cache: "no-store",
        headers: {
          ...gatewayAdminHeaders(),
          "X-Dola-Owner-ID": access.ownerId
        },
        signal: AbortSignal.timeout(10000)
      }
    );
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { error: raw || "Gateway trả về dữ liệu không hợp lệ" };
    }
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.name === "TimeoutError" ? "Gateway không phản hồi kịp thời" : error?.message || "Không thể thu hồi API key" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

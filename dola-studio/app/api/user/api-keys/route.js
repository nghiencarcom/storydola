import { NextResponse } from "next/server";
import { gatewayAdminHeaders, gatewayEndpoint } from "@/lib/config";
import {
  resolveTaskAccess,
  taskAccessErrorResponse
} from "@/lib/task-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache"
};

async function gatewayResponse(response) {
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { error: raw || "Gateway trả về dữ liệu không hợp lệ" };
  }
  return NextResponse.json(payload, { status: response.status, headers: NO_CACHE });
}

async function getOwnerAccess(request) {
  const access = await resolveTaskAccess(request);
  if (!access.ok) return { response: taskAccessErrorResponse(NextResponse, access) };
  return { ownerId: access.ownerId };
}

export async function GET(request) {
  const access = await getOwnerAccess(request);
  if (access.response) return access.response;

  try {
    const headers = {
      ...gatewayAdminHeaders(),
      "X-Dola-Owner-ID": access.ownerId
    };
    const response = await fetch(gatewayEndpoint("/api/admin/user-keys"), {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(10000)
    });
    return await gatewayResponse(response);
  } catch (error) {
    return NextResponse.json(
      { error: error?.name === "TimeoutError" ? "Gateway không phản hồi kịp thời" : error?.message || "Không thể đọc API key" },
      { status: 502, headers: NO_CACHE }
    );
  }
}

export async function POST(request) {
  const access = await getOwnerAccess(request);
  if (access.response) return access.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400, headers: NO_CACHE });
  }
  const name = String(body?.name || "Seedance API").trim();
  if (!name || name.length > 64) {
    return NextResponse.json({ error: "Tên API key cần từ 1 đến 64 ký tự" }, { status: 422, headers: NO_CACHE });
  }

  try {
    const response = await fetch(gatewayEndpoint("/api/admin/user-keys"), {
      method: "POST",
      cache: "no-store",
      headers: {
        ...gatewayAdminHeaders(),
        "X-Dola-Owner-ID": access.ownerId,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(10000)
    });
    return await gatewayResponse(response);
  } catch (error) {
    return NextResponse.json(
      { error: error?.name === "TimeoutError" ? "Gateway không phản hồi kịp thời" : error?.message || "Không thể tạo API key" },
      { status: 502, headers: NO_CACHE }
    );
  }
}

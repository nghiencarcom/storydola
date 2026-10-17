import { NextResponse } from "next/server";
import { gatewayAdminHeaders, gatewayEndpoint } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const response = await fetch(gatewayEndpoint("/api/admin/proxies/bulk-rotate"), {
      method: "POST",
      cache: "no-store",
      headers: { ...gatewayAdminHeaders(request), "Content-Type": "application/json" },
      body: JSON.stringify(await request.json()),
      signal: AbortSignal.timeout(120000)
    });
    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { detail: raw.slice(0, 300) }; }
    if (!response.ok) {
      return NextResponse.json(
        { error: payload.detail || payload.error || "Gateway từ chối đổi IP hàng loạt" },
        { status: response.status }
      );
    }
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json({
      error: error?.name === "TimeoutError"
        ? "Đổi IP hàng loạt quá thời gian chờ"
        : "Không kết nối được Dola Gateway theo cấu hình hiện tại"
    }, { status: 503 });
  }
}

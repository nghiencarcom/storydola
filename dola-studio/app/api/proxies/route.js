import { NextResponse } from "next/server";
import { gatewayAdminHeaders, gatewayEndpoint } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readPayload(response) {
  const raw = await response.text();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { detail: raw.slice(0, 300) }; }
}

function message(payload, status) {
  return payload?.detail || payload?.error || payload?.message || "Gateway trả về HTTP " + status;
}

async function forward(request, method = "GET") {
  try {
    const response = await fetch(gatewayEndpoint("/api/admin/proxies"), {
      method,
      cache: "no-store",
      headers: { ...gatewayAdminHeaders(request), ...(method !== "GET" ? { "Content-Type": "application/json" } : {}) },
      body: method !== "GET" ? JSON.stringify(await request.json()) : undefined,
      signal: AbortSignal.timeout(10000)
    });
    const payload = await readPayload(response);
    if (!response.ok) return NextResponse.json({ error: message(payload, response.status) }, { status: response.status });
    return NextResponse.json(payload, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error?.name === "TimeoutError" ? "Gateway không phản hồi kịp thời" : "Không kết nối được Dola Gateway theo cấu hình hiện tại" }, { status: 503 });
  }
}

export async function GET(request) { return forward(request, "GET"); }
export async function POST(request) { return forward(request, "POST"); }

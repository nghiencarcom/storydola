import { NextResponse } from "next/server";
import { serviceDefinitions } from "@/lib/config";

export const dynamic = "force-dynamic";

function safeGatewayMeta(payload) {
  if (!payload || typeof payload !== "object") return {};
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  return {
    pendingTasks: Number.isFinite(payload.pending_tasks) ? payload.pending_tasks : null,
    maxPendingTasks: Number.isFinite(payload.max_pending_tasks) ? payload.max_pending_tasks : null,
    accounts: accounts.length || null
  };
}

async function checkService(service) {
  const startedAt = Date.now();
  const endpoint = (service.apiUrl || service.localUrl) + service.healthPath;
  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      signal: AbortSignal.timeout(1800),
      headers: { Accept: "application/json" }
    });
    const body = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = null;
    }
    return {
      ...service,
      status: response.ok ? "online" : "degraded",
      latencyMs: Date.now() - startedAt,
      httpStatus: response.status,
      meta: service.id === "gateway" ? safeGatewayMeta(payload) : {}
    };
  } catch (error) {
    return {
      ...service,
      status: "offline",
      latencyMs: Date.now() - startedAt,
      httpStatus: null,
      meta: {},
      error: error?.name === "TimeoutError" ? "Quá thời gian phản hồi" : "Không kết nối được"
    };
  }
}

export async function GET() {
  const services = await Promise.all(serviceDefinitions.map(checkService));
  return NextResponse.json(
    { checkedAt: new Date().toISOString(), services },
    { headers: { "Cache-Control": "no-store" } }
  );
}

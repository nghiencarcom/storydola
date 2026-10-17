import { NextResponse } from "next/server";

export const runtime = "nodejs";

function gatewayBaseUrl() {
  return (process.env.STORYAI_SEEDANCE_GATEWAY_URL?.trim() || process.env.DOLA_GATEWAY_URL?.trim() || "http://127.0.0.1:8210").replace(/\/+$/, "");
}

export async function GET() {
  try {
    const response = await fetch(`${gatewayBaseUrl()}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return NextResponse.json({ reachable: false }, { headers: { "Cache-Control": "no-store" } });
    const health = await response.json() as Record<string, unknown>;
    const accounts = Array.isArray(health.accounts) ? health.accounts : [];
    return NextResponse.json({
      reachable: health.ok === true,
      profileCount: accounts.length,
      profilePoolReady: health.available === true,
      pendingTasks: Number.isFinite(Number(health.pending_tasks)) ? Number(health.pending_tasks) : 0,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ reachable: false }, { headers: { "Cache-Control": "no-store" } });
  }
}

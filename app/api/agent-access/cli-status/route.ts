import { NextResponse } from "next/server";
import { getCodingAgentCliStatuses } from "../../../lib/coding-agent-cli";
import { getCurrentUserId } from "../../../lib/auth-server";

export const runtime = "nodejs";

export async function GET() {
  try {
    await getCurrentUserId();
    return NextResponse.json({ agents: await getCodingAgentCliStatuses() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để kiểm tra Code Agent." }, { status: 401 });
  }
}

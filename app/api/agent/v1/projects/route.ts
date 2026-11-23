import { NextResponse } from "next/server";
import { getCurrentUserId } from "../../../../lib/auth-server";
import { readDataForUser } from "../../../../lib/server-store";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getCurrentUserId();
  const data = await readDataForUser(userId);
  return NextResponse.json({ projects: data.projects }, { headers: { "Cache-Control": "no-store" } });
}

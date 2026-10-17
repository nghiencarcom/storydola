import { NextResponse } from "next/server";
import { getMaiVideoModelCatalog } from "../../lib/media-provider";

export const runtime = "nodejs";

export async function GET() {
  const catalog = await getMaiVideoModelCatalog();
  return NextResponse.json(catalog, { headers: { "Cache-Control": "no-store" } });
}

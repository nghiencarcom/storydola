import { NextResponse } from "next/server";
import { getOmniVoiceCatalog } from "../../../lib/omnivoice-server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const catalog = await getOmniVoiceCatalog();
    return NextResponse.json(catalog, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return NextResponse.json({
      provider: "omnivoice",
      voices: [],
      languages: [],
      message: cause instanceof Error ? cause.message : "Không lấy được danh sách giọng OmniVoice.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

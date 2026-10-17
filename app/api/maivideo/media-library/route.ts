import { NextResponse } from "next/server";
import { listMaiVideoLibraryImages, MaiVideoLibraryError } from "../../../lib/maivideo-media-library";

export const runtime = "nodejs";

export async function GET() {
  try {
    const images = await listMaiVideoLibraryImages();
    return NextResponse.json({ ok: true, images }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const error = cause instanceof MaiVideoLibraryError ? cause : new MaiVideoLibraryError("Không thể kết nối thư viện media MaiVideo.");
    return NextResponse.json({ ok: false, message: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
}

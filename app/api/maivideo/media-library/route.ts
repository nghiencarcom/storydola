import { NextResponse } from "next/server";
import { listMaiVideoLibraryImages, MaiVideoLibraryError } from "../../../lib/maivideo-media-library";
import { readMaiVideoAuthCookie, resolveMaiVideoAuthBaseUrl } from "../../../lib/maivideo-auth-shared";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const images = await listMaiVideoLibraryImages({ session: { token: readMaiVideoAuthCookie(request.headers.get("cookie")), baseUrl: resolveMaiVideoAuthBaseUrl(request) } });
    return NextResponse.json({ ok: true, images }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const error = cause instanceof MaiVideoLibraryError ? cause : new MaiVideoLibraryError("Không thể kết nối thư viện media MaiVideo.");
    return NextResponse.json({ ok: false, message: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
}

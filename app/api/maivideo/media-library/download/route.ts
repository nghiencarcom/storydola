import { NextResponse } from "next/server";
import { downloadMaiVideoLibraryImage, MaiVideoLibraryError } from "../../../../lib/maivideo-media-library";
import { readMaiVideoAuthCookie, resolveMaiVideoAuthBaseUrl } from "../../../../lib/maivideo-auth-shared";
import { salesVideoImageLimit } from "../../../../lib/sales-video-templates";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim() || "";
  if (!id) return NextResponse.json({ message: "Thiếu mã ảnh MaiVideo." }, { status: 400 });
  try {
    const { bytes, mimeType } = await downloadMaiVideoLibraryImage(id, {
      token: readMaiVideoAuthCookie(request.headers.get("cookie")),
      baseUrl: resolveMaiVideoAuthBaseUrl(request),
    }, salesVideoImageLimit);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (cause) {
    const error = cause instanceof MaiVideoLibraryError ? cause : new MaiVideoLibraryError("Không thể tải ảnh gốc từ MaiVideo.");
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
}

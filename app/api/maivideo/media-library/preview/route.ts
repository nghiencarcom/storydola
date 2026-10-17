import { NextResponse } from "next/server";
import { fetchMaiVideoLibraryPreview, MaiVideoLibraryError } from "../../../../lib/maivideo-media-library";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim() || "";
  if (!id) return NextResponse.json({ message: "Thiếu mã ảnh MaiVideo." }, { status: 400 });
  try {
    const { bytes, contentType } = await fetchMaiVideoLibraryPreview(id);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (cause) {
    const error = cause instanceof MaiVideoLibraryError ? cause : new MaiVideoLibraryError("Không thể tải ảnh xem trước MaiVideo.");
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
}

import { NextResponse } from "next/server";
import { verifySeedanceCharacterReferenceSignature } from "../../../../../lib/seedance-reference-links";
import { readTimelapseImage } from "../../../../../lib/timelapse-storage";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ workflowId: string; imageId: string }> }) {
  const { workflowId, imageId } = await context.params;
  const url = new URL(request.url);
  const ownerId = url.searchParams.get("owner") || "";
  const validSignature = (() => {
    try {
      return verifySeedanceCharacterReferenceSignature(workflowId, imageId, ownerId, url.searchParams.get("expires") || "", url.searchParams.get("signature") || "", "timelapse");
    } catch {
      return false;
    }
  })();
  if (!validSignature) return NextResponse.json({ message: "Liên kết ảnh Timelapse đã hết hạn hoặc không hợp lệ." }, { status: 403 });
  try {
    const image = await readTimelapseImage(ownerId, workflowId, imageId);
    if (!image) return NextResponse.json({ message: "Không tìm thấy ảnh Timelapse." }, { status: 404 });
    return new Response(new Uint8Array(image.bytes), {
      headers: { "Content-Type": image.contentType, "Content-Length": String(image.bytes.length), "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ message: "Không thể đọc ảnh Timelapse." }, { status: 500 });
  }
}

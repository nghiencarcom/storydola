import { NextResponse } from "next/server";
import { isLocalOnlyRequest, readBatchReferenceImage } from "../../../../../lib/batch-local-media.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  if (!isLocalOnlyRequest(request)) {
    return NextResponse.json({ error: "Ảnh tham chiếu chỉ được truy cập trên máy local." }, { status: 403 });
  }
  const { id } = await context.params;
  const image = await readBatchReferenceImage(id).catch(() => null);
  if (!image) return NextResponse.json({ error: "Không tìm thấy ảnh local." }, { status: 404 });

  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.record.mimeType,
      "Content-Length": String(image.bytes.length),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

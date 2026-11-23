import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { salesVideoReferencePath } from "../../../../../lib/sales-video-storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const userId = _request.headers.get("x-storyai-user-id")?.trim();
  if (!userId) return NextResponse.json({ message: "Vui lòng đăng nhập." }, { status: 401 });
  const { id, kind } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id) || (kind !== "presenter" && !/^product(?:-[2-5])?$/.test(kind))) {
    return NextResponse.json({ message: "Không tìm thấy ảnh tham chiếu." }, { status: 404 });
  }
  try {
    const productIndex = kind === "product" ? 0 : Number(kind.slice("product-".length)) - 1;
    const image = await readFile(kind === "presenter"
      ? salesVideoReferencePath(userId, id, "presenter")
      : salesVideoReferencePath(userId, id, "product", productIndex));
    return new NextResponse(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ message: "Không tìm thấy ảnh tham chiếu." }, { status: 404 });
  }
}

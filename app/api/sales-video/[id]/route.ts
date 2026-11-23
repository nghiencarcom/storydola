import { NextResponse } from "next/server";
import { renderFileResponse } from "../../../lib/render-file-response";
import { salesVideoOwnerDirectory, salesVideoPath } from "../../../lib/sales-video-storage";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = request.headers.get("x-storyai-user-id")?.trim();
  if (!userId) return NextResponse.json({ message: "Vui lòng đăng nhập." }, { status: 401 });
  const { id } = await params;
  return renderFileResponse(request, {
    localPath: /^[a-f0-9-]{36}$/.test(id) ? salesVideoPath(userId, id) : undefined,
    outputRoot: salesVideoOwnerDirectory(userId),
    kind: "video",
    filenameBase: "video-ban-hang",
    missingMessage: "Không tìm thấy video bán hàng.",
  });
}

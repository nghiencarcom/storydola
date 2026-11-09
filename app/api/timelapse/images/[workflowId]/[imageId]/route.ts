import { NextResponse } from "next/server";
import { deleteTimelapseImage, readTimelapseImage, safeTimelapseId } from "../../../../../lib/timelapse-storage";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ workflowId: string; imageId: string }> }) {
  const userId = request.headers.get("x-storyai-user-id")?.trim() || "";
  if (!userId) return NextResponse.json({ message: "Vui lòng đăng nhập để xem ảnh." }, { status: 401 });
  const { workflowId: rawWorkflowId, imageId: rawImageId } = await context.params;
  const workflowId = safeTimelapseId(rawWorkflowId);
  const imageId = safeTimelapseId(rawImageId);
  if (!workflowId || !imageId) return NextResponse.json({ message: "Không tìm thấy ảnh Timelapse." }, { status: 404 });
  try {
    const image = await readTimelapseImage(userId, workflowId, imageId);
    if (!image) return NextResponse.json({ message: "Không tìm thấy ảnh Timelapse." }, { status: 404 });
    return new Response(new Uint8Array(image.bytes), { headers: { "Content-Type": image.contentType, "Content-Length": String(image.bytes.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ message: "Không thể đọc ảnh Timelapse." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ workflowId: string; imageId: string }> }) {
  const userId = request.headers.get("x-storyai-user-id")?.trim() || "";
  if (!userId) return NextResponse.json({ message: "Vui lòng đăng nhập để xóa ảnh." }, { status: 401 });
  const { workflowId: rawWorkflowId, imageId: rawImageId } = await context.params;
  const workflowId = safeTimelapseId(rawWorkflowId);
  const imageId = safeTimelapseId(rawImageId);
  if (!workflowId || !imageId) return NextResponse.json({ message: "Không tìm thấy ảnh Timelapse." }, { status: 404 });
  const removed = await deleteTimelapseImage(userId, workflowId, imageId);
  return removed ? NextResponse.json({ ok: true }) : NextResponse.json({ message: "Không tìm thấy ảnh Timelapse." }, { status: 404 });
}

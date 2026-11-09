import { NextResponse } from "next/server";
import { deleteTimelapseWorkflow, safeTimelapseId } from "../../../../lib/timelapse-storage";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ workflowId: string }> }) {
  const userId = request.headers.get("x-storyai-user-id")?.trim() || "";
  if (!userId) return NextResponse.json({ message: "Vui lòng đăng nhập để xóa workflow." }, { status: 401 });
  const { workflowId: rawWorkflowId } = await context.params;
  const workflowId = safeTimelapseId(rawWorkflowId);
  if (!workflowId) return NextResponse.json({ message: "Mã workflow không hợp lệ." }, { status: 400 });
  try {
    await deleteTimelapseWorkflow(userId, workflowId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "Không thể xóa workflow Timelapse." }, { status: 500 });
  }
}

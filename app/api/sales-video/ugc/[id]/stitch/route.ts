import { NextResponse } from "next/server";
import { readMaiVideoAuthCookie } from "../../../../../lib/maivideo-auth-shared";
import { stitchSalesVideoSegments } from "../../../../../lib/sales-video-creative";
import { listSalesVideoProjects, salesVideoWatermarkLogoPath, saveSalesVideoProject, type SalesVideoProject } from "../../../../../lib/sales-video-storage";
import { salesVideoWorkerId } from "../../../../../lib/sales-video-runtime";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = request.headers.get("x-storyai-user-id")?.trim();
  if (!userId || !readMaiVideoAuthCookie(request.headers.get("cookie") || "")) {
    return NextResponse.json({ message: "Vui lòng đăng nhập MaiVideo." }, { status: 401 });
  }
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ message: "Project không hợp lệ." }, { status: 404 });
  const project = (await listSalesVideoProjects(userId, salesVideoWorkerId)).find((item) => item.id === id);
  if (!project?.details) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  if (project.status === "processing") return NextResponse.json({ message: "Hãy đợi clip đang xử lý hoàn tất trước khi ghép." }, { status: 409 });
  if (project.details.voiceRegeneration?.status === "processing") return NextResponse.json({ message: "Hãy đợi tạo lại voice hoàn tất trước khi ghép lại video." }, { status: 409 });

  const details = project.details;
  const segments = details.promptSegments?.length ? details.promptSegments : details.generatedSegments || [];
  if (!segments.length || segments.length > 6) return NextResponse.json({ message: "Project không có danh sách clip hợp lệ để ghép." }, { status: 409 });
  const results = details.segmentResults || [];
  if (results.some((segment) => segment.status === "processing")) {
    return NextResponse.json({ message: "Hãy đợi clip đang xử lý hoàn tất trước khi ghép." }, { status: 409 });
  }

  try {
    await stitchSalesVideoSegments(userId, id, segments, details.duration || segments.reduce((sum, segment) => sum + segment.duration, 0),
      project.postProcessing, project.postProcessing?.logo?.enabled ? salesVideoWatermarkLogoPath(userId, id) : undefined);
    const updated: SalesVideoProject = {
      ...project,
      status: "ready",
      phase: undefined,
      worker: undefined,
      error: undefined,
      details: {
        ...details,
        segmentResults: segments.map((segment, index) => ({ ...results[index], start: segment.start, duration: segment.duration, status: "ready" as const, error: undefined })),
        needsStitching: false,
      },
    };
    await saveSalesVideoProject(userId, updated);
    return NextResponse.json({ project: updated });
  } catch {
    return NextResponse.json({ message: "Chưa thể ghép video. Hãy tạo lại các clip còn thiếu rồi thử lại." }, { status: 409 });
  }
}

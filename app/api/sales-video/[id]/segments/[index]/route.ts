import { NextResponse } from "next/server";
import { renderFileResponse } from "../../../../../lib/render-file-response";
import { ensureSalesVideoSegmentFile } from "../../../../../lib/sales-video-creative";
import { listSalesVideoProjects, salesVideoOwnerDirectory } from "../../../../../lib/sales-video-storage";
import { salesVideoWorkerId } from "../../../../../lib/sales-video-runtime";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const userId = request.headers.get("x-storyai-user-id")?.trim();
  if (!userId) return NextResponse.json({ message: "Vui lòng đăng nhập." }, { status: 401 });
  const { id, index: rawIndex } = await params;
  const index = Number(rawIndex);
  if (!/^[a-f0-9-]{36}$/i.test(id) || !Number.isInteger(index) || index < 0 || index > 5) {
    return NextResponse.json({ message: "Clip không hợp lệ." }, { status: 404 });
  }
  const project = (await listSalesVideoProjects(userId, salesVideoWorkerId)).find((item) => item.id === id);
  if (!project?.details) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const segments = project.details.promptSegments?.length ? project.details.promptSegments : project.details.generatedSegments || [];
  const segment = segments[index];
  if (!segment) return NextResponse.json({ message: "Không tìm thấy clip này." }, { status: 404 });
  try {
    const file = await ensureSalesVideoSegmentFile(userId, id, index, segment.start, segment.duration);
    return renderFileResponse(request, {
      localPath: file,
      outputRoot: salesVideoOwnerDirectory(userId),
      kind: "video",
      filenameBase: `${project.title}-clip-${index + 1}`,
      missingMessage: "Không tìm thấy clip video.",
    });
  } catch {
    return NextResponse.json({ message: "Clip 15 giây chưa được tạo xong." }, { status: 404 });
  }
}

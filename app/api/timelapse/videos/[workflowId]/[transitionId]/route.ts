import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { safeTimelapseId, timelapseVideoPath } from "../../../../../lib/timelapse-storage";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ workflowId: string; transitionId: string }> }) {
  const userId = request.headers.get("x-storyai-user-id")?.trim() || "";
  if (!userId) return NextResponse.json({ message: "Vui lòng đăng nhập để xem video." }, { status: 401 });
  const { workflowId: rawWorkflowId, transitionId: rawTransitionId } = await context.params;
  const workflowId = safeTimelapseId(rawWorkflowId);
  const transitionId = safeTimelapseId(rawTransitionId);
  if (!workflowId || !transitionId) return NextResponse.json({ message: "Không tìm thấy video Timelapse." }, { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await readFile(timelapseVideoPath(userId, workflowId, transitionId));
  } catch {
    return NextResponse.json({ message: "Video Timelapse chưa được tạo hoặc đã bị xóa." }, { status: 404 });
  }

  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  const headers = { "Accept-Ranges": "bytes", "Content-Type": "video/mp4", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (!range) return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Length": String(bytes.length) } });
  const start = range[1] ? Number(range[1]) : 0;
  const requestedEnd = range[2] ? Number(range[2]) : bytes.length - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start >= bytes.length || requestedEnd < start) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${bytes.length}` } });
  }
  const end = Math.min(requestedEnd, bytes.length - 1);
  const part = bytes.subarray(start, end + 1);
  return new Response(new Uint8Array(part), { status: 206, headers: { ...headers, "Content-Length": String(part.length), "Content-Range": `bytes ${start}-${end}/${bytes.length}` } });
}

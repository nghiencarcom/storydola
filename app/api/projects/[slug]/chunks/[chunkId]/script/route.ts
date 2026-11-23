import { NextResponse } from "next/server";
import { readChunkOutput, readData } from "../../../../../../lib/server-store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ slug: string; chunkId: string }> }) {
  const { slug, chunkId: rawChunkId } = await context.params;
  const chunkId = decodeURIComponent(rawChunkId).trim().toUpperCase();
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const chunk = project.chunks.find((item) => item.id === chunkId);
  if (!chunk) return NextResponse.json({ message: "Không tìm thấy tập trong project." }, { status: 404 });
  if (!chunk.outputPath) return NextResponse.json({ message: "Tập này chưa có JSON kịch bản đã nhập." }, { status: 404 });

  const script = await readChunkOutput(chunk);
  if (!script) return NextResponse.json({ message: "Không đọc được JSON đã lưu của tập này." }, { status: 404 });
  return NextResponse.json({ script }, { headers: { "Cache-Control": "no-store" } });
}

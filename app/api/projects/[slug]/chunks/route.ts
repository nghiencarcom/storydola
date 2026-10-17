import { NextResponse } from "next/server";
import { readData } from "../../../../lib/server-store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  return NextResponse.json({ chunks: project.chunks }, { headers: { "Cache-Control": "no-store" } });
}

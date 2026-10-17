import path from "node:path";
import { NextResponse } from "next/server";
import { renderFileResponse, type RenderFileKind } from "../../../../../lib/render-file-response";
import { readData } from "../../../../../lib/server-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const kindValue = new URL(request.url).searchParams.get("kind") || "video";
  const kind: RenderFileKind = kindValue === "subtitle" ? "subtitle" : kindValue === "manifest" ? "manifest" : "video";
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });

  const localPath = kind === "video" ? project.render?.outputPath : kind === "subtitle" ? project.render?.subtitlePath : project.render?.manifestPath;
  return renderFileResponse(request, {
    localPath,
    outputRoot: path.resolve(process.cwd(), "data", "outputs", project.slug),
    kind,
    filenameBase: project.slug,
    missingMessage: "Project chưa có file render tương ứng.",
  });
}

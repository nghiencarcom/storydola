import path from "node:path";
import { NextResponse } from "next/server";
import { renderFileResponse, type RenderFileKind } from "../../../../../../../lib/render-file-response";
import { readData } from "../../../../../../../lib/server-store";
import { FALLBACK_VIDEO_LANGUAGES } from "../../../../../../../lib/omnivoice";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ slug: string; chunkId: string }> }) {
  const { slug, chunkId } = await context.params;
  const kindValue = new URL(request.url).searchParams.get("kind") || "video";
  const rawLanguage = String(new URL(request.url).searchParams.get("language") || "").trim().replace(/_/g, "-");
  const language = FALLBACK_VIDEO_LANGUAGES.find((item) => item.toLowerCase() === rawLanguage.toLowerCase()) || "";
  const kind: RenderFileKind = kindValue === "subtitle" ? "subtitle" : kindValue === "manifest" ? "manifest" : "video";
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const chunkIndex = project.chunks.findIndex((item) => item.id === chunkId);
  if (chunkIndex < 0) return NextResponse.json({ message: "Không tìm thấy tập." }, { status: 404 });
  const chunk = project.chunks[chunkIndex];
  const render = language ? chunk.render?.localizedRenders?.[language] : chunk.render;
  const localPath = kind === "video" ? render?.outputPath : kind === "subtitle" ? render?.subtitlePath : render?.manifestPath;
  return renderFileResponse(request, {
    localPath,
    outputRoot: path.resolve(process.cwd(), "data", "outputs", project.slug, "episodes", chunk.id),
    kind,
    filenameBase: `${project.slug}-tap-${String(chunkIndex + 1).padStart(2, "0")}${language ? `-${language.toLowerCase()}` : ""}`,
    missingMessage: "Tập chưa có file render tương ứng.",
  });
}

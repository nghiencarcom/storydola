import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { markRenderStale, readChunkOutput, readData, saveChunkOutput, updateData } from "../../../../../../lib/server-store";
import { findProjectScene, sceneMediaLocalPath, sceneReferenceImageLocalPath } from "../../../../../../lib/scene-store";
import { resolveMediaGenerationSettings } from "../../../../../../lib/media-generation-settings";
import { MAX_SCENE_MEDIA_UPLOAD_BYTES } from "../../../../../../lib/scene-media-upload-config";
import { saveGeneratedSceneMedia } from "../../../../../../lib/scene-media-output";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const { scene } = await findProjectScene(project, sceneId);
  if (!scene) return NextResponse.json({ message: "Không tìm thấy cảnh." }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > MAX_SCENE_MEDIA_UPLOAD_BYTES) return NextResponse.json({ message: "Chọn ảnh hoặc video dưới 250 MB." }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  const mp4 = bytes.toString("ascii", 4, 8) === "ftyp";
  const extension = png ? "png" : jpeg ? "jpg" : webp ? "webp" : mp4 ? "mp4" : "";
  if (!extension) return NextResponse.json({ message: "Chỉ hỗ trợ PNG, JPG, WebP hoặc MP4." }, { status: 415 });
  const kind = mp4 ? "video" : "image";
  const relativePath = path.join("data", "media", project.slug, scene.chunkId, `${scene.id}-upload-${Date.now()}.${extension}`);
  const absolutePath = path.join(process.cwd(), relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  const media = { kind, provider: "upload", status: "ready", localPath: relativePath, sourceUrl: "", query: file.name } as const;
  const mediaGeneration = resolveMediaGenerationSettings(project.mediaGeneration);
  const saved = await saveGeneratedSceneMedia({ projectSlug: slug, sceneId, media, mediaGeneration });
  return NextResponse.json({ ok: true, ...saved });
}

export async function DELETE(_request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await context.params;
  const result = await updateData(async (data) => {
    const project = data.projects.find((item) => item.slug === slug);
    if (!project) return false;
    const { scene } = await findProjectScene(project, sceneId);
    const chunk = project.chunks.find((item) => item.id === scene?.chunkId);
    if (!scene || !chunk?.outputPath) return false;
    const output = await readChunkOutput(chunk) as Record<string, unknown> | null;
    if (!output || !Array.isArray(output.scenes)) return false;
    const scenes = output.scenes.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const item = { ...value } as Record<string, unknown>;
      if (String(item.id || item.scene_id) !== sceneId) return item;
      delete item.media; delete item.videoReferenceImage;
      return item;
    });
    chunk.outputPath = await saveChunkOutput(slug, chunk.id, { ...output, scenes });
    chunk.render = markRenderStale(chunk.render);
    project.render = markRenderStale(project.render);
    return true;
  });
  return result ? NextResponse.json({ ok: true }) : NextResponse.json({ message: "Không tìm thấy media của cảnh." }, { status: 404 });
}

function contentType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    case ".mov": return "video/quicktime";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    default: return "application/octet-stream";
  }
}

function streamFileRange(filePath: string, start: number, end: number) {
  const file = createReadStream(filePath, { start, end });
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      file.on("data", (chunk: string | Buffer) => {
        file.pause();
        if (cancelled) return;
        try {
          controller.enqueue(new Uint8Array(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
        } catch {
          cancelled = true;
          file.destroy();
        }
      });
      file.once("end", () => {
        if (cancelled) return;
        cancelled = true;
        try { controller.close(); } catch { /* The consumer may have cancelled while the final chunk was in flight. */ }
      });
      file.once("error", (error) => {
        if (cancelled) return;
        cancelled = true;
        try { controller.error(error); } catch { /* The consumer may have cancelled the response. */ }
      });
      file.pause();
    },
    pull() {
      if (!cancelled) file.resume();
    },
    cancel() {
      cancelled = true;
      file.destroy();
    },
  });
}

export async function GET(request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const { scene } = await findProjectScene(project, sceneId);
  if (!scene) return NextResponse.json({ message: "Không tìm thấy cảnh." }, { status: 404 });

  const kind = new URL(request.url).searchParams.get("kind");
  if (kind === "storyboard") return NextResponse.json({ message: "Không tìm thấy media." }, { status: 404 });
  const isReference = kind === "reference";
  const localPath = isReference ? sceneReferenceImageLocalPath(scene) : sceneMediaLocalPath(scene);
  if (!localPath) return NextResponse.json({ message: "Cảnh chưa có media." }, { status: 404 });
  const resolvedPath = path.resolve(process.cwd(), localPath);
  const projectMediaRoot = path.resolve(process.cwd(), "data", "media", project.slug);
  if (resolvedPath !== projectMediaRoot && !resolvedPath.startsWith(`${projectMediaRoot}${path.sep}`)) {
    return NextResponse.json({ message: "Media không thuộc project này." }, { status: 403 });
  }

  try {
    const details = await stat(resolvedPath);
    if (!details.isFile()) throw new Error("NOT_FILE");
    const range = request.headers.get("range");
    let start = 0;
    let end = details.size - 1;
    let status = 200;
    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (match) {
        if (match[1]) start = Number(match[1]);
        if (match[2]) end = Number(match[2]);
        if (!match[1] && match[2]) {
          const suffixLength = Number(match[2]);
          start = Math.max(0, details.size - suffixLength);
        }
        end = Math.min(end, details.size - 1);
        if (start <= end && start < details.size) status = 206;
      }
    }
    if (start > end || start >= details.size) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${details.size}` } });
    }
    return new NextResponse(streamFileRange(resolvedPath, start, end), {
      status,
      headers: {
        "Content-Type": contentType(resolvedPath),
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
        ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${details.size}` } : {}),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ message: "Không đọc được media của cảnh." }, { status: 404 });
  }
}

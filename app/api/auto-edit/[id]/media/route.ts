import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCurrentUserId } from "../../../../lib/auth-server";
import { autoEditJobMediaDir } from "../../../../lib/auto-edit-upload";
import { getAutoEditJob } from "../../../../lib/auto-edit-worker";
import { renderFileResponse } from "../../../../lib/render-file-response";

export const runtime = "nodejs";

function mimeForVideoExt(ext: string) {
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  return "video/mp4";
}

function streamRangeBody(filePath: string, start: number, end: number, signal: AbortSignal) {
  const source = createReadStream(filePath, { start, end });
  const iterator = source[Symbol.asyncIterator]();
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", stop);
    source.destroy();
  };
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) return;
      try {
        const next = await iterator.next();
        if (closed) return;
        if (next.done) {
          stop();
          controller.close();
          return;
        }
        controller.enqueue(next.value);
      } catch (err) {
        if (!closed) {
          stop();
          controller.error(err);
        }
      }
    },
    cancel: stop,
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return NextResponse.json({ message: "Vui lòng đăng nhập lại." }, { status: 401 });

  const { id } = await context.params;
  const job = await getAutoEditJob(owner, id);
  if (!job) return NextResponse.json({ message: "Không tìm thấy job Auto Edit." }, { status: 404 });

  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") || "render";
  const jobDir = autoEditJobMediaDir(owner, job.id);

  if (kind === "image") {
    const imageId = params.get("imageId") || "";
    const image = job.images.find((item) => item.id === imageId);
    if (!image) return NextResponse.json({ message: "Không tìm thấy ảnh sản phẩm." }, { status: 404 });
    const imgPath = path.join(jobDir, "images", `${image.id}.png`);
    try {
      const bytes = await readFile(imgPath);
      return new NextResponse(bytes, {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch {
      return NextResponse.json({ message: "Tệp ảnh không còn tồn tại." }, { status: 404 });
    }
  }

  if (kind === "video") {
    const clipId = params.get("clipId") || "";
    const clip = job.videos.find((item) => item.id === clipId);
    if (!clip) return NextResponse.json({ message: "Không tìm thấy clip nguồn." }, { status: 404 });
    const videoPath = path.join(jobDir, "videos", `${clip.id}${clip.extension}`);
    try {
      const details = await stat(videoPath);
      if (!details.isFile()) throw new Error("MISSING");
      const range = request.headers.get("range");
      let start = 0;
      let end = details.size - 1;
      let status = 200;

      if (range) {
        const match = range.trim().match(/^bytes=(\d*)-(\d*)$/u);
        if (!match || (!match[1] && !match[2])) {
          return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${details.size}` } });
        }
        if (!match[1] && match[2]) {
          const suffix = Number(match[2]);
          if (!Number.isFinite(suffix) || suffix <= 0 || details.size === 0) {
            return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${details.size}` } });
          }
          start = Math.max(0, details.size - suffix);
        } else {
          start = Number(match[1]);
          if (match[2]) end = Math.min(details.size - 1, Number(match[2]));
        }
        if (start <= end && start < details.size) status = 206;
      }

      if (start > end || start >= details.size) {
        return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${details.size}` } });
      }

      return new NextResponse(streamRangeBody(videoPath, start, end, request.signal), {
        status,
        headers: {
          "Content-Type": mimeForVideoExt(clip.extension),
          "Content-Length": String(end - start + 1),
          "Accept-Ranges": "bytes",
          ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${details.size}` } : {}),
          "Cache-Control": "private, max-age=600",
        },
      });
    } catch {
      return NextResponse.json({ message: "Không đọc được tệp clip nguồn." }, { status: 404 });
    }
  }

  const rendersDir = path.join(jobDir, "renders");
  let resolvedRenderPath: string | undefined;
  if (job.render?.status === "ready") {
    const deterministicMp4 = path.join(rendersDir, `auto-edit-${job.id}.mp4`);
    if (job.render.outputPath) {
      const candidate = path.resolve(jobDir, job.render.outputPath);
      const rel = path.relative(rendersDir, candidate);
      if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
        const exists = await stat(candidate).then((s) => s.isFile()).catch(() => false);
        resolvedRenderPath = exists ? candidate : deterministicMp4;
      } else {
        resolvedRenderPath = deterministicMp4;
      }
    } else {
      resolvedRenderPath = deterministicMp4;
    }
  }

  return renderFileResponse(request, {
    localPath: resolvedRenderPath,
    outputRoot: rendersDir,
    kind: "video",
    filenameBase: job.edl?.title || `auto-edit-${job.id}`,
    missingMessage: "Video MP4 chưa được xuất hoặc đang trong quá trình render.",
  });
}

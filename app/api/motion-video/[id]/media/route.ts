import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCurrentUserId } from "../../../../lib/auth-server";
import { resolveHttpByteRange } from "../../../../lib/auto-edit";
import { createVideoJobDir } from "../../../../lib/motion-video-ingest";
import { getCreateVideoJob } from "../../../../lib/motion-video-worker";
import { renderFileResponse } from "../../../../lib/render-file-response";

export const runtime = "nodejs";

function streamAudioRange(filePath: string, start: number, end: number, signal: AbortSignal) {
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
  const job = await getCreateVideoJob(owner, id);
  if (!job) return NextResponse.json({ message: "Không tìm thấy dự án Motion Video." }, { status: 404 });

  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") || "render";
  const jobDir = createVideoJobDir(owner, job.id);

  if (kind === "image") {
    const imageId = params.get("imageId") || "";
    const image = job.images.find((item) => item.id === imageId);
    if (!image) return NextResponse.json({ message: "Không tìm thấy ảnh minh hoạ." }, { status: 404 });
    const imgPath = path.join(jobDir, "images", path.basename(image.filename));
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

  if (kind === "voice") {
    const voicePath = path.join(jobDir, "audio", "narration.wav");
    try {
      const details = await stat(voicePath);
      if (!details.isFile() || details.size <= 0) throw new Error("MISSING");
      const rangeHeader = request.headers.get("range");
      if (rangeHeader) {
        const range = resolveHttpByteRange(rangeHeader, details.size);
        if (!range.ok) {
          return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${details.size}` } });
        }
        return new NextResponse(streamAudioRange(voicePath, range.start, range.end, request.signal), {
          status: 206,
          headers: {
            "Content-Type": "audio/wav",
            "Content-Length": String(range.end - range.start + 1),
            "Accept-Ranges": "bytes",
            "Content-Range": `bytes ${range.start}-${range.end}/${details.size}`,
            "Cache-Control": "private, no-store",
          },
        });
      }
      return new NextResponse(streamAudioRange(voicePath, 0, details.size - 1, request.signal), {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
          "Content-Length": String(details.size),
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, no-store",
        },
      });
    } catch {
      return NextResponse.json({ message: "Chưa có tệp giọng đọc cho dự án này." }, { status: 404 });
    }
  }

  const rendersDir = path.join(jobDir, "renders");
  let resolvedRenderPath: string | undefined;
  if (job.render?.status === "ready") {
    const deterministicMp4 = path.join(rendersDir, `motion-video-${job.id}.mp4`);
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
    filenameBase: job.plan?.title || `motion-video-${job.id}`,
    missingMessage: "Video MP4 chưa được xuất hoặc đang trong quá trình render.",
  });
}

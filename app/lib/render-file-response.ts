import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export type RenderFileKind = "video" | "subtitle" | "manifest" | "blend";

function contentType(kind: RenderFileKind) {
  if (kind === "video") return "video/mp4";
  if (kind === "subtitle") return "application/x-subrip; charset=utf-8";
  if (kind === "manifest") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "render";
}

function createFileBody(filePath: string, start: number, end: number, signal: AbortSignal) {
  const source = createReadStream(filePath, { start, end });
  const iterator = source[Symbol.asyncIterator]();
  let cancelled = false;
  let finished = false;

  const cleanup = () => signal.removeEventListener("abort", cancel);
  const cancel = () => {
    if (cancelled || finished) return;
    cancelled = true;
    cleanup();
    source.destroy();
  };

  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled || finished) return;
      try {
        const next = await iterator.next();
        if (cancelled || finished) return;
        if (next.done) {
          finished = true;
          cleanup();
          controller.close();
          return;
        }
        controller.enqueue(next.value);
      } catch (error) {
        if (cancelled || finished) return;
        finished = true;
        cleanup();
        controller.error(error);
      }
    },
    cancel,
  });
}

export async function renderFileResponse(request: Request, options: {
  localPath?: string;
  outputRoot: string;
  kind: RenderFileKind;
  filenameBase: string;
  missingMessage: string;
}) {
  if (!options.localPath) return NextResponse.json({ message: options.missingMessage }, { status: 404 });

  const resolvedRoot = path.resolve(options.outputRoot);
  const resolvedPath = path.resolve(process.cwd(), options.localPath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return NextResponse.json({ message: "File render không thuộc project này." }, { status: 403 });
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  const extension = options.kind === "video" ? "mp4" : options.kind === "subtitle" ? "srt" : options.kind === "blend" ? "blend" : "json";
  const filename = `${safeFilename(options.filenameBase)}.${extension}`;
  try {
    const details = await stat(resolvedPath);
    if (!details.isFile()) throw new Error("NOT_FILE");
    if (options.kind === "subtitle" || options.kind === "manifest") {
      const body = await readFile(resolvedPath);
      return new NextResponse(body, { headers: {
        "Content-Type": contentType(options.kind),
        "Content-Length": String(body.byteLength),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "no-store",
      } });
    }

    const range = request.headers.get("range");
    let start = 0;
    let end = details.size - 1;
    let status = 200;
    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (match) {
        let validRange = true;
        if (!match[1] && match[2]) {
          const suffixLength = Number(match[2]);
          if (Number.isFinite(suffixLength) && suffixLength > 0) {
            start = Math.max(0, details.size - suffixLength);
            end = details.size - 1;
          } else validRange = false;
        } else {
          if (match[1]) start = Number(match[1]);
          if (match[2]) end = Number(match[2]);
          end = Math.min(end, details.size - 1);
        }
        if (!Number.isFinite(start) || !Number.isFinite(end)) validRange = false;
        if (validRange && start <= end && start < details.size) status = 206;
        if (!validRange) start = details.size;
      }
    }
    if (start > end || start >= details.size) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${details.size}` } });
    return new NextResponse(createFileBody(resolvedPath, start, end, request.signal), {
      status,
      headers: {
        "Content-Type": contentType(options.kind),
        "Content-Length": String(end - start + 1),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
        "Accept-Ranges": "bytes",
        ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${details.size}` } : {}),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ message: "Không đọc được file render." }, { status: 404 });
  }
}

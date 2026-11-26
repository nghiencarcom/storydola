import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCurrentUserId } from "../../../../lib/auth-server";
import { getSfxById } from "../../../../lib/sfx-library";

export const runtime = "nodejs";

function mimeForSfx(filename: string) {
  if (filename.toLowerCase().endsWith(".wav")) return "audio/wav";
  if (filename.toLowerCase().endsWith(".ogg")) return "audio/ogg";
  return "audio/mpeg";
}

export async function GET(request: Request, context: { params: Promise<{ sfxId: string }> }) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return NextResponse.json({ message: "Vui lòng đăng nhập lại." }, { status: 401 });

  const { sfxId } = await context.params;
  const entry = getSfxById(sfxId);
  if (!entry) {
    return NextResponse.json({ message: "Không tìm thấy hiệu ứng âm thanh (SFX)." }, { status: 404 });
  }

  const filePath = path.join(process.cwd(), "assets", "sfx", entry.filename);
  try {
    const bytes = await readFile(filePath);
    const total = bytes.byteLength;
    const range = request.headers.get("range");

    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/u);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(total - 1, Number(match[2])) : total - 1;
        if (start <= end && start < total) {
          const slice = bytes.subarray(start, end + 1);
          return new NextResponse(slice, {
            status: 206,
            headers: {
              "Content-Type": mimeForSfx(entry.filename),
              "Content-Length": String(slice.byteLength),
              "Accept-Ranges": "bytes",
              "Content-Range": `bytes ${start}-${end}/${total}`,
              "Cache-Control": "private, max-age=86400",
            },
          });
        }
      }
    }

    return new NextResponse(bytes, {
      headers: {
        "Content-Type": mimeForSfx(entry.filename),
        "Content-Length": String(total),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ message: "Không đọc được tệp SFX trên máy chủ." }, { status: 404 });
  }
}

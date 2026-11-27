import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCurrentUserId } from "../../../../lib/auth-server";
import { resolveHttpByteRange } from "../../../../lib/auto-edit";
import { getSfxById } from "../../../../lib/sfx-library";

export const runtime = "nodejs";

function mimeForSfx(filename: string) {
  if (filename.toLowerCase().endsWith(".wav")) return "audio/wav";
  if (filename.toLowerCase().endsWith(".ogg")) return "audio/ogg";
  return "audio/mpeg";
}

async function readSfxAssetBytes(filename: string) {
  const safeName = path.basename(filename);
  const candidates = [
    path.join(process.cwd(), "assets", "sfx", safeName),
    path.resolve(process.cwd(), "..", "..", "assets", "sfx", safeName),
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await readFile(candidate);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function GET(request: Request, context: { params: Promise<{ sfxId: string }> }) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return NextResponse.json({ message: "Vui lòng đăng nhập lại." }, { status: 401 });

  const { sfxId } = await context.params;
  const entry = getSfxById(sfxId);
  if (!entry) {
    return NextResponse.json({ message: "Không tìm thấy hiệu ứng âm thanh (SFX)." }, { status: 404 });
  }

  try {
    const bytes = await readSfxAssetBytes(entry.filename);
    const total = bytes.byteLength;
    const range = request.headers.get("range");

    if (range) {
      const parsed = resolveHttpByteRange(range, total);
      if (!parsed.ok) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Range": `bytes */${total}`,
          },
        });
      }
      const slice = bytes.subarray(parsed.start, parsed.end + 1);
      return new NextResponse(new Uint8Array(slice), {
        status: 206,
        headers: {
          "Content-Type": mimeForSfx(entry.filename),
          "Content-Length": String(slice.byteLength),
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${parsed.start}-${parsed.end}/${total}`,
          "Cache-Control": "private, max-age=86400",
        },
      });
    }

    return new NextResponse(new Uint8Array(bytes), {
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

import sharp from "sharp";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";

// Only called after the route has checked ownership and the allowed media path.
const thumbnails = new Map<string, Promise<Buffer>>();

export async function imageThumbnailResponse(request: Request, filePath: string) {
  const info = await stat(filePath);
  const key = `${filePath}:${info.mtimeMs}:${info.size}`;
  const etag = `"${createHash("sha256").update(key).digest("hex")}-thumb-v1"`;
  const headers = {
    "Content-Type": "image/webp",
    "Cache-Control": "private, max-age=0, must-revalidate",
    "ETag": etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  let pending = thumbnails.get(key);
  if (!pending) {
    pending = sharp(filePath).rotate().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    thumbnails.set(key, pending);
    if (thumbnails.size > 128) thumbnails.delete(thumbnails.keys().next().value!);
    pending.catch(() => { if (thumbnails.get(key) === pending) thumbnails.delete(key); });
  }
  const bytes = await pending;
  return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Length": String(bytes.length) } });
}

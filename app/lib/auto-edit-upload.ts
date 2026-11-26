import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { dataPath } from "./data-directory";
import type { AutoEditOptions, AutoEditProductImage, AutoEditSourceVideo } from "./auto-edit";

export const autoEditRoot = dataPath("auto-edit");
export const autoEditUploadChunkBytes = 8 * 1024 * 1024;
export const maxAutoEditVideos = 20;
export const maxAutoEditImages = 20;
export const maxAutoEditImageBytes = 15 * 1024 * 1024;
export const maxAutoEditVideoBytes = 1024 * 1024 * 1024; // 1 GiB per clip

const allowedVideoExtensions = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv"]);
const allowedImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export const autoEditOwnerFolder = (owner: string) => createHash("sha256").update(owner).digest("hex");
export const isValidUuid = (id: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(id);

export type AutoEditUploadVideoEntry = {
  id: string;
  filename: string;
  extension: string;
  size: number;
  uploaded: number;
  order: number;
  complete: boolean;
};

export type AutoEditUploadManifest = {
  sessionId: string;
  options: AutoEditOptions;
  videos: AutoEditUploadVideoEntry[];
  images: AutoEditProductImage[];
  createdAt: string;
  finalizedJobId?: string;
};

export function autoEditSessionDir(owner: string, sessionId: string) {
  return path.join(autoEditRoot, autoEditOwnerFolder(owner), "sessions", sessionId);
}

export function autoEditJobMediaDir(owner: string, jobId: string) {
  return path.join(autoEditRoot, autoEditOwnerFolder(owner), "jobs", jobId);
}

function manifestPath(owner: string, sessionId: string) {
  return path.join(autoEditSessionDir(owner, sessionId), "manifest.json");
}

function cleanFilename(raw: string, fallback: string) {
  const normalized = path.basename(raw.replace(/\\/gu, "/")).replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, 200);
  return normalized || fallback;
}

async function readManifest(owner: string, sessionId: string): Promise<AutoEditUploadManifest | undefined> {
  if (!isValidUuid(sessionId)) return undefined;
  try {
    const parsed = JSON.parse(await readFile(manifestPath(owner, sessionId), "utf8")) as AutoEditUploadManifest;
    return parsed.sessionId === sessionId ? parsed : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function saveManifest(owner: string, manifest: AutoEditUploadManifest) {
  const dir = autoEditSessionDir(owner, manifest.sessionId);
  const target = manifestPath(owner, manifest.sessionId);
  const temp = path.join(dir, `.manifest-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(manifest), { flag: "wx", mode: 0o600 });
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

async function withSessionLock<T>(owner: string, sessionId: string, fn: () => Promise<T>): Promise<{ locked: false } | { locked: true; value: T }> {
  const dir = autoEditSessionDir(owner, sessionId);
  const lockPath = path.join(dir, ".session.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch {
    return { locked: false };
  }
  try {
    return { locked: true, value: await fn() };
  } finally {
    await lock.close().catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

export async function beginAutoEditUploadSession(
  owner: string,
  options: AutoEditOptions,
  videosInput: ReadonlyArray<{ filename: string; size: number }>,
) {
  if (!videosInput.length || videosInput.length > maxAutoEditVideos) {
    throw new Error(`Hãy chọn từ 1 đến ${maxAutoEditVideos} tệp video cần dựng.`);
  }

  const sessionId = randomUUID();
  const dir = autoEditSessionDir(owner, sessionId);
  await mkdir(path.join(dir, "videos"), { recursive: true, mode: 0o700 });
  await mkdir(path.join(dir, "images"), { recursive: true, mode: 0o700 });

  const videos: AutoEditUploadVideoEntry[] = [];
  for (let index = 0; index < videosInput.length; index++) {
    const item = videosInput[index];
    const filename = cleanFilename(item.filename, `clip-${index + 1}.mp4`);
    const extension = path.extname(filename).toLowerCase();
    if (!allowedVideoExtensions.has(extension)) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`Tệp "${filename}" không đúng định dạng video (MP4, MOV, WebM, MKV).`);
    }
    if (!Number.isSafeInteger(item.size) || item.size <= 0 || item.size > maxAutoEditVideoBytes) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`Dung lượng video "${filename}" không hợp lệ (tối đa 1 GB mỗi clip).`);
    }
    const id = `clip_${String(index + 1).padStart(2, "0")}`;
    const partHandle = await open(path.join(dir, "videos", `${id}.part`), "wx", 0o600);
    await partHandle.close();
    videos.push({
      id,
      filename,
      extension,
      size: item.size,
      uploaded: 0,
      order: index,
      complete: false,
    });
  }

  const manifest: AutoEditUploadManifest = {
    sessionId,
    options,
    videos,
    images: [],
    createdAt: new Date().toISOString(),
  };
  await saveManifest(owner, manifest);

  return {
    sessionId,
    videos: videos.map(({ id, filename, size, uploaded }) => ({ id, filename, size, uploaded })),
  };
}

export async function writeAutoEditVideoChunk(
  owner: string,
  sessionId: string,
  clipId: string,
  offset: number,
  bytes: Buffer,
) {
  if (!isValidUuid(sessionId) || !/^clip_\d{2}$/u.test(clipId)) return { kind: "missing" as const };
  if (!Number.isSafeInteger(offset) || offset < 0 || !bytes.length || bytes.length > autoEditUploadChunkBytes) {
    return { kind: "invalid" as const };
  }

  const outcome = await withSessionLock(owner, sessionId, async () => {
    const manifest = await readManifest(owner, sessionId);
    if (!manifest) return { kind: "missing" as const };
    if (manifest.finalizedJobId) return { kind: "complete" as const, uploaded: 0 };
    const clip = manifest.videos.find((v) => v.id === clipId);
    if (!clip) return { kind: "missing" as const };
    if (clip.complete) return { kind: "complete" as const, uploaded: clip.uploaded };
    if (offset !== clip.uploaded) return { kind: "offset" as const, uploaded: clip.uploaded };
    if (offset + bytes.length > clip.size) return { kind: "invalid" as const };

    const dir = autoEditSessionDir(owner, sessionId);
    const partPath = path.join(dir, "videos", `${clip.id}.part`);
    const handle = await open(partPath, "r+");
    try {
      await handle.truncate(clip.uploaded);
      let written = 0;
      while (written < bytes.length) {
        const res = await handle.write(bytes, written, bytes.length - written, clip.uploaded + written);
        if (!res.bytesWritten) throw new Error("AUTO_EDIT_UPLOAD_WRITE_FAILED");
        written += res.bytesWritten;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }

    clip.uploaded += bytes.length;
    if (clip.uploaded === clip.size) {
      const finalPath = path.join(dir, "videos", `${clip.id}${clip.extension}`);
      await rename(partPath, finalPath);
      clip.complete = true;
    }
    await saveManifest(owner, manifest);
    return { kind: "ok" as const, uploaded: clip.uploaded, complete: clip.complete };
  });

  if (!outcome.locked) return { kind: "busy" as const };
  return outcome.value;
}

export async function addAutoEditProductImage(
  owner: string,
  sessionId: string,
  filenameRaw: string,
  labelRaw: string,
  bytes: Buffer,
) {
  if (!isValidUuid(sessionId)) return { kind: "missing" as const };
  if (!bytes.length || bytes.length > maxAutoEditImageBytes) return { kind: "invalid" as const, message: "Ảnh vượt quá 15 MB." };

  const filename = cleanFilename(filenameRaw, "product.png");
  const ext = path.extname(filename).toLowerCase() || ".png";
  if (!allowedImageExtensions.has(ext)) {
    return { kind: "invalid" as const, message: "Chỉ hỗ trợ ảnh PNG, JPG, JPEG hoặc WebP." };
  }

  let normalizedBuffer: Buffer;
  let width = 0;
  let height = 0;
  try {
    const pipeline = sharp(bytes, { limitInputPixels: 64_000_000 }).rotate().resize({
      width: 1440,
      height: 1440,
      fit: "inside",
      withoutEnlargement: true,
    });
    normalizedBuffer = await pipeline.png({ compressionLevel: 8 }).toBuffer();
    const meta = await sharp(normalizedBuffer).metadata();
    width = meta.width || 720;
    height = meta.height || 720;
  } catch {
    return { kind: "invalid" as const, message: "Tệp ảnh không hợp lệ hoặc bị hỏng." };
  }

  const outcome = await withSessionLock(owner, sessionId, async () => {
    const manifest = await readManifest(owner, sessionId);
    if (!manifest) return { kind: "missing" as const };
    if (manifest.finalizedJobId) return { kind: "complete" as const };
    if (manifest.images.length >= maxAutoEditImages) {
      return { kind: "invalid" as const, message: `Tối đa ${maxAutoEditImages} ảnh minh hoạ mỗi job.` };
    }

    const index = manifest.images.length + 1;
    const id = `img_${String(index).padStart(2, "0")}`;
    const dir = autoEditSessionDir(owner, sessionId);
    const targetPath = path.join(dir, "images", `${id}.png`);
    await writeFile(targetPath, normalizedBuffer, { mode: 0o600 });

    const defaultLabel = path.basename(filename, path.extname(filename)).replace(/[_-]+/gu, " ").trim().slice(0, 80);
    const imageEntry: AutoEditProductImage = {
      id,
      filename: `${path.basename(filename, path.extname(filename))}.png`,
      extension: ".png",
      size: normalizedBuffer.byteLength,
      width,
      height,
      label: (labelRaw || defaultLabel || `Ảnh minh hoạ ${index}`).trim().slice(0, 100),
    };
    manifest.images.push(imageEntry);
    await saveManifest(owner, manifest);
    return { kind: "ok" as const, image: imageEntry };
  });

  if (!outcome.locked) return { kind: "busy" as const };
  return outcome.value;
}

export async function finalizeAutoEditUploadSession(owner: string, sessionId: string) {
  if (!isValidUuid(sessionId)) return { kind: "missing" as const };
  const outcome = await withSessionLock(owner, sessionId, async () => {
    const manifest = await readManifest(owner, sessionId);
    if (!manifest) return { kind: "missing" as const };
    if (manifest.finalizedJobId) return { kind: "already_finalized" as const, jobId: manifest.finalizedJobId };

    const incomplete = manifest.videos.find((v) => !v.complete || v.uploaded !== v.size);
    if (incomplete) {
      return {
        kind: "incomplete" as const,
        filename: incomplete.filename,
        uploaded: incomplete.uploaded,
        size: incomplete.size,
      };
    }

    const jobId = manifest.sessionId;
    const sessionDir = autoEditSessionDir(owner, sessionId);
    const jobDir = autoEditJobMediaDir(owner, jobId);
    await mkdir(path.dirname(jobDir), { recursive: true, mode: 0o700 });
    await rename(sessionDir, jobDir);

    const videos: AutoEditSourceVideo[] = manifest.videos.map(({ id, filename, extension, size, order }) => ({
      id,
      filename,
      extension,
      size,
      order,
    }));

    return {
      kind: "ready_to_queue" as const,
      jobId,
      options: manifest.options,
      videos,
      images: manifest.images,
    };
  });

  if (!outcome.locked) return { kind: "busy" as const };
  return outcome.value;
}

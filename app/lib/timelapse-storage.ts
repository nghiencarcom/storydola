import { createHash } from "node:crypto";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const MEDIA_ROOT = path.join(process.cwd(), "data", "media", "timelapse");

export type TimelapseImageMime = "image/png" | "image/jpeg" | "image/webp";

export function safeTimelapseId(value: string) {
  const normalized = value.trim();
  return /^[a-zA-Z0-9_-]{1,100}$/.test(normalized) ? normalized : "";
}

function ownerKey(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 24);
}

function imageExtension(mime: TimelapseImageMime) {
  return mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
}

function imageMimeFromBytes(bytes: Buffer): TimelapseImageMime | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return undefined;
}

export function validateTimelapseImage(bytes: Buffer) {
  const mime = imageMimeFromBytes(bytes);
  return mime ? { mime, extension: imageExtension(mime) } : undefined;
}

function workflowDirectory(userId: string, workflowId: string) {
  const safeWorkflowId = safeTimelapseId(workflowId);
  if (!userId.trim() || !safeWorkflowId) throw new Error("TIMELAPSE_IMAGE_NOT_FOUND");
  return path.join(MEDIA_ROOT, ownerKey(userId), safeWorkflowId);
}

export async function saveTimelapseImage(userId: string, workflowId: string, imageId: string, bytes: Buffer) {
  const safeImageId = safeTimelapseId(imageId);
  const validImage = validateTimelapseImage(bytes);
  if (!safeImageId || !validImage) throw new Error("TIMELAPSE_IMAGE_INVALID");
  if (bytes.length < 1 || bytes.length > 8 * 1024 * 1024) throw new Error("TIMELAPSE_IMAGE_TOO_LARGE");
  const directory = workflowDirectory(userId, workflowId);
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${safeImageId}${validImage.extension}`);
  await writeFile(filePath, bytes);
  return { filePath, mime: validImage.mime };
}

export async function readTimelapseImage(userId: string, workflowId: string, imageId: string) {
  const safeImageId = safeTimelapseId(imageId);
  if (!safeImageId) return undefined;
  const directory = workflowDirectory(userId, workflowId);
  for (const mime of ["image/png", "image/jpeg", "image/webp"] as const) {
    try {
      const extension = imageExtension(mime);
      const bytes = await readFile(path.join(directory, `${safeImageId}${extension}`));
      return { bytes, contentType: mime };
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException)?.code !== "ENOENT") throw cause;
    }
  }
  return undefined;
}

export async function deleteTimelapseImage(userId: string, workflowId: string, imageId: string) {
  const safeImageId = safeTimelapseId(imageId);
  if (!safeImageId) return false;
  const directory = workflowDirectory(userId, workflowId);
  let removed = false;
  for (const extension of [".png", ".jpg", ".webp"]) {
    try {
      await unlink(path.join(directory, `${safeImageId}${extension}`));
      removed = true;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException)?.code !== "ENOENT") throw cause;
    }
  }
  return removed;
}

export async function deleteTimelapseWorkflow(userId: string, workflowId: string) {
  const directory = workflowDirectory(userId, workflowId);
  await rm(directory, { recursive: true, force: true });
}

export function timelapseVideoPath(userId: string, workflowId: string, transitionId: string) {
  const safeTransitionId = safeTimelapseId(transitionId);
  if (!safeTransitionId) throw new Error("TIMELAPSE_VIDEO_NOT_FOUND");
  return path.join(workflowDirectory(userId, workflowId), `${safeTransitionId}-flow-video.mp4`);
}

import { randomUUID } from "node:crypto";
import { open, mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodingAgentPreference } from "./coding-agent-preferences";
import { dataPath } from "./data-directory";
import { addLocalRemakeJob, remakeOwnerFolder } from "./video-remake-worker";
import type { RemakeLocalSource, RemakeOptions } from "./video-remake";

const root = dataPath("video-remake");
const allowedExtensions = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv"]);
const staleUploadLockMs = 2 * 60_000;
const uploadBootId = randomUUID();
export const remakeUploadChunkBytes = 8 * 1024 * 1024;

type UploadManifest = RemakeOptions & {
  id: string;
  filename: string;
  extension: string;
  size: number;
  uploaded: number;
  agent: CodingAgentPreference;
  complete: boolean;
  jobId?: string;
};

function uploadDirectory(owner: string, id: string) {
  return path.join(root, remakeOwnerFolder(owner), "uploads", id);
}

function isUploadId(id: string) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(id);
}

function manifestPath(owner: string, id: string) {
  return path.join(uploadDirectory(owner, id), "manifest.json");
}

async function readManifest(owner: string, id: string): Promise<UploadManifest | undefined> {
  if (!isUploadId(id)) return undefined;
  try {
    const value = JSON.parse(await readFile(manifestPath(owner, id), "utf8")) as UploadManifest;
    return value.id === id ? value : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function saveManifest(owner: string, manifest: UploadManifest) {
  const directory = uploadDirectory(owner, manifest.id);
  const target = manifestPath(owner, manifest.id);
  const temporary = path.join(directory, `.manifest-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(manifest), { flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function beginRemakeUpload(owner: string, filename: string, size: number, options: RemakeOptions, agent: CodingAgentPreference) {
  const normalizedName = path.basename(filename.replace(/\\/gu, "/")).replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, 255);
  const extension = path.extname(normalizedName).toLowerCase();
  if (!normalizedName || !allowedExtensions.has(extension)) throw new Error("Chọn video MP4, MOV, WebM hoặc MKV.");
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("Không đọc được dung lượng tệp video.");
  const id = randomUUID();
  const directory = uploadDirectory(owner, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const part = await open(path.join(directory, "source.part"), "wx", 0o600);
  await part.close();
  const manifest: UploadManifest = {
    id, filename: normalizedName, extension, size, uploaded: 0,
    language: options.language, direction: options.direction, transcript: options.transcript,
    remakeMode: options.remakeMode, dialoguePolicy: options.dialoguePolicy,
    visualStyle: options.visualStyle, imageStyle: options.imageStyle,
    contentGenre: options.contentGenre, storySetting: options.storySetting,
    agent, complete: false,
  };
  await saveManifest(owner, manifest);
  return { uploadId: id, uploaded: 0, size };
}

export async function getRemakeUpload(owner: string, id: string) {
  const manifest = await readManifest(owner, id);
  if (!manifest) return undefined;
  return { uploadId: id, filename: manifest.filename, uploaded: manifest.uploaded, size: manifest.size, complete: manifest.complete };
}

async function acquireUploadLock(lockPath: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, bootId: uploadBootId, startedAt: new Date().toISOString() }));
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
        throw error;
      }
      return {
        kind: "ok" as const,
        release: async () => {
          await handle.close().catch(() => undefined);
          await unlink(lockPath).catch(() => undefined);
        },
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { kind: "missing" as const };
      if (code !== "EEXIST") throw error;
      const [contents, details] = await Promise.all([
        readFile(lockPath, "utf8").catch(() => ""),
        stat(lockPath).catch(() => undefined),
      ]);
      let ownerPid = 0;
      let lockBootId = "";
      try {
        const parsed = JSON.parse(contents) as { pid?: unknown; bootId?: unknown };
        ownerPid = Number(parsed.pid);
        lockBootId = typeof parsed.bootId === "string" ? parsed.bootId : "";
      } catch { /* Lock file may still be mid-write. */ }
      const hasParsedPid = Number.isInteger(ownerPid) && ownerPid > 0;
      let ownerAlive = false;
      if (hasParsedPid) {
        try {
          process.kill(ownerPid, 0);
          ownerAlive = ownerPid !== process.pid || lockBootId === uploadBootId;
        } catch {
          ownerAlive = false;
        }
      }
      const expiredByAge = Boolean(details && Date.now() - details.mtimeMs > staleUploadLockMs);
      if ((!hasParsedPid || ownerAlive) && !expiredByAge) {
        return { kind: "busy" as const };
      }
      await unlink(lockPath).catch(() => undefined);
    }
  }
  return { kind: "busy" as const };
}

export async function writeRemakeUploadChunk(owner: string, id: string, offset: number, bytes: Buffer) {
  if (!isUploadId(id)) return { kind: "missing" as const };
  if (!Number.isSafeInteger(offset) || offset < 0 || !bytes.length || bytes.length > remakeUploadChunkBytes) return { kind: "invalid" as const };
  const directory = uploadDirectory(owner, id);
  const lockPath = path.join(directory, ".upload.lock");
  const acquired = await acquireUploadLock(lockPath);
  if (acquired.kind !== "ok") return acquired;
  try {
    const manifest = await readManifest(owner, id);
    if (!manifest) return { kind: "missing" as const };
    if (manifest.complete) return { kind: "complete" as const, uploaded: manifest.uploaded };
    if (offset !== manifest.uploaded) return { kind: "offset" as const, uploaded: manifest.uploaded };
    if (offset + bytes.length > manifest.size) return { kind: "invalid" as const };
    const partPath = path.join(directory, "source.part");
    const file = await open(partPath, "r+");
    try {
      await file.truncate(manifest.uploaded);
      let written = 0;
      while (written < bytes.length) {
        const result = await file.write(bytes, written, bytes.length - written, manifest.uploaded + written);
        if (!result.bytesWritten) throw new Error("VIDEO_REMAKE_UPLOAD_WRITE_FAILED");
        written += result.bytesWritten;
      }
      await file.sync();
    } finally {
      await file.close();
    }
    manifest.uploaded += bytes.length;
    await saveManifest(owner, manifest);
    return { kind: "ok" as const, uploaded: manifest.uploaded };
  } finally {
    await acquired.release();
  }
}

export async function finishRemakeUpload(
  owner: string,
  id: string,
  overrides?: { options?: RemakeOptions; agent?: CodingAgentPreference },
) {
  if (!isUploadId(id)) return { kind: "missing" as const };
  const directory = uploadDirectory(owner, id);
  const lockPath = path.join(directory, ".upload.lock");
  const acquired = await acquireUploadLock(lockPath);
  if (acquired.kind !== "ok") return acquired;
  try {
    const manifest = await readManifest(owner, id);
    if (!manifest) return { kind: "missing" as const };
    if (manifest.jobId) return { kind: "queued" as const, id: manifest.jobId };
    if (overrides?.options) {
      manifest.language = overrides.options.language;
      manifest.direction = overrides.options.direction;
      manifest.transcript = overrides.options.transcript;
      manifest.remakeMode = overrides.options.remakeMode;
      manifest.dialoguePolicy = overrides.options.dialoguePolicy;
      manifest.visualStyle = overrides.options.visualStyle;
      manifest.imageStyle = overrides.options.imageStyle;
      manifest.contentGenre = overrides.options.contentGenre;
      manifest.storySetting = overrides.options.storySetting;
    }
    if (overrides?.agent) {
      manifest.agent = overrides.agent;
    }
    const partPath = path.join(directory, "source.part");
    const finalPath = path.join(directory, `source${manifest.extension}`);
    if (!manifest.complete) {
      const details = await stat(partPath).catch(() => undefined);
      if (manifest.uploaded !== manifest.size || details?.size !== manifest.size) {
        return { kind: "incomplete" as const, uploaded: manifest.uploaded, size: manifest.size };
      }
      await rename(partPath, finalPath);
      manifest.complete = true;
    }
    await saveManifest(owner, manifest);
    const localSource: RemakeLocalSource = { uploadId: id, filename: manifest.filename, extension: manifest.extension };
    const jobId = await addLocalRemakeJob(owner, {
      language: manifest.language, direction: manifest.direction, transcript: manifest.transcript,
      remakeMode: manifest.remakeMode ?? "faithful",
      dialoguePolicy: manifest.dialoguePolicy ?? "auto",
      visualStyle: manifest.visualStyle ?? "",
      imageStyle: manifest.imageStyle ?? "",
      contentGenre: manifest.contentGenre ?? "",
      storySetting: manifest.storySetting ?? "",
    }, manifest.agent, localSource);
    if (!jobId) return { kind: "queue-full" as const };
    manifest.jobId = jobId;
    await saveManifest(owner, manifest);
    return { kind: "queued" as const, id: jobId };
  } finally {
    await acquired.release();
  }
}

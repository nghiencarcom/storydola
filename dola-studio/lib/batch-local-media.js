import crypto from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const MEDIA_ROOT = path.resolve(process.cwd(), "data", "media", "batch-references");
const INDEX_PATH = path.join(MEDIA_ROOT, "index.json");
const MAX_FILES = 30;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ID_PATTERN = /^[a-f0-9]{32}$/;
const FILE_PATTERN = /^([a-f0-9]{32})\.(jpg|png|webp)$/;

let indexQueue = Promise.resolve();

export class BatchLocalMediaError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "BatchLocalMediaError";
    this.status = status;
  }
}

function enqueueIndexUpdate(update) {
  const result = indexQueue.then(update);
  indexQueue = result.catch(() => {});
  return result;
}

function isSafeRecord(record) {
  if (!record || typeof record !== "object") return false;
  const id = String(record.id || "");
  const fileName = String(record.fileName || "");
  const match = fileName.match(FILE_PATTERN);
  return ID_PATTERN.test(id) && Boolean(match && match[1] === id);
}

async function readRecords() {
  try {
    const parsed = JSON.parse(await readFile(INDEX_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed.filter(isSafeRecord) : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeRecords(records) {
  await mkdir(MEDIA_ROOT, { recursive: true });
  const temporaryPath = path.join(MEDIA_ROOT, `index.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, JSON.stringify(records, null, 2), "utf8");
    await rename(temporaryPath, INDEX_PATH);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function detectImageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return null;
}

function cleanOriginalName(value) {
  const name = String(value || "Ảnh tham chiếu")
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 180);
  return name || "Ảnh tham chiếu";
}

function isUploadFile(value) {
  return Boolean(value && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.name === "string");
}

export function isLocalOnlyRequest(request) {
  const host = request.headers.get("host") || new URL(request.url).host;
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1") return true;
    const octets = hostname.split(".");
    return octets.length === 4
      && Number(octets[0]) === 127
      && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
  } catch {
    return false;
  }
}

export async function listBatchReferenceImages(request) {
  await indexQueue;
  const records = await readRecords();
  const origin = new URL(request.url).origin;
  return records
    .slice()
    .sort((left, right) => String(right.uploadedAt || "").localeCompare(String(left.uploadedAt || "")))
    .map((record) => {
      const fileUrl = new URL(`/api/batches/references/${record.id}`, origin).toString();
      return {
        id: record.id,
        name: record.originalFileName,
        originalFileName: record.originalFileName,
        original_file_name: record.originalFileName,
        file_name: record.fileName,
        relative_path: record.id,
        source: "local",
        kind: "image",
        size: record.size,
        mimeType: record.mimeType,
        mime_type: record.mimeType,
        uploaded_at: record.uploadedAt,
        previewUrl: `/api/batches/references/${record.id}`,
        publicUrl: fileUrl,
        file_url: fileUrl
      };
    });
}

export async function storeBatchReferenceImages(files, request) {
  const uploads = Array.from(files || []).filter(isUploadFile);
  if (!uploads.length) throw new BatchLocalMediaError("Hãy chọn ít nhất một file ảnh", 400);
  if (uploads.length > MAX_FILES) throw new BatchLocalMediaError("Mỗi lần chỉ được thêm tối đa 30 ảnh", 422);

  const staged = [];
  try {
    for (const file of uploads) {
      const declaredSize = Number(file.size || 0);
      if (!declaredSize || declaredSize > MAX_FILE_BYTES) {
        throw new BatchLocalMediaError(`Mỗi ảnh tối đa 25 MB: ${cleanOriginalName(file.name)}`, 422);
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_FILE_BYTES) {
        throw new BatchLocalMediaError(`Mỗi ảnh tối đa 25 MB: ${cleanOriginalName(file.name)}`, 422);
      }
      const imageType = detectImageType(bytes);
      if (!imageType) {
        throw new BatchLocalMediaError(`File không phải ảnh được hỗ trợ: ${cleanOriginalName(file.name)}`, 422);
      }

      const id = crypto.randomBytes(16).toString("hex");
      const fileName = `${id}.${imageType.extension}`;
      const temporaryPath = path.join(MEDIA_ROOT, `${id}.uploading`);
      await mkdir(MEDIA_ROOT, { recursive: true });
      try {
        await writeFile(temporaryPath, bytes, { flag: "wx" });
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
      }
      staged.push({
        id,
        fileName,
        temporaryPath,
        originalFileName: cleanOriginalName(file.name),
        size: bytes.length,
        mimeType: imageType.mimeType,
        uploadedAt: new Date().toISOString()
      });
    }

    await enqueueIndexUpdate(async () => {
      const records = await readRecords();
      const movedPaths = [];
      try {
        for (const item of staged) {
          const finalPath = path.join(MEDIA_ROOT, item.fileName);
          await rename(item.temporaryPath, finalPath);
          movedPaths.push(finalPath);
        }
        const nextRecords = records.concat(staged.map(({ temporaryPath: _temporaryPath, ...record }) => record));
        await writeRecords(nextRecords);
      } catch (error) {
        await Promise.all(movedPaths.map((filePath) => rm(filePath, { force: true }).catch(() => {})));
        throw error;
      }
    });
  } catch (error) {
    await Promise.all(staged.map((item) => rm(item.temporaryPath, { force: true }).catch(() => {})));
    throw error;
  }

  const origin = new URL(request.url).origin;
  const items = staged.map((item) => {
    const fileUrl = new URL(`/api/batches/references/${item.id}`, origin).toString();
    return {
      id: item.id,
      name: item.originalFileName,
      originalFileName: item.originalFileName,
      original_file_name: item.originalFileName,
      file_name: item.fileName,
      relative_path: item.id,
      source: "local",
      kind: "image",
      size: item.size,
      mimeType: item.mimeType,
      mime_type: item.mimeType,
      uploaded_at: item.uploadedAt,
      previewUrl: `/api/batches/references/${item.id}`,
      publicUrl: fileUrl,
      file_url: fileUrl
    };
  });
  return items;
}

export async function deleteBatchReferenceImages(ids) {
  const requestedIds = Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map((value) => String(value || "").trim())
    .filter((value) => ID_PATTERN.test(value))));
  if (!requestedIds.length) throw new BatchLocalMediaError("Không có ảnh hợp lệ để xoá", 400);

  return enqueueIndexUpdate(async () => {
    const records = await readRecords();
    const idsToDelete = new Set(requestedIds);
    const removed = records.filter((record) => idsToDelete.has(record.id));
    if (!removed.length) return [];
    const removedIds = new Set(removed.map((record) => record.id));
    await writeRecords(records.filter((record) => !removedIds.has(record.id)));
    await Promise.all(removed.map((record) => rm(path.join(MEDIA_ROOT, record.fileName), { force: true }).catch(() => {})));
    return [...removedIds];
  });
}

export async function readBatchReferenceImage(id) {
  if (!ID_PATTERN.test(String(id || ""))) return null;
  await indexQueue;
  const record = (await readRecords()).find((item) => item.id === id);
  if (!record) return null;
  const bytes = await readFile(path.join(MEDIA_ROOT, record.fileName)).catch(() => null);
  return bytes ? { record, bytes } : null;
}

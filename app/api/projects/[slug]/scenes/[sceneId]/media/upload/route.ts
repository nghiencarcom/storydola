import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import { findProjectScene } from "../../../../../../../lib/scene-store";
import { resolveMediaGenerationSettings } from "../../../../../../../lib/media-generation-settings";
import { MAX_SCENE_MEDIA_UPLOAD_BYTES, SCENE_MEDIA_UPLOAD_CHUNK_BYTES, SCENE_MEDIA_UPLOAD_TTL_MS } from "../../../../../../../lib/scene-media-upload-config";
import { saveGeneratedSceneMedia } from "../../../../../../../lib/scene-media-output";
import { readData } from "../../../../../../../lib/server-store";
import type { SceneMediaAsset, StoryProject } from "../../../../../../../lib/project-types";

export const runtime = "nodejs";

type UploadSession = {
  version: 1;
  id: string;
  userId: string;
  projectSlug: string;
  sceneId: string;
  chunkId: string;
  fileName: string;
  fileSize: number;
  chunkSize: number;
  chunkCount: number;
  createdAt: number;
  updatedAt: number;
  completedResponse?: { ok: true; outputPath: string };
};

class UploadRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "UploadRequestError";
  }
}

const uploadRoot = path.join(process.cwd(), "data", "tmp", "scene-media-uploads");
const finalizingSessions = new Set<string>();

function getUserId(request: Request) {
  const userId = request.headers.get("x-storyai-user-id")?.trim();
  if (!userId) throw new UploadRequestError("Vui lòng đăng nhập MaiVideo để tải media lên.", 401);
  return userId;
}

async function getProjectScene(slug: string, sceneId: string) {
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) throw new UploadRequestError("Không tìm thấy project.", 404);
  const { scene } = await findProjectScene(project, sceneId);
  if (!scene) throw new UploadRequestError("Không tìm thấy cảnh.", 404);
  return { project, scene };
}

function uploadOwnerDirectory(userId: string) {
  return path.join(uploadRoot, Buffer.from(userId).toString("base64url"));
}

function validateUploadId(value: unknown) {
  const uploadId = String(value || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw new UploadRequestError("Mã upload không hợp lệ.", 400);
  return uploadId;
}

function sessionDirectory(userId: string, uploadId: string) {
  return path.join(uploadOwnerDirectory(userId), uploadId);
}

function sessionFilePath(userId: string, uploadId: string) {
  return path.join(sessionDirectory(userId, uploadId), "session.json");
}

function partFilePath(userId: string, uploadId: string, index: number) {
  return path.join(sessionDirectory(userId, uploadId), `${index}.part`);
}

async function writeSession(session: UploadSession) {
  const destination = sessionFilePath(session.userId, session.id);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, JSON.stringify(session), { mode: 0o600 });
  await rename(temporary, destination);
}

async function cleanupExpiredSessions(userId: string) {
  const ownerDirectory = uploadOwnerDirectory(userId);
  const entries = await readdir(ownerDirectory, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - SCENE_MEDIA_UPLOAD_TTL_MS;
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const directory = path.join(ownerDirectory, entry.name);
    try {
      const info = await stat(directory);
      if (info.mtimeMs < cutoff) await rm(directory, { recursive: true, force: true });
    } catch {
      // An upload may finish or be removed while the cleanup pass is running.
    }
  }));
}

async function readSession(userId: string, projectSlug: string, sceneId: string, uploadId: string) {
  let session: UploadSession;
  try {
    session = JSON.parse(await readFile(sessionFilePath(userId, uploadId), "utf8")) as UploadSession;
  } catch {
    throw new UploadRequestError("Không tìm thấy phiên upload hoặc phiên đã hết hạn.", 404);
  }
  if (session.version !== 1 || session.id !== uploadId || session.userId !== userId || session.projectSlug !== projectSlug || session.sceneId !== sceneId) {
    throw new UploadRequestError("Phiên upload không thuộc project hoặc cảnh này.", 404);
  }
  return session;
}

function expectedChunkBytes(session: UploadSession, index: number) {
  return index === session.chunkCount - 1
    ? session.fileSize - session.chunkSize * index
    : session.chunkSize;
}

function responseError(cause: unknown) {
  if (cause instanceof UploadRequestError) return NextResponse.json({ message: cause.message }, { status: cause.status });
  console.error("[scene-media-upload] Upload failed", cause);
  return NextResponse.json({ message: "Không thể upload media cho cảnh. Vui lòng thử lại." }, { status: 500 });
}

async function initializeUpload(request: Request, userId: string, project: StoryProject, sceneId: string) {
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const fileSize = Number(input?.fileSize);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) throw new UploadRequestError("Kích thước file upload không hợp lệ.", 400);
  if (fileSize > MAX_SCENE_MEDIA_UPLOAD_BYTES) throw new UploadRequestError("File không được vượt quá 250 MB.", 413);

  const { scene } = await findProjectScene(project, sceneId);
  if (!scene) throw new UploadRequestError("Không tìm thấy cảnh.", 404);
  const fileName = String(input?.fileName || "media").replace(/\\/g, "/").split("/").pop()?.replace(/[\u0000-\u001f]/g, "").slice(0, 240) || "media";
  const uploadId = randomUUID();
  const chunkCount = Math.ceil(fileSize / SCENE_MEDIA_UPLOAD_CHUNK_BYTES);
  const now = Date.now();
  const session: UploadSession = {
    version: 1,
    id: uploadId,
    userId,
    projectSlug: project.slug,
    sceneId,
    chunkId: scene.chunkId,
    fileName,
    fileSize,
    chunkSize: SCENE_MEDIA_UPLOAD_CHUNK_BYTES,
    chunkCount,
    createdAt: now,
    updatedAt: now,
  };

  await cleanupExpiredSessions(userId);
  await mkdir(sessionDirectory(userId, uploadId), { recursive: true, mode: 0o700 });
  await writeSession(session);
  return NextResponse.json({ ok: true, uploadId, fileSize, chunkSize: session.chunkSize, chunkCount, maxBytes: MAX_SCENE_MEDIA_UPLOAD_BYTES }, { status: 201 });
}

async function receiveChunk(request: Request, userId: string, projectSlug: string, sceneId: string, requestUrl: URL) {
  const uploadId = validateUploadId(requestUrl.searchParams.get("uploadId"));
  const index = Number(requestUrl.searchParams.get("index"));
  const session = await readSession(userId, projectSlug, sceneId, uploadId);
  if (!Number.isSafeInteger(index) || index < 0 || index >= session.chunkCount) throw new UploadRequestError("Số thứ tự phần upload không hợp lệ.", 400);
  if (session.completedResponse) return NextResponse.json({ ok: true, uploadId, index, alreadyCompleted: true });

  const expectedBytes = expectedChunkBytes(session, index);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > SCENE_MEDIA_UPLOAD_CHUNK_BYTES || contentLength > expectedBytes) throw new UploadRequestError("Phần upload vượt kích thước cho phép.", 413);
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length !== expectedBytes) throw new UploadRequestError(`Phần ${index + 1}/${session.chunkCount} bị thiếu dữ liệu. Hãy thử lại.`, 400);

  await writeFile(partFilePath(userId, uploadId, index), bytes, { mode: 0o600 });
  session.updatedAt = Date.now();
  await writeSession(session);
  const entries = await readdir(sessionDirectory(userId, uploadId));
  const receivedChunks = entries.filter((name) => /^\d+\.part$/.test(name)).length;
  return NextResponse.json({ ok: true, uploadId, index, receivedChunks, chunkCount: session.chunkCount });
}

async function* readUploadParts(session: UploadSession) {
  for (let index = 0; index < session.chunkCount; index += 1) {
    const partPath = partFilePath(session.userId, session.id, index);
    const expectedBytes = expectedChunkBytes(session, index);
    let info;
    try {
      info = await stat(partPath);
    } catch {
      throw new UploadRequestError(`Thiếu phần upload ${index + 1}/${session.chunkCount}. Hãy thử tải lại file.`, 409);
    }
    if (!info.isFile() || info.size !== expectedBytes) throw new UploadRequestError(`Phần upload ${index + 1}/${session.chunkCount} không đủ dữ liệu.`, 409);
    for await (const chunk of createReadStream(partPath)) yield chunk;
  }
}

async function detectMediaExtension(filePath: string) {
  const handle = await open(filePath, "r");
  const header = Buffer.alloc(12);
  try {
    const result = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, result.bytesRead);
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
    if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
    if (bytes.toString("ascii", 4, 8) === "ftyp") return "mp4";
    return "";
  } finally {
    await handle.close();
  }
}

async function completeUpload(userId: string, project: StoryProject, sceneId: string, uploadId: string) {
  const session = await readSession(userId, project.slug, sceneId, uploadId);
  if (session.completedResponse) return NextResponse.json(session.completedResponse);
  const directory = sessionDirectory(userId, uploadId);
  if (finalizingSessions.has(directory)) return NextResponse.json({ message: "File đang được ghép, vui lòng chờ một chút." }, { status: 425 });
  finalizingSessions.add(directory);

  try {
    const assembledPath = path.join(directory, "assembled.tmp");
    await rm(assembledPath, { force: true });
    await pipeline(Readable.from(readUploadParts(session)), createWriteStream(assembledPath, { flags: "wx", mode: 0o600 }));
    const assembledInfo = await stat(assembledPath);
    if (assembledInfo.size !== session.fileSize) throw new UploadRequestError("Kích thước file sau khi ghép không khớp.", 400);

    const extension = await detectMediaExtension(assembledPath);
    if (!extension) throw new UploadRequestError("Chỉ hỗ trợ PNG, JPG, WebP hoặc MP4.", 415);
    const { scene } = await findProjectScene(project, sceneId);
    if (!scene) throw new UploadRequestError("Không tìm thấy cảnh.", 404);
    const safeSceneId = scene.id.replace(/[^a-z0-9_-]/gi, "-");
    const relativePath = path.join("data", "media", project.slug, scene.chunkId, `${safeSceneId}-upload-${uploadId}.${extension}`);
    const absolutePath = path.resolve(process.cwd(), relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await rm(absolutePath, { force: true });
    await rename(assembledPath, absolutePath);

    const media: SceneMediaAsset = {
      kind: extension === "mp4" ? "video" : "image",
      provider: "upload",
      status: "ready",
      localPath: relativePath,
      sourceUrl: "",
      query: session.fileName,
    };
    const saved = await saveGeneratedSceneMedia({
      projectSlug: project.slug,
      sceneId,
      media,
      mediaGeneration: resolveMediaGenerationSettings(project.mediaGeneration),
      userId,
    });
    session.updatedAt = Date.now();
    session.completedResponse = { ok: true, outputPath: saved.outputPath };
    await writeSession(session);
    await Promise.all(Array.from({ length: session.chunkCount }, (_, index) => rm(partFilePath(userId, uploadId, index), { force: true }).catch(() => undefined)));
    return NextResponse.json({ ok: true, ...saved });
  } finally {
    finalizingSessions.delete(directory);
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  try {
    const { slug, sceneId } = await context.params;
    const userId = getUserId(request);
    const { project } = await getProjectScene(slug, sceneId);
    const requestUrl = new URL(request.url);
    const action = requestUrl.searchParams.get("action");
    if (action === "init") return await initializeUpload(request, userId, project, sceneId);
    if (action === "chunk") return await receiveChunk(request, userId, slug, sceneId, requestUrl);
    if (action === "complete") {
      const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
      return await completeUpload(userId, project, sceneId, validateUploadId(payload?.uploadId));
    }
    throw new UploadRequestError("Thao tác upload không hợp lệ.", 400);
  } catch (cause) {
    return responseError(cause);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  try {
    const { slug, sceneId } = await context.params;
    const userId = getUserId(request);
    await getProjectScene(slug, sceneId);
    const uploadId = validateUploadId(new URL(request.url).searchParams.get("uploadId"));
    const session = await readSession(userId, slug, sceneId, uploadId);
    if (!session.completedResponse) await rm(sessionDirectory(userId, uploadId), { recursive: true, force: true });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    if (cause instanceof UploadRequestError && cause.status === 404) return NextResponse.json({ ok: true });
    return responseError(cause);
  }
}

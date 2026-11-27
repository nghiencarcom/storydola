import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, link, mkdir, readFile, realpath, stat, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { AutoEditProductImage, AutoEditSourceVideo } from "./auto-edit";
import { probeAutoEditVideo } from "./auto-edit-media";
import {
  allowedImageExtensions,
  allowedVideoExtensions,
  autoEditJobMediaDir,
  maxAutoEditImages,
  maxAutoEditVideos,
  normalizeAndSaveProductImage,
} from "./auto-edit-upload";

const exec = promisify(execFile);
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export type PickedLocalFileItem = {
  token: string;
  filename: string;
  displayPath: string;
  extension: string;
  size: number;
  kind: "video" | "image";
};

type StoredLocalFileRecord = PickedLocalFileItem & {
  owner: string;
  realPath: string;
  createdAt: number;
};

const globalStore = globalThis as typeof globalThis & {
  storyAiLocalAutoEditFiles?: Map<string, StoredLocalFileRecord>;
};

const tokenStore = (globalStore.storyAiLocalAutoEditFiles ??= new Map<string, StoredLocalFileRecord>());

function pruneExpiredTokens() {
  const now = Date.now();
  for (const [key, entry] of tokenStore.entries()) {
    if (now - entry.createdAt > TOKEN_TTL_MS) {
      tokenStore.delete(key);
    }
  }
}

function isLoopbackHost(hostname: string): boolean {
  const clean = hostname.trim().toLowerCase().replace(/^\[|\]$/gu, "");
  return clean === "localhost" || clean === "127.0.0.1" || clean === "::1";
}

export function isLocalLoopbackRequest(request: Request): boolean {
  try {
    const reqUrl = new URL(request.url);
    if (!isLoopbackHost(reqUrl.hostname)) return false;

    const hostHeader = request.headers.get("host");
    if (hostHeader) {
      const parsedHost = new URL(`http://${hostHeader}`);
      if (!isLoopbackHost(parsedHost.hostname)) return false;
    }

    const originHeader = request.headers.get("origin");
    if (originHeader) {
      const parsedOrigin = new URL(originHeader);
      if (!isLoopbackHost(parsedOrigin.hostname)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function expandHomePath(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/^["']+|["']+$/gu, "");
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

async function registerVerifiedLocalFile(
  owner: string,
  rawFilePath: string,
  kind: "video" | "image",
  verifyMediaProbe: boolean,
): Promise<PickedLocalFileItem> {
  pruneExpiredTokens();
  const expanded = expandHomePath(rawFilePath);
  if (!expanded) {
    throw new Error("Đường dẫn tệp trống.");
  }

  let resolved: string;
  try {
    resolved = await realpath(expanded);
  } catch {
    throw new Error(`Không tìm thấy tệp trên máy: "${rawFilePath}".`);
  }

  const details = await stat(resolved).catch(() => undefined);
  if (!details || !details.isFile() || details.size <= 0) {
    throw new Error(`Tệp "${path.basename(resolved)}" không hợp lệ hoặc rỗng (0 byte).`);
  }

  const filename = path.basename(resolved);
  const extension = path.extname(filename).toLowerCase();

  if (kind === "video") {
    if (!allowedVideoExtensions.has(extension)) {
      throw new Error(`Tệp "${filename}" chưa hỗ trợ. Hãy chọn MP4, MOV, MKV, WebM hoặc M4V.`);
    }
    if (verifyMediaProbe) {
      await probeAutoEditVideo(resolved);
    }
  } else {
    if (!allowedImageExtensions.has(extension)) {
      throw new Error(`Ảnh "${filename}" chưa hỗ trợ. Hãy chọn PNG, JPG, JPEG hoặc WebP.`);
    }
    if (verifyMediaProbe) {
      const meta = await sharp(resolved).metadata().catch(() => undefined);
      if (!meta?.width || !meta?.height) {
        throw new Error(`Không đọc được tệp ảnh "${filename}".`);
      }
    }
  }

  const token = `lf_${randomUUID()}`;
  const item: StoredLocalFileRecord = {
    token,
    owner,
    kind,
    realPath: resolved,
    displayPath: resolved,
    filename,
    extension,
    size: details.size,
    createdAt: Date.now(),
  };
  tokenStore.set(token, item);

  return {
    token: item.token,
    filename: item.filename,
    displayPath: item.displayPath,
    extension: item.extension,
    size: item.size,
    kind: item.kind,
  };
}

export async function openNativeOsFileDialog(
  owner: string,
  kind: "video" | "image",
  options?: { multiple?: boolean; promptTitle?: string },
): Promise<{ cancelled: boolean; files: PickedLocalFileItem[] }> {
  const allowMultiple = options?.multiple ?? true;
  let rawLines: string[] = [];

  if (process.platform === "darwin") {
    const promptText = options?.promptTitle || (kind === "video"
      ? "Chọn video cần Auto Edit (1-20 clip, không giới hạn GB):"
      : "Chọn ảnh sản phẩm / minh hoạ (1-20 ảnh):");
    const typeList = kind === "video"
      ? '{"public.movie", "mp4", "mov", "mkv", "webm", "m4v"}'
      : '{"public.image", "png", "jpg", "jpeg", "webp"}';
    const script = allowMultiple
      ? [
          `set chosenFiles to choose file of type ${typeList} with prompt "${promptText.replace(/"/gu, '\\"')}" with multiple selections allowed`,
          `set outText to ""`,
          `repeat with f in chosenFiles`,
          `  set outText to outText & POSIX path of f & linefeed`,
          `end repeat`,
          `return outText`,
        ].join("\n")
      : [
          `set chosenFile to choose file of type ${typeList} with prompt "${promptText.replace(/"/gu, '\\"')}"`,
          `return POSIX path of chosenFile`,
        ].join("\n");

    try {
      const { stdout } = await exec("osascript", ["-e", script], { timeout: 300_000, maxBuffer: 1_000_000 });
      rawLines = stdout.split(/\r?\n/u).map((s) => s.trim()).filter(Boolean);
    } catch (error) {
      const stderr = String((error as { stderr?: unknown })?.stderr || (error as Error)?.message || "");
      if (stderr.includes("-128") || /user canceled/iu.test(stderr)) {
        return { cancelled: true, files: [] };
      }
      throw new Error("Không mở được hộp thoại Finder trên macOS. Bạn có thể dán trực tiếp đường dẫn tệp bên dưới.");
    }
  } else if (process.platform === "win32") {
    const filter = kind === "video"
      ? "Video Files (*.mp4;*.mov;*.mkv;*.webm;*.m4v)|*.mp4;*.mov;*.mkv;*.webm;*.m4v"
      : "Image Files (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp";
    const title = (options?.promptTitle || (kind === "video"
      ? "Chon video can Auto Edit (Khong gioi han dung luong)"
      : "Chon anh san pham / minh hoa")).replace(/'/gu, "''");
    const psScript = [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dlg = New-Object System.Windows.Forms.OpenFileDialog",
      `$dlg.Multiselect = $${allowMultiple ? "true" : "false"}`,
      `$dlg.Title = '${title}'`,
      `$dlg.Filter = '${filter}'`,
      "if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dlg.FileNames | ForEach-Object { Write-Output $_ } }",
    ].join("; ");

    try {
      const { stdout } = await exec(
        "powershell.exe",
        ["-NoProfile", "-Sta", "-Command", psScript],
        { timeout: 300_000, maxBuffer: 1_000_000 },
      );
      rawLines = stdout.split(/\r?\n/u).map((s) => s.trim()).filter(Boolean);
      if (!rawLines.length) return { cancelled: true, files: [] };
    } catch {
      throw new Error("Không mở được hộp thoại chọn tệp Windows. Bạn có thể dán trực tiếp đường dẫn tệp bên dưới.");
    }
  } else {
    const filterArg = kind === "video"
      ? "--file-filter=Video | *.mp4 *.mov *.mkv *.webm *.m4v"
      : "--file-filter=Images | *.png *.jpg *.jpeg *.webp";
    try {
      const { stdout } = await exec(
        "zenity",
        ["--file-selection", ...(allowMultiple ? ["--multiple", "--separator=\n"] : []), filterArg],
        { timeout: 300_000, maxBuffer: 1_000_000 },
      );
      rawLines = stdout.split(/\r?\n/u).map((s) => s.trim()).filter(Boolean);
    } catch (error) {
      if ((error as { code?: unknown })?.code === 1) {
        return { cancelled: true, files: [] };
      }
      throw new Error("Máy chủ Linux chưa có zenity. Hãy dán trực tiếp đường dẫn tệp trên máy ở ô bên dưới.");
    }
  }

  const limit = allowMultiple ? (kind === "video" ? maxAutoEditVideos : maxAutoEditImages) : 1;
  const selected = rawLines.slice(0, limit);
  const files: PickedLocalFileItem[] = [];
  for (const p of selected) {
    files.push(await registerVerifiedLocalFile(owner, p, kind, false));
  }
  return { cancelled: false, files };
}

export async function resolvePastedLocalPaths(
  owner: string,
  pathsInput: readonly string[],
  kind: "video" | "image",
): Promise<PickedLocalFileItem[]> {
  const limit = kind === "video" ? maxAutoEditVideos : maxAutoEditImages;
  const cleaned = pathsInput.map((s) => s.trim()).filter(Boolean).slice(0, limit);
  if (!cleaned.length) {
    throw new Error("Hãy nhập ít nhất 1 đường dẫn tệp trên máy.");
  }
  const results: PickedLocalFileItem[] = [];
  for (const raw of cleaned) {
    results.push(await registerVerifiedLocalFile(owner, raw, kind, true));
  }
  return results;
}

async function linkLocalVideoZeroCopy(sourceRealPath: string, targetPath: string) {
  try {
    await symlink(sourceRealPath, targetPath);
    return;
  } catch {
    // Fallback on Windows when non-admin account lacks symlink privilege: try hardlink on same volume, then copy
  }
  try {
    await link(sourceRealPath, targetPath);
    return;
  } catch {
    await copyFile(sourceRealPath, targetPath);
  }
}

export async function stageZeroCopyLocalAutoEditJob(
  owner: string,
  jobId: string,
  videoTokens: readonly string[],
  localImagesInput: ReadonlyArray<{ token: string; label?: string }>,
  uploadedImagesInput: ReadonlyArray<{ filename: string; label: string; bytes: Buffer }>,
): Promise<{ videos: AutoEditSourceVideo[]; images: AutoEditProductImage[] }> {
  pruneExpiredTokens();
  if (!videoTokens.length || videoTokens.length > maxAutoEditVideos) {
    throw new Error(`Hãy chọn từ 1 đến ${maxAutoEditVideos} video trên máy.`);
  }

  const resolvedVideos: StoredLocalFileRecord[] = [];
  for (const token of videoTokens) {
    const rec = tokenStore.get(token);
    if (!rec || rec.owner !== owner || rec.kind !== "video") {
      throw new Error("Phiên chọn tệp trên máy đã hết hạn. Vui lòng bấm chọn lại video.");
    }
    const check = await stat(rec.realPath).catch(() => undefined);
    if (!check || !check.isFile()) {
      throw new Error(`Không còn tìm thấy tệp "${rec.filename}" tại đường dẫn gốc.`);
    }
    resolvedVideos.push({ ...rec, size: check.size });
  }

  if (localImagesInput.length + uploadedImagesInput.length > maxAutoEditImages) {
    throw new Error(`Tối đa ${maxAutoEditImages} ảnh minh hoạ mỗi bản dựng.`);
  }

  const jobDir = autoEditJobMediaDir(owner, jobId);
  const videosDir = path.join(jobDir, "videos");
  const imagesDir = path.join(jobDir, "images");
  await mkdir(videosDir, { recursive: true, mode: 0o700 });
  await mkdir(imagesDir, { recursive: true, mode: 0o700 });

  const videos: AutoEditSourceVideo[] = [];
  for (let i = 0; i < resolvedVideos.length; i++) {
    const rec = resolvedVideos[i];
    const clipId = `clip_${String(i + 1).padStart(2, "0")}`;
    const linkTarget = path.join(videosDir, `${clipId}${rec.extension}`);
    await linkLocalVideoZeroCopy(rec.realPath, linkTarget);
    videos.push({
      id: clipId,
      filename: rec.filename,
      extension: rec.extension,
      size: rec.size,
      order: i,
    });
  }

  const images: AutoEditProductImage[] = [];
  let imgIdx = 1;
  for (const item of localImagesInput) {
    const rec = tokenStore.get(item.token);
    if (!rec || rec.owner !== owner || rec.kind !== "image") {
      throw new Error("Phiên chọn ảnh trên máy đã hết hạn. Vui lòng chọn lại ảnh.");
    }
    const rawBytes = await readFile(rec.realPath);
    const saved = await normalizeAndSaveProductImage(imagesDir, imgIdx, rec.filename, item.label || "", rawBytes);
    if (saved.kind === "invalid") {
      throw new Error(saved.message);
    }
    images.push(saved.image);
    imgIdx += 1;
  }

  for (const up of uploadedImagesInput) {
    const saved = await normalizeAndSaveProductImage(imagesDir, imgIdx, up.filename, up.label, up.bytes);
    if (saved.kind === "invalid") {
      throw new Error(saved.message);
    }
    images.push(saved.image);
    imgIdx += 1;
  }

  return { videos, images };
}

export async function saveLocalImageTokensToDir(
  owner: string,
  imagesDir: string,
  startIndex: number,
  localImagesInput: ReadonlyArray<{ token: string; label?: string }>,
): Promise<AutoEditProductImage[]> {
  pruneExpiredTokens();
  const savedList: AutoEditProductImage[] = [];
  let idx = startIndex;
  for (const item of localImagesInput) {
    const rec = tokenStore.get(item.token);
    if (!rec || rec.owner !== owner || rec.kind !== "image") {
      throw new Error("Phiên chọn ảnh trên máy đã hết hạn. Vui lòng chọn lại ảnh.");
    }
    const rawBytes = await readFile(rec.realPath);
    const saved = await normalizeAndSaveProductImage(imagesDir, idx, rec.filename, item.label || "", rawBytes);
    if (saved.kind === "invalid") {
      throw new Error(saved.message);
    }
    savedList.push(saved.image);
    idx += 1;
  }
  return savedList;
}

export async function stageZeroCopyLocalVideoToTarget(
  owner: string,
  videoToken: string,
  targetDirectory: string,
  targetBasename = "source",
): Promise<{ filename: string; extension: string; size: number }> {
  pruneExpiredTokens();
  const rec = tokenStore.get(videoToken);
  if (!rec || rec.owner !== owner || rec.kind !== "video") {
    throw new Error("Phiên chọn tệp trên máy đã hết hạn. Vui lòng chọn lại video trên máy.");
  }
  const check = await stat(rec.realPath).catch(() => undefined);
  if (!check || !check.isFile() || check.size <= 0) {
    throw new Error(`Không còn tìm thấy tệp "${rec.filename}" tại đường dẫn gốc.`);
  }
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  const linkTarget = path.join(targetDirectory, `${targetBasename}${rec.extension}`);
  await linkLocalVideoZeroCopy(rec.realPath, linkTarget);
  return { filename: rec.filename, extension: rec.extension, size: check.size };
}

import { after, NextResponse } from "next/server";
import { getCurrentUserId } from "../../../lib/auth-server";
import { getCodingAgentPreference } from "../../../lib/coding-agent-preferences";
import { autoEditOptionsSchema } from "../../../lib/auto-edit";
import {
  addAutoEditProductImage,
  autoEditUploadChunkBytes,
  beginAutoEditUploadSession,
  finalizeAutoEditUploadSession,
  rollbackFinalizedUploadSession,
  writeAutoEditVideoChunk,
} from "../../../lib/auto-edit-upload";
import {
  canEnqueueAutoEditJob,
  createQueuedAutoEditJob,
  getAutoEditJob,
  runAutoEditQueue,
} from "../../../lib/auto-edit-worker";

export const runtime = "nodejs";

function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return respond({ message: "Không đọc được dữ liệu biểu mẫu tải ảnh." }, 400);
    const sessionId = String(form.get("sessionId") || "");
    const label = String(form.get("label") || "");
    const file = form.get("file");
    if (!(file instanceof File)) return respond({ message: "Thiếu tệp ảnh sản phẩm/minh hoạ." }, 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await addAutoEditProductImage(owner, sessionId, file.name, label, bytes);
    if (result.kind === "ok") return respond({ image: result.image }, 201);
    if (result.kind === "busy") return respond({ message: "Đang ghi dữ liệu tải lên, vui lòng thử lại." }, 409);
    if (result.kind === "missing") return respond({ message: "Không tìm thấy phiên tải Auto Edit." }, 404);
    if (result.kind === "complete") return respond({ message: "Phiên tải lên này đã đóng." }, 409);
    return respond({ message: result.message }, 400);
  }

  const body = await request.json().catch(() => null);
  if (body?.action !== "begin" || !Array.isArray(body.videos)) {
    return respond({ message: "Yêu cầu khởi tạo phiên tải lên không hợp lệ." }, 400);
  }

  const options = autoEditOptionsSchema.safeParse(body.options || {});
  if (!options.success) {
    return respond({ message: "Kiểm tra lại thông số cấu hình Auto Edit." }, 400);
  }

  const videosInput = body.videos
    .filter((v: unknown): v is { filename: string; size: number } =>
      Boolean(v && typeof v === "object" && typeof (v as { filename?: unknown }).filename === "string" && typeof (v as { size?: unknown }).size === "number"),
    );

  if (!(await canEnqueueAutoEditJob(owner))) {
    return respond({ message: "Bạn đang có 5 tác vụ Auto Edit đang chạy. Hãy đợi 1 tác vụ hoàn tất." }, 409);
  }

  try {
    const session = await beginAutoEditUploadSession(owner, options.data, videosInput);
    return respond({ session }, 201);
  } catch (error) {
    return respond({ message: error instanceof Error ? error.message : "Chưa tạo được phiên tải lên." }, 400);
  }
}

export async function PUT(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);

  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId") || "";
  const clipId = params.get("clipId") || "";
  const offset = Number(params.get("offset"));
  const lengthHeader = request.headers.get("content-length");
  const announced = lengthHeader === null ? undefined : Number(lengthHeader);

  if (
    !params.has("offset") ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (announced !== undefined && (!Number.isSafeInteger(announced) || announced < 0 || announced > autoEditUploadChunkBytes))
  ) {
    return respond({ message: "Mảnh dữ liệu video không hợp lệ hoặc vượt quá giới hạn mảnh truyền." }, 413);
  }

  const reader = request.body?.getReader();
  if (!reader) return respond({ message: "Không nhận được dữ liệu video." }, 400);

  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      length += value.byteLength;
      if (length > autoEditUploadChunkBytes) {
        await reader.cancel().catch(() => undefined);
        return respond({ message: "Mảnh dữ liệu vượt giới hạn cho phép." }, 413);
      }
      chunks.push(value);
    }
  } catch {
    return respond({ message: "Kết nối tải video bị gián đoạn." }, 400);
  } finally {
    reader.releaseLock();
  }

  const result = await writeAutoEditVideoChunk(owner, sessionId, clipId, offset, Buffer.concat(chunks, length));
  if (result.kind === "ok") return respond({ uploaded: result.uploaded, complete: result.complete });
  if (result.kind === "offset") return respond({ message: "Mốc tải lên đã thay đổi.", uploaded: result.uploaded }, 409);
  if (result.kind === "busy") return respond({ message: "Đang lưu mảnh video trước đó. Hãy thử lại." }, 409);
  if (result.kind === "complete") return respond({ message: "Video này đã tải xong.", uploaded: result.uploaded }, 409);
  if (result.kind === "missing") return respond({ message: "Không tìm thấy phiên tải hoặc clip." }, 404);
  return respond({ message: "Mảnh video không hợp lệ." }, 400);
}

export async function PATCH(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);

  const body = await request.json().catch(() => null);
  if (typeof body?.sessionId !== "string") {
    return respond({ message: "Thiếu mã phiên tải lên." }, 400);
  }

  const existingJob = await getAutoEditJob(owner, body.sessionId);
  if (existingJob) {
    after(() => runAutoEditQueue().catch((err) => console.error("[auto-edit] Queue failed", err)));
    return respond({ id: existingJob.id }, 202);
  }

  if (!(await canEnqueueAutoEditJob(owner))) {
    return respond({ message: "Bạn đang có 5 tác vụ Auto Edit đang chạy. Hãy đợi 1 tác vụ hoàn tất." }, 409);
  }

  const finalized = await finalizeAutoEditUploadSession(owner, body.sessionId);
  if (finalized.kind === "missing") return respond({ message: "Không tìm thấy phiên tải lên." }, 404);
  if (finalized.kind === "busy") return respond({ message: "Đang khoá phiên tải lên, hãy thử lại sau giây lát." }, 409);
  if (finalized.kind === "incomplete") {
    return respond({
      message: `Tệp "${finalized.filename}" mới tải được ${finalized.uploaded.toLocaleString("vi-VN")}/${finalized.size.toLocaleString("vi-VN")} byte.`,
    }, 409);
  }
  if (finalized.kind === "already_finalized") {
    after(() => runAutoEditQueue().catch((err) => console.error("[auto-edit] Queue failed", err)));
    return respond({ id: finalized.jobId }, 202);
  }

  const agentPref = await getCodingAgentPreference(owner).catch(() => undefined);
  const queuedId = await createQueuedAutoEditJob(
    owner,
    finalized.jobId,
    finalized.options,
    finalized.videos,
    finalized.images,
    agentPref,
  );
  if (!queuedId) {
    await rollbackFinalizedUploadSession(owner, finalized.jobId);
    return respond({ message: "Bạn đang có 5 tác vụ Auto Edit đang chạy. Hãy đợi 1 tác vụ hoàn tất." }, 409);
  }

  after(() => runAutoEditQueue().catch((err) => console.error("[auto-edit] Queue failed", err)));
  return respond({ id: queuedId }, 202);
}

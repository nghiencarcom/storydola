import { after, NextResponse } from "next/server";
import { getCurrentUserId } from "../../../lib/auth-server";
import { getCodingAgentCliStatuses } from "../../../lib/coding-agent-cli";
import { getCodingAgentPreference, type CodingAgentPreference } from "../../../lib/coding-agent-preferences";
import { remakeOptionsSchema } from "../../../lib/video-remake";
import { runRemakeQueue } from "../../../lib/video-remake-worker";
import { beginRemakeUpload, finishRemakeUpload, getRemakeUpload, remakeUploadChunkBytes, writeRemakeUploadChunk } from "../../../lib/video-remake-upload";

export const runtime = "nodejs";

function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function configuredAgent(owner: string): Promise<CodingAgentPreference | undefined> {
  const [preference, statuses] = await Promise.all([getCodingAgentPreference(owner), getCodingAgentCliStatuses({ includeModels: false })]);
  return preference && statuses.some(({ id, available }) => id === preference.agent && available) ? preference : undefined;
}

export async function GET(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);
  const id = new URL(request.url).searchParams.get("uploadId") || "";
  const upload = await getRemakeUpload(owner, id);
  return upload ? respond({ upload }) : respond({ message: "Không tìm thấy phiên tải video." }, 404);
}

export async function POST(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);
  const body = await request.json().catch(() => null);
  if (body?.action !== "begin") return respond({ message: "Tác vụ tải video không hợp lệ." }, 400);
  const options = remakeOptionsSchema.safeParse(body);
  if (!options.success || typeof body.filename !== "string" || typeof body.size !== "number") {
    return respond({ message: "Chọn video và kiểm tra ngôn ngữ, định hướng cùng transcript." }, 400);
  }
  const agent = await configuredAgent(owner);
  if (!agent) return respond({ message: "Hãy chọn và kết nối Code Agent CLI trong Cài đặt để phân tích khung hình." }, 503);
  try {
    const upload = await beginRemakeUpload(owner, body.filename, body.size, options.data, agent);
    return respond({ upload }, 201);
  } catch (error) {
    return respond({ message: error instanceof Error ? error.message : "Chưa tạo được phiên tải video." }, 400);
  }
}

export async function PUT(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);
  const params = new URL(request.url).searchParams;
  const id = params.get("uploadId") || "";
  const offset = Number(params.get("offset"));
  const announcedLengthHeader = request.headers.get("content-length");
  const announcedLength = announcedLengthHeader === null ? undefined : Number(announcedLengthHeader);
  if (!params.has("offset") || !Number.isSafeInteger(offset) || offset < 0
    || (announcedLength !== undefined && (!Number.isSafeInteger(announcedLength) || announcedLength < 0 || announcedLength > remakeUploadChunkBytes))) {
    return respond({ message: "Mảnh tải video không hợp lệ hoặc vượt quá 8 MiB." }, 413);
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
      if (length > remakeUploadChunkBytes) {
        await reader.cancel().catch(() => undefined);
        return respond({ message: "Mỗi phần tải lên không được vượt quá 8 MiB." }, 413);
      }
      chunks.push(value);
    }
  } catch {
    return respond({ message: "Mất kết nối khi tải một phần video." }, 400);
  } finally {
    reader.releaseLock();
  }
  const result = await writeRemakeUploadChunk(owner, id, offset, Buffer.concat(chunks, length));
  if (result.kind === "ok") return respond({ uploaded: result.uploaded });
  if (result.kind === "offset") return respond({ message: "Mốc tải lên đã thay đổi.", uploaded: result.uploaded }, 409);
  if (result.kind === "busy") return respond({ message: "Đang ghi phần video trước đó. Hãy thử lại sau giây lát." }, 409);
  if (result.kind === "complete") return respond({ message: "Phiên tải video đã hoàn tất." }, 409);
  if (result.kind === "missing") return respond({ message: "Không tìm thấy phiên tải video." }, 404);
  return respond({ message: "Mảnh video không hợp lệ." }, 400);
}

export async function PATCH(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);
  const body = await request.json().catch(() => null);
  if (typeof body?.uploadId !== "string") return respond({ message: "Thiếu mã phiên tải video." }, 400);
  const result = await finishRemakeUpload(owner, body.uploadId);
  if (result.kind === "queued") {
    after(() => runRemakeQueue().catch((error) => console.error("[video-remake] Queue failed", error)));
    return respond({ id: result.id }, 202);
  }
  if (result.kind === "missing") return respond({ message: "Không tìm thấy phiên tải video." }, 404);
  if (result.kind === "busy") return respond({ message: "Đang lưu video. Hãy thử lại sau giây lát." }, 409);
  if (result.kind === "incomplete") return respond({ message: `Video mới tải được ${result.uploaded.toLocaleString("vi-VN")}/${result.size.toLocaleString("vi-VN")} byte.` }, 409);
  return respond({ message: "Hàng đợi đã đủ 5 job đang chạy. Video đã tải xong; hãy thử thêm lại sau khi một job kết thúc." }, 409);
}

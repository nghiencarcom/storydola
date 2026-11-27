import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { after, NextResponse } from "next/server";
import { getCurrentUserId } from "../../../lib/auth-server";
import { getCodingAgentPreference } from "../../../lib/coding-agent-preferences";
import { autoEditOptionsSchema } from "../../../lib/auto-edit";
import {
  isLocalLoopbackRequest,
  openNativeOsFileDialog,
  resolvePastedLocalPaths,
  stageZeroCopyLocalAutoEditJob,
} from "../../../lib/auto-edit-local-files";
import { autoEditJobMediaDir, maxAutoEditImages } from "../../../lib/auto-edit-upload";
import {
  canEnqueueAutoEditJob,
  createQueuedAutoEditJob,
  runAutoEditQueue,
} from "../../../lib/auto-edit-worker";

export const runtime = "nodejs";

function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);

  if (!isLocalLoopbackRequest(request)) {
    return respond(
      { message: "Tính năng chọn tệp trực tiếp không qua tải lên chỉ khả dụng khi mở StoryAI local (localhost / 127.0.0.1)." },
      403,
    );
  }

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return respond({ message: "Không đọc được biểu mẫu khởi tạo Local Auto Edit." }, 400);

    let rawOptions: unknown = {};
    let videoTokens: string[] = [];
    let localImages: Array<{ token: string; label?: string }> = [];
    try {
      rawOptions = JSON.parse(String(form.get("options") || "{}"));
      videoTokens = JSON.parse(String(form.get("videoTokens") || "[]"));
      localImages = JSON.parse(String(form.get("localImages") || "[]"));
    } catch {
      return respond({ message: "Dữ liệu tệp đã chọn không hợp lệ." }, 400);
    }

    const parsedOptions = autoEditOptionsSchema.safeParse(rawOptions);
    if (!parsedOptions.success) {
      return respond({ message: "Thông số cấu hình Auto Edit không hợp lệ." }, 400);
    }

    const extraFiles = form.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
    let extraLabels: string[] = [];
    try {
      const parsed = JSON.parse(String(form.get("imageLabels") || "[]"));
      if (Array.isArray(parsed)) extraLabels = parsed.map((v) => String(v ?? ""));
    } catch {
      extraLabels = [];
    }

    if (localImages.length + extraFiles.length > maxAutoEditImages) {
      return respond({ message: `Tối đa ${maxAutoEditImages} ảnh minh hoạ mỗi bản dựng.` }, 400);
    }

    if (!(await canEnqueueAutoEditJob(owner))) {
      return respond({ message: "Bạn đang có 5 tác vụ Auto Edit đang chạy. Hãy đợi 1 tác vụ hoàn tất." }, 409);
    }

    const jobId = randomUUID();
    const jobDir = autoEditJobMediaDir(owner, jobId);
    try {
      const uploadedImages = await Promise.all(
        extraFiles.map(async (file, idx) => ({
          filename: file.name,
          label: extraLabels[idx] || "",
          bytes: Buffer.from(await file.arrayBuffer()),
        })),
      );
      const staged = await stageZeroCopyLocalAutoEditJob(
        owner,
        jobId,
        videoTokens,
        localImages,
        uploadedImages,
      );
      const agentPref = await getCodingAgentPreference(owner).catch(() => undefined);
      const queuedId = await createQueuedAutoEditJob(
        owner,
        jobId,
        parsedOptions.data,
        staged.videos,
        staged.images,
        agentPref,
      );
      if (!queuedId) {
        await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
        return respond({ message: "Hàng đợi đang đủ 5 job đang xử lý. Hãy đợi một job hoàn tất." }, 409);
      }
      after(() => runAutoEditQueue().catch((err) => console.error("[auto-edit] Queue failed", err)));
      return respond({ id: queuedId }, 202);
    } catch (error) {
      await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
      return respond({ message: error instanceof Error ? error.message : "Không thể gắn tệp local vào bản dựng." }, 400);
    }
  }

  const body = await request.json().catch(() => null);
  const action = body?.action;

  if (action === "pick-videos" || action === "pick-images") {
    try {
      const kind = action === "pick-videos" ? "video" : "image";
      const result = await openNativeOsFileDialog(owner, kind);
      return respond(result);
    } catch (error) {
      return respond({ message: error instanceof Error ? error.message : "Không mở được hộp thoại chọn tệp." }, 400);
    }
  }

  if (action === "resolve-paths") {
    const kind = body?.kind === "image" ? "image" : "video";
    const paths = Array.isArray(body?.paths)
      ? body.paths.filter((p: unknown): p is string => typeof p === "string")
      : [];
    try {
      const files = await resolvePastedLocalPaths(owner, paths, kind);
      return respond({ files });
    } catch (error) {
      return respond({ message: error instanceof Error ? error.message : "Không đọc được đường dẫn tệp trên máy." }, 400);
    }
  }

  if (action === "create-job") {
    const parsedOptions = autoEditOptionsSchema.safeParse(body?.options || {});
    if (!parsedOptions.success) {
      return respond({ message: "Thông số cấu hình Auto Edit không hợp lệ." }, 400);
    }
    const videoTokens = Array.isArray(body?.videoTokens)
      ? body.videoTokens.filter((t: unknown): t is string => typeof t === "string")
      : [];
    const localImages = Array.isArray(body?.localImages)
      ? body.localImages
        .filter((it: unknown): it is { token: string; label?: string } =>
          Boolean(it && typeof it === "object" && typeof (it as { token?: unknown }).token === "string"),
        )
      : [];

    if (!(await canEnqueueAutoEditJob(owner))) {
      return respond({ message: "Bạn đang có 5 tác vụ Auto Edit đang chạy. Hãy đợi 1 tác vụ hoàn tất." }, 409);
    }

    const jobId = randomUUID();
    const jobDir = autoEditJobMediaDir(owner, jobId);
    try {
      const staged = await stageZeroCopyLocalAutoEditJob(owner, jobId, videoTokens, localImages, []);
      const agentPref = await getCodingAgentPreference(owner).catch(() => undefined);
      const queuedId = await createQueuedAutoEditJob(
        owner,
        jobId,
        parsedOptions.data,
        staged.videos,
        staged.images,
        agentPref,
      );
      if (!queuedId) {
        await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
        return respond({ message: "Hàng đợi đang đủ 5 job đang xử lý." }, 409);
      }
      after(() => runAutoEditQueue().catch((err) => console.error("[auto-edit] Queue failed", err)));
      return respond({ id: queuedId }, 202);
    } catch (error) {
      await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
      return respond({ message: error instanceof Error ? error.message : "Không thể khởi tạo bản dựng từ tệp local." }, 400);
    }
  }

  return respond({ message: "Hành động không hợp lệ." }, 400);
}

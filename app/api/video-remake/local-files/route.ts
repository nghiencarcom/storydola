import { randomUUID } from "node:crypto";
import path from "node:path";
import { rm } from "node:fs/promises";
import { after, NextResponse } from "next/server";
import { getCurrentUserId } from "../../../lib/auth-server";
import { getCodingAgentCliStatuses } from "../../../lib/coding-agent-cli";
import { getCodingAgentPreference, type CodingAgentPreference } from "../../../lib/coding-agent-preferences";
import { dataPath } from "../../../lib/data-directory";
import {
  isLocalLoopbackRequest,
  openNativeOsFileDialog,
  resolvePastedLocalPaths,
  stageZeroCopyLocalVideoToTarget,
} from "../../../lib/auto-edit-local-files";
import { remakeOptionsSchema } from "../../../lib/video-remake";
import { addLocalRemakeJob, remakeOwnerFolder, runRemakeQueue } from "../../../lib/video-remake-worker";

export const runtime = "nodejs";

function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function configuredAgent(owner: string): Promise<CodingAgentPreference | undefined> {
  const [preference, statuses] = await Promise.all([
    getCodingAgentPreference(owner),
    getCodingAgentCliStatuses({ includeModels: false }),
  ]);
  return preference && statuses.some(({ id, available }) => id === preference.agent && available) ? preference : undefined;
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

  const body = await request.json().catch(() => null);
  const action = body?.action;

  if (action === "pick-video") {
    try {
      const result = await openNativeOsFileDialog(owner, "video", {
        multiple: false,
        promptTitle: "Chọn video trên máy để Remake (không tải lên, không giới hạn dung lượng):",
      });
      return respond({ cancelled: result.cancelled, file: result.files[0] || null });
    } catch (error) {
      return respond({ message: error instanceof Error ? error.message : "Không mở được hộp thoại chọn tệp." }, 400);
    }
  }

  if (action === "resolve-path") {
    const rawPath = typeof body?.path === "string" ? body.path.trim() : "";
    try {
      const files = await resolvePastedLocalPaths(owner, rawPath ? [rawPath] : [], "video");
      return respond({ file: files[0] || null });
    } catch (error) {
      return respond({ message: error instanceof Error ? error.message : "Không đọc được đường dẫn tệp trên máy." }, 400);
    }
  }

  if (action === "create-job") {
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) return respond({ message: "Hãy chọn hoặc gắn một tệp video trên máy trước." }, 400);
    const parsedOptions = remakeOptionsSchema.safeParse(body);
    if (!parsedOptions.success) {
      return respond({ message: "Kiểm tra lại ngôn ngữ, định hướng và transcript." }, 400);
    }
    const agent = await configuredAgent(owner);
    if (!agent) {
      return respond({ message: "Hãy chọn và kết nối Code Agent CLI trong Cài đặt để phân tích khung hình." }, 503);
    }
    const uploadId = randomUUID();
    const targetDir = path.join(dataPath("video-remake"), remakeOwnerFolder(owner), "uploads", uploadId);
    try {
      const staged = await stageZeroCopyLocalVideoToTarget(owner, token, targetDir, "source");
      const jobId = await addLocalRemakeJob(
        owner,
        parsedOptions.data,
        agent,
        { uploadId, filename: staged.filename, extension: staged.extension },
      );
      if (!jobId) {
        await rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
        return respond({ message: "Bạn đang có 5 job remake đang chạy. Hãy đợi một job hoàn tất." }, 409);
      }
      after(() => runRemakeQueue().catch((err) => console.error("[video-remake] Queue failed", err)));
      return respond({ id: jobId }, 202);
    } catch (error) {
      await rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
      return respond({ message: error instanceof Error ? error.message : "Không thể gắn tệp local vào Remake." }, 400);
    }
  }

  return respond({ message: "Hành động không hợp lệ." }, 400);
}

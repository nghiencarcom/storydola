import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "../../lib/auth-server";
import { getCodingAgentPreference } from "../../lib/coding-agent-preferences";
import {
  createVideoAspectSchema,
  createVideoCaptionStyleSchema,
  createVideoOptionsSchema,
  normalizeAgentCreateVideoPlan,
  type CreateVideoAssetImage,
} from "../../lib/motion-video";
import {
  assertSafePublicHttpUrl,
  createVideoJobDir,
  createVideoOwnerFolder,
  maxCreateVideoImages,
  saveUploadedCreateImage,
} from "../../lib/motion-video-ingest";
import { renderMotionVideoMp4 } from "../../lib/motion-video-render";
import {
  approveCreateVideoOutline,
  canEnqueueCreateVideoJob,
  clearCreateVideoRenderPending,
  createQueuedCreateVideoJob,
  getCreateVideoJob,
  isActiveCreateVideoJob,
  listCreateVideoJobs,
  markCreateVideoRenderPending,
  retryCreateVideoJob,
  runCreateVideoQueue,
  tweakCreateVideoWithAgent,
  updateCreateVideoJob,
  updateCreateVideoJobPlan,
} from "../../lib/motion-video-worker";

export const runtime = "nodejs";

function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

const optionsPatchSchema = z.object({
  aspectRatio: createVideoAspectSchema.optional(),
  captionStyle: createVideoCaptionStyleSchema.optional(),
  motionBlur: z.boolean().optional(),
  safeZoneGuard: z.boolean().optional(),
  autoSfx: z.boolean().optional(),
  sfxVolumeDb: z.number().min(-24).max(-4).optional(),
}).optional();

export async function GET(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    const jobs = await listCreateVideoJobs(owner);
    if (jobs.some((j) => j.status === "queued" || j.status === "ingesting_source" || j.status === "planning_outline" || j.status === "scripting_scenes" || j.status === "synthesizing_voice")) {
      after(() => runCreateVideoQueue().catch((err) => console.error("[motion-video] Queue failed", err)));
    }
    return respond({ jobs });
  }

  const job = await getCreateVideoJob(owner, id);
  if (job && isActiveCreateVideoJob(job) && job.status !== "rendering") {
    after(() => runCreateVideoQueue().catch((err) => console.error("[motion-video] Queue failed", err)));
  }
  return job ? respond({ job }) : respond({ message: "Không tìm thấy dự án Motion Video." }, 404);
}

export async function POST(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);

  const contentType = request.headers.get("content-type") || "";
  let rawOptions: unknown = {};
  let pendingImages: Array<{ file: File; label: string }> = [];

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return respond({ message: "Không đọc được biểu mẫu khởi tạo Motion Video." }, 400);
    const optionsStr = form.get("options");
    if (typeof optionsStr === "string" && optionsStr.trim()) {
      try {
        rawOptions = JSON.parse(optionsStr);
      } catch {
        return respond({ message: "Cấu hình khởi tạo Motion Video không hợp lệ." }, 400);
      }
    }
    const uploadedFiles = form.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
    if (uploadedFiles.length > maxCreateVideoImages) {
      return respond({ message: `Tối đa ${maxCreateVideoImages} ảnh minh hoạ mỗi dự án.` }, 400);
    }
    let labels: string[] = [];
    const labelsStr = form.get("imageLabels");
    if (typeof labelsStr === "string" && labelsStr.trim()) {
      try {
        const arr = JSON.parse(labelsStr);
        if (Array.isArray(arr)) labels = arr.map((v) => String(v ?? ""));
      } catch {
        labels = [];
      }
    }
    pendingImages = uploadedFiles.map((file, idx) => ({ file, label: labels[idx] || "" }));
  } else {
    const body = await request.json().catch(() => null);
    rawOptions = body?.options || body || {};
  }

  const parsed = createVideoOptionsSchema.safeParse(rawOptions);
  if (!parsed.success) {
    return respond({ message: "Thông số cấu hình Motion Video không hợp lệ." }, 400);
  }

  const opts = parsed.data;
  if (opts.inputMode === "article_url") {
    if (!opts.sourceUrl) {
      return respond({ message: "Hãy nhập đường dẫn bài viết hoặc trang web (https://...)." }, 400);
    }
    try {
      await assertSafePublicHttpUrl(opts.sourceUrl);
    } catch (err) {
      return respond({ message: err instanceof Error ? err.message : "URL không hợp lệ." }, 400);
    }
  } else if (opts.inputMode === "keyword") {
    if (opts.topicQuery.length < 3) {
      return respond({ message: "Hãy nhập từ khoá hoặc tiêu đề chủ đề (tối thiểu 3 ký tự)." }, 400);
    }
  } else if (opts.rawContent.length < 15) {
    return respond({ message: "Hãy nhập nội dung bài viết hoặc dàn ý kịch bản (tối thiểu 15 ký tự)." }, 400);
  }

  if (!(await canEnqueueCreateVideoJob(owner))) {
    return respond({ message: "Hàng đợi đang đủ 5 dự án đang xử lý. Vui lòng đợi một dự án hoàn tất." }, 409);
  }

  const jobId = randomUUID();
  const jobDir = createVideoJobDir(owner, jobId);
  const imagesDir = path.join(jobDir, "images");
  await mkdir(imagesDir, { recursive: true, mode: 0o700 });

  try {
    const savedImages: CreateVideoAssetImage[] = [];
    for (let i = 0; i < pendingImages.length; i++) {
      const { file, label } = pendingImages[i];
      const bytes = Buffer.from(await file.arrayBuffer());
      const img = await saveUploadedCreateImage(imagesDir, i + 1, file.name, label, bytes);
      savedImages.push(img);
    }

    const pref = await getCodingAgentPreference(owner).catch(() => undefined);
    const queuedId = await createQueuedCreateVideoJob(owner, jobId, opts, savedImages, pref);
    if (!queuedId) {
      await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
      return respond({ message: "Hàng đợi đang đầy. Vui lòng thử lại sau ít phút." }, 409);
    }

    after(() => runCreateVideoQueue().catch((err) => console.error("[motion-video] Queue failed", err)));
    return respond({ id: queuedId }, 202);
  } catch (error) {
    await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
    return respond({ message: error instanceof Error ? error.message : "Không thể khởi tạo Motion Video." }, 400);
  }
}

export async function PATCH(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return respond({ message: "Thiếu mã dự án Motion Video." }, 400);

  if (body.action === "retry") {
    const status = await retryCreateVideoJob(owner, id);
    if (status === "missing") return respond({ message: "Không tìm thấy dự án Motion Video." }, 404);
    if (status === "busy") return respond({ message: "Dự án đang được xử lý." }, 409);
    after(() => runCreateVideoQueue().catch((err) => console.error("[motion-video] Queue failed", err)));
    return respond({ ok: true }, 202);
  }

  if (body.action === "approve-outline") {
    try {
      const outcome = await approveCreateVideoOutline(owner, id, body.outline);
      if (outcome.status === "missing") return respond({ message: "Không tìm thấy dự án Motion Video." }, 404);
      if (outcome.status !== "ok") return respond({ message: "Dàn ý này đã được duyệt hoặc dự án đang xử lý." }, 409);
      after(() => runCreateVideoQueue().catch((err) => console.error("[motion-video] Queue failed", err)));
      return respond({ job: outcome.job }, 202);
    } catch (err) {
      return respond({ message: err instanceof Error ? err.message : "Dàn ý chương không hợp lệ." }, 400);
    }
  }

  if (body.action === "update-plan") {
    const existing = await getCreateVideoJob(owner, id);
    if (!existing) return respond({ message: "Không tìm thấy dự án Motion Video." }, 404);
    if (isActiveCreateVideoJob(existing)) {
      return respond({ message: "Dự án đang xử lý hoặc đang xuất MP4, chưa thể lưu thay đổi lúc này." }, 409);
    }
    const parsedOpts = optionsPatchSchema.safeParse(body.optionsPatch);
    if (!parsedOpts.success) {
      return respond({ message: "Tuỳ chọn khung hình không hợp lệ." }, 400);
    }
    try {
      const normalized = normalizeAgentCreateVideoPlan(
        body.plan,
        { ...existing.options, ...(parsedOpts.data || {}) },
        existing.images,
      );
      const updated = await updateCreateVideoJobPlan(owner, id, normalized, parsedOpts.data);
      return updated ? respond({ job: updated }) : respond({ message: "Không tìm thấy dự án." }, 404);
    } catch (err) {
      return respond({ message: err instanceof Error ? err.message : "Dữ liệu kịch bản không hợp lệ." }, 400);
    }
  }

  if (body.action === "copilot-tweak") {
    const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
    if (!instruction || instruction.length > 1_600) {
      return respond({ message: "Hãy nhập yêu cầu đạo diễn ngắn gọn (tối đa 1.600 ký tự)." }, 400);
    }
    const chapterIndex = typeof body.chapterIndex === "number" && Number.isInteger(body.chapterIndex) && body.chapterIndex >= 0
      ? body.chapterIndex
      : undefined;
    try {
      const updated = await tweakCreateVideoWithAgent(owner, id, instruction, chapterIndex);
      return respond({ job: updated });
    } catch (error) {
      return respond({ message: error instanceof Error ? error.message : "Code Agent chưa thực hiện được chỉnh sửa này." }, 500);
    }
  }

  if (body.action === "render") {
    const job = await getCreateVideoJob(owner, id);
    if (!job || !job.plan) return respond({ message: "Dự án chưa sẵn sàng để xuất MP4." }, 409);
    if (isActiveCreateVideoJob(job)) return respond({ message: "Dự án đang được xử lý hoặc đang kết xuất MP4." }, 409);

    const parsedOpts = optionsPatchSchema.safeParse(body.optionsPatch);
    markCreateVideoRenderPending(id);
    const now = new Date().toISOString();
    const updated = await updateCreateVideoJob(createVideoOwnerFolder(owner), id, (latest) => {
      const mergedOptions = parsedOpts.success && parsedOpts.data
        ? { ...latest.options, ...parsedOpts.data }
        : latest.options;
      return {
        ...latest,
        options: mergedOptions,
        status: "rendering",
        progress: `Đang khởi chạy kết xuất MP4 tỷ lệ ${mergedOptions.aspectRatio} (Three.js + GSAP + HyperFrames)...`,
        render: { ...latest.render, status: "rendering", updatedAt: now },
      };
    });

    if (!updated) {
      clearCreateVideoRenderPending(id);
      return respond({ message: "Không tìm thấy dự án Motion Video." }, 404);
    }

    after(() => {
      void renderMotionVideoMp4(owner, id).catch((err) => {
        clearCreateVideoRenderPending(id);
        console.error("[motion-video] Render failed", err);
      });
    });
    return respond({ ok: true }, 202);
  }

  return respond({ message: "Hành động không được hỗ trợ." }, 400);
}

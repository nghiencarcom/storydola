import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "../../lib/auth-server";
import {
  autoEditAspectSchema,
  autoEditOptionsSchema,
  autoEditVerticalFitSchema,
  sanitizeHyperframesMarkup,
  type AutoEditEdl,
} from "../../lib/auto-edit";
import { downloadUrlForAutoEdit } from "../../lib/auto-edit-media";
import { renderAutoEditMp4 } from "../../lib/auto-edit-render";
import { autoEditJobMediaDir, autoEditOwnerFolder } from "../../lib/auto-edit-upload";
import {
  createQueuedAutoEditJob,
  getAutoEditJob,
  listAutoEditJobs,
  retryAutoEditJob,
  runAutoEditQueue,
  saveAutoEditJobState,
  tweakAutoEditJobWithAgent,
  updateAutoEditJobEdl,
} from "../../lib/auto-edit-worker";

export const runtime = "nodejs";

function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

const edlPatchSchema = z.object({
  schema: z.literal("auto-edit-edl.v1"),
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().max(1_500),
  hookHeadline: z.string().trim().min(1).max(100),
  hookSubtext: z.string().trim().max(140).optional(),
  hookEmoji: z.string().trim().max(16).optional(),
  captionStyle: z.enum(["karaoke-pop", "clean-pill", "minimal-line"]),
  segments: z.array(z.object({
    id: z.string().trim().min(1).max(64),
    clipId: z.string().trim().min(1).max(64),
    sourceStartMs: z.number().min(0),
    sourceEndMs: z.number().min(1),
    keep: z.boolean(),
    cutReason: z.enum(["silence", "hesitation", "retake", "dead_air", "off_topic", "manual"]).optional(),
    zoom: z.number().min(1).max(1.35),
    zoomFocusY: z.number().min(0.15).max(0.85),
    transcriptText: z.string().max(800),
    note: z.string().max(300).optional(),
  })).min(1).max(1_200),
  overlays: z.array(z.object({
    id: z.string().trim().min(1).max(64),
    kind: z.enum(["hook_banner", "product_card", "callout_pill", "emoji_burst"]),
    anchorSegmentId: z.string().trim().max(64).optional(),
    offsetMs: z.number().min(0).max(600_000),
    durationMs: z.number().min(500).max(25_000),
    imageId: z.string().trim().max(64).optional(),
    layout: z.enum(["floating-right", "floating-left", "split-top", "center-pop"]),
    badge: z.string().trim().max(60).optional(),
    title: z.string().trim().max(120),
    subtitle: z.string().trim().max(180).optional(),
    priceTag: z.string().trim().max(48).optional(),
    emoji: z.string().trim().max(16).optional(),
    accentColor: z.enum(["amber", "emerald", "rose", "cyan"]).optional(),
    sfxId: z.string().trim().max(80).optional(),
    sfxVolumeDb: z.number().min(-32).max(-6).optional(),
    hyperframesHtml: z.string().max(4_000).optional(),
    hyperframesCss: z.string().max(4_000).optional(),
  })).max(80),
  sfxCues: z.array(z.object({
    id: z.string().trim().min(1).max(64),
    sfxId: z.string().trim().min(1).max(80),
    anchorSegmentId: z.string().trim().max(64).optional(),
    offsetMs: z.number().min(0).max(600_000),
    volumeDb: z.number().min(-32).max(-6).optional(),
    note: z.string().max(200).optional(),
  })).max(80).optional(),
  keywordHighlights: z.array(z.object({
    word: z.string().trim().min(1).max(48),
    color: z.enum(["amber", "emerald", "rose", "cyan"]),
    emoji: z.string().trim().max(16).optional(),
  })).max(50),
  directorNotes: z.array(z.string().max(350)).max(20),
});

const optionsPatchSchema = z.object({
  aspectRatio: autoEditAspectSchema.optional(),
  verticalFit: autoEditVerticalFitSchema.optional(),
  safeZoneGuard: z.boolean().optional(),
  voiceTargetPeakDb: z.number().min(-3).max(-0.3).optional(),
  autoSfx: z.boolean().optional(),
  sfxVolumeDb: z.number().min(-26).max(-4).optional(),
}).optional();

export async function GET(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return respond({ jobs: await listAutoEditJobs(owner) });
  }
  const job = await getAutoEditJob(owner, id);
  return job ? respond({ job }) : respond({ message: "Không tìm thấy bản dựng Auto Edit." }, 404);
}

export async function POST(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);

  const body = await request.json().catch(() => null);
  const parsed = autoEditOptionsSchema.safeParse(body?.options || body || {});
  if (!parsed.success || !parsed.data.sourceUrl) {
    return respond({ message: "Hãy nhập link video công khai (YouTube, TikTok, Facebook...)." }, 400);
  }

  const jobId = randomUUID();
  const jobDir = autoEditJobMediaDir(owner, jobId);
  const videosDir = path.join(jobDir, "videos");
  await mkdir(videosDir, { recursive: true, mode: 0o700 });
  await mkdir(path.join(jobDir, "images"), { recursive: true, mode: 0o700 });

  try {
    const { video } = await downloadUrlForAutoEdit(parsed.data.sourceUrl, videosDir, parsed.data.language);
    const queuedId = await createQueuedAutoEditJob(owner, jobId, parsed.data, [video], []);
    if (!queuedId) {
      return respond({ message: "Hàng đợi đang đủ 5 job đang xử lý. Vui lòng đợi một job hoàn tất." }, 409);
    }
    after(() => runAutoEditQueue().catch((err) => console.error("[auto-edit] Queue failed", err)));
    return respond({ id: queuedId }, 202);
  } catch (error) {
    return respond({ message: error instanceof Error ? error.message : "Không thể tải video từ link này." }, 400);
  }
}

export async function PATCH(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return respond({ message: "Thiếu mã job Auto Edit." }, 400);

  if (body.action === "retry") {
    const status = await retryAutoEditJob(owner, id);
    if (status === "missing") return respond({ message: "Không tìm thấy job Auto Edit." }, 404);
    if (status === "busy") return respond({ message: "Job đang được xử lý." }, 409);
    after(() => runAutoEditQueue().catch((err) => console.error("[auto-edit] Queue failed", err)));
    return respond({ ok: true }, 202);
  }

  if (body.action === "update-edl") {
    const parsed = edlPatchSchema.safeParse(body.edl);
    const parsedOpts = optionsPatchSchema.safeParse(body.optionsPatch);
    if (!parsed.success || !parsedOpts.success) {
      return respond({ message: "Dữ liệu timeline hoặc tuỳ chọn khung hình không hợp lệ." }, 400);
    }
    const cleanEdl: AutoEditEdl = {
      ...parsed.data,
      overlays: parsed.data.overlays.map((ov) => {
        const sanitized = sanitizeHyperframesMarkup(ov.hyperframesHtml, ov.hyperframesCss);
        return { ...ov, hyperframesHtml: sanitized.html, hyperframesCss: sanitized.css };
      }),
    };
    const updated = await updateAutoEditJobEdl(owner, id, cleanEdl, parsedOpts.data);
    if (!updated) return respond({ message: "Không tìm thấy job Auto Edit." }, 404);
    return respond({ job: updated });
  }

  if (body.action === "copilot-tweak") {
    const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
    if (!instruction || instruction.length > 1_500) {
      return respond({ message: "Nhập yêu cầu chỉnh sửa ngắn gọn (tối đa 1.500 ký tự)." }, 400);
    }
    try {
      const updated = await tweakAutoEditJobWithAgent(owner, id, instruction);
      return respond({ job: updated });
    } catch (error) {
      return respond({ message: error instanceof Error ? error.message : "Code Agent chưa thực hiện được chỉnh sửa này." }, 500);
    }
  }

  if (body.action === "render") {
    const job = await getAutoEditJob(owner, id);
    if (!job || !job.edl) return respond({ message: "Bản dựng chưa sẵn sàng để xuất MP4." }, 409);
    if (job.status === "rendering") return respond({ message: "Đang xuất MP4 cho bản dựng này." }, 409);

    const parsedOpts = optionsPatchSchema.safeParse(body.optionsPatch);
    const mergedOptions = parsedOpts.success && parsedOpts.data
      ? { ...job.options, ...parsedOpts.data }
      : job.options;

    await saveAutoEditJobState(autoEditOwnerFolder(owner), {
      ...job,
      options: mergedOptions,
      status: "rendering",
      progress: `Đang khởi chạy tiến trình xuất MP4 tỷ lệ ${mergedOptions.aspectRatio} (FFmpeg + HyperFrames)...`,
      render: { status: "rendering", updatedAt: new Date().toISOString() },
    });

    after(() => {
      void renderAutoEditMp4(owner, id).catch((err) => console.error("[auto-edit] Render failed", err));
    });
    return respond({ ok: true }, 202);
  }

  return respond({ message: "Tác vụ Auto Edit không hợp lệ." }, 400);
}

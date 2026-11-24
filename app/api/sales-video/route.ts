import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { after, NextResponse } from "next/server";
import sharp from "sharp";
import type { VideoGenerationModelOption } from "../../lib/project-types";
import { getMaiVideoModelCatalog } from "../../lib/media-provider";
import { getMaiVideoApiKey } from "../../lib/maivideo-api-keys";
import { getCodingAgentPreference } from "../../lib/coding-agent-preferences";
import { getCodingAgentCliStatuses, type CodingAgent } from "../../lib/coding-agent-cli";
import { readMaiVideoAuthCookie } from "../../lib/maivideo-auth-shared";
import { getSeedanceApiKey, getSeedanceApiSessionToken } from "../../lib/seedance-accounts";
import { createCreativeSalesVideo, ensureSalesVideoSegmentFile, SalesVideoInputError, SalesVideoSegmentError } from "../../lib/sales-video-creative";
import { deleteSalesVideoProject, listSalesVideoProjects, salesVideoSegmentPath, saveSalesVideoProject, type SalesVideoProject } from "../../lib/sales-video-storage";
import { enqueueSalesVideoTask, salesVideoWorkerId } from "../../lib/sales-video-runtime";
import { isVideoOffPeakRequired } from "../../lib/media-generation-settings";
import { stat } from "node:fs/promises";
import {
  salesVideoDurationOptions, salesVideoProductSegments, salesVideoImageLimit, salesVideoLanguages, salesVideoNameLimit,
  salesVideoRatios, salesVideoTemplates, salesVideoCreativeTemplates, salesVideoFileLimits, salesVideoModelOptions, salesVideoMaiVideoModels, salesVideoGatewayVideoModels, salesVideoModels, salesVideoProductInstruction, salesVideoSupportsDialogue, salesVideoWordCount, salesVideoMaxWordCount, salesVideoMaxProductImages,
  salesVideoDialogueToSrt, salesVideoSplitDialogue,
} from "../../lib/sales-video-templates";

export const runtime = "nodejs";

const run = promisify(execFile);
const worker = salesVideoWorkerId;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const userId = request.headers.get("x-storyai-user-id")?.trim();
  if (!userId) return NextResponse.json({ message: "Vui lòng đăng nhập MaiVideo." }, { status: 401 });
  const providerAuthToken = readMaiVideoAuthCookie(request.headers.get("cookie"));
  const [projects, maiVideoKey, preference, agentStatuses] = await Promise.all([
    listSalesVideoProjects(userId, worker),
    getMaiVideoApiKey(userId).catch(() => ""),
    getCodingAgentPreference(userId).catch(() => undefined),
    getCodingAgentCliStatuses({ includeModels: false }).catch(() => []),
  ]);
  const seedanceApiKey = await getSeedanceApiKey(undefined, userId).catch(() => "");
  const seedanceSessionToken = await getSeedanceApiSessionToken(undefined, userId, providerAuthToken).catch(() => "");
  const agentOrder: CodingAgent[] = ["codex", "claude", "antigravity"];
  const installed = agentStatuses.filter((agent) => agent.available);
  const environmentAgent = process.env.STORYAI_SALES_UGC_AGENT?.trim();
  const preferredId = preference?.agent || (environmentAgent && agentOrder.includes(environmentAgent as CodingAgent) ? environmentAgent : "") || installed[0]?.id;
  const preferredAgent = installed.find((agent) => agent.id === preferredId);
  return NextResponse.json({
    projects,
    access: {
      maiVideo: Boolean(maiVideoKey),
      seedanceGateway: Boolean(seedanceApiKey && seedanceSessionToken),
      pixverse: Boolean(process.env.PIXVERSE_API_KEY?.trim()),
      voice: Boolean(process.env.FAL_KEY?.trim()),
      draftKey: createHash("sha256").update(userId).digest("hex").slice(0, 24),
      codingAgent: preferredAgent ? { id: preferredAgent.id, label: preferredAgent.label, model: preference?.model || "", saved: Boolean(preference) } : null,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const userId = request.headers.get("x-storyai-user-id")?.trim();
  if (!userId) return NextResponse.json({ message: "Vui lòng đăng nhập MaiVideo." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const requestedIds = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).ids
    : undefined;
  if (!Array.isArray(requestedIds) || !requestedIds.length || requestedIds.length > 100
    || requestedIds.some((id) => typeof id !== "string" || !uuid.test(id))) {
    return NextResponse.json({ message: "Danh sách dự án cần xóa không hợp lệ." }, { status: 400 });
  }

  const ids = [...new Set(requestedIds as string[])];
  const projects = await listSalesVideoProjects(userId, worker);
  const projectsById = new Map(projects.map((project) => [project.id, project] as const));
  const missingIds = ids.filter((id) => !projectsById.has(id));
  if (missingIds.length) return NextResponse.json({ message: "Một hoặc nhiều dự án không còn tồn tại." }, { status: 404 });

  const busyIds = ids.filter((id) => projectsById.get(id)?.status === "processing");
  if (busyIds.length) {
    return NextResponse.json({ message: "Không thể xóa dự án đang xử lý. Hãy chờ job hoàn tất rồi thử lại.", busyIds }, { status: 409 });
  }

  const results = await Promise.all(ids.map(async (id) => {
    try {
      await deleteSalesVideoProject(userId, id);
      return { id, ok: true as const };
    } catch {
      return { id, ok: false as const };
    }
  }));
  const deleted = results.filter((result) => result.ok).map((result) => result.id);
  const failed = results.filter((result) => !result.ok).map((result) => result.id);
  return NextResponse.json({ ok: failed.length === 0, deleted, failed });
}

async function referenceImage(entry: FormDataEntryValue | null) {
  if (!(entry instanceof File) || !entry.size || entry.size > salesVideoImageLimit) {
    throw new Error("Mỗi ảnh phải có dung lượng tối đa 50 MB.");
  }
  try {
    const image = sharp(Buffer.from(await entry.arrayBuffer()), { limitInputPixels: 40_000_000 });
    const { format } = await image.metadata();
    if (!format || !["jpeg", "png", "webp", "avif", "heif"].includes(format)) throw new Error("Unsupported image");
    const bytes = await image.rotate().resize(1920, 1920, { fit: "inside", withoutEnlargement: true }).webp().toBuffer();
    return `data:image/webp;base64,${bytes.toString("base64")}`;
  } catch {
    throw new Error("Ảnh phải là tệp JPG, PNG, WebP hoặc AVIF có thể đọc được.");
  }
}

export async function POST(request: Request) {
  const userId = request.headers.get("x-storyai-user-id")?.trim();
  const token = readMaiVideoAuthCookie(request.headers.get("cookie"));
  if (!userId || !token) return NextResponse.json({ message: "Vui lòng đăng nhập MaiVideo." }, { status: 401 });

  if (Number(request.headers.get("content-length")) > 101 * 1024 * 1024) {
    return NextResponse.json({ message: "Tổng dung lượng tệp vượt giới hạn 100 MB." }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ message: "Không đọc được biểu mẫu." }, { status: 400 });

  const value = (field: string) => {
    const result = form.get(field);
    return typeof result === "string" ? result.trim() : "";
  };
  const creative = salesVideoCreativeTemplates.find(({ id }) => id === value("template"));
  const productTemplate = salesVideoTemplates.find(({ id }) => id === value("template"));
  const ratio = salesVideoRatios.find((item) => item === value("ratio"));
  const durationValue = Number(value("duration"));
  const product = value("product");
  const facts = value("productFacts");
  const language = salesVideoLanguages.find((item) => item === value("language"));
  const text = value("prompt");
  const script = value("script");
  let scriptForVideo = script;
  const title = value("title");
  const requestedProjectId = value("projectId");
  const rawRetrySegmentIndex = value("retrySegmentIndex");
  const retrySegmentIndex = rawRetrySegmentIndex ? Number(rawRetrySegmentIndex) : undefined;
  const rawPromptSegments = value("promptSegments");
  const rawScriptSegments = value("scriptSegments");
  let submittedPromptSegments: Array<{ start: number; duration: number; prompt: string }> | undefined;
  let submittedScriptSegments: Array<{ start: number; duration: number; script: string }> | undefined;
  if (rawPromptSegments) {
    try {
      const parsed = JSON.parse(rawPromptSegments) as unknown;
      if (!Array.isArray(parsed) || parsed.length > 6 || parsed.some((item) => !item || typeof item !== "object"
        || !Number.isInteger((item as Record<string, unknown>).start) || !Number.isInteger((item as Record<string, unknown>).duration)
        || typeof (item as Record<string, unknown>).prompt !== "string"
        || ((item as Record<string, unknown>).prompt as string).trim().length === 0
        || ((item as Record<string, unknown>).prompt as string).length > 20_000)) throw new Error();
      submittedPromptSegments = parsed as Array<{ start: number; duration: number; prompt: string }>;
    } catch {
      return NextResponse.json({ message: "Prompt clip không hợp lệ. Hãy kiểm tra lại từng phần 15 giây." }, { status: 400 });
    }
  }
  if (rawScriptSegments) {
    try {
      const parsed = JSON.parse(rawScriptSegments) as unknown;
      if (!Array.isArray(parsed) || parsed.length > 6 || parsed.some((item) => !item || typeof item !== "object"
        || !Number.isInteger((item as Record<string, unknown>).start) || !Number.isInteger((item as Record<string, unknown>).duration)
        || typeof (item as Record<string, unknown>).script !== "string"
        || ((item as Record<string, unknown>).script as string).length > 2000)) throw new Error();
      submittedScriptSegments = parsed as Array<{ start: number; duration: number; script: string }>;
    } catch {
      return NextResponse.json({ message: "Lời thoại theo từng clip không hợp lệ." }, { status: 400 });
    }
  }
  if ((!creative && !productTemplate) || !ratio || title.length > 120 || facts.length > 1000 || (!productTemplate && text.length > salesVideoNameLimit) || script.length > 2000
    || (requestedProjectId && !uuid.test(requestedProjectId))
    || (rawRetrySegmentIndex && (!Number.isInteger(retrySegmentIndex) || retrySegmentIndex! < 0 || retrySegmentIndex! > 5))
    || (productTemplate && (!product || product.length > salesVideoNameLimit || !language))
    || (creative?.text && (text.length > salesVideoNameLimit || (!text && !creative.defaultText)))) {
    return NextResponse.json({ message: "Kiểm tra tiêu đề, nội dung và các tùy chọn của mẫu." }, { status: 400 });
  }
  const pendingDraft = requestedProjectId && value("autoUgc") === "1"
    ? (await listSalesVideoProjects(userId, worker)).find((project) => project.id === requestedProjectId && (retrySegmentIndex === undefined
      ? project.status === "processing" && project.phase === "generating"
      : (project.status === "ready" || project.status === "failed") && project.details?.segmentResults?.[retrySegmentIndex]?.status === "processing"))
    : undefined;
  if (requestedProjectId && !pendingDraft) return NextResponse.json({ message: "Job UGC không còn ở trạng thái chờ tạo video." }, { status: 409 });
  const sourceStart = creative?.workflow === "remake" ? Number(value("sourceStart")) : 0;
  if (!Number.isFinite(sourceStart) || sourceStart < 0 || sourceStart > 3600) {
    return NextResponse.json({ message: "Mốc bắt đầu phải từ 0 đến 3600 giây." }, { status: 400 });
  }

  const models = salesVideoModelOptions(creative);
  const requestedModel = value("model") || models[0] || "";
  let maiVideoModel: VideoGenerationModelOption | undefined;
  let gatewayVideoModel: VideoGenerationModelOption | undefined;
  if (requestedModel.startsWith("maivideo:")) {
    const pixverseReferenceWorkflow = creative?.workflow === "remake" || creative?.workflow === "background";
    if (!pixverseReferenceWorkflow && !await getMaiVideoApiKey(userId).catch(() => "")) {
      return NextResponse.json({ message: "Thêm khóa MaiVideo trong Cài đặt để dùng model này." }, { status: 503 });
    }
    const catalog = await getMaiVideoModelCatalog(userId);
    maiVideoModel = salesVideoMaiVideoModels(catalog.videoModels, creative, ratio).find(({ id }) => `maivideo:${id}` === requestedModel);
  }
  if (requestedModel.startsWith("flow:") || requestedModel.startsWith("muse:")) {
    const [provider, modelId] = requestedModel.split(":", 2);
    const apiKey = await getSeedanceApiKey(undefined, userId).catch(() => "");
    const sessionToken = await getSeedanceApiSessionToken(undefined, userId, token).catch(() => "");
    if (!apiKey || !sessionToken) return NextResponse.json({ message: "Cấu hình tài khoản Flow/Muse trong Cài đặt để dùng model này." }, { status: 503 });
    const catalog = await getMaiVideoModelCatalog(userId).catch(() => null);
    gatewayVideoModel = catalog
      ? salesVideoGatewayVideoModels(catalog.videoModels, creative, ratio, Boolean(productTemplate))
        .find((item) => item.provider === provider && item.id === modelId)
      : undefined;
  }
  const model = maiVideoModel || gatewayVideoModel ? "higgsfield" : models.find((item) => item === requestedModel);
  if (!model) return NextResponse.json({ message: "Model không hỗ trợ đầu vào hoặc khung hình của mẫu này." }, { status: 400 });
  const selectedVideoModel = maiVideoModel || gatewayVideoModel;
  const higgsfieldSpeed = !selectedVideoModel && model === "higgsfield" ? "fast" as const : undefined;
  const fixedPixverseQuality = !maiVideoModel && model !== "higgsfield" ? "720p" : "";
  const videoQuality = higgsfieldSpeed ? "720p" : fixedPixverseQuality || (selectedVideoModel?.qualities.includes("720p") ? "720p" : selectedVideoModel?.qualities[0] || "");
  const videoOffPeak = Boolean(maiVideoModel && isVideoOffPeakRequired(maiVideoModel.id, maiVideoModel.label));
  const durationOptions = salesVideoDurationOptions(selectedVideoModel, creative, Boolean(productTemplate), selectedVideoModel?.id || requestedModel, videoQuality);
  const seconds = durationOptions.find((item) => item === durationValue);
  if (!seconds) {
    const maxDuration = selectedVideoModel?.id === "wan-3.0" ? 30 : Math.min(15, selectedVideoModel?.maxDurationSec || 15);
    return NextResponse.json({ message: `Thời lượng video không hợp lệ với model đã chọn (tối đa ${maxDuration} giây).` }, { status: 400 });
  }
  const speaksInVideo = salesVideoSupportsDialogue(selectedVideoModel);
  if (productTemplate && script && speaksInVideo) {
    const wordCount = salesVideoWordCount(script, language!);
    const maxWords = salesVideoMaxWordCount(seconds, language!);
    if (maxWords !== null && wordCount > maxWords) {
      return NextResponse.json({ message: `Lời thoại có ${wordCount} từ, vượt giới hạn ${maxWords} từ cho video ${seconds} giây. Hãy rút gọn lời thoại.` }, { status: 400 });
    }
  }
  const pixverseKey = process.env.PIXVERSE_API_KEY?.trim();
  const voiceKey = process.env.FAL_KEY?.trim();
  if (model !== "higgsfield" && !pixverseKey) {
    return NextResponse.json({ message: "Model này cần khóa PixVerse Platform riêng để xử lý video hoặc âm thanh tham chiếu." }, { status: 503 });
  }
  if (creative?.workflow === "narration" && !voiceKey) {
    return NextResponse.json({ message: "Máy chủ cần FAL_KEY để tổng hợp giọng mẫu." }, { status: 503 });
  }

  const fields = creative?.files ?? [
    { name: "presenter", kind: "image", label: "Ảnh nhân vật" },
    { name: "image", kind: "image", label: "Ảnh sản phẩm" },
  ] as const;
  const productImageEntries = form.has("primaryProductImage") || form.has("additionalProductImage")
    ? [form.get("primaryProductImage"), ...form.getAll("additionalProductImage")]
    : form.getAll("image");
  const files = productTemplate
    ? [
      { name: "presenter", kind: "image" as const, label: "Ảnh nhân vật", file: form.get("presenter") },
      ...productImageEntries.map((file, index) => ({ name: `image-${index + 1}`, kind: "image" as const, label: `Ảnh sản phẩm ${index + 1}`, file })),
    ]
    : 
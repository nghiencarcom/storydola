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
import { deleteSalesVideoProject, getSalesVideoProject, listSalesVideoProjects, salesVideoSegmentPath, salesVideoWatermarkLogoPath, saveSalesVideoProject as persistSalesVideoProject, type SalesVideoProject } from "../../lib/sales-video-storage";
import { enqueueSalesVideoTask, salesVideoWorkerId } from "../../lib/sales-video-runtime";
import { HIGGSFIELD_SEEDANCE_MODEL_ID, isVideoOffPeakRequired } from "../../lib/media-generation-settings";
import { stat } from "node:fs/promises";
import {
  salesVideoDurationOptions, salesVideoProductSegments, salesVideoImageLimit, salesVideoLanguages, salesVideoNameLimit,
  salesVideoRatios, salesVideoTemplates, salesVideoCreativeTemplates, salesVideoFileLimits, salesVideoModelOptions, salesVideoMaiVideoModels, salesVideoGatewayVideoModels, salesVideoModels, salesVideoProductInstruction, salesVideoSupportsDialogue, salesVideoWordCount, salesVideoMaxWordCount, salesVideoMaxProductImages,
  salesVideoDialogueToSrt, salesVideoSplitDialogue,
} from "../../lib/sales-video-templates";

const saveSalesVideoProject = persistSalesVideoProject;

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

  const busyIds = ids.filter((id) => projectsById.get(id)?.status === "processing"
    || projectsById.get(id)?.details?.voiceRegeneration?.status === "processing");
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

const verifiedFfmpegPaths = new Set<string>();

async function ensureFfmpegAvailable() {
  const ffmpegPath = process.env.STORYAI_FFMPEG_PATH || process.env.VIBE_FFMPEG_PATH || "ffmpeg";
  if (verifiedFfmpegPaths.has(ffmpegPath)) return;
  await run(ffmpegPath, ["-version"], { timeout: 5000 });
  verifiedFfmpegPaths.add(ffmpegPath);
}

async function referenceImage(entry: FormDataEntryValue | null) {
  if (!(entry instanceof File) || !entry.size || entry.size > salesVideoImageLimit) {
    throw new Error("Mỗi ảnh phải có dung lượng tối đa 50 MB.");
  }
  try {
    const raw = Buffer.from(await entry.arrayBuffer());
    const image = sharp(raw, { limitInputPixels: 40_000_000 });
    const { format, width, height, orientation } = await image.metadata();
    if (!format || !["jpeg", "png", "webp", "avif", "heif"].includes(format)) throw new Error("Unsupported image");
    if (format === "webp" && width && height && width <= 1920 && height <= 1920 && (!orientation || orientation === 1)) {
      return `data:image/webp;base64,${raw.toString("base64")}`;
    }
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
  const saveSalesVideoProject = (owner: string, value: SalesVideoProject) => persistSalesVideoProject(owner, value, retrySegmentIndex);
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
  const pendingDraftCandidate = requestedProjectId && value("autoUgc") === "1"
    ? await getSalesVideoProject(userId, requestedProjectId, worker)
    : undefined;
  const pendingDraft = pendingDraftCandidate && (retrySegmentIndex === undefined
    ? pendingDraftCandidate.status === "processing" && pendingDraftCandidate.phase === "generating"
    : (pendingDraftCandidate.status === "ready" || pendingDraftCandidate.status === "failed") && pendingDraftCandidate.details?.segmentResults?.[retrySegmentIndex]?.status === "processing")
    ? pendingDraftCandidate
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
  let higgsfieldVideoModel: VideoGenerationModelOption | undefined;
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
  if (requestedModel.startsWith("higgsfield:")) {
    const modelId = requestedModel.slice("higgsfield:".length);
    if (modelId !== HIGGSFIELD_SEEDANCE_MODEL_ID) {
      return NextResponse.json({ message: "Model Higgsfield Seedance 2.0 không được hỗ trợ." }, { status: 400 });
    }
    const catalog = await getMaiVideoModelCatalog(userId).catch(() => null);
    higgsfieldVideoModel = catalog?.videoModels.find((item) => item.provider === "higgsfield" && item.id === modelId);
    if (!higgsfieldVideoModel) return NextResponse.json({ message: "Không lấy được cấu hình Seedance 2.0 · Higgsfield." }, { status: 503 });
  }
  const model = maiVideoModel || gatewayVideoModel || higgsfieldVideoModel ? "higgsfield" : models.find((item) => item === requestedModel);
  if (!model) return NextResponse.json({ message: "Model không hỗ trợ đầu vào hoặc khung hình của mẫu này." }, { status: 400 });
  const selectedVideoModel = maiVideoModel || gatewayVideoModel || higgsfieldVideoModel;
  const higgsfieldSpeed = higgsfieldVideoModel || (!selectedVideoModel && model === "higgsfield") ? "fast" as const : undefined;
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
    : fields.map((field) => ({ ...field, file: form.get(field.name) }));
  if (productTemplate && files.length < 2) {
    return NextResponse.json({ message: "Cần ít nhất một ảnh sản phẩm cùng ảnh nhân vật." }, { status: 400 });
  }
  for (const { file, kind, label } of files) {
    if (!(file instanceof File) || !file.size || file.size > salesVideoFileLimits[kind]) {
      return NextResponse.json({ message: `${label} là tệp bắt buộc, tối đa ${salesVideoFileLimits[kind] / 1024 ** 2} MB.` }, { status: 400 });
    }
  }
  if (productTemplate && files.filter(({ name, file }) => name.startsWith("image-") && file instanceof File && file.size > 0).length > salesVideoMaxProductImages) {
    return NextResponse.json({ message: `Tải tối đa ${salesVideoMaxProductImages} ảnh sản phẩm cho một video.` }, { status: 400 });
  }
  if (files.reduce((total, { file }) => total + (file instanceof File ? file.size : 0), 0) > 100 * 1024 * 1024) {
    return NextResponse.json({ message: "Tổng dung lượng tệp vượt giới hạn 100 MB." }, { status: 413 });
  }
  const productImageCount = productTemplate ? files.length - 1 : 0;
  if (productTemplate && productImageCount < 1) {
    return NextResponse.json({ message: "Cần ít nhất một ảnh sản phẩm cùng ảnh nhân vật." }, { status: 400 });
  }
  const maxReferenceImages = selectedVideoModel?.maxReferenceImages || (model === "higgsfield" ? 9 : 7);
  if (productTemplate && productImageCount + 1 > maxReferenceImages) {
    return NextResponse.json({ message: `Model nhận tối đa ${maxReferenceImages} ảnh tham chiếu, gồm ảnh nhân vật. Hãy giảm ảnh sản phẩm.` }, { status: 400 });
  }
  let images: string[];
  try {
    images = await Promise.all(files.filter(({ kind }) => kind === "image").map(({ file }) => referenceImage(file)));
  } catch (error) {
    return NextResponse.json({ message: (error as Error).message }, { status: 400 });
  }
  try {
    await ensureFfmpegAvailable();
  } catch {
    return NextResponse.json({ message: "Máy chủ cần FFmpeg để xuất video." }, { status: 503 });
  }

  const template = creative ?? {
    ...productTemplate!,
    files: [],
    workflow: "prompt" as const,
    instruction: salesVideoProductInstruction,
  };
  const productSegments = productTemplate ? salesVideoProductSegments(seconds, selectedVideoModel, videoQuality) : undefined;
  const promptMaxLength = productTemplate ? Math.min(20_000, selectedVideoModel?.promptMaxLength || (model === "higgsfield" ? 10_000 : 5_000)) : undefined;
  let effectiveScriptSegments = submittedScriptSegments;
  if (productTemplate) {
    if (!productSegments || !submittedPromptSegments || submittedPromptSegments.length !== productSegments.length) {
      return NextResponse.json({ message: "Số prompt phải trùng với số clip video đã chia." }, { status: 400 });
    }
    if (submittedPromptSegments.some((segment) => segment.prompt.length > (promptMaxLength || 5_000))) {
      return NextResponse.json({ message: `Mỗi prompt tối đa ${(promptMaxLength || 5_000).toLocaleString("vi-VN")} ký tự theo giới hạn của model đã chọn.` }, { status: 400 });
    }
    let offset = 0;
    const validTimeline = submittedPromptSegments.every((segment, index) => {
      const valid = segment.start === offset && segment.duration === productSegments[index] && segment.duration <= 15;
      offset += segment.duration;
      return valid;
    });
    if (!validTimeline || offset !== seconds) return NextResponse.json({ message: "Các prompt phải chia đúng thời lượng thành từng clip tối đa 15 giây." }, { status: 400 });
    if (speaksInVideo) {
      if (!submittedScriptSegments || submittedScriptSegments.length !== productSegments.length) {
        return NextResponse.json({ message: "Hãy chia lời thoại theo từng clip 15 giây trước khi tạo video." }, { status: 400 });
      }
      let scriptOffset = 0;
      const validScripts = submittedScriptSegments.every((segment, index) => {
        const maxWords = salesVideoMaxWordCount(segment.duration, language!);
        const valid = segment.start === scriptOffset && segment.duration === productSegments[index] && segment.duration <= 15
          && (maxWords === null || salesVideoWordCount(segment.script, language!) <= maxWords);
        scriptOffset += segment.duration;
        return valid;
      });
      if (!validScripts || scriptOffset !== seconds) return NextResponse.json({ message: "Kiểm tra mốc thời gian và giới hạn từ trên từng clip lời thoại." }, { status: 400 });
    } else {
      effectiveScriptSegments = productSegments.map((duration, index) => ({
        start: productSegments.slice(0, index).reduce((sum, item) => sum + item, 0), duration, script: "",
      }));
    }
    scriptForVideo = effectiveScriptSegments?.map((segment) => segment.script).filter(Boolean).join("\n") || "";
  }
  const isStitched = Boolean(productSegments && productSegments.length > 1);
  const prompt = creative
    ? creative.text ? text || creative.defaultText || "" : ""
    : submittedPromptSegments![0].prompt;
  const initialSegmentResults = submittedPromptSegments?.map((segment, index) => {
    const saved = pendingDraft?.details?.segmentResults?.[index];
    if (retrySegmentIndex === index) return { start: segment.start, duration: segment.duration, status: "processing" as const, modelId: requestedModel };
    return saved || { start: segment.start, duration: segment.duration, status: "pending" as const };
  });
  const project: SalesVideoProject = {
    ...(pendingDraft || {}),
    id: requestedProjectId || randomUUID(), title: title || product.slice(0, 120) || template.name,
    template: template.name, model: [selectedVideoModel?.label || salesVideoModels[model], videoQuality, higgsfieldSpeed ? "Fast" : "", videoOffPeak ? "off-peak" : ""].filter(Boolean).join(" · "), createdAt: pendingDraft?.createdAt || new Date().toISOString(), status: "processing", phase: "generating", worker,
    details: pendingDraft?.details ? {
      ...pendingDraft.details,
      product, facts, prompt, ...(submittedPromptSegments ? { promptSegments: submittedPromptSegments } : {}), script: scriptForVideo, language, duration: seconds, ratio,
      ...(effectiveScriptSegments ? { scriptSegments: effectiveScriptSegments, subtitleSrt: speaksInVideo ? salesVideoDialogueToSrt(effectiveScriptSegments, language!) : "" } : {}),
      ...(promptMaxLength ? { promptMaxLength } : {}),
      videoModelId: requestedModel,
      ...(initialSegmentResults ? { segmentResults: initialSegmentResults, needsStitching: true } : {}),
      references: {
        presenter: `/api/sales-video/${requestedProjectId}/references/presenter`,
        product: `/api/sales-video/${requestedProjectId}/references/product`,
        products: Array.from({ length: images.length - 1 }, (_, index) => `/api/sales-video/${requestedProjectId}/references/${index === 0 ? "product" : `product-${index + 1}`}`),
      },
      productImageCount: Math.max(1, images.length - 1),
    } : pendingDraft?.details,
  };
  await saveSalesVideoProject(userId, project);
  after(async () => {
    await enqueueSalesVideoTask(async () => {
      try {
        const generatedSegments = await createCreativeSalesVideo({
          id: project.id, userId, template, images, seconds, ratio, prompt, promptSegments: submittedPromptSegments, videoQuality, videoOffPeak,
          postProcessing: pendingDraft?.postProcessing,
          postProcessingLogoPath: pendingDraft?.postProcessing?.logo?.enabled ? salesVideoWatermarkLogoPath(userId, project.id) : undefined,
          splitDialogue: isStitched ? { script: scriptForVideo, language: language!, audio: speaksInVideo, segments: productSegments!, scriptSegments: effectiveScriptSegments } : undefined,
          pixverseKey, voiceKey, model, maiVideoModel, gatewayVideoModel, providerAuthToken: token, sourceStart,
          onlySegmentIndex: retrySegmentIndex, signal: AbortSignal.timeout(60 * 60_000),
          audio: files.find(({ kind }) => kind === "audio")?.file as File | undefined,
          video: files.find(({ kind }) => kind === "video")?.file as File | undefined,
        });
        if (retrySegmentIndex !== undefined && project.details) {
          const segmentResults = (project.details.segmentResults || []).map((segment, index) => index === retrySegmentIndex
            ? { start: segment.start, duration: segment.duration, status: "ready" as const }
            : segment);
          const generatedPrompts = [...(project.details.generatedSegments?.length ? project.details.generatedSegments : submittedPromptSegments || [])];
          if (generatedSegments[0]) generatedPrompts[retrySegmentIndex] = generatedSegments[0];
          const retriedProject: SalesVideoProject = {
            ...project,
            status: pendingDraft?.status === "ready" ? "ready" : "failed",
            phase: undefined,
            worker: undefined,
            error: pendingDraft?.status === "ready" ? undefined : project.error,
            details: { ...project.details, generatedSegments: generatedPrompts, segmentResults, needsStitching: true },
          };
          await saveSalesVideoProject(userId, retriedProject);
          return;
        }
        await saveSalesVideoProject(userId, {
          ...project,
          status: "ready",
          phase: undefined,
          worker: undefined,
          details: project.details ? {
            ...project.details, generatedSegments,
            segmentResults: generatedSegments.map((segment) => ({ start: segment.start, duration: segment.duration, status: "ready" as const })),
            needsStitching: false,
          } : undefined,
        });
      } catch (error) {
        console.error("Sales video generation failed", project.id, error instanceof Error ? error.name : "UnknownError");
        let segmentResults = project.details?.segmentResults;
        if (retrySegmentIndex !== undefined) {
          segmentResults = segmentResults ? await Promise.all(segmentResults.map(async (segment, index) => {
            if (index !== retrySegmentIndex) return segment;
            let keptPreviousClip = await stat(salesVideoSegmentPath(userId, project.id, index)).then(() => true).catch(() => false);
            if (!keptPreviousClip && pendingDraft?.status === "ready") {
              keptPreviousClip = await ensureSalesVideoSegmentFile(userId, project.id, index, segment.start, segment.duration)
                .then(() => true).catch(() => false);
            }
            return {
              ...segment,
              status: keptPreviousClip ? "ready" as const : "failed" as const,
              error: `${keptPreviousClip ? "Tạo lại chưa thành công; clip trước đó vẫn được giữ." : "Không tạo được clip này."} ${error instanceof Error ? error.message : "Bạn có thể thử lại."}`,
            };
          })) : segmentResults;
          const retryBaseStatus = pendingDraft?.status === "ready" ? "ready" : "failed";
          await saveSalesVideoProject(userId, {
            ...project, status: retryBaseStatus, phase: undefined, worker: undefined,
            error: retryBaseStatus === "ready" ? undefined : "Một hoặc nhiều clip cần được tạo lại hoặc ghép lại.",
            details: project.details ? { ...project.details, segmentResults, needsStitching: true } : undefined,
          });
          return;
        }
        if (project.details?.promptSegments?.length) {
          const failedIndex = error instanceof SalesVideoSegmentError ? error.segmentIndex : undefined;
          segmentResults = await Promise.all(project.details.promptSegments.map(async (segment, index) => ({
            start: segment.start,
            duration: segment.duration,
            status: await stat(salesVideoSegmentPath(userId, project.id, index)).then(() => "ready" as const).catch(() =>
              failedIndex === index ? "failed" as const : "pending" as const),
            ...(failedIndex === index ? { error: "Không tạo được clip này. Bạn có thể thử lại." } : {}),
          })));
        }
        await saveSalesVideoProject(userId, {
          ...project, status: "failed", phase: undefined, worker: undefined,
          error: error instanceof SalesVideoInputError ? error.message : "Tạo video thất bại. Kiểm tra model, quyền tài khoản hoặc nội dung tệp rồi thử lại.",
          details: project.details ? { ...project.details, segmentResults, needsStitching: true } : undefined,
        });
      }
    });
  });
  return NextResponse.json({ project }, { status: 202 });
}

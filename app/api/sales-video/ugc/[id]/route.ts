import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getMaiVideoModelCatalog } from "../../../../lib/media-provider";
import { readMaiVideoAuthCookie } from "../../../../lib/maivideo-auth-shared";
import { salesVideoWorkerId } from "../../../../lib/sales-video-runtime";
import { listSalesVideoProjects, salesVideoReferencePath, saveSalesVideoProject as persistSalesVideoProject, type SalesVideoProject } from "../../../../lib/sales-video-storage";
import { salesVideoDialogueToSrt, salesVideoMaxProductImages, salesVideoMaxWordCount, salesVideoSplitDialogue, salesVideoWordCount } from "../../../../lib/sales-video-templates";

const saveSalesVideoProject = persistSalesVideoProject;

export const runtime = "nodejs";

const promptSegmentSchema = z.object({ start: z.number().int().min(0).max(60), duration: z.number().int().min(1).max(15), prompt: z.string().trim().min(1).max(20_000) });
const dialogueSegmentSchema = z.object({ start: z.number().int().min(0).max(60), duration: z.number().int().min(1).max(15), script: z.string().max(2000) });
const editSchema = z.object({
  prompt: z.string().max(20_000).optional(),
  promptSegments: z.array(promptSegmentSchema).max(6).optional(),
  scriptSegments: z.array(dialogueSegmentSchema).max(6).optional(),
  script: z.string().max(2000),
}).refine((value) => Boolean(value.promptSegments?.length || value.prompt?.trim()), "Prompt không được để trống.");

async function promptLimitForProject(userId: string, details: NonNullable<SalesVideoProject["details"]>) {
  if (details.promptMaxLength && details.promptMaxLength > 0) return Math.min(20_000, details.promptMaxLength);
  const modelId = details.videoModelId || "";
  if (modelId === "higgsfield") return 10_000;
  if (modelId.startsWith("maivideo:")) {
    const id = modelId.slice("maivideo:".length);
    const catalog = await getMaiVideoModelCatalog(userId).catch(() => null);
    return Math.min(20_000, catalog?.videoModels.find((model) => model.id === id)?.promptMaxLength || 5_000);
  }
  return 5_000;
}

function resolveDialogueSegments(input: {
  requested?: z.infer<typeof dialogueSegmentSchema>[];
  saved?: NonNullable<SalesVideoProject["details"]>["scriptSegments"];
  script: string;
  prompts: Array<{ start: number; duration: number }>;
  duration: number;
  language: string;
}) {
  const source = input.requested || input.saved;
  if (source && source.length === input.prompts.length && source.every((segment, index) =>
    segment.start === input.prompts[index].start && segment.duration === input.prompts[index].duration)) return source;
  return salesVideoSplitDialogue(input.script, input.prompts, input.duration, input.language);
}

function dialogueLimitError(segments: Array<{ start: number; duration: number; script: string }>, language: string) {
  const index = segments.findIndex((segment) => {
    const limit = salesVideoMaxWordCount(segment.duration, language);
    return limit !== null && salesVideoWordCount(segment.script, language) > limit;
  });
  if (index < 0) return "";
  const limit = salesVideoMaxWordCount(segments[index].duration, language);
  return `Lời thoại clip ${index + 1} vượt giới hạn khoảng ${limit} từ; hãy rút gọn clip này.`;
}

function localSalesVideoUrl() {
  const port = Number(process.env.PORT) || 3012;
  return `http://127.0.0.1:${port}/api/sales-video`;
}

async function getOwnedProject(userId: string, id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return undefined;
  return (await listSalesVideoProjects(userId, salesVideoWorkerId)).find((project) => project.id === id);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = request.headers.get("x-storyai-user-id")?.trim();
  if (!userId) return NextResponse.json({ message: "Vui lòng đăng nhập." }, { status: 401 });
  const { id } = await params;
  const project = await getOwnedProject(userId, id);
  if (!project || project.status !== "draft" || project.phase !== "review" || !project.details) {
    return NextResponse.json({ message: "Bản nháp không còn ở trạng thái có thể chỉnh sửa." }, { status: 409 });
  }
  const body = await request.json().catch(() => null);
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: "Prompt hoặc lời thoại vượt giới hạn cho phép." }, { status: 400 });
  const promptSegments = parsed.data.promptSegments || project.details.promptSegments;
  const promptMaxLength = await promptLimitForProject(userId, project.details);
  if (promptSegments?.some((segment) => segment.prompt.length > promptMaxLength)) {
    return NextResponse.json({ message: `Prompt của model đã chọn tối đa ${promptMaxLength.toLocaleString("vi-VN")} ký tự cho mỗi clip.` }, { status: 400 });
  }
  if (promptSegments) {
    const duration = project.details.duration || 15;
    let offset = 0;
    const valid = promptSegments.every((segment) => {
      const matches = segment.start === offset && segment.duration <= 15;
      offset += segment.duration;
      return matches;
    });
    if (!valid || offset !== duration) return NextResponse.json({ message: "Các prompt clip phải chia liền mạch, tối đa 15 giây và phủ đúng thời lượng video." }, { status: 400 });
  }
  const effectivePromptSegments = promptSegments || [{ start: 0, duration: project.details.duration || 15, prompt: parsed.data.prompt || project.details.prompt || "" }];
  const language = project.details.language || "Tiếng Việt";
  const scriptSegments = resolveDialogueSegments({
    requested: parsed.data.scriptSegments, saved: project.details.scriptSegments, script: parsed.data.script,
    prompts: effectivePromptSegments, duration: project.details.duration || 15, language,
  });
  const script = scriptSegments.map((segment) => segment.script).filter(Boolean).join("\n");
  if (project.details.audio) {
    const issue = dialogueLimitError(scriptSegments, language);
    if (issue) return NextResponse.json({ message: issue }, { status: 400 });
  }
  const updated: SalesVideoProject = {
    ...project,
    details: {
      ...project.details,
      prompt: promptSegments?.[0]?.prompt || parsed.data.prompt || "",
      promptMaxLength,
      ...(promptSegments ? { promptSegments } : {}),
      script,
      scriptSegments,
      subtitleSrt: project.details.audio ? salesVideoDialogueToSrt(scriptSegments, language) : "",
    },
  };
  await saveSalesVideoProject(userId, updated);
  return NextResponse.json({ project: updated });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = request.headers.get("x-storyai-user-id")?.trim();
  const cookie = request.headers.get("cookie") || "";
  if (!userId || !readMaiVideoAuthCookie(cookie)) return NextResponse.json({ message: "Vui lòng đăng nhập MaiVideo." }, { status: 401 });
  const { id } = await params;
  const project = await getOwnedProject(userId, id);
  const body = await request.json().catch(() => null);
  const retrySegmentValue = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).retrySegmentIndex
    : undefined;
  const retrySegmentIndex = retrySegmentValue === undefined ? undefined : Number(retrySegmentValue);
  const saveSalesVideoProject = (owner: string, value: SalesVideoProject) => persistSalesVideoProject(owner, value, retrySegmentIndex);
  const retrySegment = retrySegmentIndex !== undefined;
  if (retrySegment && (!Number.isInteger(retrySegmentIndex) || retrySegmentIndex! < 0 || retrySegmentIndex! > 5)) {
    return NextResponse.json({ message: "Clip cần tạo lại không hợp lệ." }, { status: 400 });
  }
  if (!project || !project.details || (retrySegment
    ? project.status !== "ready" && project.status !== "failed"
    : project.status !== "draft" || project.phase !== "review")) {
    return NextResponse.json({ message: "Job chưa có bản nháp sẵn sàng để tạo video." }, { status: 409 });
  }
  const details = project.details;
  if (details.voiceRegeneration?.status === "processing") {
    return NextResponse.json({ message: "Hãy đợi tạo lại voice hoàn tất trước khi tạo lại clip." }, { status: 409 });
  }
  const parsed = editSchema.safeParse(body);
  const parsedData = parsed.success ? parsed.data : undefined;
  if (!retrySegment && !parsedData) {
    return NextResponse.json({ message: "Prompt clip vượt giới hạn ký tự của StoryAI." }, { status: 400 });
  }
  const promptSegments = retrySegment
    ? details.promptSegments || [{ start: 0, duration: details.duration || 15, prompt: details.prompt || "" }]
    : parsedData!.promptSegments || details.promptSegments || [{ start: 0, duration: details.duration || 15, prompt: parsedData!.prompt || details.prompt || "" }];
  if (retrySegment && retrySegmentIndex! >= promptSegments.length) {
    return NextResponse.json({ message: "Không tìm thấy clip 15 giây này trong project." }, { status: 404 });
  }
  const currentSegmentResults = details.segmentResults?.length === promptSegments.length
    ? details.segmentResults
    : promptSegments.map((segment, index) => ({
      start: segment.start, duration: segment.duration,
      status: project.status === "ready" ? "ready" as const : "pending" as const,
      ...(index === retrySegmentIndex ? { error: undefined } : {}),
    }));
  if (retrySegment && currentSegmentResults[retrySegmentIndex!]?.status === "processing") {
    return NextResponse.json({ message: "Clip này đang được tạo lại." }, { status: 409 });
  }
  const retryModelId = retrySegment && typeof body?.model === "string" ? body.model : details.videoModelId || "";
  const promptMaxLength = await promptLimitForProject(userId, details);
  if (!promptSegments.length || promptSegments.some((segment) => !segment.prompt.trim())) {
    return NextResponse.json({ message: "Mỗi clip cần một prompt riêng trước khi tạo video." }, { status: 400 });
  }
  if (promptSegments.some((segment) => segment.prompt.length > promptMaxLength)) {
    return NextResponse.json({ message: `Prompt của model đã chọn tối đa ${promptMaxLength.toLocaleString("vi-VN")} ký tự cho mỗi clip.` }, { status: 400 });
  }
  let promptOffset = 0;
  const validPromptTimeline = promptSegments.every((segment) => {
    const valid = segment.start === promptOffset && segment.duration <= 15;
    promptOffset += segment.duration;
    return valid;
  });
  if (!validPromptTimeline || promptOffset !== (details.duration || 15)) {
    return NextResponse.json({ message: "Các prompt clip phải chia liền mạch, tối đa 15 giây và phủ đúng thời lượng video." }, { status: 400 });
  }
  const language = details.language || "Tiếng Việt";
  const duration = details.duration || 15;
  const scriptSegments = retrySegment
    ? details.scriptSegments || resolveDialogueSegments({ saved: details.scriptSegments, script: details.script || "", prompts: promptSegments, duration, language })
    : resolveDialogueSegments({
      requested: parsedData!.scriptSegments, saved: details.scriptSegments, script: parsedData!.script,
      prompts: promptSegments, duration, language,
    });
  const script = retrySegment ? details.script || scriptSegments.map((segment) => segment.script).filter(Boolean).join("\n")
    : scriptSegments.map((segment) => segment.script).filter(Boolean).join("\n");
  if (details.audio) {
    const issue = dialogueLimitError(scriptSegments, language);
    if (issue) return NextResponse.json({ message: issue }, { status: 400 });
  }


  const presenterPath = salesVideoReferencePath(userId, id, "presenter");
  const productImageCount = Math.max(1, Math.min(salesVideoMaxProductImages,
    details.productImageCount || details.references?.products?.length || 1));
  const [presenter, ...productImages] = await Promise.all([
    readFile(presenterPath).catch(() => null),
    ...Array.from({ length: productImageCount }, (_, index) => readFile(salesVideoReferencePath(userId, id, "product", index)).catch(() => null)),
  ]);
  if (!presenter || productImages.some((image) => !image)) return NextResponse.json({ message: "Thiếu ảnh tham chiếu đã lưu. Tạo job mới và tải lại ảnh." }, { status: 409 });

  const updated: SalesVideoProject = {
    ...project,
    ...(retrySegment ? { worker: salesVideoWorkerId } : { status: "processing" as const, phase: "generating" as const, worker: salesVideoWorkerId }),
    error: retrySegment ? project.error : undefined,
    details: {
      ...details, prompt: promptSegments[0].prompt, promptMaxLength, promptSegments, script,
      scriptSegments, subtitleSrt: details.audio ? salesVideoDialogueToSrt(scriptSegments, language) : "",
      ...(retrySegment ? {
        segmentResults: currentSegmentResults.map((segment, index) => index === retrySegmentIndex
          ? { start: segment.start, duration: segment.duration, status: "processing" as const, modelId: retryModelId }
          : segment),
        needsStitching: true,
      } : {}),
    },
  };
  await saveSalesVideoProject(userId, updated);

  const form = new FormData();
  form.set("autoUgc", "1");
  form.set("projectId", id);
  form.set("title", project.title);
  form.set("template", details.templateId || "general");
  form.set("product", details.product || project.title);
  form.set("productFacts", details.facts || "");
  form.set("productUrl", details.productUrl || "");
  form.set("language", language);
  form.set("duration", String(duration));
  form.set("ratio", details.ratio || "9:16");
  form.set("model", retryModelId);
  form.set("claimCategory", details.claimCategory || "general");
  form.set("prompt", promptSegments[0].prompt);
  form.set("promptSegments", JSON.stringify(promptSegments));
  form.set("script", script);
  form.set("scriptSegments", JSON.stringify(scriptSegments));
  if (retrySegment) form.set("retrySegmentIndex", String(retrySegmentIndex));
  form.set("presenter", new File([new Uint8Array(presenter)], "presenter.webp", { type: "image/webp" }));
  productImages.forEach((image, index) => {
    if (!image) return;
    const file = new File([new Uint8Array(image)], `product-${index + 1}.webp`, { type: "image/webp" });
    if (index === 0) form.set("primaryProductImage", file);
    else form.append("additionalProductImage", file);
  });

  const forwardedHeaders = new Headers({ cookie });
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedHost) forwardedHeaders.set("x-forwarded-host", forwardedHost);
  if (forwardedProto) forwardedHeaders.set("x-forwarded-proto", forwardedProto);

  try {
    const response = await fetch(localSalesVideoUrl(), { method: "POST", headers: forwardedHeaders, body: form });
    const result = await response.json().catch(() => ({})) as { project?: SalesVideoProject; message?: string };
    if (!response.ok || result.project?.id !== id) {
      const failedMessage = result.message || "Không gửi được yêu cầu tạo video.";
      if (retrySegment) {
        await saveSalesVideoProject(userId, {
          ...updated, worker: undefined, error: project.error,
          details: updated.details ? {
            ...updated.details,
            segmentResults: currentSegmentResults.map((segment, index) => index === retrySegmentIndex
              ? { ...segment, modelId: retryModelId, error: failedMessage }
              : segment),
            needsStitching: details.needsStitching ?? false,
          } : undefined,
        });
      } else {
        await saveSalesVideoProject(userId, { ...updated, status: "draft", phase: "review", worker: undefined, error: failedMessage });
      }
      return NextResponse.json({ message: result.message || "StoryAI không nhận được yêu cầu tạo video." }, { status: response.status || 502 });
    }
    return NextResponse.json({ project: result.project }, { status: 202 });
  } catch {
    const failedMessage = "StoryAI không kết nối được dịch vụ tạo video.";
    if (retrySegment) {
      await saveSalesVideoProject(userId, {
        ...updated, worker: undefined, error: project.error,
        details: updated.details ? {
          ...updated.details,
          segmentResults: currentSegmentResults.map((segment, index) => index === retrySegmentIndex
            ? { ...segment, modelId: retryModelId, error: failedMessage }
            : segment),
          needsStitching: details.needsStitching ?? false,
        } : undefined,
      });
    } else {
      await saveSalesVideoProject(userId, { ...updated, status: "draft", phase: "review", worker: undefined, error: failedMessage });
    }
    return NextResponse.json({ message: "StoryAI không kết nối được dịch vụ tạo video." }, { status: 502 });
  }
}

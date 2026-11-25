import { NextResponse } from "next/server";
import { DEFAULT_FLOW_VIDEO_DURATION_SEC } from "../../../lib/media-generation-settings";
import { generateFlowTimelapseVideo } from "../../../lib/media-provider";
import { readMaiVideoAuthCookie } from "../../../lib/maivideo-auth-shared";
import { readTimelapseImage, safeTimelapseId } from "../../../lib/timelapse-storage";

export const runtime = "nodejs";

type RequestBody = { workflowId?: unknown; transitionId?: unknown; fromImageId?: unknown; toImageId?: unknown; prompt?: unknown; continuity?: unknown; aspectRatio?: unknown; durationSec?: unknown };

export async function POST(request: Request) {
  const userId = request.headers.get("x-storyai-user-id")?.trim() || "";
  if (!userId) return NextResponse.json({ message: "Vui lòng đăng nhập để tạo video." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as RequestBody;
  const workflowId = safeTimelapseId(String(body.workflowId || ""));
  const transitionId = safeTimelapseId(String(body.transitionId || ""));
  const fromImageId = safeTimelapseId(String(body.fromImageId || ""));
  const toImageId = safeTimelapseId(String(body.toImageId || ""));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const continuity = typeof body.continuity === "string" ? body.continuity.trim().slice(0, 3_000) : "";
  const aspectRatio = ["16:9", "9:16", "1:1", "4:3", "3:4"].includes(String(body.aspectRatio)) ? String(body.aspectRatio) : "16:9";
  const requestedDuration = Number(body.durationSec);
  const durationSec = Number.isInteger(requestedDuration) && requestedDuration >= 5 && requestedDuration <= 15 ? requestedDuration : DEFAULT_FLOW_VIDEO_DURATION_SEC;
  if (!workflowId || !transitionId || !fromImageId || !toImageId || !prompt) return NextResponse.json({ message: "Cần có hai ảnh liên tiếp và video_prompt tương ứng." }, { status: 400 });
  const flowPrompt = continuity ? `${prompt}\n\nGLOBAL CONTINUITY:\n${continuity}` : prompt;
  if (flowPrompt.length > 12_000) return NextResponse.json({ message: "video_prompt và continuity vượt giới hạn 12.000 ký tự của Flow." }, { status: 400 });

  const providerAuthToken = readMaiVideoAuthCookie(request.headers.get("cookie"));
  if (!providerAuthToken) return NextResponse.json({ code: "PROVIDER_SESSION_REQUIRED", message: "Phiên MaiVideo chưa đăng nhập. Hãy đăng nhập lại để dùng Flow." }, { status: 401 });

  try {
    const [fromImage, toImage] = await Promise.all([
      readTimelapseImage(userId, workflowId, fromImageId),
      readTimelapseImage(userId, workflowId, toImageId),
    ]);
    if (!fromImage || !toImage) throw new Error("TIMELAPSE_IMAGE_NOT_FOUND");
    const referenceImageUrls = [fromImage, toImage].map(({ bytes, contentType }) =>
      `data:${contentType};base64,${bytes.toString("base64")}`,
    );
    const media = await generateFlowTimelapseVideo({
      userId,
      workflowId,
      transitionId,
      prompt: flowPrompt,
      aspectRatio,
      durationSec,
      referenceImageUrls,
      referenceImageNames: ["Starting frame", "Ending frame"],
      providerAuthToken,
    });
    return NextResponse.json({ ok: true, videoUrl: `/api/timelapse/videos/${encodeURIComponent(workflowId)}/${encodeURIComponent(transitionId)}`, model: media.model, quality: media.quality, durationSec: media.durationSec });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Không tạo được Transition bằng Flow.";
    const userMessage = message === "SEEDANCE_ACCOUNT_REQUIRED"
      ? "Chưa có tài khoản Seedance Gateway. Hãy thêm tài khoản trong Cài đặt StoryAI."
      : message === "SEEDANCE_ACCOUNT_NOT_FOUND"
        ? "Tài khoản Seedance Gateway đã chọn không còn tồn tại. Hãy chọn lại trong Cài đặt."
        : message === "SEEDANCE_ENCRYPTION_KEY_REQUIRED"
          ? "Máy chủ chưa cấu hình khóa mã hóa tài khoản Flow."
          : message;
    const status = ["SEEDANCE_ACCOUNT_REQUIRED", "SEEDANCE_ACCOUNT_NOT_FOUND", "SEEDANCE_ENCRYPTION_KEY_REQUIRED"].includes(message) ? 503 : 502;
    return NextResponse.json({ code: message, message: userMessage }, { status });
  }
}

import { NextResponse } from "next/server";
import { getCurrentUserId } from "../../../lib/auth-server";
import { MAX_RUN_CONCURRENCY, MIN_RUN_CONCURRENCY } from "../../../lib/run-concurrency-config";
import { getDefaultRunConcurrency, getRunConcurrencyLimit, saveRunConcurrencyLimit } from "../../../lib/user-settings";
import { refreshUserSceneMediaConcurrency } from "../../../lib/scene-media-queue";
import { refreshUserTtsConcurrency } from "../../../lib/tts-concurrency";

export const runtime = "nodejs";

function errorResponse(cause: unknown) {
  const code = cause instanceof Error ? cause.message : "USER_SETTINGS_STORE_UNAVAILABLE";
  const knownMessages: Record<string, string> = {
    STORYAI_AUTH_REQUIRED: "Phiên làm việc không hợp lệ. Hãy tải lại trang rồi thử lại.",
    USER_SETTINGS_STORE_UNAVAILABLE: "Không thể đọc hoặc lưu cài đặt trên máy này.",
  };
  const status = code === "STORYAI_AUTH_REQUIRED" ? 401 : 500;
  return NextResponse.json({ code, message: knownMessages[code] || "Không thể lưu cài đặt số luồng." }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    return NextResponse.json({
      maxConcurrentJobs: await getRunConcurrencyLimit(),
      min: MIN_RUN_CONCURRENCY,
      max: MAX_RUN_CONCURRENCY,
      default: getDefaultRunConcurrency(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await getCurrentUserId();
    const body = await request.json().catch(() => ({})) as { maxConcurrentJobs?: unknown };
    const limit = body.maxConcurrentJobs;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < MIN_RUN_CONCURRENCY || limit > MAX_RUN_CONCURRENCY) {
      return NextResponse.json({
        code: "RUN_CONCURRENCY_OUT_OF_RANGE",
        message: `Số luồng phải là số nguyên từ ${MIN_RUN_CONCURRENCY} đến ${MAX_RUN_CONCURRENCY}.`,
      }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const settings = await saveRunConcurrencyLimit(userId, limit);
    refreshUserSceneMediaConcurrency(userId);
    refreshUserTtsConcurrency(userId, settings.maxConcurrentJobs);
    return NextResponse.json({
      ...settings,
      min: MIN_RUN_CONCURRENCY,
      max: MAX_RUN_CONCURRENCY,
      default: getDefaultRunConcurrency(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return errorResponse(cause);
  }
}

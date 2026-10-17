import { NextResponse } from "next/server";
import { listMaiVideoApiKeyStatus, maiVideoApiKeyEncryptionReady, saveMaiVideoApiKey, verifyMaiVideoApiKey } from "../../../lib/maivideo-api-keys";

export const runtime = "nodejs";

function errorResponse(cause: unknown) {
  const code = cause instanceof Error ? cause.message : "MAIVIDEO_CONNECTION_FAILED";
  const serviceStatus = code.match(/^MAIVIDEO_SERVICE_UNAVAILABLE_(\d{3})$/)?.[1];
  const rejectedStatus = code.match(/^MAIVIDEO_API_KEY_REJECTED_(\d{3})$/)?.[1];
  const messages: Record<string, string> = {
    MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED: "Máy chủ chưa cấu hình khóa mã hóa API key. Cần STORYAI_CREDENTIALS_ENCRYPTION_KEY hoặc SEEDANCE_CREDENTIALS_ENCRYPTION_KEY dài ít nhất 32 ký tự.",
    MAIVIDEO_API_KEY_INVALID: "API key không hợp lệ hoặc đã bị thu hồi. Hãy kiểm tra key trong MaiVideo Studio.",
    MAIVIDEO_API_KEY_INPUT_REQUIRED: "Hãy nhập API key MaiVideo.",
    MAIVIDEO_RATE_LIMITED: "MaiVideo đang giới hạn số lần kiểm tra. Vui lòng thử lại sau.",
    MAIVIDEO_CONNECTION_FAILED: "Không kết nối được MaiVideo để xác thực API key.",
    MAIVIDEO_API_KEY_STORE_UNAVAILABLE: "Không thể đọc hoặc lưu API key MaiVideo.",
  };
  const message = messages[code]
    || (serviceStatus ? `MaiVideo đang lỗi (HTTP ${serviceStatus}). Thử lại sau.` : "")
    || (rejectedStatus ? `MaiVideo từ chối yêu cầu xác thực (HTTP ${rejectedStatus}).` : "")
    || "Không thể lưu API key MaiVideo.";
  const status = code === "MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED" ? 503
    : code === "MAIVIDEO_RATE_LIMITED" ? 429
      : code === "MAIVIDEO_CONNECTION_FAILED" || serviceStatus ? 502
        : code === "MAIVIDEO_API_KEY_STORE_UNAVAILABLE" ? 500
          : 400;
  return NextResponse.json({ code, message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    return NextResponse.json(await listMaiVideoApiKeyStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({})) as { apiKey?: unknown };
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) return errorResponse(new Error("MAIVIDEO_API_KEY_INPUT_REQUIRED"));
  if (apiKey.length > 1_000) return NextResponse.json({ message: "API key không hợp lệ." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (!maiVideoApiKeyEncryptionReady()) return errorResponse(new Error("MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED"));
  try {
    await verifyMaiVideoApiKey(apiKey);
    const saved = await saveMaiVideoApiKey(apiKey);
    return NextResponse.json({ saved, ...(await listMaiVideoApiKeyStatus()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return errorResponse(cause);
  }
}

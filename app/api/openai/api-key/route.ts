import { NextResponse } from "next/server";
import { deleteOpenAIApiKey, listOpenAIApiKeyStatus, openAIApiKeyEncryptionReady, saveOpenAIApiKey } from "../../../lib/openai-api-keys";

export const runtime = "nodejs";

function errorResponse(cause: unknown) {
  const code = cause instanceof Error ? cause.message : "OPENAI_API_KEY_STORE_UNAVAILABLE";
  const messages: Record<string, string> = {
    OPENAI_CREDENTIALS_ENCRYPTION_KEY_REQUIRED: "Chưa có khóa mã hóa cục bộ. Khởi động ứng dụng để tạo cấu hình bảo mật cho máy này rồi thử lại.",
    OPENAI_API_KEY_INPUT_REQUIRED: "Hãy nhập OpenAI API key.",
    OPENAI_API_KEY_STORE_UNAVAILABLE: "Không thể đọc hoặc lưu OpenAI API key trên máy này.",
    STORYAI_AUTH_REQUIRED: "Phiên làm việc không hợp lệ. Hãy tải lại trang rồi thử lại.",
  };
  const status = code === "OPENAI_CREDENTIALS_ENCRYPTION_KEY_REQUIRED" ? 503
    : code === "OPENAI_API_KEY_INPUT_REQUIRED" ? 400
      : code === "STORYAI_AUTH_REQUIRED" ? 401 : 500;
  return NextResponse.json({ code, message: messages[code] || "Không thể lưu OpenAI API key." }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    return NextResponse.json(await listOpenAIApiKeyStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({})) as { apiKey?: unknown };
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) return errorResponse(new Error("OPENAI_API_KEY_INPUT_REQUIRED"));
  if (apiKey.length > 4_096) return NextResponse.json({ message: "OpenAI API key quá dài." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (!openAIApiKeyEncryptionReady()) return errorResponse(new Error("OPENAI_CREDENTIALS_ENCRYPTION_KEY_REQUIRED"));
  try {
    const saved = await saveOpenAIApiKey(apiKey);
    return NextResponse.json({ saved, ...(await listOpenAIApiKeyStatus()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function DELETE() {
  try {
    return NextResponse.json(await deleteOpenAIApiKey(), { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return errorResponse(cause);
  }
}

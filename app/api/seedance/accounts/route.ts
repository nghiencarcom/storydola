import { NextResponse } from "next/server";
import { addSeedanceAccount, listSeedanceAccounts, saveDefaultSeedanceApiKey, verifySeedanceApiKey, verifySeedanceApiKeySession } from "../../../lib/seedance-accounts";
import { readMaiVideoAuthCookie } from "../../../lib/maivideo-auth-shared";

export const runtime = "nodejs";

function errorResponse(cause: unknown) {
  const code = cause instanceof Error ? cause.message : "SEEDANCE_CONNECTION_FAILED";
  const serviceStatus = code.match(/^SEEDANCE_SERVICE_UNAVAILABLE_(\d{3})$/)?.[1];
  const validationStatus = code.match(/^SEEDANCE_VALIDATION_REJECTED_(\d{3})$/)?.[1];
  const messages: Record<string, string> = {
    SEEDANCE_ENCRYPTION_KEY_REQUIRED: "Máy chủ chưa có khóa mã hóa tài khoản Seedance. Hãy cấu hình SEEDANCE_CREDENTIALS_ENCRYPTION_KEY dài ít nhất 32 ký tự rồi khởi động lại ứng dụng.",
    SEEDANCE_API_KEY_INVALID: "API key không hợp lệ hoặc đã bị thu hồi. Hãy kiểm tra key trong Seedance Studio.",
    SEEDANCE_API_KEY_SESSION_MISMATCH: "Seedance từ chối cặp API key và phiên MaiVideo hiện tại. Không tạo video để tránh trừ credit nhầm. Hãy lưu lại API key trong khi đang đăng nhập đúng tài khoản MaiVideo.",
    MAIVIDEO_SESSION_REQUIRED: "Phiên MaiVideo chưa đăng nhập. Hãy đăng nhập lại trước khi lưu API key Seedance.",
    MAIVIDEO_SESSION_INVALID: "Phiên MaiVideo không hợp lệ hoặc đã hết hạn. Hãy đăng nhập lại rồi thử lưu API key.",
    SEEDANCE_RATE_LIMITED: "Seedance đang giới hạn số lần kiểm tra. Vui lòng thử lại sau.",
    SEEDANCE_CONNECTION_FAILED: "Không kết nối được Seedance để kiểm tra API key. Kiểm tra kết nối mạng rồi thử lại.",
    SEEDANCE_ACCOUNT_INPUT_REQUIRED: "Hãy nhập API key Seedance.",
  };
  const message = messages[code]
    || (serviceStatus ? `Seedance đang lỗi (HTTP ${serviceStatus}). Thử lại sau.` : "")
    || (validationStatus ? `Seedance từ chối yêu cầu kiểm tra API key (HTTP ${validationStatus}).` : "")
    || "Không thể lưu API key Seedance.";
  const status = code === "SEEDANCE_ENCRYPTION_KEY_REQUIRED" ? 503
    : code === "SEEDANCE_RATE_LIMITED" ? 429
      : code === "SEEDANCE_CONNECTION_FAILED" || serviceStatus ? 502
        : 400;
  return NextResponse.json({ code, message }, { status });
}

export async function GET() {
  try {
    return NextResponse.json(await listSeedanceAccounts(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Không thể đọc hồ sơ Seedance." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { name?: unknown; apiKey?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!name || !apiKey) return errorResponse(new Error("SEEDANCE_ACCOUNT_INPUT_REQUIRED"));
  if (apiKey.length > 1_000) return NextResponse.json({ message: "API key không hợp lệ." }, { status: 400 });
  try {
    const maiVideoSessionToken = readMaiVideoAuthCookie(request.headers.get("cookie"));
    await verifySeedanceApiKey(apiKey);
    await verifySeedanceApiKeySession(apiKey, maiVideoSessionToken);
    const account = await addSeedanceAccount(name, apiKey, maiVideoSessionToken);
    return NextResponse.json({ account, ...(await listSeedanceAccounts()) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({})) as { apiKey?: unknown };
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) return errorResponse(new Error("SEEDANCE_ACCOUNT_INPUT_REQUIRED"));
  if (apiKey.length > 1_000) return NextResponse.json({ message: "API key không hợp lệ." }, { status: 400 });
  try {
    const maiVideoSessionToken = readMaiVideoAuthCookie(request.headers.get("cookie"));
    await verifySeedanceApiKey(apiKey);
    await verifySeedanceApiKeySession(apiKey, maiVideoSessionToken);
    const account = await saveDefaultSeedanceApiKey(apiKey, maiVideoSessionToken);
    return NextResponse.json({ account, ...(await listSeedanceAccounts()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return errorResponse(cause);
  }
}

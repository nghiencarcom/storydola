import path from "node:path";
import { NextResponse } from "next/server";
import { agentAccessEncryptionReady, createAgentAccessToken, getAgentAccessStatus, revokeAgentAccessToken } from "../../lib/agent-access-store";
import { getCurrentUserId } from "../../lib/auth-server";
import { readMaiVideoAuthCookie } from "../../lib/maivideo-auth-shared";

export const runtime = "nodejs";

function localBaseUrl(request: Request) {
  const requestUrl = new URL(request.url);
  const port = requestUrl.port || (requestUrl.protocol === "https:" ? "443" : "80");
  return `${requestUrl.protocol}//127.0.0.1${port === "80" && requestUrl.protocol === "http:" || port === "443" && requestUrl.protocol === "https:" ? "" : `:${port}`}`;
}

function responseError(cause: unknown) {
  const code = cause instanceof Error ? cause.message : "AGENT_ACCESS_FAILED";
  if (code === "AGENT_ACCESS_ENCRYPTION_KEY_REQUIRED") {
    return NextResponse.json({ code, message: "Máy chủ cần STORYAI_CREDENTIALS_ENCRYPTION_KEY hoặc SEEDANCE_CREDENTIALS_ENCRYPTION_KEY dài ít nhất 32 ký tự để bảo vệ token agent." }, { status: 503 });
  }
  return NextResponse.json({ code: "AGENT_ACCESS_FAILED", message: "Không thể cập nhật quyền truy cập agent." }, { status: 503 });
}

export async function GET(request: Request) {
  try {
    const ownerId = await getCurrentUserId();
    const status = await getAgentAccessStatus(ownerId);
    return NextResponse.json({
      ...status,
      encryptionReady: agentAccessEncryptionReady(),
      baseUrl: localBaseUrl(request),
      commandPath: path.join(process.cwd(), "scripts", "storyai-mcp.mjs"),
      nodePath: process.execPath,
      platform: process.platform,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Vui lòng đăng nhập MaiVideo để quản lý kết nối agent." }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const ownerId = await getCurrentUserId();
    if (!agentAccessEncryptionReady()) throw new Error("AGENT_ACCESS_ENCRYPTION_KEY_REQUIRED");
    const maiVideoToken = readMaiVideoAuthCookie(request.headers.get("cookie"));
    if (!maiVideoToken) return NextResponse.json({ code: "AGENT_ACCESS_REQUIRES_AUTH", message: "Hãy đăng nhập lại MaiVideo rồi tạo token MCP." }, { status: 401 });
    const created = await createAgentAccessToken(ownerId, maiVideoToken);
    return NextResponse.json({
      ...created,
      configured: true,
      encryptionReady: true,
      autoInstallReady: true,
      baseUrl: localBaseUrl(request),
      commandPath: path.join(process.cwd(), "scripts", "storyai-mcp.mjs"),
      nodePath: process.execPath,
      platform: process.platform,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return responseError(cause);
  }
}

export async function DELETE() {
  try {
    const ownerId = await getCurrentUserId();
    await revokeAgentAccessToken(ownerId);
    return NextResponse.json({ configured: false });
  } catch {
    return NextResponse.json({ message: "Vui lòng đăng nhập MaiVideo để thu hồi token agent." }, { status: 401 });
  }
}

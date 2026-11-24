import path from "node:path";
import { NextResponse } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { installCodingAgentConfig, getCodingAgentConfigStatuses, type CodingAgent } from "../../../lib/agent-config-manager";
import { getAgentAccessCredentials } from "../../../lib/agent-access-store";
import { getCurrentUserId } from "../../../lib/auth-server";
import { resolveMaiVideoAuthBaseUrl, verifyMaiVideoAuthToken } from "../../../lib/maivideo-auth-shared";

export const runtime = "nodejs";

function localBaseUrl(request: Request) {
  const requestUrl = new URL(request.url);
  const port = requestUrl.port || (requestUrl.protocol === "https:" ? "443" : "80");
  const omittedPort = (port === "80" && requestUrl.protocol === "http:") || (port === "443" && requestUrl.protocol === "https:");
  return `${requestUrl.protocol}//127.0.0.1${omittedPort ? "" : `:${port}`}`;
}

function routeError(cause: unknown) {
  const code = cause instanceof Error ? cause.message : "AGENT_INSTALL_FAILED";
  if (code === "AGENT_ACCESS_ROTATE_REQUIRED") {
    return NextResponse.json({ code, message: "Token MCP cũ chưa hỗ trợ cài tự động. Hãy tạo token MCP mới rồi kết nối lại agent." }, { status: 409 });
  }
  if (code === "AGENT_CONFIG_INVALID_JSON" || code === "AGENT_CONFIG_INVALID_TOML") {
    return NextResponse.json({ code, message: "File cấu hình agent đang sai định dạng JSON/TOML. StoryAI chưa thay đổi file; hãy sửa JSON rồi thử lại." }, { status: 409 });
  }
  if (code === "STORYAI_MCP_CHECK_FAILED") {
    return NextResponse.json({ code, message: "StoryAI chưa vượt qua kiểm tra MCP local. Kiểm tra app đang chạy và phiên MaiVideo còn hiệu lực, rồi thử lại." }, { status: 503 });
  }
  if (code === "AGENT_ACCESS_STORE_UNAVAILABLE" || code === "AGENT_ACCESS_ENCRYPTION_KEY_REQUIRED") {
    return NextResponse.json({ code, message: "StoryAI không giải mã được token lưu cục bộ. Kiểm tra khóa mã hóa trong .env; nếu vừa đổi khóa, hãy xoay token MCP." }, { status: 503 });
  }
  return NextResponse.json({ code: "AGENT_INSTALL_FAILED", message: "Không cài được MCP vào coding agent. Kiểm tra quyền ghi file cấu hình rồi thử lại." }, { status: 500 });
}

async function verifyLocalMcp(nodePath: string, scriptPath: string, baseUrl: string, token: string) {
  const inheritedNames = ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP"];
  const env: Record<string, string> = {};
  for (const name of inheritedNames) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  const transport = new StdioClientTransport({
    command: nodePath,
    args: [scriptPath],
    env: { ...env, STORYAI_URL: baseUrl, STORYAI_MCP_TOKEN: token },
    cwd: process.cwd(),
    stderr: "ignore",
  });
  const client = new Client({ name: "storyai-connection-check", version: "0.1.0" });
  try {
    await client.connect(transport, { timeout: 15_000 });
    const result = await client.callTool({ name: "storyai_list_projects", arguments: {} }, undefined, { timeout: 15_000 });
    if (result.isError) throw new Error("MCP tool returned an error.");
  } catch {
    throw new Error("STORYAI_MCP_CHECK_FAILED");
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function GET() {
  try {
    const ownerId = await getCurrentUserId();
    const credentials = await getAgentAccessCredentials(ownerId).catch(() => undefined);
    return NextResponse.json({ agents: await getCodingAgentConfigStatuses(credentials?.token) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Vui lòng đăng nhập MaiVideo để kiểm tra cấu hình agent." }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const ownerId = await getCurrentUserId();
    const body = await request.json().catch(() => ({})) as { agent?: unknown; repairInvalidConfig?: unknown };
    const agent = body.agent;
    if (agent !== "codex" && agent !== "claude" && agent !== "antigravity") {
      return NextResponse.json({ code: "AGENT_UNSUPPORTED", message: "Chọn Codex, Claude Code hoặc Antigravity." }, { status: 400 });
    }

    const credentials = await getAgentAccessCredentials(ownerId);
    if (!credentials) {
      return NextResponse.json({ code: "AGENT_ACCESS_NOT_CONFIGURED", message: "Chưa có token MCP. Hãy tạo token rồi thử lại." }, { status: 409 });
    }
    const user = await verifyMaiVideoAuthToken(credentials.maiVideoToken, resolveMaiVideoAuthBaseUrl(request));
    if (!user || user.id !== ownerId) {
      return NextResponse.json({ code: "AGENT_MAIVIDEO_SESSION_EXPIRED", message: "Phiên MaiVideo đã hết hạn. Đăng nhập lại rồi kết nối agent để tạo token mới." }, { status: 401 });
    }

    const nodePath = process.execPath;
    const scriptPath = path.join(process.cwd(), "scripts", "storyai-mcp.mjs");
    const baseUrl = localBaseUrl(request);
    await verifyLocalMcp(nodePath, scriptPath, baseUrl, credentials.token);
    const result = await installCodingAgentConfig({ agent: agent as CodingAgent, nodePath, scriptPath, baseUrl, token: credentials.token, repairInvalidConfig: body.repairInvalidConfig === true });
    return NextResponse.json({ ...result, installed: true, connectionVerified: true, restartRequired: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return routeError(cause);
  }
}

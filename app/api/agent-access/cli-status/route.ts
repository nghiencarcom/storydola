import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { getCodingAgentCliStatuses } from "../../../lib/coding-agent-cli";
import { getCurrentUserId } from "../../../lib/auth-server";

export const runtime = "nodejs";
const execFileAsync = promisify(execFile);

export async function GET() {
  try {
    await getCurrentUserId();
    return NextResponse.json({ agents: await getCodingAgentCliStatuses() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để kiểm tra Code Agent." }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    await getCurrentUserId();
  } catch {
    return NextResponse.json({ message: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để cài đặt Code Agent." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { agent?: unknown };
  if (body.agent !== "antigravity") {
    return NextResponse.json({ message: "Hiện chỉ hỗ trợ cài đặt tự động agy CLI cho Antigravity." }, { status: 400 });
  }

  try {
    if (process.platform === "win32") {
      await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "irm https://antigravity.google/cli/install.ps1 | iex"],
        { timeout: 180_000, windowsHide: true },
      );
    } else {
      await execFileAsync(
        "/bin/bash",
        ["-c", "curl -fsSL https://antigravity.google/cli/install.sh | bash"],
        { timeout: 180_000 },
      );
    }

    const agents = await getCodingAgentCliStatuses();
    const installed = Boolean(agents.find((item) => item.id === "antigravity")?.available);
    if (!installed) {
      return NextResponse.json(
        { message: "Đã chạy bộ cài nhưng chưa tìm thấy lệnh agy. Hãy kiểm tra kết nối mạng hoặc chạy lệnh cài trong Terminal." },
        { status: 500 },
      );
    }
    return NextResponse.json({ installed: true, agents }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return NextResponse.json(
      { message: cause instanceof Error ? cause.message : "Không thể tự cài agy CLI. Hãy thử chạy lệnh cài trực tiếp trong Terminal/PowerShell." },
      { status: 500 },
    );
  }
}

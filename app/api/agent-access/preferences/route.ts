import { NextResponse } from "next/server";
import { getCodingAgentPreference, saveCodingAgentPreference } from "../../../lib/coding-agent-preferences";
import { getCodingAgentCliStatuses, type CodingAgent } from "../../../lib/coding-agent-cli";
import { getCurrentUserId } from "../../../lib/auth-server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ownerId = await getCurrentUserId();
    return NextResponse.json({ preference: await getCodingAgentPreference(ownerId) || null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Vui lòng đăng nhập để tải cấu hình Code Agent." }, { status: 401 });
  }
}

export async function PUT(request: Request) {
  try {
    const ownerId = await getCurrentUserId();
    const body = await request.json().catch(() => ({})) as { agent?: unknown; model?: unknown; quality?: unknown; speed?: unknown };
    if (body.agent !== "codex" && body.agent !== "claude" && body.agent !== "antigravity") {
      return NextResponse.json({ message: "Chọn Codex, Claude Code hoặc Antigravity." }, { status: 400 });
    }
    const agent = body.agent as CodingAgent;
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const quality = body.quality === "low" || body.quality === "medium" || body.quality === "high" || body.quality === "xhigh" || body.quality === "max" || body.quality === "ultra"
      ? body.quality : "auto";
    const speed = body.speed === "fast" ? "fast" : "standard";
    if (model.length > 120 || (model && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/u.test(model))) {
      return NextResponse.json({ message: "Model ID không hợp lệ." }, { status: 400 });
    }
    const status = (await getCodingAgentCliStatuses()).find((item) => item.id === agent);
    if (!status?.available) return NextResponse.json({ message: "Chưa tìm thấy CLI đã chọn trên máy chạy StoryAI." }, { status: 409 });
    const selectedModel = status.models.find((item) => item.id === model);
    if (model && !selectedModel && speed === "fast") return NextResponse.json({ message: "Không thể xác nhận model tùy chỉnh có hỗ trợ Fast. Chọn model trong danh sách để dùng Fast." }, { status: 400 });
    if (speed === "fast" && selectedModel && !selectedModel.speedTiers?.includes("fast")) {
      return NextResponse.json({ message: "Model Code Agent đã chọn không hỗ trợ Fast." }, { status: 400 });
    }
    if (quality !== "auto" && selectedModel && selectedModel.reasoningEffortLevels?.length && !selectedModel.reasoningEffortLevels.includes(quality)) {
      return NextResponse.json({ message: "Mức chất lượng này không được model Code Agent đã chọn hỗ trợ." }, { status: 400 });
    }
    await saveCodingAgentPreference(ownerId, { agent, model, quality, speed });
    return NextResponse.json({ preference: { agent, model, quality, speed } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Không thể lưu cấu hình Code Agent." }, { status: 500 });
  }
}

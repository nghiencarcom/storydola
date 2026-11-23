export type DramaWriterAgent = "codex" | "claude" | "antigravity";
export type DramaWriterAgentStatus = { id: DramaWriterAgent; label: string; available: boolean };
export type DramaSourceJobInput = {
  projectTitle: string;
  brief: string;
  durationMinutes: number;
  chunkSize: number;
  language: string;
  contentGenre: string;
  secondaryGenres: string[];
  storySetting: string;
  settingNotes: string;
  visualStyle: string;
  imageStyle: string;
  aspectRatio: string;
};
export type DramaSourceJobResult = { sourceText: string; plan: unknown; model: string };

export async function fetchDramaWriterAgents(): Promise<DramaWriterAgentStatus[]> {
  const response = await fetch("/api/agent-access/cli-status", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload.agents)) throw new Error(payload.message || "Không kiểm tra được coding agent trên máy này.");
  return payload.agents as DramaWriterAgentStatus[];
}

async function readResponse(response: Response, description: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
    return payload as Record<string, unknown>;
  } catch {
    throw new Error(response.ok
      ? `${description} trả phản hồi không hợp lệ (HTTP ${response.status}).`
      : `${description} trả HTTP ${response.status} nhưng không có chi tiết lỗi.`);
  }
}

export async function requestDramaSource(
  input: DramaSourceJobInput,
  writerAgent: DramaWriterAgent,
  onStage: (stage: string) => void,
): Promise<DramaSourceJobResult> {
  const response = await fetch("/api/story-script/drama-source", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, writerAgent }),
  });
  const accepted = await readResponse(response, "Máy chủ StoryAI");
  if (!response.ok) throw new Error(typeof accepted.message === "string" ? accepted.message : `Máy chủ StoryAI trả lỗi HTTP ${response.status}.`);
  if (typeof accepted.jobId !== "string" || accepted.status !== "running") {
    throw new Error(typeof accepted.message === "string" ? accepted.message : "Máy chủ chưa nhận được yêu cầu viết kịch bản.");
  }

  const jobId = accepted.jobId;
  const startedAt = Date.now();
  let consecutivePollFailures = 0;
  while (Date.now() - startedAt < 75 * 60_000) {
    await new Promise((resolve) => window.setTimeout(resolve, consecutivePollFailures ? 5_000 : 2_500));
    try {
      const pollResponse = await fetch(`/api/story-script/drama-source?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      if (pollResponse.status >= 500) {
        consecutivePollFailures += 1;
        onStage("Đang kết nối lại để nhận kết quả từ coding agent…");
        continue;
      }
      const poll = await readResponse(pollResponse, "Trạng thái tạo kịch bản");
      if (!pollResponse.ok) throw new Error(typeof poll.message === "string" ? poll.message : `Không lấy được trạng thái job (HTTP ${pollResponse.status}).`);
      consecutivePollFailures = 0;
      if (typeof poll.stage === "string") onStage(poll.stage);
      if (poll.status === "failed") throw new Error(typeof poll.message === "string" ? poll.message : "Coding agent không tạo được kịch bản.");
      if (poll.status === "completed") {
        if (typeof poll.sourceText !== "string" || !poll.plan) throw new Error("Job đã xong nhưng không trả đủ kịch bản nguồn.");
        return { sourceText: poll.sourceText, plan: poll.plan, model: typeof poll.model === "string" ? poll.model : writerAgent };
      }
      if (poll.status !== "running") throw new Error("Máy chủ trả trạng thái job kịch bản không hợp lệ.");
    } catch (cause) {
      if (cause instanceof TypeError && /fetch|network|terminated/i.test(cause.message)) {
        consecutivePollFailures += 1;
        onStage("Đang kết nối lại để nhận kết quả từ coding agent…");
        continue;
      }
      throw cause;
    }
  }
  throw new Error("Đã chờ coding agent quá lâu; kiểm tra log StoryAI rồi thử lại.");
}

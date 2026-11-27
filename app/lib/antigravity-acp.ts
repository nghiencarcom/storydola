import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

type AgentImage = { type: "image"; data: string; mimeType: string };
type AcpMessage = {
  id?: number | string;
  method?: string;
  error?: { message?: string };
  result?: {
    protocolVersion?: number;
    agentCapabilities?: { promptCapabilities?: { image?: boolean } };
    sessionId?: string;
    stopReason?: string;
  };
  params?: { update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } };
};

export function runAntigravityImages(input: {
  executable: string; requiresShell: boolean; cwd: string; env: NodeJS.ProcessEnv;
  model: string; quality: string; prompt: string; images: AgentImage[];
}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(input.executable, ["acp", "--sandbox", "--include-default-customizations=false"], {
      cwd: input.cwd, env: input.env, shell: input.requiresShell, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });
    const pending = new Map<number, { next: (result: NonNullable<AcpMessage["result"]>) => void; ignoreError?: boolean }>();
    let id = 0;
    let sessionId = "";
    let response = "";
    let finished = false;
    const timer = setTimeout(() => done(new Error("AGENT_RUN_TIMEOUT")), 15 * 60_000);

    function done(error?: Error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 4_000).unref();
      }
      if (error) reject(error);
      else resolve(response);
    }

    function send(message: Record<string, unknown>) {
      if (!finished) child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
    }

    function request(method: string, params: Record<string, unknown>, next: (result: NonNullable<AcpMessage["result"]>) => void, ignoreError = false) {
      pending.set(++id, { next, ignoreError });
      send({ id, method, params });
    }

    function prompt() {
      request("session/prompt", {
        sessionId, prompt: [{ type: "text", text: input.prompt }, ...input.images],
      }, (result) => {
        if (/individual quota reached/iu.test(response)) {
          const error = new Error("AGENT_QUOTA_EXCEEDED");
          error.name = "AGENT_QUOTA_EXCEEDED";
          done(error);
          return;
        }
        done(result.stopReason === "end_turn" && response.trim() ? undefined
          : new Error(`AGENT_RUN_FAILED: Antigravity kết thúc với ${result.stopReason || "phản hồi trống"}.`));
      });
    }

    function configureQuality() {
      if (input.quality === "auto") return prompt();
      request("session/set_config_option", { sessionId, configId: "thought_level", value: input.quality }, prompt, true);
    }

    function configureModel() {
      if (!input.model) return configureQuality();
      request("session/set_model", { sessionId, modelId: input.model }, configureQuality);
    }

    lines.on("line", (line) => {
      if (finished) return;
      let message: AcpMessage;
      try { message = JSON.parse(line); } catch { return; }
      if (message.method === "session/update") {
        const update = message.params?.update;
        if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
          response += update.content.text || "";
          if (response.length > 6_000_000) done(new Error("AGENT_OUTPUT_TOO_LARGE"));
        }
        return;
      }
      if (message.method && message.id !== undefined) {
        if (message.method === "session/request_permission") {
          send({ id: message.id, result: { outcome: { outcome: "cancelled" } } });
        } else {
          send({ id: message.id, error: { code: -32601, message: "This StoryAI session has no client tools." } });
        }
        return;
      }
      if (typeof message.id !== "number") return;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) {
        if (entry.ignoreError) {
          entry.next({});
          return;
        }
        done(new Error(`AGENT_RUN_FAILED: ${message.error.message || "Antigravity ACP error"}`));
        return;
      }
      entry.next(message.result || {});
    });
    child.stderr.resume();
    child.stdin.on("error", (cause) => done(cause));
    child.on("error", (cause) => done(cause));
    child.on("close", () => done(new Error("AGENT_RUN_FAILED: Antigravity ACP đã đóng kết nối.")));

    request("initialize", { protocolVersion: 1, clientCapabilities: {} }, (initialized) => {
      if (initialized.protocolVersion !== 1 || !initialized.agentCapabilities?.promptCapabilities?.image) {
        done(new Error("AGENT_IMAGE_INPUT_UNSUPPORTED: Hãy cập nhật Antigravity hoặc chọn model hỗ trợ ảnh."));
        return;
      }
      request("session/new", { cwd: input.cwd, mcpServers: [] }, (session) => {
        if (!session.sessionId) return done(new Error("AGENT_RUN_FAILED: Antigravity không tạo được phiên."));
        sessionId = session.sessionId;
        configureModel();
      });
    });
  });
}

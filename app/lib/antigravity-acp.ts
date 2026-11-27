import { spawn, type ChildProcessByStdio } from "node:child_process";
import { tmpdir } from "node:os";
import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";

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
  params?: { sessionId?: string; update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } };
};

const maxIdlePerKey = 4;
const idleTtlMs = 90_000;

class AcpWorker {
  readonly poolKey: string;
  private readonly child: ChildProcessByStdio<Writable, Readable, null>;
  private readonly lines: Interface;
  private readonly pending = new Map<number, { next: (result: NonNullable<AcpMessage["result"]>) => void; ignoreError?: boolean }>();
  private readonly ready: Promise<void>;
  private nextId = 0;
  private destroyed = false;
  private busy = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private activeSession: {
    sessionId: string;
    onChunk: (text: string) => void;
    onFatal: (error: Error) => void;
  } | null = null;
  private initReject?: (error: Error) => void;

  constructor(poolKey: string, executable: string, requiresShell: boolean, env: NodeJS.ProcessEnv) {
    this.poolKey = poolKey;
    this.child = spawn(executable, ["acp", "--sandbox", "--include-default-customizations=false"], {
      cwd: tmpdir(), env, shell: requiresShell, windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    this.child.stdin.on("error", (cause) => this.destroy(cause));
    this.child.on("error", (cause) => this.destroy(cause));
    this.child.on("close", () => this.destroy(new Error("AGENT_RUN_FAILED: Antigravity ACP đã đóng kết nối.")));

    this.ready = new Promise<void>((resolve, reject) => {
      this.initReject = reject;
      this.request("initialize", { protocolVersion: 1, clientCapabilities: {} }, (initialized) => {
        if (initialized.protocolVersion !== 1 || !initialized.agentCapabilities?.promptCapabilities?.image) {
          const err = new Error("AGENT_IMAGE_INPUT_UNSUPPORTED: Hãy cập nhật Antigravity hoặc chọn model hỗ trợ ảnh.");
          this.destroy(err);
          reject(err);
          return;
        }
        this.initReject = undefined;
        resolve();
      });
    });
  }

  get isUsable() {
    return !this.destroyed && !this.busy && this.child.exitCode === null && this.child.signalCode === null;
  }

  private send(message: Record<string, unknown>) {
    if (!this.destroyed) {
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    }
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    next: (result: NonNullable<AcpMessage["result"]>) => void,
    ignoreError = false,
  ) {
    if (this.destroyed) return;
    const id = ++this.nextId;
    this.pending.set(id, { next, ignoreError });
    this.send({ id, method, params });
  }

  private handleLine(line: string) {
    if (this.destroyed) return;
    let message: AcpMessage;
    try { message = JSON.parse(line); } catch { return; }
    if (message.method === "session/update") {
      const update = message.params?.update;
      const incomingSessionId = message.params?.sessionId;
      if (this.activeSession && (!incomingSessionId || incomingSessionId === this.activeSession.sessionId)
        && update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
        this.activeSession.onChunk(update.content.text || "");
      }
      return;
    }
    if (message.method && message.id !== undefined) {
      if (message.method === "session/request_permission") {
        this.send({ id: message.id, result: { outcome: { outcome: "cancelled" } } });
      } else {
        this.send({ id: message.id, error: { code: -32601, message: "This StoryAI session has no client tools." } });
      }
      return;
    }
    if (typeof message.id !== "number") return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    if (message.error) {
      if (entry.ignoreError) {
        entry.next({});
        return;
      }
      const err = new Error(`AGENT_RUN_FAILED: ${message.error.message || "Antigravity ACP error"}`);
      if (this.activeSession) {
        this.activeSession.onFatal(err);
      } else {
        this.destroy(err);
      }
      return;
    }
    entry.next(message.result || {});
  }

  destroy(reason?: Error) {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    const list = idlePool.get(this.poolKey);
    if (list) {
      const idx = list.indexOf(this);
      if (idx >= 0) list.splice(idx, 1);
      if (!list.length) idlePool.delete(this.poolKey);
    }
    this.pending.clear();
    const session = this.activeSession;
    this.activeSession = null;
    const err = reason || new Error("AGENT_RUN_FAILED: Antigravity ACP đã đóng kết nối.");
    this.initReject?.(err);
    this.initReject = undefined;
    session?.onFatal(err);
    this.lines.close();
    this.child.stdin.end();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGTERM");
      setTimeout(() => {
        if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL");
      }, 4_000).unref?.();
    }
  }

  armIdleTimer() {
    if (this.destroyed) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.destroy(), idleTtlMs);
    this.idleTimer.unref?.();
  }

  async runSession(input: { cwd: string; model: string; quality: string; prompt: string; images: AgentImage[] }): Promise<string> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    this.busy = true;
    await this.ready;
    if (this.destroyed) throw new Error("AGENT_RUN_FAILED: Antigravity ACP đã đóng kết nối.");

    return new Promise<string>((resolve, reject) => {
      let response = "";
      let settled = false;
      let sessionId = "";
      const timer = setTimeout(() => finish(new Error("AGENT_RUN_TIMEOUT")), 15 * 60_000);
      timer.unref?.();

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.activeSession = null;
        this.busy = false;
        if (error) {
          this.destroy(error);
          reject(error);
          return;
        }
        releaseWorker(this);
        resolve(response);
      };

      const sendPrompt = () => {
        this.request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: input.prompt }, ...input.images],
        }, (result) => {
          if (/individual quota reached/iu.test(response)) {
            const error = new Error("AGENT_QUOTA_EXCEEDED");
            error.name = "AGENT_QUOTA_EXCEEDED";
            finish(error);
            return;
          }
          finish(result.stopReason === "end_turn" && response.trim()
            ? undefined
            : new Error(`AGENT_RUN_FAILED: Antigravity kết thúc với ${result.stopReason || "phản hồi trống"}.`));
        });
      };

      const configureQuality = () => {
        if (!input.quality || input.quality === "auto") return sendPrompt();
        this.request("session/set_config_option", { sessionId, configId: "thought_level", value: input.quality }, sendPrompt, true);
      };

      const configureModel = () => {
        if (!input.model) return configureQuality();
        this.request("session/set_model", { sessionId, modelId: input.model }, configureQuality);
      };

      this.activeSession = {
        sessionId: "",
        onChunk: (text) => {
          response += text;
          if (response.length > 6_000_000) finish(new Error("AGENT_OUTPUT_TOO_LARGE"));
        },
        onFatal: (err) => finish(err),
      };

      this.request("session/new", { cwd: input.cwd, mcpServers: [] }, (session) => {
        if (!session.sessionId) {
          finish(new Error("AGENT_RUN_FAILED: Antigravity không tạo được phiên."));
          return;
        }
        sessionId = session.sessionId;
        if (this.activeSession) this.activeSession.sessionId = sessionId;
        configureModel();
      });
    });
  }
}

const idlePool = new Map<string, AcpWorker[]>();

function envFingerprint(env: NodeJS.ProcessEnv): string {
  const keys = ["PATH", "HOME", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "HTTPS_PROXY", "HTTP_PROXY"];
  return keys.map((key) => `${key}=${env[key] || ""}`).join("|");
}

function acquireWorker(input: { executable: string; requiresShell: boolean; env: NodeJS.ProcessEnv }): AcpWorker {
  const key = `${input.executable}\0${input.requiresShell ? 1 : 0}\0${envFingerprint(input.env)}`;
  const list = idlePool.get(key);
  while (list?.length) {
    const candidate = list.pop()!;
    if (!list.length) idlePool.delete(key);
    if (candidate.isUsable) return candidate;
  }
  return new AcpWorker(key, input.executable, input.requiresShell, input.env);
}

function releaseWorker(worker: AcpWorker) {
  if (!worker.isUsable) {
    worker.destroy();
    return;
  }
  const list = idlePool.get(worker.poolKey) ?? [];
  if (list.length >= maxIdlePerKey) {
    worker.destroy();
    return;
  }
  worker.armIdleTimer();
  list.push(worker);
  idlePool.set(worker.poolKey, list);
}

export function runAntigravityImages(input: {
  executable: string; requiresShell: boolean; cwd: string; env: NodeJS.ProcessEnv;
  model: string; quality: string; prompt: string; images: AgentImage[];
}) {
  const worker = acquireWorker(input);
  return worker.runSession({
    cwd: input.cwd,
    model: input.model,
    quality: input.quality,
    prompt: input.prompt,
    images: input.images,
  });
}

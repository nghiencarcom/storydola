const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { promisify } = require("node:util");
const { createLogger, supervise } = require("./studio-supervisor.cjs");
const { shouldRestartGateway } = require("./gateway-restart-policy.cjs");

const execFileAsync = promisify(execFile);

const rootDir = path.resolve(__dirname, "..");
const production = process.argv.includes("--production");
const skipGateway = process.env.DOLA_SKIP_GATEWAY === "1";
const skipStudioUi = process.env.DOLA_SKIP_STUDIO === "1";
const modeLabel = production ? "start" : "dev";
const logFile = path.join(rootDir, "logs", `studio-${modeLabel}.log`);
const log = createLogger(logFile);
log(`Launcher started pid=${process.pid} mode=${modeLabel}`);
const defaultStudioPort = production ? 3007 : 3107;
const otherModeStudioPort = production ? 3107 : 3007;
const studioPort = Number(process.env.DOLA_STUDIO_PORT || defaultStudioPort);
const gatewayPort = Number(process.env.DOLA_GATEWAY_PORT || process.env.DOLA_PORT || 8200);
// Restarting the selected Studio listener is opt-in. The Gateway is shared.
const clearOldPorts = process.env.DOLA_CLEAR_OLD_PORTS === "1";
// Production always restarts the owned Gateway. Dev only reloads an idle
// stale Gateway when explicitly requested.
const autoRestartStaleGateway = process.env.DOLA_RESTART_STALE_GATEWAY === "1";
// Accepted conversations are durable and startup recovery resumes polling.
// This second opt-in permits reloading while those persisted jobs are active.
const restartStaleGatewayWithPendingTasks =
  process.env.DOLA_RESTART_STALE_GATEWAY_WITH_PENDING === "1";
const gatewayDir = path.resolve(
  process.env.DOLA_GATEWAY_DIR || path.join(rootDir, "dola-render-gateway")
);
const nextBin = path.join(rootDir, "node_modules", "next", "dist", "bin", "next");
const gatewayScript = path.join(gatewayDir, "start_server.sh");
const gatewayPython = path.join(
  gatewayDir,
  ".venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python"
);
const gatewayPythonNoConsole = process.platform === "win32"
  ? path.join(path.dirname(gatewayPython), "pythonw.exe")
  : gatewayPython;
const launcherScript = path.join(rootDir, "scripts", "dev.js").toLowerCase();

if (!fs.existsSync(nextBin)) {
  console.error("Không tìm thấy Next.js. Hãy chạy npm install trong Dola.");
  process.exit(1);
}
if (!skipGateway) {
  if (process.platform === "win32" && !fs.existsSync(gatewayPython)) {
    console.error("Không tìm thấy Python environment của Dola Gateway tại " + gatewayPython);
    console.error("Cài Python 3.11+ và chạy npm run setup:local trước khi dùng npm start.");
    process.exit(1);
  }
  if (process.platform !== "win32" && !fs.existsSync(gatewayScript)) {
    console.error("Không tìm thấy Dola Gateway tại " + gatewayScript);
    console.error("Đặt DOLA_GATEWAY_DIR nếu Gateway nằm ở thư mục khác.");
    process.exit(1);
  }
}

const children = [];
let shuttingDown = false;

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

async function portListeners(port) {
  // The existing stale-listener ownership checks below depend on lsof/ps.
  // Windows startup still probes the port directly and reuses a healthy
  // Gateway; skip the unsupported Unix PID lookup instead of logging noise.
  if (process.platform === "win32") return [];
  // lsof is available on macOS/Linux and lets us terminate the old listener
  // instead of relying on a fixed PID.  An empty result means the port is free.
  try {
    const result = await execFileAsync("lsof", [
      "-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"
    ], { encoding: "utf8" });
    return [...new Set(String(result.stdout || "")
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((pid) => Number.isInteger(pid) && pid > 1))];
  } catch (error) {
    // lsof exits with code 1 when no process owns the port.
    if (error?.code !== 1) {
      console.warn(`[Dola ${production ? "start" : "dev"}] Không đọc được tiến trình ở cổng ${port}: ${error.message}`);
    }
    return [];
  }
}

async function processInfo(pid) {
  try {
    const result = await execFileAsync("ps", ["-p", String(pid), "-o", "ppid=,command="], {
      encoding: "utf8"
    });
    const line = String(result.stdout || "").trim();
    const match = line.match(/^(\d+)\s+(.*)$/);
    return match ? { pid, ppid: Number(match[1]), command: match[2] } : null;
  } catch {
    return null;
  }
}

function isDolaProcess(port, command) {
  const text = String(command || "").toLowerCase();
  if (port === studioPort) {
    return text.includes(rootDir.toLowerCase())
      || text.includes("next-server")
      || text.includes("next dev")
      || text.includes("npm run dev")
      || text.includes("scripts/dev.js");
  }
  return text.includes(gatewayDir.toLowerCase())
    || text.includes("start_server.sh")
    || text.includes("uvicorn")
    || text.includes("server:app");
}

async function processChain(pid) {
  const chain = [];
  const seen = new Set();
  let current = pid;
  while (current > 1 && !seen.has(current)) {
    seen.add(current);
    const info = await processInfo(current);
    if (!info) break;
    chain.push(info);
    current = info.ppid;
  }
  return chain;
}

async function clearPort(port) {
  const listeners = await portListeners(port);
  if (!listeners.length) return;

  const targets = new Set();
  for (const listener of listeners) {
    const chain = await processChain(listener);
    const owned = await execFileAsync("lsof", ["-a", "-p", String(listener), "-d", "cwd", "-Fn"]);
    if (!String(owned.stdout).split("\n").includes(`n${rootDir}`)) {
      throw new Error(`Cổng ${port} thuộc tiến trình ngoài workspace; không tự dừng PID ${listener}`);
    }
    // If the listener belongs to another Dola launcher, signal the launcher
    // rather than killing next-server directly. The launcher then shuts down
    // its child in order, preventing the old launcher from reporting the
    // intentional SIGTERM as a Next.js crash (exit code 143).
    const launcher = chain.find((info) => info.pid !== process.pid
      && isDolaProcess(port, info.command)
      && (info.command.toLowerCase().includes(launcherScript)
        || /\bnode\s+scripts\/dev\.js(?:\s|$)/.test(info.command)));
    if (launcher) {
      targets.add(launcher.pid);
    } else if (listener !== process.pid) {
      // Standalone next start processes have no launcher to notify.
      targets.add(listener);
    }
  }

  const targetList = [...targets];
  console.log(`[Dola ${modeLabel}] Dọn tiến trình cũ ở cổng ${port}: ${targetList.join(", ")}`);
  for (const pid of targetList) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") {
        console.warn(`[Dola ${modeLabel}] Không thể dừng PID ${pid}: ${error.message}`);
      }
    }
  }

  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && await isPortOpen(port)) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  // Never force-kill a listener, which may now belong to another launcher.
  const remaining = await portListeners(port);
  if (remaining.length) {
    throw new Error(`Cổng ${port} chưa được giải phóng; không dùng SIGKILL để tránh mất dữ liệu.`);
  }

  if (await isPortOpen(port)) {
    throw new Error(`Không thể giải phóng cổng ${port}`);
  }
}

function start(command, args, options) {
  const shared = options.shared === true;
  if (!shared && options.required) {
    const supervisor = supervise({
      command, args, cwd: options.cwd,
      env: { ...process.env, ...options.env }, log,
      portBusy: () => isPortOpen(studioPort), onFailure: shutdown,
    });
    children.push(supervisor);
    console.log(`[Dola ${modeLabel}] Log và tự khởi động lại Next.js: ${logFile}`);
    return supervisor;
  }
  let logFd = null;
  if (options.logFile) {
    fs.mkdirSync(path.dirname(options.logFile), { recursive: true });
    logFd = fs.openSync(options.logFile, "a");
  }
  let child;
  try {
    child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
      // The shared Gateway is a background service on Windows; do not open a
      // separate console window for its Python process.
      windowsHide: process.platform === "win32",
      // Gateway is a shared local service. Detach it so Ctrl+C/restarts of one
      // Studio launcher cannot terminate the Gateway used by the other mode.
      ...(shared
        ? { detached: true, stdio: logFd === null ? "ignore" : ["ignore", logFd, logFd] }
        : { stdio: "inherit" })
    });
  } finally {
    if (logFd !== null) fs.closeSync(logFd);
  }
  if (!shared) children.push(child);
  if (shared) child.unref();
  child.on("error", (error) => {
    console.error("[Dola " + modeLabel + "] Không thể khởi động tiến trình:", error.message);
    if (options.required && !shared && !shuttingDown) shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (shared) {
      // Two launchers can observe port 8200 as free at the same time. If the
      // other launcher won the bind race, keep this Studio alive and reuse
      // that Gateway instead of shutting down the whole workspace.
      void isPortOpen(options.port).then((portOpen) => {
        if (portOpen) {
          console.warn(`[Dola ${modeLabel}] ${options.label} đã được launcher khác khởi động; tiếp tục dùng cổng ${options.port}.`);
        } else {
          const reason = signal ? "signal " + signal : "mã " + (code ?? 1);
          console.error(`[Dola ${modeLabel}] ${options.label} đã dừng (${reason}); Studio vẫn được giữ để không ảnh hưởng chế độ còn lại.`);
        }
      });
      return;
    }
    const reason = signal ? "signal " + signal : "mã " + (code ?? 1);
    // Intentional launcher shutdown is handled above by shuttingDown.
    // A child receiving SIGTERM independently is an unexpected interruption.
    console.error("[Dola " + modeLabel + "] " + options.label + " đã dừng (" + reason + ").");
    if (options.required) shutdown(code || 1);
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Launcher shutdown pid=${process.pid} code=${code}`);
  for (const child of children) {
    if (child.stop) { child.stop(); continue; }
    if (!child.killed && child.exitCode === null) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 250);
}

function gatewayStartOptions() {
  return {
    cwd: gatewayDir,
    label: "Dola Gateway",
    // Standalone Studio runs can share a detached Gateway. The integrated
    // StoryDola launcher sets this to 0 so it owns and stops the Gateway.
    shared: process.env.DOLA_GATEWAY_DETACHED !== "0",
    port: gatewayPort,
    env: {
      DOLA_PORT: String(gatewayPort),
      DOLA_GATEWAY_PORT: String(gatewayPort),
      DOLA_HOST: "127.0.0.1",
      ...(process.platform === "win32"
        ? { DOLA_GATEWAY_LOG_FILE: path.join(gatewayDir, "dola-gateway.log") }
        : {}),
      // The Gateway is shared with production. Allow a dev reload to keep its
      // media proxy pointed at the already-running Studio when needed.
      DOLA_STUDIO_URL: process.env.DOLA_GATEWAY_STUDIO_URL
        || (skipStudioUi ? process.env.STORYAI_LOCAL_URL : `http://127.0.0.1:${studioPort}`)
        || `http://127.0.0.1:${studioPort}`,
    },
    ...(process.platform === "win32"
      ? { logFile: path.join(gatewayDir, "dola-gateway.log") }
      : {}),
  };
}

function startGateway() {
  const options = gatewayStartOptions();
  if (process.platform === "win32") {
    const pythonExecutable = fs.existsSync(gatewayPythonNoConsole)
      ? gatewayPythonNoConsole
      : gatewayPython;
    const pythonCommand = [
      "import os, sys",
      'sys.stdout = open(os.environ["DOLA_GATEWAY_LOG_FILE"], "a", encoding="utf-8", buffering=1)',
      "sys.stderr = sys.stdout",
      "import config, uvicorn",
      'uvicorn.run("server:app", host=config.HOST, port=config.PORT)',
    ].join("; ");
    start(pythonExecutable, [
      "-c",
      pythonCommand,
    ], options);
    return;
  }
  start(gatewayScript, [], options);
}

async function isOwnedGatewayListener(pid) {
  const gatewayText = gatewayDir.toLowerCase();
  const chain = await processChain(pid);
  if (chain.some((info) => String(info.command || "").toLowerCase().includes(gatewayText))) {
    return true;
  }
  try {
    const result = await execFileAsync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
    });
    return String(result.stdout || "")
      .split("\n")
      .filter((line) => line.startsWith("n"))
      .map((line) => path.resolve(line.slice(1)))
      .some((cwd) => cwd === gatewayDir);
  } catch {
    return false;
  }
}

async function stopGateway(listeners) {
  for (const { pid } of listeners) {
    if (!await isOwnedGatewayListener(pid)) {
      throw new Error(`Cổng Gateway ${gatewayPort} thuộc tiến trình ngoài workspace; không tự dừng PID ${pid}`);
    }
  }

  const pids = [...new Set(listeners.map(({ pid }) => pid))];
  console.log(`[Dola ${modeLabel}] Khởi động lại Gateway PID ${pids.join(", ")} để nạp mã Python và cấu hình mới.`);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") {
        throw new Error(`Không thể dừng Gateway PID ${pid}: ${error.message}`);
      }
    }
  }

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && await isPortOpen(gatewayPort)) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const remaining = await portListeners(gatewayPort);
  if (remaining.length) {
    throw new Error(`Gateway cũ chưa giải phóng cổng ${gatewayPort}; không dùng SIGKILL để tránh mất dữ liệu.`);
  }
}

async function waitForGatewayHealthy() {
  const deadline = Date.now() + 60000;
  let latestHealth = null;
  while (Date.now() < deadline) {
    // Readiness must not enumerate every profile. Keep the old detailed
    // endpoint as a compatibility fallback for an already-running Gateway
    // that predates /health/ready.
    for (const path of ["/health/ready", "/health"]) {
      try {
        const response = await fetch(`http://127.0.0.1:${gatewayPort}${path}`, {
          signal: AbortSignal.timeout(2000),
        });
        const health = await response.json();
        if (response.ok && health.ok === true && typeof health.pending_tasks === "number") {
          latestHealth = health;
          break;
        }
      } catch { /* Startup may still be in progress. */ }
    }
    if (latestHealth) {
      break;
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch {
      // Keep the retry loop resilient if the launcher is shutting down.
      break;
    }
  }
  if (!latestHealth) {
    throw new Error(`Gateway ${gatewayPort} không healthy. Xem ${gatewayDir}/dola-gateway.log; các tiến trình cũ được giữ nguyên.`);
  }
  return latestHealth;
}

async function staleGatewayListeners() {
  const stale = [];
  for (const pid of await portListeners(gatewayPort)) {
    const result = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="], {
      env: { ...process.env, LC_ALL: "C" },
    });
    const started = Date.parse(String(result.stdout).trim());
    if (!Number.isFinite(started)) throw new Error("Không xác định được phiên bản Gateway đang chạy.");
    const sources = fs.readdirSync(gatewayDir).filter((name) =>
      name.endsWith(".py") || name === ".env" || name === ".env.local"
    );
    const changedSources = sources.filter((name) =>
      fs.statSync(path.join(gatewayDir, name)).mtimeMs > started + 1000
    );
    if (changedSources.length) stale.push({ pid, sources: changedSources });
  }
  return stale;
}

process.on("SIGINT", () => { log("Launcher received SIGINT"); shutdown(0); });
process.on("SIGTERM", () => { log("Launcher received SIGTERM"); shutdown(0); });
process.on("SIGHUP", () => { log("Launcher received SIGHUP (terminal closed)"); shutdown(0); });

async function main() {
  if (skipGateway) {
    console.log(`[Dola ${modeLabel}] Bỏ qua Gateway theo DOLA_SKIP_GATEWAY=1.`);
  } else {
    await ensureGateway();
  }
  if (skipStudioUi) {
    const storyUrl = process.env.STORYAI_LOCAL_URL || `http://127.0.0.1:${process.env.STORYAI_PORT || 3021}`;
    console.log(`[Dola ${modeLabel}] Giao diện được cung cấp bởi StoryAI tại ${storyUrl}; chỉ chạy Gateway trên cổng ${gatewayPort}.`);
    setInterval(() => {
      void isPortOpen(gatewayPort).then((open) => {
        if (!open && !shuttingDown) {
          console.error(`[Dola ${modeLabel}] Gateway đã dừng; đóng launcher để workspace có thể khởi động lại.`);
          shutdown(1);
        }
      });
    }, 5000);
    return;
  }
  // Only clear the selected Studio port when explicitly requested.
  if (clearOldPorts) {
    if (studioPort === otherModeStudioPort) {
      // A custom port must not allow one mode to clear the other mode's
      // default listener. This is the exact cross-mode failure we want to
      // prevent when a shell accidentally retains DOLA_CLEAR_OLD_PORTS=1.
      console.warn(`[Dola ${modeLabel}] Bỏ qua dọn cổng ${studioPort} vì đây là cổng mặc định của chế độ ${production ? "dev" : "production"}; giữ listener hiện tại.`);
    } else {
      await clearPort(studioPort);
    }
    // The account pool and Gateway are shared with the other mode; never
    // terminate them from this launcher.
  }

  const studioPortBusy = await isPortOpen(studioPort);
  if (studioPortBusy) {
    if (studioPort === otherModeStudioPort) {
      console.error(`[Dola ${modeLabel}] Cổng Studio ${studioPort} đang là cổng mặc định của chế độ ${production ? "dev" : "production"}. Không dừng hoặc chiếm listener đó; hãy dùng cổng mặc định riêng (${defaultStudioPort}).`);
      process.exitCode = 1;
      return;
    }
    console.log("[Dola " + (production ? "start" : "dev") + `] Port ${studioPort} đã có Studio, giữ nguyên listener hiện tại.`);
  } else {
    const nextArgs = production
      ? [nextBin, "start", "-p", String(studioPort)]
      : [nextBin, "dev", "--webpack", "-H", "127.0.0.1", "-p", String(studioPort)];
    console.log("[Dola " + (production ? "start" : "dev") + `] Starting Next.js on http://127.0.0.1:${studioPort}`);
    start(process.execPath, nextArgs, {
      cwd: rootDir,
      label: "Next.js",
      required: true,
      env: {
        NEXT_DIST_DIR: production ? (process.env.NEXT_DIST_DIR || ".next-production") : ".next-dev",
        DOLA_GATEWAY_URL: process.env.DOLA_GATEWAY_URL || `http://127.0.0.1:${gatewayPort}`,
      }
    });
  }

  if (!children.length) process.exit(0);
}

async function ensureGateway() {
  const gatewayAlreadyRunning = await isPortOpen(gatewayPort);
  let health;
  if (gatewayAlreadyRunning) {
    if (production) {
      // Production reloads the shared Gateway even with accepted work in
      // flight. Task state is durable and startup recovery resumes accepted
      // conversations by polling after the new process is healthy.
      health = await waitForGatewayHealthy();
      if (shouldRestartGateway({
        production,
        pendingTasks: health.pending_tasks,
        autoRestartStaleGateway,
        restartWithPendingTasks: restartStaleGatewayWithPendingTasks,
      })) {
        const listeners = (await portListeners(gatewayPort)).map(pid => ({pid}));
        await stopGateway(listeners);
        startGateway();
        health = await waitForGatewayHealthy();
      }
    } else {
      console.log(`[Dola dev] Port ${gatewayPort} đã có Gateway, dùng lại tiến trình hiện tại.`);
      health = await waitForGatewayHealthy();
    }
  } else {
    console.log("[Dola " + (production ? "start" : "dev") + `] Starting Dola Gateway on http://127.0.0.1:${gatewayPort}`);
    startGateway();
    health = await waitForGatewayHealthy();
  }

  // A shared Gateway may have been launched by dev with another media origin.
  // Environment changes require a restart even when Python source is unchanged.
  const expectedStudioUrl = `http://127.0.0.1:${studioPort}`;
  if (production && health.studio_url && health.studio_url !== expectedStudioUrl) {
    if (shouldRestartGateway({
      production,
      pendingTasks: health.pending_tasks,
      autoRestartStaleGateway,
      restartWithPendingTasks: restartStaleGatewayWithPendingTasks,
    })) {
      const listeners = (await portListeners(gatewayPort)).map(pid => ({pid}));
      await stopGateway(listeners);
      startGateway();
      health = await waitForGatewayHealthy();
      if (health.studio_url !== expectedStudioUrl) throw new Error('Gateway chưa nạp đúng địa chỉ Studio production');
    }
  }
  // Compare source modification times with the actual listener start time,
  // including legacy Gateways that do not expose a build/version endpoint.
  let stale = await staleGatewayListeners();
  if (stale.length) {
    const changed = [...new Set(stale.flatMap(({ sources }) => sources))];
    const pending = health.pending_tasks;
    if (shouldRestartGateway({
      production,
      pendingTasks: pending,
      autoRestartStaleGateway,
      restartWithPendingTasks: restartStaleGatewayWithPendingTasks,
    })) {
      await stopGateway(stale);
      startGateway();
      health = await waitForGatewayHealthy();
      stale = await staleGatewayListeners();
      if (stale.length) {
        const stillChanged = [...new Set(stale.flatMap(({ sources }) => sources))];
        throw new Error(`Gateway mới vẫn chưa nạp mã Python (${stillChanged.join(", ")}). Xem ${gatewayDir}/dola-gateway.log.`);
      }
    } else {
      const relaunchCommand = production ? "npm start" : "npm run dev";
      console.warn(`[Dola ${modeLabel}] Gateway đang chạy mã cũ (${changed.join(", ")}) và còn ${pending} task đang hoạt động; giữ nguyên để không gián đoạn task. Studio vẫn được khởi động, lần ${relaunchCommand} kế tiếp sẽ tự nạp mã mới khi Gateway idle.`);
    }
  }
  console.log(`[Dola ${modeLabel}] Gateway ${gatewayPort}: health OK (${health.pending_tasks} task đang hoạt động).`);
}

main().catch((error) => {
  log(`Launcher failure: ${error.stack || error.message}`);
  console.error("[Dola " + (production ? "start" : "dev") + "] Không thể khởi động workspace:", error.message);
  shutdown(1);
});

const { randomBytes } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { clearLocalPorts } = require("./clear-local-ports.cjs");

const root = path.resolve(__dirname, "..");
const dolaRoot = path.join(root, "dola-studio");
const requireFromRoot = createRequire(path.join(root, "package.json"));

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 20 || (nodeMajor === 20 && nodeMinor < 9)) {
  console.error(`Dự án cần Node.js 20.9 trở lên; máy hiện có Node.js ${process.versions.node}.`);
  process.exit(1);
}

const gatewayDir = path.join(dolaRoot, "dola-render-gateway");
const gatewayPython = path.join(gatewayDir, ".venv", "Scripts", "python.exe");
const requiredFiles = [
  [path.join(root, "node_modules", "next", "dist", "bin", "next"), "Dependency Node.js của StoryAI"],
  [path.join(dolaRoot, "node_modules", "next", "dist", "bin", "next"), "Dependency Node.js của Dola Studio"],
  ...(process.platform === "win32" ? [[gatewayPython, "Môi trường Python của Dola Gateway"]] : []),
];
const missingFiles = requiredFiles.filter(([file]) => !existsSync(file));
if (process.platform === "win32" && existsSync(gatewayPython)) {
  const pythonProbe = spawnSync(gatewayPython, [
    "-c",
    "import sys, fastapi, uvicorn, patchright; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)",
  ], { stdio: "ignore", windowsHide: true });
  if (pythonProbe.error || pythonProbe.status !== 0) {
    missingFiles.push([gatewayPython, "Dependency Python của Dola Gateway"]);
  }

  const browserExe = path.join(gatewayDir, "browsers", "chromium-1243", "chrome-win64", "chrome.exe");
  const browserMarker = path.join(gatewayDir, "browsers", "chromium-1243", "INSTALLATION_COMPLETE");
  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local");
  const cachedBrowser = path.join(localAppData, "ms-playwright", "chromium-1243", "chrome-win64", "chrome.exe");
  if (!(existsSync(browserExe) && existsSync(browserMarker)) && !existsSync(cachedBrowser)) {
    missingFiles.push([browserExe, "Chromium tương thích với Patchright"]);
  }
}
if (missingFiles.length) {
  console.error("Chưa cài đủ dependency để chạy ứng dụng:");
  for (const [, label] of missingFiles) console.error(`- ${label}`);
  console.error("Cài Node.js 20.9+ và Python 3.11+, rồi chạy npm run setup:local.");
  process.exit(1);
}

require("./prepare-local-config.cjs");

for (const rawLine of readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const splitAt = line.indexOf("=");
  const key = line.slice(0, splitAt).trim();
  const value = line.slice(splitAt + 1).trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted ?? "");
  if (key && process.env[key] === undefined) process.env[key] = value;
}

const storyPort = process.env.STORYAI_PORT || "3021";
const studioPort = process.env.DOLA_STUDIO_PORT || "3117";
const gatewayPort = process.env.DOLA_GATEWAY_PORT || "8210";
const gatewayAdminKey = process.env.DOLA_ADMIN_KEY?.trim()
  || process.env.DOLA_GATEWAY_ADMIN_KEY?.trim()
  || randomBytes(32).toString("hex");
const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
const storyUrl = process.env.STORYAI_LOCAL_BASE_URL || `http://127.0.0.1:${storyPort}`;
const windowsNative = process.platform === "win32";
const localFfmpegPath = path.join(root, "ffmpeg.exe");
const localFfprobePath = path.join(root, "ffprobe.exe");
const localFfmpegEnvironment = windowsNative && existsSync(localFfmpegPath)
  ? {
      DOLA_FFMPEG_BINARY: localFfmpegPath,
      STORYAI_FFMPEG_PATH: localFfmpegPath,
      ...(existsSync(localFfprobePath) ? { STORYAI_FFPROBE_PATH: localFfprobePath } : {}),
    }
  : {};
const npmExecPath = process.env.npm_execpath;
const dolaCommand = windowsNative && npmExecPath ? process.execPath : "npm";
const dolaArgs = windowsNative && npmExecPath
  ? [npmExecPath, "--prefix", dolaRoot, "run", "dev"]
  : ["--prefix", dolaRoot, "run", "dev"];

const storyNext = requireFromRoot.resolve("next/dist/bin/next");
const processes = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) {
    if (child.exitCode !== null || !child.pid) continue;

    if (windowsNative) {
      const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      if (!result.error && result.status === 0) continue;
    }

    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 300);
}

function start(label, command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env, stdio: "inherit" });
  processes.push(child);
  child.once("error", (error) => {
    console.error(`[${label}] ${error.message}`);
    stop(1);
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    if (code !== 0 || signal) {
      console.error(`[${label}] dừng (code=${code ?? "-"}, signal=${signal || "-"})`);
      stop(code || 1);
    }
  });
}

const baseEnv = {
  ...process.env,
  ...localFfmpegEnvironment,
  DOLA_GATEWAY_DETACHED: "0",
  DOLA_GATEWAY_PORT: gatewayPort,
  DOLA_PORT: gatewayPort,
  DOLA_GATEWAY_URL: gatewayUrl,
  STORYAI_SEEDANCE_GATEWAY_URL: gatewayUrl,
  DOLA_STUDIO_URL: storyUrl,
  DOLA_ADMIN_KEY: gatewayAdminKey,
  DOLA_GATEWAY_ADMIN_KEY: gatewayAdminKey,
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
process.on("SIGHUP", () => stop(0));

async function startWorkspace() {
  // Gateway 8210 is reserved for this app, so clear a stale listener even
  // when the previous copy ran from another folder. This also stops its tree.
  await clearLocalPorts([gatewayPort], root, { forceExternalPorts: [gatewayPort] });
  await clearLocalPorts([storyPort, studioPort], root);
  if (stopping) return;

  start("StoryAI", process.execPath, [storyNext, "dev", "-H", "127.0.0.1", "-p", storyPort], root, baseEnv);
  start("Dola Gateway", dolaCommand, dolaArgs, root, {
    ...baseEnv,
    STORYAI_LOCAL_URL: storyUrl,
    DOLA_GATEWAY_STUDIO_URL: storyUrl,
    DOLA_STUDIO_PORT: studioPort,
    DOLA_SKIP_STUDIO: "1",
    DOLA_GATEWAY_PORT: gatewayPort,
    DOLA_PORT: gatewayPort,
    DOLA_HOST: "127.0.0.1",
    DOLA_PUBLIC_BASE: gatewayUrl,
    DOLA_STUDIO_URL: storyUrl,
    DOLA_GATEWAY_DIR: path.join(dolaRoot, "dola-render-gateway"),
    DOLA_GATEWAY_URL: gatewayUrl,
    DOLA_CLEAR_OLD_PORTS: "0",
    DOLA_RESTART_STALE_GATEWAY: process.env.DOLA_RESTART_STALE_GATEWAY || "1",
    ...(windowsNative ? { NEXT_DIST_DIR: ".next-dev" } : {}),
  });

  console.log(`StoryAI + Dola Studio: ${storyUrl}`);
  console.log(`Dola Render Gateway: ${gatewayUrl}`);
}

startWorkspace().catch((error) => {
  console.error(`[Khởi động] ${error instanceof Error ? error.message : "Không thể dọn cổng cũ."}`);
  process.exitCode = 1;
});

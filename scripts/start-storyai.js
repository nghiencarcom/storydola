const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { ensureAntigravityVideoPlugins } = require("./ensure-antigravity-video-plugins.cjs");
const {
  resolveGitExecutable,
  resolveFfmpegExecutables,
  hasAntigravityAppInstalled,
  resolveAgyExecutable,
  fetchRemoteBranchSha,
  downloadAndExtractGitHubArchive,
  syncExtractedArchiveToProject,
} = require("./github-tarball.cjs");

const projectRoot = path.resolve(__dirname, "..");
const logsDir = path.join(projectRoot, "logs");
const logFile = path.join(logsDir, "storyai-supervisor.log");
const buildMarker = path.join(projectRoot, ".next", ".storyai-build-fingerprint");
const dependencyMarker = path.join(logsDir, "package-lock.sha256");
const archiveShaFile = path.join(logsDir, "github-archive-commit.sha");
const archiveManifestFile = path.join(logsDir, "github-archive-files.json");
const isWindows = process.platform === "win32";

process.chdir(projectRoot);
fs.mkdirSync(logsDir, { recursive: true });

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}${os.EOL}`;
  process.stdout.write(line);
  fs.appendFileSync(logFile, line);
}

function run(command, args, label) {
  log(label);
  const useCmdWrapper = isWindows && /\.(?:cmd|bat)$/i.test(command);
  const execCommand = useCmdWrapper ? (process.env.ComSpec || "cmd.exe") : command;
  const execArgs = useCmdWrapper ? ["/d", "/s", "/c", command, ...args] : args;
  const result = spawnSync(execCommand, execArgs, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label}: command exited with code ${result.status}`);
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: options.env || process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: options.timeout,
  });
  return result.status === 0 ? (result.stdout || "").trim() : "";
}

function ensureLocalConfig() {
  const envPath = path.join(projectRoot, ".env");
  const examplePath = path.join(projectRoot, ".env.example");
  if (!fs.existsSync(envPath)) {
    fs.copyFileSync(examplePath, envPath);
    try { fs.chmodSync(envPath, 0o600); } catch {}
    log("Created .env from .env.example.");
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const keyName = "SEEDANCE_CREDENTIALS_ENCRYPTION_KEY";
  const keyLine = lines.findIndex((line) => line.startsWith(`${keyName}=`));
  const currentKey = keyLine >= 0 ? lines[keyLine].slice(keyName.length + 1).trim() : "";
  if (!currentKey || currentKey === "GENERATE_ON_FIRST_START") {
    const generatedKey = crypto.randomBytes(32).toString("hex");
    if (keyLine >= 0) lines[keyLine] = `${keyName}=${generatedKey}`;
    else lines.push(`${keyName}=${generatedKey}`);
    fs.writeFileSync(envPath, lines.join(os.EOL), { mode: 0o600 });
    log("Generated the local encryption key and saved it in .env.");
  }

  fs.mkdirSync(path.join(projectRoot, "data"), { recursive: true });
}

function autoUpdateEnabled() {
  let value = process.env.STORYAI_AUTO_UPDATE;
  if (value === undefined) {
    const content = fs.readFileSync(path.join(projectRoot, ".env"), "utf8");
    const match = content.match(/^\s*STORYAI_AUTO_UPDATE\s*=\s*(.*?)\s*$/m);
    value = match?.[1].replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
  }
  return !["false", "0", "off", "no"].includes((value || "").trim().toLowerCase());
}

function readArchiveManifest() {
  try {
    if (!fs.existsSync(archiveManifestFile)) return [];
    const parsed = JSON.parse(fs.readFileSync(archiveManifestFile, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function findWingetExecutable() {
  if (!isWindows) return "";
  const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), "AppData", "Local");
  const windowsAppsWinget = path.join(localAppData, "Microsoft", "WindowsApps", "winget.exe");
  if (commandWorks("winget.exe", ["--version"])) return "winget.exe";
  if (fs.existsSync(windowsAppsWinget) && commandWorks(windowsAppsWinget, ["--version"])) return windowsAppsWinget;
  return "";
}

function findBrewExecutable() {
  if (process.platform !== "darwin") return "";
  const brewCandidates = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew", "brew"];
  return brewCandidates.find((candidate) => (candidate === "brew" || fs.existsSync(candidate)) && commandWorks(candidate, ["--version"])) || "";
}

function installWingetPackage(wingetBin, packageId) {
  const baseArgs = [
    "install", "--id", packageId, "--exact",
    "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity",
  ];
  const scoped = spawnSync(wingetBin, [...baseArgs, "--scope", "user"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    timeout: 300_000,
  });
  if (scoped.status === 0) return;
  spawnSync(wingetBin, baseArgs, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    timeout: 300_000,
  });
}

function envToggleEnabled(name) {
  let value = process.env[name];
  if (value === undefined) {
    const content = fs.readFileSync(path.join(projectRoot, ".env"), "utf8");
    const match = content.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*?)\\s*$`, "m"));
    value = match?.[1].replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
  }
  return !["false", "0", "off", "no"].includes((value || "").trim().toLowerCase());
}

function autoInstallGitEnabled() {
  return envToggleEnabled("STORYAI_AUTO_INSTALL_GIT");
}

function ensureGitInstalled() {
  let gitBin = resolveGitExecutable();
  if (gitBin) return gitBin;
  if (!autoInstallGitEnabled()) {
    log("Git is not installed (STORYAI_AUTO_INSTALL_GIT=false). Using direct GitHub HTTPS sync.");
    return "";
  }

  if (isWindows) {
    const wingetBin = findWingetExecutable();
    if (wingetBin) {
      log("Git was not found. Automatically installing Git via WinGet (no user setup required)...");
      installWingetPackage(wingetBin, "Git.Git");
      gitBin = resolveGitExecutable();
    }
  } else if (process.platform === "darwin") {
    const brewBin = findBrewExecutable();
    if (brewBin) {
      log("Git was not found. Automatically installing Git via Homebrew...");
      spawnSync(brewBin, ["install", "git"], {
        cwd: projectRoot,
        env: process.env,
        stdio: "inherit",
        shell: false,
        timeout: 300_000,
      });
      gitBin = resolveGitExecutable();
    }
  }

  if (gitBin) {
    log(`Git installed and ready (${gitBin}).`);
    return gitBin;
  }

  log("Git is not installed; StoryAI will sync updates and Antigravity plugins directly from GitHub over HTTPS.");
  return "";
}

function bootstrapGitCheckoutIfZip(gitBin, repoUrl, branch = "main") {
  log(`This folder was downloaded without Git metadata. Connecting it to ${repoUrl} for automatic updates...`);
  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const runGitStep = (args, timeout = 120_000) => spawnSync(gitBin, args, {
    cwd: projectRoot,
    env: gitEnv,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout,
  });

  const gitDir = path.join(projectRoot, ".git");
  const initRes = runGitStep(["init"], 30_000);
  if (initRes.status !== 0) {
    fs.rmSync(gitDir, { recursive: true, force: true });
    return { bootstrapped: false };
  }

  const hasOrigin = runGitStep(["remote", "get-url", "origin"], 15_000).status === 0;
  const remoteRes = runGitStep(hasOrigin ? ["remote", "set-url", "origin", repoUrl] : ["remote", "add", "origin", repoUrl], 15_000);
  if (remoteRes.status !== 0) {
    fs.rmSync(gitDir, { recursive: true, force: true });
    return { bootstrapped: false };
  }

  const fetchRes = runGitStep(["fetch", "--depth", "1", "origin", branch], 120_000);
  if (fetchRes.status !== 0) {
    fs.rmSync(gitDir, { recursive: true, force: true });
    return { bootstrapped: false };
  }

  const checkoutArgs = isWindows
    ? ["-c", "core.longpaths=true", "checkout", "-f", "-B", branch, "--track", `origin/${branch}`]
    : ["checkout", "-f", "-B", branch, "--track", `origin/${branch}`];
  const checkoutRes = runGitStep(checkoutArgs, 60_000);
  if (checkoutRes.status !== 0) {
    fs.rmSync(gitDir, { recursive: true, force: true });
    return { bootstrapped: false };
  }

  const headCommit = capture(gitBin, ["rev-parse", "--short", "HEAD"], { env: gitEnv });
  log(`Connected folder to GitHub and updated source to ${headCommit || branch}.`);
  return { bootstrapped: true, updated: true };
}

async function updateFromGitHubArchive(githubRepo, branch = "main") {
  const remoteSha = await fetchRemoteBranchSha(githubRepo, branch);
  if (!remoteSha) {
    log("Could not reach GitHub to check for updates. Continuing with the current local version.");
    return { updated: false };
  }

  const previousSha = fs.existsSync(archiveShaFile) ? fs.readFileSync(archiveShaFile, "utf8").trim() : "";
  if (previousSha && previousSha === remoteSha) {
    log("StoryAI is already up to date.");
    return { updated: false };
  }

  log(`Downloading latest StoryAI update (${remoteSha.slice(0, 12)}) directly from GitHub...`);
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyai-gh-update-"));
  try {
    await downloadAndExtractGitHubArchive(githubRepo, remoteSha, stagingDir);
    const previousManifest = readArchiveManifest();
    const { syncedFiles } = syncExtractedArchiveToProject(stagingDir, projectRoot, previousManifest);
    fs.writeFileSync(archiveManifestFile, `${JSON.stringify(syncedFiles, null, 2)}\n`, "utf8");
    fs.writeFileSync(archiveShaFile, `${remoteSha}\n`, "utf8");
    log(`Updated source from GitHub to ${remoteSha.slice(0, 12)}.`);
    return { updated: true };
  } catch (cause) {
    log(`Could not download GitHub update: ${cause instanceof Error ? cause.message : String(cause)}. Continuing with the current version.`);
    return { updated: false };
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

async function updateFromMain(gitBin) {
  if (!autoUpdateEnabled()) {
    log("Automatic updates are disabled on this machine (STORYAI_AUTO_UPDATE=false). Using local source files.");
    return { updated: false };
  }

  const githubRepo = (process.env.STORYAI_GITHUB_REPO || "nghiencarcom/storydola").trim();
  const repoUrl = `https://github.com/${githubRepo}.git`;
  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

  if (gitBin) {
    const hasGitDir = fs.existsSync(path.join(projectRoot, ".git"));
    if (!hasGitDir) {
      const bootstrapped = bootstrapGitCheckoutIfZip(gitBin, repoUrl, "main");
      if (bootstrapped.bootstrapped) return { updated: bootstrapped.updated };
      return updateFromGitHubArchive(githubRepo, "main");
    }

    const inRepo = capture(gitBin, ["rev-parse", "--is-inside-work-tree"], { env: gitEnv });
    if (inRepo !== "true") {
      return updateFromGitHubArchive(githubRepo, "main");
    }

    const branch = capture(gitBin, ["branch", "--show-current"], { env: gitEnv });
    if (branch !== "main") {
      log(`Automatic updates are enabled on main; current branch is ${branch || "detached"}.`);
      return { updated: false };
    }

    const changes = capture(gitBin, ["status", "--porcelain"], { env: gitEnv });
    if (changes) {
      log("Local source changes were found. Trying a safe fast-forward; Git will stop if an update would overwrite them.");
    }

    const previousCommit = capture(gitBin, ["rev-parse", "HEAD"], { env: gitEnv });
    if (!previousCommit) return { updated: false };

    const pullArgs = isWindows
      ? ["-c", "core.longpaths=true", "pull", "--ff-only", "origin", "main"]
      : ["pull", "--ff-only", "origin", "main"];
    const result = spawnSync(gitBin, pullArgs, {
      cwd: projectRoot,
      env: gitEnv,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      log(`Could not check for updates${result.error ? `: ${result.error.message}` : ". Continuing with the current version."} Local changes were preserved; resolve or stash conflicting changes and retry.`);
      return { updated: false };
    }

    const currentCommit = capture(gitBin, ["rev-parse", "HEAD"], { env: gitEnv });
    if (currentCommit !== previousCommit) log(`Updated source to ${currentCommit.slice(0, 12)}.`);
    else log("StoryAI is already up to date.");
    if (changes) log("Local source changes remain in the working tree.");
    return { updated: currentCommit !== previousCommit };
  }

  return updateFromGitHubArchive(githubRepo, "main");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function collectSourceFiles(directory, output) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectSourceFiles(fullPath, output);
    else if (entry.isFile()) output.push(fullPath);
  }
}

function getBuildFingerprint() {
  const files = [
    "package.json",
    "package-lock.json",
    "next.config.mjs",
    "tsconfig.json",
    "next-env.d.ts",
  ].map((name) => path.join(projectRoot, name));
  for (const directory of ["app", "public", "assets", "prompts", "gpt-config", "knowledge"]) {
    collectSourceFiles(path.join(projectRoot, directory), files);
  }

  const records = files
    .filter((file) => fs.existsSync(file))
    .sort()
    .map((file) => {
      const stat = fs.statSync(file);
      return `${path.relative(projectRoot, file)}:${stat.size}:${stat.mtimeMs}`;
    });
  return sha256(records.join("\n"));
}

function ensureDependencies() {
  const lockPath = path.join(projectRoot, "package-lock.json");
  const lockHash = sha256(fs.readFileSync(lockPath));
  const nextPackage = path.join(projectRoot, "node_modules", "next", "package.json");
  const installedHash = fs.existsSync(dependencyMarker) ? fs.readFileSync(dependencyMarker, "utf8").trim() : "";

  if (!fs.existsSync(nextPackage) || installedHash !== lockHash) {
    run(isWindows ? "npm.cmd" : "npm", ["ci"], "Installing project dependencies with npm ci...");
    fs.writeFileSync(dependencyMarker, lockHash, "utf8");
  }
}

function ensureProductionBuild() {
  const serverPath = path.join(projectRoot, ".next", "standalone", "server.js");
  const fingerprint = getBuildFingerprint();
  const previousFingerprint = fs.existsSync(buildMarker) ? fs.readFileSync(buildMarker, "utf8").trim() : "";
  if (!fs.existsSync(serverPath) || fingerprint !== previousFingerprint) {
    run(isWindows ? "npm.cmd" : "npm", ["run", "build"], "Building StoryAI for production...");
    fs.mkdirSync(path.dirname(buildMarker), { recursive: true });
    fs.writeFileSync(buildMarker, fingerprint, "utf8");
  } else {
    log("Production build is current.");
  }
}

function commandWorks(command, args = ["-version"]) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  return result.status === 0;
}

function installHint(tool) {
  if (tool === "node") {
    return process.platform === "win32"
      ? "install with `winget install --id OpenJS.NodeJS.LTS --exact`; if already installed, update with `winget upgrade --id OpenJS.NodeJS.LTS --exact`"
      : process.platform === "darwin"
        ? "install with `brew install node` or download from https://nodejs.org/en/download/; update Homebrew Node.js with `brew upgrade node`"
        : "Install Node.js 22 or newer from https://nodejs.org/en/download/";
  }
  if (tool === "git") {
    return process.platform === "win32"
      ? "winget install --id Git.Git --exact"
      : process.platform === "darwin"
        ? "brew install git (or download from https://git-scm.com/downloads/)"
        : "Install Git from your OS package manager or https://git-scm.com/downloads/";
  }
  return process.platform === "win32"
    ? "winget install --id Gyan.FFmpeg --exact (installs ffmpeg and ffprobe)"
    : process.platform === "darwin"
      ? "brew install ffmpeg (installs ffmpeg and ffprobe)"
      : "Install FFmpeg with your OS package manager; both ffmpeg and ffprobe are required.";
}

function ensureFfmpegInstalled() {
  let pair = resolveFfmpegExecutables();
  if (pair.ffmpeg && pair.ffprobe) return pair;

  if (envToggleEnabled("STORYAI_AUTO_INSTALL_FFMPEG")) {
    if (isWindows) {
      const wingetBin = findWingetExecutable();
      if (wingetBin) {
        log("FFmpeg/FFprobe not found. Automatically installing Gyan.FFmpeg via WinGet...");
        installWingetPackage(wingetBin, "Gyan.FFmpeg");
        pair = resolveFfmpegExecutables();
      }
    } else if (process.platform === "darwin") {
      const brewBin = findBrewExecutable();
      if (brewBin) {
        log("FFmpeg/FFprobe not found. Automatically installing FFmpeg via Homebrew...");
        spawnSync(brewBin, ["install", "ffmpeg"], {
          cwd: projectRoot,
          env: process.env,
          stdio: "inherit",
          shell: false,
          timeout: 300_000,
        });
        pair = resolveFfmpegExecutables();
      }
    }
  }

  const missing = [];
  if (!pair.ffmpeg) missing.push("ffmpeg");
  if (!pair.ffprobe) missing.push("ffprobe");
  if (missing.length) {
    log(`Missing ${missing.join(" and ")} in PATH. MP4 rendering requires both ffmpeg and ffprobe.`);
    log(`Install both: ${installHint("ffmpeg")}`);
    log("After installing, reopen the terminal and confirm `ffmpeg -version` and `ffprobe -version` both work.");
  } else {
    log(`FFmpeg and FFprobe are ready (${pair.ffmpeg}).`);
  }
  return pair;
}

function ensureAntigravityCliInstalled() {
  let agyBin = resolveAgyExecutable();
  if (agyBin) return agyBin;
  if (!envToggleEnabled("STORYAI_AUTO_INSTALL_AGY") || !hasAntigravityAppInstalled()) {
    return "";
  }

  log("Antigravity detected without agy CLI. Automatically installing agy CLI for script generation...");
  if (isWindows) {
    spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "irm https://antigravity.google/cli/install.ps1 | iex"],
      { cwd: projectRoot, env: process.env, stdio: "inherit", shell: false, windowsHide: true, timeout: 180_000 },
    );
  } else {
    spawnSync(
      "/bin/bash",
      ["-c", "curl -fsSL https://antigravity.google/cli/install.sh | bash"],
      { cwd: projectRoot, env: process.env, stdio: "inherit", shell: false, timeout: 180_000 },
    );
  }

  agyBin = resolveAgyExecutable();
  if (agyBin) {
    log(`Antigravity CLI (agy) installed and ready (${agyBin}).`);
  } else {
    log("Could not auto-install agy CLI; you can install it from Settings later.");
  }
  return agyBin;
}

function portFromConfig() {
  const environmentPort = process.env.PORT?.trim();
  if (/^\d+$/.test(environmentPort || "")) return Number(environmentPort);
  const envFile = path.join(projectRoot, ".env");
  const content = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
  const match = content.match(/^PORT=(\d+)\s*$/m);
  return Number(match?.[1] || 3012);
}

function listeningProcessIds(port) {
  if (isWindows) {
    const output = capture("netstat.exe", ["-ano", "-p", "tcp"]);
    return [...new Set(output.split(/\r?\n/).flatMap((line) => {
      const columns = line.trim().split(/\s+/);
      const stateIndex = columns.indexOf("LISTENING");
      if (stateIndex < 0 || !columns[1]?.endsWith(`:${port}`)) return [];
      const pid = columns[stateIndex + 1];
      return /^\d+$/.test(pid || "") ? [pid] : [];
    }))];
  }
  return [...new Set(capture("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"]).split(/\s+/).filter((pid) => /^\d+$/.test(pid)))];
}

function processInfo(pid) {
  if (isWindows) {
    const command = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(pid)}' -ErrorAction SilentlyContinue; if ($p) { [pscustomobject]@{ ParentProcessId = $p.ParentProcessId; CommandLine = $p.CommandLine } | ConvertTo-Json -Compress }`;
    const output = capture("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]);
    try {
      const value = JSON.parse(output);
      return { parentPid: Number(value.ParentProcessId), command: String(value.CommandLine || "") };
    } catch {
      return undefined;
    }
  }
  const output = capture("ps", ["-o", "ppid=,command=", "-p", String(pid)]);
  const match = output.match(/^(\d+)\s+([\s\S]+)$/);
  return match ? { parentPid: Number(match[1]), command: match[2] } : undefined;
}

function findStoryAISupervisor(listenerPid) {
  let pid = Number(listenerPid);
  const visited = new Set();
  for (let depth = 0; pid > 1 && depth < 16 && !visited.has(pid); depth += 1) {
    visited.add(pid);
    const info = processInfo(pid);
    if (!info) return undefined;
    if (/scripts[\\/]start-storyai\.js(?:\s|$)/i.test(info.command)) return pid;
    pid = info.parentPid;
  }
  return undefined;
}

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        const occupied = new Error(`Port ${port} is already in use.`);
        occupied.code = "EADDRINUSE";
        reject(occupied);
      }
      else reject(error);
    });
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

async function isStoryAIAlreadyRunning(port) {
  const candidates = new Set(["127.0.0.1"]);
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (!address.internal && address.family === "IPv4") candidates.add(address.address);
    }
  }
  for (const candidate of candidates) {
    try {
      const response = await fetch(`http://${candidate}:${port}/login`, { signal: AbortSignal.timeout(1000) });
      if (!response.ok) continue;
      const html = await response.text();
      if (/<title>\s*StoryAI\b/i.test(html)) return true;
    } catch {}
  }
  return false;
}

async function waitUntilPortIsFree(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listeningProcessIds(port).length === 0) {
      try {
        await assertPortAvailable(port);
        return true;
      } catch (error) {
        if (error.code !== "EADDRINUSE") throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function stopPreviousStoryAI(port) {
  let listeners = listeningProcessIds(port);
  if (!listeners.length) {
    try {
      await assertPortAvailable(port);
      return;
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
      throw new Error(`Port ${port} is already occupied, but its listener process could not be identified. Stop it manually or change PORT in .env.`);
    }
  }

  if (!(await isStoryAIAlreadyRunning(port))) {
    throw new Error(`Port ${port} is occupied by another application. Stop it or change PORT in .env.`);
  }

  const supervisors = listeners.map(findStoryAISupervisor);
  if (supervisors.some((pid) => !pid)) {
    throw new Error(`StoryAI is using port ${port}, but its launcher process could not be identified safely. Stop that StoryAI process manually, then run npm start again.`);
  }
  const uniqueSupervisors = [...new Set(supervisors)];

  for (const pid of uniqueSupervisors) {
    log(`Stopping previous StoryAI supervisor (PID ${pid}) to reuse port ${port}.`);
    if (isWindows) {
      const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      if (result.error) throw new Error(`Could not stop the previous StoryAI process: ${result.error.message}`);
    } else {
      try { process.kill(pid, "SIGTERM"); } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }

  if (!(await waitUntilPortIsFree(port))) {
    throw new Error(`The previous StoryAI process did not release port ${port}. Stop it manually, then run npm start again.`);
  }
  listeners = listeningProcessIds(port);
  if (listeners.length) throw new Error(`Port ${port} is still occupied. Stop the remaining process before starting StoryAI.`);
  log(`Previous StoryAI process stopped; port ${port} is free.`);
}

function openBrowser(url) {
  if (process.env.STORYAI_OPEN_BROWSER === "false") return;
  let command, args;
  if (isWindows) {
    command = "cmd.exe";
    args = ["/d", "/s", "/c", `start "" "${url}"`];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  const opener = spawn(command, args, { cwd: projectRoot, detached: true, stdio: "ignore", windowsHide: true });
  opener.unref();
}

let stopping = false;
let serverProcess;

function stop(signal) {
  if (stopping) return;
  stopping = true;
  log(`Stopping StoryAI (${signal}).`);
  if (serverProcess && !serverProcess.killed) serverProcess.kill("SIGTERM");
}

process.once("SIGINT", () => stop("Ctrl+C"));
process.once("SIGTERM", () => stop("SIGTERM"));

async function serve(port) {
  const url = `http://localhost:${port}`;
  process.env.PORT = String(port);
  process.env.HOSTNAME = "127.0.0.1";
  log(`StoryAI is starting at ${url}. Press Ctrl+C to stop.`);

  while (!stopping) {
    await new Promise((resolve) => {
      let browserOpened = false;
      const child = spawn(process.execPath, ["scripts/start-next-server.js"], {
        cwd: projectRoot,
        env: process.env,
        stdio: ["inherit", "pipe", "pipe"],
        windowsHide: true,
      });
      serverProcess = child;

      for (const stream of [child.stdout, child.stderr]) {
        stream.on("data", (chunk) => {
          process.stdout.write(chunk);
          fs.appendFile(logFile, chunk, () => {});
        });
      }

      const healthTimer = setInterval(async () => {
        if (browserOpened || stopping) return;
        try {
          const response = await fetch(`${url}/login`, { signal: AbortSignal.timeout(1500) });
          if (response.status >= 200 && response.status < 400) {
            browserOpened = true;
            log(`StoryAI is ready at ${url}.`);
            openBrowser(url);
          }
        } catch {}
      }, 1000);

      child.once("error", (error) => log(`Could not start the StoryAI server: ${error.message}`));
      child.once("exit", (code, signal) => {
        clearInterval(healthTimer);
        serverProcess = undefined;
        if (stopping) return resolve();
        log(`StoryAI server exited (code ${code ?? "none"}, signal ${signal ?? "none"}); restarting in 2 seconds.`);
        setTimeout(resolve, 2000);
      });
    });
  }
}

async function main() {
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 22) {
    throw new Error(`Node.js 22 or newer is required. Current version: ${process.versions.node}. Install or update Node.js: ${installHint("node")}`);
  }

  ensureLocalConfig();
  const gitBin = ensureGitInstalled();
  ensureFfmpegInstalled();
  ensureAntigravityCliInstalled();

  const launcherPath = path.join(projectRoot, "scripts", "start-storyai.js");
  const beforeLauncherHash = sha256(fs.readFileSync(launcherPath));
  await updateFromMain(gitBin);
  const afterLauncherHash = sha256(fs.readFileSync(launcherPath));
  if (beforeLauncherHash !== afterLauncherHash && process.env.STORYAI_LAUNCHER_REEXEC !== "1") {
    log("Launcher script was updated; restarting with the new launcher...");
    const reexec = spawnSync(process.execPath, [launcherPath, ...process.argv.slice(2)], {
      cwd: projectRoot,
      env: { ...process.env, STORYAI_LAUNCHER_REEXEC: "1", STORYAI_AUTO_UPDATE: "false" },
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    process.exitCode = reexec.status ?? 0;
    return;
  }

  await ensureAntigravityVideoPlugins({ logger: log });
  const appVersion = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")).version;
  const archiveSha = fs.existsSync(archiveShaFile) ? fs.readFileSync(archiveShaFile, "utf8").trim() : "";
  const gitCommit = (gitBin && capture(gitBin, ["rev-parse", "--short", "HEAD"]))
    || (archiveSha ? `${archiveSha.slice(0, 7)} (github-sync)` : "source archive");
  log(`Runtime: StoryAI ${appVersion}; Node.js ${process.versions.node}; ${process.platform}/${process.arch}; Git ${gitCommit}.`);
  const port = portFromConfig();
  await stopPreviousStoryAI(port);
  ensureDependencies();
  ensureProductionBuild();
  await serve(port);
}

main().catch((error) => {
  log(`StoryAI could not start: ${error.message}`);
  process.exitCode = 1;
});

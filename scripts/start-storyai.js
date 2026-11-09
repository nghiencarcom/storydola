const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const logsDir = path.join(projectRoot, "logs");
const logFile = path.join(logsDir, "storyai-supervisor.log");
const buildMarker = path.join(projectRoot, ".next", ".storyai-build-fingerprint");
const dependencyMarker = path.join(logsDir, "package-lock.sha256");
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
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    shell: isWindows,
    windowsHide: true,
  });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label}: command exited with code ${result.status}`);
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function ensureLocalConfig() {
  const envPath = path.join(projectRoot, ".env");
  const examplePath = path.join(projectRoot, ".env.example");
  if (!fs.existsSync(envPath)) {
    fs.copyFileSync(examplePath, envPath, { mode: 0o600 });
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

function updateFromMain() {
  const inRepo = capture("git", ["rev-parse", "--is-inside-work-tree"]);
  if (inRepo !== "true") {
    log("This folder is not a Git checkout. Automatic updates require cloning the repository with Git.");
    return { updated: false };
  }

  const branch = capture("git", ["branch", "--show-current"]);
  if (branch !== "main") {
    log(`Automatic updates are enabled on main; current branch is ${branch || "detached"}.`);
    return { updated: false };
  }

  const changes = capture("git", ["status", "--porcelain"]);
  if (changes) {
    log("Local source changes were found. Skipping automatic update to preserve them.");
    return { updated: false };
  }

  const previousCommit = capture("git", ["rev-parse", "HEAD"]);
  if (!previousCommit) return { updated: false };

  const result = spawnSync("git", ["pull", "--ff-only", "origin", "main"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    log(`Could not check for updates${result.error ? `: ${result.error.message}` : ". Continuing with the current version."}`);
    return { updated: false };
  }

  const currentCommit = capture("git", ["rev-parse", "HEAD"]);
  if (currentCommit !== previousCommit) log(`Updated source to ${currentCommit.slice(0, 12)}.`);
  else log("StoryAI is already up to date.");
  return { updated: currentCommit !== previousCommit };
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
  for (const directory of ["app", "public", "gpt-config", "knowledge"]) {
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

function commandWorks(command) {
  const result = spawnSync(command, ["-version"], {
    cwd: projectRoot,
    stdio: "ignore",
    shell: isWindows,
    windowsHide: true,
  });
  return result.status === 0;
}

function portFromConfig() {
  const content = fs.readFileSync(path.join(projectRoot, ".env"), "utf8");
  const match = content.match(/^PORT=(\d+)\s*$/m);
  return Number(match?.[1] || 3011);
}

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") reject(new Error(`Port ${port} is already in use. Stop the other StoryAI process or change PORT in .env.`));
      else reject(error);
    });
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
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
  if (major < 22) throw new Error(`Node.js 22 or newer is required. Current version: ${process.versions.node}`);

  ensureLocalConfig();
  updateFromMain();
  ensureDependencies();
  ensureProductionBuild();

  if (!commandWorks(isWindows ? "ffmpeg.exe" : "ffmpeg") || !commandWorks(isWindows ? "ffprobe.exe" : "ffprobe")) {
    log("FFmpeg/FFprobe was not found in PATH. StoryAI will start, but MP4 rendering needs FFmpeg installed.");
  }

  const port = portFromConfig();
  await assertPortAvailable(port);
  await serve(port);
}

main().catch((error) => {
  log(`StoryAI could not start: ${error.message}`);
  process.exitCode = 1;
});

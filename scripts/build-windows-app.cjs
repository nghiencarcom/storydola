const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const VERSION = PACKAGE.version || "0.0.0";
const RELEASE_DIR = path.join(ROOT, "release");
const APP_DIR = path.join(RELEASE_DIR, `StoryDola-Windows-v${VERSION}`);
const ZIP_PATH = path.join(RELEASE_DIR, `StoryDola-Windows-v${VERSION}.zip`);
const GATEWAY_DIR = path.join(ROOT, "dola-studio", "dola-render-gateway");
const VENV_DIR = path.join(GATEWAY_DIR, ".venv");
const VENV_PYTHON = path.join(VENV_DIR, "Scripts", "python.exe");
const CHROMIUM_DIR = path.join(GATEWAY_DIR, "browsers");
const CHROMIUM_EXE = path.join(CHROMIUM_DIR, "chromium-1243", "chrome-win64", "chrome.exe");
const CHROMIUM_MARKER = path.join(CHROMIUM_DIR, "chromium-1243", "INSTALLATION_COMPLETE");

function fail(message) {
  console.error(`[Build Windows] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.stdio || "inherit",
    windowsHide: true,
    ...options,
  });
  if (result.error) fail(`Không thể chạy ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} kết thúc với mã ${result.status ?? 1}.`);
  return result;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function sourcePathAllowed(absolutePath) {
  const relative = path.relative(ROOT, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const parts = relative.split(path.sep);
  const normalized = parts.join("/").toLowerCase();
  const name = parts[parts.length - 1];
  const lower = name.toLowerCase();

  if (parts.some((part) => [".git", "node_modules", ".venv", "venv", ".npm-cache", ".cache", "__pycache__", "backups", "release", "dist", "logs"].includes(part.toLowerCase()) || part.toLowerCase().startsWith(".next"))) return false;
  // The Windows bundle copies FFmpeg and FFprobe explicitly to the app root.
  if (normalized === "ffmpeg.exe" || normalized === "ffprobe.exe") return false;
  // Root data/ contains per-machine API keys, accounts and generated projects.
  // Ship only its placeholder so each installation starts with clean local state.
  if (parts[0].toLowerCase() === "data" && parts.length > 1 && !(parts.length === 2 && lower === ".gitkeep")) return false;
  if (normalized.startsWith("dola-studio/dola-render-gateway/accounts/")) return false;
  if (normalized === "dola-studio/dola-render-gateway/accounts") return false;
  if (normalized.startsWith("dola-studio/dola-render-gateway/downloads/")) return false;
  if (normalized === "dola-studio/dola-render-gateway/downloads") return false;
  if (normalized.startsWith("dola-studio/dola-render-gateway/tests/")) return false;
  if (normalized === "dola-studio/dola-render-gateway/tests") return false;

  if (name.startsWith(".env") && name !== ".env.example") return false;
  if (lower === ".ds_store" || lower.startsWith("dbg_") || lower.startsWith("debug_")) return false;
  if ([".zip", ".7z", ".rar"].some((suffix) => lower.endsWith(suffix))) return false;
  if (lower.startsWith("account_credentials.")) return false;
  if (["cookies.txt", "storage_state.json", "storage-state.json", "dola-gateway.log"].includes(lower)) return false;
  if ([".db", ".db-shm", ".db-wal", ".sqlite", ".sqlite-shm", ".sqlite-wal", ".sqlite3", ".sqlite3-shm", ".sqlite3-wal", ".log", ".pyc", ".key", ".pem", ".p12", ".pfx", ".cookie", ".cookies", ".token"].some((suffix) => lower.endsWith(suffix))) return false;
  return true;
}

function copyProjectTree(source, destination) {
  const filter = (candidate) => sourcePathAllowed(candidate);
  fs.cpSync(source, destination, { recursive: true, filter });
}

function copyRuntimeDirectory(source, destination, label) {
  if (!fs.existsSync(source)) fail(`Không tìm thấy ${label}: ${source}`);
  console.log(`[Build Windows] Sao chép ${label}...`);
  fs.cpSync(source, destination, { recursive: true });
}

function findOnPath(executable) {
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory.replace(/^"|"$/g, ""), executable);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findCSharpCompiler() {
  const windows = process.env.WINDIR || "C:\\Windows";
  const candidates = [
    path.join(windows, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    path.join(windows, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function zipBundle(pythonExe) {
  const zipScript = String.raw`import os, sys, zipfile
source, destination = sys.argv[1], sys.argv[2]
root_name = os.path.basename(source.rstrip(os.sep))
written = 0
with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
    for current, directories, files in os.walk(source, topdown=True):
        directories[:] = sorted(d for d in directories if d.lower() not in {"logs", "__pycache__"} and not d.lower().startswith(".next"))
        for filename in sorted(files):
            full_path = os.path.join(current, filename)
            relative = os.path.relpath(full_path, source)
            archive_name = (root_name + "/" + relative).replace(os.sep, "/")
            archive.write(full_path, archive_name)
            written += 1
            if written % 3000 == 0:
                print("[Build Windows] ZIP: " + str(written) + " file...", flush=True)
print("[Build Windows] Đã đóng gói " + str(written) + " file vào ZIP.", flush=True)`;
  run(pythonExe, ["-c", zipScript, APP_DIR, ZIP_PATH]);
}

function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    fail("Bản đóng gói này cần được tạo trên Windows x64.");
  }
  if (!fs.existsSync(VENV_PYTHON)) fail("Thiếu Python environment. Chạy npm run setup:local trước.");
  if (!fs.existsSync(CHROMIUM_EXE) || !fs.existsSync(CHROMIUM_MARKER)) {
    fail("Thiếu Chromium Windows đi kèm. Chạy npm run setup:local trước.");
  }
  if (fs.existsSync(APP_DIR) || fs.existsSync(ZIP_PATH)) {
    fail(`Đã có output ${path.relative(ROOT, fs.existsSync(APP_DIR) ? APP_DIR : ZIP_PATH)}. Đổi tên hoặc di chuyển bản cũ trước khi build lại.`);
  }
  if (!isInside(ROOT, APP_DIR) || !isInside(RELEASE_DIR, APP_DIR) || !isInside(RELEASE_DIR, ZIP_PATH)) {
    fail("Đường dẫn output nằm ngoài thư mục release dự kiến.");
  }

  const pythonProbe = run(VENV_PYTHON, [
    "-c",
    "import sys, fastapi, uvicorn, patchright, aiohttp, pydantic, PIL, cv2, cryptography; print(sys.base_prefix)",
  ], { stdio: "pipe" });
  const pythonBase = String(pythonProbe.stdout || "").trim().split(/\r?\n/).pop();
  if (!pythonBase || !fs.existsSync(path.join(pythonBase, "python.exe"))) {
    fail("Không xác định được Python runtime cơ sở của môi trường Dola.");
  }

  const ffmpegExe = fs.existsSync(path.join(ROOT, "ffmpeg.exe"))
    ? path.join(ROOT, "ffmpeg.exe")
    : findOnPath("ffmpeg.exe");
  const ffprobeExe = fs.existsSync(path.join(ROOT, "ffprobe.exe"))
    ? path.join(ROOT, "ffprobe.exe")
    : findOnPath("ffprobe.exe");
  const ffplayExe = findOnPath("ffplay.exe");
  if (!ffmpegExe || !ffprobeExe || !ffplayExe || !fs.existsSync(ffplayExe)) {
    fail("Cần ffmpeg.exe, ffprobe.exe và ffplay.exe trong PATH hoặc ffmpeg.exe/ffprobe.exe ở thư mục dự án để đóng gói runtime media.");
  }

  const compiler = findCSharpCompiler();
  if (!compiler) fail("Không tìm thấy C# compiler của .NET Framework để tạo StoryDola.exe.");

  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  fs.mkdirSync(APP_DIR, { recursive: false });
  console.log(`[Build Windows] Đang tạo StoryDola v${VERSION}...`);

  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (["node_modules", "release", "backups", ".npm-cache"].includes(entry.name.toLowerCase())) continue;
    const source = path.join(ROOT, entry.name);
    if (!sourcePathAllowed(source)) continue;
    copyProjectTree(source, path.join(APP_DIR, entry.name));
  }

  copyRuntimeDirectory(path.join(ROOT, "node_modules"), path.join(APP_DIR, "node_modules"), "dependency Node.js của StoryAI");
  copyRuntimeDirectory(path.join(ROOT, "dola-studio", "node_modules"), path.join(APP_DIR, "dola-studio", "node_modules"), "dependency Node.js của Dola");
  copyRuntimeDirectory(VENV_DIR, path.join(APP_DIR, "dola-studio", "dola-render-gateway", ".venv"), "dependency Python của Dola");

  const nodeDir = path.dirname(process.execPath);
  const nodeRuntimeDest = path.join(APP_DIR, "runtime", "node");
  const pythonRuntimeDest = path.join(APP_DIR, "runtime", "python");
  copyRuntimeDirectory(nodeDir, nodeRuntimeDest, "Node.js runtime");
  copyRuntimeDirectory(pythonBase, pythonRuntimeDest, "Python runtime");

  const ffmpegDest = path.join(APP_DIR, "runtime", "ffmpeg");
  const ffmpegBinDest = path.join(ffmpegDest, "bin");
  fs.mkdirSync(ffmpegBinDest, { recursive: true });
  const appFfmpegExe = path.join(APP_DIR, "ffmpeg.exe");
  const appFfprobeExe = path.join(APP_DIR, "ffprobe.exe");
  fs.copyFileSync(ffmpegExe, appFfmpegExe);
  fs.copyFileSync(ffprobeExe, appFfprobeExe);
  for (const executable of [ffplayExe]) {
    fs.copyFileSync(executable, path.join(ffmpegBinDest, path.basename(executable)));
  }
  const ffmpegRoot = path.resolve(path.dirname(ffplayExe), "..");
  for (const documentation of ["LICENSE", "README.txt"]) {
    const source = path.join(ffmpegRoot, documentation);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(ffmpegDest, documentation));
  }

  const appInfo = [
    `StoryDola Windows portable app v${VERSION}`,
    "",
    "Cài lần đầu: giải nén toàn bộ ZIP này, sau đó mở StoryDola.exe.",
    "StoryDola.exe mở trình duyệt tại http://127.0.0.1:3021 và quản lý các tiến trình Node, Python, FFmpeg local.",
    "Launcher dọn tiến trình Gateway cũ trên cổng 8210 trước khi khởi động ứng dụng.",
    "FFmpeg và FFprobe được đặt ở thư mục gốc của ứng dụng; FFplay nằm trong runtime/ffmpeg/bin.",
    "Đóng cửa sổ StoryDola để dừng các dịch vụ local.",
    "Node.js, Python, FFmpeg/FFprobe/FFplay và Chromium đã được đóng gói; Windows x64 không cần cài riêng các runtime này.",
    "",
    "Cập nhật trong launcher: chọn Tải cập nhật để mở GitHub Releases, tải ZIP, rồi chọn Cài từ ZIP.",
    "Bộ cập nhật thay chương trình trong thư mục hiện tại; .env.local, data, database và profile trên máy được giữ nguyên.",
    "Repository GitHub là riêng tư; người tải cần đăng nhập GitHub và có quyền đọc repository.",
    "Không ghi đè hoặc chia sẻ .env.local, account_credentials.*, database hay profile Chromium giữa các máy.",
    "Phiên bản được xác định bởi trường version trong package.json và tên ZIP.",
    "",
    "Log khởi động: logs/launcher.log",
    "",
    "Windows x64; launcher StoryDola.exe cần .NET Framework 4.8 trở lên.",
  ].join("\r\n") + "\r\n";
  fs.writeFileSync(path.join(APP_DIR, "APP_INFO.txt"), appInfo, "utf8");

  const launcherSource = path.join(__dirname, "windows-app-launcher.cs");
  const launcherExe = path.join(APP_DIR, "StoryDola.exe");
  run(compiler, [
    "/nologo",
    "/target:winexe",
    "/platform:anycpu",
    "/optimize+",
    "/codepage:65001",
    `/out:${launcherExe}`,
    "/reference:System.dll",
    "/reference:System.Drawing.dll",
    "/reference:System.Windows.Forms.dll",
    launcherSource,
  ]);

  const nodeExe = path.join(nodeRuntimeDest, "node.exe");
  const appNodeVersion = run(nodeExe, ["--version"], { stdio: "pipe" }).stdout.trim();
  const appPythonVersion = run(path.join(pythonRuntimeDest, "python.exe"), ["--version"], { stdio: "pipe" }).stdout.trim();
  const mediaVersion = run(appFfmpegExe, ["-version"], { stdio: "pipe" }).stdout.split(/\r?\n/, 1)[0];
  fs.appendFileSync(path.join(APP_DIR, "APP_INFO.txt"), `\r\nNode: ${appNodeVersion}\r\nPython: ${appPythonVersion}\r\n${mediaVersion}\r\n`, "utf8");

  console.log(`[Build Windows] Tạo ZIP ${path.relative(ROOT, ZIP_PATH)}...`);
  zipBundle(path.join(pythonBase, "python.exe"));

  console.log("[Build Windows] Hoàn tất.");
  console.log(`App: ${launcherExe}`);
  console.log(`ZIP: ${ZIP_PATH}`);
}

main();

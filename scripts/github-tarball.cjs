/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

const isWindows = process.platform === "win32";

function prependToPath(directory) {
  if (!directory) return;
  const current = process.env.PATH || "";
  const entries = current.split(path.delimiter).filter(Boolean);
  const normalized = isWindows ? directory.toLowerCase() : directory;
  if (entries.some((entry) => (isWindows ? entry.toLowerCase() : entry) === normalized)) return;
  process.env.PATH = current ? `${directory}${path.delimiter}${current}` : directory;
}

function testGitExecutable(candidate) {
  if (!candidate) return false;
  if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) return false;
  const result = spawnSync(candidate, ["--version"], {
    stdio: "ignore",
    shell: false,
    windowsHide: true,
    timeout: 8_000,
  });
  return result.status === 0;
}

function macOsHasAppleGit() {
  return (
    fs.existsSync("/Library/Developer/CommandLineTools/usr/bin/git")
    || fs.existsSync("/Applications/Xcode.app/Contents/Developer/usr/bin/git")
  );
}

function resolveGitExecutable() {
  const candidates = [];
  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), "AppData", "Local");
    const programFiles = process.env.ProgramFiles?.trim() || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"]?.trim() || "C:\\Program Files (x86)";
    candidates.push(
      "git.exe",
      path.join(localAppData, "Programs", "Git", "cmd", "git.exe"),
      path.join(programFiles, "Git", "cmd", "git.exe"),
      path.join(programFilesX86, "Git", "cmd", "git.exe"),
      path.join(os.homedir(), "scoop", "shims", "git.exe"),
    );
  } else if (process.platform === "darwin") {
    candidates.push("/opt/homebrew/bin/git", "/usr/local/bin/git");
    if (macOsHasAppleGit()) {
      candidates.push(
        "/Library/Developer/CommandLineTools/usr/bin/git",
        "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
        "git",
      );
    } else {
      for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
        if (dir === "/usr/bin" || dir === "/bin") continue;
        candidates.push(path.join(dir, "git"));
      }
    }
  } else {
    candidates.push("git", "/usr/bin/git", "/usr/local/bin/git");
  }

  for (const candidate of candidates) {
    if (testGitExecutable(candidate)) {
      if (path.isAbsolute(candidate)) prependToPath(path.dirname(candidate));
      return candidate;
    }
  }
  return "";
}

function parseUploadPackBranchSha(text, branch = "main") {
  const escapedBranch = branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^[0-9a-f]{4})*([0-9a-f]{40})[ \\t]+refs\\/heads\\/${escapedBranch}(?:$|[ \\t\\0])`, "i");
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const match = rawLine.match(pattern);
    if (match) return match[1].toLowerCase();
  }
  return "";
}

async function fetchRemoteBranchSha(ownerRepo, branch = "main", timeoutMs = 10_000) {
  try {
    const uploadPackUrl = `https://github.com/${ownerRepo}.git/info/refs?service=git-upload-pack`;
    const response = await fetch(uploadPackUrl, {
      headers: { "User-Agent": "git/2.43.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) {
      const sha = parseUploadPackBranchSha(await response.text(), branch);
      if (sha) return sha;
    }
  } catch {
    // Fall through to GitHub REST API SHA check.
  }

  try {
    const apiUrl = `https://api.github.com/repos/${ownerRepo}/commits/${encodeURIComponent(branch)}`;
    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/vnd.github.sha",
        "User-Agent": "StoryAI-Updater",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) {
      const sha = (await response.text()).trim();
      if (/^[0-9a-f]{40}$/i.test(sha)) return sha.toLowerCase();
    }
  } catch {
    // Caller handles empty string gracefully.
  }

  return "";
}

function readNullTerminatedAscii(buffer, start, end) {
  let stop = start;
  while (stop < end && buffer[stop] !== 0) stop += 1;
  return buffer.subarray(start, stop).toString("utf8");
}

function parsePaxRecords(dataBuffer) {
  const text = dataBuffer.toString("utf8");
  const records = {};
  let offset = 0;
  while (offset < text.length) {
    const spaceIndex = text.indexOf(" ", offset);
    if (spaceIndex < 0) break;
    const byteLength = Number.parseInt(text.slice(offset, spaceIndex), 10);
    if (!Number.isFinite(byteLength) || byteLength <= 0) break;
    const recordBytes = Buffer.from(text, "utf8").subarray(
      Buffer.byteLength(text.slice(0, offset), "utf8"),
      Buffer.byteLength(text.slice(0, offset), "utf8") + byteLength,
    );
    const recordText = recordBytes.toString("utf8");
    const firstSpace = recordText.indexOf(" ");
    const eqIndex = recordText.indexOf("=", firstSpace + 1);
    if (firstSpace > 0 && eqIndex > firstSpace) {
      const key = recordText.slice(firstSpace + 1, eqIndex);
      const value = recordText.slice(eqIndex + 1).replace(/\n$/, "");
      records[key] = value;
    }
    const charStep = recordText.length;
    if (charStep <= 0) break;
    offset += charStep;
  }
  return records;
}

function normalizeArchiveRelativePath(rawEntryPath, stripTopLevel = true) {
  const cleaned = String(rawEntryPath || "").replace(/\\/g, "/");
  let stripped = cleaned;
  if (stripTopLevel) {
    const firstSlash = cleaned.indexOf("/");
    if (firstSlash < 0) return "";
    stripped = cleaned.slice(firstSlash + 1);
  }
  stripped = stripped.replace(/\/+$/, "");
  if (!stripped || stripped.startsWith("/")) return "";
  const segments = stripped.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return "";
  }
  return segments.join("/");
}

function matchesPrefixFilter(relPosix, typeflag, filterPrefixes) {
  if (!Array.isArray(filterPrefixes) || filterPrefixes.length === 0) return true;
  const normalizedPrefixes = filterPrefixes.map((prefix) => String(prefix).replace(/\\/g, "/").replace(/^\/+/, ""));
  if (typeflag === "5") {
    const dirWithSlash = `${relPosix}/`;
    return normalizedPrefixes.some((prefix) => dirWithSlash.startsWith(prefix) || prefix.startsWith(dirWithSlash));
  }
  return normalizedPrefixes.some((prefix) => relPosix.startsWith(prefix) || relPosix === prefix.replace(/\/+$/, ""));
}

function extractTarGzBuffer(tarGzBuffer, destDir, options = {}) {
  const tarBuffer = zlib.gunzipSync(tarGzBuffer);
  const resolvedDest = path.resolve(destDir);
  fs.mkdirSync(resolvedDest, { recursive: true });

  const stripTopLevel = options.stripTopLevel !== false;
  const filterPrefixes = options.filterPrefixes;
  const files = [];
  let offset = 0;
  let nextPax = null;
  let nextLongName = "";

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    offset += 512;

    let allZero = true;
    for (let i = 0; i < 512; i += 1) {
      if (header[i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) break;

    const rawName = readNullTerminatedAscii(header, 0, 100);
    const rawPrefix = readNullTerminatedAscii(header, 345, 500);
    const modeOctal = readNullTerminatedAscii(header, 100, 108).trim();
    const sizeOctal = readNullTerminatedAscii(header, 124, 136).trim();
    const typeByte = header[156];
    const typeflag = typeByte === 0 ? "0" : String.fromCharCode(typeByte);

    let size = sizeOctal ? Number.parseInt(sizeOctal, 8) : 0;
    if (!Number.isFinite(size) || size < 0) size = 0;
    if (nextPax?.size !== undefined && typeflag !== "x" && typeflag !== "g") {
      const paxSize = Number.parseInt(nextPax.size, 10);
      if (Number.isFinite(paxSize) && paxSize >= 0) size = paxSize;
    }

    const paddedSize = Math.ceil(size / 512) * 512;
    const dataEnd = Math.min(offset + size, tarBuffer.length);
    const dataSlice = tarBuffer.subarray(offset, dataEnd);
    offset += paddedSize;

    if (typeflag === "x") {
      nextPax = { ...(nextPax || {}), ...parsePaxRecords(dataSlice) };
      continue;
    }
    if (typeflag === "g") {
      continue;
    }
    if (typeflag === "L") {
      nextLongName = dataSlice.toString("utf8").replace(/\0+$/, "");
      continue;
    }

    const entryPath = nextPax?.path || nextLongName || (rawPrefix ? `${rawPrefix}/${rawName}` : rawName);
    nextPax = null;
    nextLongName = "";

    // Skip symlinks, hardlinks, and special non-file/dir metadata entries (e.g. '1', '2', 'V').
    if (typeflag !== "0" && typeflag !== "5") continue;

    const relPosix = normalizeArchiveRelativePath(entryPath, stripTopLevel);
    if (!relPosix) continue;
    if (!matchesPrefixFilter(relPosix, typeflag, filterPrefixes)) continue;

    const targetPath = path.resolve(resolvedDest, ...relPosix.split("/"));
    if (targetPath !== resolvedDest && !targetPath.startsWith(`${resolvedDest}${path.sep}`)) {
      continue;
    }

    if (typeflag === "5") {
      fs.mkdirSync(targetPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, dataSlice);
    if (!isWindows) {
      const parsedMode = modeOctal ? Number.parseInt(modeOctal, 8) : 0o644;
      if (Number.isFinite(parsedMode) && (parsedMode & 0o111) !== 0) {
        try { fs.chmodSync(targetPath, 0o755); } catch {}
      }
    }
    files.push(relPosix);
  }

  return { files: [...new Set(files)].sort() };
}

async function downloadAndExtractGitHubArchive(ownerRepo, ref, destDir, options = {}) {
  const url = `https://codeload.github.com/${ownerRepo}/tar.gz/${encodeURIComponent(ref)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "StoryAI-Updater" },
    signal: AbortSignal.timeout(options.timeoutMs || 120_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub archive download failed (${response.status} ${response.statusText}) for ${url}`);
  }
  const archiveBuffer = Buffer.from(await response.arrayBuffer());
  return extractTarGzBuffer(archiveBuffer, destDir, options);
}

const PROTECTED_TOP_LEVEL = new Set([
  "data",
  "logs",
  "backups",
  "briefs",
  "deliverables",
  "plugin-source",
  "node_modules",
  ".next",
  ".git",
  ".DS_Store",
]);

function isProtectedRelativePath(relPosix) {
  const normalized = String(relPosix || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return true;
  const segments = normalized.split("/");
  const top = segments[0];
  if (PROTECTED_TOP_LEVEL.has(top)) return true;
  if (top.startsWith(".storyai-") || top.startsWith("duong-may-chung-mai_")) return true;
  const base = segments[segments.length - 1];
  if ((base === ".env" || base.startsWith(".env.")) && base !== ".env.example" && base !== ".env.docker.example") {
    return true;
  }
  return false;
}

function collectRelativeFiles(rootDir, currentDir = rootDir, out = []) {
  if (!fs.existsSync(currentDir)) return out;
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectRelativeFiles(rootDir, fullPath, out);
    } else if (entry.isFile()) {
      const relPosix = path.relative(rootDir, fullPath).split(path.sep).join("/");
      out.push(relPosix);
    }
  }
  return out;
}

function pruneEmptyParentDirs(filePath, stopRoot) {
  let current = path.dirname(filePath);
  const resolvedStop = path.resolve(stopRoot);
  while (current !== resolvedStop && current.startsWith(`${resolvedStop}${path.sep}`)) {
    try {
      const entries = fs.readdirSync(current);
      if (entries.length > 0) break;
      fs.rmdirSync(current);
      current = path.dirname(current);
    } catch {
      break;
    }
  }
}

function syncExtractedArchiveToProject(stagingDir, projectRoot, previousManifestPaths = []) {
  const resolvedRoot = path.resolve(projectRoot);
  const allExtracted = collectRelativeFiles(stagingDir).sort();
  const syncedFiles = allExtracted.filter((relPosix) => !isProtectedRelativePath(relPosix));
  const nextSet = new Set(syncedFiles);

  for (const relPosix of syncedFiles) {
    const srcPath = path.join(stagingDir, ...relPosix.split("/"));
    const destPath = path.join(resolvedRoot, ...relPosix.split("/"));
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    if (!isWindows) {
      try {
        const mode = fs.statSync(srcPath).mode;
        if ((mode & 0o111) !== 0) fs.chmodSync(destPath, 0o755);
      } catch {}
    }
  }

  for (const prevRel of Array.isArray(previousManifestPaths) ? previousManifestPaths : []) {
    const normalized = String(prevRel || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || nextSet.has(normalized) || isProtectedRelativePath(normalized)) continue;
    const obsoletePath = path.resolve(resolvedRoot, ...normalized.split("/"));
    if (obsoletePath !== resolvedRoot && obsoletePath.startsWith(`${resolvedRoot}${path.sep}`) && fs.existsSync(obsoletePath)) {
      fs.rmSync(obsoletePath, { force: true });
      pruneEmptyParentDirs(obsoletePath, resolvedRoot);
    }
  }

  return { syncedFiles };
}

module.exports = {
  resolveGitExecutable,
  parseUploadPackBranchSha,
  fetchRemoteBranchSha,
  extractTarGzBuffer,
  downloadAndExtractGitHubArchive,
  isProtectedRelativePath,
  syncExtractedArchiveToProject,
};

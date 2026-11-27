const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const {
  parseUploadPackBranchSha,
  extractTarGzBuffer,
  syncExtractedArchiveToProject,
} = require("../scripts/github-tarball.cjs");

function writeOctal(buf, offset, length, value) {
  const oct = value.toString(8).padStart(length - 1, "0");
  buf.write(oct, offset, length - 1, "ascii");
  buf[offset + length - 1] = 0;
}

function finalizeTarHeader(header) {
  header.fill(" ", 148, 156);
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += header[i];
  const chk = sum.toString(8).padStart(6, "0");
  header.write(chk, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 32;
}

function makeTarEntry(entryPath, contentBuffer, { typeflag = "0", mode = 0o644 } = {}) {
  const header = Buffer.alloc(512, 0);
  header.write(entryPath.slice(0, 100), 0, Math.min(entryPath.length, 100), "utf8");
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, typeflag === "5" || typeflag === "2" ? 0 : contentBuffer.length);
  writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header[156] = typeflag.charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  finalizeTarHeader(header);

  if (typeflag === "5" || typeflag === "2" || contentBuffer.length === 0) return header;
  const padLen = (512 - (contentBuffer.length % 512)) % 512;
  return Buffer.concat([header, contentBuffer, Buffer.alloc(padLen, 0)]);
}

function makePaxPathRecord(fullPath) {
  const payload = `path=${fullPath}\n`;
  let totalLen = Buffer.byteLength(payload, "utf8") + 3;
  while (true) {
    const line = `${totalLen} ${payload}`;
    const actual = Buffer.byteLength(line, "utf8");
    if (actual === totalLen) return Buffer.from(line, "utf8");
    totalLen = actual;
  }
}

function buildTestTarGz(entries) {
  const chunks = [];
  for (const item of entries) {
    const body = Buffer.isBuffer(item.content) ? item.content : Buffer.from(item.content || "", "utf8");
    if (Buffer.byteLength(item.name, "utf8") > 99) {
      const paxBody = makePaxPathRecord(item.name);
      chunks.push(makeTarEntry(`PaxHeaders/${path.basename(item.name).slice(0, 40)}`, paxBody, { typeflag: "x" }));
      chunks.push(makeTarEntry(item.name.slice(0, 99), body, { typeflag: item.typeflag || "0", mode: item.mode || 0o644 }));
    } else {
      chunks.push(makeTarEntry(item.name, body, { typeflag: item.typeflag || "0", mode: item.mode || 0o644 }));
    }
  }
  chunks.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(chunks));
}

function runGit(cwd, args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(res.status, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
  return (res.stdout || "").trim();
}

async function main() {
  // 1. parseUploadPackBranchSha parses real GitHub smart-HTTP response
  {
    const sample = [
      "001e# service=git-upload-pack",
      "000001592fc61d2f4f03e37c1a43d39df8ec22c08009b0f6 HEAD\0multi_ack symref=HEAD:refs/heads/main",
      "005f88561c192d94e94c7d314bba3f0e33bfba5b4d2a refs/heads/codex/improve-reference-image-handling",
      "003d2fc61d2f4f03e37c1a43d39df8ec22c08009b0f6 refs/heads/main",
      "0000",
    ].join("\n");
    assert.equal(parseUploadPackBranchSha(sample, "main"), "2fc61d2f4f03e37c1a43d39df8ec22c08009b0f6");
    assert.equal(
      parseUploadPackBranchSha(sample, "codex/improve-reference-image-handling"),
      "88561c192d94e94c7d314bba3f0e33bfba5b4d2a",
    );
    assert.equal(parseUploadPackBranchSha(sample, "non-existent"), "");
  }

  // 2. extractTarGzBuffer handles long PAX paths, strips root folder, blocks traversal & symlinks, and filters prefixes
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyai-tar-test-"));
    try {
      const longPath = "repo-main/app/api/projects/[slug]/publishing-package/very-deeply-nested-subdirectory-for-testing-pax/thumbnail/route.ts";
      const tgz = buildTestTarGz([
        { name: "repo-main/README.md", content: "# Hello" },
        { name: longPath, content: "export const ok = true;\n" },
        { name: "repo-main/skills/hyperframes/SKILL.md", content: "# HF" },
        { name: "repo-main/../evil.txt", content: "pwned" },
        { name: "repo-main/symlink-entry", content: "", typeflag: "2" },
      ]);

      const fullDest = path.join(tmpDir, "full");
      const fullOut = extractTarGzBuffer(tgz, fullDest);
      assert.deepEqual(fullOut.files, [
        "README.md",
        "app/api/projects/[slug]/publishing-package/very-deeply-nested-subdirectory-for-testing-pax/thumbnail/route.ts",
        "skills/hyperframes/SKILL.md",
      ]);
      assert.equal(fs.readFileSync(path.join(fullDest, "README.md"), "utf8"), "# Hello");
      assert.equal(fs.existsSync(path.join(tmpDir, "evil.txt")), false);
      assert.equal(fs.existsSync(path.join(fullDest, "symlink-entry")), false);

      const filteredDest = path.join(tmpDir, "filtered");
      const filteredOut = extractTarGzBuffer(tgz, filteredDest, { filterPrefixes: ["skills/"] });
      assert.deepEqual(filteredOut.files, ["skills/hyperframes/SKILL.md"]);
      assert.equal(fs.existsSync(path.join(filteredDest, "README.md")), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 3. syncExtractedArchiveToProject preserves .env + data/ and removes obsolete tracked files
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyai-sync-test-"));
    try {
      const staging = path.join(tmpDir, "staging");
      const project = path.join(tmpDir, "project");
      fs.mkdirSync(path.join(staging, "app"), { recursive: true });
      fs.mkdirSync(path.join(staging, "data"), { recursive: true });
      fs.writeFileSync(path.join(staging, "app", "new.txt"), "v2", "utf8");
      fs.writeFileSync(path.join(staging, ".env"), "SHOULD_NOT_OVERWRITE=1", "utf8");
      fs.writeFileSync(path.join(staging, ".env.example"), "EXAMPLE=v2", "utf8");
      fs.writeFileSync(path.join(staging, "data", "projects.json"), "[]", "utf8");

      fs.mkdirSync(path.join(project, "app"), { recursive: true });
      fs.mkdirSync(path.join(project, "data"), { recursive: true });
      fs.writeFileSync(path.join(project, "app", "old-removed.txt"), "v1", "utf8");
      fs.writeFileSync(path.join(project, ".env"), "SECRET_KEY=keep-me", "utf8");
      fs.writeFileSync(path.join(project, "data", "projects.json"), '{"keep":true}', "utf8");

      const { syncedFiles } = syncExtractedArchiveToProject(staging, project, ["app/old-removed.txt", ".env", "data/projects.json"]);
      assert.deepEqual(syncedFiles, [".env.example", "app/new.txt"]);
      assert.equal(fs.readFileSync(path.join(project, "app", "new.txt"), "utf8"), "v2");
      assert.equal(fs.readFileSync(path.join(project, ".env.example"), "utf8"), "EXAMPLE=v2");
      assert.equal(fs.existsSync(path.join(project, "app", "old-removed.txt")), false);
      assert.equal(fs.readFileSync(path.join(project, ".env"), "utf8"), "SECRET_KEY=keep-me");
      assert.equal(fs.readFileSync(path.join(project, "data", "projects.json"), "utf8"), '{"keep":true}');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 4. ZIP-to-Git checkout bootstrap preserves .env + data/ while connecting to origin/main
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyai-zip-git-"));
    try {
      const originSrc = path.join(tmpDir, "origin-src");
      const originBare = path.join(tmpDir, "origin.git");
      const zipDir = path.join(tmpDir, "user-zip-folder");
      fs.mkdirSync(originSrc, { recursive: true });
      runGit(originSrc, ["init", "-b", "main"]);
      runGit(originSrc, ["config", "user.email", "test@example.com"]);
      runGit(originSrc, ["config", "user.name", "Test"]);
      fs.writeFileSync(path.join(originSrc, ".gitignore"), ".env*\n!.env.example\ndata/\n", "utf8");
      fs.writeFileSync(path.join(originSrc, ".env.example"), "PORT=3012\n", "utf8");
      fs.writeFileSync(path.join(originSrc, "version.txt"), "v2\n", "utf8");
      runGit(originSrc, ["add", "."]);
      runGit(originSrc, ["commit", "-m", "v2"]);
      runGit(tmpDir, ["clone", "--bare", originSrc, originBare]);

      fs.mkdirSync(path.join(zipDir, "data"), { recursive: true });
      fs.writeFileSync(path.join(zipDir, "version.txt"), "v1-from-zip\n", "utf8");
      fs.writeFileSync(path.join(zipDir, ".env"), "SEEDANCE_CREDENTIALS_ENCRYPTION_KEY=keep-my-key\n", "utf8");
      fs.writeFileSync(path.join(zipDir, "data", "projects.json"), '{"user":1}\n', "utf8");

      runGit(zipDir, ["init"]);
      runGit(zipDir, ["remote", "add", "origin", originBare]);
      runGit(zipDir, ["fetch", "--depth", "1", "origin", "main"]);
      runGit(zipDir, ["checkout", "-f", "-B", "main", "--track", "origin/main"]);

      assert.equal(fs.readFileSync(path.join(zipDir, "version.txt"), "utf8"), "v2\n");
      assert.equal(fs.readFileSync(path.join(zipDir, ".env"), "utf8"), "SEEDANCE_CREDENTIALS_ENCRYPTION_KEY=keep-my-key\n");
      assert.equal(fs.readFileSync(path.join(zipDir, "data", "projects.json"), "utf8"), '{"user":1}\n');
      assert.equal(runGit(zipDir, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  console.log("github-tarball-and-updater tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

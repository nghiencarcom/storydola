const fs = require("node:fs");
const path = require("node:path");
const { loadEnvConfig } = require("@next/env");

const projectRoot = process.cwd();
const standaloneRoot = path.join(projectRoot, ".next", "standalone");
loadEnvConfig(projectRoot);
if (process.platform !== "win32" && (!process.env.FONTCONFIG_FILE || !fs.existsSync(process.env.FONTCONFIG_FILE))) {
  process.env.FONTCONFIG_FILE = path.join(projectRoot, "assets", "fonts", "fonts.conf");
}
const configuredDataDir = process.env.STORYAI_DATA_DIR?.trim() || "data";
process.env.STORYAI_DATA_DIR = path.isAbsolute(configuredDataDir)
  ? configuredDataDir
  : path.resolve(projectRoot, configuredDataDir);
process.env.PORT ||= "3012";
process.env.HOSTNAME ||= "127.0.0.1";

for (const [source, destination] of [
  [path.join(projectRoot, "public"), path.join(standaloneRoot, "public")],
  [path.join(projectRoot, ".next", "static"), path.join(standaloneRoot, ".next", "static")],
]) {
  if (fs.existsSync(source)) {
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
  }
}

require(path.join(standaloneRoot, "server.js"));

const fs = require("node:fs");
const path = require("node:path");
const { loadEnvConfig } = require("@next/env");

const projectRoot = process.cwd();
const standaloneRoot = path.join(projectRoot, ".next", "standalone");
loadEnvConfig(projectRoot);
process.env.PORT ||= "3011";
process.env.HOSTNAME ||= "127.0.0.1";

for (const [source, destination] of [
  [path.join(projectRoot, "public"), path.join(standaloneRoot, "public")],
  [path.join(projectRoot, ".next", "static"), path.join(standaloneRoot, ".next", "static")],
]) {
  if (fs.existsSync(source) && !fs.existsSync(destination)) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
  }
}

require(path.join(standaloneRoot, "server.js"));

const { randomBytes } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dolaRoot = path.join(root, "dola-studio");
require("./prepare-local-config.cjs");

for (const rawLine of readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const splitAt = line.indexOf("=");
  const key = line.slice(0, splitAt).trim();
  const value = line.slice(splitAt + 1).trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted ?? "");
  if (key && process.env[key] === undefined) process.env[key] = value;
}

const adminKey = process.env.DOLA_ADMIN_KEY?.trim()
  || process.env.DOLA_GATEWAY_ADMIN_KEY?.trim()
  || randomBytes(32).toString("hex");
const env = {
  ...process.env,
  DOLA_STUDIO_PORT: "3117",
  DOLA_GATEWAY_PORT: "8210",
  DOLA_PORT: "8210",
  DOLA_HOST: "127.0.0.1",
  DOLA_CLEAR_OLD_PORTS: "0",
  STORYAI_LOCAL_URL: "http://127.0.0.1:3021",
  DOLA_ADMIN_KEY: adminKey,
  DOLA_GATEWAY_ADMIN_KEY: adminKey,
};
const windowsNative = process.platform === "win32";
const npmExecPath = process.env.npm_execpath;
const command = windowsNative && npmExecPath ? process.execPath : "npm";
const args = windowsNative && npmExecPath
  ? [npmExecPath, "--prefix", dolaRoot, "run", "dev"]
  : ["--prefix", dolaRoot, "run", "dev"];
const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });

child.once("error", (error) => {
  console.error(`[Dola] ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) process.exitCode = 1;
  else process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

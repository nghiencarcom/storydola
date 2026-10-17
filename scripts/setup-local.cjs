const { spawnSync } = require("node:child_process");
const path = require("node:path");

const isWindows = process.platform === "win32";
const command = isWindows ? "powershell.exe" : "sh";
const args = isWindows
  ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "setup-local.ps1")]
  : [path.join(__dirname, "setup-local.sh")];

const result = spawnSync(command, args, { stdio: "inherit" });
if (result.error) {
  console.error(`Không thể chạy setup: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

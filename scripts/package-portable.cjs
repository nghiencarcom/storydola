const { spawnSync } = require("node:child_process");
const path = require("node:path");

const scriptPath = path.join(__dirname, "package-portable.py");
const candidates = process.platform === "win32"
  ? [
      ["py", ["-3"]],
      ["python", []],
    ]
  : [
      ["python3", []],
      ["python", []],
    ];

for (const [command, prefixArgs] of candidates) {
  const probe = spawnSync(command, [
    ...prefixArgs,
    "-c",
    "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)",
  ], { stdio: "ignore", windowsHide: true });

  if (probe.error?.code === "ENOENT" || probe.status !== 0) continue;
  if (probe.error) {
    console.error(`Không kiểm tra được Python: ${probe.error.message}`);
    process.exit(1);
  }

  const result = spawnSync(command, [...prefixArgs, scriptPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    console.error(`Không thể chạy công cụ đóng gói: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

console.error("Cần Python 3.11+ để đóng gói. Hãy cài Python rồi chạy lại npm run package:portable.");
process.exit(1);

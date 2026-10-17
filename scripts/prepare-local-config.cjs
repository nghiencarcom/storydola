const { randomBytes } = require("node:crypto");
const { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const configPath = path.resolve(__dirname, "..", ".env.local");

if (!existsSync(configPath)) {
  const secret = randomBytes(32).toString("hex");
  const adminKey = randomBytes(32).toString("hex");
  const lines = [
    "# Generated for this computer. Keep this file private and do not copy it into source archives.",
    "OPENAI_API_KEY=",
    `STORYAI_CREDENTIALS_ENCRYPTION_KEY=${secret}`,
    `SEEDANCE_CREDENTIALS_ENCRYPTION_KEY=${secret}`,
    "STORYAI_SEEDANCE_BACKEND=dola-gateway",
    "STORYAI_SEEDANCE_GATEWAY_URL=http://127.0.0.1:8210",
    "STORYAI_LOCAL_BASE_URL=http://127.0.0.1:3021",
    "STORYAI_LOCAL_AUTH_BYPASS=1",
    "STORYAI_LOCAL_USER_ID=local",
    "DOLA_GATEWAY_URL=http://127.0.0.1:8210",
    `DOLA_ADMIN_KEY=${adminKey}`,
    `DOLA_GATEWAY_ADMIN_KEY=${adminKey}`,
    "DOLA_PROXY=",
    "MAIVIDEO_BASE_URL=https://maivideo.top",
    "MAIVIDEO_AUTH_BASE_URL=https://maivideo.top",
    "MAIVIDEO_AUTH_LOCAL_BASE_URL=https://maivideo.top",
    "MAIVIDEO_VIDEO_MODEL=seedance-2.5",
    "MAIVIDEO_VIDEO_DURATION=5",
    "STORYAI_PORT=3021",
    "DOLA_STUDIO_PORT=3117",
    "DOLA_GATEWAY_PORT=8210",
  ];
  writeFileSync(configPath, `${lines.join("\n")}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(configPath, 0o600);
  console.log("Đã tạo .env.local với khóa mã hóa riêng cho máy này.");
} else {
  const currentConfig = readFileSync(configPath, "utf8");
  const missingLines = [];
  if (!/^\s*STORYAI_LOCAL_AUTH_BYPASS=/m.test(currentConfig)) missingLines.push("STORYAI_LOCAL_AUTH_BYPASS=1");
  if (!/^\s*STORYAI_LOCAL_USER_ID=/m.test(currentConfig)) missingLines.push("STORYAI_LOCAL_USER_ID=local");
  if (!/^\s*DOLA_PROXY=/m.test(currentConfig)) missingLines.push("DOLA_PROXY=");
  const readValue = (name) => {
    const line = currentConfig.split(/\r?\n/).find((entry) => new RegExp(`^\\s*${name}\\s*=`).test(entry));
    return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted ?? "") : "";
  };
  let nextConfig = currentConfig;
  const adminKey = process.env.DOLA_ADMIN_KEY?.trim()
    || process.env.DOLA_GATEWAY_ADMIN_KEY?.trim()
    || readValue("DOLA_ADMIN_KEY")
    || readValue("DOLA_GATEWAY_ADMIN_KEY")
    || randomBytes(32).toString("hex");
  for (const name of ["DOLA_ADMIN_KEY", "DOLA_GATEWAY_ADMIN_KEY"]) {
    const linePattern = new RegExp(`^\\s*${name}\\s*=.*$`, "m");
    if (linePattern.test(nextConfig)) {
      if (!readValue(name)) nextConfig = nextConfig.replace(linePattern, `${name}=${adminKey}`);
    } else {
      missingLines.push(`${name}=${adminKey}`);
    }
  }
  if (missingLines.length) nextConfig += `${nextConfig.endsWith("\n") ? "" : "\n"}${missingLines.join("\n")}\n`;
  if (nextConfig !== currentConfig) writeFileSync(configPath, nextConfig, "utf8");
  chmodSync(configPath, 0o600);
}

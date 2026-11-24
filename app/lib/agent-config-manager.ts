import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

export type CodingAgent = "codex" | "claude" | "antigravity";
type AgentConfigStatus = { installed: boolean; needsUpdate?: boolean; configPath: string; error?: "INVALID_JSON" | "INVALID_TOML" | "CONFIG_ACCESS_FAILED" };

function configPathFor(agent: CodingAgent) {
  const home = homedir();
  if (agent === "codex") return path.join(home, ".codex", "config.toml");
  if (agent === "claude") return path.join(home, ".claude.json");
  return path.join(home, ".gemini", "config", "mcp_config.json");
}

function parseRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readToml(content: string) {
  try { return parseToml(content.replace(/^\uFEFF/, "")); }
  catch { throw new Error("AGENT_CONFIG_INVALID_TOML"); }
}

function mergeCodexToml(current: string, nodePath: string, scriptPath: string, baseUrl: string, token: string) {
  const root = readToml(current);
  const servers = parseRecord(root.mcp_servers);
  root.mcp_servers = { ...servers, storyai: {
    command: nodePath, args: [scriptPath], startup_timeout_sec: 60, tool_timeout_sec: 1800,
    env: { STORYAI_URL: baseUrl, STORYAI_MCP_TOKEN: token },
  } };
  return stringifyToml(root);
}

function jsonAgentEntry(agent: Exclude<CodingAgent, "codex">, nodePath: string, scriptPath: string, baseUrl: string, token: string) {
  const env = { STORYAI_URL: baseUrl, STORYAI_MCP_TOKEN: token };
  if (agent === "claude") return { type: "stdio", command: nodePath, args: [scriptPath], env };
  return { command: nodePath, args: [scriptPath], env, timeoutSeconds: 1_800 };
}

async function readExistingJson(filePath: string) {
  try {
    const content = await readFile(filePath, "utf8");
    try {
      const value = JSON.parse(content.replace(/^\uFEFF/, "")) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AGENT_CONFIG_INVALID_JSON");
      mergeJsonServer(value, {});
      return { content, value };
    } catch {
      throw new Error("AGENT_CONFIG_INVALID_JSON");
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return { content: "", value: {} };
    throw cause;
  }
}

async function backupIfNeeded(filePath: string, previous: string, next: string) {
  if (!previous || previous === next) return undefined;
  const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
  const backupPath = `${filePath}.storyai-backup-${stamp}`;
  await copyFile(filePath, backupPath);
  try { await chmod(backupPath, 0o600); } catch { /* Windows permissions use inherited ACLs. */ }
  return backupPath;
}

async function writeConfig(filePath: string, previous: string, next: string) {
  if (previous === next) {
    try { await chmod(filePath, 0o600); } catch { /* Windows permissions use inherited ACLs. */ }
    return undefined;
  }
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const backupPath = await backupIfNeeded(filePath, previous, next);
  const temporaryPath = `${filePath}.storyai-${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, next, { flag: "wx", mode: 0o600 });
    try { await chmod(temporaryPath, 0o600); } catch { /* Windows permissions use inherited ACLs. */ }
    await rename(temporaryPath, filePath);
  } catch (cause) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw cause;
  }
  try { await chmod(filePath, 0o600); } catch { /* Windows permissions use inherited ACLs. */ }
  return backupPath;
}

function jsonServerToken(value: unknown, agent: Exclude<CodingAgent, "codex">) {
  const root = parseRecord(value);
  const servers = parseRecord(root.mcpServers);
  const entry = parseRecord(servers.storyai);
  const env = parseRecord(entry.env);
  return {
    installed: Object.hasOwn(servers, "storyai"),
    token: typeof env.STORYAI_MCP_TOKEN === "string" ? env.STORYAI_MCP_TOKEN : "",
    hasLegacyAntigravityTimeout: agent === "antigravity" && Object.hasOwn(entry, "timeout"),
  };
}

function mergeJsonServer(value: unknown, entry: Record<string, unknown>) {
  const root = parseRecord(value);
  const existingServers = root.mcpServers;
  if (existingServers !== undefined && (!existingServers || typeof existingServers !== "object" || Array.isArray(existingServers))) {
    throw new Error("AGENT_CONFIG_INVALID_JSON");
  }
  return { ...root, mcpServers: { ...parseRecord(existingServers), storyai: entry } };
}

export async function getCodingAgentConfigStatuses(currentToken?: string | null): Promise<Record<CodingAgent, AgentConfigStatus>> {
  const statuses = {} as Record<CodingAgent, AgentConfigStatus>;
  for (const agent of ["codex", "claude", "antigravity"] as const) {
    const configPath = configPathFor(agent);
    if (agent === "codex") {
      try {
        const content = await readFile(configPath, "utf8");
        const servers = parseRecord(readToml(content).mcp_servers);
        const installed = Object.hasOwn(servers, "storyai");
        const hasCurrentToken = typeof currentToken === "string" && parseRecord(parseRecord(servers.storyai).env).STORYAI_MCP_TOKEN === currentToken;
        statuses[agent] = { installed, ...(installed && currentToken !== undefined && !hasCurrentToken ? { needsUpdate: true } : {}), configPath };
      } catch (cause) {
        statuses[agent] = (cause as NodeJS.ErrnoException)?.code === "ENOENT"
          ? { installed: false, configPath }
          : { installed: false, configPath, error: cause instanceof Error && cause.message === "AGENT_CONFIG_INVALID_TOML" ? "INVALID_TOML" : "CONFIG_ACCESS_FAILED" };
      }
      continue;
    }
    try {
      const { value } = await readExistingJson(configPath);
      const status = jsonServerToken(value, agent);
      const needsUpdate = status.installed && (
        (currentToken !== undefined && status.token !== currentToken)
        || status.hasLegacyAntigravityTimeout
      );
      statuses[agent] = { installed: status.installed, ...(needsUpdate ? { needsUpdate: true } : {}), configPath };
    } catch (cause) {
      statuses[agent] = { installed: false, configPath, error: cause instanceof Error && cause.message === "AGENT_CONFIG_INVALID_JSON" ? "INVALID_JSON" : "CONFIG_ACCESS_FAILED" };
    }
  }
  return statuses;
}

export async function installCodingAgentConfig(input: {
  agent: CodingAgent;
  nodePath: string;
  scriptPath: string;
  baseUrl: string;
  token: string;
  repairInvalidConfig?: boolean;
}) {
  const { agent, nodePath, scriptPath, baseUrl, token } = input;
  const configPath = configPathFor(agent);
  if (agent === "codex") {
    let previous = "";
    try { previous = await readFile(configPath, "utf8"); }
    catch (cause) { if ((cause as NodeJS.ErrnoException)?.code !== "ENOENT") throw cause; }
    let next;
    try { next = mergeCodexToml(previous, nodePath, scriptPath, baseUrl, token); }
    catch (cause) {
      if (!input.repairInvalidConfig || !(cause instanceof Error) || cause.message !== "AGENT_CONFIG_INVALID_TOML") throw cause;
      next = mergeCodexToml("", nodePath, scriptPath, baseUrl, token);
    }
    const backupPath = await writeConfig(configPath, previous, next);
    return { agent, configPath, ...(backupPath ? { backupPath } : {}) };
  }

  let existing;
  try { existing = await readExistingJson(configPath); }
  catch (cause) {
    if (!input.repairInvalidConfig || !(cause instanceof Error) || cause.message !== "AGENT_CONFIG_INVALID_JSON") throw cause;
    existing = { content: await readFile(configPath, "utf8"), value: {} };
  }
  const { content, value } = existing;
  const nextValue = mergeJsonServer(value, jsonAgentEntry(agent, nodePath, scriptPath, baseUrl, token));
  const next = `${JSON.stringify(nextValue, null, 2)}\n`;
  const backupPath = await writeConfig(configPath, content, next);
  return { agent, configPath, ...(backupPath ? { backupPath } : {}) };
}

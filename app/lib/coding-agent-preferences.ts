import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DATA_DIR } from "./data-directory";
import type { CodingAgent } from "./coding-agent-cli";
import type { CodingAgentEffort, CodingAgentSpeed } from "./coding-agent-models";

const STORE_FILE = path.join(DATA_DIR, "coding-agent-preferences.json");
export type CodingAgentPreference = { agent: CodingAgent; model: string; quality: "auto" | CodingAgentEffort; speed: CodingAgentSpeed };
type PreferenceRecord = CodingAgentPreference & { ownerId: string; updatedAt: string };
type PreferenceFile = { preferences: PreferenceRecord[] };

let writeQueue: Promise<unknown> = Promise.resolve();

function isAgent(value: unknown): value is CodingAgent {
  return value === "codex" || value === "claude" || value === "antigravity";
}

function normalizeQuality(value: unknown): CodingAgentPreference["quality"] {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max" || value === "ultra" ? value : "auto";
}

function normalizeSpeed(value: unknown): CodingAgentSpeed {
  return value === "fast" ? "fast" : "standard";
}

async function readStore(): Promise<PreferenceFile> {
  try {
    const parsed = JSON.parse(await readFile(STORE_FILE, "utf8")) as Partial<PreferenceFile>;
    return { preferences: Array.isArray(parsed.preferences) ? parsed.preferences.filter((item) => item && typeof item.ownerId === "string" && isAgent(item.agent)) : [] };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return { preferences: [] };
    throw new Error("CODING_AGENT_PREFERENCES_UNAVAILABLE");
  }
}

async function writeStore(data: PreferenceFile) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(DATA_DIR, `.coding-agent-preferences.${randomBytes(8).toString("hex")}.tmp`);
  await writeFile(temporaryPath, JSON.stringify(data), { flag: "wx", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, STORE_FILE);
  await chmod(STORE_FILE, 0o600);
}

export async function getCodingAgentPreference(ownerId: string): Promise<CodingAgentPreference | undefined> {
  const record = (await readStore()).preferences.find((item) => item.ownerId === ownerId.trim());
  return record ? { agent: record.agent, model: record.model, quality: normalizeQuality(record.quality), speed: normalizeSpeed(record.speed) } : undefined;
}

export async function saveCodingAgentPreference(ownerId: string, preference: CodingAgentPreference) {
  const normalizedOwnerId = ownerId.trim();
  if (!normalizedOwnerId || !isAgent(preference.agent) || (preference.model && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/u.test(preference.model))) {
    throw new Error("CODING_AGENT_PREFERENCE_INVALID");
  }
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const data = await readStore();
    data.preferences = data.preferences.filter((item) => item.ownerId !== normalizedOwnerId);
    data.preferences.push({
      ownerId: normalizedOwnerId, agent: preference.agent, model: preference.model.trim(),
      quality: normalizeQuality(preference.quality), speed: normalizeSpeed(preference.speed), updatedAt: new Date().toISOString(),
    });
    await writeStore(data);
  });
  await writeQueue;
}

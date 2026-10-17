import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getCurrentUserId } from "./auth-server";
import { DEFAULT_RUN_CONCURRENCY, normalizeRunConcurrency } from "./run-concurrency-config";

const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(DATA_DIR, "user-settings.json");

type UserSettings = { maxConcurrentJobs: number };
type SettingsFile = { users: Record<string, UserSettings> };

let mutationQueue: Promise<unknown> = Promise.resolve();

async function readSettingsFile(): Promise<SettingsFile> {
  try {
    const parsed = JSON.parse(await readFile(SETTINGS_FILE, "utf8")) as { users?: unknown };
    if (!parsed.users || typeof parsed.users !== "object" || Array.isArray(parsed.users)) return { users: {} };
    const users: Record<string, UserSettings> = {};
    for (const [userId, value] of Object.entries(parsed.users)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      const limit = Number(record.maxConcurrentJobs);
      if (Number.isInteger(limit)) users[userId] = { maxConcurrentJobs: normalizeRunConcurrency(limit) };
    }
    return { users };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return { users: {} };
    throw new Error("USER_SETTINGS_STORE_UNAVAILABLE");
  }
}

async function writeSettingsFile(value: SettingsFile) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(DATA_DIR, `.user-settings.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, SETTINGS_FILE);
  await chmod(SETTINGS_FILE, 0o600);
}

async function currentUserId(userIdOverride?: string) {
  return userIdOverride?.trim() || await getCurrentUserId();
}

export function getDefaultRunConcurrency() {
  return DEFAULT_RUN_CONCURRENCY;
}

export async function getRunConcurrencyLimit(userIdOverride?: string) {
  const userId = await currentUserId(userIdOverride);
  const settings = await readSettingsFile();
  return settings.users[userId]?.maxConcurrentJobs ?? getDefaultRunConcurrency();
}

export async function saveRunConcurrencyLimit(userId: string, maxConcurrentJobs: number) {
  let result!: UserSettings;
  mutationQueue = mutationQueue.catch(() => undefined).then(async () => {
    const settings = await readSettingsFile();
    result = { maxConcurrentJobs: normalizeRunConcurrency(maxConcurrentJobs) };
    settings.users[userId] = result;
    await writeSettingsFile(settings);
  });
  await mutationQueue;
  return result;
}

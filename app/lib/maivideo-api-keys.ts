import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCurrentUserId } from "./auth-server";

const DATA_DIR = path.join(process.cwd(), "data");
const KEYS_FILE = path.join(DATA_DIR, "maivideo-api-keys.json");
const API_BASE_URL = (process.env.MAIVIDEO_BASE_URL || process.env.MAIVIDEO_API_BASE_URL || "https://maivideo.top").replace(/\/$/, "");

type EncryptedSecret = { iv: string; tag: string; ciphertext: string };
type StoredKey = { secret: EncryptedSecret; lastFour: string; updatedAt: string };
type KeysFile = { users: Record<string, StoredKey> };
export type MaiVideoApiKeyStatus = { configured: boolean; source: "settings" | "server" | "none"; lastFour?: string; updatedAt?: string; encryptionReady: boolean };

const EMPTY_FILE: KeysFile = { users: {} };
let writeQueue: Promise<unknown> = Promise.resolve();

function encryptionSecret() {
  const secret = process.env.STORYAI_CREDENTIALS_ENCRYPTION_KEY?.trim()
    || process.env.SEEDANCE_CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) throw new Error("MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED");
  return createHash("sha256").update(secret).digest();
}

export function maiVideoApiKeyEncryptionReady() {
  const secret = process.env.STORYAI_CREDENTIALS_ENCRYPTION_KEY?.trim()
    || process.env.SEEDANCE_CREDENTIALS_ENCRYPTION_KEY?.trim();
  return Boolean(secret && secret.length >= 32);
}

function encryptSecret(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionSecret(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("hex") };
}

function decryptSecret(value: EncryptedSecret) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionSecret(), Buffer.from(value.iv, "hex"));
  decipher.setAuthTag(Buffer.from(value.tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "hex")), decipher.final()]).toString("utf8");
}

async function readKeysFile(): Promise<KeysFile> {
  try {
    const parsed = JSON.parse(await readFile(KEYS_FILE, "utf8")) as { users?: unknown };
    if (!parsed.users || typeof parsed.users !== "object" || Array.isArray(parsed.users)) return structuredClone(EMPTY_FILE);
    const users: Record<string, StoredKey> = {};
    for (const [userId, value] of Object.entries(parsed.users)) {
      const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
      const candidates = [record, record.image, record.video].filter(isStoredKey);
      const latest = candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (latest) users[userId] = latest;
    }
    return { users };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return structuredClone(EMPTY_FILE);
    throw new Error("MAIVIDEO_API_KEY_STORE_UNAVAILABLE");
  }
}

function isStoredKey(value: unknown): value is StoredKey {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredKey>;
  const secret = record.secret;
  return Boolean(
    secret && typeof secret.iv === "string" && typeof secret.tag === "string" && typeof secret.ciphertext === "string"
    && typeof record.lastFour === "string" && typeof record.updatedAt === "string",
  );
}

async function writeKeysFile(data: KeysFile) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  await writeFile(KEYS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  await chmod(KEYS_FILE, 0o600);
}

async function updateKeysFile<T>(mutator: (data: KeysFile) => T | Promise<T>) {
  let result!: T;
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const data = await readKeysFile();
    result = await mutator(data);
    await writeKeysFile(data);
  });
  await writeQueue;
  return result;
}

function legacyServerKey(): string {
  return process.env.MAIVIDEO_API_KEY?.trim()
    || process.env.MAIVIDEO_IMAGE_API_KEY?.trim()
    || process.env.MAIVIDEO_VIDEO_API_KEY?.trim()
    || "";
}

export async function getMaiVideoApiKey(userIdOverride?: string): Promise<string> {
  const userId = userIdOverride?.trim() || await getCurrentUserId();
  const data = await readKeysFile();
  const stored = data.users[userId];
  if (stored) return decryptSecret(stored.secret);
  return legacyServerKey();
}

export async function listMaiVideoApiKeyStatus() {
  const userId = await getCurrentUserId();
  const data = await readKeysFile();
  const stored = data.users[userId];
  const serverKey = legacyServerKey();
  return {
    configured: Boolean(stored || serverKey),
    source: stored ? "settings" as const : serverKey ? "server" as const : "none" as const,
    lastFour: stored?.lastFour || (serverKey ? serverKey.slice(-4) : undefined),
    updatedAt: stored?.updatedAt,
    encryptionReady: maiVideoApiKeyEncryptionReady(),
  };
}

export async function verifyMaiVideoApiKey(apiKey: string) {
  const endpoints = [
    "/api/v1/image-generation/models",
    "/api/v1/video-generation/models",
    "/api/v1/voices?provider=omnivoice",
  ];
  const responses = await Promise.all(endpoints.map((endpoint) => fetch(`${API_BASE_URL}${endpoint}`, {
    headers: { Accept: "application/json", "X-API-Key": apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)));
  if (responses.some((response) => !response)) throw new Error("MAIVIDEO_CONNECTION_FAILED");
  const failedResponse = responses.find((response) => response && !response.ok);
  if (!failedResponse) return;
  if (failedResponse.status === 401 || failedResponse.status === 403) throw new Error("MAIVIDEO_API_KEY_INVALID");
  if (failedResponse.status === 429) throw new Error("MAIVIDEO_RATE_LIMITED");
  if (failedResponse.status >= 500) throw new Error(`MAIVIDEO_SERVICE_UNAVAILABLE_${failedResponse.status}`);
  throw new Error(`MAIVIDEO_API_KEY_REJECTED_${failedResponse.status}`);
}

export async function saveMaiVideoApiKey(apiKey: string) {
  const userId = await getCurrentUserId();
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) throw new Error("MAIVIDEO_API_KEY_INPUT_REQUIRED");
  const secret = encryptSecret(normalizedKey);
  const updatedAt = new Date().toISOString();
  return updateKeysFile((data) => {
    data.users[userId] = { secret, lastFour: normalizedKey.slice(-4), updatedAt };
    return { configured: true, source: "settings" as const, lastFour: normalizedKey.slice(-4), updatedAt };
  });
}

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCurrentUserId } from "./auth-server";

const DATA_DIR = path.join(process.cwd(), "data");
const KEYS_FILE = path.join(DATA_DIR, "openai-api-keys.json");

type EncryptedSecret = { iv: string; tag: string; ciphertext: string };
type StoredKey = { secret: EncryptedSecret; lastFour: string; updatedAt: string };
type KeysFile = { users: Record<string, StoredKey> };
export type OpenAIApiKeyStatus = {
  configured: boolean;
  source: "settings" | "server" | "none";
  lastFour?: string;
  updatedAt?: string;
  encryptionReady: boolean;
};

const EMPTY_FILE: KeysFile = { users: {} };
let writeQueue: Promise<unknown> = Promise.resolve();

function encryptionSecret() {
  const secret = process.env.STORYAI_CREDENTIALS_ENCRYPTION_KEY?.trim()
    || process.env.SEEDANCE_CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) throw new Error("OPENAI_CREDENTIALS_ENCRYPTION_KEY_REQUIRED");
  return createHash("sha256").update(secret).digest();
}

export function openAIApiKeyEncryptionReady() {
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

function isStoredKey(value: unknown): value is StoredKey {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredKey>;
  const secret = record.secret;
  return Boolean(
    secret && typeof secret.iv === "string" && typeof secret.tag === "string" && typeof secret.ciphertext === "string"
    && typeof record.lastFour === "string" && typeof record.updatedAt === "string",
  );
}

async function readKeysFile(): Promise<KeysFile> {
  try {
    const parsed = JSON.parse(await readFile(KEYS_FILE, "utf8")) as { users?: unknown };
    if (!parsed.users || typeof parsed.users !== "object" || Array.isArray(parsed.users)) return structuredClone(EMPTY_FILE);
    const users: Record<string, StoredKey> = {};
    for (const [userId, value] of Object.entries(parsed.users)) {
      if (isStoredKey(value)) users[userId] = value;
    }
    return { users };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return structuredClone(EMPTY_FILE);
    throw new Error("OPENAI_API_KEY_STORE_UNAVAILABLE");
  }
}

async function writeKeysFile(data: KeysFile) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(DATA_DIR, `.openai-api-keys.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, KEYS_FILE);
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

function serverApiKey() {
  return process.env.OPENAI_API_KEY?.trim() || "";
}

export async function getOpenAIApiKey(userIdOverride?: string) {
  let userId = userIdOverride?.trim();
  if (!userId) {
    try { userId = await getCurrentUserId(); } catch { /* Background callers may only have a server key. */ }
  }
  if (userId) {
    const stored = (await readKeysFile()).users[userId];
    if (stored) return decryptSecret(stored.secret);
  }
  return serverApiKey();
}

export async function listOpenAIApiKeyStatus(): Promise<OpenAIApiKeyStatus> {
  const userId = await getCurrentUserId();
  const stored = (await readKeysFile()).users[userId];
  const fallback = serverApiKey();
  return {
    configured: Boolean(stored || fallback),
    source: stored ? "settings" : fallback ? "server" : "none",
    lastFour: stored?.lastFour || (fallback ? fallback.slice(-4) : undefined),
    updatedAt: stored?.updatedAt,
    encryptionReady: openAIApiKeyEncryptionReady(),
  };
}

export async function saveOpenAIApiKey(apiKey: string) {
  const userId = await getCurrentUserId();
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) throw new Error("OPENAI_API_KEY_INPUT_REQUIRED");
  if (!openAIApiKeyEncryptionReady()) throw new Error("OPENAI_CREDENTIALS_ENCRYPTION_KEY_REQUIRED");
  const secret = encryptSecret(normalizedKey);
  const updatedAt = new Date().toISOString();
  return updateKeysFile((data) => {
    data.users[userId] = { secret, lastFour: normalizedKey.slice(-4), updatedAt };
    return { configured: true as const, source: "settings" as const, lastFour: normalizedKey.slice(-4), updatedAt };
  });
}

export async function deleteOpenAIApiKey() {
  const userId = await getCurrentUserId();
  await updateKeysFile((data) => { delete data.users[userId]; });
  return listOpenAIApiKeyStatus();
}

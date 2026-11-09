import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "higgsfield-job-sessions.json");

type EncryptedToken = { iv: string; tag: string; ciphertext: string };
type StoredSession = { ownerId: string; jobId: string; token: EncryptedToken; updatedAt: string };
type SessionFile = { sessions: StoredSession[] };

let writeQueue: Promise<unknown> = Promise.resolve();

function encryptionKey() {
  const secret = process.env.STORYAI_CREDENTIALS_ENCRYPTION_KEY?.trim()
    || process.env.SEEDANCE_CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) throw new Error("HIGGSFIELD_SESSION_ENCRYPTION_KEY_REQUIRED");
  return createHash("sha256").update(secret).digest();
}

export function higgsfieldSessionEncryptionReady() {
  const secret = process.env.STORYAI_CREDENTIALS_ENCRYPTION_KEY?.trim()
    || process.env.SEEDANCE_CREDENTIALS_ENCRYPTION_KEY?.trim();
  return Boolean(secret && secret.length >= 32);
}

function encryptToken(value: string): EncryptedToken {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("hex") };
}

function decryptToken(value: EncryptedToken) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(value.iv, "hex"));
  decipher.setAuthTag(Buffer.from(value.tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "hex")), decipher.final()]).toString("utf8");
}

async function readStore(): Promise<SessionFile> {
  try {
    const parsed = JSON.parse(await readFile(STORE_FILE, "utf8")) as Partial<SessionFile>;
    return { sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return { sessions: [] };
    throw new Error("HIGGSFIELD_SESSION_STORE_UNAVAILABLE");
  }
}

async function writeStore(data: SessionFile) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(DATA_DIR, `.higgsfield-job-sessions.${randomBytes(8).toString("hex")}.tmp`);
  await writeFile(temporaryPath, JSON.stringify(data), { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, STORE_FILE);
  await chmod(STORE_FILE, 0o600);
}

async function updateStore<T>(update: (data: SessionFile) => T) {
  let result!: T;
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const data = await readStore();
    result = update(data);
    await writeStore(data);
  });
  await writeQueue;
  return result;
}

export async function saveHiggsfieldSessionToken(ownerId: string, jobId: string, token: string) {
  const normalizedOwnerId = ownerId.trim();
  const normalizedJobId = jobId.trim();
  const normalizedToken = token.trim();
  if (!normalizedOwnerId || !normalizedJobId || !normalizedToken || normalizedToken.length > 4_096) {
    throw new Error("HIGGSFIELD_SESSION_REQUIRED");
  }
  const encryptedToken = encryptToken(normalizedToken);
  await updateStore((data) => {
    const existing = data.sessions.find((item) => item.ownerId === normalizedOwnerId && item.jobId === normalizedJobId);
    const stored: StoredSession = { ownerId: normalizedOwnerId, jobId: normalizedJobId, token: encryptedToken, updatedAt: new Date().toISOString() };
    if (existing) Object.assign(existing, stored);
    else data.sessions.push(stored);
    data.sessions = data.sessions.filter((item) => Date.now() - Date.parse(item.updatedAt) < 90 * 24 * 60 * 60 * 1000);
  });
}

export async function getHiggsfieldSessionToken(ownerId: string, jobId: string) {
  const stored = (await readStore()).sessions.find((item) => item.ownerId === ownerId && item.jobId === jobId);
  return stored ? decryptToken(stored.token) : "";
}

export async function deleteHiggsfieldSessionToken(ownerId: string, jobId: string) {
  await updateStore((data) => {
    data.sessions = data.sessions.filter((item) => item.ownerId !== ownerId || item.jobId !== jobId);
  });
}

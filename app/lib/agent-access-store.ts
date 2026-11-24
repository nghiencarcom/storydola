import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./data-directory";

const STORE_FILE = path.join(DATA_DIR, "agent-access.json");
const TOKEN_PREFIX = "storyai_mcp_";

type EncryptedValue = { iv: string; tag: string; ciphertext: string };
type AgentAccessRecord = {
  ownerId: string;
  tokenHash: string;
  encryptedAgentToken?: EncryptedValue;
  encryptedMaiVideoToken: EncryptedValue;
  createdAt: string;
};
type AgentAccessFile = { tokens: AgentAccessRecord[] };

let writeQueue: Promise<unknown> = Promise.resolve();

function encryptionKey() {
  const secret = process.env.STORYAI_CREDENTIALS_ENCRYPTION_KEY?.trim()
    || process.env.SEEDANCE_CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) throw new Error("AGENT_ACCESS_ENCRYPTION_KEY_REQUIRED");
  return createHash("sha256").update(secret).digest();
}

export function agentAccessEncryptionReady() {
  const secret = process.env.STORYAI_CREDENTIALS_ENCRYPTION_KEY?.trim()
    || process.env.SEEDANCE_CREDENTIALS_ENCRYPTION_KEY?.trim();
  return Boolean(secret && secret.length >= 32);
}

export function encrypt(value: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("hex") };
}

export function decrypt(value: EncryptedValue) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(value.iv, "hex"));
  decipher.setAuthTag(Buffer.from(value.tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "hex")), decipher.final()]).toString("utf8");
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function readStore(): Promise<AgentAccessFile> {
  try {
    const parsed = JSON.parse(await readFile(STORE_FILE, "utf8")) as Partial<AgentAccessFile>;
    return { tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [] };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return { tokens: [] };
    throw new Error("AGENT_ACCESS_STORE_UNAVAILABLE");
  }
}

async function writeStore(data: AgentAccessFile) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(DATA_DIR, `.agent-access.${randomBytes(8).toString("hex")}.tmp`);
  await writeFile(temporaryPath, JSON.stringify(data), { flag: "wx", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, STORE_FILE);
  await chmod(STORE_FILE, 0o600);
}

async function updateStore<T>(update: (data: AgentAccessFile) => T) {
  let result!: T;
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const data = await readStore();
    result = update(data);
    await writeStore(data);
  });
  await writeQueue;
  return result;
}

export async function getAgentAccessStatus(ownerId: string) {
  const record = (await readStore()).tokens.find((item) => item.ownerId === ownerId);
  return record ? { configured: true, createdAt: record.createdAt, autoInstallReady: Boolean(record.encryptedAgentToken) } : { configured: false, autoInstallReady: false };
}

export async function createAgentAccessToken(ownerId: string, maiVideoToken: string) {
  const normalizedOwnerId = ownerId.trim();
  const normalizedMaiVideoToken = maiVideoToken.trim();
  if (!normalizedOwnerId || !normalizedMaiVideoToken || normalizedMaiVideoToken.length > 4_096) {
    throw new Error("AGENT_ACCESS_REQUIRES_AUTH");
  }
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const createdAt = new Date().toISOString();
  const record: AgentAccessRecord = {
    ownerId: normalizedOwnerId,
    tokenHash: tokenHash(token),
    encryptedAgentToken: encrypt(token),
    encryptedMaiVideoToken: encrypt(normalizedMaiVideoToken),
    createdAt,
  };
  await updateStore((data) => {
    data.tokens = data.tokens.filter((item) => item.ownerId !== normalizedOwnerId);
    data.tokens.push(record);
  });
  return { token, createdAt };
}

export async function getAgentAccessCredentials(ownerId: string) {
  const record = (await readStore()).tokens.find((item) => item.ownerId === ownerId.trim());
  if (!record) return undefined;
  if (!record.encryptedAgentToken) throw new Error("AGENT_ACCESS_ROTATE_REQUIRED");
  try {
    return {
      token: decrypt(record.encryptedAgentToken),
      maiVideoToken: decrypt(record.encryptedMaiVideoToken),
      createdAt: record.createdAt,
    };
  } catch {
    throw new Error("AGENT_ACCESS_STORE_UNAVAILABLE");
  }
}

export async function revokeAgentAccessToken(ownerId: string) {
  const normalizedOwnerId = ownerId.trim();
  await updateStore((data) => {
    data.tokens = data.tokens.filter((item) => item.ownerId !== normalizedOwnerId);
  });
}

export async function resolveAgentAccessToken(token: string) {
  const normalizedToken = token.trim();
  if (!normalizedToken.startsWith(TOKEN_PREFIX) || normalizedToken.length > 128) return undefined;
  const suppliedHash = Buffer.from(tokenHash(normalizedToken), "hex");
  const record = (await readStore()).tokens.find((item) => {
    const storedHash = Buffer.from(item.tokenHash, "hex");
    return storedHash.length === suppliedHash.length && timingSafeEqual(storedHash, suppliedHash);
  });
  if (!record) return undefined;
  try {
    return { ownerId: record.ownerId, maiVideoToken: decrypt(record.encryptedMaiVideoToken) };
  } catch {
    throw new Error("AGENT_ACCESS_STORE_UNAVAILABLE");
  }
}

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCurrentUserId } from "./auth-server";

const DATA_DIR = path.join(process.cwd(), "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "seedance-accounts.json");
const SEEDANCE_BASE_URL = "https://seedance.maivideo.top";

type EncryptedSecret = { iv: string; tag: string; ciphertext: string };
type StoredAccount = { id: string; ownerId?: string; name: string; apiKey: EncryptedSecret; lastFour: string; createdAt: string };
type AccountFile = { accounts: StoredAccount[]; defaultAccountId?: string; defaultAccountByUser?: Record<string, string> };
export type SeedanceAccountSummary = { id: string; name: string; lastFour: string; createdAt: string; isDefault: boolean };

const EMPTY_ACCOUNTS: AccountFile = { accounts: [], defaultAccountByUser: {} };
let writeQueue: Promise<unknown> = Promise.resolve();

function encryptionKey() {
  const secret = process.env.SEEDANCE_CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) throw new Error("SEEDANCE_ENCRYPTION_KEY_REQUIRED");
  return createHash("sha256").update(secret).digest();
}

function encryptApiKey(apiKey: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return { iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("hex") };
}

function decryptApiKey(secret: EncryptedSecret) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(secret.iv, "hex"));
  decipher.setAuthTag(Buffer.from(secret.tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "hex")), decipher.final()]).toString("utf8");
}

async function readAccountFile(): Promise<AccountFile> {
  try {
    const parsed = JSON.parse(await readFile(ACCOUNTS_FILE, "utf8")) as Partial<AccountFile>;
    const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
    return {
      accounts,
      defaultAccountId: typeof parsed.defaultAccountId === "string" ? parsed.defaultAccountId : "",
      defaultAccountByUser: parsed.defaultAccountByUser && typeof parsed.defaultAccountByUser === "object" ? parsed.defaultAccountByUser : {},
    };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return structuredClone(EMPTY_ACCOUNTS);
    throw new Error("SEEDANCE_ACCOUNT_STORE_UNAVAILABLE");
  }
}

async function writeAccountFile(data: AccountFile) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  await writeFile(ACCOUNTS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  await chmod(ACCOUNTS_FILE, 0o600);
}

async function updateAccountFile<T>(mutator: (data: AccountFile) => T | Promise<T>) {
  let result!: T;
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const data = await readAccountFile();
    result = await mutator(data);
    await writeAccountFile(data);
  });
  await writeQueue;
  return result;
}

export async function listSeedanceAccountsForUser(userId: string) {
  const data = await readAccountFile();
  const accounts = data.accounts.filter((account) => account.ownerId === userId);
  const selectedDefault = data.defaultAccountByUser?.[userId] || "";
  return {
    accounts: accounts.map(({ id, name, lastFour, createdAt }) => ({
      id, name, lastFour, createdAt, isDefault: id === selectedDefault,
    })),
    defaultAccountId: accounts.some((account) => account.id === selectedDefault) ? selectedDefault : accounts[0]?.id || "",
    encryptionReady: Boolean(process.env.SEEDANCE_CREDENTIALS_ENCRYPTION_KEY?.trim() && process.env.SEEDANCE_CREDENTIALS_ENCRYPTION_KEY.trim().length >= 32),
  };
}

export async function listSeedanceAccounts() {
  const userId = await getCurrentUserId();
  await claimLegacySeedanceAccounts(userId);
  return listSeedanceAccountsForUser(userId);
}

export async function verifySeedanceApiKey(apiKey: string) {
  const response = await fetch(`${SEEDANCE_BASE_URL}/v1/videos/status?ids=storyai-api-key-check`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!response) throw new Error("SEEDANCE_CONNECTION_FAILED");
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) throw new Error("SEEDANCE_API_KEY_INVALID");
  if (response.status === 429) throw new Error("SEEDANCE_RATE_LIMITED");
  if (response.status >= 500) throw new Error(`SEEDANCE_SERVICE_UNAVAILABLE_${response.status}`);
  throw new Error(`SEEDANCE_VALIDATION_REJECTED_${response.status}`);
}

export async function addSeedanceAccountForUser(name: string, apiKey: string, userId: string) {
  const normalizedName = name.trim().slice(0, 80);
  const normalizedKey = apiKey.trim();
  if (!normalizedName || !normalizedKey) throw new Error("SEEDANCE_ACCOUNT_INPUT_REQUIRED");
  const encryptedKey = encryptApiKey(normalizedKey);
  const createdAt = new Date().toISOString();
  return updateAccountFile((data) => {
    const account = {
      id: randomUUID(),
      ownerId: userId,
      name: normalizedName,
      apiKey: encryptedKey,
      lastFour: normalizedKey.slice(-4),
      createdAt,
    };
    data.accounts.push(account);
    data.defaultAccountByUser ||= {};
    if (!data.defaultAccountByUser[userId]) data.defaultAccountByUser[userId] = account.id;
    return { id: account.id, name: account.name, lastFour: account.lastFour, createdAt, isDefault: data.defaultAccountByUser[userId] === account.id };
  });
}

export async function addSeedanceAccount(name: string, apiKey: string) {
  const userId = await getCurrentUserId();
  await claimLegacySeedanceAccounts(userId);
  return addSeedanceAccountForUser(name, apiKey, userId);
}

export async function saveDefaultSeedanceApiKey(apiKey: string) {
  const userId = await getCurrentUserId();
  await claimLegacySeedanceAccounts(userId);
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) throw new Error("SEEDANCE_ACCOUNT_INPUT_REQUIRED");
  const encryptedKey = encryptApiKey(normalizedKey);
  const createdAt = new Date().toISOString();

  return updateAccountFile((data) => {
    data.defaultAccountByUser ||= {};
    const defaultId = data.defaultAccountByUser[userId] || "";
    let account = data.accounts.find((item) => item.ownerId === userId && item.id === defaultId)
      || data.accounts.find((item) => item.ownerId === userId);
    if (account) {
      account.name = "Seedance";
      account.apiKey = encryptedKey;
      account.lastFour = normalizedKey.slice(-4);
    } else {
      account = {
        id: randomUUID(),
        ownerId: userId,
        name: "Seedance",
        apiKey: encryptedKey,
        lastFour: normalizedKey.slice(-4),
        createdAt,
      };
      data.accounts.push(account);
    }
    data.defaultAccountByUser[userId] = account.id;
    return { id: account.id, name: account.name, lastFour: account.lastFour, createdAt: account.createdAt, isDefault: true };
  });
}

export async function getSeedanceApiKey(accountId?: string, userIdOverride?: string) {
  const userId = userIdOverride?.trim() || await getCurrentUserId();
  await claimLegacySeedanceAccounts(userId);
  const data = await readAccountFile();
  const userAccounts = data.accounts.filter((item) => item.ownerId === userId);
  const selectedId = accountId?.trim() || data.defaultAccountByUser?.[userId] || "";
  const account = userAccounts.find((item) => item.id === selectedId);
  if (!account) throw new Error(accountId?.trim() ? "SEEDANCE_ACCOUNT_NOT_FOUND" : "SEEDANCE_ACCOUNT_REQUIRED");
  return decryptApiKey(account.apiKey);
}

export async function setDefaultSeedanceAccount(accountId: string) {
  const userId = await getCurrentUserId();
  await claimLegacySeedanceAccounts(userId);
  return updateAccountFile((data) => {
    if (!data.accounts.some((account) => account.ownerId === userId && account.id === accountId)) throw new Error("SEEDANCE_ACCOUNT_NOT_FOUND");
    data.defaultAccountByUser ||= {};
    data.defaultAccountByUser[userId] = accountId;
    return true;
  });
}

export async function deleteSeedanceAccount(accountId: string) {
  const userId = await getCurrentUserId();
  await claimLegacySeedanceAccounts(userId);
  return updateAccountFile((data) => {
    const index = data.accounts.findIndex((account) => account.ownerId === userId && account.id === accountId);
    if (index < 0) throw new Error("SEEDANCE_ACCOUNT_NOT_FOUND");
    data.accounts.splice(index, 1);
    data.defaultAccountByUser ||= {};
    if (data.defaultAccountByUser[userId] === accountId) {
      data.defaultAccountByUser[userId] = data.accounts.find((account) => account.ownerId === userId)?.id || "";
    }
    return true;
  });
}

export async function claimLegacySeedanceAccounts(userId: string) {
  await updateAccountFile((data) => {
    data.defaultAccountByUser ||= {};
    const legacyAccounts = data.accounts.filter((account) => !account.ownerId);
    for (const account of legacyAccounts) account.ownerId = userId;
    if (!data.defaultAccountByUser[userId] && legacyAccounts.length) {
      data.defaultAccountByUser[userId] = legacyAccounts.some((account) => account.id === data.defaultAccountId)
        ? data.defaultAccountId || ""
        : legacyAccounts[0].id;
    }
  });
}

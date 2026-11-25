import { createHmac, timingSafeEqual } from "node:crypto";

export type SeedanceReferenceType = "character" | "scene" | "location" | "timelapse";

function signatureFor(projectSlug: string, referenceId: string, userId: string, expires: number, type: SeedanceReferenceType = "character") {
  const signingSecret = process.env.SEEDANCE_CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!signingSecret || signingSecret.length < 32) throw new Error("SEEDANCE_ENCRYPTION_KEY_REQUIRED");
  const value = `${projectSlug}\n${referenceId}\n${userId}\n${expires}`;
  return createHmac("sha256", signingSecret).update(type === "character" ? value : `${type}\n${value}`).digest("hex");
}

export function verifySeedanceCharacterReferenceSignature(projectSlug: string, referenceId: string, userId: string, expiresValue: string, signature: string, type: SeedanceReferenceType = "character") {
  const expires = Number(expiresValue);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(expires) || expires < now || expires > now + 60 * 60 + 30 || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signatureFor(projectSlug, referenceId, userId, expires, type), "hex");
  const received = Buffer.from(signature, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

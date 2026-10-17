import { createHmac, timingSafeEqual } from "node:crypto";
import { usesDolaRenderGateway } from "./media-generation-settings";

export type SeedanceReferenceType = "character" | "scene" | "location";

export type SeedancePublicBaseUrlError =
  | "SEEDANCE_PUBLIC_BASE_URL_REQUIRED"
  | "STORYAI_PUBLIC_BASE_URL_INVALID"
  | "STORYAI_PUBLIC_BASE_URL_HTTPS"
  | "STORYAI_PUBLIC_BASE_URL_PUBLIC";

export function seedancePublicBaseUrlIssue(): SeedancePublicBaseUrlError | undefined {
  if (usesDolaRenderGateway()) return undefined;
  const configured = process.env.STORYAI_PUBLIC_BASE_URL?.trim();
  if (!configured) return "SEEDANCE_PUBLIC_BASE_URL_REQUIRED";

  let base: URL;
  try {
    base = new URL(configured);
  } catch {
    return "STORYAI_PUBLIC_BASE_URL_INVALID";
  }

  if (base.protocol !== "https:") return "STORYAI_PUBLIC_BASE_URL_HTTPS";
  if (!base.hostname || base.username || base.password) return "STORYAI_PUBLIC_BASE_URL_INVALID";
  const hostname = base.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  const ipv4 = ipv4Match?.slice(1).map(Number);
  const privateIpv4 = ipv4 && (
    ipv4[0] === 0 || ipv4[0] === 10 || ipv4[0] === 127
    || (ipv4[0] === 169 && ipv4[1] === 254)
    || (ipv4[0] === 192 && ipv4[1] === 168)
    || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
  );
  if (/^(localhost|.*\.localhost|.*\.local)$/i.test(hostname) || hostname === "::1" || privateIpv4) {
    return "STORYAI_PUBLIC_BASE_URL_PUBLIC";
  }
  return undefined;
}

export function seedancePublicBaseUrlErrorMessage(code: string) {
  if (code === "SEEDANCE_PUBLIC_BASE_URL_REQUIRED") return "Cần cấu hình STORYAI_PUBLIC_BASE_URL bằng địa chỉ HTTPS công khai của StoryAI để Seedance tải ảnh tham chiếu.";
  if (code === "STORYAI_PUBLIC_BASE_URL_HTTPS") return "STORYAI_PUBLIC_BASE_URL phải dùng HTTPS để Seedance tải ảnh tham chiếu.";
  if (code === "STORYAI_PUBLIC_BASE_URL_PUBLIC") return "STORYAI_PUBLIC_BASE_URL phải trỏ tới máy chủ công khai; localhost không thể được Seedance truy cập.";
  if (code === "STORYAI_PUBLIC_BASE_URL_INVALID") return "STORYAI_PUBLIC_BASE_URL không phải địa chỉ hợp lệ. Hãy nhập origin HTTPS của StoryAI, ví dụ https://storyai.example.com.";
  return undefined;
}

function signatureFor(projectSlug: string, referenceId: string, userId: string, expires: number, type: SeedanceReferenceType = "character") {
  const signingSecret = process.env.SEEDANCE_CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!signingSecret || signingSecret.length < 32) throw new Error("SEEDANCE_ENCRYPTION_KEY_REQUIRED");
  const value = `${projectSlug}\n${referenceId}\n${userId}\n${expires}`;
  return createHmac("sha256", signingSecret).update(type === "character" ? value : `${type}\n${value}`).digest("hex");
}

export function createSeedanceCharacterReferenceUrl(projectSlug: string, characterId: string, userId: string) {
  return createReferenceUrl(projectSlug, characterId, userId, "character");
}

export function createSeedanceSceneReferenceUrl(projectSlug: string, sceneId: string, userId: string) {
  return createReferenceUrl(projectSlug, sceneId, userId, "scene");
}

export function createSeedanceLocationReferenceUrl(projectSlug: string, locationId: string, userId: string) {
  return createReferenceUrl(projectSlug, locationId, userId, "location");
}

function createReferenceUrl(projectSlug: string, referenceId: string, userId: string, type: SeedanceReferenceType) {
  const issue = seedancePublicBaseUrlIssue();
  if (issue) throw new Error(issue);
  const base = usesDolaRenderGateway()
    ? (process.env.STORYAI_LOCAL_BASE_URL?.trim() || "http://127.0.0.1:3021")
    : process.env.STORYAI_PUBLIC_BASE_URL!.trim();
  let url: URL;
  try {
    url = new URL(`/api/seedance/references/${encodeURIComponent(projectSlug)}/${encodeURIComponent(referenceId)}`, base);
  } catch {
    throw new Error("STORYAI_PUBLIC_BASE_URL_INVALID");
  }
  if (usesDolaRenderGateway()) {
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(url.hostname) || url.username || url.password) {
      throw new Error("STORYAI_LOCAL_BASE_URL_INVALID");
    }
  } else if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("STORYAI_PUBLIC_BASE_URL_HTTPS");
  }
  if (type !== "character") url.searchParams.set("type", type);
  const expires = Math.floor(Date.now() / 1000) + 60 * 60;
  url.searchParams.set("owner", userId);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signatureFor(projectSlug, referenceId, userId, expires, type));
  return url.href;
}

export function verifySeedanceCharacterReferenceSignature(projectSlug: string, referenceId: string, userId: string, expiresValue: string, signature: string, type: SeedanceReferenceType = "character") {
  const expires = Number(expiresValue);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(expires) || expires < now || expires > now + 60 * 60 + 30 || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signatureFor(projectSlug, referenceId, userId, expires, type), "hex");
  const received = Buffer.from(signature, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

const configuredLocalUserId = process.env.STORYAI_LOCAL_USER_ID?.trim() || "";

export const LOCAL_USER_ID = /^[a-zA-Z0-9_-]{1,128}$/.test(configuredLocalUserId)
  ? configuredLocalUserId
  : "local";

export const LOCAL_USER_EMAIL = "local@localhost";
export const LOCAL_USER_NAME = "Máy này";

export function isLoopbackHost(value: string | null | undefined) {
  if (!value?.trim()) return false;
  let hostname = "";
  try {
    hostname = new URL(`http://${value.trim()}`).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

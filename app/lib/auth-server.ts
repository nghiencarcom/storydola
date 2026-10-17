import { headers } from "next/headers";

export async function getCurrentUserId() {
  const userId = (await headers()).get("x-storyai-user-id")?.trim();
  if (!userId) throw new Error("STORYAI_AUTH_REQUIRED");
  return userId;
}

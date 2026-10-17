import { NextResponse } from "next/server";
import { headers } from "next/headers";

export async function GET() {
  const requestHeaders = await headers();
  const id = requestHeaders.get("x-storyai-user-id")?.trim();
  const email = requestHeaders.get("x-storyai-user-email")?.trim();
  const name = requestHeaders.get("x-storyai-user-name")?.trim();
  const role = requestHeaders.get("x-storyai-user-role")?.trim();
  const local = requestHeaders.get("x-storyai-local-mode") === "1";
  const user = id && email ? { id, email, name: name || email.split("@")[0], ...(role ? { role } : {}), ...(local ? { local: true } : {}) } : null;
  return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
}

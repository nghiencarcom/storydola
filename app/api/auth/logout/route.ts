import { logoutMaiVideoSession } from "../../../lib/maivideo-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return logoutMaiVideoSession(request);
}

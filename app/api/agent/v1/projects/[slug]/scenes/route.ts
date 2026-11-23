import { NextResponse } from "next/server";
import { getCurrentUserId } from "../../../../../../lib/auth-server";
import { readProjectScenes } from "../../../../../../lib/scene-store";
import { readDataForUser } from "../../../../../../lib/server-store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const userId = await getCurrentUserId();
  const { slug } = await context.params;
  const data = await readDataForUser(userId);
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const scenes = await readProjectScenes(project);
  return NextResponse.json({ scenes }, { headers: { "Cache-Control": "no-store" } });
}

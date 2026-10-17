import { NextResponse } from "next/server";
import { createProjectResponse } from "../../../../lib/project-creation";
import type { StoryPresetId } from "../../../../lib/story-presets";

export const runtime = "nodejs";

const PRESET_IDS = new Set<StoryPresetId>(["ai-story", "audio-story", "ai-drama"]);

export async function POST(request: Request, context: { params: Promise<{ preset: string }> }) {
  const { preset } = await context.params;
  if (!PRESET_IDS.has(preset as StoryPresetId)) {
    return NextResponse.json({ message: "Loại dự án tạo mới không hợp lệ." }, { status: 404 });
  }
  return createProjectResponse(request, preset as StoryPresetId);
}

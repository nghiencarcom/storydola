import { NextResponse } from "next/server";
import { buildChunkPrompt, STORY_PRESETS, type StoryPresetId } from "../../lib/story-presets";
import { generateWithScriptProvider, getCodeAgentProviderSummary, resolveConfiguredCodingAgent } from "../../lib/script-provider";
import type { ContinuityContext } from "../../lib/project-types";

export const runtime = "nodejs";

type ScriptRequest = {
  presetId?: StoryPresetId;
  sourceUrl?: string;
  sourceText?: string;
  projectTitle?: string;
  chunkId?: string;
  sceneStart?: number;
  sceneEnd?: number;
  episodeOpeningScene?: number;
  totalScenes?: number;
  contentGenre?: string;
  secondaryGenres?: string[];
  storySetting?: string;
  settingNotes?: string;
  visualStyle?: string;
  imageStyle?: string;
  aspectRatio?: string;
  language?: string;
  continuityContext?: ContinuityContext;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ScriptRequest;
  const preset = STORY_PRESETS[body.presetId || "ai-story"] || STORY_PRESETS["ai-story"];
  const userId = request.headers.get("x-storyai-user-id")?.trim() || undefined;
  const agent = await resolveConfiguredCodingAgent(userId);
  if (!agent) {
    const provider = await getCodeAgentProviderSummary(userId);
    return NextResponse.json({ ok: false, code: "SCRIPT_LLM_NOT_CONFIGURED", message: "Chưa kết nối Code Agent CLI (Codex / Claude Code / Antigravity) trong Cài đặt.", preset: preset.id, provider: { baseUrl: provider.baseUrl, model: provider.primaryModel, fallbackModels: provider.fallbackModels, reasoningEffort: provider.reasoningEffort, serviceTier: provider.serviceTier } }, { status: 503 });
  }

  const sceneStart = body.sceneStart ?? 1;
  const sceneEnd = body.sceneEnd ?? sceneStart + 19;
  const prompt = buildChunkPrompt({
    preset,
    sourceUrl: body.sourceUrl,
    sourceText: body.sourceText,
    projectTitle: body.projectTitle,
    chunkId: body.chunkId || "A01",
    sceneStart,
    sceneEnd,
    episodeOpeningScene: body.episodeOpeningScene ?? sceneStart,
    totalScenes: body.totalScenes,
    contentGenre: body.contentGenre,
    secondaryGenres: body.secondaryGenres,
    storySetting: body.storySetting,
    settingNotes: body.settingNotes,
    visualStyle: body.visualStyle,
    imageStyle: body.imageStyle,
    aspectRatio: body.aspectRatio,
    language: body.language,
    continuityContext: body.continuityContext,
  });
  try {
    const output = await generateWithScriptProvider(prompt, { userId });
    return NextResponse.json({ ok: true, preset: preset.id, provider: { baseUrl: "local-cli", model: output.model }, ...output });
  } catch (cause) {
    const code = cause instanceof Error ? cause.name : "SCRIPT_LLM_FAILED";
    return NextResponse.json({ ok: false, code, message: cause instanceof Error ? cause.message : "Script provider failed" }, { status: code === "SCRIPT_LLM_NOT_CONFIGURED" ? 503 : 502 });
  }
}

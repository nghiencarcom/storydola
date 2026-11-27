import { NextResponse } from "next/server";
import { getCurrentUserId } from "../../../../../lib/auth-server";
import { generateWithCodingAgent, getCodingAgentCliStatuses } from "../../../../../lib/coding-agent-cli";
import { getCodingAgentPreference } from "../../../../../lib/coding-agent-preferences";
import { buildDramaChunkSourceText } from "../../../../../lib/drama-plan";
import { validateEpisode } from "../../../../../lib/episode-script-validation";
import { createEpisodeScriptTemplate } from "../../../../../lib/project-script-templates";
import { readData } from "../../../../../lib/server-store";

export const runtime = "nodejs";
const activeUsers = new Set<string>();

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const userId = await getCurrentUserId().catch(() => null);
  if (!userId) return NextResponse.json({ message: "Vui lòng đăng nhập lại." }, { status: 401 });
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  const agent = body?.agent;
  if (agent !== "codex" && agent !== "claude" && agent !== "antigravity") {
    return NextResponse.json({ message: "Hãy chọn coding agent." }, { status: 400 });
  }

  const project = (await readData()).projects.find((item) => item.slug === slug);
  const index = project?.chunks.findIndex((chunk) => chunk.id === body.chunkId) ?? -1;
  if (!project || project.presetId !== "ai-drama" || index < 0) {
    return NextResponse.json({ message: "Không tìm thấy tập Phim AI." }, { status: 404 });
  }
  if (!project.sourceText.trim()) {
    return NextResponse.json({ message: "Hãy lưu kịch bản nguồn trước." }, { status: 400 });
  }
  if (activeUsers.has(userId)) {
    return NextResponse.json({ message: "Agent đang viết một tập. Hãy đợi kết quả." }, { status: 409 });
  }
  const [statuses, savedPref] = await Promise.all([
    getCodingAgentCliStatuses({ includeModels: false }).catch(() => []),
    getCodingAgentPreference(userId).catch(() => undefined),
  ]);
  if (!statuses.some((item) => item.id === agent && item.available)) {
    return NextResponse.json({ message: "Chưa tìm thấy Code Agent CLI đã chọn trên máy đang chạy StoryAI. Hãy kiểm tra trong Cài đặt." }, { status: 503 });
  }

  const target = project.chunks[index];
  const timelineStart = Number.isFinite(body.timelineStart) && body.timelineStart >= 0
    ? body.timelineStart : (target.sceneStart - 1) * 15;
  const template = JSON.parse(createEpisodeScriptTemplate(target.id, target.sceneStart, target.sceneEnd, timelineStart, {
    contentGenre: project.contentGenre,
    secondaryGenres: project.secondaryGenres,
    visualStyle: project.visualStyle,
    imageStyle: project.imageStyle,
    language: project.language,
    existing_locations: project.locations?.map(({ name, description }) => ({ name, description })),
  }));
  if (template.scenes.length > 3) {
    template.scenes = [template.scenes[0], template.scenes[1], template.scenes.at(-1)];
  }
  const source = project.dramaPlan
    ? buildDramaChunkSourceText({ sourceText: project.sourceText, plan: project.dramaPlan, chunkIndex: index, characters: project.characters, locations: project.locations })
    : project.sourceText;
  const episodeTitle = project.dramaPlan?.episodes[index]?.title || target.title || target.id;
  const prompt = [
    `Write only episode ${index + 1} (${target.id}, ${episodeTitle}) as one scene-script.v1 JSON object. Include exactly scenes ${target.sceneStart} through ${target.sceneEnd} in order.`,
    `Use the saved story source as story material. Preserve canonical names and continuity. Spoken language: ${project.language}. Start the episode timeline at ${timelineStart} seconds and keep scene boundaries contiguous.`,
    "Follow the template guidance and replace all placeholders with original script content. Scene examples may omit intermediate IDs; write every requested scene. Omit template-only guidance fields from the response.",
    "SAVED SOURCE:", source, "EPISODE TEMPLATE:", JSON.stringify(template),
  ].join("\n\n");

  activeUsers.add(userId);
  try {
    const prefOptions = savedPref && savedPref.agent === agent
      ? { model: savedPref.model, quality: savedPref.quality, speed: savedPref.speed }
      : {};
    const { result } = await generateWithCodingAgent(agent, prompt, { promptOnlyJson: true, ...prefOptions });
    const { episode, message } = validateEpisode(result, true);
    if (!episode || episode.chunkId !== target.id || episode.sceneStart !== target.sceneStart || episode.sceneEnd !== target.sceneEnd) {
      return NextResponse.json({ message: message || "Agent trả sai tập hoặc phạm vi cảnh. Hãy thử viết lại." }, { status: 422 });
    }
    return NextResponse.json({ script: episode.payload });
  } catch (error) {
    console.error("[episode-agent-draft]", error);
    return NextResponse.json({ message: "Không nhận được JSON từ agent. Hãy kiểm tra CLI đã đăng nhập rồi thử lại." }, { status: 502 });
  } finally {
    activeUsers.delete(userId);
  }
}

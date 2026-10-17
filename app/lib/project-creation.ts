import { NextResponse } from "next/server";
import { getCurrentUserId } from "./auth-server";
import { DEFAULT_CONTENT_GENRE, DEFAULT_STORY_SETTING, normalizeContentGenre, normalizeSecondaryGenres, normalizeStorySetting } from "./content-genres";
import { normalizeDramaPlan } from "./drama-plan";
import { getOmniVoiceCatalog } from "./omnivoice-server";
import { isValidProjectChunkSize, normalizeProjectChunkSize, type CreateProjectInput, type DramaProjectPlan } from "./project-types";
import { makeActivity, makeProject, updateData, updateProjectRecord } from "./server-store";
import type { StoryPresetId } from "./story-presets";
import { DEFAULT_IMAGE_STYLE, DEFAULT_VISUAL_STYLE } from "./visual-styles";
import { ingestSourceUrl } from "./source-ingest";

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "story-project";
}

export async function createProjectResponse(request: Request, presetId: StoryPresetId) {
  const body = { ...((await request.json().catch(() => ({}))) as Partial<CreateProjectInput>), presetId };
  if (!body.title?.trim()) return NextResponse.json({ message: "Tên dự án là bắt buộc." }, { status: 400 });
  const requestedChunkSize = body.chunkSize === undefined ? 20 : Number(body.chunkSize);
  if (!isValidProjectChunkSize(requestedChunkSize)) {
    return NextResponse.json({ message: "Số cảnh mỗi chunk phải là số nguyên từ 1 đến 100." }, { status: 400 });
  }
  const chunkSize = normalizeProjectChunkSize(requestedChunkSize);
  body.chunkSize = chunkSize;

  let dramaPlan: DramaProjectPlan | undefined;
  if (presetId === "ai-drama" && body.dramaPlan) {
    try {
      const totalScenes = Math.ceil((Math.max(1, Number(body.durationMinutes) || 60) * 60) / 15);
      const expectedEpisodes = Math.ceil(totalScenes / chunkSize);
      dramaPlan = normalizeDramaPlan(body.dramaPlan, expectedEpisodes);
    } catch (cause) {
      return NextResponse.json({ message: cause instanceof Error ? cause.message : "Kế hoạch AI Drama không hợp lệ." }, { status: 400 });
    }
  }

  const catalog = dramaPlan ? await getOmniVoiceCatalog().catch(() => null) : null;
  const selectedVoice = (catalog?.voices || []).find((voice) => voice.id === body.voiceId);
  const userSuffix = await getCurrentUserId();
  let project = await updateData((data) => {
    const baseSlug = `${slugify(body.title as string)}-${userSuffix}`;
    let slug = baseSlug;
    let counter = 2;
    while (data.projects.some((item) => item.slug === slug)) slug = `${baseSlug}-${counter++}`;
    const created = makeProject({
      title: body.title as string,
      sourceUrl: body.sourceUrl || "",
      sourceText: body.sourceText || "",
      scriptMode: body.scriptMode || "ai",
      scriptFormat: body.scriptFormat || "plain_text",
      durationMode: body.durationMode,
      durationSeconds: body.durationSeconds,
      presetId,
      durationMinutes: Number(body.durationMinutes) || 60,
      chunkSize: Number(body.chunkSize) || 20,
      language: body.language || "vi",
      voiceProvider: body.voiceProvider || "omnivoice",
      voiceId: body.voiceId || "",
      voiceName: body.voiceName || "",
      voiceLanguage: selectedVoice?.language || body.voiceLanguage || body.language || "vi",
      contentGenre: normalizeContentGenre(body.contentGenre || DEFAULT_CONTENT_GENRE),
      secondaryGenres: normalizeSecondaryGenres(body.secondaryGenres, body.contentGenre),
      storySetting: normalizeStorySetting(body.storySetting || DEFAULT_STORY_SETTING),
      settingNotes: typeof body.settingNotes === "string" ? body.settingNotes.trim().slice(0, 2000) : "",
      visualStyle: body.visualStyle || DEFAULT_VISUAL_STYLE,
      imageStyle: body.imageStyle || DEFAULT_IMAGE_STYLE,
      aspectRatio: body.aspectRatio || "16:9",
      mediaSource: presetId === "ai-drama" ? "maivideo-video" : body.mediaSource || "stock-mixed",
      mediaGeneration: body.mediaGeneration,
    }, slug);
    if (dramaPlan) {
      const timestamp = created.createdAt;
      created.videoTitle = dramaPlan.videoTitle;
      created.dramaPlan = dramaPlan;
      created.characters = dramaPlan.characters.map((character, index) => ({
        id: `char-ai-${index + 1}`,
        name: character.name,
        description: character.description,
        imagePrompt: character.imagePrompt,
        referenceImagePath: "",
        referenceImageName: "",
        referenceImageMimeType: "",
        voiceId: selectedVoice?.id || body.voiceId || "",
        voiceName: selectedVoice?.name || body.voiceName || "",
        voiceLanguage: selectedVoice?.language || body.voiceLanguage || body.language || "vi",
        createdAt: timestamp,
        updatedAt: timestamp,
      }));
      created.locations = dramaPlan.locations.map((location, index) => ({
        id: `loc-ai-${index + 1}`,
        name: location.name,
        description: location.description,
        imagePrompt: location.imagePrompt,
        referenceImagePath: "",
        referenceImageName: "",
        referenceImageMimeType: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      }));
      created.chunks.forEach((chunk, index) => { chunk.title = dramaPlan.episodes[index]?.title || chunk.id; });
    }
    data.projects.unshift(created);
    data.activities.unshift(makeActivity({ projectSlug: created.slug, kind: "project", title: "Project đã được tạo", detail: `${created.totalScenes} cảnh · ${created.totalChunks} chunk · ${created.presetId}`, status: "success" }));
    return created;
  });

  if (project.sourceUrl && !project.sourceText && !body.deferSourceIngest) {
    try {
      const source = await ingestSourceUrl(project.sourceUrl);
      project = await updateData((data) => {
        const index = data.projects.findIndex((item) => item.slug === project.slug);
        if (index < 0) return project;
        const current = data.projects[index];
        const updated = updateProjectRecord(current, { sourceText: source.text });
        data.projects[index] = updated;
        data.activities.unshift(makeActivity({ projectSlug: project.slug, kind: "source", title: "Đã lấy transcript tự động", detail: `${source.platform || "video"} · ${source.text.length.toLocaleString("vi-VN")} ký tự`, status: "success" }));
        return updated;
      });
    } catch (cause) {
      await updateData((data) => {
        data.activities.unshift(makeActivity({ projectSlug: project.slug, kind: "source", title: "Chưa lấy được transcript", detail: cause instanceof Error ? cause.message : "MaiVideo chưa trả transcript.", status: "warning" }));
      });
    }
  }

  return NextResponse.json({ project }, { status: 201 });
}

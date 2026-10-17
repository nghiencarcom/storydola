import { NextResponse } from "next/server";
import { claimProjectChunkRun, isProjectChunkRunActive, releaseProjectChunkRun } from "../../../../lib/chunk-generation-lock";
import { buildContinuityQaReport } from "../../../../lib/continuity-qa";
import { evaluateChunkScenes } from "../../../../lib/scene-ai-review";
import { isProjectRenderActive, claimProjectRender, releaseProjectRender } from "../../../../lib/render-lock";
import { readProjectScenes } from "../../../../lib/scene-store";
import { continuityContextFromOutput } from "../../../../lib/story-context";
import { claimProjectTts, isProjectTtsActive, releaseProjectTts } from "../../../../lib/tts-lock";
import { hasExplicitDialogueSegments, readDialogueSegments } from "../../../../lib/dialogue-segments";
import { makeActivity, markRenderStale, now, readChunkOutput, readData, saveChunkOutput, updateData } from "../../../../lib/server-store";
import type { ProjectChunk, StoryProject, ProjectVideoPublishingPackage, VideoPublishingSet } from "../../../../lib/project-types";
import { normalizeProjectStyleSettings } from "../../../../lib/visual-styles";
import { isAiDramaSceneDuration } from "../../../../lib/ai-drama-scene-timing";
import { normalizeContentGenre, normalizeSecondaryGenres, normalizeStorySetting } from "../../../../lib/content-genres";
import { countScriptWords } from "../../../../lib/script-utils";

export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;
type ImportEpisode = { chunkId: string; sceneStart: number; sceneEnd: number; scenes: JsonRecord[]; payload: JsonRecord };
const REQUIRED_TEXT_FIELDS = ["act", "purpose", "beat_summary", "dialogue_or_voiceover", "image_keyword", "video_keyword", "image_prompt", "video_prompt", "continuity_in", "continuity_out", "source_basis"];

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function errorResponse(message: string, status = 400, extra: JsonRecord = {}) {
  return NextResponse.json({ message, ...extra }, { status });
}

function validateEpisode(value: unknown, requireDiscreteDramaDurations = false): { episode?: ImportEpisode; message?: string } {
  const payload = asRecord(value);
  if (!payload || payload.schema !== "scene-script.v1") return { message: "Mỗi phần tử episodes phải có schema scene-script.v1." };
  const chunkId = String(payload.chunk_id || "").trim().toUpperCase();
  if (!/^A\d{2,}$/.test(chunkId)) return { message: `chunk_id không hợp lệ: ${chunkId || "trống"}. Dùng dạng A01, A02…` };
  if (typeof payload.chunk_summary !== "string" || !payload.chunk_summary.trim()) return { message: `${chunkId}: thiếu chunk_summary.` };
  if (!asRecord(payload.continuity_state)) return { message: `${chunkId}: continuity_state phải là object đầy đủ.` };
  if (!Array.isArray(payload.scenes) || payload.scenes.length === 0) return { message: `${chunkId}: scenes phải là mảng có ít nhất một cảnh.` };

  const scenes: JsonRecord[] = [];
  const numbers: number[] = [];
  const dialogueIssues: string[] = [];
  for (let index = 0; index < payload.scenes.length; index += 1) {
    const scene = asRecord(payload.scenes[index]);
    if (!scene) return { message: `${chunkId}: cảnh thứ ${index + 1} không phải object.` };
    const id = String(scene.id || "").trim().toUpperCase();
    const match = id.match(/^S(\d{3,})$/);
    if (!match) return { message: `${chunkId}: scene ${index + 1} cần ID dạng S001, S002…` };
    const sceneNumber = Number(match[1]);
    numbers.push(sceneNumber);
    if (typeof scene.start_sec !== "number" || !Number.isFinite(scene.start_sec) || scene.start_sec < 0) return { message: `${id}: start_sec phải là số không âm.` };
    if (typeof scene.end_sec !== "number" || !Number.isFinite(scene.end_sec) || scene.end_sec <= scene.start_sec) return { message: `${id}: end_sec phải lớn hơn start_sec.` };
    const sceneDuration = scene.end_sec - scene.start_sec;
    if (sceneDuration > 15.01) return { message: `${id}: thời lượng cảnh vượt quá 15 giây.` };
    if (requireDiscreteDramaDurations && !isAiDramaSceneDuration(sceneDuration)) return { message: `${id}: AI Drama chỉ nhận thời lượng cảnh 5, 10 hoặc 15 giây.` };
    const dialogueMode = String(scene.dialogue_mode ?? scene.dialogueMode ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const dialogueSegments = Array.isArray(scene.dialogue_segments) ? scene.dialogue_segments : Array.isArray(scene.dialogueSegments) ? scene.dialogueSegments : [];
    const dialogueSpeakers = new Set(dialogueSegments.map((item) => {
      const segment = asRecord(item);
      return String(segment?.speaker_character ?? segment?.speakerCharacter ?? segment?.speaker_character_id ?? segment?.speakerCharacterId ?? "").trim();
    }).filter(Boolean));
    const isDialogueLed = dialogueMode === "dialogue_led" || (!dialogueMode && dialogueSpeakers.size >= 2);
    if (requireDiscreteDramaDurations && isDialogueLed) {
      const cueText = dialogueSegments.map((item) => asRecord(item)?.text).filter((text): text is string => typeof text === "string").join(" ").trim();
      const spokenText = cueText || (typeof scene.dialogue_or_voiceover === "string" ? scene.dialogue_or_voiceover : "");
      const words = countScriptWords(spokenText);
      const allowedDuration = [5, 10, 15].find((duration) => Math.abs(duration - sceneDuration) < 0.001) || sceneDuration;
      const minimumWords = allowedDuration === 5 ? 10 : allowedDuration === 10 ? 20 : 30;
      const maximumWords = allowedDuration * 3;
      const expectedRange = allowedDuration === 5 ? "10–15" : allowedDuration === 10 ? "20–30" : "30–45";
      if (words < minimumWords) dialogueIssues.push(`${id}: ${words}/${minimumWords} từ tối thiểu, mục tiêu ${expectedRange} từ cho ${allowedDuration}s`);
      else if (words > maximumWords) dialogueIssues.push(`${id}: ${words} từ, vượt mức ${expectedRange} từ cho ${allowedDuration}s (tối đa 3 từ/giây)`);
    }
    const declaredDuration = scene.duration_sec ?? scene.durationSec;
    if (requireDiscreteDramaDurations && declaredDuration !== undefined
      && (!isAiDramaSceneDuration(declaredDuration) || Math.abs(Number(declaredDuration) - sceneDuration) >= 0.001)) {
      return { message: `${id}: duration_sec phải khớp timecode và chỉ nhận 5, 10 hoặc 15 giây.` };
    }
    if (typeof scene.voiceover_target_sec !== "number" || !Number.isFinite(scene.voiceover_target_sec) || scene.voiceover_target_sec < 0) return { message: `${id}: voiceover_target_sec phải là số không âm.` };
    for (const key of REQUIRED_TEXT_FIELDS) {
      if (typeof scene[key] !== "string") return { message: `${id}: thiếu trường văn bản ${key}.` };
    }
    if (scene.media_type !== "image" && scene.media_type !== "video") return { message: `${id}: media_type chỉ nhận image hoặc video.` };
    if (!Array.isArray(scene.risk_flags) || scene.risk_flags.some((flag) => typeof flag !== "string")) return { message: `${id}: risk_flags phải là mảng chuỗi.` };
    scenes.push({ ...scene, id });
  }

  if (dialogueIssues.length) {
    const visibleIssues = dialogueIssues.slice(0, 10).join("; ");
    const moreIssues = dialogueIssues.length > 10 ? `; và ${dialogueIssues.length - 10} cảnh khác` : "";
    return { message: `Kịch bản ${chunkId} chưa đạt nhịp thoại dialogue_led: ${visibleIssues}${moreIssues}. visual_led/im lặng có chủ đích được miễn.` };
  }

  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index] !== numbers[index - 1] + 1) return { message: `${chunkId}: scene ID phải liên tục; có khoảng trống hoặc ID trùng.` };
    const previous = scenes[index - 1];
    const current = scenes[index];
    if (Number(current.start_sec) < Number(previous.end_sec)) return { message: `${chunkId}: timecode bị chồng lấn tại ${String(current.id)}.` };
  }

  return { episode: {
    chunkId,
    sceneStart: numbers[0],
    sceneEnd: numbers[numbers.length - 1],
    scenes,
    payload: { ...payload, chunk_id: chunkId, scenes },
  } };
}

function busyProject(project: StoryProject) {
  return project.chunks.some((chunk) => chunk.status === "processing" || chunk.render?.status === "running" || chunk.tts?.status === "running")
    || project.render?.status === "running"
    || project.videoQueue?.status === "running"
    || project.videoQueue?.jobs.some((job) => job.status === "running");
}

function isPristine(project: StoryProject) {
  return project.chunks.every((chunk) => !chunk.outputPath && chunk.generatedScenes === 0 && chunk.status === "queued")
    && !project.render?.outputPath;
}

function importedAiReview(scene: JsonRecord) {
  const raw = asRecord(scene.ai_review || scene.aiReview) || {};
  return String(raw.status || "pending");
}

function normalizePublishingSet(value: unknown): VideoPublishingSet | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const titles = Array.isArray(record.titles) ? record.titles : Array.isArray(record.title_options) ? record.title_options : [];
  const thumbnails = Array.isArray(record.thumbnails)
    ? record.thumbnails
    : Array.isArray(record.thumbnail_prompt_options) ? record.thumbnail_prompt_options
      : Array.isArray(record.thumbnail_prompts) ? record.thumbnail_prompts : [];
  const cleanTitles = titles.map((value) => {
    const item = asRecord(value) || {};
    return {
      title: typeof item.title === "string" ? item.title.trim().slice(0, 120) : "",
      hook: typeof item.hook === "string" ? item.hook.trim().slice(0, 240) : "",
      angle: typeof (item.angle ?? item.rationale) === "string" ? String(item.angle ?? item.rationale).trim().slice(0, 240) : "",
    };
  }).filter((item) => item.title && item.hook).slice(0, 5);
  const cleanThumbnails = thumbnails.map((value) => {
    const item = asRecord(value) || {};
    return {
      concept: typeof (item.concept ?? item.label) === "string" ? String(item.concept ?? item.label).trim().slice(0, 180) : "",
      prompt: typeof item.prompt === "string" ? item.prompt.trim().slice(0, 3000) : "",
      overlayText: typeof (item.overlayText ?? item.overlay_text) === "string" ? String(item.overlayText ?? item.overlay_text).trim().slice(0, 80) : "",
      layoutNote: typeof (item.layoutNote ?? item.layout_note) === "string" ? String(item.layoutNote ?? item.layout_note).trim().slice(0, 300) : "",
    };
  }).filter((item) => item.concept && item.prompt && item.overlayText).slice(0, 4);
  if (!cleanTitles.length || !cleanThumbnails.length) return undefined;
  return { titles: cleanTitles, thumbnails: cleanThumbnails, updatedAt: now(), source: "gpt-import" };
}

function normalizePublishingPackage(value: unknown, allowDirectSeriesPackage = false): ProjectVideoPublishingPackage {
  const record = asRecord(value) || {};
  const episodesRecord = asRecord(record.episodes) || {};
  const episodes: Record<string, VideoPublishingSet> = {};
  for (const [chunkId, packageValue] of Object.entries(episodesRecord)) {
    const normalizedChunkId = chunkId.trim().toUpperCase();
    const packageSet = normalizePublishingSet(packageValue);
    if (/^A\d{2,}$/.test(normalizedChunkId) && packageSet) episodes[normalizedChunkId] = packageSet;
  }
  const series = normalizePublishingSet(record.series ?? record.project);
  // A direct set is a series-level package only for scene-series.v1. In a
  // scene-script.v1, the same shape belongs to the one imported episode.
  const direct = allowDirectSeriesPackage && !series && !Object.keys(episodes).length ? normalizePublishingSet(record) : undefined;
  return { ...(series || direct ? { series: series || direct } : {}), ...(Object.keys(episodes).length ? { episodes } : {}) };
}

function publishingSetError(value: unknown, label: string): string | undefined {
  if (!asRecord(value)) return `${label} phải là object JSON.`;
  if (!normalizePublishingSet(value)) {
    return `${label} cần có ít nhất một title hợp lệ (title + hook) và một thumbnail (concept + prompt + overlay_text).`;
  }
  return undefined;
}

function publishingPackageError(value: unknown, bundle: boolean, chunkIds: Set<string>): string | undefined {
  if (value === undefined || value === null) return undefined;
  const record = asRecord(value);
  if (!record) return "publishing_package phải là object JSON.";

  if (!bundle) return publishingSetError(value, "publishing_package của tập");

  const hasNestedShape = Object.hasOwn(record, "series") || Object.hasOwn(record, "project") || Object.hasOwn(record, "episodes");
  if (!hasNestedShape) return publishingSetError(value, "publishing_package của series");

  for (const key of ["series", "project"] as const) {
    if (record[key] !== undefined && record[key] !== null) {
      const issue = publishingSetError(record[key], `publishing_package.${key}`);
      if (issue) return issue;
    }
  }

  if (record.episodes !== undefined && record.episodes !== null) {
    const episodePackages = asRecord(record.episodes);
    if (!episodePackages) return "publishing_package.episodes phải là object map theo chunk_id.";
    for (const [rawChunkId, packageSet] of Object.entries(episodePackages)) {
      const chunkId = rawChunkId.trim().toUpperCase();
      if (!/^A\d{2,}$/.test(chunkId)) return `publishing_package.episodes có chunk_id không hợp lệ: ${rawChunkId}.`;
      if (!chunkIds.has(chunkId)) return `publishing_package.episodes.${chunkId} không có tập tương ứng trong mảng episodes.`;
      const issue = publishingSetError(packageSet, `publishing_package.episodes.${chunkId}`);
      if (issue) return issue;
    }
  }

  return undefined;
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = asRecord(await request.json().catch(() => ({})));
  const source = asRecord(body?.bundle ?? body?.data ?? body);
  const preserveProjectSettings = body?.preserveProjectSettings === true;
  const preserveProjectStructure = body?.preserveProjectStructure === true;
  if (!source) return errorResponse("Không đọc được JSON.");

  const bundle = source.schema === "scene-series.v1";
  let rawEpisodes: unknown[];
  if (bundle) {
    if (!Array.isArray(source.episodes) || source.episodes.length === 0) return errorResponse("scene-series.v1 cần có mảng episodes không rỗng.");
    if (source.episodes.length > 100) return errorResponse("Một lần nhập tối đa 100 tập.", 413);
    rawEpisodes = source.episodes;
  } else if (source.schema === "scene-script.v1") {
    rawEpisodes = [source];
  } else {
    return errorResponse("File phải có schema scene-script.v1 hoặc scene-series.v1.");
  }

  const snapshot = await readData();
  const existing = snapshot.projects.find((project) => project.slug === slug);
  if (!existing) return errorResponse("Không tìm thấy project.", 404);

  const parsedEpisodes: ImportEpisode[] = [];
  for (const value of rawEpisodes) {
    const validation = validateEpisode(value, existing.presetId === "ai-drama");
    if (!validation.episode) return errorResponse(validation.message || "Tập không đúng schema scene-script.v1.");
    parsedEpisodes.push(validation.episode);
  }
  const importedChunkIds = parsedEpisodes.map((episode) => episode.chunkId);
  if (new Set(importedChunkIds).size !== importedChunkIds.length) return errorResponse("Gói nhập có chunk_id bị trùng.");
  const packageIssue = publishingPackageError(source.publishing_package, bundle, new Set(importedChunkIds));
  if (packageIssue) return errorResponse(packageIssue);
  for (const episode of parsedEpisodes) {
    const packageIssue = publishingPackageError(episode.payload.publishing_package, false, new Set([episode.chunkId]));
    if (packageIssue) return errorResponse(`${episode.chunkId}: ${packageIssue}`);
  }
  const rootPackage = normalizePublishingPackage(source.publishing_package, bundle);
  const directEpisodePackage = !bundle ? normalizePublishingSet(source.publishing_package) : undefined;
  const importedEpisodePackages = { ...(rootPackage.episodes || {}) };
  for (const episode of parsedEpisodes) {
    const episodePackage = normalizePublishingSet(episode.payload.publishing_package);
    if (episodePackage) importedEpisodePackages[episode.chunkId] = episodePackage;
  }
  if (directEpisodePackage && parsedEpisodes[0]) importedEpisodePackages[parsedEpisodes[0].chunkId] = directEpisodePackage;
  const importedSceneIds = parsedEpisodes.flatMap((episode) => episode.scenes.map((scene) => String(scene.id)));
  if (new Set(importedSceneIds).size !== importedSceneIds.length) return errorResponse("Gói nhập có scene ID bị trùng giữa các tập.");
  parsedEpisodes.sort((left, right) => left.sceneStart - right.sceneStart);

  const pristine = isPristine(existing);
  if (pristine && !bundle && (parsedEpisodes[0].chunkId !== "A01" || parsedEpisodes[0].sceneStart !== 1)) {
    return errorResponse("Project mới chỉ nhận tập đầu tiên A01 bắt đầu từ S001. Để nhập tập tiếp theo, hãy thêm tập tương ứng trong project hoặc nhập gói series có đủ các tập trước.", 409);
  }
  if (bundle && pristine && (parsedEpisodes[0].chunkId !== "A01" || parsedEpisodes[0].sceneStart !== 1)) {
    return errorResponse("Gói series nhập vào project mới cần bắt đầu bằng A01 / S001.", 409);
  }
  if (bundle) {
    for (let index = 1; index < parsedEpisodes.length; index += 1) {
      const previous = parsedEpisodes[index - 1];
      const current = parsedEpisodes[index];
      const previousChunkNumber = Number(previous.chunkId.slice(1));
      const currentChunkNumber = Number(current.chunkId.slice(1));
      if (currentChunkNumber !== previousChunkNumber + 1) return errorResponse(`Gói series thiếu tập giữa A${String(previousChunkNumber + 1).padStart(2, "0")} và ${current.chunkId}.`);
      if (current.sceneStart !== previous.sceneEnd + 1) return errorResponse(`${current.chunkId} cần tiếp nối từ S${String(previous.sceneEnd + 1).padStart(3, "0")}.`);
      const previousScene = previous.scenes.at(-1);
      const currentScene = current.scenes[0];
      if (Number(currentScene.start_sec) < Number(previousScene?.end_sec)) return errorResponse(`${current.chunkId}: timecode chồng lấn với ${previous.chunkId}.`);
    }
  }
  const replace = body?.replace === true;
  const conflicts = parsedEpisodes.filter((episode) => existing.chunks.some((chunk) => chunk.id === episode.chunkId && Boolean(chunk.outputPath)));
  if (conflicts.length && !replace) {
    return errorResponse("Một số tập đã có kịch bản. Xác nhận ghi đè để thay các tập đó.", 409, { code: "CHUNK_OUTPUT_EXISTS", conflictingChunks: conflicts.map((episode) => episode.chunkId) });
  }

  if (!pristine || preserveProjectStructure) {
    for (const episode of parsedEpisodes) {
      const existingChunk = existing.chunks.find((chunk) => chunk.id === episode.chunkId);
      if (existingChunk && !existingChunk.outputPath && (existingChunk.sceneStart !== episode.sceneStart || existingChunk.sceneEnd !== episode.sceneEnd)) {
        return errorResponse(`${episode.chunkId} dự kiến S${String(existingChunk.sceneStart).padStart(3, "0")}–S${String(existingChunk.sceneEnd).padStart(3, "0")}, nhưng file có S${String(episode.sceneStart).padStart(3, "0")}–S${String(episode.sceneEnd).padStart(3, "0")}. Hãy xuất lại đúng scene range trong cấu hình project.`, 409);
      }
      if (!existingChunk) {
        const finalScene = Math.max(existing.totalScenes, ...existing.chunks.map((chunk) => chunk.sceneEnd));
        if (episode.sceneStart !== finalScene + 1) return errorResponse(`${episode.chunkId} chưa tồn tại và cần bắt đầu từ S${String(finalScene + 1).padStart(3, "0")} để nối tiếp project. Thêm tập trong project trước hoặc nhập các tập còn thiếu.`, 409);
      }
    }
  }

  const targetChunkIds = new Set(importedChunkIds);
  const targetSceneIds = new Set(importedSceneIds);
  for (const chunk of existing.chunks) {
    if (!chunk.outputPath || targetChunkIds.has(chunk.id)) continue;
    const output = asRecord(await readChunkOutput(chunk));
    const scenes = Array.isArray(output?.scenes) ? output.scenes : [];
    for (const rawScene of scenes) {
      const scene = asRecord(rawScene);
      const id = String(scene?.id || scene?.scene_id || "");
      if (targetSceneIds.has(id)) return errorResponse(`Scene ${id} đã thuộc tập ${chunk.id}. Không thể nhập trùng scene ID vào tập khác.`, 409);
    }
  }

  if (busyProject(existing) || isProjectChunkRunActive(slug) || isProjectRenderActive(slug) || isProjectTtsActive(slug)) {
    return errorResponse("Project đang chạy tác vụ. Hãy đợi tạo kịch bản, TTS, render hoặc queue video hoàn tất rồi nhập JSON.", 409, { code: "PROJECT_BUSY" });
  }
  if (!claimProjectChunkRun(slug)) return errorResponse("Project đang chạy một tác vụ khác.", 409, { code: "PROJECT_BUSY" });
  if (!claimProjectRender(slug)) {
    releaseProjectChunkRun(slug);
    return errorResponse("Project đang ghép video. Hãy thử lại sau.", 409, { code: "PROJECT_BUSY" });
  }
  if (!claimProjectTts(slug)) {
    releaseProjectRender(slug);
    releaseProjectChunkRun(slug);
    return errorResponse("Project đang tạo TTS. Hãy thử lại sau.", 409, { code: "PROJECT_BUSY" });
  }

  try {
    const updated = await updateData(async (data) => {
      const project = data.projects.find((item) => item.slug === slug);
      if (!project) throw new Error("PROJECT_NOT_FOUND");
      if (busyProject(project)) throw new Error("PROJECT_BUSY");

      const timestamp = now();
      const importedChunkRecords: ProjectChunk[] = [];
      for (const episode of parsedEpisodes) {
        const chunk: ProjectChunk = {
          ...(project.chunks.find((item) => item.id === episode.chunkId) || {} as ProjectChunk),
          id: episode.chunkId,
          sceneStart: episode.sceneStart,
          sceneEnd: episode.sceneEnd,
          generatedScenes: episode.scenes.length,
          status: "completed",
          error: undefined,
          updatedAt: timestamp,
          tts: undefined,
        };
        const aiReview = await evaluateChunkScenes({ project, chunk, scenes: episode.scenes, useModel: false });
        const payload = { ...episode.payload, scenes: aiReview.scenes };
        const outputPath = await saveChunkOutput(slug, episode.chunkId, payload);
        chunk.outputPath = outputPath;
        const oldChunk = project.chunks.find((item) => item.id === episode.chunkId);
        if (oldChunk?.render) chunk.render = markRenderStale(oldChunk.render);
        else chunk.render = undefined;
        const ttsTotal = aiReview.scenes.reduce((total, scene) => {
          if (project.presetId === "ai-drama" && hasExplicitDialogueSegments(scene)) {
            return total + readDialogueSegments(scene, project.characters || []).length;
          }
          return total + (String(scene.dialogue_or_voiceover || "").trim() ? 1 : 0);
        }, 0);
        chunk.tts = ttsTotal
          ? { status: "idle", completed: 0, total: ttsTotal, failed: 0, updatedAt: timestamp }
          : { status: "not_needed", completed: 0, total: 0, failed: 0, updatedAt: timestamp };
        importedChunkRecords.push(chunk);
      }

      if (bundle) {
        const metadata = asRecord(source.project) || {};
        if (!preserveProjectSettings) {
          const title = typeof metadata.title === "string" ? metadata.title.trim().slice(0, 200) : "";
          if (title) project.title = title;
          if (typeof metadata.language === "string" && metadata.language.trim()) {
            project.language = metadata.language.trim().slice(0, 32);
            project.voiceLanguage = project.voiceLanguage || project.language;
          }
          if (typeof metadata.content_genre === "string") {
            project.contentGenre = normalizeContentGenre(metadata.content_genre);
            project.secondaryGenres = normalizeSecondaryGenres(metadata.secondary_genres, project.contentGenre);
          }
          if (typeof metadata.story_setting === "string") project.storySetting = normalizeStorySetting(metadata.story_setting);
          if (typeof metadata.setting_notes === "string") project.settingNotes = metadata.setting_notes.trim().slice(0, 2000);
          const importedVisualStyle = typeof metadata.visual_style === "string" ? metadata.visual_style.trim().slice(0, 160) : "";
          const importedImageStyle = typeof metadata.image_style === "string" ? metadata.image_style.trim().slice(0, 160) : "";
          if (importedVisualStyle || importedImageStyle) {
            const styles = normalizeProjectStyleSettings(importedVisualStyle || project.visualStyle, importedImageStyle || undefined);
            project.visualStyle = styles.visualStyle;
            project.imageStyle = styles.imageStyle;
          }
          if (typeof metadata.aspect_ratio === "string" && /^\d{1,2}:\d{1,2}$/.test(metadata.aspect_ratio)) project.aspectRatio = metadata.aspect_ratio;
          const chunkSize = Number(metadata.chunk_size);
          if (Number.isInteger(chunkSize) && chunkSize >= 1 && chunkSize <= 100) project.chunkSize = chunkSize;
        }
        const seriesBible = asRecord(source.series_bible);
        if (seriesBible) project.seriesBible = seriesBible;
      }

      const importedPackage = project.publishingPackage || {};
      const publishingEpisodes = { ...(importedPackage.episodes || {}) };
      for (const episode of parsedEpisodes) {
        const prior = publishingEpisodes[episode.chunkId];
        if (prior) publishingEpisodes[episode.chunkId] = { ...prior, stale: true };
      }
      Object.assign(publishingEpisodes, importedEpisodePackages);
      const seriesPackage = rootPackage.series || (importedPackage.series ? { ...importedPackage.series, stale: true } : undefined);
      if (seriesPackage || Object.keys(publishingEpisodes).length) {
        project.publishingPackage = {
          ...(seriesPackage ? { series: seriesPackage } : {}),
          ...(Object.keys(publishingEpisodes).length ? { episodes: publishingEpisodes } : {}),
        };
      }

      if (pristine && !preserveProjectStructure) {
        project.chunks = importedChunkRecords;
      } else {
        const updatedById = new Map(importedChunkRecords.map((chunk) => [chunk.id, chunk]));
        project.chunks = project.chunks.map((chunk) => updatedById.get(chunk.id) || chunk);
        for (const chunk of importedChunkRecords) {
          if (!project.chunks.some((item) => item.id === chunk.id)) project.chunks.push(chunk);
        }
        project.chunks.sort((left, right) => left.sceneStart - right.sceneStart || left.id.localeCompare(right.id));
      }

      const maxImportedScene = Math.max(...parsedEpisodes.map((episode) => episode.sceneEnd));
      project.totalScenes = pristine && !preserveProjectStructure ? maxImportedScene : Math.max(project.totalScenes, maxImportedScene);
      project.totalChunks = project.chunks.length;
      project.completedScenes = project.chunks.reduce((sum, chunk) => sum + chunk.generatedScenes, 0);
      project.completedChunks = project.chunks.filter((chunk) => chunk.status === "completed").length;
      const importedDuration = Math.max(...parsedEpisodes.flatMap((episode) => episode.scenes.map((scene) => Number(scene.end_sec) || 0)));
      project.durationSeconds = pristine && !preserveProjectStructure ? importedDuration : Math.max(Number(project.durationSeconds || 0), importedDuration);
      project.durationMinutes = Number((project.durationSeconds / 60).toFixed(3));
      project.continuityQa = undefined;
      project.render = markRenderStale(project.render);
      project.status = project.completedChunks >= project.totalChunks ? "needs_review" : "processing";
      project.updatedAt = timestamp;

      const storedScenes = await readProjectScenes(project);
      project.reviewCount = storedScenes.filter((scene) => String(scene.review_status || scene.reviewStatus || "unreviewed") === "needs_changes").length;
      project.aiReviewCount = storedScenes.filter((scene) => importedAiReview(scene) === "needs_changes").length;
      const lastChunk = [...project.chunks].filter((chunk) => chunk.outputPath).sort((left, right) => right.sceneEnd - left.sceneEnd)[0];
      if (lastChunk?.outputPath) {
        const payload = asRecord(await readChunkOutput(lastChunk));
        project.continuityContext = continuityContextFromOutput({ payload, chunkId: lastChunk.id, sceneEnd: lastChunk.sceneEnd, previousContext: project.continuityContext });
      }
      project.continuityQa = await buildContinuityQaReport(project);
      data.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "project",
        title: `Đã nhập ${parsedEpisodes.length} tập từ JSON`,
        detail: `${parsedEpisodes.reduce((sum, episode) => sum + episode.scenes.length, 0)} cảnh · ${bundle ? "scene-series.v1" : "scene-script.v1"} · AI pre-check cấu trúc đã chạy`,
        status: "success",
      }));
      return {
        project,
        imported: importedChunkRecords.map((chunk) => ({ chunkId: chunk.id, sceneStart: chunk.sceneStart, sceneEnd: chunk.sceneEnd, sceneCount: chunk.generatedScenes })),
        publishingImported: { series: Boolean(rootPackage.series), episodes: Object.keys(importedEpisodePackages) },
      };
    });

    return NextResponse.json({ ok: true, project: updated.project, imported: updated.imported, publishingImported: updated.publishingImported, replaced: replace ? conflicts.map((item) => item.chunkId) : [] });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "SCRIPT_IMPORT_FAILED";
    if (code === "PROJECT_NOT_FOUND") return errorResponse("Không tìm thấy project.", 404);
    if (code === "PROJECT_BUSY") return errorResponse("Project vừa bắt đầu một tác vụ khác. Hãy đợi tác vụ hoàn tất rồi nhập lại.", 409, { code });
    return errorResponse(`Không thể nhập JSON: ${code}`, 500);
  } finally {
    releaseProjectTts(slug);
    releaseProjectRender(slug);
    releaseProjectChunkRun(slug);
  }
}

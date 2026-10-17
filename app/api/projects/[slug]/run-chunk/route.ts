import { NextResponse } from "next/server";
import { ingestSourceUrl } from "../../../../lib/source-ingest";
import { materializeChunkMedia } from "../../../../lib/media-provider";
import type { ContinuityContext, ProjectChunk, StoryProject } from "../../../../lib/project-types";
import { buildManualSceneDrafts, getManualScriptMetrics } from "../../../../lib/script-utils";
import { buildChunkPrompt, STORY_PRESETS, type StoryPreset } from "../../../../lib/story-presets";
import { generateWithScriptProvider } from "../../../../lib/script-provider";
import { buildContinuityContext, withContinuityContext } from "../../../../lib/story-context";
import { evaluateChunkScenes } from "../../../../lib/scene-ai-review";
import { buildContinuityQaReport } from "../../../../lib/continuity-qa";
import { buildDramaChunkSourceText } from "../../../../lib/drama-plan";
import { normalizeAiDramaSceneTimings } from "../../../../lib/ai-drama-scene-timing";
import { sanitizeDramaScenePrompts } from "../../../../lib/visual-prompt-safety";
import { claimProjectChunkRun, releaseProjectChunkRun } from "../../../../lib/chunk-generation-lock";
import { readProjectScenes } from "../../../../lib/scene-store";
import { getRunConcurrencyLimit } from "../../../../lib/user-settings";
import { getPreviousContinuityContext, getProjectOrThrow, makeActivity, markRenderStale, now, readData, saveChunkOutput, updateData, updateProjectRecord } from "../../../../lib/server-store";

export const runtime = "nodejs";

const MAX_SCENES_PER_SCRIPT_REQUEST = 10;
const MIN_SCENES_PER_SCRIPT_RETRY = 5;

type GeneratedScriptBatch = { model: string; result: Record<string, unknown>; scenes: unknown[] };

async function generateSceneRange({
  project,
  chunk,
  preset,
  sourceText,
  start,
  end,
  previousContext,
}: {
  project: StoryProject;
  chunk: ProjectChunk;
  preset: StoryPreset;
  sourceText: string;
  start: number;
  end: number;
  previousContext?: ContinuityContext;
}): Promise<{ batches: GeneratedScriptBatch[]; context: ContinuityContext }> {
  const prompt = buildChunkPrompt({
    preset,
    sourceUrl: project.sourceUrl,
    sourceText,
    projectTitle: project.title,
    chunkId: chunk.id,
    sceneStart: start,
    sceneEnd: end,
    episodeOpeningScene: chunk.sceneStart,
    totalScenes: project.totalScenes,
    contentGenre: project.contentGenre,
    secondaryGenres: project.secondaryGenres,
    storySetting: project.storySetting,
    settingNotes: project.settingNotes,
    visualStyle: project.visualStyle,
    imageStyle: project.imageStyle,
    aspectRatio: project.aspectRatio,
    language: project.language,
    voiceName: project.voiceName,
    continuityContext: previousContext,
  });
  const expectedCount = end - start + 1;
  try {
    const output = await generateWithScriptProvider(prompt);
    const result = output.result && typeof output.result === "object" && !Array.isArray(output.result)
      ? output.result as Record<string, unknown>
      : {};
    const scenes = Array.isArray(result.scenes) ? result.scenes : [];
    if (scenes.length !== expectedCount) {
      if (expectedCount > MIN_SCENES_PER_SCRIPT_RETRY) {
        throw new Error(`SCRIPT_BATCH_INCOMPLETE: ${scenes.length}/${expectedCount}`);
      }
      throw new Error(`AI trả ${scenes.length}/${expectedCount} cảnh cho ${chunk.id} · S${String(start).padStart(3, "0")}–S${String(end).padStart(3, "0")}. Hãy thử chạy lại tập này.`);
    }
    const batch: GeneratedScriptBatch = { model: output.model, result, scenes };
    return {
      batches: [batch],
      context: buildContinuityContext({ chunkId: chunk.id, sceneEnd: end, result, previousContext }),
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const canSplit = expectedCount > MIN_SCENES_PER_SCRIPT_RETRY
      && (/^SCRIPT_BATCH_INCOMPLETE:/.test(message) || /MODEL_OUTPUT_INVALID_JSON|MODEL_OUTPUT_INCOMPLETE|context length|maximum context|too many tokens/i.test(message));
    if (!canSplit) throw cause;

    // Ask for smaller scene ranges when the model truncates or returns a
    // partial batch. This preserves the episode boundary while recovering the
    // damaged portion with its own continuity hand-off.
    const midpoint = Math.floor((start + end) / 2);
    const first = await generateSceneRange({ project, chunk, preset, sourceText, start, end: midpoint, previousContext });
    const second = await generateSceneRange({ project, chunk, preset, sourceText, start: midpoint + 1, end, previousContext: first.context });
    return { batches: [...first.batches, ...second.batches], context: second.context };
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const snapshot = await readData();
  let project: StoryProject;
  try { project = getProjectOrThrow(snapshot, slug); } catch { return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 }); }
  if (!project.sourceText.trim() && project.sourceUrl.trim()) {
    try {
      const source = await ingestSourceUrl(project.sourceUrl);
      project = await updateData((data) => {
        const index = data.projects.findIndex((item) => item.slug === slug);
        if (index < 0) throw new Error("PROJECT_NOT_FOUND");
        const current = data.projects[index];
        const updated = updateProjectRecord(current, { sourceText: source.text });
        data.projects[index] = updated;
        data.activities.unshift(makeActivity({ projectSlug: slug, kind: "source", title: "Đã lấy transcript trước khi chạy chunk", detail: `${source.platform || "video"} · ${source.text.length.toLocaleString("vi-VN")} ký tự`, status: "success" }));
        return updated;
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Không lấy được transcript từ URL.";
      return NextResponse.json({ code: cause instanceof Error ? cause.name : "SOURCE_INGEST_FAILED", message }, { status: 502 });
    }
  }
  if (!project.sourceText.trim()) return NextResponse.json({ code: "SOURCE_TRANSCRIPT_REQUIRED", message: "Cần dán transcript hoặc brief trước khi chạy chunk. URL đơn lẻ chưa được coi là transcript đã phân tích." }, { status: 409 });
  const parsedBody = await request.json().catch(() => ({}));
  const requestedChunkId = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) && typeof parsedBody.chunkId === "string"
    ? parsedBody.chunkId.trim()
    : "";
  const scriptOnly = project.presetId === "ai-drama";
  const chunk = requestedChunkId
    ? project.chunks.find((item) => item.id === requestedChunkId)
    : project.chunks.find((item) => item.status === "queued" || item.status === "failed");
  if (requestedChunkId && !chunk) return NextResponse.json({ code: "CHUNK_NOT_FOUND", message: "Không tìm thấy tập cần chạy." }, { status: 404 });
  if (!chunk) return NextResponse.json({ code: "NO_QUEUED_CHUNK", message: "Không còn chunk đang chờ xử lý." }, { status: 409 });
  if (chunk.status === "processing" || project.chunks.some((item) => item.status === "processing")) {
    return NextResponse.json({ code: "CHUNK_ALREADY_RUNNING", message: "Một tập của dự án đang chạy. Hãy đợi xong trước khi chạy tập khác." }, { status: 409 });
  }
  if (chunk.status !== "queued" && chunk.status !== "failed") {
    return NextResponse.json({ code: "CHUNK_ALREADY_COMPLETED", message: "Tập này đã có kịch bản. Hãy xem kịch bản hoặc tạo dự án/chunk mới nếu muốn sinh lại." }, { status: 409 });
  }
  if (!claimProjectChunkRun(slug)) return NextResponse.json({ code: "CHUNK_ALREADY_RUNNING", message: "Một tập của dự án đang chạy." }, { status: 409 });

  try {
    await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      const target = current.chunks.find((item) => item.id === chunk.id);
      if (target) { target.status = "processing"; target.error = undefined; target.updatedAt = now(); }
      current.status = "processing";
      current.updatedAt = now();
      data.activities.unshift(makeActivity({ projectSlug: slug, kind: "chunk", title: `${chunk.id} bắt đầu xử lý`, detail: `S${String(chunk.sceneStart).padStart(3, "0")}–S${String(chunk.sceneEnd).padStart(3, "0")}`, status: "info" }));
    });
    const preset = STORY_PRESETS[project.presetId];
    const previousContext = await getPreviousContinuityContext(project, chunk);
    const earlierDramaScenes = project.presetId === "ai-drama"
      ? (await readProjectScenes(project)).filter((scene) => {
        const number = Number(scene.sceneNumber) || Number(scene.id.replace(/\D/g, "")) || 0;
        return number > 0 && number < chunk.sceneStart;
      })
      : [];
    const dramaTimelineStartSec = earlierDramaScenes.reduce((sum, scene) => {
      const start = Number(scene.start_sec ?? scene.startSec);
      const end = Number(scene.end_sec ?? scene.endSec);
      const duration = Number(scene.duration_sec ?? scene.durationSec);
      return sum + (Number.isFinite(duration) && duration > 0 ? duration : Number.isFinite(end - start) && end > start ? end - start : 15);
    }, 0);
    const manualMode = (project.scriptMode || "ai") === "manual";
    let generated: { model: string; result: unknown };
    let scenes: unknown[];
    if (manualMode) {
      const metrics = getManualScriptMetrics({
        text: project.sourceText,
        format: project.scriptFormat || "plain_text",
        durationMode: project.durationMode || "auto",
        targetDurationSeconds: Number(project.durationSeconds || project.durationMinutes * 60),
      });
      if (!metrics.narrationDurationSec) throw new Error("MANUAL_SCRIPT_EMPTY_OR_INVALID");
      if (metrics.issues.length) throw new Error(`MANUAL_SCRIPT_INVALID: ${metrics.issues.slice(0, 3).join(" ")}`);
      const allScenes = buildManualSceneDrafts(project);
      scenes = allScenes.filter((scene) => scene.sceneNumber >= chunk.sceneStart && scene.sceneNumber <= chunk.sceneEnd);
      if (!scenes.length) throw new Error("MANUAL_SCRIPT_CHUNK_EMPTY");
      generated = {
        model: "manual-script",
        result: {
          schema: "scene-script.v1",
          script_mode: "manual",
          chunk_id: chunk.id,
          chunk_summary: `Cảnh ${chunk.sceneStart}–${chunk.sceneEnd} được tạo trực tiếp từ kịch bản người dùng.`,
          scenes,
        },
      };
    } else {
      const dramaChunkIndex = Math.max(0, project.chunks.findIndex((item) => item.id === chunk.id));
      const chunkSourceText = project.presetId === "ai-drama" && project.dramaPlan && project.sourceText.includes("CHAPTER PLAN")
        ? buildDramaChunkSourceText({
          sourceText: project.sourceText,
          plan: project.dramaPlan,
          chunkIndex: dramaChunkIndex,
          characters: project.characters,
          locations: project.locations,
        })
        : project.sourceText;
      const generatedBatches: GeneratedScriptBatch[] = [];
      let batchContext = previousContext;
      for (let batchStart = chunk.sceneStart; batchStart <= chunk.sceneEnd; batchStart += MAX_SCENES_PER_SCRIPT_REQUEST) {
        const batchEnd = Math.min(chunk.sceneEnd, batchStart + MAX_SCENES_PER_SCRIPT_REQUEST - 1);
        const generatedRange = await generateSceneRange({
          project,
          chunk,
          preset,
          sourceText: chunkSourceText,
          start: batchStart,
          end: batchEnd,
          previousContext: batchContext,
        });
        generatedBatches.push(...generatedRange.batches);
        batchContext = generatedRange.context;
      }
      scenes = generatedBatches.flatMap((batch) => batch.scenes);
      const lastResult = generatedBatches.at(-1)?.result || {};
      const summaries = generatedBatches.map((batch) => String(batch.result.chunk_summary || batch.result.chunkSummary || "").trim()).filter(Boolean);
      const finalState = lastResult.continuity_state ?? lastResult.continuityState ?? lastResult.continuity;
      generated = {
        model: [...new Set(generatedBatches.map((batch) => batch.model))].join(", "),
        result: {
          schema: "scene-script.v1",
          chunk_id: chunk.id,
          chunk_summary: summaries.join("\n").slice(0, 4000),
          scenes,
          ...(finalState !== undefined ? { continuity_state: finalState } : {}),
        },
      };
    }
    if (!scenes.length) throw new Error("MODEL_OUTPUT_HAS_NO_SCENES");
    if (project.presetId === "ai-drama") scenes = normalizeAiDramaSceneTimings(scenes, dramaTimelineStartSec);
    if (project.presetId === "ai-drama") scenes = sanitizeDramaScenePrompts(scenes);
    const continuityContext = buildContinuityContext({ chunkId: chunk.id, sceneEnd: chunk.sceneEnd, result: generated.result, previousContext });
    const previousScenes = scriptOnly ? [] : (await readProjectScenes(project)).filter((scene) => {
      const number = Number(scene.sceneNumber) || Number(scene.id.replace(/\D/g, "")) || 0;
      return number > 0 && number < chunk.sceneStart;
    });
    const media = scriptOnly
      ? { scenes, summary: { source: "deferred", requested: 0, ready: 0, failed: 0, fallback: 0 } }
      : await materializeChunkMedia({
        projectSlug: slug,
        chunkId: chunk.id,
        scenes,
        characters: project.characters || [],
        locations: project.locations || [],
        mediaSource: project.mediaSource || "stock-mixed",
        aspectRatio: project.aspectRatio,
        mediaGeneration: project.mediaGeneration,
        presetId: project.presetId,
        contentGenre: project.contentGenre,
        secondaryGenres: project.secondaryGenres,
        storySetting: project.storySetting,
        settingNotes: project.settingNotes,
        visualStyle: project.visualStyle,
        imageStyle: project.imageStyle,
        videoSpokenLanguage: project.language,
        projectVoiceId: project.voiceId,
        projectVoiceName: project.voiceName,
        projectVoiceLanguage: project.voiceLanguage,
        previousScenes,
        sceneStart: chunk.sceneStart,
        concurrency: await getRunConcurrencyLimit(),
      });
    // Manual mode bypasses the script-generation LLM, but keeps the AI
    // pre-check so every scene is still evaluated before human review.
    const aiReview = await evaluateChunkScenes({ project, chunk, scenes: media.scenes, useModel: true });
    const contextualOutput = withContinuityContext(generated.result, continuityContext);
    const outputWithContext = contextualOutput && typeof contextualOutput === "object" && !Array.isArray(contextualOutput)
      ? { ...(contextualOutput as Record<string, unknown>), scenes: aiReview.scenes, media_summary: media.summary, ai_review_summary: aiReview.summary }
      : { result: contextualOutput, scenes: aiReview.scenes, media_summary: media.summary, ai_review_summary: aiReview.summary };
    const outputPath = await saveChunkOutput(slug, chunk.id, outputWithContext);
    const updated = await updateData(async (data) => {
      const current = getProjectOrThrow(data, slug);
      const target = current.chunks.find((item) => item.id === chunk.id);
      if (!target) throw new Error("CHUNK_NOT_FOUND");
      target.status = "completed";
      target.generatedScenes = media.scenes.length;
      target.outputPath = outputPath;
      target.render = markRenderStale(target.render);
      target.updatedAt = now();
      if (current.publishingPackage) {
        const publishingPackage = current.publishingPackage;
        const priorEpisodePackage = publishingPackage.episodes?.[chunk.id];
        current.publishingPackage = {
          ...publishingPackage,
          ...(publishingPackage.series ? { series: { ...publishingPackage.series, stale: true } } : {}),
          ...(priorEpisodePackage
            ? { episodes: { ...(publishingPackage.episodes || {}), [chunk.id]: { ...priorEpisodePackage, stale: true } } }
            : {}),
        };
      }
      current.render = markRenderStale(current.render);
      current.completedScenes = current.chunks.reduce((sum, item) => sum + item.generatedScenes, 0);
      current.completedChunks = current.chunks.filter((item) => item.status === "completed").length;
      current.aiReviewCount = (await readProjectScenes(current)).filter((item) => {
        const review = item.ai_review && typeof item.ai_review === "object" && !Array.isArray(item.ai_review) ? item.ai_review as Record<string, unknown> : {};
        return String(review.status || "pending") === "needs_changes";
      }).length;
      current.continuityContext = continuityContext;
      current.continuityQa = await buildContinuityQaReport(current);
      current.status = current.completedChunks >= current.totalChunks ? "needs_review" : "processing";
      current.updatedAt = now();
      data.activities.unshift(makeActivity({ projectSlug: slug, kind: "chunk", title: scriptOnly ? `${chunk.id} hoàn tất kịch bản` : `${chunk.id} hoàn tất`, detail: `${aiReview.scenes.length} cảnh · AI ${aiReview.summary.passed} đạt/${aiReview.summary.needsChanges} cần sửa${scriptOnly ? " · media để người dùng tạo sau khi duyệt prompt" : ` · media ${media.summary.ready}/${media.summary.requested} sẵn sàng${media.summary.fallback ? ` · ${media.summary.fallback} cảnh dùng dự phòng` : ""}`} · model ${generated.model}`, status: media.summary.failed || media.summary.fallback || aiReview.summary.needsChanges || aiReview.summary.errors ? "warning" : "success" }));
      return current;
    });
    return NextResponse.json({ ok: true, project: updated, chunk: updated.chunks.find((item) => item.id === chunk.id), output: outputWithContext, continuity: continuityContext, provider: { model: generated.model } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Chunk failed";
    await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      const target = current.chunks.find((item) => item.id === chunk.id);
      if (target) { target.status = "failed"; target.error = message; target.updatedAt = now(); }
      current.status = "failed";
      current.updatedAt = now();
      data.activities.unshift(makeActivity({ projectSlug: slug, kind: "chunk", title: `${chunk.id} thất bại`, detail: message, status: "error" }));
    });
    const status = message === "SCRIPT_LLM_NOT_CONFIGURED" ? 503 : 502;
    return NextResponse.json({ code: message, message: message === "SCRIPT_LLM_NOT_CONFIGURED" ? "Chưa cấu hình OPENAI_API_KEY ở server." : message }, { status });
  } finally {
    releaseProjectChunkRun(slug);
  }
}

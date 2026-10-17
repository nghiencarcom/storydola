import { NextResponse } from "next/server";
import { assertAiDramaVideosReady, buildRenderManifest, calculateRenderDuration, renderProjectVideo, RenderMediaPreflightError, writeRenderArtifacts, type RenderEpisodeTarget } from "../../../../../../lib/render-service";
import { normalizeRenderSettings } from "../../../../../../lib/render-effects";
import type { RenderSettings } from "../../../../../../lib/project-types";
import { claimProjectRender, releaseProjectRender } from "../../../../../../lib/render-lock";
import { isProjectTtsActive } from "../../../../../../lib/tts-lock";
import { getProjectOrThrow, makeActivity, now, readData, updateData } from "../../../../../../lib/server-store";
import { readProjectScenes } from "../../../../../../lib/scene-store";
import { FALLBACK_VIDEO_LANGUAGES, voiceLanguageLabel } from "../../../../../../lib/omnivoice";

export const runtime = "nodejs";

function fileUrl(slug: string, chunkId: string, kind: "video" | "manifest" | "subtitle", language?: string) {
  return `/api/projects/${encodeURIComponent(slug)}/chunks/${encodeURIComponent(chunkId)}/render/file?kind=${kind}${language ? `&language=${encodeURIComponent(language)}` : ""}`;
}

function normalizeLanguage(value: unknown) {
  const language = String(value || "").trim().replace(/_/g, "-");
  return FALLBACK_VIDEO_LANGUAGES.find((item) => item.toLowerCase() === language.toLowerCase()) || "";
}

export async function GET(request: Request, context: { params: Promise<{ slug: string; chunkId: string }> }) {
  const { slug, chunkId } = await context.params;
  const language = normalizeLanguage(new URL(request.url).searchParams.get("language"));
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const chunk = project.chunks.find((item) => item.id === chunkId);
  if (!chunk) return NextResponse.json({ message: "Không tìm thấy tập." }, { status: 404 });
  const episodeNumber = project.chunks.findIndex((item) => item.id === chunkId) + 1;
  const render = language ? chunk.render?.localizedRenders?.[language] || null : chunk.render || null;
  return NextResponse.json({
    chunkId,
    episodeNumber,
    render,
    urls: render ? {
      video: render.outputPath ? fileUrl(slug, chunkId, "video", language) : "",
      manifest: render.manifestPath ? fileUrl(slug, chunkId, "manifest", language) : "",
      subtitle: render.subtitlePath ? fileUrl(slug, chunkId, "subtitle", language) : "",
    } : null,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ slug: string; chunkId: string }> }) {
  const { slug, chunkId } = await context.params;
  const snapshot = await readData();
  let project = snapshot.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  let chunk = project.chunks.find((item) => item.id === chunkId);
  if (!chunk) return NextResponse.json({ message: "Không tìm thấy tập." }, { status: 404 });
  if (!chunk.outputPath) return NextResponse.json({ code: "CHUNK_NOT_READY", message: "Tập này chưa có kịch bản cảnh để ghép video." }, { status: 409 });

  const parsedBody = await request.json().catch(() => ({}));
  const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
    ? parsedBody as { settings?: Partial<RenderSettings>; language?: string }
    : {};
  const settings = normalizeRenderSettings(body.settings);
  const dialogueLanguage = body.language ? normalizeLanguage(body.language) : "";
  if (body.language && !dialogueLanguage) return NextResponse.json({ code: "INVALID_RENDER_LANGUAGE", message: "Ngôn ngữ render không hợp lệ." }, { status: 400 });
  if (dialogueLanguage && project.presetId !== "ai-drama") return NextResponse.json({ code: "LOCALIZED_RENDER_UNSUPPORTED", message: "Render voice theo ngôn ngữ dịch hiện hỗ trợ project AI Drama." }, { status: 400 });
  if (isProjectTtsActive(slug)) return NextResponse.json({ code: "TTS_ALREADY_RUNNING", message: "Project đang tạo TTS. Hãy đợi tác vụ này hoàn tất rồi ghép video." }, { status: 409 });
  if (!claimProjectRender(slug)) return NextResponse.json({ code: "RENDER_ALREADY_RUNNING", message: "Dự án đang có video được ghép. Hãy đợi tác vụ hiện tại hoàn tất." }, { status: 409 });

  const episodeNumber = project.chunks.findIndex((item) => item.id === chunkId) + 1;
  const episodeLabel = `Tập ${String(episodeNumber).padStart(2, "0")}`;
  const renderId = `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const target: RenderEpisodeTarget = { chunkId, episodeNumber, renderId, ...(dialogueLanguage ? { language: dialogueLanguage } : {}) };

  try {
    const renderSnapshot = await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      const currentChunk = current.chunks.find((item) => item.id === chunkId);
      if (!currentChunk) throw new Error("CHUNK_NOT_FOUND");
      if (!currentChunk.outputPath) throw new Error("CHUNK_NOT_READY");
      if (dialogueLanguage) {
        currentChunk.render = currentChunk.render || { status: "idle", updatedAt: now() };
        currentChunk.render.localizedRenders = {
          ...(currentChunk.render.localizedRenders || {}),
          [dialogueLanguage]: { ...currentChunk.render.localizedRenders?.[dialogueLanguage], status: "running", stale: false, language: dialogueLanguage, updatedAt: now(), error: undefined },
        };
      } else {
        currentChunk.render = { ...currentChunk.render, status: "running", stale: false, updatedAt: now(), error: undefined };
      }
      current.updatedAt = now();
      return { project: current, chunk: currentChunk };
    });
    project = renderSnapshot.project;
    chunk = renderSnapshot.chunk;

    const scenes = (await readProjectScenes(project)).filter((scene) => scene.chunkId === chunkId);
    if (!scenes.length) throw new Error("RENDER_NO_SCENES");
    await assertAiDramaVideosReady(project, scenes, chunk.sceneEnd - chunk.sceneStart + 1);
    const baseManifest = await buildRenderManifest(project, scenes, { ...(dialogueLanguage ? { dialogueLanguage } : {}) });
    if (dialogueLanguage) {
      const dialogueCues = baseManifest.scenes.flatMap((scene) => scene.audioCues || []);
      const missingTranslatedAudio = dialogueCues.some((cue) => !cue.text.trim() || !cue.audioPath);
      const hasUnlocalizedNarration = scenes.some((scene) => {
        const record = scene as unknown as Record<string, unknown>;
        const hasNarration = [record.dialogue_or_voiceover, record.voiceText, record.voiceover].some((value) => typeof value === "string" && value.trim());
        return hasNarration && !baseManifest.scenes.find((item) => item.sceneId === scene.id)?.audioCues?.length;
      });
      if (!dialogueCues.length || missingTranslatedAudio || hasUnlocalizedNarration || !baseManifest.audio.ready) {
        throw new Error("TRANSLATED_TTS_NOT_READY");
      }
    }
    const episodeTitle = `${project.title} — ${episodeLabel}${dialogueLanguage ? ` · ${voiceLanguageLabel(dialogueLanguage)}` : ""}`;
    const episodeSettings = {
      ...settings,
      titleText: settings.titleText.trim() ? `${settings.titleText.trim()} — ${episodeLabel}` : "",
    };
    const renderManifest = { ...baseManifest, title: episodeTitle, settings: episodeSettings };
    const outputPath = await renderProjectVideo(project, renderManifest, episodeSettings, target);
    const artifacts = await writeRenderArtifacts(project, renderManifest, episodeSettings, target);
    const durationSec = calculateRenderDuration(renderManifest, episodeSettings);
    const render = {
      status: "completed" as const,
      manifestPath: artifacts.manifestPath,
      outputPath,
      subtitlePath: artifacts.subtitlePath,
      sceneCount: renderManifest.scenes.length,
      durationSec: Number(durationSec.toFixed(3)),
      audioReady: renderManifest.audio.available,
      missingMedia: renderManifest.missingMedia,
      settings: episodeSettings,
      ...(dialogueLanguage ? { language: dialogueLanguage } : {}),
      updatedAt: now(),
    };
    const updated = await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      const currentChunk = current.chunks.find((item) => item.id === chunkId);
      if (!currentChunk) throw new Error("CHUNK_NOT_FOUND");
      const previousRender = dialogueLanguage ? currentChunk.render?.localizedRenders?.[dialogueLanguage] : currentChunk.render;
      const isStale = Boolean(previousRender?.stale);
      const savedRender = isStale ? { ...render, stale: true } : render;
      if (dialogueLanguage) {
        currentChunk.render = currentChunk.render || { status: "idle", updatedAt: now() };
        currentChunk.render.localizedRenders = { ...(currentChunk.render.localizedRenders || {}), [dialogueLanguage]: savedRender };
      } else {
        currentChunk.render = { ...savedRender, localizedRenders: currentChunk.render?.localizedRenders };
      }
      current.updatedAt = now();
      data.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "chunk",
        title: isStale ? `${episodeLabel} đã ghép nhưng cần ghép lại` : `${episodeLabel} đã ghép video${dialogueLanguage ? ` · ${voiceLanguageLabel(dialogueLanguage)}` : ""}`,
        detail: `${renderManifest.scenes.length} cảnh · ${Math.round(durationSec / 60)} phút · audio ${renderManifest.audio.available ? "đã có" : "chưa có"}${dialogueLanguage ? ` · voice ${voiceLanguageLabel(dialogueLanguage)}` : ""}${renderManifest.missingMedia ? ` · ${renderManifest.missingMedia} cảnh dùng media dự phòng` : ""}${isStale ? " · dữ liệu đổi trong lúc ghép" : ""}`,
        status: isStale || renderManifest.missingMedia || !renderManifest.audio.available ? "warning" : "success",
      }));
      return { chunk: currentChunk, render: savedRender };
    });

    return NextResponse.json({ ok: true, chunk: updated.chunk, render: updated.render, urls: {
      video: fileUrl(slug, chunkId, "video", dialogueLanguage),
      manifest: fileUrl(slug, chunkId, "manifest", dialogueLanguage),
      subtitle: fileUrl(slug, chunkId, "subtitle", dialogueLanguage),
    } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Ghép video tập thất bại.";
    await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      const currentChunk = current.chunks.find((item) => item.id === chunkId);
      if (currentChunk) {
        if (dialogueLanguage) {
          currentChunk.render = currentChunk.render || { status: "idle", updatedAt: now() };
          const previous = currentChunk.render.localizedRenders?.[dialogueLanguage];
          const hasPreviousArtifact = Boolean(previous?.outputPath || previous?.manifestPath || previous?.subtitlePath);
          currentChunk.render.localizedRenders = {
            ...(currentChunk.render.localizedRenders || {}),
            [dialogueLanguage]: { ...previous, status: "failed", stale: hasPreviousArtifact || previous?.stale, language: dialogueLanguage, updatedAt: now(), error: message },
          };
        } else {
          const hasPreviousArtifact = Boolean(currentChunk.render?.outputPath || currentChunk.render?.manifestPath || currentChunk.render?.subtitlePath);
          currentChunk.render = { ...currentChunk.render, status: "failed", stale: hasPreviousArtifact || currentChunk.render?.stale, updatedAt: now(), error: message };
        }
      }
      current.updatedAt = now();
      data.activities.unshift(makeActivity({ projectSlug: slug, kind: "chunk", title: `${episodeLabel} ghép video thất bại`, detail: message, status: "error" }));
    });
    const preflight = cause instanceof RenderMediaPreflightError ? cause : undefined;
    const status = preflight || ["RENDER_NO_SCENES", "CHUNK_NOT_READY", "TRANSLATED_TTS_NOT_READY"].includes(message) ? 409 : message === "FFMPEG_NOT_AVAILABLE" ? 503 : message === "CHUNK_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({
      code: preflight?.code || message,
      message: message === "FFMPEG_NOT_AVAILABLE" ? "Không tìm thấy ffmpeg để ghép MP4." : message === "RENDER_NO_SCENES" ? "Tập chưa có cảnh đã lưu để ghép video." : message === "CHUNK_NOT_READY" ? "Tập này chưa có kịch bản cảnh để ghép video." : message === "TRANSLATED_TTS_NOT_READY" ? `Hãy dịch đầy đủ lời thoại và tạo voice ${voiceLanguageLabel(dialogueLanguage)} cho mọi câu trong tập trước khi ghép.` : message,
      ...(preflight ? { issues: preflight.issues } : {}),
    }, { status });
  } finally {
    releaseProjectRender(slug);
  }
}

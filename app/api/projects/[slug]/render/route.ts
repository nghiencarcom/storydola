import { NextResponse } from "next/server";
import { assertAiDramaVideosReady, buildRenderManifest, calculateRenderDuration, renderProjectBlenderVideo, renderProjectVideo, RenderMediaPreflightError, writeRenderArtifacts } from "../../../../lib/render-service";
import { normalizeRenderSettings } from "../../../../lib/render-effects";
import type { RenderSettings } from "../../../../lib/project-types";
import { claimProjectRender, releaseProjectRender } from "../../../../lib/render-lock";
import { isProjectTtsActive } from "../../../../lib/tts-lock";
import { getProjectOrThrow, makeActivity, now, readData, updateData } from "../../../../lib/server-store";
import { readProjectScenes } from "../../../../lib/scene-store";

export const runtime = "nodejs";

function fileUrl(slug: string, kind: "video" | "manifest" | "subtitle" | "blend") {
  return `/api/projects/${encodeURIComponent(slug)}/render/file?kind=${kind}`;
}

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  return NextResponse.json({
    render: project.render || null,
    urls: project.render ? {
      video: project.render.outputPath ? fileUrl(slug, "video") : "",
      manifest: project.render.manifestPath ? fileUrl(slug, "manifest") : "",
      subtitle: project.render.subtitlePath ? fileUrl(slug, "subtitle") : "",
      blend: project.render.blenderProjectPath ? fileUrl(slug, "blend") : "",
    } : null,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const snapshot = await readData();
  let project = snapshot.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const parsedBody = await request.json().catch(() => ({}));
  const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
    ? parsedBody as { mode?: string; settings?: Partial<RenderSettings>; waitForCompletion?: boolean }
    : {};
  const mode = body.mode === "video" ? "video" : "manifest";
  const settings = normalizeRenderSettings(body.settings);
  if (isProjectTtsActive(slug)) return NextResponse.json({ code: "TTS_ALREADY_RUNNING", message: "Project đang tạo TTS. Hãy đợi tác vụ này hoàn tất rồi render." }, { status: 409 });
  if (!claimProjectRender(slug)) return NextResponse.json({ code: "RENDER_ALREADY_RUNNING", message: "Project đang được render." }, { status: 409 });
  const renderTask = (async () => {
  try {
    project = await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      current.render = { ...current.render, status: "running", stale: false, updatedAt: now(), error: undefined };
      current.updatedAt = now();
      return current;
    });
    const scenes = await readProjectScenes(project);
    if (!scenes.length) throw new Error("RENDER_NO_SCENES");
    if (mode === "video" && settings.renderer !== "blender") await assertAiDramaVideosReady(project, scenes, project.totalScenes);
    const manifest = await buildRenderManifest(project, scenes);
    const renderManifest = settings.renderer === "blender"
      ? { ...manifest, audio: { ready: false, available: false, note: "Blender scene rendered locally; no source-video audio or TTS was mixed." }, missingMedia: 0, settings }
      : { ...manifest, settings };
    const artifacts = await writeRenderArtifacts(project, renderManifest, settings);
    let outputPath: string | undefined;
    let blenderArtifacts: Awaited<ReturnType<typeof renderProjectBlenderVideo>> | undefined;
    if (mode === "video") {
      if (settings.renderer === "blender") {
        blenderArtifacts = await renderProjectBlenderVideo(project, scenes, renderManifest);
        outputPath = blenderArtifacts.outputPath;
      } else {
        outputPath = await renderProjectVideo(project, renderManifest, settings);
      }
    }
    const outputDurationSec = calculateRenderDuration(renderManifest, settings);
    const render = {
      status: outputPath ? "completed" as const : "manifest_only" as const,
      manifestPath: artifacts.manifestPath,
      outputPath,
      subtitlePath: artifacts.subtitlePath,
      ...(blenderArtifacts ? { blenderProjectPath: blenderArtifacts.blenderProjectPath, blenderScriptPath: blenderArtifacts.blenderScriptPath } : {}),
      sceneCount: renderManifest.scenes.length,
      durationSec: Number(outputDurationSec.toFixed(3)),
      audioReady: renderManifest.audio.available,
      missingMedia: renderManifest.missingMedia,
      settings,
      updatedAt: now(),
    };
    const updated = await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      const isStale = Boolean(current.render?.stale);
      const savedRender = isStale ? { ...render, stale: true } : render;
      current.render = savedRender;
      current.updatedAt = now();
      data.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "qa",
        title: isStale ? "Render hoàn tất nhưng cần render lại" : outputPath ? `${settings.renderer === "blender" ? "Blender local" : "FFmpeg"} render MP4 hoàn tất` : "Render manifest hoàn tất",
        detail: `${renderManifest.scenes.length} cảnh · ${Math.round(outputDurationSec / 60)} phút · ${renderManifest.missingMedia} cảnh dùng media dự phòng · audio ${renderManifest.audio.available ? "đã có" : "chưa có"}${isStale ? " · dữ liệu đổi trong lúc render" : ""}`,
        status: isStale || renderManifest.missingMedia || (settings.renderer !== "blender" && !renderManifest.audio.available) ? "warning" : "success",
      }));
      return { project: current, render: savedRender };
    });
    return NextResponse.json({ ok: true, mode, renderer: settings.renderer, render: updated.render, project: updated.project, manifest: { ...renderManifest, scenes: undefined }, urls: {
      video: outputPath ? fileUrl(slug, "video") : "",
      manifest: fileUrl(slug, "manifest"),
      subtitle: fileUrl(slug, "subtitle"),
      blend: blenderArtifacts ? fileUrl(slug, "blend") : "",
    } });
  } catch (cause) {
    const rawMessage = cause instanceof Error ? cause.message : "Render thất bại.";
    const message = rawMessage === "BLENDER_NOT_AVAILABLE"
      ? "Không tìm thấy Blender. Cài Blender hoặc đặt STORYAI_BLENDER_PATH rồi chạy lại."
      : rawMessage === "BLENDER_SCENE_SCRIPT_NOT_FOUND"
        ? `Coding agent chưa tạo scene Blender tại data/outputs/${slug}/blender/scene.py.`
        : rawMessage === "BLENDER_OUTPUT_MISSING"
          ? "Blender chạy xong nhưng không tạo được MP4. Kiểm tra log Blender và scene script."
          : rawMessage === "BLENDER_PROJECT_MISSING"
            ? "Blender chạy xong nhưng không lưu được file .blend."
            : rawMessage;
    await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      const hasPreviousArtifact = Boolean(current.render?.outputPath || current.render?.manifestPath || current.render?.subtitlePath);
      current.render = { ...current.render, status: "failed", stale: hasPreviousArtifact || current.render?.stale, updatedAt: now(), error: message };
      current.updatedAt = now();
      data.activities.unshift(makeActivity({ projectSlug: slug, kind: "qa", title: "Render thất bại", detail: message, status: "error" }));
    });
    const preflight = cause instanceof RenderMediaPreflightError ? cause : undefined;
    const status = preflight || rawMessage === "RENDER_NO_SCENES" || rawMessage === "BLENDER_SCENE_SCRIPT_NOT_FOUND" ? 409 : rawMessage === "FFMPEG_NOT_AVAILABLE" || rawMessage === "BLENDER_NOT_AVAILABLE" ? 503 : 500;
    return NextResponse.json({
      code: preflight?.code || rawMessage,
      message: rawMessage === "FFMPEG_NOT_AVAILABLE" ? "Không tìm thấy ffmpeg để render MP4." : message,
      ...(preflight ? { issues: preflight.issues } : {}),
    }, { status });
  } finally {
    releaseProjectRender(slug);
  }
  })();
  if (body.waitForCompletion === false) {
    void renderTask.catch((cause) => console.error("Background StoryAI render failed:", cause));
    return NextResponse.json({ ok: true, mode, renderer: settings.renderer, render: { status: "running", settings, updatedAt: now() } }, { status: 202 });
  }
  return await renderTask;
}

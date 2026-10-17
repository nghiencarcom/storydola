import { NextResponse } from "next/server";
import type { MediaGenerationSettings } from "../../../../../lib/project-types";
import { resolveMediaGenerationSettings } from "../../../../../lib/media-generation-settings";
import { readProjectScenes } from "../../../../../lib/scene-store";
import { getProjectOrThrow, makeActivity, now, readChunkOutput, saveChunkOutput, updateData } from "../../../../../lib/server-store";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = asRecord(await request.json().catch(() => ({}))) || {};
  const requestedSettings = asRecord(body.mediaGeneration) as Partial<MediaGenerationSettings> | null;
  const requestedIds = Array.isArray(body.sceneIds) ? [...new Set(body.sceneIds.map((value) => String(value).trim()).filter(Boolean))] : [];
  if (!requestedSettings) return NextResponse.json({ message: "Thiếu cấu hình model media." }, { status: 400 });
  if (!requestedIds.length || requestedIds.length > 1000) return NextResponse.json({ message: "Chọn từ 1 đến 1000 cảnh để áp dụng cấu hình." }, { status: 400 });

  try {
    const saved = await updateData(async (data) => {
      const project = getProjectOrThrow(data, slug);
      const allScenes = await readProjectScenes(project);
      const targets = allScenes.filter((scene) => requestedIds.includes(scene.id));
      if (targets.length !== requestedIds.length) throw new Error("SCENE_NOT_FOUND");
      const settings = resolveMediaGenerationSettings(requestedSettings);
      const idsByChunk = new Map<string, Set<string>>();
      for (const scene of targets) {
        const chunk = project.chunks.find((item) => item.id === scene.chunkId);
        if (!chunk?.outputPath) throw new Error("CHUNK_OUTPUT_NOT_FOUND");
        if (chunk.status === "processing") throw new Error("CHUNK_IS_PROCESSING");
        const ids = idsByChunk.get(scene.chunkId) || new Set<string>();
        ids.add(scene.id);
        idsByChunk.set(scene.chunkId, ids);
      }

      const outputPaths: string[] = [];
      for (const [chunkId, sceneIds] of idsByChunk) {
        const chunk = project.chunks.find((item) => item.id === chunkId)!;
        const payload = asRecord(await readChunkOutput(chunk));
        const rawScenes = payload && Array.isArray(payload.scenes) ? payload.scenes : [];
        const foundIds = new Set<string>();
        const updatedScenes = rawScenes.map((value) => {
          const record = asRecord(value) || {};
          const sceneId = String(record.id || record.scene_id || "").trim();
          if (!sceneIds.has(sceneId)) return value;
          foundIds.add(sceneId);
          return { ...record, mediaGeneration: settings };
        });
        if (foundIds.size !== sceneIds.size) throw new Error("SCENE_OUTPUT_NOT_FOUND");
        outputPaths.push(await saveChunkOutput(slug, chunkId, { ...(payload || {}), scenes: updatedScenes }));
      }

      project.updatedAt = now();
      data.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "chunk",
        title: `Đã áp dụng cấu hình media cho ${targets.length} cảnh`,
        detail: `Ảnh ${settings.imageModel} · video ${settings.videoModel} · thời lượng ${settings.videoDurationMode === "scene" ? "theo cảnh" : `${settings.videoDurationSec}s cố định`}`,
        status: "success",
      }));
      return { sceneIds: requestedIds, mediaGeneration: settings, outputPaths };
    });
    return NextResponse.json({ ok: true, ...saved });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Không thể áp dụng cấu hình media hàng loạt.";
    const status = message === "SCENE_NOT_FOUND" ? 404 : message === "CHUNK_IS_PROCESSING" || message === "CHUNK_OUTPUT_NOT_FOUND" || message === "SCENE_OUTPUT_NOT_FOUND" ? 409 : 500;
    return NextResponse.json({ message: status === 500 ? "Không thể áp dụng cấu hình media hàng loạt." : message }, { status });
  }
}

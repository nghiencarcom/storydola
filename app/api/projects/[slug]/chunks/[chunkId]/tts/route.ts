import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { isProjectRenderActive } from "../../../../../../lib/render-lock";
import { isProjectChunkRunActive } from "../../../../../../lib/chunk-generation-lock";
import { synthesizeOmniVoice } from "../../../../../../lib/omnivoice-tts-server";
import { getProjectOrThrow, makeActivity, markRenderStale, now, readData, updateData } from "../../../../../../lib/server-store";
import { claimProjectTts, releaseProjectTts } from "../../../../../../lib/tts-lock";
import { withProjectTtsSlot } from "../../../../../../lib/tts-concurrency";
import { resolveProjectDialogueVoice, resolveProjectSceneVoice } from "../../../../../../lib/project-tts-voice";
import { hasExplicitDialogueSegments, readDialogueSegments } from "../../../../../../lib/dialogue-segments";
import { wavDurationMs } from "../../../../../../lib/wav-duration";
import type { DialogueSegment, StoryProject } from "../../../../../../lib/project-types";

export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;
type VoiceTarget = {
  scene: JsonRecord;
  index: number;
  text: string;
  voiceId: string;
  voiceName: string;
  language: string;
  segment?: DialogueSegment;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function sceneVoiceText(scene: JsonRecord) {
  for (const key of ["dialogue_or_voiceover", "voiceText", "voiceover", "ttsVoice", "tts_voice"]) {
    const value = scene[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "scene";
}

function projectAudioRoot(slug: string, chunkId: string) {
  return path.join(process.cwd(), "data", "media", safeSegment(slug), "tts", safeSegment(chunkId));
}

function localDataPath(absolutePath: string) {
  return path.relative(process.cwd(), absolutePath).split(path.sep).join("/");
}

async function fileExists(filePath: string) {
  try { return (await stat(filePath)).isFile(); } catch { return false; }
}

function voiceTargetsForChunk(scenes: JsonRecord[], project: StoryProject): VoiceTarget[] {
  return scenes.flatMap((scene, index) => {
    if (project.presetId === "ai-drama" && hasExplicitDialogueSegments(scene)) {
      const lineProject = {
        ...project,
        voiceId: String(scene.ttsVoiceId || scene.tts_voice_id || project.voiceId || ""),
        voiceName: String(scene.ttsVoiceName || scene.tts_voice_name || project.voiceName || ""),
        voiceLanguage: String(scene.ttsVoiceLanguage || scene.tts_voice_language || project.voiceLanguage || project.language),
      };
      const segments = readDialogueSegments(scene, project.characters || []);
      scene.dialogueSegments = segments;
      return segments.map((segment) => {
        const voice = resolveProjectDialogueVoice(segment, lineProject);
        return { scene, index, segment, text: segment.text, ...voice };
      });
    }
    const text = sceneVoiceText(scene);
    return text ? [{ scene, index, text, ...resolveProjectSceneVoice(scene, project) }] : [];
  });
}

async function countReadyAudio(scenes: JsonRecord[], project: StoryProject, chunkId: string) {
  const targets = voiceTargetsForChunk(scenes, project);
  let completed = 0;
  for (const target of targets) {
    const audio = target.segment ? asRecord(target.segment.audio) : asRecord(target.scene.audio);
    const sceneId = String(target.scene.id || `S${String(target.index + 1).padStart(3, "0")}`);
    const sceneFolder = safeSegment(sceneId);
    const expectedPath = target.segment
      ? `data/media/${safeSegment(project.slug)}/tts/${safeSegment(chunkId)}/${sceneFolder}/${safeSegment(target.segment.id)}.wav`
      : `data/media/${safeSegment(project.slug)}/tts/${safeSegment(chunkId)}/${sceneFolder}.wav`;
    const localPath = String(audio.localPath || "").replace(/\\/g, "/");
    const textHash = createHash("sha256").update(target.text).digest("hex");
    if (audio.voiceId !== target.voiceId || audio.language !== target.language || audio.textHash !== textHash || localPath !== expectedPath) continue;
    if (await fileExists(path.resolve(process.cwd(), expectedPath))) completed += 1;
  }
  return { total: targets.length, completed };
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : "Lỗi không xác định khi tạo TTS.";
}

async function persistOutput(outputPath: string, payload: JsonRecord, scenes: JsonRecord[]) {
  await writeFile(outputPath, JSON.stringify({ ...payload, scenes }, null, 2));
}

function collectLegacyAudioPath(value: unknown, legacyRoot: string, paths: Set<string>) {
  const audio = asRecord(value);
  const localPath = [audio.localPath, audio.path, audio.filePath, audio.file_path]
    .find((item) => typeof item === "string" && item.trim());
  if (typeof localPath !== "string") return false;
  const resolved = path.resolve(process.cwd(), localPath);
  if (resolved.startsWith(`${legacyRoot}${path.sep}`)) paths.add(resolved);
  return true;
}

function hasLocalAudioPath(value: unknown) {
  const audio = asRecord(value);
  return [audio.localPath, audio.path, audio.filePath, audio.file_path]
    .some((item) => typeof item === "string" && item.trim());
}

function clearSceneTts(scene: JsonRecord, legacyRoot: string, legacyPaths: Set<string>) {
  let removed = 0;
  for (const key of ["audio", "tts"]) {
    const value = scene[key];
    if (value && typeof value === "object") {
      collectLegacyAudioPath(value, legacyRoot, legacyPaths);
      delete scene[key];
      removed += 1;
    }
  }
  if (scene.voice && typeof scene.voice === "object" && hasLocalAudioPath(scene.voice)) {
    collectLegacyAudioPath(scene.voice, legacyRoot, legacyPaths);
    delete scene.voice;
    removed += 1;
  }
  for (const key of ["audio_path", "audioPath", "voice_path", "voicePath"]) {
    const value = scene[key];
    if (typeof value === "string" && value.trim()) {
      const resolved = path.resolve(process.cwd(), value);
      if (resolved.startsWith(`${legacyRoot}${path.sep}`)) legacyPaths.add(resolved);
      delete scene[key];
      removed += 1;
    }
  }

  for (const key of ["dialogueSegments", "dialogue_segments"]) {
    if (!Array.isArray(scene[key])) continue;
    scene[key] = (scene[key] as unknown[]).map((value) => {
      const segment = { ...asRecord(value) };
      if (segment.audio && typeof segment.audio === "object") {
        collectLegacyAudioPath(segment.audio, legacyRoot, legacyPaths);
        delete segment.audio;
        removed += 1;
      }
      for (const translatedKey of ["translatedAudio", "translated_audio"]) {
        const localizedAudio = asRecord(segment[translatedKey]);
        for (const audio of Object.values(localizedAudio)) {
          collectLegacyAudioPath(audio, legacyRoot, legacyPaths);
          removed += 1;
        }
        delete segment[translatedKey];
      }
      return segment;
    });
  }
  return removed;
}

export async function DELETE(request: Request, context: { params: Promise<{ slug: string; chunkId: string }> }) {
  const { slug, chunkId } = await context.params;
  const selectedSceneId = new URL(request.url).searchParams.get("sceneId")?.trim() || "";
  const snapshot = await readData();
  const project = snapshot.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const chunk = project.chunks.find((item) => item.id === chunkId);
  if (!chunk) return NextResponse.json({ message: "Không tìm thấy tập." }, { status: 404 });
  if (!chunk.outputPath) return NextResponse.json({ message: "Tập này chưa có kịch bản." }, { status: 409 });
  if (isProjectRenderActive(slug)) return NextResponse.json({ message: "Project đang ghép video. Hãy đợi render hoàn tất rồi xoá TTS." }, { status: 409 });
  if (isProjectChunkRunActive(slug)) return NextResponse.json({ message: "Project đang viết kịch bản. Hãy đợi tác vụ hoàn tất rồi xoá TTS." }, { status: 409 });
  if (!claimProjectTts(slug, chunkId)) return NextResponse.json({ message: "Tập này đang tạo TTS. Hãy đợi tác vụ hoàn tất rồi thử lại." }, { status: 409 });

  const outputRoot = path.resolve(process.cwd(), "data", "outputs", safeSegment(slug));
  const outputPrefix = `data/outputs/${safeSegment(slug)}/`;
  const normalizedOutputPath = chunk.outputPath.replace(/\\/g, "/");
  const outputFilename = normalizedOutputPath.startsWith(outputPrefix) ? normalizedOutputPath.slice(outputPrefix.length) : "";
  if (!outputFilename || path.basename(outputFilename) !== outputFilename || !outputFilename.endsWith(".json")) {
    releaseProjectTts(slug, chunkId);
    return NextResponse.json({ message: "Đường dẫn kịch bản tập không hợp lệ." }, { status: 403 });
  }

  const chunkOutputPath = path.join(outputRoot, outputFilename);
  const audioRoot = path.resolve(projectAudioRoot(slug, chunkId));
  const legacyRoot = path.resolve(process.cwd(), "data", "audio", safeSegment(slug));
  try {
    const payload = asRecord(JSON.parse(await readFile(chunkOutputPath, "utf8")));
    const scenes = Array.isArray(payload.scenes) ? payload.scenes.map((scene) => asRecord(scene)) : [];
    if (!scenes.length) return NextResponse.json({ message: "Tập chưa có cảnh để xoá TTS." }, { status: 409 });
    const targetScenes = selectedSceneId ? scenes.filter((scene) => String(scene.id || scene.scene_id || "").trim() === selectedSceneId) : scenes;
    if (selectedSceneId && !targetScenes.length) return NextResponse.json({ message: "Không tìm thấy cảnh trong kịch bản của tập." }, { status: 404 });

    const legacyPaths = new Set<string>();
    const deleted = targetScenes.reduce((count, scene) => count + clearSceneTts(scene, legacyRoot, legacyPaths), 0);
    await persistOutput(chunkOutputPath, payload, scenes);
    if (selectedSceneId) {
      const sceneAudioRoot = path.join(audioRoot, safeSegment(selectedSceneId));
      const legacySceneAudio = path.join(audioRoot, `${safeSegment(selectedSceneId)}.wav`);
      await rm(sceneAudioRoot, { recursive: true, force: true });
      await rm(legacySceneAudio, { force: true });
    } else {
      await rm(audioRoot, { recursive: true, force: true });
    }
    await Promise.all([...legacyPaths].map((filePath) => rm(filePath, { force: true })));

    const summary = await countReadyAudio(scenes, project, chunkId);
    const status = summary.total === 0 ? "not_needed" : summary.completed >= summary.total ? "completed" : summary.completed ? "partial" : "idle";
    const total = scenes.reduce((count, scene) => count + (project.presetId === "ai-drama" && hasExplicitDialogueSegments(scene)
      ? readDialogueSegments(scene, project.characters || []).length
      : sceneVoiceText(scene) ? 1 : 0), 0);
    const episodeNumber = project.chunks.findIndex((item) => item.id === chunkId) + 1;
    const episodeLabel = `Tập ${String(episodeNumber).padStart(2, "0")}`;
    const targetLabel = selectedSceneId ? `${selectedSceneId} · ${episodeLabel}` : episodeLabel;
    await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      const currentChunk = current.chunks.find((item) => item.id === chunkId);
      if (currentChunk) {
        currentChunk.outputPath = chunk.outputPath;
        currentChunk.tts = { status, completed: summary.completed, total, failed: 0, updatedAt: now() };
        currentChunk.render = markRenderStale(currentChunk.render);
      }
      current.render = markRenderStale(current.render);
      current.updatedAt = now();
      data.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "chunk",
        title: `${targetLabel} đã xoá TTS`,
        detail: `Đã xoá audio TTS gốc và bản dịch${selectedSceneId ? " của cảnh này" : " của tập này"}${deleted ? ` · ${deleted} mục audio` : ""}. Có thể ghép lại để dùng tiếng gốc của video.`,
        status: "success",
      }));
    });
    return NextResponse.json({ ok: true, deleted, total, message: `${targetLabel} đã xoá TTS gốc và bản dịch.` });
  } catch (cause) {
    const message = errorMessage(cause);
    return NextResponse.json({ message: `Không xoá được TTS: ${message}` }, { status: 500 });
  } finally {
    releaseProjectTts(slug, chunkId);
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string; chunkId: string }> }) {
  const { slug, chunkId } = await context.params;
  const snapshot = await readData();
  const project = snapshot.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const chunk = project.chunks.find((item) => item.id === chunkId);
  if (!chunk) return NextResponse.json({ message: "Không tìm thấy tập." }, { status: 404 });
  if (!chunk.outputPath) return NextResponse.json({ message: "Tập này chưa có kịch bản để tạo TTS." }, { status: 409 });
  if (isProjectRenderActive(slug)) return NextResponse.json({ message: "Project đang ghép video. Hãy đợi render hoàn tất rồi tạo TTS." }, { status: 409 });
  const requestBody = asRecord(await request.json().catch(() => ({})));
  const force = requestBody.force === true;
  if (!claimProjectTts(slug, chunkId)) return NextResponse.json({ message: "Tập này đang tạo TTS." }, { status: 409 });

  const episodeNumber = project.chunks.findIndex((item) => item.id === chunkId) + 1;
  const episodeLabel = `Tập ${String(episodeNumber).padStart(2, "0")}`;
  const outputRoot = path.resolve(process.cwd(), "data", "outputs", safeSegment(slug));
  const outputPrefix = `data/outputs/${safeSegment(slug)}/`;
  const normalizedOutputPath = chunk.outputPath.replace(/\\/g, "/");
  const outputFilename = normalizedOutputPath.startsWith(outputPrefix) ? normalizedOutputPath.slice(outputPrefix.length) : "";
  if (!outputFilename || path.basename(outputFilename) !== outputFilename || !outputFilename.endsWith(".json")) {
    releaseProjectTts(slug, chunkId);
    return NextResponse.json({ message: "Đường dẫn kịch bản tập không hợp lệ." }, { status: 403 });
  }
  const chunkOutputPath = path.join(outputRoot, outputFilename);

  try {
    const payload = asRecord(JSON.parse(await readFile(chunkOutputPath, "utf8")));
    const scenes = Array.isArray(payload.scenes) ? payload.scenes.map((scene) => asRecord(scene)) : [];
    if (!scenes.length) throw new Error("Tập chưa có cảnh để tạo TTS.");
    const voiceScenes = voiceTargetsForChunk(scenes, project);

    if (!voiceScenes.length) {
      await updateData((data) => {
        const current = getProjectOrThrow(data, slug);
        const currentChunk = current.chunks.find((item) => item.id === chunkId);
        if (currentChunk) currentChunk.tts = { status: "not_needed", completed: 0, total: 0, failed: 0, updatedAt: now() };
        current.updatedAt = now();
      });
      return NextResponse.json({ ok: true, status: "not_needed", completed: 0, total: 0, failed: 0, message: `${episodeLabel} không có lời thoại/lời đọc để tạo TTS.` });
    }

    if (voiceScenes.some((item) => !item.voiceId)) {
      return NextResponse.json({ message: "Chưa có voice cho một số câu thoại. Gán voice cho nhân vật hoặc đặt voice mặc định của project." }, { status: 409 });
    }

    await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      const currentChunk = current.chunks.find((item) => item.id === chunkId);
      if (currentChunk) currentChunk.tts = { status: "running", completed: 0, total: voiceScenes.length, failed: 0, updatedAt: now() };
      current.updatedAt = now();
    });

    const audioRoot = projectAudioRoot(slug, chunkId);
    await mkdir(audioRoot, { recursive: true });
    let completed = 0;
    let failed = 0;
    let changed = false;
    const failures: string[] = [];

    const saveProgress = async (status: "running" | "completed" | "partial" | "failed", error?: string) => {
      await updateData((data) => {
        const current = getProjectOrThrow(data, slug);
        const currentChunk = current.chunks.find((item) => item.id === chunkId);
        if (currentChunk) {
          currentChunk.tts = { status, completed, total: voiceScenes.length, failed, updatedAt: now(), error };
          if (changed) currentChunk.render = markRenderStale(currentChunk.render);
        }
        if (changed) current.render = markRenderStale(current.render);
        current.updatedAt = now();
      });
    };

    let nextVoiceTargetIndex = 0;
    let outputPersistQueue = Promise.resolve();
    const persistOutputInOrder = () => {
      outputPersistQueue = outputPersistQueue.catch(() => undefined).then(() => persistOutput(chunkOutputPath, payload, scenes));
      return outputPersistQueue;
    };
    const workerCount = Math.min(5, voiceScenes.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (true) {
        const targetIndex = nextVoiceTargetIndex++;
        if (targetIndex >= voiceScenes.length) return;
        const item = voiceScenes[targetIndex];
        const sceneId = String(item.scene.id || `S${String(chunk.sceneStart + item.index).padStart(3, "0")}`);
        const textHash = createHash("sha256").update(item.text).digest("hex");
        const sceneFolder = safeSegment(sceneId);
        const audioPath = item.segment
          ? path.join(audioRoot, sceneFolder, `${safeSegment(item.segment.id)}.wav`)
          : path.join(audioRoot, `${sceneFolder}.wav`);
        const currentAudio = item.segment ? asRecord(item.segment.audio) : asRecord(item.scene.audio);
        const currentPath = String(currentAudio.localPath || "");
        const expectedAudioPath = item.segment
          ? `data/media/${safeSegment(slug)}/tts/${safeSegment(chunkId)}/${sceneFolder}/${safeSegment(item.segment.id)}.wav`
          : `data/media/${safeSegment(slug)}/tts/${safeSegment(chunkId)}/${sceneFolder}.wav`;
        if (!force && currentAudio.textHash === textHash && currentAudio.voiceId === item.voiceId && currentAudio.language === item.language && currentPath.replace(/\\/g, "/") === expectedAudioPath && await fileExists(audioPath)) {
          completed += 1;
          await saveProgress("running");
          continue;
        }

        try {
          await withProjectTtsSlot(slug, () => synthesizeOmniVoice(item.text, item.voiceId, item.language, audioPath));
          const generatedAudio = {
            provider: "omnivoice",
            voiceId: item.voiceId,
            voiceName: item.voiceName,
            language: item.language,
            localPath: localDataPath(audioPath),
            textHash,
            durationMs: await wavDurationMs(audioPath),
            createdAt: now(),
          };
          if (item.segment) item.segment.audio = generatedAudio;
          else item.scene.audio = { ...currentAudio, ...generatedAudio };
          await persistOutputInOrder();
          completed += 1;
          changed = true;
          await saveProgress("running");
        } catch (cause) {
          failed += 1;
          failures.push(`${sceneId}${item.segment ? `/${item.segment.id}` : ""}: ${errorMessage(cause)}`);
          await saveProgress("running", failures.slice(0, 3).join(" | "));
        }
      }
    }));
    await outputPersistQueue;

    const status = failed === 0 ? "completed" : completed > 0 ? "partial" : "failed";
    const error = failures.length ? failures.slice(0, 3).join(" | ") : undefined;
    await saveProgress(status, error);
    await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      data.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "chunk",
        title: `${episodeLabel} ${status === "completed" ? "đã tạo TTS" : status === "partial" ? "TTS hoàn tất một phần" : "tạo TTS thất bại"}`,
        detail: `${completed}/${voiceScenes.length} ${project.presetId === "ai-drama" ? "câu thoại" : "cảnh"} có audio${failed ? ` · ${failed} lỗi` : ""}${error ? ` · ${error}` : ""}`,
        status: status === "completed" ? "success" : "error",
      }));
      current.updatedAt = now();
    });

    return NextResponse.json({ ok: true, status, completed, total: voiceScenes.length, failed, message: error });
  } catch (cause) {
    const message = errorMessage(cause);
    await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      const currentChunk = current.chunks.find((item) => item.id === chunkId);
      if (currentChunk) currentChunk.tts = { status: "failed", completed: 0, total: 0, failed: 1, updatedAt: now(), error: message };
      current.updatedAt = now();
      data.activities.unshift(makeActivity({ projectSlug: slug, kind: "chunk", title: `${episodeLabel} tạo TTS thất bại`, detail: message, status: "error" }));
    });
    return NextResponse.json({ message }, { status: 500 });
  } finally {
    releaseProjectTts(slug, chunkId);
  }
}

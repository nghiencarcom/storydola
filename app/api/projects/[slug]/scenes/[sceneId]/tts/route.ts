import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { synthesizeOmniVoice } from "../../../../../../lib/omnivoice-tts-server";
import { isProjectRenderActive } from "../../../../../../lib/render-lock";
import { chunkForScene, findProjectScene } from "../../../../../../lib/scene-store";
import { getProjectOrThrow, markRenderStale, now, readChunkOutput, readData, saveChunkOutput, updateData } from "../../../../../../lib/server-store";
import { claimProjectTts, releaseProjectTts } from "../../../../../../lib/tts-lock";
import { withProjectTtsSlot } from "../../../../../../lib/tts-concurrency";
import { resolveProjectDialogueVoice, resolveProjectSceneVoice } from "../../../../../../lib/project-tts-voice";
import { hasExplicitDialogueSegments, readDialogueSegments } from "../../../../../../lib/dialogue-segments";
import { wavDurationMs } from "../../../../../../lib/wav-duration";
import type { DialogueSegment, StoryProject } from "../../../../../../lib/project-types";
import { FALLBACK_VIDEO_LANGUAGES } from "../../../../../../lib/omnivoice";

export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;
type AudioTarget = { scene: JsonRecord; text: string; segment?: DialogueSegment };

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

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : "Không thể xử lý voice cho cảnh.";
}

function outputScenes(payload: JsonRecord) {
  return Array.isArray(payload.scenes) ? payload.scenes.map(asRecord) : [];
}

async function countReadyAudio(scenes: JsonRecord[], project: StoryProject, chunkId: string) {
  const targets: AudioTarget[] = scenes.flatMap((scene) => {
    if (project.presetId === "ai-drama" && hasExplicitDialogueSegments(scene)) {
      return readDialogueSegments(scene, project.characters || []).map((segment) => ({ scene, segment, text: segment.text }));
    }
    return sceneVoiceText(scene) ? [{ scene, text: sceneVoiceText(scene) }] : [];
  });
  let completed = 0;
  for (const target of targets) {
    const lineProject = target.segment ? {
      ...project,
      voiceId: String(target.scene.ttsVoiceId || target.scene.tts_voice_id || project.voiceId || ""),
      voiceName: String(target.scene.ttsVoiceName || target.scene.tts_voice_name || project.voiceName || ""),
      voiceLanguage: String(target.scene.ttsVoiceLanguage || target.scene.tts_voice_language || project.voiceLanguage || project.language),
    } : project;
    const voiceId = target.segment ? resolveProjectDialogueVoice(target.segment, lineProject).voiceId : resolveProjectSceneVoice(target.scene, project).voiceId;
    const audio = target.segment ? asRecord(target.segment.audio) : asRecord(target.scene.audio);
    const localPath = String(audio.localPath || "").replace(/\\/g, "/");
    const expectedPath = target.segment
      ? `data/media/${safeSegment(project.slug)}/tts/${safeSegment(chunkId)}/${safeSegment(String(target.scene.id || "scene"))}/${safeSegment(target.segment.id)}.wav`
      : `data/media/${safeSegment(project.slug)}/tts/${safeSegment(chunkId)}/${safeSegment(String(target.scene.id || "scene"))}.wav`;
    const textHash = createHash("sha256").update(target.text).digest("hex");
    if (voiceId && audio.voiceId === voiceId && audio.textHash === textHash && localPath === expectedPath) {
      try {
        const details = await stat(path.resolve(process.cwd(), localPath));
        if (details.isFile()) completed += 1;
      } catch { /* missing audio will remain pending */ }
    }
  }
  return { total: targets.length, completed };
}

export async function GET(request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const { scene } = await findProjectScene(project, sceneId);
  if (!scene) return NextResponse.json({ message: "Không tìm thấy cảnh." }, { status: 404 });
  const query = new URL(request.url).searchParams;
  const segmentId = query.get("segmentId") || "";
  const language = query.get("language") || "";
  const segment = segmentId ? readDialogueSegments(scene, project.characters || []).find((item) => item.id === segmentId) : undefined;
  const audio = segmentId
    ? asRecord(language ? segment?.translatedAudio?.[language] : segment?.audio)
    : asRecord(scene.audio);
  const localPath = String(audio.localPath || "").replace(/\\/g, "/");
  if (!localPath) return NextResponse.json({ message: "Cảnh chưa có audio TTS." }, { status: 404 });

  const resolvedPath = path.resolve(process.cwd(), localPath);
  const audioRoot = path.resolve(process.cwd(), "data", "media", safeSegment(project.slug), "tts");
  const legacyAudioRoot = path.resolve(process.cwd(), "data", "audio", safeSegment(project.slug));
  if (!resolvedPath.startsWith(`${audioRoot}${path.sep}`) && !resolvedPath.startsWith(`${legacyAudioRoot}${path.sep}`)) return NextResponse.json({ message: "Audio không thuộc project này." }, { status: 403 });
  try {
    const details = await stat(resolvedPath);
    if (!details.isFile()) throw new Error("NOT_FILE");
    const range = request.headers.get("range");
    let start = 0;
    let end = details.size - 1;
    let status = 200;
    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (match) {
        if (match[1]) start = Number(match[1]);
        if (match[2]) end = Number(match[2]);
        if (!match[1] && match[2]) start = Math.max(0, details.size - Number(match[2]));
        end = Math.min(end, details.size - 1);
        if (start <= end && start < details.size) status = 206;
      }
    }
    if (start > end || start >= details.size) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${details.size}` } });
    }
    const stream = createReadStream(resolvedPath, { start, end });
    return new NextResponse(Readable.toWeb(stream) as unknown as BodyInit, {
      status,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
        ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${details.size}` } : {}),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ message: "Không đọc được file audio của cảnh." }, { status: 404 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await context.params;
  const snapshot = await readData();
  const project = snapshot.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  const { scene } = await findProjectScene(project, sceneId);
  if (!scene) return NextResponse.json({ message: "Không tìm thấy cảnh." }, { status: 404 });
  const chunk = chunkForScene(project, scene);
  if (!chunk?.outputPath) return NextResponse.json({ message: "Tập của cảnh chưa có kịch bản." }, { status: 409 });

  const body = asRecord(await request.json().catch(() => ({})));
  const requestedLanguage = String(body.targetLanguage || "").trim().replace(/_/g, "-");
  const targetLanguage = requestedLanguage
    ? FALLBACK_VIDEO_LANGUAGES.find((item) => item.toLowerCase() === requestedLanguage.toLowerCase()) || ""
    : "";
  if (requestedLanguage && !targetLanguage) return NextResponse.json({ message: "Ngôn ngữ voice không được hỗ trợ." }, { status: 400 });
  if (targetLanguage && project.presetId !== "ai-drama") return NextResponse.json({ message: "Voice theo bản dịch chỉ áp dụng cho AI Drama." }, { status: 409 });
  const segmentedScene = project.presetId === "ai-drama" && hasExplicitDialogueSegments(scene);
  const resolvedVoice = resolveProjectSceneVoice(scene, project);
  const voiceId = project.presetId === "ai-drama"
    ? resolvedVoice.voiceId
    : String(body.voiceId || resolvedVoice.voiceId || "").trim();
  const voiceName = project.presetId === "ai-drama"
    ? resolvedVoice.voiceName
    : String(body.voiceName || resolvedVoice.voiceName || "").trim();
  const voiceProfileLanguage = project.presetId === "ai-drama"
    ? resolvedVoice.profileLanguage
    : String(body.voiceLanguage || resolvedVoice.profileLanguage || "vi").trim();
  const videoLanguage = String(project.language || "vi").trim();
  const generate = body.generate === true;
  const force = body.force === true;
  if (!voiceId && !segmentedScene) return NextResponse.json({ message: "Hãy chọn voice cho cảnh trước." }, { status: 400 });
  if (generate && !sceneVoiceText(scene) && !(segmentedScene && readDialogueSegments(scene, project.characters || []).length)) return NextResponse.json({ message: "Cảnh này chưa có lời thoại/lời đọc để tạo TTS." }, { status: 409 });
  if (generate && isProjectRenderActive(slug)) return NextResponse.json({ message: "Project đang ghép video. Hãy đợi render hoàn tất rồi tạo voice." }, { status: 409 });
  if (!claimProjectTts(slug, chunk.id)) return NextResponse.json({ message: "Tập này đang tạo TTS." }, { status: 409 });

  try {
    const payload = asRecord(await readChunkOutput(chunk));
    const scenes = outputScenes(payload);
    const targetIndex = scenes.findIndex((item) => String(item.id || item.scene_id || "").trim() === scene.id);
    if (targetIndex < 0) return NextResponse.json({ message: "Không tìm thấy cảnh trong file kịch bản của tập." }, { status: 409 });

    const targetScene = scenes[targetIndex];
    if (generate && project.presetId === "ai-drama" && hasExplicitDialogueSegments(targetScene)) {
      const segments = readDialogueSegments(targetScene, project.characters || []);
      if (!segments.length) return NextResponse.json({ message: "Cảnh này chưa có câu thoại trong timeline." }, { status: 409 });
      if (targetLanguage && segments.some((segment) => !segment.translations?.[targetLanguage]?.trim())) {
        return NextResponse.json({ message: "Dịch lời thoại của cảnh sang ngôn ngữ đã chọn trước khi tạo voice." }, { status: 409 });
      }
      const missingVoice = segments.find((segment) => {
        const speaker = project.characters?.find((character) => character.id === segment.speakerCharacterId);
        return !(speaker?.voiceId || targetScene.ttsVoiceId || targetScene.tts_voice_id || project.voiceId);
      });
      if (missingVoice) return NextResponse.json({ message: "Chưa có voice cho một hoặc nhiều câu thoại. Gán voice cho nhân vật hoặc đặt voice mặc định của project." }, { status: 409 });

      let generatedCount = 0;
      let unchangedCount = 0;
      let failedCount = 0;
      const failures: string[] = [];
      const audioRoot = path.join(process.cwd(), "data", "media", safeSegment(slug), "tts", safeSegment(chunk.id));
      for (const segment of segments) {
        const speaker = project.characters?.find((character) => character.id === segment.speakerCharacterId);
        const lineProject = {
          ...project,
          voiceId: String(targetScene.ttsVoiceId || targetScene.tts_voice_id || project.voiceId || ""),
          voiceName: String(targetScene.ttsVoiceName || targetScene.tts_voice_name || project.voiceName || ""),
          voiceLanguage: String(targetScene.ttsVoiceLanguage || targetScene.tts_voice_language || project.voiceLanguage || project.language),
        };
        const lineVoice = resolveProjectDialogueVoice(segment, lineProject);
        const lineVoiceId = speaker?.voiceId || lineVoice.voiceId;
        const lineVoiceName = speaker?.voiceName || lineVoice.voiceName || lineVoiceId;
        const lineLanguage = targetLanguage || lineVoice.language;
        const lineText = targetLanguage ? segment.translations?.[targetLanguage] || "" : segment.text;
        const textHash = createHash("sha256").update(lineText).digest("hex");
        const sceneFolder = safeSegment(String(targetScene.id || scene.id));
        const segmentFilename = targetLanguage
          ? `${safeSegment(segment.id)}.${safeSegment(targetLanguage)}.wav`
          : `${safeSegment(segment.id)}.wav`;
        const absolutePath = path.join(audioRoot, sceneFolder, segmentFilename);
        const expectedPath = `data/media/${safeSegment(slug)}/tts/${safeSegment(chunk.id)}/${sceneFolder}/${segmentFilename}`;
        const currentAudio = asRecord(targetLanguage ? segment.translatedAudio?.[targetLanguage] : segment.audio);
        const currentPath = String(currentAudio.localPath || "").replace(/\\/g, "/");
        let unchanged = false;
        if (!force && currentAudio.textHash === textHash && currentAudio.voiceId === lineVoiceId && currentAudio.language === lineLanguage && currentPath === expectedPath) {
          try { unchanged = (await stat(absolutePath)).isFile(); } catch { unchanged = false; }
        }
        if (unchanged) {
          const audio = { ...currentAudio, durationMs: Number(currentAudio.durationMs) || await wavDurationMs(absolutePath) } as NonNullable<DialogueSegment["audio"]>;
          if (targetLanguage) segment.translatedAudio = { ...(segment.translatedAudio || {}), [targetLanguage]: audio };
          else segment.audio = audio;
          unchangedCount += 1;
          continue;
        }
        try {
          await withProjectTtsSlot(slug, () => synthesizeOmniVoice(lineText, lineVoiceId, lineLanguage, absolutePath));
          const newAudio = {
            provider: "omnivoice",
            voiceId: lineVoiceId,
            voiceName: lineVoiceName,
            language: lineLanguage,
            localPath: expectedPath,
            textHash,
            durationMs: await wavDurationMs(absolutePath),
            createdAt: now(),
          };
          if (targetLanguage) {
            segment.translatedAudio = { ...(segment.translatedAudio || {}), [targetLanguage]: newAudio };
          } else {
            segment.audio = newAudio;
          }
          generatedCount += 1;
        } catch (cause) {
          failedCount += 1;
          failures.push(`${segment.id}: ${errorMessage(cause)}`);
        }
      }
      targetScene.dialogueSegments = segments;
      const savedOutputPath = await saveChunkOutput(slug, chunk.id, { ...payload, scenes });
      const summary = await countReadyAudio(scenes, project, chunk.id);
      await updateData((data) => {
        const current = getProjectOrThrow(data, slug);
        const currentChunk = current.chunks.find((item) => item.id === chunk.id);
        if (currentChunk) {
          currentChunk.outputPath = savedOutputPath;
          currentChunk.tts = {
            status: summary.total === 0 ? "not_needed" : failedCount ? summary.completed > 0 ? "partial" : "failed" : summary.completed >= summary.total ? "completed" : summary.completed > 0 ? "partial" : "idle",
            completed: summary.completed,
            total: summary.total,
            failed: failedCount,
            error: failures.slice(0, 3).join(" | ") || undefined,
            updatedAt: now(),
          };
          if (generatedCount && !targetLanguage) currentChunk.render = markRenderStale(currentChunk.render);
          if (generatedCount && targetLanguage && currentChunk.render?.localizedRenders?.[targetLanguage]) {
            currentChunk.render.localizedRenders[targetLanguage] = markRenderStale(currentChunk.render.localizedRenders[targetLanguage])!;
          }
        }
        if (generatedCount && !targetLanguage) current.render = markRenderStale(current.render);
        current.updatedAt = now();
      });
      return NextResponse.json({
        ok: true,
        status: failedCount ? summary.completed > 0 ? "partial" : "failed" : "completed",
        generated: generatedCount > 0,
        unchanged: unchangedCount === segments.length,
        completed: summary.completed,
        total: summary.total,
        failed: failedCount,
        message: failures.slice(0, 3).join(" | "),
        scene: { ...targetScene, id: scene.id, chunkId: chunk.id, sceneIndex: scene.sceneIndex },
        audioUrls: segments.map((segment) => ({ id: segment.id, url: `/api/projects/${encodeURIComponent(slug)}/scenes/${encodeURIComponent(scene.id)}/tts?segmentId=${encodeURIComponent(segment.id)}${targetLanguage ? `&language=${encodeURIComponent(targetLanguage)}` : ""}` })),
      });
    }
    if (!voiceId) return NextResponse.json({ message: "Hãy chọn voice cho cảnh trước." }, { status: 400 });
    targetScene.ttsVoiceId = voiceId;
    targetScene.ttsVoiceName = voiceName || voiceId;
    targetScene.ttsVoiceLanguage = voiceProfileLanguage;
    let generated = false;
    let unchanged = false;
    let textHash = "";
    let audioPath = "";
    let sceneTotal = 0;
    let completed = 0;

    if (generate) {
      const text = sceneVoiceText(targetScene);
      textHash = createHash("sha256").update(text).digest("hex");
      audioPath = path.join(process.cwd(), "data", "media", safeSegment(slug), "tts", safeSegment(chunk.id), `${safeSegment(scene.id)}.wav`);
      const audio = asRecord(targetScene.audio);
      const expectedPath = `data/media/${safeSegment(slug)}/tts/${safeSegment(chunk.id)}/${safeSegment(scene.id)}.wav`;
      const currentPath = String(audio.localPath || "").replace(/\\/g, "/");
      if (!force && audio.textHash === textHash && audio.voiceId === voiceId && audio.language === videoLanguage && currentPath === expectedPath) {
        try { unchanged = (await stat(audioPath)).isFile(); } catch { unchanged = false; }
      }

      if (!unchanged) {
        await withProjectTtsSlot(slug, () => synthesizeOmniVoice(text, voiceId, videoLanguage, audioPath));
        targetScene.audio = {
          ...audio,
          provider: "omnivoice",
          voiceId,
          voiceName: voiceName || voiceId,
          language: videoLanguage,
          localPath: path.relative(process.cwd(), audioPath).split(path.sep).join("/"),
          textHash,
          createdAt: now(),
        };
        generated = true;
      }
    }

    const savedOutputPath = await saveChunkOutput(slug, chunk.id, { ...payload, scenes });
    const summary = await countReadyAudio(scenes, project, chunk.id);
    sceneTotal = summary.total;
    completed = summary.completed;

    if (generate) {
      await updateData((data) => {
        const current = getProjectOrThrow(data, slug);
        const currentChunk = current.chunks.find((item) => item.id === chunk.id);
        if (currentChunk) {
          currentChunk.outputPath = savedOutputPath;
          currentChunk.tts = {
            status: sceneTotal === 0 ? "not_needed" : completed >= sceneTotal ? "completed" : completed > 0 ? "partial" : "idle",
            completed,
            total: sceneTotal,
            failed: 0,
            updatedAt: now(),
          };
          if (generated) currentChunk.render = markRenderStale(currentChunk.render);
        }
        current.updatedAt = now();
      });
    } else {
      await updateData((data) => {
        const current = getProjectOrThrow(data, slug);
        const currentChunk = current.chunks.find((item) => item.id === chunk.id);
        if (currentChunk) {
          currentChunk.outputPath = savedOutputPath;
          currentChunk.tts = {
            status: sceneTotal === 0 ? "not_needed" : completed >= sceneTotal ? "completed" : completed > 0 ? "partial" : "idle",
            completed,
            total: sceneTotal,
            failed: 0,
            updatedAt: now(),
          };
        }
        current.updatedAt = now();
      });
    }

    return NextResponse.json({
      ok: true,
      generated,
      unchanged,
      scene: { ...targetScene, id: scene.id, chunkId: chunk.id, sceneIndex: scene.sceneIndex },
      tts: generate ? { completed, total: sceneTotal } : undefined,
      audioUrl: generate && (generated || unchanged) ? `/api/projects/${encodeURIComponent(slug)}/scenes/${encodeURIComponent(scene.id)}/tts` : "",
    });
  } catch (cause) {
    const message = errorMessage(cause);
    return NextResponse.json({ message }, { status: 500 });
  } finally {
    releaseProjectTts(slug, chunk.id);
  }
}

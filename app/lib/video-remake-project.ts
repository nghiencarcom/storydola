import { normalizeContentGenre, normalizeStorySetting } from "./content-genres";
import { buildContinuityQaReport } from "./continuity-qa";
import { dramaPlanSourceText, normalizeDramaPlan } from "./drama-plan";
import { reconcileEpisodeLocations } from "./episode-locations";
import { validateEpisode } from "./episode-script-validation";
import { MAX_PROJECT_CHUNK_SIZE } from "./project-types";
import { evaluateChunkScenes } from "./scene-ai-review";
import { createChunks, makeActivity, makeProject, saveChunkOutput, updateDataForUser } from "./server-store";
import { continuityContextFromOutput } from "./story-context";
import { normalizeProjectStyleSettings } from "./visual-styles";
import type { RemakeJob } from "./video-remake";

function composeRemakeVideoPrompt(scene: RemakeJob["result"] extends infer R ? R extends { draft: { scenes: Array<infer S> } } ? S : never : never) {
  const base = scene.videoPrompt.trim();
  const extras: string[] = [];
  if (scene.sfx && !/\bSFX\s*:/i.test(base)) extras.push(`SFX: ${scene.sfx}`);
  if (scene.vfx && !/\bVFX\s*:/i.test(base)) extras.push(`VFX: ${scene.vfx}`);
  return extras.length ? `${base}\n${extras.join("\n")}` : base;
}

export async function createRemakeProject(owner: string, job: RemakeJob & { result: NonNullable<RemakeJob["result"]> }) {
  const { draft, windows, aspectRatio } = job.result;
  const slug = `remake-${job.id}`;
  const durationSeconds = windows[windows.length - 1].end;
  const durationMinutes = Number((durationSeconds / 60).toFixed(3));
  const chunkSize = Math.min(windows.length, MAX_PROJECT_CHUNK_SIZE);
  const chunks = createChunks(windows.length, chunkSize);
  const contentGenre = normalizeContentGenre(job.input.contentGenre || draft.contentGenre);
  const storySetting = normalizeStorySetting(job.input.storySetting || draft.storySetting);
  const { visualStyle, imageStyle } = normalizeProjectStyleSettings(
    job.input.visualStyle || draft.visualStyle,
    job.input.imageStyle || draft.imageStyle,
  );
  const episodes = chunks.map((chunk, index) => {
    if (chunks.length === 1) {
      return { title: draft.title, summary: draft.synopsis, openingHook: draft.openingHook, turningPoint: draft.turningPoint, endHook: draft.ending };
    }
    const first = draft.scenes[chunk.sceneStart - 1];
    const last = draft.scenes[chunk.sceneEnd - 1];
    const turningPoint = draft.scenes[Math.floor((chunk.sceneStart + chunk.sceneEnd) / 2) - 1].action;
    return {
      title: `${draft.title.slice(0, 145)} · Tập ${index + 1}`,
      summary: [first.action, first === last ? "" : last.action].filter(Boolean).join("\n"),
      openingHook: index === 0 ? draft.openingHook : first.action,
      turningPoint,
      endHook: index === chunks.length - 1 ? draft.ending : last.continuityOut,
    };
  });
  const dramaPlan = normalizeDramaPlan({
    ...draft, videoTitle: draft.title, continuityRules: draft.continuity, episodes,
  }, chunks.length);

  return updateDataForUser(owner, async (data) => {
    if (data.projects.some((item) => item.slug === slug)) return slug;
    const project = makeProject({
      title: draft.title, sourceUrl: job.localSource ? "" : job.input.url, presetId: "ai-drama", scriptMode: "ai",
      durationMinutes, chunkSize, language: job.input.language, aspectRatio,
      contentGenre, secondaryGenres: [], storySetting, settingNotes: "",
      visualStyle, imageStyle,
      sourceText: dramaPlanSourceText(dramaPlan, {
        projectTitle: draft.title, brief: job.input.direction || draft.logline,
        durationMinutes, chunkSize, language: job.input.language,
        totalScenes: windows.length,
      }),
    }, slug);
    const timestamp = project.createdAt;
    const referenceFields = {
      referenceImagePath: "", referenceImageName: "", referenceImageMimeType: "", createdAt: timestamp, updatedAt: timestamp,
    };
    project.videoTitle = draft.title;
    project.dramaPlan = dramaPlan;
    project.scriptProvider = "Code Agent CLI";
    const agentLabel = { codex: "Codex", claude: "Claude Code", antigravity: "Antigravity" }[job.agent.agent];
    project.scriptModel = job.agent.model ? `${agentLabel} · ${job.agent.model}` : agentLabel;
    project.characters = dramaPlan.characters.map((item, index) => ({ ...item, ...referenceFields, id: `char-ai-${index + 1}` }));
    project.locations = dramaPlan.locations.map((item, index) => ({ ...item, ...referenceFields, id: `loc-ai-${index + 1}` }));
    const characterIds = new Map(project.characters.map(({ name, id }) => [name, id]));
    const scenes = draft.scenes.map((scene, index) => {
      const window = windows[index];
      const dialogueMode = scene.dialogueMode || (scene.dialogue.length ? "dialogue_led" : "visual_led");
      const primarySpeaker = scene.dialogue[0]?.speaker || "";
      return {
        id: `S${String(index + 1).padStart(3, "0")}`,
        start_sec: window.start, end_sec: window.end, duration_sec: window.duration,
        act: index === 0 ? "Hook" : index === draft.scenes.length - 1 ? "Payoff" : "Development",
        purpose: scene.purpose, beat_summary: scene.action, media_type: "video",
        dialogue_mode: dialogueMode,
        speaker_character: dialogueMode === "visual_led" && scene.dialogue.length === 0 ? "NONE" : primarySpeaker,
        dialogue_or_voiceover: scene.dialogue.map(({ text }) => text).join("\n"),
        dialogue_segments: scene.dialogue.map(({ speaker, text, start, end }) => ({
          speaker_character: speaker, speaker_character_id: characterIds.get(speaker), text, start_sec: start, end_sec: end,
        })),
        voiceover_target_sec: scene.dialogue.at(-1)?.end || 0,
        characters: scene.characters, character_ids: scene.characters.map((name) => characterIds.get(name)!), location_name: scene.location,
        image_keyword: scene.location, video_keyword: scene.action.slice(0, 120),
        image_prompt: scene.imagePrompt, video_prompt: composeRemakeVideoPrompt(scene),
        acting_beat: scene.actingBeat || scene.action,
        blocking: scene.blocking || scene.continuityIn,
        shot_size: scene.shotSize || "",
        camera_movement: scene.cameraMovement || "",
        eye_line_action: scene.eyelineAction || "",
        continuity_in: scene.continuityIn, continuity_out: scene.continuityOut,
        source_basis: `${window.sourceStart}–${window.sourceEnd}s · ${scene.sourceRole}`,
        risk_flags: [],
      };
    });
    project.durationSeconds = durationSeconds;
    project.durationMinutes = durationMinutes;
    project.totalScenes = project.completedScenes = scenes.length;
    project.totalChunks = project.completedChunks = chunks.length;
    project.chunks = chunks;
    project.status = "needs_review";
    for (const [index, chunk] of chunks.entries()) {
      const outline = dramaPlan.episodes[index];
      const episodeScenes = scenes.slice(chunk.sceneStart - 1, chunk.sceneEnd);
      const { episode, message } = validateEpisode({
        schema: "scene-script.v1", chunk_id: chunk.id, episode_title: outline.title, chunk_summary: outline.summary,
        episode_hooks: { opening_hook: outline.openingHook, turning_point: outline.turningPoint, end_hook: outline.endHook },
        character_bible: dramaPlan.characters.map(({ name, description, imagePrompt }) => ({ name, description, image_prompt: imagePrompt })),
        location_bible: dramaPlan.locations.map(({ name, description, imagePrompt }) => ({ name, description, image_prompt: imagePrompt })),
        continuity_state: {
          story_so_far: outline.summary, active_characters: [], active_locations: [], open_threads: [],
          next_chunk_plan: dramaPlan.episodes[index + 1]?.openingHook || "",
        },
        scenes: episodeScenes,
      }, true);
      if (!episode) throw new Error(message || "Không nhập được cảnh remake vào Phim AI.");

      chunk.title = outline.title;
      chunk.generatedScenes = episodeScenes.length;
      chunk.status = "completed";
      chunk.updatedAt = timestamp;
      const reconciled = reconcileEpisodeLocations(project.locations, episode.payload, timestamp);
      project.locations = reconciled.locations;
      const review = await evaluateChunkScenes({ project, chunk, scenes: reconciled.scenes, useModel: false });
      const payload = { ...episode.payload, scenes: review.scenes };
      const spokenScenes = episodeScenes.filter((scene) => scene.dialogue_segments.length).length;
      chunk.tts = { status: spokenScenes ? "idle" : "not_needed", completed: 0, failed: 0, total: spokenScenes, updatedAt: timestamp };
      chunk.outputPath = await saveChunkOutput(slug, chunk.id, payload);
      project.aiReviewCount = (project.aiReviewCount || 0) + review.summary.needsChanges;
      project.continuityContext = continuityContextFromOutput({
        payload, chunkId: chunk.id, sceneEnd: chunk.sceneEnd, previousContext: project.continuityContext,
      });
    }
    project.continuityQa = await buildContinuityQaReport(project);
    data.projects.unshift(project);
    data.activities.unshift(makeActivity({
      projectSlug: slug, kind: "project", title: "Đã tạo Phim AI từ bản remake",
      detail: `${scenes.length} cảnh · ${durationSeconds} giây · ${agentLabel} CLI`, status: "success",
    }));
    return slug;
  });
}
